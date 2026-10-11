/**
 * Edge side of the Rateboard bid-rate recorder (the pure logic lives in shared/rbHistory.ts).
 *
 * Reads Rateboard's public board (sanitised: no hashes), appends a sample to the history document, and persists that
 * document to Workers KV at most once per WRITE_EVERY_MS (≤144 writes/day, of KV's ~1,000/day free allowance).
 *  - Board reads go through the Cache API (60 s) so concurrent visitors share one upstream request.
 *  - The history document is held in isolate memory for 30 s so a burst of requests costs one KV read.
 *  - If nothing is bound to CACHE the recorder still works in memory but reports `persisted: false`.
 */
import type { RbBoard } from '../../shared/rateboard';
import { RB_BOARD_KEY, RB_ORIGIN, sanitizeBoard } from '../../shared/rateboard';
import { aggregateBoard, appendSample, distinctBuyers, mergeSeed, plausibleSample, RB_HIST_KEY, type RbHistDoc } from '../../shared/rbHistory';
import { cached, OUR_UA, type Env } from './http';

export const WRITE_EVERY_MS = 10 * 60_000;
const MEMO_MS = 30_000;
const SEED_PATH = '/data/rb-rates-seed.json';

let memo: { doc: RbHistDoc | null; at: number } | null = null;
/** Test hook: forget the isolate-level copy. */
export const resetRbMemo = () => {
  memo = null;
};

export async function loadRbHistory(env: Env, now = Date.now()): Promise<RbHistDoc | null> {
  if (memo && now - memo.at < MEMO_MS) return memo.doc;
  let doc: RbHistDoc | null = null;
  if (env.CACHE) {
    try {
      const d = await env.CACHE.get<RbHistDoc>(RB_HIST_KEY, 'json');
      if (d && d.v === 1 && d.players) doc = d;
    } catch {
      /* treat as empty — the next write recreates it */
    }
  }
  memo = { doc, at: now };
  return doc;
}

async function loadSeed(env: Env, origin: string): Promise<RbHistDoc | null> {
  try {
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request(new URL(SEED_PATH, origin))) : await fetch(new URL(SEED_PATH, origin));
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return null;
    const d = (await res.json()) as RbHistDoc;
    return d && d.v === 1 && d.players && d.samples ? d : null;
  } catch {
    return null;
  }
}

/** The sanitised board, shared across visitors for 60 s. */
export async function fetchBoard(waitUntil?: (p: Promise<unknown>) => void): Promise<RbBoard | null> {
  const res = await cached(
    'market/rb-board',
    60,
    async () => {
      const r = await fetch(`${RB_ORIGIN}/api/kv?key=${encodeURIComponent(RB_BOARD_KEY)}`, { headers: { Accept: 'application/json', 'User-Agent': OUR_UA } });
      if (!r.ok) return new Response(JSON.stringify({ error: r.status }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      try {
        return new Response(JSON.stringify(sanitizeBoard(await r.json())), { headers: { 'Content-Type': 'application/json' } });
      } catch {
        return new Response('{"error":"bad_payload"}', { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    },
    waitUntil,
  );
  if (!res.ok) return null;
  try {
    return (await res.json()) as RbBoard;
  } catch {
    return null;
  }
}

export interface EnsureResult {
  doc: RbHistDoc | null;
  /** A new sample was appended by this call. */
  sampled: boolean;
  /** The document was written to KV by this call. */
  wrote: boolean;
  persisted: boolean;
  /** Set when the board could not be read or looked implausible. */
  skipped?: 'upstream' | 'implausible';
}

/**
 * Load the history, take a fresh sample of the board, and (throttled) persist. Never throws: on any failure it returns
 * whatever history already exists, so the tabs keep working from what was recorded earlier.
 */
export async function ensureSample(env: Env, opts: { now?: number; origin: string; waitUntil?: (p: Promise<unknown>) => void }): Promise<EnsureResult> {
  const now = opts.now ?? Date.now();
  const persisted = !!env.CACHE;
  let doc = await loadRbHistory(env, now);
  if (!doc || !doc.seeded) {
    const seed = await loadSeed(env, opts.origin);
    if (seed && (!doc || !doc.seeded)) {
      doc = mergeSeed(doc, seed);
      doc.updatedAt = 0; // persist the merge right away (once)
    }
  }
  const board = await fetchBoard(opts.waitUntil);
  let sampled = false;
  let skipped: EnsureResult['skipped'];
  if (!board) skipped = 'upstream';
  else {
    const aggs = aggregateBoard(board);
    if (!plausibleSample(doc, aggs)) skipped = 'implausible';
    else {
      const before = doc?.samples ?? 0;
      doc = appendSample(doc, aggs, now, distinctBuyers(board));
      sampled = doc.samples > before;
    }
  }
  let wrote = false;
  if (doc && env.CACHE && now - doc.updatedAt >= WRITE_EVERY_MS && doc.samples > 0) {
    doc.updatedAt = now;
    try {
      await env.CACHE.put(RB_HIST_KEY, JSON.stringify(doc), { expirationTtl: 60 * 60 * 24 * 45 });
      wrote = true;
    } catch {
      /* KV write quota or transient failure — keep serving from memory */
    }
  }
  memo = { doc, at: now };
  return { doc, sampled, wrote, persisted, skipped };
}
