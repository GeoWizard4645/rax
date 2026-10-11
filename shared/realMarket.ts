/**
 * Real marketplace data the user captured from their OWN signed-in Real session (see shared/realMarketCapture.ts) —
 * pure helpers: merging many captures into one store, pruning it to fit browser storage, telling live auctions from
 * stale ones, choosing a REAL reference price for an auction, and turning captured sales into Tab 3 history.
 *
 * What is real here: every auction row (player, card, current bid, bid count, watchers, time left), every sale
 * (price, timestamp) and every "Market data" summary (median, per-rating median, total sales, quartiles) was read off
 * Real's own screen by the user. What is NOT here, and is never invented: who the bidders are (cards don't show them),
 * sales the user never opened, price-history chart values (they are not in the page text), the meaning of Real's
 * "Premium ×" (unverified), and anything about auctions the user did not scroll past.
 *
 * No React, no storage: the browser store (src/lib/realMarketStore.ts) wraps these, the tests exercise them directly.
 */
import type { CandlesResponse, CatalystTag, FairValuePoint, FairValueModel, ForecastInputs, PlayerSeries, SeriesPoint, SpikeRow, SpikesResponse } from '../src/types/market';
import { buildCandles, fairValue, median, mean, zScore } from './formulas';
import { MIN_FORECAST_DAYS } from './rbHistory';
import { saleKey, type RealAuctionRow, type RealMarketCapture, type RealMarketStat, type RealSale } from './realMarketCapture';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A reference price resting on fewer sales than this never produces a premium. */
export const MIN_REF_SALES = 5;
/** Storage guards. */
export const SALES_CAP = 20_000;
export const STATS_CAP = 2_000;
export const AUCTIONS_CAP = 3_000;
export const ENDED_KEEP_DAYS = 14;
export const STATS_KEEP_DAYS = 90;
export const HISTORY_CAP = 40;
/** localStorage holds ~5M characters; leave room for the other things the site stores. */
export const STORAGE_BUDGET_CHARS = 3_500_000;
/** A card/player series needs this many sales before it is listed or plotted. */
export const MIN_SERIES_SALES = 3;
export const MIN_POOL_SALES = 5;

/* --------------------------------- names --------------------------------- */

export const normName = (s: string) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** "Bijan Robinson" and "B. Robinson" → "b robinson"; "Marvin Harrison Jr." and "M. Harrison Jr." → "m harrison jr". */
export function abbrevKey(name: string): string {
  const t = normName(name).split(' ').filter(Boolean);
  if (!t.length) return '';
  let last = t[t.length - 1];
  if (SUFFIXES.has(last) && t.length >= 3) last = `${t[t.length - 2]} ${last}`;
  return `${t[0][0]} ${last}`;
}

const looksAbbreviated = (name: string) => /^[A-Za-z]\.?\s/.test(String(name ?? '').trim());

/** Same human? Full names must match exactly (after folding case/accents/punctuation); an abbreviated name matches on initial + surname. */
export function samePlayerName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return (looksAbbreviated(a) || looksAbbreviated(b)) && abbrevKey(a) === abbrevKey(b);
}

export const normRarity = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();
export const capWord = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
export const normType = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();
export function normSport(s: string | null | undefined): string {
  const u = String(s ?? '').trim().toUpperCase();
  return u === 'GOLF' ? 'PGA' : u || 'ALL';
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const validMs = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? t : null;
};

/* --------------------------------- store --------------------------------- */

export interface AuctionPoint {
  /** When the user's recorder saw this state (ISO). */
  at: string;
  bid: number;
  bids: number;
  watchers: number;
  timeLeftSec: number | null;
}

export interface StoredAuction {
  /** sport|serial|player|type|rating */
  key: string;
  sport: string;
  season: string | null;
  rarity: string;
  type: string;
  rating: number;
  play: string | null;
  player: string;
  team: string | null;
  serial: string;
  firstSeenAt: string;
  /** Times the same card was seen listed again after its timer had run out. */
  relists: number;
  /** Observations, oldest first. The last one is "the latest". */
  pts: AuctionPoint[];
}

export interface RealStoreMeta {
  imports: number;
  firstImportAt: string | null;
  lastImportAt: string | null;
  /** The newest `at` stamped on any capture imported (when the user pressed Export). */
  lastCaptureAt: string | null;
}

export interface RealStore {
  v: 1;
  auctions: StoredAuction[];
  stats: RealMarketStat[];
  sales: RealSale[];
  meta: RealStoreMeta;
}

export const emptyStore = (): RealStore => ({ v: 1, auctions: [], stats: [], sales: [], meta: { imports: 0, firstImportAt: null, lastImportAt: null, lastCaptureAt: null } });

export const hasAnyData = (s: RealStore) => s.auctions.length + s.stats.length + s.sales.length > 0;

export const auctionKey = (a: Pick<RealAuctionRow, 'sport' | 'serial' | 'player' | 'type' | 'rating'>) => `${normSport(a.sport)}|${a.serial}|${normName(a.player)}|${normType(a.type)}|${a.rating}`;
export const statKey = (s: Pick<RealMarketStat, 'name' | 'serial' | 'scope' | 'window' | 'seenAt'>) => `${normName(s.name)}|${s.serial}|${s.scope ?? ''}|${s.window ?? ''}|${String(s.seenAt).slice(0, 10)}`;
/** "Sold" is a sale. A capture whose filter could not be read (null) is assumed to be the default "Sold" view. Accepted / Open / No Sale are kept but never counted as a sale price. */
export const isSale = (s: Pick<RealSale, 'outcome'>) => s.outcome == null || s.outcome === 'Sold';
const saleTs = (s: RealSale) => validMs(s.at) ?? -Infinity;

/** The displayed timer ("4h", "5d") is coarse; this is how coarse, in seconds, judged from the value itself. */
export function timerGranularitySec(sec: number): number {
  if (sec >= 86_400 && sec % 86_400 === 0) return 86_400;
  if (sec >= 3_600 && sec % 3_600 === 0) return 3_600;
  if (sec >= 60 && sec % 60 === 0) return 60;
  return 1;
}

export type AuctionState = 'live' | 'closing' | 'ended' | 'unknown';
export interface AuctionStatus {
  state: AuctionState;
  /** seenAt + timeLeft of the latest sighting, ms. */
  endAt: number | null;
  /** Seconds until endAt (0 once passed); null when the timer is unknown. */
  secondsLeft: number | null;
}

/**
 * live: before the nominal end (latest sighting + the time left shown then).
 * closing: past it by less than one timer unit — the timer was rounded ("4h" can mean up to 4h59m), so it may still be going.
 * ended: past that too — the card has almost certainly been won or expired, so the bid is stale.
 */
