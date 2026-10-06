import { computeBaselines, pruneHistory, snapshotMedians, type BaselineKind, type HistEntry } from '../../shared/baselines';
import { deriveContenders } from '../../shared/auctions';
import type { AuctionBid, AuctionsResponse } from '../types/market';
import { load, remove, save } from './storage';

const SNAP = 'rax_scout_snapshot_v1';
const HIST = 'rax_scout_hist_v1';

export interface Snapshot {
  t: number;
  bids: AuctionBid[];
}

export const loadSnapshot = (): Snapshot | null => {
  const s = load<Snapshot | null>(SNAP, null);
  return s && Array.isArray(s.bids) && s.bids.length ? s : null;
};

export function saveSnapshot(bids: AuctionBid[], now = Date.now()): Snapshot {
  const snap = { t: now, bids };
  save(SNAP, snap);
  save(HIST, pruneHistory([...load<HistEntry[]>(HIST, []), { t: now, med: snapshotMedians(bids) }], now));
  return snap;
}

export function clearSnapshot() {
  remove(SNAP); // history is kept so baselines keep improving across imports
}

/** Build the same response shape the edge endpoint returns, from a locally stored snapshot. */
export function snapshotToResponse(snap: Snapshot): AuctionsResponse & { baselineKinds: Record<string, BaselineKind> } {
  const { baselines, kinds } = computeBaselines(snap.bids, load<HistEntry[]>(HIST, []), snap.t);
  return {
    source: 'imported',
    generatedAt: new Date(snap.t).toISOString(),
    bids: snap.bids,
    baselines,
    contenders: deriveContenders(snap.bids, snap.t),
    baselineKinds: kinds,
    note: 'Imported snapshot — premiums use your own earlier imports where available, otherwise similar cards in the same snapshot.',
  };
}
