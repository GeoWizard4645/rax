/**
 * Market intelligence  —  /api/market/spikes[?sport=NFL]            spike screener + fair-value model
 *                         /api/market/spikes?candles=<playerKey>&window=24h|7d|30d   OHLC + volume
 *                         /api/market/spikes?forecastInputs=<playerKey>   inputs for the browser-side Monte Carlo (Tab 3)
 *
 * Computed at the edge from the KV history written by /api/scout/auctions (live), or from the
 * deterministic SAMPLE series when no history exists yet (source: "sample").
 */
import type { CandlesResponse, PlayerSeries, SpikesResponse } from '../../../src/types/market';
import type { Sport } from '../../../src/types/real';
import { buildCandles, fairValue, SPORTS, type CandleWindow } from '../../../shared/formulas';
import { coverage, currentState, docToSeries, summarizeRates } from '../../../shared/rbHistory';
import { buildForecastInputs, summarizeMarket } from '../../../shared/market';
import { sampleCatalysts, sampleSeries } from '../../../shared/sample';
import { cached, err, json, preflight, type Env } from '../../_lib/http';
import { docToSeries as legacyDocToSeries, loadHistory } from '../../_lib/history';
import { ensureSample } from '../../_lib/rbRates';

const WINDOWS: CandleWindow[] = ['24h', '7d', '30d'];

async function seriesFor(env: Env, now: number, forceSample = false): Promise<{ series: PlayerSeries[]; source: 'live' | 'sample' }> {
  if (forceSample) return { series: sampleSeries(now), source: 'sample' };
  const doc = await loadHistory(env);
  const live = doc ? legacyDocToSeries(doc).filter((s) => s.points.length >= 24) : [];
  // Need a few players with real history before the statistics mean anything.
  if (live.length >= 5) return { series: live, source: 'live' };
  return { series: sampleSeries(now), source: 'sample' };
}

/** Rateboard-derived bid-rate series (Rax per rating point) — see shared/rbHistory.ts. Not sale prices. */
async function rateboardRoute(
  env: Env,
  params: URLSearchParams,
  origin: string,
  waitUntil: (p: Promise<unknown>) => void,
): Promise<Response> {
  const sport = params.get('sport')?.toUpperCase();
  const candleKey = params.get('candles');
  const inputsKey = params.get('forecastInputs');
  const win = (params.get('window') || '7d') as CandleWindow;
  if (candleKey && !WINDOWS.includes(win)) return err(400, 'bad_window', 'window must be 24h, 7d or 30d.');
  const ck = `market/rb/${inputsKey ? `fi/${inputsKey}` : candleKey ? `c/${candleKey}/${win}` : `s/${sport ?? 'all'}`}`;
  return cached(ck, 60, async () => {
    const now = Date.now();
    const r = await ensureSample(env, { now, origin, waitUntil });
    const cov = coverage(r.doc, r.persisted);
    if (!r.doc || !cov.samples) return err(503, 'no_rate_history', 'No Rateboard bid-rate history yet — the board could not be read.');
    if (inputsKey || candleKey) {
      const series = docToSeries(r.doc, now);
      if (inputsKey) {
        const inp = buildForecastInputs(series, inputsKey, now, [], 'rateboard');
        return inp ? json({ ...inp, unit: 'rate', coverage: cov }) : err(404, 'unknown_player', 'No recorded bid-rate history for that player yet.');
      }
      const s = series.find((x) => x.key === candleKey);
      const ph = r.doc.players[candleKey!];
      if (!s || !ph) return err(404, 'unknown_player', 'No recorded bid-rate history for that player yet.');
      const cur = currentState(ph);
      const body: CandlesResponse = {
        source: 'rateboard',
        unit: 'rate',
        coverage: cov,
        key: s.key,
        window: win,
        candles: buildCandles(s, now, win),
        changes: ph.pts.slice(-60),
        current: cur ? { best: cur[1], median: cur[2], buyers: cur[3], offers: cur[4], house: cur[5] } : null,
      };
      return json(body);
    }
    const body = summarizeRates(r.doc, now, r.persisted);
    if (sport) {
      body.spikes = body.spikes.filter((x) => x.sport === sport);
      body.players = body.players.filter((x) => x.sport === sport);
      const keep = new Set(body.players.map((x) => x.key));
      const fv = fairValue(body.fair.filter((x) => keep.has(x.key)));
      body.fair = fv.points;
      body.model = { slope: fv.regression.slope, intercept: fv.regression.intercept, r2: fv.regression.r2, n: fv.regression.n };
    }
    return json(body);
  }, waitUntil);
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');

  const url = new URL(request.url);
  const params = url.searchParams;
  if (params.get('source') === 'rateboard') {
    // Rateboard sports are CFB, FC, NFL, UFC, NHL — validate against those, not the card-feed list.
    const sp = params.get('sport')?.toUpperCase();
    if (sp && !['CFB', 'FC', 'NFL', 'UFC', 'NHL'].includes(sp)) return err(400, 'bad_sport', 'Unknown sport.');
    return rateboardRoute(env, params, url.origin, (p) => waitUntil(p));
  }
  const candleKey = params.get('candles');
  const sport = params.get('sport')?.toUpperCase();
  if (sport && !SPORTS.includes(sport as Sport)) return err(400, 'bad_sport', 'Unknown sport.');

  // ?source=sample pins the demo data; without it the legacy behaviour applies (real auction history if a feed is configured).
  const sampleOnly = params.get('source') === 'sample';
  const sk = sampleOnly ? 'sample/' : '';
  const inputsKey = params.get('forecastInputs');
  if (inputsKey) {
    return cached(`market/${sk}forecast-inputs/${inputsKey}`, 60, async () => {
      const now = Date.now();
      const { series, source } = await seriesFor(env, now, sampleOnly);
      const inp = buildForecastInputs(series, inputsKey, now, source === 'sample' ? (sampleCatalysts(now)[inputsKey] ?? []) : [], source);
      return inp ? json(inp) : err(404, 'unknown_player', 'No market history for that player.');
    }, (p) => waitUntil(p));
  }

  if (candleKey) {
    const win = (params.get('window') || '7d') as CandleWindow;
    if (!WINDOWS.includes(win)) return err(400, 'bad_window', 'window must be 24h, 7d or 30d.');
    return cached(`market/${sk}candles/${candleKey}/${win}`, 60, async () => {
      const now = Date.now();
      const { series, source } = await seriesFor(env, now, sampleOnly);
      const s = series.find((x) => x.key === candleKey);
      if (!s) return err(404, 'unknown_player', 'No market history for that player.');
      const body: CandlesResponse = { source, key: s.key, window: win, candles: buildCandles(s, now, win) };
      return json(body);
    }, (p) => waitUntil(p));
  }

  return cached(`market/${sk}spikes/${sport ?? 'all'}`, 60, async () => {
    const now = Date.now();
    const { series, source } = await seriesFor(env, now, sampleOnly);
    const scoped = sport ? series.filter((s) => s.sport === sport) : series;
    const body: SpikesResponse = summarizeMarket(scoped, now, source === 'sample' ? sampleCatalysts(now) : {}, source);
    body.note =
      source === 'sample'
        ? 'No live market history yet — showing sample data.'
        : 'Catalyst tags need schedule / injury / streak feeds, which are not connected for live data.';
    return json(body);
  }, (p) => waitUntil(p));
};