export function auctionStatus(a: StoredAuction, now: number): AuctionStatus {
  const last = a.pts[a.pts.length - 1];
  const seen = validMs(last?.at);
  if (!last || seen == null || last.timeLeftSec == null) return { state: 'unknown', endAt: null, secondsLeft: null };
  const endAt = seen + last.timeLeftSec * 1000;
  if (now < endAt) return { state: 'live', endAt, secondsLeft: Math.round((endAt - now) / 1000) };
  const slack = timerGranularitySec(last.timeLeftSec) * 1000;
  return { state: now < endAt + slack ? 'closing' : 'ended', endAt, secondsLeft: 0 };
}

export interface MergeReport {
  auctionsNew: number;
  auctionsUpdated: number;
  auctionsUnchanged: number;
  bidPointsAdded: number;
  salesNew: number;
  salesDuplicate: number;
  statsNew: number;
  statsReplaced: number;
}

const sameState = (a: AuctionPoint, b: AuctionPoint) => a.bid === b.bid && a.bids === b.bids && a.watchers === b.watchers;

/** Keep the first and last sighting of a run of identical states, drop the ones in between; cap the length. */
function compactPoints(pts: AuctionPoint[]): AuctionPoint[] {
  const out: AuctionPoint[] = [];
  for (const p of pts) {
    const n = out.length;
    if (n >= 2 && sameState(out[n - 1], p) && sameState(out[n - 2], p)) out[n - 1] = p;
    else out.push(p);
  }
  while (out.length > HISTORY_CAP) out.splice(1, 1); // keep the first sighting and the newest ones
  return out;
}

/**
 * Fold one capture into the store. Auctions are keyed sport|serial|player|type|rating: the latest sighting wins and every
 * sighting that differs is kept as its own `seenAt` point (bid history). Sales are keyed by saleKey, stats by
 * name+serial+scope+window+day. Importing the same capture twice changes nothing.
 */
export function mergeCapture(store: RealStore, cap: RealMarketCapture, now = Date.now()): { store: RealStore; report: MergeReport } {
  const report: MergeReport = { auctionsNew: 0, auctionsUpdated: 0, auctionsUnchanged: 0, bidPointsAdded: 0, salesNew: 0, salesDuplicate: 0, statsNew: 0, statsReplaced: 0 };
  const capAt = validMs(cap.at) != null ? cap.at : new Date(now).toISOString();

  const amap = new Map<string, StoredAuction>(store.auctions.map((a) => [a.key, { ...a, pts: [...a.pts] }]));
  for (const r of cap.auctions) {
    const key = auctionKey(r);
    const pt: AuctionPoint = { at: validMs(r.seenAt) != null ? r.seenAt : capAt, bid: r.bid, bids: Number.isFinite(r.bids) ? r.bids : 0, watchers: Number.isFinite(r.watchers) ? r.watchers : 0, timeLeftSec: r.timeLeftSec ?? null };
    const ex = amap.get(key);
    if (!ex) {
      amap.set(key, { key, sport: normSport(r.sport), season: r.season ?? null, rarity: r.rarity, type: r.type, rating: r.rating, play: r.play ?? null, player: r.player, team: r.team ?? null, serial: r.serial, firstSeenAt: pt.at, relists: 0, pts: [pt] });
      report.auctionsNew++;
      report.bidPointsAdded++;
      continue;
    }
    if (ex.pts.some((p) => p.at === pt.at)) {
      report.auctionsUnchanged++;
      continue;
    }
    const last = ex.pts[ex.pts.length - 1];
    const lastEnd = validMs(last.at) != null && last.timeLeftSec != null ? validMs(last.at)! + (last.timeLeftSec + timerGranularitySec(last.timeLeftSec)) * 1000 : null;
    if (lastEnd != null && Date.parse(pt.at) > lastEnd && Date.parse(pt.at) > Date.parse(last.at)) {
      // The earlier listing had run out before this sighting: same card, listed again. Start its history afresh.
      ex.pts = [pt];
      ex.relists++;
      ex.firstSeenAt = pt.at;
    } else {
      ex.pts = compactPoints([...ex.pts, pt].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
      if (Date.parse(pt.at) < Date.parse(ex.firstSeenAt)) ex.firstSeenAt = pt.at;
    }
    if (Date.parse(pt.at) >= Date.parse(ex.pts[ex.pts.length - 1].at)) {
      ex.play = r.play ?? ex.play;
      ex.team = r.team ?? ex.team;
      ex.season = r.season ?? ex.season;
    }
    report.auctionsUpdated++;
    report.bidPointsAdded++;
  }

  const smap = new Map<string, RealSale>(store.sales.map((s) => [saleKey(s), s]));
  for (const s of cap.sales) {
    const k = saleKey(s);
    const ex = smap.get(k);
    if (!ex) {
      smap.set(k, { ...s });
      report.salesNew++;
    } else {
      report.salesDuplicate++;
      if (!isSale(ex) && isSale(s)) smap.set(k, { ...ex, outcome: s.outcome }); // a completed sale beats a listing that never closed
    }
  }

  const tmap = new Map<string, RealMarketStat>(store.stats.map((s) => [statKey(s), s]));
  for (const s of cap.stats) {
    const row = validMs(s.seenAt) != null ? s : { ...s, seenAt: capAt };
    const k = statKey(row);
    const ex = tmap.get(k);
    if (!ex) {
      tmap.set(k, { ...row });
      report.statsNew++;
    } else if (Date.parse(row.seenAt) >= Date.parse(ex.seenAt)) {
      tmap.set(k, { ...row });
      report.statsReplaced++;
    }
  }

  const nowIso = new Date(now).toISOString();
  const prevCap = validMs(store.meta.lastCaptureAt);
  const next: RealStore = {
    v: 1,
    auctions: [...amap.values()],
    stats: [...tmap.values()],
    sales: [...smap.values()].sort((a, b) => saleTs(b) - saleTs(a)),
    meta: {
      imports: store.meta.imports + 1,
      firstImportAt: store.meta.firstImportAt ?? nowIso,
      lastImportAt: nowIso,
      lastCaptureAt: prevCap != null && prevCap > Date.parse(capAt) ? store.meta.lastCaptureAt : capAt,
    },
  };
  return { store: next, report };
}

/* --------------------------------- pruning --------------------------------- */

export interface Caps {
  sales: number;
  stats: number;
  auctions: number;
  endedKeepDays: number;
  statsKeepDays: number;
}
export const DEFAULT_CAPS: Caps = { sales: SALES_CAP, stats: STATS_CAP, auctions: AUCTIONS_CAP, endedKeepDays: ENDED_KEEP_DAYS, statsKeepDays: STATS_KEEP_DAYS };

export interface PruneReport {
  /** Auctions that ended more than `endedKeepDays` ago (or whose last sighting is that old and had no timer). */
  auctionsEnded: number;
  auctionsOverCap: number;
  salesOverCap: number;
  statsOld: number;
  statsOverCap: number;
}
export const noPrune = (): PruneReport => ({ auctionsEnded: 0, auctionsOverCap: 0, salesOverCap: 0, statsOld: 0, statsOverCap: 0 });
export const pruned = (r: PruneReport) => r.auctionsEnded + r.auctionsOverCap + r.salesOverCap + r.statsOld + r.statsOverCap > 0;

const lastSeen = (a: StoredAuction) => validMs(a.pts[a.pts.length - 1]?.at) ?? 0;

export function pruneStore(store: RealStore, now: number, caps: Caps = DEFAULT_CAPS): { store: RealStore; report: PruneReport } {
  const report = noPrune();
  const keepAfter = now - caps.endedKeepDays * DAY;
  let auctions = store.auctions.filter((a) => {
    const st = auctionStatus(a, now);
    const gone = st.state === 'ended' ? (st.endAt ?? 0) < keepAfter : st.state === 'unknown' ? lastSeen(a) < keepAfter : false;
    if (gone) report.auctionsEnded++;
    return !gone;
  });
  if (auctions.length > caps.auctions) {
    // drop the ones that are over first (ended/closing/unknown), oldest sighting first, then the oldest of the rest
    const rank = (a: StoredAuction) => (auctionStatus(a, now).state === 'live' ? 1 : 0);
    const sorted = [...auctions].sort((a, b) => rank(a) - rank(b) || lastSeen(a) - lastSeen(b));
    const drop = new Set(sorted.slice(0, auctions.length - caps.auctions).map((a) => a.key));
    report.auctionsOverCap = drop.size;
    auctions = auctions.filter((a) => !drop.has(a.key));
  }
  let sales = store.sales;
  if (sales.length > caps.sales) {
    sales = [...sales].sort((a, b) => saleTs(b) - saleTs(a)).slice(0, caps.sales);
    report.salesOverCap = store.sales.length - sales.length;
  }
  let stats = store.stats.filter((s) => {
    const t = validMs(s.seenAt) ?? 0;
    const old = t < now - caps.statsKeepDays * DAY;
    if (old) report.statsOld++;
    return !old;
  });
  if (stats.length > caps.stats) {
    stats = [...stats].sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt)).slice(0, caps.stats);
    report.statsOverCap = store.stats.length - stats.length;
  }
  return { store: { ...store, auctions, sales, stats }, report };
}

