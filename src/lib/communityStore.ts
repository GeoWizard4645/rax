/**
 * Browser side of the community market database (docs/COMMUNITY-MARKET.md): the user's settings, their anonymous contributor id,
 * fetching (summary always, rows only when the Community source is in use) and the opt-in upload.
 *
 * Nothing here runs unless the server has a community database: every failure degrades to "no community data" so the app behaves
 * exactly as it did before. Uploading happens ONLY when the user ticked the share box, and only for an import they just made.
 */
import { useSyncExternalStore } from 'react';
import type { RealMarketCapture } from '../../shared/realMarketCapture';
import type { CommunityAuction, CommunityData, CommunitySale, CommunityStat, CommunitySummary } from '../../shared/communityMarket';

export const SHARE_KEY = 'rax_community_share_v1';
export const VERIFIED_KEY = 'rax_community_verified_v1';
export const COMBINE_KEY = 'rax_community_combine_v1';
export const ID_KEY = 'rax_community_id_v1';
const FRESH_MS = 60_000;
const DAY = 86_400_000;

/* ---------------------------------- settings ---------------------------------- */

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const browserStorage = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
const readBool = (key: string, dflt: boolean, st: Store | null = browserStorage()): boolean => {
  try {
    const v = st?.getItem(key);
    return v == null ? dflt : v === '1';
  } catch {
    return dflt;
  }
};
const writeBool = (key: string, v: boolean, st: Store | null = browserStorage()) => {
  try {
    st?.setItem(key, v ? '1' : '0');
  } catch {
    /* private mode: the choice just doesn't persist */
  }
  notify();
};

/** Sharing is OFF unless the user turned it on. */
export const getShare = (st?: Store | null) => readBool(SHARE_KEY, false, st);
export const setShare = (v: boolean) => writeBool(SHARE_KEY, v);
/** Verified-only (≥ 2 distinct reporters) is ON by default: it is what the premium and spike calculations should rest on. */
export const getVerifiedOnly = (st?: Store | null) => readBool(VERIFIED_KEY, true, st);
export const setVerifiedOnly = (v: boolean) => writeBool(VERIFIED_KEY, v);
/** Combine community + local capture (de-duplicated) is ON by default. */
export const getCombine = (st?: Store | null) => readBool(COMBINE_KEY, true, st);
export const setCombine = (v: boolean) => writeBool(COMBINE_KEY, v);

/** A random 128-bit id, made once and kept in this browser. The server only ever stores a salted hash of it. */
export function contributorId(st: Store | null = browserStorage()): string {
  try {
    const have = st?.getItem(ID_KEY);
    if (have && /^[A-Za-z0-9_-]{16,64}$/.test(have)) return have;
  } catch {
    /* fall through to a fresh id */
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  const id = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  try {
    st?.setItem(ID_KEY, id);
  } catch {
    /* an id that can't be saved just means this contribution isn't linkable to the next — harmless */
  }
  return id;
}

/* ------------------------------- shared fetch state ------------------------------- */

export type CommunityStatus = 'idle' | 'loading' | 'ready' | 'unavailable';
export interface CommunityState {
  status: CommunityStatus;
  summary: CommunitySummary | null;
  summaryAt: number;
  data: CommunityData | null;
  dataLoading: boolean;
  /** Bumped on every change so useSyncExternalStore sees a new snapshot. */
  rev: number;
}
let state: CommunityState = { status: 'idle', summary: null, summaryAt: 0, data: null, dataLoading: false, rev: 0 };
const listeners = new Set<() => void>();
function set(patch: Partial<CommunityState>) {
  state = { ...state, ...patch, rev: state.rev + 1 };
  listeners.forEach((l) => l());
}
function notify() {
  state = { ...state, rev: state.rev + 1 };
  listeners.forEach((l) => l());
}
export const getCommunityState = () => state;
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  const onStorage = () => cb();
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(cb);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};
/** The live fetch state (summary + rows). Settings are re-read from storage by the hook on every change. */
export const useCommunityState = (): CommunityState => useSyncExternalStore(subscribe, getCommunityState, getCommunityState);

