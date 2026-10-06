/**
 * General upstream proxy  —  /api/proxy/real?endpoint=v1/users/<name>/profile
 *
 * NOTE: Real's own API (web.realapp.com) requires a logged-in session, a per-request signed token and a Turnstile
 * token, so it cannot be reached by an anonymous proxy — see docs/DATA-SOURCES.md. This proxy is only useful for an
 * upstream you are *authorised* to call (e.g. a partner API from Real, or a Rateboard-style service). It sends an
 * honest User-Agent and never forges app tokens.
 *
 * Browsers can't call such endpoints cross-origin, so requests go through here.
 * The upstream base URL is NOT hard-coded: set REAL_API_BASE (Pages env var). Until it's set this
 * returns 503 `upstream_not_configured` and the UI falls back to labelled sample data.
 *
 * Safety: only `GET`, only paths under `v1/`, no traversal, https upstream only.
 * Caching: Cloudflare's Cache API (free, no write quota) — 60 s for live games, 300 s otherwise.
 */
import { cached, err, json, OUR_UA, preflight, type Env } from '../../_lib/http';

const ENDPOINT_RE = /^v1\/[A-Za-z0-9_\-./]{1,200}$/;

export const ttlFor = (endpoint: string) => (/\b(live|games?\/live|scoreboard)\b/.test(endpoint) ? 60 : 300);

export function validEndpoint(endpoint: string): boolean {
  return ENDPOINT_RE.test(endpoint) && !endpoint.includes('..') && !endpoint.includes('//');
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');

  const url = new URL(request.url);
  const endpoint = (url.searchParams.get('endpoint') || '').replace(/^\/+/, '');
  if (!validEndpoint(endpoint)) return err(400, 'bad_endpoint', 'endpoint must look like v1/users/<name>/profile.');

  const base = env.REAL_API_BASE?.replace(/\/+$/, '');
  if (!base || !/^https:\/\//.test(base)) {
    return err(503, 'upstream_not_configured', 'Set REAL_API_BASE (https URL of the Real API) in the Pages environment to enable live data.');
  }

  const fwd = new URLSearchParams(url.searchParams);
  fwd.delete('endpoint');
  const qs = fwd.toString();
  const target = `${base}/${endpoint}${qs ? `?${qs}` : ''}`;
  const ttl = ttlFor(endpoint);

  try {
    return await cached(
      `real/${endpoint}?${qs}`,
      ttl,
      async () => {
        const res = await fetch(target, {
          headers: { 'User-Agent': env.REAL_USER_AGENT || OUR_UA, Accept: 'application/json' },
        });
        if (!res.ok) return err(res.status === 404 ? 404 : 502, 'upstream_error', `Upstream answered ${res.status}.`, { upstreamStatus: res.status });
        let data: unknown;
        try {
          data = await res.json();
        } catch {
          return err(502, 'upstream_not_json', 'Upstream did not return JSON.');
        }
        return json(data, 200);
      },
      (p) => waitUntil(p),
    );
  } catch (e) {
    return err(502, 'upstream_unreachable', `Could not reach upstream: ${(e as Error).message}`);
  }
};
