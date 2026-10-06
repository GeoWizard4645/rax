/** Per-rating baselines for imported snapshots: the player's own history if we have it, else similar cards in the snapshot. */
import type { AuctionBid } from '../src/types/market';
import { median, playerKey } from './formulas';

const DAY = 86_400_000;
export interface HistEntry {
  t: number;
  /** playerKey → median per-rating price in that snapshot */
  med: Record<string, number>;
}
export type BaselineKind = 'history' | 'peers';

export function snapshotMedians(bids: AuctionBid[]): Record<string, number> {
  const g = new Map<string, number[]>();
  for (const b of bids) {
    const k = playerKey(b.sport, b.playerName);
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(b.perRatingPrice);
  }
  return Object.fromEntries([...g].map(([k, v]) => [k, median(v)]));
}

/** Drop entries older than 14 days. */
export const pruneHistory = (h: HistEntry[], now: number) => h.filter((e) => e.t > now - 14 * DAY).slice(-400);

export function computeBaselines(bids: AuctionBid[], history: HistEntry[], now: number): { baselines: Record<string, number>; kinds: Record<string, BaselineKind> } {
  const recent = history.filter((e) => e.t > now - 7 * DAY && e.t < now - 60_000); // prior snapshots only
  const baselines: Record<string, number> = {};
  const kinds: Record<string, BaselineKind> = {};
  const peerGroups = new Map<string, number[]>();
  for (const b of bids) {
    const pk = `${b.sport}:${b.rarity}`;
    if (!peerGroups.has(pk)) peerGroups.set(pk, []);
    peerGroups.get(pk)!.push(b.perRatingPrice);
  }
  for (const b of bids) {
    const k = playerKey(b.sport, b.playerName);
    if (k in baselines) continue;
    const own = recent.map((e) => e.med[k]).filter((x): x is number => typeof x === 'number');
    if (own.length) {
      baselines[k] = median(own);
      kinds[k] = 'history';
      continue;
    }
    const peers = peerGroups.get(`${b.sport}:${b.rarity}`) ?? [];
    if (peers.length >= 4) {
      baselines[k] = median(peers);
      kinds[k] = 'peers';
    }
  }
  return { baselines, kinds };
}
