/**
 * Strict validation + plausibility for a community contribution (POST /api/market/contribute).
 *
 * The capture format is shared/realMarketCapture.ts. Nothing in it is trusted: every field is re-checked here, rows that fail are
 * DROPPED (and counted by reason) rather than repaired, and the survivors are normalised into the keys the database uses. These
 * checks cannot prove a row is TRUE — only that it is the kind of row Real could have produced. Truth comes from corroboration
 * (distinct reporters, see marketDb.ts), not from this file. Full model: docs/COMMUNITY-MARKET.md.
 */
import { abbrevKey, normName, normSport, normType } from '../../shared/realMarket';

export const LIMITS = {
  /** Request body, bytes. A full export of 400 auctions + 500 sales + 100 stats is ~250 KB. */
  bodyBytes: 300 * 1024,
  auctions: 400,
  sales: 500,
  stats: 100,
  rating: [0.1, 12] as const,
  price: [0, 5_000_000] as const,
  saleMaxAgeDays: 120,
  /** Live auctions / stats must have been SEEN recently — a capture is a snapshot, not an archive. */
  auctionMaxAgeDays: 7,
  statMaxAgeDays: 7,
  /** Clock skew allowed between the contributor's machine and ours. */
  skewMs: 5 * 60_000,
  timeLeftMaxSec: 60 * 86_400,
} as const;

export const RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYSTIC', 'ICONIC'] as const;
export const SPORTS = ['NFL', 'MLB', 'NBA', 'WNBA', 'CFB', 'NHL', 'TEN', 'UFC', 'FC', 'PGA', 'CBB', 'CWS', 'ALL'] as const;
const OUTCOMES = ['Sold', 'Accepted', 'Open', 'No Sale'];
const SCOPES = ['Card', 'Player', 'Similar'];
const DAY = 86_400_000;

export interface CleanSale {
  key: string;
  sport: string | null;
  type: string | null;
  player: string;
  serial: string;
  rating: number;
  rarity: string;
  price: number;
  perRating: number | null;
  at: number;
  outcome: string | null;
}
export interface CleanAuction {
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
  bid: number;
  bids: number;
  watchers: number;
  timeLeftSec: number | null;
  endAt: number | null;
  seen: number;
}
export interface CleanStat {
  key: string;
  name: string;
  rating: number;
  rarity: string;
  serial: string;
  scope: string | null;
  win: string | null;
  median: number | null;
  medianPerRating: number | null;
  totalSales: number | null;
  premium: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  seen: number;
}

export type Kind = 'auctions' | 'sales' | 'stats';
export interface Counts {
  auctions: number;
  sales: number;
  stats: number;
}
export const zero = (): Counts => ({ auctions: 0, sales: 0, stats: 0 });

export interface Cleaned {
  auctions: CleanAuction[];
  sales: CleanSale[];
  stats: CleanStat[];
  dropped: Counts & { reasons: Record<string, number> };
}

export class Rejected extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/* ------------------------------ field helpers ------------------------------ */

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
/** A finite number inside [lo, hi], or null. */
const rng = (x: unknown, lo: number, hi: number): number | null => (fin(x) && x >= lo && x <= hi ? x : null);
/** Round away float noise from a displayed value (Real shows at most 2 decimals). */
const r2 = (x: number) => Math.round(x * 100) / 100;

