/** Pure history helpers shared by the edge (functions/_lib/history.ts) and the browser (imported-snapshot mode in Tab 3). */
import type { AuctionBid, PlayerSeries, SeriesPoint } from '../src/types/market';
import { median, playerKey } from './formulas';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Aggregate bids into hourly points, keyed by hour start. Idempotent: it only reads the feed. */
export function bidsToHourly(bids: AuctionBid[]): Map<string, { meta: Omit<PlayerSeries, 'key' | 'points'>; points: Map<number, SeriesPoint> }> {
  const out = new Map<string, { meta: Omit<PlayerSeries, 'key' | 'points'>; points: Map<number, SeriesPoint> }>();
  const groups = new Map<string, AuctionBid[]>();
  for (const b of bids) {
    if (!(b.cardRating > 0) || !(b.highestBidRax > 0)) continue;
    const k = `${playerKey(b.sport, b.playerName)}@${Math.floor(Date.parse(b.timestamp) / HOUR)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  for (const [k, g] of groups) {
    const [pk, hourIdx] = k.split('@');
    const sorted = [...g].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const prices = sorted.map((b) => b.highestBidRax);
    const t = Number(hourIdx) * HOUR;
    const pt: SeriesPoint = {
      t,
      volume: g.length,
      avgBid: prices.reduce((a, b) => a + b, 0) / prices.length,
      medPrp: median(g.map((b) => b.perRatingPrice)),
      open: prices[0],
      high: Math.max(...prices),
      low: Math.min(...prices),
      close: prices[prices.length - 1],
    };
    if (!out.has(pk)) {
      const f = sorted[0];
      out.set(pk, { meta: { playerName: f.playerName, sport: f.sport, rating: f.cardRating, rarity: f.rarity }, points: new Map() });
    }
    out.get(pk)!.points.set(t, pt);
  }
  return out;
}

/** Collapse hourly points older than 7 days into one point per UTC day; drop anything older than 30 days. */
export function rollup(points: SeriesPoint[], now: number): SeriesPoint[] {
  const cutHourly = now - 7 * DAY;
  const cutDrop = now - 30 * DAY;
  const recent = points.filter((p) => p.t > cutHourly);
  const days = new Map<number, SeriesPoint[]>();
  for (const p of points) {
    if (p.t > cutHourly || p.t <= cutDrop) continue;
    const d = Math.floor(p.t / DAY);
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(p);
  }
  const daily = [...days.values()].map((g) => {
    g.sort((a, b) => a.t - b.t);
    const vol = g.reduce((a, b) => a + b.volume, 0);
    return {
      t: g[g.length - 1].t,
      volume: vol,
      avgBid: vol > 0 ? g.reduce((a, b) => a + b.avgBid * b.volume, 0) / vol : g[g.length - 1].avgBid,
      medPrp: median(g.map((x) => x.medPrp)),
      open: g[0].open,
      high: Math.max(...g.map((x) => x.high)),
      low: Math.min(...g.map((x) => x.low)),
      close: g[g.length - 1].close,
    };
  });
  return [...daily, ...recent].sort((a, b) => a.t - b.t);
}


/** Hourly/daily series per player from a bag of bids (used for an imported snapshot, entirely in the browser). */
export function bidsToSeries(bids: AuctionBid[], now: number): PlayerSeries[] {
  return [...bidsToHourly(bids)].map(([key, { meta, points }]) => ({ key, ...meta, points: rollup([...points.values()], now) }));
}