export function describePrune(r: PruneReport, caps: Caps = DEFAULT_CAPS): string {
  const bits: string[] = [];
  if (r.salesOverCap) bits.push(`${r.salesOverCap.toLocaleString('en-US')} oldest sales (storage keeps the newest ${caps.sales.toLocaleString('en-US')})`);
  if (r.auctionsEnded) bits.push(`${r.auctionsEnded} auction${r.auctionsEnded === 1 ? '' : 's'} that ended more than ${caps.endedKeepDays} days ago`);
  if (r.auctionsOverCap) bits.push(`${r.auctionsOverCap} older auctions (cap ${caps.auctions.toLocaleString('en-US')})`);
  if (r.statsOld) bits.push(`${r.statsOld} market-data summaries older than ${caps.statsKeepDays} days`);
  if (r.statsOverCap) bits.push(`${r.statsOverCap} older market-data summaries (cap ${caps.stats.toLocaleString('en-US')})`);
  return bits.length ? `Dropped ${bits.join('; ')}.` : '';
}

/* --------------------------- compact serialisation --------------------------- */

type PackedSale = [string, number, string, string, number, number | null, number | null, string | null];
type PackedPoint = [number, number, number, number, number | null];
type PackedAuction = [string, string | null, string, string, number, string | null, string, string | null, string, string, number, PackedPoint[]];
interface Packed {
  v: 1;
  m: RealStoreMeta;
  a: PackedAuction[];
  t: RealMarketStat[];
  s: PackedSale[];
}

export function packStore(s: RealStore): string {
  const p: Packed = {
    v: 1,
    m: s.meta,
    a: s.auctions.map((a) => [a.sport, a.season, a.rarity, a.type, a.rating, a.play, a.player, a.team, a.serial, a.firstSeenAt, a.relists, a.pts.map((x): PackedPoint => [Date.parse(x.at), x.bid, x.bids, x.watchers, x.timeLeftSec])]),
    t: s.stats,
    s: s.sales.map((x): PackedSale => [x.player, x.rating, x.rarity, x.serial, x.price, x.perRating, validMs(x.at), x.outcome]),
  };
  return JSON.stringify(p);
}

export function unpackStore(text: string | null): RealStore {
  if (!text) return emptyStore();
  try {
    const p = JSON.parse(text) as Packed;
    if (!p || p.v !== 1 || !Array.isArray(p.a) || !Array.isArray(p.s)) return emptyStore();
    const auctions = p.a.map((r): StoredAuction => {
      const [sport, season, rarity, type, rating, play, player, team, serial, firstSeenAt, relists, pts] = r;
      return { key: auctionKey({ sport, serial, player, type, rating }), sport, season, rarity, type, rating, play, player, team, serial, firstSeenAt, relists, pts: pts.map(([t, bid, bids, watchers, tl]) => ({ at: new Date(t).toISOString(), bid, bids, watchers, timeLeftSec: tl })) };
    });
    const sales = p.s.map(([player, rating, rarity, serial, price, perRating, at, outcome]): RealSale => ({ player, rating, rarity, serial, price, perRating, at: at == null ? null : new Date(at).toISOString(), outcome }));
    return { v: 1, auctions, stats: Array.isArray(p.t) ? p.t : [], sales, meta: { ...emptyStore().meta, ...(p.m ?? {}) } };
  } catch {
    return emptyStore();
  }
}

/**
 * Shrink the store until its stored form fits `maxChars`: ended auctions first (oldest first), then the oldest sales,
 * then the oldest summaries, then anything else. Reports what went.
 */
