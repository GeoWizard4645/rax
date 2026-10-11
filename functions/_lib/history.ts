/**
 * Rolling market history in Workers KV — the only thing in this app that needs durable state.
 *
 * Why KV here and not for response caching: the free tier allows ~1,000 KV writes/day, so caching every
 * upstream response there would burn through it. Response caching uses the (free, unlimited) Cache API;
 * KV holds one small document, rewritten at most every 10 minutes (≤ 144 writes/day).
 *
 * Shape: per player, hourly points for the last 7 days then daily points out to 30 days.
 */
import type { AuctionBid, PlayerSeries } from '../../src/types/market';
import { bidsToHourly, rollup } from '../../shared/historyCore';
export { bidsToHourly, rollup };
import type { Env } from './http';

const HIST_KEY = 'market:v1';
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
