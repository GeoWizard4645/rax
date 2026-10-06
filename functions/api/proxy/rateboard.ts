/**
 * Rateboard pass-through proxy  —  /api/proxy/rateboard?path=<api path>&...
 *
 * Tab 1 is a wrapper around https://rateboard-cgi.pages.dev. Rateboard's JSON API sends no
 * CORS headers, so browsers can't call it directly; this function makes the *same request*
 * server-side and relays the answer. Rateboard owns the data, the accounts and the rules —
 * nothing is stored here.
 *
 * What is deliberately NOT proxied (see README "Rateboard wrapper"):
 *   - whole-board overwrites (`POST /api/kv {key,value}`) — a data-loss footgun
 *   - admin operations (removing other people's offers, resetting passwords, data reports)
 *   - /api/scan (their paid screenshot reader), /api/rax (their access-gated game data)
 * and what is stripped from the board before it reaches the browser: every account's
 * password hash, the private `reports` list and the `gamedata` grant list.
 */
import { cached, err, json, OUR_UA, preflight, purge, type Env } from '../../_lib/http';
import {
  RB_BOARD_KEY,
  RB_ORIGIN,
  RB_SPORTS,
  sanitizeBoard,
  validCommentLink,
  type RbSport,
} from '../../../shared/rateboard';

const UPSTREAM_HOST = 'rateboard-cgi.pages.dev';
const BOARD_CACHE_KEY = 'rateboard/board';
const BOARD_TTL = 15;

const CREDIT_HEADERS = {
  'X-Data-Source': UPSTREAM_HOST,
  'X-Credit': 'Rateboard - https://rateboard-cgi.pages.dev',
};

/* ------------------------------ upstream ------------------------------ */

async function upstream(path: string, init: RequestInit = {}, qs = ''): Promise<Response> {
  const url = `${RB_ORIGIN}/${path}${qs}`;
  return fetch(url, {
    ...init,
    headers: { Accept: 'application/json', 'User-Agent': OUR_UA, ...(init.headers || {}) },
  });
}