export function fitToBudget(store: RealStore, maxChars: number, now: number): { store: RealStore; report: PruneReport; chars: number } {
  const report = noPrune();
  let s = store;
  let chars = packStore(s).length;
  for (let i = 0; i < 40 && chars > maxChars; i++) {
    const stale = s.auctions.filter((a) => auctionStatus(a, now).state !== 'live');
    if (stale.length) {
      const drop = new Set([...stale].sort((a, b) => lastSeen(a) - lastSeen(b)).slice(0, Math.max(1, Math.ceil(stale.length / 4))).map((a) => a.key));
      report.auctionsOverCap += drop.size;
      s = { ...s, auctions: s.auctions.filter((a) => !drop.has(a.key)) };
    } else if (s.sales.length > 0) {
      const keep = Math.floor(s.sales.length * 0.85);
      const sorted = [...s.sales].sort((a, b) => saleTs(b) - saleTs(a)).slice(0, keep);
      report.salesOverCap += s.sales.length - sorted.length;
      s = { ...s, sales: sorted };
    } else if (s.stats.length > 0) {
      const keep = Math.floor(s.stats.length * 0.75);
      report.statsOverCap += s.stats.length - keep;
      s = { ...s, stats: [...s.stats].sort((a, b) => Date.parse(b.seenAt) - Date.parse(a.seenAt)).slice(0, keep) };
    } else if (s.auctions.length > 0) {
      const keep = Math.floor(s.auctions.length * 0.75);
      report.auctionsOverCap += s.auctions.length - keep;
      s = { ...s, auctions: [...s.auctions].sort((a, b) => lastSeen(b) - lastSeen(a)).slice(0, keep) };
    } else break;
    chars = packStore(s).length;
  }
  return { store: s, report, chars };
}

export const addPrune = (a: PruneReport, b: PruneReport): PruneReport => ({
  auctionsEnded: a.auctionsEnded + b.auctionsEnded,
  auctionsOverCap: a.auctionsOverCap + b.auctionsOverCap,
  salesOverCap: a.salesOverCap + b.salesOverCap,
  statsOld: a.statsOld + b.statsOld,
  statsOverCap: a.statsOverCap + b.statsOverCap,
});

/* ------------------------------- coverage & age ------------------------------- */

