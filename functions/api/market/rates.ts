/**
 * Rateboard bid-rate recorder  —  GET /api/market/rates
 *
 * Samples Rateboard's public board (standing BUY offers, Rax per rating point), appends it to the rolling history in
 * Workers KV (throttled, see functions/_lib/rbRates.ts) and returns the recorder's status plus 7-day baselines per
 * player (only once ≥ 3 days of history exist). A GitHub Actions cron pings this every ~10 minutes so history
 * accumulates even when nobody is on the site; Tabs 2–3 call it too.
 *
 * This is demand-side data (what buyers offer), NOT Real sale prices — see docs/MARKET-DATA-SOURCES.md.
 */
import { coverage, rateBaselines } from '../../../shared/rbHistory';
import { cached, err, json, preflight, type Env } from '../../_lib/http';
import { ensureSample } from '../../_lib/rbRates';

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET' && request.method !== 'HEAD') return err(405, 'method_not_allowed', 'GET only.');
  const origin = new URL(request.url).origin;
  // The Cache API wrapper makes this a no-op for repeat calls inside 60 s; a miss does the sampling.
  return cached(
    'market/rates',
    60,
    async () => {
      const now = Date.now();
      const r = await ensureSample(env, { now, origin, waitUntil: (p) => waitUntil(p) });
      const cov = coverage(r.doc, r.persisted);
      const last = r.doc?.board[r.doc.board.length - 1];
      return json({
        source: 'rateboard',
        unit: 'rate',
        generatedAt: new Date(now).toISOString(),
        coverage: cov,
        sampled: r.sampled,
        wroteKv: r.wrote,
        skipped: r.skipped ?? null,
        board: last ? { offers: last[1], buyers: last[2], players: last[3] } : null,
        baselines: rateBaselines(r.doc, now),
        note: cov.ready
          ? 'Bid rates recorded from Rateboard’s public board — standing buy offers (Rax per rating point), not Real sale prices.'
          : 'Still recording: baselines, spikes, candles and forecasts unlock after 3 days of history.',
      });
    },
    (p) => waitUntil(p),
  );
};
