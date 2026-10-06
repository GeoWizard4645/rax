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
import { buildCandles, SPORTS, type CandleWindow } from '../../../shared/formulas';
import { buildForecastInputs, summarizeMarket } from '../../../shared/market';
import { sampleCatalysts, sampleSeries } from '../../../shared/sample';
import { cached, err, json, preflight, type Env } from '../../_lib/http';
import { docToSeries, loadHistory } from '../../_lib/history';

const WINDOWS: CandleWindow[] = ['24h', '7d', '30d'];

async function seriesFor(env: Env, now: number): Promise<{ series: PlayerSeries[]; source: 'live' | 'sample' }> {
  const doc = await loadHistory(env);
  const live = doc ? docToSeries(doc).filter((s) => s.points.length >= 24) : [];
  // Need a few players with real history before the statistics mean anything.
  if (live.length >= 5) return { series: live, source: 'live' };
  return { series: sampleSeries(now), source: 'sample' };
}

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');

  const params = new URL(request.url).searchParams;
  const candleKey = params.get('candles');
  const sport = params.get('sport')?.toUpperCase();
  if (sport && !SPORTS.includes(sport as Sport)) return err(400, 'bad_sport', 'Unknown sport.');

  const inputsKey = params.get('forecastInputs');
  if (inputsKey) {
    return cached(`market/forecast-inputs/${inputsKey}`, 60, async () => {
      const now = Date.now();
      const { series, source } = await seriesFor(env, now);
      const inp = buildForecastInputs(series, inputsKey, now, source === 'sample' ? (sampleCatalysts(now)[inputsKey] ?? []) : [], source);
      return inp ? json(inp) : err(404, 'unknown_player', 'No market history for that player.');
    }, (p) => waitUntil(p));
  }

  if (candleKey) {
    const win = (params.get('window') || '7d') as CandleWindow;
    if (!WINDOWS.includes(win)) return err(400, 'bad_window', 'window must be 24h, 7d or 30d.');
    return cached(`market/candles/${candleKey}/${win}`, 60, async () => {
      const now = Date.now();
      const { series, source } = await seriesFor(env, now);
      const s = series.find((x) => x.key === candleKey);
      if (!s) return err(404, 'unknown_player', 'No market history for that player.');
      const body: CandlesResponse = { source, key: s.key, window: win, candles: buildCandles(s, now, win) };
      return json(body);
    }, (p) => waitUntil(p));
  }

  return cached(`market/spikes/${sport ?? 'all'}`, 60, async () => {
    const now = Date.now();
    const { series, source } = await seriesFor(env, now);
    const scoped = sport ? series.filter((s) => s.sport === sport) : series;
    const body: SpikesResponse = summarizeMarket(scoped, now, source === 'sample' ? sampleCatalysts(now) : {}, source);
    body.note =
      source === 'sample'
        ? 'No live market history yet — showing sample data.'
        : 'Catalyst tags need schedule / injury / streak feeds, which are not connected for live data.';
    return json(body);
  }, (p) => waitUntil(p));
};
