/**
 * The community market database as Tab 2–3 data: `useCommunityMarket()` for the tabs (summary, settings, a full RealMarketState)
 * and `useCommunityStore()` for the spike/candle/forecast hooks (just the store). Both are views of one shared fetch
 * (src/lib/communityStore.ts); with no community database, or nothing in it, every field says so and nothing else changes.
 */
import { useEffect, useMemo } from 'react';
import { combineStores, communityCounts, communityLabel, communityToStore, type CommunitySummary } from '../../shared/communityMarket';
import { hasAnyData, type RealStore } from '../../shared/realMarket';
import { buildMarketState, useRealStore, type RealMarketState } from '../lib/realMarketStore';
import { getCombine, getVerifiedOnly, refreshData, refreshSummary, setCombine, setVerifiedOnly, useCommunityState, type CommunityStatus } from '../lib/communityStore';

/* one memoised store shared by every hook instance, so the radar / derived series are computed once */
let memo: { data: unknown; summary: unknown; min: number; local: RealStore; both: boolean; out: RealStore } | null = null;
function effectiveStore(data: Parameters<typeof communityToStore>[0], summary: CommunitySummary | null, min: number, local: RealStore, combine: boolean): { store: RealStore; both: boolean } {
  const both = combine && hasAnyData(local);
  if (memo && memo.data === data && memo.summary === summary && memo.min === min && memo.both === both && (!both || memo.local === local)) return { store: memo.out, both };
  const c = communityToStore(data, summary, min);
  const out = both ? combineStores(local, c) : c;
  memo = { data, summary, min, local, both, out };
  return { store: out, both };
}

/** Just the store for the current settings (community alone, or combined with the user's own capture). */
export function useCommunityStore(): { store: RealStore; now: number } {
  const cs = useCommunityState();
  const local = useRealStore();
  const min = getVerifiedOnly() ? 2 : 1;
  const { store } = effectiveStore(cs.data, cs.summary, min, local.store, getCombine());
  return { store, now: local.now };
}

export interface CommunityMarket {
  status: CommunityStatus;
  summary: CommunitySummary | null;
  /** The server has a community database and it holds rows. */
  available: boolean;
  /** Rows that pass the verified filter, from the summary alone. */
  counts: { sales: number; auctions: number; stats: number; total: number };
  /** Tab 2 default: there are (verified) community auctions. Tab 3 default: there are (verified) sales or market stats. */
  hasAuctions: boolean;
  hasHistory: boolean;
  verifiedOnly: boolean;
  setVerifiedOnly: (v: boolean) => void;
  combine: boolean;
  setCombine: (v: boolean) => void;
  /** Community rows are being merged with the user's own capture right now. */
  combined: boolean;
  /** The user has a local capture (so the combine option is meaningful). */
  hasLocal: boolean;
  /** Rows the verified filter is hiding. */
  hidden: number;
  loading: boolean;
  truncated: boolean;
  label: string;
  /** Same shape as useRealMarket(), over the community (or combined) store — pass it to RealAuctions / RealPanels. */
  state: RealMarketState;
  reload: () => void;
  /** Fetch the rows (the summary is always fetched). Call when the Community source becomes the selected one. */
  loadRows: () => Promise<void>;
}

const noop = () => ({ ok: false, message: 'Community data is read-only here.' });

/** `load` fetches the rows (not just the one-line summary) — pass true while the Community source is selected. */
export function useCommunityMarket({ load = false }: { load?: boolean } = {}): CommunityMarket {
  const cs = useCommunityState();
  const local = useRealStore();
  useEffect(() => {
    void refreshSummary();
  }, []);
  useEffect(() => {
    if (load) void refreshData();
  }, [load]);
  const verifiedOnly = getVerifiedOnly();
  const combine = getCombine();
  const min = verifiedOnly ? 2 : 1;
  const { store, both } = effectiveStore(cs.data, cs.summary, min, local.store, combine);
  const label = communityLabel(cs.summary, local.now, both);
  const state = useMemo(() => buildMarketState(store, local.now, label, { importText: noop, clear: () => {} }), [store, local.now, label]);
  const counts = communityCounts(cs.summary, verifiedOnly);
  const all = communityCounts(cs.summary, false);
  return {
    status: cs.status,
    summary: cs.summary,
    available: cs.status === 'ready' && all.total > 0,
    counts,
    hasAuctions: counts.auctions > 0,
    hasHistory: counts.sales + counts.stats > 0,
    verifiedOnly,
    setVerifiedOnly,
    combine,
    setCombine,
    combined: both,
    hasLocal: hasAnyData(local.store),
    hidden: Math.max(0, all.total - counts.total),
    loading: cs.dataLoading,
    truncated: !!cs.data?.truncated,
    label,
    state,
    reload: () => {
      void refreshSummary(true);
      void refreshData(true);
    },
    loadRows: refreshData,
  };
}
