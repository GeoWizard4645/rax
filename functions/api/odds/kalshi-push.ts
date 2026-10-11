/**
 * POST /api/odds/kalshi-push?sport=NFL   (Authorization: Bearer <KALSHI_PUSH_SECRET>, body = the snapshot JSON)
 *
 * Kalshi blocks Cloudflare's IPs, so a GitHub Actions loop (.github/workflows/odds-snapshot.yml) fetches it and pushes the
 * result here every ~40 s. Stored as one row per sport in D1 (free tier: 100k row writes/day) and read back by
 * /api/odds/events — fresher than raw.githubusercontent.com, whose CDN caches each file for 5 minutes.
 */
import { ODDS_SPORTS } from '../../../shared/odds';
import { err, json, type Env } from '../../_lib/http';

const MAX_BODY = 1_500_000; // the largest sport (NFL) is ~250 KB slimmed

/** Constant-time string compare (the secret must not leak through timing). */
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let d = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return d === 0;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== 'POST') return err(405, 'method_not_allowed', 'POST only.');
  const secret = env.KALSHI_PUSH_SECRET;
  if (!secret) return err(503, 'not_configured', 'KALSHI_PUSH_SECRET is not set on this deployment (set it as a Pages secret, then redeploy).');
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!given || !safeEqual(given, secret)) return err(401, 'unauthorized', 'Missing or wrong push secret.');
  if (!env.ODDS_DB) return err(503, 'no_db', 'ODDS_DB (D1) is not bound.');
  const sport = (new URL(request.url).searchParams.get('sport') ?? '').toUpperCase();
  if (!ODDS_SPORTS.includes(sport as never)) return err(400, 'bad_sport', `sport must be one of ${ODDS_SPORTS.join(', ')}.`);
  const text = await request.text();
  if (!text || text.length > MAX_BODY) return err(413, 'bad_size', `Body must be 1..${MAX_BODY} bytes.`);
  let generatedAt = '';
  try {
    const snap = JSON.parse(text) as { generatedAt?: unknown; sport?: unknown; payloads?: unknown };
    generatedAt = typeof snap.generatedAt === 'string' ? snap.generatedAt : '';
    if (!Number.isFinite(Date.parse(generatedAt)) || snap.sport !== sport || !Array.isArray(snap.payloads)) throw new Error('shape');
  } catch {
    return err(400, 'bad_snapshot', 'Body must be {generatedAt, sport, payloads[]} for the given sport.');
  }
  // Never let an out-of-order push overwrite a newer snapshot.
  await env.ODDS_DB.prepare(
    `INSERT INTO kalshi_snapshot (sport, generated_at, body) VALUES (?1, ?2, ?3)
     ON CONFLICT(sport) DO UPDATE SET generated_at = excluded.generated_at, body = excluded.body WHERE excluded.generated_at >= kalshi_snapshot.generated_at`,
  ).bind(sport, generatedAt, text).run();
  return json({ ok: true, sport, generatedAt, bytes: text.length }, 200, { 'Cache-Control': 'no-store' });
};