let summaryInflight: Promise<void> | null = null;
let dataInflight: Promise<void> | null = null;

async function getJsonQuiet<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

/** Fetch the one-line summary (cached 60 s server-side and here). A missing/failed endpoint is "unavailable", never an error. */
export function refreshSummary(force = false): Promise<void> {
  if (summaryInflight) return summaryInflight;
  if (!force && state.summary && Date.now() - state.summaryAt < FRESH_MS) return Promise.resolve();
  if (state.status === 'idle') set({ status: 'loading' });
  summaryInflight = (async () => {
    const s = await getJsonQuiet<CommunitySummary & { kind: string }>('/api/market/community?kind=summary');
    set(s && s.rows ? { status: 'ready', summary: s, summaryAt: Date.now() } : { status: state.summary ? 'ready' : 'unavailable' });
  })().finally(() => {
    summaryInflight = null;
  });
  return summaryInflight;
}

/** Fetch the rows (all reports; the verified filter is applied client-side so toggling it is instant). Only when the source is in use. */
export function refreshData(force = false): Promise<void> {
  if (dataInflight) return dataInflight;
  if (!force && state.data && Date.now() - state.data.fetchedAt < FRESH_MS) return Promise.resolve();
  set({ dataLoading: true });
  dataInflight = (async () => {
    const since = new Date(Date.now() - 120 * DAY).toISOString();
    const q = (kind: string) => `/api/market/community?kind=${kind}&since=${encodeURIComponent(since)}`;
    const [sales, auctions, stats] = await Promise.all([
      getJsonQuiet<{ rows: CommunitySale[]; truncated: boolean }>(q('sales')),
      getJsonQuiet<{ rows: CommunityAuction[]; truncated: boolean }>(q('auctions')),
      getJsonQuiet<{ rows: CommunityStat[]; truncated: boolean }>(q('stats')),
    ]);
    if (!sales && !auctions && !stats) {
      set({ dataLoading: false });
      return;
    }
    set({ dataLoading: false, data: { sales: sales?.rows ?? [], auctions: auctions?.rows ?? [], stats: stats?.rows ?? [], truncated: !!(sales?.truncated || auctions?.truncated || stats?.truncated), fetchedAt: Date.now() } });
  })().finally(() => {
    dataInflight = null;
  });
  return dataInflight;
}

/* ---------------------------------- uploading ---------------------------------- */

export interface ShareResult {
  ok: boolean;
  /** One sentence for the UI: "20 new rows shared · 0 already known". */
  message: string;
  counts?: { new: number; known: number; dropped: number };
}

/** POST a capture the user has just imported. Never throws: a failure is a message, and the local import is already safe. */
export async function shareCapture(capture: RealMarketCapture): Promise<ShareResult> {
  try {
    const r = await fetch('/api/market/contribute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capture, contributor: contributorId() }) });
    const b = await r.json().catch(() => null);
    if (!r.ok || !b?.ok) return { ok: false, message: `Not shared — ${typeof b?.message === 'string' ? b.message : `the community database answered ${r.status}`}` };
    const sum = (c: Record<string, number> | undefined) => (c ? (c.auctions ?? 0) + (c.sales ?? 0) + (c.stats ?? 0) : 0);
    void refreshSummary(true);
    return { ok: true, message: String(b.message), counts: { new: sum(b.new), known: sum(b.duplicates), dropped: sum(b.dropped) } };
  } catch {
    return { ok: false, message: 'Not shared — could not reach the community database (your local import is unaffected).' };
  }
}

/** Forget cached rows (tests). */
export function resetCommunityState() {
  state = { status: 'idle', summary: null, summaryAt: 0, data: null, dataLoading: false, rev: 0 };
  summaryInflight = null;
  dataInflight = null;
}
