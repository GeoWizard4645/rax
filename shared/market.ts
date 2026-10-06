/** Assembles the Tab 3 summary (spikes + fair-value model) from per-player series. Used live and for sample data. */
import type { CatalystTag, PlayerSeries, SpikeRow, SpikesResponse, DataSource } from '../src/types/market';
import { detectSpike, fairValue, medianPrice } from './formulas';

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
