export interface Env {
  /** Rolling market history (hourly snapshots). Optional — without it, only sample data is served. */
  CACHE?: KVNamespace;
  /** Base URL of Real's API, e.g. https://api.example.com — required by /api/proxy/real. */
  REAL_API_BASE?: string;
  /** Overrides the User-Agent sent to the upstream. Defaults to an honest identifying UA. */
  REAL_USER_AGENT?: string;
  /** Path (relative to REAL_API_BASE) of the auctions feed; enables live data in /api/scout/auctions. */
  AUCTIONS_ENDPOINT?: string;
  /** Comma-separated hosts the CDN proxy may fetch from. Supports a leading "*." wildcard. */
  CDN_ALLOWED_HOSTS?: string;
}

/** Identifies this app honestly on requests to community sites. */
export const OUR_UA = 'rax-super-suite/0.1 (+https://rax.vivaanshahani.com)';

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

export const err = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json({ error: code, message, ...extra }, status, { 'Cache-Control': 'no-store' });

export const preflight = () => new Response(null, { status: 204, headers: CORS });

/* ---- Cache API (free, no write quota) ---- */

const cacheStore = (): Cache | null => {
  try {
    const c = (globalThis as unknown as { caches?: { default?: Cache } }).caches;
    return c?.default ?? null;
  } catch {
    return null;
  }
};

const cacheKey = (key: string) => new Request(`https://cache.rax.internal/${key}`);

/**
 * Return a cached JSON Response for `key`, or produce one with `produce`, cache it for
 * `ttlSec` (2xx only) and return it. Falls back to always producing if the Cache API is
 * unavailable (tests, local tooling).
 */
export async function cached(
  key: string,
  ttlSec: number,
  produce: () => Promise<Response>,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const store = cacheStore();
  if (store) {
    const hit = await store.match(cacheKey(key));
    if (hit) {
      const r = new Response(hit.body, hit);
      r.headers.set('x-cache', 'HIT');
      return r;
    }
  }
  const res = await produce();
  if (store && res.ok) {
    const copy = new Response(res.clone().body, res);
    copy.headers.set('Cache-Control', `public, max-age=${ttlSec}`);
    const put = store.put(cacheKey(key), copy);
    if (waitUntil) waitUntil(put);
    else await put;
  }
  const out = new Response(res.body, res);
  out.headers.set('x-cache', 'MISS');
  return out;
}

export async function purge(key: string): Promise<void> {
  const store = cacheStore();
  if (store) await store.delete(cacheKey(key));
}