export function ageLabel(ms: number | null | undefined, now = Date.now()): string {
  if (ms == null || !Number.isFinite(ms)) return 'unknown age';
  const m = Math.max(0, Math.round((now - ms) / 60_000));
  if (m < 1) return 'just now';
  if (m < 90) return `${m} min ago`;
  if (m < 2880) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

/** "5d 3h" / "4h 10m" / "35m" / "ended". */
export function timeLeftLabel(sec: number | null): string {
  if (sec == null) return '—';
  if (sec <= 0) return 'ended';
  if (sec < 3600) return `${Math.max(1, Math.round(sec / 60))}m`;
  if (sec < 86_400) {
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return m === 60 ? `${h + 1}h 0m` : `${h}h ${m}m`;
  }
  return `${Math.floor(sec / 86_400)}d ${Math.floor((sec % 86_400) / 3600)}h`;
}

export interface RealCoverage {
  sales: number;
  /** Sales that count as sale prices (outcome Sold / unread). */
  priceSales: number;
  /** Distinct UTC days that have at least one sale price. */
  salesDays: number;
  firstSaleAt: number | null;
  lastSaleAt: number | null;
  spanDays: number;
  stats: number;
  cardsWithStats: number;
  auctions: number;
  liveAuctions: number;
  lastCaptureAt: number | null;
  lastImportAt: number | null;
  imports: number;
}

const cardId = (name: string, rating: number, rarity: string) => `${abbrevKey(name)}|${rating}|${normRarity(rarity)}`;

export function coverageOf(store: RealStore, now: number): RealCoverage {
  const priced = store.sales.filter((s) => isSale(s) && saleTs(s) > -Infinity);
  const ts = priced.map(saleTs);
  const days = new Set(ts.map(utcDay));
  const first = ts.length ? Math.min(...ts) : null;
  const last = ts.length ? Math.max(...ts) : null;
  return {
    sales: store.sales.length,
    priceSales: store.sales.filter(isSale).length,
    salesDays: days.size,
    firstSaleAt: first,
    lastSaleAt: last,
    spanDays: first != null && last != null ? (last - first) / DAY : 0,
    stats: store.stats.length,
    cardsWithStats: new Set(store.stats.map((s) => cardId(s.name, s.rating, s.rarity))).size,
    auctions: store.auctions.length,
    liveAuctions: store.auctions.filter((a) => auctionStatus(a, now).state === 'live').length,
    lastCaptureAt: validMs(store.meta.lastCaptureAt),
    lastImportAt: validMs(store.meta.lastImportAt),
    imports: store.meta.imports,
  };
}

/** "412 sales over 3 days, 5 cards with market stats" */
export function coverageText(c: RealCoverage): string {
  const p = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;
  return `${p(c.sales, 'sale')} over ${p(c.salesDays, 'day')}, ${p(c.cardsWithStats, 'card')} with market stats`;
}

/** The exact provenance string shown on every Real-sourced number. */
export function sourceLabel(c: RealCoverage, now: number): string {
  return `Real marketplace (captured by you, ${ageLabel(c.lastCaptureAt ?? c.lastImportAt, now)})`;
}

/* --------------------------- reference prices (Tab 2) --------------------------- */

export type RefKind = 'card-stats' | 'player-stats' | 'sales-pool' | 'live-auctions' | 'sales-rarity';

export interface RefPrice {
  kind: RefKind;
  /** Reference price per rating point, Rax. */
  perRating: number;
  /** Sales (or, for live-auctions, live bids) the reference rests on. */
  n: number;
  /** n < MIN_REF_SALES → shown, but no premium is computed from it. */
  thin: boolean;
  /** Last resort: a coarse yardstick (rarity only). */
  weak: boolean;
  /** Short chip text. */
  short: string;
  /** One sentence for the tooltip: what it is and what backs it. */
  detail: string;
  /** When Real's own stat was read (ms), for stats references. */
  seenAt: number | null;
}

export const REF_SHORT: Record<RefKind, string> = { 'card-stats': 'this card', 'player-stats': 'player', 'sales-pool': 'sales pool', 'live-auctions': 'live bids', 'sales-rarity': 'rarity (weak)' };

export interface SaleObs {
  ts: number;
  price: number;
  rating: number;
  /** price ÷ rating, exact (Real shows it rounded). */
  ppr: number;
  player: string;
  rarity: string;
  serial: string;
  /** Resolved from the auctions you captured (null when the sale's player/rating/rarity matched none or several). */
  sport: string | null;
  type: string | null;
  cardKey: string;
}

/** initial+surname|rating|rarity → the single sport|type the captured auctions say that card is, if unambiguous. */
function saleIndex(store: RealStore): Map<string, { sport: string; type: string } | null> {
  const m = new Map<string, { sport: string; type: string } | null>();
  for (const a of store.auctions) {
    const k = cardId(a.player, a.rating, a.rarity);
    const v = { sport: a.sport, type: normType(a.type) };
    const ex = m.get(k);
    if (ex === undefined) m.set(k, v);
    else if (ex && (ex.sport !== v.sport || ex.type !== v.type)) m.set(k, null); // ambiguous: don't guess
  }
  return m;
}

export function saleObservations(store: RealStore): SaleObs[] {
  const idx = saleIndex(store);
  const out: SaleObs[] = [];
  for (const s of store.sales) {
    const ts = saleTs(s);
    if (!isSale(s) || ts === -Infinity || !(s.price > 0) || !(s.rating > 0)) continue;
    const r = idx.get(cardId(s.player, s.rating, s.rarity)) ?? null;
    out.push({ ts, price: s.price, rating: s.rating, ppr: s.price / s.rating, player: s.player, rarity: s.rarity, serial: s.serial, sport: r?.sport ?? null, type: r?.type ?? null, cardKey: `card:${cardId(s.player, s.rating, s.rarity)}` });
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export interface RefContext {
  now: number;
  cardStats: Map<string, RealMarketStat>;
  playerStats: RealMarketStat[];
  poolStrict: Map<string, number[]>;
  poolRarity: Map<string, number[]>;
  /** live auctions by sport|rarity|type, with their own key so an auction never serves as its own reference */
  liveBids: Map<string, Array<{ key: string; ppr: number }>>;
}

const poolKey = (sport: string, rarity: string, type: string) => `${normSport(sport)}|${normRarity(rarity)}|${normType(type)}`;

function newest<T extends { seenAt: string }>(cur: T | undefined, next: T): T {
  return !cur || Date.parse(next.seenAt) >= Date.parse(cur.seenAt) ? next : cur;
}

export function buildRefContext(store: RealStore, now: number, obs: SaleObs[] = saleObservations(store)): RefContext {
  const cardStats = new Map<string, RealMarketStat>();
  const playerStats: RealMarketStat[] = [];
  const playerBest = new Map<string, RealMarketStat>();
  for (const s of store.stats) {
    if (s.scope === 'Card') {
      const k = `${normName(s.name)}|${s.rating}|${normRarity(s.rarity)}`;
      cardStats.set(k, newest(cardStats.get(k), s));
    } else if (s.scope === 'Player') {
      const k = `${abbrevKey(s.name)}|${normName(s.name)}`;
      playerBest.set(k, newest(playerBest.get(k), s));
    }
  }
  playerStats.push(...playerBest.values());
  const poolStrict = new Map<string, number[]>();
  const poolRarity = new Map<string, number[]>();
  for (const o of obs) {
    const r = normRarity(o.rarity);
    (poolRarity.get(r) ?? poolRarity.set(r, []).get(r)!).push(o.ppr);
    if (o.sport && o.type) {
      const k = poolKey(o.sport, o.rarity, o.type);
      (poolStrict.get(k) ?? poolStrict.set(k, []).get(k)!).push(o.ppr);
    }
  }
  const liveBids = new Map<string, Array<{ key: string; ppr: number }>>();
  for (const a of store.auctions) {
    if (auctionStatus(a, now).state !== 'live') continue;
    const last = a.pts[a.pts.length - 1];
    if (!(a.rating > 0) || !(last.bid > 0)) continue;
    const k = poolKey(a.sport, a.rarity, a.type);
    (liveBids.get(k) ?? liveBids.set(k, []).get(k)!).push({ key: a.key, ppr: last.bid / a.rating });
  }
  return { now, cardStats, playerStats, poolStrict, poolRarity, liveBids };
}

const statPerRating = (s: RealMarketStat): number | null => {
  if (typeof s.medianPerRating === 'number' && s.medianPerRating > 0) return s.medianPerRating;
  if (typeof s.median === 'number' && s.median > 0 && s.rating > 0) return s.median / s.rating;
  return null;
};

const f1 = (x: number) => (Math.round(x * 10) / 10).toString();

/**
 * The reference price per rating point for one auction, from REAL data, in this priority:
 *   (a) Real's own median per rating for the same card (a "Market data" view, scope Card)
 *   (b) the same for the same player (scope Player)
 *   (c) the median per rating of the sales you captured for the same sport + rarity + card type
 *   (d) the median per rating of the other live auctions you captured for the same sport + rarity + card type (bids, not sales)
 *   (e) last resort, flagged weak: the median per rating of all captured sales of that rarity (sales carry no sport or card type)
 * The first reference resting on at least MIN_REF_SALES sales (or bids) wins; if none does, the highest-priority one that
 * exists is returned flagged `thin` so the UI can show it but compute no premium.
 */
export function referenceFor(a: StoredAuction, ctx: RefContext): RefPrice | null {
  const cands: RefPrice[] = [];
  const mk = (r: Omit<RefPrice, 'thin' | 'short'>): RefPrice => ({ ...r, thin: r.n < MIN_REF_SALES, short: REF_SHORT[r.kind] });

  const cs = ctx.cardStats.get(`${normName(a.player)}|${a.rating}|${normRarity(a.rarity)}`);
  const csPpr = cs && statPerRating(cs);
  if (cs && csPpr) {
    const n = cs.totalSales ?? 0;
    cands.push(mk({ kind: 'card-stats', perRating: csPpr, n, weak: false, seenAt: validMs(cs.seenAt), detail: `Real's own median for this card: ${f1(csPpr)} Rax per rating (${cs.window ?? '30d'} window, ${n.toLocaleString('en-US')} sales), as you saw it in "Market data"` }));
  }
  let ps: RealMarketStat | undefined;
  for (const s of ctx.playerStats) if (samePlayerName(s.name, a.player)) ps = newest(ps, s);
  const psPpr = ps && statPerRating(ps);
  if (ps && psPpr) {
    const n = ps.totalSales ?? 0;
    cands.push(mk({ kind: 'player-stats', perRating: psPpr, n, weak: false, seenAt: validMs(ps.seenAt), detail: `Real's own median for this player's cards: ${f1(psPpr)} Rax per rating (${ps.window ?? '30d'} window, ${n.toLocaleString('en-US')} sales), as you saw it in "Market data" (Player view)` }));
  }
  const pool = ctx.poolStrict.get(poolKey(a.sport, a.rarity, a.type));
  if (pool && pool.length) cands.push(mk({ kind: 'sales-pool', perRating: median(pool), n: pool.length, weak: false, seenAt: null, detail: `Median of ${pool.length} sale${pool.length === 1 ? '' : 's'} you captured for ${normSport(a.sport)} ${capWord(a.rarity)} ${normType(a.type)} cards (different ratings mixed; only sales whose card matched one of your captured auctions are counted)` }));
  const live = (ctx.liveBids.get(poolKey(a.sport, a.rarity, a.type)) ?? []).filter((x) => x.key !== a.key);
  if (live.length) cands.push(mk({ kind: 'live-auctions', perRating: median(live.map((x) => x.ppr)), n: live.length, weak: false, seenAt: null, detail: `Median bid per rating of ${live.length} other live ${normSport(a.sport)} ${capWord(a.rarity)} ${normType(a.type)} auction${live.length === 1 ? '' : 's'} you captured — current bids, NOT sale prices` }));
  const rar = ctx.poolRarity.get(normRarity(a.rarity));
  if (rar && rar.length) cands.push(mk({ kind: 'sales-rarity', perRating: median(rar), n: rar.length, weak: true, seenAt: null, detail: `Weak yardstick: median of ${rar.length} captured ${capWord(a.rarity)} sale${rar.length === 1 ? '' : 's'} of any sport, rating and card type (sales don't record sport or type)` }));

  return cands.find((c) => !c.thin) ?? cands[0] ?? null;
}

/** Premium in percent, or null when there is no reference or it rests on too little to trust. */
export function premiumOf(perRating: number, ref: RefPrice | null): number | null {
  if (!ref || ref.thin || !(ref.perRating > 0)) return null;
  return (perRating / ref.perRating - 1) * 100;
}

export interface RadarItem {
  key: string;
  auction: StoredAuction;
  last: AuctionPoint;
  bid: number;
  perRating: number;
  status: AuctionStatus;
  ref: RefPrice | null;
  /** Percent over the reference per rating; null when it can't be trusted (see premiumOf). */
  premium: number | null;
  /** What the reference implies this card is worth: perRating × rating. */
  fair: number | null;
}

/** Every captured auction as a radar row (bidder deliberately absent: Real's cards don't show it). */
export function radarItems(store: RealStore, now: number): RadarItem[] {
  const ctx = buildRefContext(store, now);
  return store.auctions
    .map((a): RadarItem => {
      const last = a.pts[a.pts.length - 1];
      const perRating = last.bid / a.rating;
      const ref = referenceFor(a, ctx);
      return { key: a.key, auction: a, last, bid: last.bid, perRating, status: auctionStatus(a, now), ref, premium: premiumOf(perRating, ref), fair: ref ? ref.perRating * a.rating : null };
    })
    .sort((a, b) => lastSeen(b.auction) - lastSeen(a.auction));
}

export interface BidFairPoint {
  key: string;
  label: string;
  sport: string;
  bid: number;
  fair: number;
  premium: number;
  kind: RefKind;
  n: number;
}

/** Live auctions whose reference is trustworthy: current bid vs the fair value that reference implies. */
export function bidVsFair(items: RadarItem[]): BidFairPoint[] {
  return items
    .filter((i) => i.status.state === 'live' && i.ref && !i.ref.thin && i.fair != null && i.premium != null)
    .map((i) => ({ key: i.key, label: `${capWord(i.auction.player.toLowerCase())} ${i.auction.rating} ${capWord(i.auction.rarity)}`, sport: i.auction.sport, bid: i.bid, fair: i.fair!, premium: i.premium!, kind: i.ref!.kind, n: i.ref!.n }));
}

/* ------------------------------- fair-value table ------------------------------- */

export interface FairRow {
  name: string;
  rating: number;
  rarity: string;
  serial: string;
  scope: string | null;
  window: string | null;
  median: number | null;
  medianPerRating: number | null;
  totalSales: number | null;
  premium: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  seenAt: number | null;
  /** The same card's live auction, if you captured one. */
  inAuction: { bid: number; perRating: number } | null;
}

/** Real's own market stats, newest per card+scope, biggest samples first. */
export function fairTable(store: RealStore, now: number): FairRow[] {
  const best = new Map<string, RealMarketStat>();
  for (const s of store.stats) {
    const k = `${cardId(s.name, s.rating, s.rarity)}|${s.scope ?? ''}`;
    best.set(k, newest(best.get(k), s));
  }
  const live = new Map<string, { bid: number; perRating: number }>();
  for (const a of store.auctions) {
    if (auctionStatus(a, now).state !== 'live') continue;
    const last = a.pts[a.pts.length - 1];
    live.set(`${normName(a.player)}|${a.rating}|${normRarity(a.rarity)}`, { bid: last.bid, perRating: last.bid / a.rating });
  }
  return [...best.values()]
    .map((s): FairRow => ({ name: s.name, rating: s.rating, rarity: s.rarity, serial: s.serial, scope: s.scope, window: s.window, median: s.median, medianPerRating: statPerRating(s), totalSales: s.totalSales, premium: s.premium, min: s.min, max: s.max, q1: s.q1, q3: s.q3, seenAt: validMs(s.seenAt), inAuction: live.get(`${normName(s.name)}|${s.rating}|${normRarity(s.rarity)}`) ?? null }))
    .sort((a, b) => (b.totalSales ?? -1) - (a.totalSales ?? -1) || a.name.localeCompare(b.name));
}

/* --------------------------- sales → history (Tab 3) --------------------------- */

export interface DailyAgg {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  /** Start of that UTC day, ms. */
  t: number;
  /** Sales that day (in what you captured). */
  n: number;
  medianPrice: number;
  /** Median of price ÷ rating. */
  medianPpr: number;
  minPpr: number;
  maxPpr: number;
  /** Rax traded that day (sum of prices). */
  raxVolume: number;
}

/** One row per UTC day that has at least one sale; days without a sale are absent, not zero. */
export function dailyAggregate(obs: SaleObs[]): DailyAgg[] {
  const g = new Map<string, SaleObs[]>();
  for (const o of obs) {
    const d = utcDay(o.ts);
    (g.get(d) ?? g.set(d, []).get(d)!).push(o);
  }
  return [...g.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, xs]) => ({ day, t: Date.parse(`${day}T00:00:00Z`), n: xs.length, medianPrice: median(xs.map((x) => x.price)), medianPpr: median(xs.map((x) => x.ppr)), minPpr: Math.min(...xs.map((x) => x.ppr)), maxPpr: Math.max(...xs.map((x) => x.ppr)), raxVolume: xs.reduce((a, x) => a + x.price, 0) }));
}

export type PoolLevel = 'rarity' | 'sport+rarity' | 'sport+rarity+type';
export function poolKeyOf(o: SaleObs, level: PoolLevel): string | null {
  if (level === 'rarity') return normRarity(o.rarity);
  if (!o.sport) return null;
  if (level === 'sport+rarity') return `${o.sport}|${normRarity(o.rarity)}`;
  return o.type ? `${o.sport}|${normRarity(o.rarity)}|${o.type}` : null;
}

/** Daily aggregates of per-rating price for every pool at a level (cards of mixed ratings pooled by price ÷ rating). */
export function dailyByPool(obs: SaleObs[], level: PoolLevel): Map<string, DailyAgg[]> {
  const g = new Map<string, SaleObs[]>();
  for (const o of obs) {
    const k = poolKeyOf(o, level);
    if (k) (g.get(k) ?? g.set(k, []).get(k)!).push(o);
  }
  return new Map([...g].map(([k, xs]) => [k, dailyAggregate(xs)]));
}

export interface RealSeries extends PlayerSeries {
  kind: 'card' | 'pool';
  /** Sales behind it. */
  sales: number;
  /** Distinct UTC days with a sale. */
  days: number;
  /** Pools are in Rax per rating point (rating fixed at 1); cards are in Rax. */
  perRating: boolean;
}

function toPoints(xs: SaleObs[], perRating: boolean): SeriesPoint[] {
  const g = new Map<number, SaleObs[]>();
  for (const o of xs) {
    const h = Math.floor(o.ts / HOUR);
    (g.get(h) ?? g.set(h, []).get(h)!).push(o);
  }
  return [...g.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([h, os]) => {
      const sorted = [...os].sort((a, b) => a.ts - b.ts);
      const v = sorted.map((o) => (perRating ? o.ppr : o.price));
      return { t: h * HOUR, volume: os.length, avgBid: mean(v), medPrp: median(os.map((o) => o.ppr)), open: v[0], high: Math.max(...v), low: Math.min(...v), close: v[v.length - 1] };
    });
}

export interface RealDerived {
  asOf: number;
  obs: SaleObs[];
  series: RealSeries[];
  byKey: Map<string, { series: RealSeries; obs: SaleObs[] }>;
}

/** Full names for abbreviated sale names, learned from the auctions and market-data views you captured. */
function nameLookup(store: RealStore): Map<string, string | null> {
  const m = new Map<string, string | null>();
  const add = (n: string) => {
    if (looksAbbreviated(n)) return;
    const k = abbrevKey(n);
    const pretty = n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s-])\w/g, (c) => c.toUpperCase()) : n;
    const ex = m.get(k);
    if (ex === undefined) m.set(k, pretty);
    else if (ex && normName(ex) !== normName(pretty)) m.set(k, null);
  };
  for (const a of store.auctions) add(a.player);
  for (const s of store.stats) add(s.name);
  return m;
}

