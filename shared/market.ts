/** Assembles the Tab 3 summary (spikes + fair-value model) from per-player series. Used live and for sample data. */
import type { CatalystTag, DataSource, ForecastInputs, PlayerSeries, SpikeRow, SpikesResponse } from '../src/types/market';
import { buildCandles, detectSpike, fairValue, median, medianPrice, stdev } from './formulas';

export function summarizeMarket(
  series: PlayerSeries[],
  now: number,
  catalysts: Record<string, CatalystTag[]>,
  source: DataSource,
): SpikesResponse {
  const spikes: SpikeRow[] = [];
  const priced: Array<{ key: string; playerName: string; sport: PlayerSeries['sport']; rating: number; medianPrice: number }> = [];
  for (const s of series) {
    const sp = detectSpike(s, now, catalysts[s.key] ?? []);
    if (sp) spikes.push(sp);
    const mp = medianPrice(s, now);
    if (mp > 0) priced.push({ key: s.key, playerName: s.playerName, sport: s.sport, rating: s.rating, medianPrice: mp });
  }
  spikes.sort((a, b) => b.z - a.z);
  const fv = fairValue(priced);
  return {
    source,
    generatedAt: new Date(now).toISOString(),
    spikes,
    fair: fv.points,
    model: { slope: fv.regression.slope, intercept: fv.regression.intercept, r2: fv.regression.r2, n: fv.regression.n },
    players: series.map((s) => ({ key: s.key, playerName: s.playerName, sport: s.sport, rating: s.rating, rarity: s.rarity })),
  };
}

/** Daily per-rating closes for one player (30 days, oldest first). */
function dailyPpr(s: PlayerSeries, now: number) {
  return buildCandles(s, now, '30d')
    .filter((c) => c.close > 0)
    .map((c) => ({ t: c.t, ppr: c.close / s.rating, volume: c.volume }));
}

/**
 * Inputs for the browser-side Monte Carlo: the player's own daily history plus statistics of similar cards
 * (same sport + rarity if there are at least 4 of them, else same rarity, else everyone).
 */
export function buildForecastInputs(
  all: PlayerSeries[],
  key: string,
  now: number,
  catalysts: CatalystTag[],
  source: DataSource,
): ForecastInputs | null {
  const me = all.find((s) => s.key === key);
  if (!me) return null;
  const daily = dailyPpr(me, now);
  if (!daily.length) return null;

  const others = all.filter((s) => s.key !== key);
  let scope: ForecastInputs['peers']['scope'] = 'sport+rarity';
  let peers = others.filter((s) => s.sport === me.sport && s.rarity === me.rarity);
  if (peers.length < 4) (scope = 'rarity'), (peers = others.filter((s) => s.rarity === me.rarity));
  if (peers.length < 4) (scope = 'all'), (peers = others);
  if (!peers.length) scope = 'none';

  const returns: number[] = [];
  const medians: number[] = [];
  const vols: number[] = [];
  for (const p of peers) {
    const d = dailyPpr(p, now);
    for (let i = 1; i < d.length; i++) returns.push(Math.log(d[i].ppr / d[i - 1].ppr));
    if (d.length) {
      medians.push(median(d.map((x) => x.ppr)));
      vols.push(median(d.slice(-14).map((x) => x.volume)));
    }
  }
  const clipped = returns.map((r) => Math.max(-0.5, Math.min(0.5, r)));
  const spike = detectSpike(me, now, catalysts);

  return {
    source,
    key: me.key,
    playerName: me.playerName,
    sport: me.sport,
    rarity: me.rarity,
    rating: me.rating,
    currentPpr: me.points[me.points.length - 1].close / me.rating,
    daily,
    peers: { n: peers.length, scope, sdLogRet: stdev(clipped), medianPpr: median(medians), medianVolPerDay: median(vols) },
    catalysts,
    spikeZ: spike?.z ?? 0,
  };
}
