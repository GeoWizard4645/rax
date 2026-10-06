/**
 * Rolling market history in Workers KV — the only thing in this app that needs durable state.
 *
 * Why KV here and not for response caching: the free tier allows ~1,000 KV writes/day, so caching every
 * upstream response there would burn through it. Response caching uses the (free, unlimited) Cache API;
 * KV holds one small document, rewritten at most every 10 minutes (≤ 144 writes/day).
 *
 * Shape: per player, hourly points for the last 7 days then daily points out to 30 days.
 */
import type { AuctionBid, PlayerSeries, SeriesPoint } from '../../src/types/market';
import { median, playerKey } from '../../shared/formulas';
import type { Env } from './http';

const HIST_KEY = 'market:v1';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WRITE_EVERY_MS = 10 * 60_000;
const MAX_PLAYERS = 250;

export interface HistDoc {
  updatedAt: number;
  players: Record<string, Omit<PlayerSeries, 'key'>>;
}

export async function loadHistory(env: Env): Promise<HistDoc | null> {
  if (!env.CACHE) return null;
  try {
    return (await env.CACHE.get<HistDoc>(HIST_KEY, 'json')) ?? null;
  } catch {
    return null;
  }
}

export function docToSeries(doc: HistDoc): PlayerSeries[] {
  return Object.entries(doc.players).map(([key, p]) => ({ key, ...p }));
}

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

/** Upsert the live feed into the KV history doc (throttled). Returns the up-to-date doc. */
export async function recordSnapshot(env: Env, bids: AuctionBid[], now: number, prior: HistDoc | null): Promise<HistDoc> {
  const doc: HistDoc = prior ?? { updatedAt: 0, players: {} };
  const hourly = bidsToHourly(bids);
  for (const [pk, { meta, points }] of hourly) {
    const existing = doc.players[pk] ?? { ...meta, points: [] };
    const byT = new Map(existing.points.map((p) => [p.t, p]));
    for (const [t, p] of points) byT.set(t, p); // rebuilt from the feed, so replace — never add
    doc.players[pk] = { ...meta, points: rollup([...byT.values()], now) };
  }
  // Keep the busiest players only (bounds the document size).
  const keys = Object.keys(doc.players);
  if (keys.length > MAX_PLAYERS) {
    const vol = (k: string) => doc.players[k].points.reduce((a, p) => a + p.volume, 0);
    for (const k of keys.sort((a, b) => vol(b) - vol(a)).slice(MAX_PLAYERS)) delete doc.players[k];
  }
  if (env.CACHE && now - doc.updatedAt >= WRITE_EVERY_MS) {
    doc.updatedAt = now;
    try {
      await env.CACHE.put(HIST_KEY, JSON.stringify(doc), { expirationTtl: 60 * 60 * 24 * 40 });
    } catch {
      /* KV write quota or transient failure — serving continues from memory */
    }
  }
  return doc;
}
