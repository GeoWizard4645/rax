/**
 * Community market — read  —  GET /api/market/community?kind=summary|sales|auctions|stats&sport=&since=&minReports=&limit=
 *
 * Public, CORS-open, cached ~60 s per normalised query in the Cache API (so D1 sees roughly one read per query per minute per
 * data centre, whatever the traffic). Every row carries `reports`, the number of distinct contributors who reported it;
 * `minReports=2` is the "verified" view. The summary never scans a table: it reads counters kept by the write path.
 */
import { cached, err, json, preflight, type Env } from '../../_lib/http';
import { readAuctions, readSales, readStats, readSummary } from '../../_lib/marketRead';

const KINDS = ['summary', 'sales', 'auctions', 'stats'] as const;
type Kind = (typeof KINDS)[number];
const DEFAULT_LIMIT: Record<Exclude<Kind, 'summary'>, number> = { sales: 2000, auctions: 1500, stats: 1000 };
const MAX_LIMIT: Record<Exclude<Kind, 'summary'>, number> = { sales: 5000, auctions: 3000, stats: 3000 };
const HOUR = 3_600_000;

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET' && request.method !== 'HEAD') return err(405, 'method_not_allowed', 'GET only.');
  const db = env.MARKET_DB;
  if (!db) return err(503, 'no_db', 'The community database (MARKET_DB) is not bound on this deployment.');
  const u = new URL(request.url);
  const kind = (u.searchParams.get('kind') ?? 'summary') as Kind;
  if (!KINDS.includes(kind)) return err(400, 'bad_kind', `kind must be one of ${KINDS.join(', ')}.`);
  const now = Date.now();
  const sport = (u.searchParams.get('sport') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
  const minReports = Math.min(10, Math.max(1, Math.floor(Number(u.searchParams.get('minReports')) || 1)));
  const sinceRaw = u.searchParams.get('since');
  const sinceN = sinceRaw == null ? NaN : /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : Date.parse(sinceRaw);
  // `since` is rounded DOWN to the hour: a client asking for "the last 7 days" every second shares one cache entry.
  const since = Math.floor((Number.isFinite(sinceN) ? Math.max(0, sinceN) : 0) / HOUR) * HOUR;
  const limit = kind === 'summary' ? 0 : Math.min(MAX_LIMIT[kind], Math.max(1, Math.floor(Number(u.searchParams.get('limit')) || DEFAULT_LIMIT[kind])));
  const key = `market/community/${kind}/${sport}/${since}/${minReports}/${limit}`;

  return cached(
    key,
    60,
    async () => {
      try {
        const body = kind === 'summary' ? await readSummary(db, now) : kind === 'sales' ? await readSales(db, { sport, since, minReports, limit }) : kind === 'auctions' ? await readAuctions(db, { sport, since, minReports, limit }) : await readStats(db, { sport, since, minReports, limit });
        return json({ kind, generatedAt: new Date(now).toISOString(), ...body }, 200, { 'Cache-Control': 'public, max-age=60' });
      } catch {
        return err(500, 'read_failed', 'The community database could not be read.');
      }
    },
    (p) => waitUntil(p),
  );
};
