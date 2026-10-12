/**
 * Community market data (the shared database, docs/COMMUNITY-MARKET.md) as the SAME structures the local Real capture uses
 * (shared/realMarket.ts), so Tabs 2–3 run every existing calculation — radar, reference prices, premiums, spikes, candles,
 * forecasts — on it unchanged. Pure functions only; fetching and settings live in src/lib/communityStore.ts.
 *
 * What this module decides: which community rows count (the "verified" filter = reported by ≥ 2 distinct contributors), how rows
 * are turned back into sales / auctions / market stats, and how community data and the user's own capture are combined without
 * counting the same sale or auction twice.
 */
import { HISTORY_CAP, ageLabel, auctionKey, emptyStore, statKey, type AuctionPoint, type RealStore, type StoredAuction } from './realMarket';
import { saleKey, type RealMarketStat, type RealSale } from './realMarketCapture';

/** "Verified" = reported by at least this many distinct contributors on distinct networks. */
export const VERIFIED_MIN_REPORTS = 2;

/* ---------------------------- API response shapes ---------------------------- */

export interface CommunitySummary {
  rows: { sales: number; auctions: number; stats: number; total: number };
  verified: { sales: number; auctions: number; stats: number; exactAsOf: string | null };
  contributors: number;
  contributors30d: number;
  lastContribution: string | null;
  bySport: Record<string, { auctions: number; sales: number }>;
}
export interface CommunitySale {
  sport: string | null;
  type: string | null;
  player: string;
  serial: string;
  rating: number;
  rarity: string;
  price: number;
  perRating: number | null;
  at: string | null;
  outcome: string | null;
  reports: number;
}
export interface CommunityAuction {
  sport: string;
  season: string | null;
  rarity: string;
  type: string;
  rating: number;
  play: string | null;
  player: string;
  team: string | null;
  serial: string;
  bid: number;
  bids: number;
  watchers: number;
  timeLeftSec: number | null;
  lastSeen: string;
  reports: number;
  /** earlier bid changes: [ISO time, bid, bids] */
  points: Array<[string, number, number]>;
}
export interface CommunityStat extends Omit<RealMarketStat, 'name' | 'seenAt'> {
  name: string;
  seenAt: string;
  reports: number;
}
export interface CommunityData {
  sales: CommunitySale[];
  auctions: CommunityAuction[];
  stats: CommunityStat[];
  /** The server stopped at its row limit for one of the three lists. */
  truncated: boolean;
  fetchedAt: number;
}

/* ------------------------------ rows → store ------------------------------ */

const ms = (iso: string | null | undefined) => {
  const t = Date.parse(String(iso ?? ''));
  return Number.isFinite(t) ? t : null;
};

/**
 * Turn community rows into a RealStore. `minReports` ≥ 2 is the verified view. Two server rows that map to the same local sale
 * (same player/serial/time/price but a different rating or rarity — i.e. someone's forged variant) collapse to the better-corroborated one.
 */
export function communityToStore(data: CommunityData | null, summary: CommunitySummary | null, minReports: number): RealStore {
  const store = emptyStore();
  if (!data) return store;
  const best = new Map<string, { sale: RealSale; reports: number }>();
  for (const r of data.sales) {
    if (r.reports < minReports) continue;
    const sale: RealSale = { player: r.player, rating: r.rating, rarity: r.rarity, serial: r.serial, price: r.price, perRating: r.perRating, at: r.at, outcome: r.outcome };
    const k = saleKey(sale);
    const ex = best.get(k);
    if (!ex || r.reports > ex.reports) best.set(k, { sale, reports: r.reports });
  }
  store.sales = [...best.values()].map((x) => x.sale).sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0));

  const auctions = new Map<string, StoredAuction>();
  for (const r of data.auctions) {
    if (r.reports < minReports) continue;
    const key = auctionKey(r);
    const last = ms(r.lastSeen) ?? data.fetchedAt;
    const pts: AuctionPoint[] = r.points
      .map(([t, bid, bids]) => ({ at: t, bid, bids, watchers: r.watchers, timeLeftSec: null as number | null }))
      .filter((p) => (ms(p.at) ?? 0) < last)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    pts.push({ at: new Date(last).toISOString(), bid: r.bid, bids: r.bids, watchers: r.watchers, timeLeftSec: r.timeLeftSec });
    const a: StoredAuction = { key, sport: r.sport, season: r.season, rarity: r.rarity, type: r.type, rating: r.rating, play: r.play, player: r.player, team: r.team, serial: r.serial, firstSeenAt: pts[0].at, relists: 0, pts: capPoints(pts) };
    const ex = auctions.get(key);
    if (!ex || Date.parse(a.pts[a.pts.length - 1].at) > Date.parse(ex.pts[ex.pts.length - 1].at)) auctions.set(key, a);
  }
  store.auctions = [...auctions.values()];

  store.stats = data.stats
    .filter((r) => r.reports >= minReports)
    .map<RealMarketStat>((r) => ({ name: r.name, rating: r.rating, rarity: r.rarity, serial: r.serial, scope: r.scope, window: r.window, median: r.median, medianPerRating: r.medianPerRating, totalSales: r.totalSales, premium: r.premium, min: r.min, max: r.max, q1: r.q1, q3: r.q3, seenAt: r.seenAt }));

  const lastIso = summary?.lastContribution ?? null;
  store.meta = { imports: 0, firstImportAt: null, lastImportAt: lastIso, lastCaptureAt: lastIso };
  return store;
}