/** Every card (≥ MIN_SERIES_SALES sales) and every pool (≥ MIN_POOL_SALES) as a PlayerSeries the existing Tab 3 charts accept. */
export function deriveRealSeries(store: RealStore): RealDerived {
  const obs = saleObservations(store);
  const asOf = obs.length ? obs[obs.length - 1].ts : 0;
  const names = nameLookup(store);
  const byKey = new Map<string, { series: RealSeries; obs: SaleObs[] }>();
  const series: RealSeries[] = [];
  const push = (s: RealSeries, xs: SaleObs[]) => {
    series.push(s);
    byKey.set(s.key, { series: s, obs: xs });
  };

  const cards = new Map<string, SaleObs[]>();
  for (const o of obs) (cards.get(o.cardKey) ?? cards.set(o.cardKey, []).get(o.cardKey)!).push(o);
  for (const [key, xs] of cards) {
    if (xs.length < MIN_SERIES_SALES) continue;
    const f = xs[0];
    const full = names.get(abbrevKey(f.player));
    const sport = xs.find((x) => x.sport)?.sport ?? 'ALL';
    push({ kind: 'card', key, playerName: full ?? f.player, sport: sport as PlayerSeries['sport'], rating: f.rating, rarity: capWord(f.rarity) as PlayerSeries['rarity'], points: toPoints(xs, false), sales: xs.length, days: new Set(xs.map((x) => utcDay(x.ts))).size, perRating: false }, xs);
  }

  const poolDefs: Array<{ level: PoolLevel; make: (k: string) => { key: string; name: string; sport: string; rarity: string } }> = [
    { level: 'rarity', make: (k) => ({ key: `pool:r:${k}`, name: `All ${capWord(k)} cards`, sport: 'ALL', rarity: k }) },
    { level: 'sport+rarity', make: (k) => { const [sp, r] = k.split('|'); return { key: `pool:sr:${k}`, name: `${sp} ${capWord(r)} cards`, sport: sp, rarity: r }; } },
    { level: 'sport+rarity+type', make: (k) => { const [sp, r, t] = k.split('|'); return { key: `pool:srt:${k}`, name: `${sp} ${capWord(r)} ${t} cards`, sport: sp, rarity: r }; } },
  ];
  const parentSize = new Map<string, number>();
  for (const def of poolDefs) {
    const groups = new Map<string, SaleObs[]>();
    for (const o of obs) {
      const k = poolKeyOf(o, def.level);
      if (k) (groups.get(k) ?? groups.set(k, []).get(k)!).push(o);
    }
    for (const [k, xs] of groups) {
      if (xs.length < MIN_POOL_SALES) continue;
      const parent = def.level === 'rarity' ? null : def.level === 'sport+rarity' ? `r:${k.split('|')[1]}` : `sr:${k.split('|').slice(0, 2).join('|')}`;
      const m = def.make(k);
      const same = parent != null && parentSize.get(parent) === xs.length;
      parentSize.set(m.key.replace('pool:', ''), xs.length);
      if (same) continue; // identical to its parent: don't list twice
      push({ kind: 'pool', key: m.key, playerName: m.name, sport: m.sport as PlayerSeries['sport'], rating: 1, rarity: capWord(m.rarity) as PlayerSeries['rarity'], points: toPoints(xs, true), sales: xs.length, days: new Set(xs.map((x) => utcDay(x.ts))).size, perRating: true }, xs);
    }
  }
  series.sort((a, b) => (a.kind === b.kind ? b.sales - a.sales : a.kind === 'card' ? -1 : 1));
  return { asOf, obs, series, byKey };
}