const NAME_RE = /^[\p{L}\p{M}0-9 .'’\-,&()/]+$/u;
function name(x: unknown, min = 2, max = 64): string | null {
  if (typeof x !== 'string') return null;
  const s = x.replace(/\s+/g, ' ').trim();
  return s.length >= min && s.length <= max && NAME_RE.test(s) ? s : null;
}
const rarity = (x: unknown): string | null => {
  const u = typeof x === 'string' ? x.trim().toUpperCase() : '';
  return (RARITIES as readonly string[]).includes(u) ? u : null;
};
const serial = (x: unknown): string | null => (typeof x === 'string' && /^#\d{1,7}$/.test(x.trim()) ? x.trim() : null);
const type = (x: unknown): string | null => {
  const u = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().toUpperCase() : '';
  return /^[A-Z0-9][A-Z0-9 /&.\-]{1,23}$/.test(u) ? u : null;
};
const time = (x: unknown): number | null => {
  if (typeof x !== 'string' || x.length > 40) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
};
const minute = (t: number) => Math.floor(t / 60_000) * 60_000;

/** Reasons accumulate in one map; the caller sees which check removed how many rows. */
class Drops {
  counts = zero();
  reasons: Record<string, number> = {};
  drop(kind: Kind, why: string) {
    this.counts[kind]++;
    const k = `${kind}.${why}`;
    this.reasons[k] = (this.reasons[k] ?? 0) + 1;
  }
}

/* --------------------------------- rows --------------------------------- */

function cleanSale(x: unknown, now: number, d: Drops): CleanSale | null {
  if (!isObj(x)) return d.drop('sales', 'shape'), null;
  const player = name(x.player);
  if (!player) return d.drop('sales', 'player'), null;
  const sr = serial(x.serial);
  if (!sr) return d.drop('sales', 'serial'), null;
  const rt = rarity(x.rarity);
  if (!rt) return d.drop('sales', 'rarity'), null;
  const rating = rng(x.rating, LIMITS.rating[0], LIMITS.rating[1]);
  if (rating == null) return d.drop('sales', 'rating'), null;
  const price = rng(x.price, LIMITS.price[0], LIMITS.price[1]);
  if (price == null) return d.drop('sales', 'price'), null;
  const at = time(x.at);
  if (at == null) return d.drop('sales', 'time'), null;
  if (at > now + LIMITS.skewMs) return d.drop('sales', 'future'), null;
  if (at < now - LIMITS.saleMaxAgeDays * DAY) return d.drop('sales', 'too_old'), null;
  let perRating: number | null = null;
  if (x.perRating != null) {
    perRating = rng(x.perRating, 0, LIMITS.price[1]);
    if (perRating == null) return d.drop('sales', 'per_rating'), null;
    // Real shows per-rating rounded to a whole Rax: allow 5%, but never less than the rounding step.
    const exact = price / rating;
    if (Math.abs(perRating - exact) > Math.max(0.05 * exact, 0.5)) return d.drop('sales', 'inconsistent'), null;
  }
  let outcome: string | null = null;
  if (x.outcome != null) {
    if (typeof x.outcome !== 'string' || !OUTCOMES.includes(x.outcome)) return d.drop('sales', 'outcome'), null;
    outcome = x.outcome;
  }
  const atMin = minute(at);
  const key = `${normName(player)}|${sr}|${new Date(atMin).toISOString().slice(0, 16)}|${r2(price)}|${r2(rating)}|${rt}`;
  return { key, sport: null, type: null, player, serial: sr, rating: r2(rating), rarity: rt, price: r2(price), perRating: perRating == null ? null : r2(perRating), at: atMin, outcome };
}

function cleanAuction(x: unknown, now: number, fallbackSeen: number | null, d: Drops): CleanAuction | null {
  if (!isObj(x)) return d.drop('auctions', 'shape'), null;
  const player = name(x.player);
  if (!player) return d.drop('auctions', 'player'), null;
  const sr = serial(x.serial);
  if (!sr) return d.drop('auctions', 'serial'), null;
  const rt = rarity(x.rarity);
  if (!rt) return d.drop('auctions', 'rarity'), null;
  const ty = type(x.type);
  if (!ty) return d.drop('auctions', 'type'), null;
  const rating = rng(x.rating, LIMITS.rating[0], LIMITS.rating[1]);
  if (rating == null) return d.drop('auctions', 'rating'), null;
  const sport = normSport(typeof x.sport === 'string' ? x.sport : 'ALL');
  if (!(SPORTS as readonly string[]).includes(sport)) return d.drop('auctions', 'sport'), null;
  const bid = rng(x.bid, LIMITS.price[0], LIMITS.price[1]);
  if (bid == null) return d.drop('auctions', 'bid'), null;
  const bids = rng(x.bids ?? 0, 0, 100_000);
  const watchers = rng(x.watchers ?? 0, 0, 1_000_000);
  if (bids == null || watchers == null) return d.drop('auctions', 'counts'), null;
  let timeLeftSec: number | null = null;
  if (x.timeLeftSec != null) {
    timeLeftSec = rng(x.timeLeftSec, 0, LIMITS.timeLeftMaxSec);
    if (timeLeftSec == null) return d.drop('auctions', 'time_left'), null;
  }
  const seen = time(x.seenAt) ?? fallbackSeen;
  if (seen == null) return d.drop('auctions', 'time'), null;
  if (seen > now + LIMITS.skewMs) return d.drop('auctions', 'future'), null;
  if (seen < now - LIMITS.auctionMaxAgeDays * DAY) return d.drop('auctions', 'too_old'), null;
  const season = typeof x.season === 'string' && /^\d{4}(-\d{2})?$/.test(x.season) ? x.season : null;
  const team = typeof x.team === 'string' && /^[A-Za-z0-9]{2,5}$/.test(x.team) ? x.team.toUpperCase() : null;
  const play = x.play == null ? null : name(x.play, 2, 48);
  if (x.play != null && play == null) return d.drop('auctions', 'play'), null;
  const rt2 = r2(rating);
  const key = `${sport}|${sr}|${normName(player)}|${normType(ty)}|${rt2}`;
  return { key, sport, season, rarity: rt, type: ty, rating: rt2, play, player, team, serial: sr, bid: r2(bid), bids: Math.round(bids), watchers: Math.round(watchers), timeLeftSec: timeLeftSec == null ? null : Math.round(timeLeftSec), endAt: timeLeftSec == null ? null : seen + Math.round(timeLeftSec) * 1000, seen };
}

function cleanStat(x: unknown, now: number, fallbackSeen: number | null, d: Drops): CleanStat | null {
  if (!isObj(x)) return d.drop('stats', 'shape'), null;
  const nm = name(x.name);
  if (!nm) return d.drop('stats', 'name'), null;
  const sr = serial(x.serial);
  if (!sr) return d.drop('stats', 'serial'), null;
  const rt = rarity(x.rarity);
  if (!rt) return d.drop('stats', 'rarity'), null;
  const rating = rng(x.rating, LIMITS.rating[0], LIMITS.rating[1]);
  if (rating == null) return d.drop('stats', 'rating'), null;
  if (x.scope != null && !(typeof x.scope === 'string' && SCOPES.includes(x.scope))) return d.drop('stats', 'scope'), null;
  if (x.window != null && !(typeof x.window === 'string' && /^\d{1,3}d$/.test(x.window))) return d.drop('stats', 'window'), null;
  const opt = (v: unknown, hi: number): number | null | undefined => (v == null ? null : (rng(v, 0, hi) ?? undefined)); // undefined = present but invalid
  const median = opt(x.median, LIMITS.price[1]);
  const mpr = opt(x.medianPerRating, LIMITS.price[1]);
  const total = opt(x.totalSales, 10_000_000);
  const premium = opt(x.premium, 10_000);
  const min = opt(x.min, LIMITS.price[1]);
  const max = opt(x.max, LIMITS.price[1]);
  const q1 = opt(x.q1, LIMITS.price[1]);
  const q3 = opt(x.q3, LIMITS.price[1]);
  if ([median, mpr, total, premium, min, max, q1, q3].some((v) => v === undefined)) return d.drop('stats', 'number'), null;
  if (median == null && total == null) return d.drop('stats', 'empty'), null;
  // The five-number summary must be ordered (±1 Rax: Real rounds each figure on its own).
  const chain = [min, q1, median, q3, max].filter((v): v is number => v != null);
  for (let i = 1; i < chain.length; i++) if (chain[i] + 1 < chain[i - 1]) return d.drop('stats', 'unordered'), null;
  const seen = time(x.seenAt) ?? fallbackSeen;
  if (seen == null) return d.drop('stats', 'time'), null;
  if (seen > now + LIMITS.skewMs) return d.drop('stats', 'future'), null;
  if (seen < now - LIMITS.statMaxAgeDays * DAY) return d.drop('stats', 'too_old'), null;
  const scope = (x.scope as string | null) ?? null;
  const win = (x.window as string | null) ?? null;
  const day = new Date(seen).toISOString().slice(0, 10);
  const key = `${normName(nm)}|${sr}|${scope ?? ''}|${win ?? ''}|${day}|${median ?? ''}|${total == null ? '' : Math.round(total)}`;
  return {
    key, name: nm, rating: r2(rating), rarity: rt, serial: sr, scope, win,
    median: median == null ? null : r2(median), medianPerRating: mpr == null ? null : r2(mpr), totalSales: total == null ? null : Math.round(total),
    premium: premium == null ? null : r2(premium), min: min == null ? null : r2(min), max: max == null ? null : r2(max), q1: q1 == null ? null : r2(q1), q3: q3 == null ? null : r2(q3), seen,
  };
}

/** initial+surname|rating|rarity → the single sport|type the same capture's auctions give that card, if unambiguous (mirrors shared/realMarket.saleIndex). */
function annotateSales(sales: CleanSale[], auctions: CleanAuction[]) {
  const idx = new Map<string, { sport: string; type: string } | null>();
  const id = (n: string, r: number, ra: string) => `${abbrevKey(n)}|${r}|${ra}`;
  for (const a of auctions) {
    if (a.sport === 'ALL') continue; // the recorder could not read the sport: that tells us nothing
    const k = id(a.player, a.rating, a.rarity);
    const v = { sport: a.sport, type: a.type };
    const ex = idx.get(k);
    if (ex === undefined) idx.set(k, v);
    else if (ex && (ex.sport !== v.sport || ex.type !== v.type)) idx.set(k, null);
  }
  for (const s of sales) {
    const hit = idx.get(id(s.player, s.rating, s.rarity));
    if (hit) {
      s.sport = hit.sport;
      s.type = hit.type;
    }
  }
}

/**
 * Validate a parsed request body's `capture`. Throws Rejected for a structurally wrong or oversized capture; returns the clean
 * rows (de-duplicated by key within the capture) and a count of what was dropped, by reason.
 */
export function cleanCapture(capture: unknown, now: number): Cleaned {
  if (!isObj(capture) || capture.v !== 1 || capture.kind !== 'real-market') throw new Rejected(400, 'bad_capture', 'Expected a Real market capture ({"v":1,"kind":"real-market",…}).');
  const arr = (k: string, max: number): unknown[] => {
    const a = capture[k];
    if (a == null) return [];
    if (!Array.isArray(a)) throw new Rejected(400, 'bad_capture', `capture.${k} must be an array.`);
    if (a.length > max) throw new Rejected(413, 'too_many_rows', `At most ${max} ${k} per contribution (this one has ${a.length}). Share smaller captures.`);
    return a;
  };
  const rawAuctions = arr('auctions', LIMITS.auctions);
  const rawSales = arr('sales', LIMITS.sales);
  const rawStats = arr('stats', LIMITS.stats);
  const d = new Drops();
  const fallbackSeen = time(capture.at);
  const fb = fallbackSeen != null && fallbackSeen <= now + LIMITS.skewMs ? fallbackSeen : null;

  const auctions = new Map<string, CleanAuction>();
  for (const x of rawAuctions) {
    const a = cleanAuction(x, now, fb, d);
    if (!a) continue;
    const ex = auctions.get(a.key);
    if (!ex || a.seen > ex.seen) auctions.set(a.key, a); // same card twice in one capture: the later sighting wins
  }
  const sales = new Map<string, CleanSale>();
  for (const x of rawSales) {
    const s = cleanSale(x, now, d);
    if (s && !sales.has(s.key)) sales.set(s.key, s);
  }
  const stats = new Map<string, CleanStat>();
  for (const x of rawStats) {
    const s = cleanStat(x, now, fb, d);
    if (s && !stats.has(s.key)) stats.set(s.key, s);
  }
  const out: Cleaned = { auctions: [...auctions.values()], sales: [...sales.values()], stats: [...stats.values()], dropped: { ...d.counts, reasons: d.reasons } };
  annotateSales(out.sales, out.auctions);
  return out;
}