const capPoints = (pts: AuctionPoint[]): AuctionPoint[] => (pts.length <= HISTORY_CAP ? pts : [pts[0], ...pts.slice(pts.length - (HISTORY_CAP - 1))]);

/* ------------------------------ combining ------------------------------ */

/**
 * The user's own capture + the community's, with each sale / auction / market view counted once.
 * Sales are identical when player, serial, time and price are (the same key the local store uses); an auction seen by both gets the
 * union of both sightings (a sighting at the same instant is one sighting); a market view seen by both keeps the newer.
 */
export function combineStores(local: RealStore, community: RealStore): RealStore {
  const sales = new Map<string, RealSale>();
  for (const s of community.sales) sales.set(saleKey(s), s);
  for (const s of local.sales) sales.set(saleKey(s), s); // your own copy wins; it is the same sale

  const auctions = new Map<string, StoredAuction>(community.auctions.map((a) => [a.key, a]));
  for (const a of local.auctions) {
    const ex = auctions.get(a.key);
    if (!ex) {
      auctions.set(a.key, a);
      continue;
    }
    const at = new Map<number, AuctionPoint>();
    for (const p of [...ex.pts, ...a.pts]) {
      const t = ms(p.at) ?? 0;
      const prev = at.get(t);
      if (!prev || (prev.timeLeftSec == null && p.timeLeftSec != null)) at.set(t, p); // same instant: keep the one that has a timer
    }
    const pts = capPoints([...at.entries()].sort((x, y) => x[0] - y[0]).map(([, p]) => p));
    const newest = Date.parse(a.pts[a.pts.length - 1].at) >= Date.parse(ex.pts[ex.pts.length - 1].at) ? a : ex;
    auctions.set(a.key, { ...newest, firstSeenAt: pts[0].at, relists: Math.max(a.relists, ex.relists), pts });
  }

  const stats = new Map<string, RealMarketStat>();
  for (const s of [...community.stats, ...local.stats]) {
    const ex = stats.get(statKey(s));
    if (!ex || Date.parse(s.seenAt) >= Date.parse(ex.seenAt)) stats.set(statKey(s), s);
  }

  const lastCap = [local.meta.lastCaptureAt, community.meta.lastCaptureAt].filter(Boolean).sort().pop() ?? null;
  return {
    v: 1,
    auctions: [...auctions.values()],
    stats: [...stats.values()],
    sales: [...sales.values()].sort((a, b) => (ms(b.at) ?? 0) - (ms(a.at) ?? 0)),
    meta: { imports: local.meta.imports, firstImportAt: local.meta.firstImportAt, lastImportAt: local.meta.lastImportAt, lastCaptureAt: lastCap },
  };
}

/* -------------------------------- labels -------------------------------- */

const plural = (n: number, w: string) => `${n.toLocaleString('en-US')} ${w}${n === 1 ? '' : 's'}`;

/** "Community database · 12 reporters · updated 5 min ago" — the provenance string on every community-sourced number. */
export function communityLabel(summary: CommunitySummary | null, now: number, combinedWithLocal = false): string {
  const when = summary?.lastContribution ? ageLabel(Date.parse(summary.lastContribution), now) : 'never';
  return `Community database${combinedWithLocal ? ' + your capture' : ''} · ${plural(summary?.contributors ?? 0, 'reporter')} · updated ${when}`;
}

/** The public one-liner shown in Tabs 2–3: "Community data: 1,204 sales · 312 auctions · 41 market views · 12 reporters · updated 5 min ago". */
export function communityLine(s: CommunitySummary, now: number): string {
  if (!s.rows.total) return 'Community data: nothing shared yet.';
  return `Community data: ${plural(s.rows.sales, 'sale')} · ${plural(s.rows.auctions, 'auction')} · ${plural(s.rows.stats, 'market view')} · ${plural(s.contributors, 'reporter')} · updated ${s.lastContribution ? ageLabel(Date.parse(s.lastContribution), now) : 'never'}`;
}

/** Rows that survive the verified filter, from the summary alone (no data download needed to pick a default source). */
export function communityCounts(s: CommunitySummary | null, verifiedOnly: boolean) {
  if (!s) return { sales: 0, auctions: 0, stats: 0, total: 0 };
  const c = verifiedOnly ? s.verified : s.rows;
  return { sales: c.sales, auctions: c.auctions, stats: c.stats, total: c.sales + c.auctions + c.stats };
}
