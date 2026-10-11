/**
 * Community market — contribute  —  POST /api/market/contribute   body { capture, contributor }
 *
 * The OPT-IN half of the shared market database (docs/COMMUNITY-MARKET.md): a browser that has just imported a Real market
 * capture may send the same capture here, anonymously, so other RAX users can see it. Everything is checked before anything is
 * written (size, shape, plausibility, rate limits, a daily write budget), the write is a few set-based D1 statements, and the
 * answer says exactly what happened to every row. Failures here never affect the contributor's own local import.
 */
import { err, json, preflight, type Env } from '../../_lib/http';
import { BUDGET, CONTRIBUTOR_RE, estimate, gate, identify, plan, prune, readState } from '../../_lib/marketDb';
import { cleanCapture, LIMITS, Rejected } from '../../_lib/marketValidate';
import { rateLimit } from '../../_lib/ratelimit';

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return err(405, 'method_not_allowed', 'POST only.');
  const db = env.MARKET_DB;
  if (!db) return err(503, 'no_db', 'The community database (MARKET_DB) is not bound on this deployment.');
  const now = Date.now();
  try {
    const declared = Number(request.headers.get('content-length') ?? 0);
    if (declared > LIMITS.bodyBytes) throw new Rejected(413, 'too_large', `At most ${LIMITS.bodyBytes / 1024} KB per contribution.`);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > LIMITS.bodyBytes) throw new Rejected(413, 'too_large', `At most ${LIMITS.bodyBytes / 1024} KB per contribution.`);
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Rejected(400, 'bad_json', 'The body must be JSON: { "capture": {…}, "contributor": "<random id>" }.');
    }
    if (!body || typeof body !== 'object' || typeof body.contributor !== 'string' || !CONTRIBUTOR_RE.test(body.contributor)) {
      throw new Rejected(400, 'bad_contributor', 'contributor must be a random id of 16–64 letters, digits, "-" or "_" (the browser generates it once).');
    }
    const ip = request.headers.get('CF-Connecting-IP');
    const id = await identify(body.contributor, ip, now);

    // First line of defence: a per-data-centre counter in the Cache API (free, no D1 reads) keyed by the HASHED network bucket.
    const soft = await rateLimit(new Request('https://rl.rax.internal/', { headers: { 'CF-Connecting-IP': id.buckets.network } }), 'market-contribute', BUDGET.perHour * 3, 3600);
    if (!soft.allowed) return err(429, 'rate_limited', `Too many contributions from this network. Try again in ${Math.ceil(soft.retryAfter / 60)} min.`, { retryAfter: soft.retryAfter });

    const clean = cleanCapture(body.capture, now);
    if (!clean.auctions.length && !clean.sales.length && !clean.stats.length) {
      const why = Object.entries(clean.dropped.reasons).sort((a, b) => b[1] - a[1]).slice(0, 5);
      throw new Rejected(422, 'nothing_valid', `No row in that capture passed validation${why.length ? ` (${why.map(([k, n]) => `${k} ×${n}`).join(', ')})` : ' (it was empty)'}.`);
    }

    let reads = await readState(db, clean, id, now);
    let g = gate(reads, estimate(db, clean, id, reads, now), now);
    if (!g.ok && g.code === 'row_cap') {
      await prune(db, now, true); // over the row cap: make room now rather than wait for the hourly pass
      reads = await readState(db, clean, id, now);
      g = gate(reads, estimate(db, clean, id, reads, now), now);
    }
    if (!g.ok) return err(g.status!, g.code!, g.message!, { retryAfter: g.retryAfter });

    const p = plan(db, clean, id, reads, now);
    await db.batch(p.statements);
    waitUntil(prune(db, now).catch(() => undefined)); // retention + caps, at most hourly

    const r = p.result;
    const sum = (c: { auctions: number; sales: number; stats: number }) => c.auctions + c.sales + c.stats;
    const dropped = sum(r.dropped);
    return json(
      {
        ok: true,
        accepted: r.accepted,
        new: r.new,
        duplicates: r.duplicates,
        corroborated: r.corroborated,
        alreadyYours: r.alreadyYours,
        dropped: r.dropped,
        estimatedWrites: r.estimatedWrites,
        message: `${sum(r.new)} new row${sum(r.new) === 1 ? '' : 's'} shared · ${sum(r.duplicates)} already known${sum(r.corroborated) ? ` (${sum(r.corroborated)} now corroborated by you)` : ''}${dropped ? ` · ${dropped} dropped as implausible` : ''}`,
      },
      200,
      { 'Cache-Control': 'no-store' },
    );
  } catch (e) {
    if (e instanceof Rejected) return err(e.status, e.code, e.message);
    return err(500, 'contribute_failed', 'The community database could not take this contribution. Your local import is unaffected.');
  }
};
