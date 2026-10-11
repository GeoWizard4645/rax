/**
 * Browser-side store for the Real marketplace data the user recorded from their own Real session
 * (shared/realMarketCapture.ts → shared/realMarket.ts). Captures ACCUMULATE here across imports in this browser's
 * localStorage — never uploaded. Same pattern as raxedgeStore.ts: a module store, a change event, and a hook.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseRealCapture } from '../../shared/realMarketCapture';
import {
  DEFAULT_CAPS,
  STORAGE_BUDGET_CHARS,
  addPrune,
  coverageOf,
  coverageText,
  deriveRealSeries,
  describePrune,
  emptyStore,
  fitToBudget,
  hasAnyData,
  mergeCapture,
  noPrune,
  packStore,
  pruneStore,
  pruned,
  radarItems,
  sourceLabel,
  unpackStore,
  type MergeReport,
  type PruneReport,
  type RadarItem,
  type RealCoverage,
  type RealDerived,
  type RealStore,
} from '../../shared/realMarket';

export const REAL_MARKET_KEY = 'rax_real_market_v1';
const EVT = 'rax-real-market-change';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStorage = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/* parsed copy of what is in storage, reused while the raw string is unchanged so React sees a stable object */
let memo: { raw: string | null; store: RealStore } | null = null;

export function loadRealMarket(storage: Store | null = browserStorage()): RealStore {
  let raw: string | null = null;
  try {
    raw = storage ? storage.getItem(REAL_MARKET_KEY) : null;
  } catch {
    raw = null;
  }
  if (memo && memo.raw === raw && storage === browserStorage()) return memo.store;
  const store = unpackStore(raw);
  if (storage === browserStorage()) memo = { raw, store };
  return store;
}

export interface SaveResult {
  ok: boolean;
  store: RealStore;
  pruned: PruneReport;
}

/** Prune to the caps, shrink to the storage budget, write. Retries smaller if the browser refuses (quota). */
export function saveRealMarket(next: RealStore, now: number, storage: Store | null = browserStorage()): SaveResult {
  let { store, report } = pruneStore(next, now, DEFAULT_CAPS);
  let total = report;
  if (!storage) return { ok: false, store, pruned: total };
  let budget = STORAGE_BUDGET_CHARS;
  for (let attempt = 0; attempt < 8; attempt++) {
    const fit = fitToBudget(store, budget, now);
    store = fit.store;
    total = addPrune(total, fit.report);
    try {
      storage.setItem(REAL_MARKET_KEY, packStore(store));
      memo = null;
      if (typeof window !== 'undefined' && storage === browserStorage()) window.dispatchEvent(new Event(EVT));
      return { ok: true, store, pruned: total };
    } catch {
      budget = Math.floor(Math.min(budget, fit.chars) * 0.6); // the browser refused: ask for less and try again
    }
  }
  return { ok: false, store, pruned: total };
}

export function clearRealMarket(storage: Store | null = browserStorage()) {
  try {
    storage?.removeItem(REAL_MARKET_KEY);
  } catch {
    /* ignore */
  }
  memo = null;
  if (typeof window !== 'undefined' && storage === browserStorage()) window.dispatchEvent(new Event(EVT));
}

export interface ImportResult {
  ok: boolean;
  message: string;
  merge?: MergeReport;
  pruned?: PruneReport;
  /** Rows the capture contained that were malformed and skipped. */
  dropped?: number;
}

const n = (x: number, w: string) => `${x.toLocaleString('en-US')} ${w}${x === 1 ? '' : 's'}`;

/** Parse a pasted capture, merge it into what is stored, save. Never throws. */
export function importRealCapture(text: string, storage: Store | null = browserStorage(), now = Date.now()): ImportResult {
  const parsed = parseRealCapture(text);
  if (!parsed.capture) return { ok: false, message: parsed.errors[0] ?? 'That is not a Real market capture.' };
  const cap = parsed.capture;
  if (!cap.auctions.length && !cap.sales.length && !cap.stats.length) return { ok: false, message: 'The capture was empty — browse the Marketplace (and open "Market data" on a card) with the recorder running, then export again.', dropped: parsed.dropped };
  const { store: merged, report } = mergeCapture(loadRealMarket(storage), cap, now);
  const saved = saveRealMarket(merged, now, storage);
  if (!saved.ok) return { ok: false, message: 'Your browser refused to store this (storage is full). Nothing was changed — clear some site data or use Clear below, then import again.', merge: report, dropped: parsed.dropped };
  const bits = [
    `${n(cap.auctions.length, 'auction')} (${report.auctionsNew} new, ${report.auctionsUpdated} with a new bid/timer point)`,
    `${n(cap.sales.length, 'sale')} (${report.salesNew} new)`,
    `${n(cap.stats.length, 'market-data view')} (${report.statsNew} new, ${report.statsReplaced} refreshed)`,
  ];
  const cov = coverageOf(saved.store, now);
  const lost = pruned(saved.pruned) ? ` ${describePrune(saved.pruned)}` : '';
  const bad = parsed.dropped ? ` ${n(parsed.dropped, 'malformed row')} skipped.` : '';
  return { ok: true, message: `Imported ${bits.join('; ')}. Stored now: ${coverageText(cov)}.${bad}${lost}`, merge: report, pruned: saved.pruned, dropped: parsed.dropped };
}

/* ------------------------------ derived, cached per store ------------------------------ */

const derivedCache = new WeakMap<RealStore, RealDerived>();
export function derivedOf(store: RealStore): RealDerived {
  let d = derivedCache.get(store);
  if (!d) derivedCache.set(store, (d = deriveRealSeries(store)));
  return d;
}

/** Just the stored data and a clock — for hooks that derive their own thing from it. */
export function useRealStore(): { store: RealStore; now: number } {
  const [store, setStore] = useState<RealStore>(() => loadRealMarket());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const on = () => setStore(loadRealMarket());
    window.addEventListener(EVT, on);
    window.addEventListener('storage', on);
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener('storage', on);
      window.clearInterval(id);
    };
  }, []);
  return { store, now };
}

export interface RealMarketState {
  store: RealStore;
  /** Clock that advances every 30 s so time-left and "captured N min ago" stay true. */
  now: number;
  hasData: boolean;
  coverage: RealCoverage;
  /** "412 sales over 3 days, 5 cards with market stats" */
  summary: string;
  /** "Real marketplace (captured by you, 3 h ago)" */
  label: string;
  /** Tab 2 default: there are captured auctions. Tab 3 default: there are captured sales or market stats. */
  hasAuctions: boolean;
  hasHistory: boolean;
  radar: RadarItem[];
  derived: RealDerived;
  importText: (text: string) => ImportResult;
  clear: () => void;
}

/** Live view of the captured Real marketplace data (re-renders on import/clear from any tab or another window). */
export function useRealMarket(): RealMarketState {
  const { store, now } = useRealStore();
  const coverage = useMemo(() => coverageOf(store, now), [store, now]);
  const radar = useMemo(() => radarItems(store, now), [store, now]);
  const derived = useMemo(() => derivedOf(store), [store]);
  const importText = useCallback((text: string) => importRealCapture(text), []);
  const clear = useCallback(() => clearRealMarket(), []);
  return {
    store,
    now,
    hasData: hasAnyData(store),
    coverage,
    summary: coverageText(coverage),
    label: sourceLabel(coverage, now),
    hasAuctions: store.auctions.length > 0,
    hasHistory: store.sales.length > 0 || store.stats.length > 0,
    radar,
    derived,
    importText,
    clear,
  };
}

export { emptyStore, noPrune };