/* ----------------------------------- spikes ----------------------------------- */

export const SPIKE_MIN_RECENT = 3;
export const SPIKE_MIN_WINDOWS = 3;
export const SPIKE_MIN_PER_WINDOW = 2;
export const SPIKE_MIN_BASELINE_SALES = 10;
export const SPIKE_MIN_RISE = 0.15;

export interface RealSpikes {
  spikes: SpikeRow[];
  /** Card series that had enough sales to be tested at all. */
  eligible: number;
  tested: number;
  reason: string;
}

/**
 * Price spikes on real sale prices: the median sale price of the last 24 h (≥ 3 sales) against the medians of the seven
 * 24-h windows before it (≥ 3 of them with ≥ 2 sales, ≥ 10 sales in all). Flags z > 2 AND at least +15% over the baseline.
 * "As of" is the newest sale you captured. Volume is never tested: the Market-data list shows only the latest sales,
 * so a count of captured sales is a function of how long the list was, not of how busy the market was.
 */
export function realSpikes(d: RealDerived, catalysts: Record<string, CatalystTag[]> = {}): RealSpikes {
  const out: SpikeRow[] = [];
  let eligible = 0;
  const cards = d.series.filter((s) => s.kind === 'card');
  for (const s of cards) {
    const xs = d.byKey.get(s.key)!.obs;
    const recent = xs.filter((o) => o.ts > d.asOf - DAY && o.ts <= d.asOf);
    const windows: number[][] = [];
    const counts: number[] = [];
    let baseSales = 0;
    for (let k = 1; k <= 7; k++) {
      const w = xs.filter((o) => o.ts > d.asOf - (k + 1) * DAY && o.ts <= d.asOf - k * DAY);
      if (w.length >= SPIKE_MIN_PER_WINDOW) {
        windows.push(w.map((o) => o.price));
        counts.push(w.length);
        baseSales += w.length;
      }
    }
    if (recent.length < SPIKE_MIN_RECENT || windows.length < SPIKE_MIN_WINDOWS || baseSales < SPIKE_MIN_BASELINE_SALES) continue;
    eligible++;
    const meds = windows.map((w) => median(w));
    const cur = median(recent.map((o) => o.price));
    const z = zScore(cur, meds);
    const base = mean(meds);
    if (z > 2 && cur >= base * (1 + SPIKE_MIN_RISE)) {
      out.push({ key: s.key, playerName: s.playerName, sport: s.sport, rating: s.rating, rarity: s.rarity, volume24h: recent.length, volumeBaseline: mean(counts), volumeZ: 0, avgBid24h: cur, avgBidBaseline: base, avgBidZ: z, z, catalysts: catalysts[s.key] ?? [] });
    }
  }
  out.sort((a, b) => b.z - a.z);
  const reason = eligible
    ? `${eligible} of ${cards.length} card${cards.length === 1 ? '' : 's'} have enough captured sales to test.`
    : `None of the ${cards.length} card${cards.length === 1 ? '' : 's'} with sales has enough yet: a spike test needs ≥ ${SPIKE_MIN_RECENT} sales in the last 24 h (before the newest sale you captured) and, before that, ≥ ${SPIKE_MIN_WINDOWS} earlier 24-h windows with ≥ ${SPIKE_MIN_PER_WINDOW} sales each (≥ ${SPIKE_MIN_BASELINE_SALES} in all). Capture the same cards on more days.`;
  return { spikes: out, eligible, tested: cards.length, reason };
}