/** Re-wrap an upstream response with our CORS + credit headers. */
function relay(res: Response, extra: Record<string, string> = {}): Response {
  const h = new Headers(CREDIT_HEADERS);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Content-Type', res.headers.get('content-type') || 'application/json');
  const xc = res.headers.get('x-cache');
  if (xc) h.set('x-upstream-cache', xc);
  for (const [k, v] of Object.entries(extra)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

/* ------------------------------ validation ------------------------------ */

const isSport = (s: unknown): s is RbSport => typeof s === 'string' && s in RB_SPORTS;
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_RE = /^[sf]:[0-9a-f]{16,64}$/;
const USERNAME_RE = /^[^\s/?#&\\\u0000-\u001f]{1,64}$/u;

/** Validate a write body against the exact shapes Rateboard's own client sends. */
export function validateWrite(body: any): { ok: true; body: Record<string, unknown> } | { ok: false; message: string } {
  if (!body || typeof body !== 'object') return { ok: false, message: 'Body must be a JSON object.' };
  const bad = (message: string) => ({ ok: false as const, message });
  switch (body.op) {
    case 'signup': {
      const { key, name, hash } = body;
      if (typeof name !== 'string' || name.trim().length < 2 || name.length > 40) return bad('Invalid username.');
      if (typeof key !== 'string' || key !== name.trim().toLowerCase()) return bad('Key must be the lowercase username.');
      if (typeof hash !== 'string' || !HASH_RE.test(hash)) return bad('Invalid password hash.');
      return { ok: true, body: { op: 'signup', key, name: name.trim(), hash } };
    }
    case 'setPass': {
      const { key, hash } = body;
      if (typeof key !== 'string' || key.length < 2 || key.length > 40) return bad('Invalid username.');
      if (typeof hash !== 'string' || !HASH_RE.test(hash)) return bad('Invalid password hash.');
      return { ok: true, body: { op: 'setPass', key, hash } };
    }
    case 'addOffer': {
      const o = body.offer;
      if (!o || typeof o !== 'object') return bad('Missing offer.');
      if (typeof o.id !== 'string' || !SAFE_ID.test(o.id)) return bad('Invalid offer id.');
      if (typeof o.user !== 'string' || o.user.length < 2 || o.user.length > 40) return bad('Invalid user.');
      if (!isSport(o.sport)) return bad('Invalid sport.');
      if (typeof o.player !== 'string' || o.player.trim().length < 2 || o.player.length > 80) return bad('Invalid player.');
      if (!Number.isInteger(o.rate) || o.rate < 1 || o.rate > 9999) return bad('Rate must be a whole number from 1 to 9999.');
      if (!validCommentLink(o.link) || o.link.length > 300) return bad('Invalid comment link.');
      return { ok: true, body: { op: 'addOffer', offer: { id: o.id, user: o.user, sport: o.sport, player: o.player.trim(), rate: o.rate, link: o.link } } };
    }
    case 'updateOffer': {
      const { id, user, rate, link } = body;
      if (typeof id !== 'string' || !SAFE_ID.test(id)) return bad('Invalid offer id.');
      if (typeof user !== 'string' || user.length < 2 || user.length > 40) return bad('Invalid user.');
      if (!Number.isInteger(rate) || rate < 1 || rate > 9999) return bad('Rate must be a whole number from 1 to 9999.');
      if (!validCommentLink(link) || link.length > 300) return bad('Invalid comment link.');
      return { ok: true, body: { op: 'updateOffer', id, user, rate, link } };
    }
    case 'removeOffer': {
      const { id, user } = body;
      if (typeof id !== 'string' || !SAFE_ID.test(id)) return bad('Invalid offer id.');
      // `user` is required: a removeOffer without it is Rateboard's admin delete, which we never relay.
      if (typeof user !== 'string' || user.length < 2 || user.length > 40) return bad('Invalid user.');
      return { ok: true, body: { op: 'removeOffer', id, user } };
    }
    default:
      return bad(`Operation "${String(body.op)}" is not available through this app.`);
  }
}

/* ------------------------------ GET ------------------------------ */

async function handleGet(path: string, params: URLSearchParams, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  switch (path) {
    case 'api/kv': {
      if (params.get('key') !== RB_BOARD_KEY) return err(403, 'key_not_allowed', 'Only the public offer board can be read.');
      const fresh = params.get('fresh') === '1';
      const produce = async () => {
        const res = await upstream('api/kv', {}, `?key=${encodeURIComponent(RB_BOARD_KEY)}`);
        if (!res.ok) return err(502, 'upstream_error', `Rateboard answered ${res.status}.`, { upstreamStatus: res.status });
        let board;
        try {
          board = sanitizeBoard(await res.json());
        } catch {
          return err(502, 'upstream_bad_payload', 'Rateboard returned something unreadable.');
        }
        return json({ board, fetchedAt: new Date().toISOString(), source: UPSTREAM_HOST }, 200, CREDIT_HEADERS);
      };
      if (fresh) {
        await purge(BOARD_CACHE_KEY);
        return produce();
      }
      return cached(BOARD_CACHE_KEY, BOARD_TTL, produce, waitUntil);
    }

    case 'api/players': {
      const sport = params.get('sport');
      const q = (params.get('q') || '').slice(0, 60);
      if (!isSport(sport)) return err(400, 'bad_sport', 'Unknown sport.');
      if (q.length < 2) return json({ players: [] }, 200, CREDIT_HEADERS);
      const qs = `?sport=${encodeURIComponent(sport)}&q=${encodeURIComponent(q)}`;
      return cached(`rateboard/players/${sport}/${q.toLowerCase()}`, 60, async () => relay(await upstream('api/players', {}, qs)), waitUntil);
    }

    case 'api/collection': {
      const username = params.get('username') || '';
      const sport = params.get('sport');
      const start = params.get('start') || '0';
      const hashId = params.get('hashId');
      if (!USERNAME_RE.test(username)) return err(400, 'bad_username', 'Invalid username.');
      if (!isSport(sport)) return err(400, 'bad_sport', 'Unknown sport.');
      if (!/^\d{1,6}$/.test(start)) return err(400, 'bad_start', 'Invalid start.');
      if (hashId && !SAFE_ID.test(hashId)) return err(400, 'bad_hash', 'Invalid hashId.');
      const qs = `?username=${encodeURIComponent(username)}&sport=${encodeURIComponent(sport)}&start=${start}` + (hashId ? `&hashId=${encodeURIComponent(hashId)}` : '');
      // Rateboard already caches collections for 2h and tells us (x-cache) — the UI relies on that header.
      return relay(await upstream('api/collection', {}, qs));
    }

    case 'api/ufc':
      return cached('rateboard/ufc', 60, async () => relay(await upstream('api/ufc')), waitUntil);

    default:
      return err(403, 'path_not_allowed', `"${path}" is not available through this app.`);
  }
}

/* ------------------------------ POST ------------------------------ */

type RawBoard = { users?: Record<string, { name?: string; hash?: string; banned?: boolean }> };

/**
 * Sign-in check. Rateboard verifies passwords in the browser against hashes it publishes, so we
 * can't hand the hashes to the browser (we strip them). Instead the browser sends its computed
 * hash here and we compare server-side against Rateboard's own record. The raw board is never cached.
 */
async function handleLogin(body: any): Promise<Response> {
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const hash = body?.hash;
  if (username.length < 2 || username.length > 40) return err(400, 'bad_username', 'Enter your username.');
  if (typeof hash !== 'string' || !HASH_RE.test(hash)) return err(400, 'bad_hash', 'Invalid password hash.');

  const res = await upstream('api/kv', {}, `?key=${encodeURIComponent(RB_BOARD_KEY)}`);
  if (!res.ok) return err(502, 'upstream_error', `Rateboard answered ${res.status}.`);
  let raw: RawBoard;
  try {
    const d: any = await res.json();
    raw = typeof d?.value === 'string' ? JSON.parse(d.value) : d?.value ?? {};
  } catch {
    return err(502, 'upstream_bad_payload', 'Rateboard returned something unreadable.');
  }
  const key = username.toLowerCase();
  const existing = raw.users?.[key];
  let status: 'ok' | 'new' | 'wrong' | 'banned' | 'reset';
  if (!existing) status = 'new';
  else if (existing.banned) status = 'banned';
  else if (!existing.hash) status = 'reset';
  else status = existing.hash === hash ? 'ok' : 'wrong';
  return json({ status, key, name: existing?.name ?? username }, 200, { ...CREDIT_HEADERS, 'Cache-Control': 'no-store' });
}

async function handlePost(path: string, request: Request): Promise<Response> {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return err(400, 'bad_json', 'Body must be JSON.');
  }
  if (path === '_login') return handleLogin(body);
  if (path !== 'api/kv') return err(403, 'path_not_allowed', `"${path}" is not available through this app.`);

  const v = validateWrite(body);
  if (!v.ok) return err(400, 'rejected', v.message);

  const res = await upstream('api/kv', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(v.body),
  });
  if (res.ok) await purge(BOARD_CACHE_KEY);
  return relay(res, { 'Cache-Control': 'no-store' });
}

/* ------------------------------ entry ------------------------------ */

export const onRequest: PagesFunction<Env> = async ({ request, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  const url = new URL(request.url);
  const path = (url.searchParams.get('path') || '').replace(/^\/+/, '');
  if (!path) return err(400, 'missing_path', 'Pass ?path=api/... (see /api/proxy/rateboard docs in README).');
  const w = (p: Promise<unknown>) => waitUntil(p);
  try {
    if (request.method === 'GET') return await handleGet(path, url.searchParams, w);
    if (request.method === 'POST') return await handlePost(path, request);
    return err(405, 'method_not_allowed', 'GET or POST only.');
  } catch (e) {
    return err(502, 'upstream_unreachable', `Could not reach Rateboard: ${(e as Error).message}`);
  }
};