/** Median sale price per card vs its rating (needs a few cards to mean anything). */
export function realFair(d: RealDerived, sport: string): { points: FairValuePoint[]; model: FairValueModel } {
  const items = d.series
    .filter((s) => s.kind === 'card' && (sport === 'ALL' || s.sport === sport))
    .map((s) => ({ key: s.key, playerName: s.playerName, sport: s.sport, rating: s.rating, medianPrice: median(d.byKey.get(s.key)!.obs.map((o) => o.price)) }));
  if (items.length < 4) return { points: [], model: { slope: 0, intercept: 0, r2: 0, n: items.length } };
  const fv = fairValue(items);
  return { points: fv.points, model: { slope: fv.regression.slope, intercept: fv.regression.intercept, r2: fv.regression.r2, n: fv.regression.n } };
}

/* --------------------------------- forecast --------------------------------- */

/** Distinct sale-days needed before a Monte Carlo is drawn for a series. */
export const FORECAST_MIN_DAYS = MIN_FORECAST_DAYS;

export function realForecastInputs(d: RealDerived, key: string): ForecastInputs | null {
  const me = d.byKey.get(key);
  if (!me) return null;
  const dayAgg = dailyAggregate(me.obs);
  if (!dayAgg.length) return null;
  const daily = dayAgg.map((x) => ({ t: x.t + 12 * HOUR, ppr: x.medianPpr, volume: x.n }));

  const peers = d.series.filter((s) => s.kind === 'card' && s.key !== key && normRarity(s.rarity) === normRarity(me.series.rarity));
  const returns: number[] = [];
  const meds: number[] = [];
  const vols: number[] = [];
  for (const p of peers) {
    const da = dailyAggregate(d.byKey.get(p.key)!.obs);
    for (let i = 1; i < da.length; i++) if (da[i].t - da[i - 1].t === DAY) returns.push(Math.log(da[i].medianPpr / da[i - 1].medianPpr));
    if (da.length) {
      meds.push(median(da.map((x) => x.medianPpr)));
      vols.push(median(da.map((x) => x.n)));
    }
  }
  const clipped = returns.map((r) => Math.max(-0.5, Math.min(0.5, r)));
  const sd = clipped.length >= 2 ? Math.sqrt(clipped.reduce((a, r) => a + (r - mean(clipped)) ** 2, 0) / (clipped.length - 1)) : 0;
  return {
    source: 'real',
    key,
    playerName: me.series.playerName,
    sport: me.series.sport,
    rarity: me.series.rarity,
    rating: me.series.rating,
    unit: 'sales',
    currentPpr: daily[daily.length - 1].ppr,
    daily,
    peers: { n: peers.length, scope: peers.length ? 'rarity' : 'none', sdLogRet: sd, medianPpr: meds.length ? median(meds) : 0, medianVolPerDay: vols.length ? median(vols) : 0 },
    catalysts: [],
    spikeZ: 0,
  };
}

/* ------------------------- Tab 3 response shapes ------------------------- */

const inSport = (s: { sport: string }, sport: string) => sport === 'ALL' || s.sport === sport;

/** The summary the Tab 3 screens already understand (spikes, fair-value fit, selectable series), built from captured sales. */
export function realSpikesResponse(d: RealDerived, sport: string, now: number, note: string): SpikesResponse {
  const sp = realSpikes(d);
  const f = realFair(d, sport);
  const series = d.series.filter((s) => inSport(s, sport));
  return {
    source: 'real',
    unit: 'sales',
    generatedAt: new Date(now).toISOString(),
    spikes: sp.spikes.filter((s) => inSport(s, sport)),
    fair: f.points,
    model: f.model,
    players: series.map((s) => ({ key: s.key, playerName: s.playerName, sport: s.sport, rating: s.rating, rarity: s.rarity })),
    note,
    real: { asOf: d.asOf, eligible: sp.eligible, tested: sp.tested, reason: sp.reason },
  };
}

/** Candles of one series from the sales themselves; windows end at the newest captured sale. */
export function realCandles(d: RealDerived, key: string, window: '24h' | '7d' | '30d'): CandlesResponse | null {
  const e = d.byKey.get(key);
  return e ? { source: 'real', unit: 'sales', key, window, asOf: d.asOf, candles: buildCandles(e.series, d.asOf, window) } : null;
}
