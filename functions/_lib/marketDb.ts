/**
 * Community market database (Cloudflare D1, binding MARKET_DB) — write path, budget guard and pruning.
 * Design, limits and the poisoning model: docs/COMMUNITY-MARKET.md. Schema: migrations/market/0001_market.sql.
 *
 * Two rules shape everything here:
 *  1. D1's free tier is 100,000 ROW WRITES a day, and an indexed insert counts every index entry too. So a contribution is a
 *     handful of set-based statements (INSERT … SELECT FROM json_each(?)), rows that are already known cost nothing, and an
 *     in-code daily budget refuses contributions long before the real quota (a refused contribution is just "try tomorrow").
 *  2. Nothing a contributor sends is trusted. Rows are validated (marketValidate.ts), and a row only becomes "verified" when
 *     DISTINCT contributors on DISTINCT networks reported the same thing (`reports` ≥ 2).
 */
import type { Cleaned, CleanAuction, CleanSale, CleanStat, Counts } from './marketValidate';
import { zero } from './marketValidate';

/* ------------------------------- budgets & limits ------------------------------- */

export const BUDGET = {
  /** Estimated row writes (tables + index entries) we allow ourselves per UTC day — 70% of D1's 100,000 so pruning, retries and
   *  the estimate being a little low can never reach the real quota. */
  dailyWrites: 70_000,
  /** Total rows in sales + auctions + stats. Storage is nowhere near the limit at this size (~100 MB of 5 GB); the cap exists to
   *  bound what any scan, export or prune has to read. */
  maxRows: 300_000,
  salesCap: 150_000,
  auctionsCap: 30_000,
  statsCap: 30_000,
  /** Contributions per hour per contributor id and per network bucket. */
  perHour: 12,
  salesKeepDays: 120,
  /** Ended auctions are kept this long after their LAST sighting. */
  auctionsKeepDays: 14,
  statsKeepDays: 60,
  contributorsKeepDays: 180,
  /** Bid-change points kept per auction. */
  maxPoints: 24,
  /** Rows deleted per table per prune run (each deleted row is a write too). */
  pruneBatch: 2_000,
  pruneEveryMs: 60 * 60_000,
  recountEveryMs: 6 * 60 * 60_000,
} as const;

const HOUR = 3_600_000;
const DAY = 86_400_000;

/* ------------------------------------ hashing ------------------------------------ */

/**
 * Constant pepper: makes the hashes useless for matching against any other dataset. It is NOT a secret (it is in the repo); the
 * protection of a contributor id is that it is 128 random bits that never leave their browser except as this hash.
 */
export const PEPPER = 'rax-community-market/v1/6f3a9c1e5b7d4082';

export async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const CONTRIBUTOR_RE = /^[A-Za-z0-9_-]{16,64}$/;

export interface Identity {
  /** SHA-256(pepper + client id), 32 hex chars. The only trace of the contributor id that is stored. */
  hash: string;
  /** 20 bits of a salted IP hash (~4,000 addresses share a value). Stored with each report so one network can't vote twice. */
  net: string;
  /** Hourly rate-limit bucket names (hashed; the raw IP is never written anywhere). */
  buckets: { contributor: string; network: string };
}

export async function identify(contributorId: string, ip: string | null, now: number): Promise<Identity> {
  const hash = (await sha256Hex(`${PEPPER}|c|${contributorId}`)).slice(0, 32);
  const hour = Math.floor(now / HOUR);
  const net = ip ? (await sha256Hex(`${PEPPER}|net|${ip}`)).slice(0, 5) : `u${hash.slice(0, 4)}`; // no IP header (local dev only): don't merge strangers
  const rl = ip ? (await sha256Hex(`${PEPPER}|rl|${ip}|${hour}`)).slice(0, 10) : `u${hash.slice(0, 9)}`;
  return { hash, net, buckets: { contributor: `c:${hash.slice(0, 16)}:${hour}`, network: `n:${rl}:${hour}` } };
}

/* --------------------------------- minimal D1 types --------------------------------- */

type Stmt = D1PreparedStatement;
type Row = Record<string, unknown>;

export interface Gate {
  ok: boolean;
  status?: number;
  code?: string;
  message?: string;
  retryAfter?: number;
}

export interface MetaView {
  writesToday: number;
  rows: number;
  nSales: number;
  nAuctions: number;
  nStats: number;
}

export interface ContributeResult {
  accepted: Counts;
  /** Rows nobody had reported before. */
  new: Counts;
  /** Rows already in the database (reported by anyone before, including you). */
  duplicates: Counts;
  /** Of those duplicates, rows where this contribution added a new, independent report (they move toward "verified"). */
  corroborated: Counts;
  /** Rows you or your network had already reported — they change nothing. */
  alreadyYours: Counts;
  /** Rows this contribution took from 1 to 2 reporters (= newly "verified"). */
  newlyVerified: Counts;
  dropped: Counts & { reasons: Record<string, number> };
  /** Estimated D1 row writes this contribution cost. */
  estimatedWrites: number;
}

const dayKey = (now: number) => new Date(now).toISOString().slice(0, 10);
const json = JSON.stringify;

/* ------------------------------------- planning ------------------------------------- */

interface ReportRow {
  k: string;
  c: string;
  n: string;
}
const group = (rows: ReportRow[]) => {
  const m = new Map<string, ReportRow[]>();
  for (const r of rows) (m.get(r.k) ?? m.set(r.k, []).get(r.k)!).push(r);
  return m;
};
type Verdict = 'new' | 'corroborate' | 'yours';
/** One vote per contributor AND per network: your own repeat reports and anyone on your network add nothing. */
function verdict(existing: ReportRow[] | undefined, id: Identity): Verdict {
  if (!existing?.length) return 'new';
  return existing.some((r) => r.c === id.hash || r.n === id.net) ? 'yours' : 'corroborate';
}

interface AuctionState {
  k: string;
  bid: number;
  bids: number;
  watchers: number;
  npts: number;
  last_seen: number;
}

export interface Plan {
  statements: Stmt[];
  result: ContributeResult;
  newCounts: Counts;
}

const ALL_KEYS = <T extends { key: string }>(xs: T[]) => xs.map((x) => x.key);

/* --------------------------------- the read-before-write --------------------------------- */

export interface Reads {
  saleReports: ReportRow[];
  auctionReports: ReportRow[];
  auctionState: AuctionState[];
  statReports: ReportRow[];
  limits: { contributor: number; network: number };
  meta: MetaView;
}

/** One round trip: who already reported these keys, the current auction states, the rate-limit counters and the budget counters. */
export async function readState(db: D1Database, c: Cleaned, id: Identity, now: number): Promise<Reads> {
  const q = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p);
  const sk = json(ALL_KEYS(c.sales));
  const ak = json(ALL_KEYS(c.auctions));
  const tk = json(ALL_KEYS(c.stats));
  const day = `writes:${dayKey(now)}`;
  const res = await db.batch<Row>([
    q('SELECT sale_key AS k, contributor_hash AS c, net AS n FROM sale_reports WHERE sale_key IN (SELECT value FROM json_each(?1))', sk),
    q('SELECT auction_key AS k, contributor_hash AS c, net AS n FROM auction_reports WHERE auction_key IN (SELECT value FROM json_each(?1))', ak),
    q('SELECT auction_key AS k, bid, bids, watchers, npts, last_seen FROM auctions WHERE auction_key IN (SELECT value FROM json_each(?1))', ak),
    q('SELECT stat_key AS k, contributor_hash AS c, net AS n FROM stat_reports WHERE stat_key IN (SELECT value FROM json_each(?1))', tk),
    q('SELECT bucket, n FROM rate_limits WHERE bucket IN (?1, ?2) AND expires > ?3', id.buckets.contributor, id.buckets.network, now),
    q("SELECT k, v FROM meta WHERE k IN (?1, 'n_sales', 'n_auctions', 'n_stats')", day),
  ]);
  const rows = (i: number) => (res[i].results ?? []) as Row[];
  const lim = new Map(rows(4).map((r) => [String(r.bucket), Number(r.n)]));
  const meta = new Map(rows(5).map((r) => [String(r.k), Number(r.v) || 0]));
  const nSales = meta.get('n_sales') ?? 0;
  const nAuctions = meta.get('n_auctions') ?? 0;
  const nStats = meta.get('n_stats') ?? 0;
  return {
    saleReports: rows(0) as unknown as ReportRow[],
    auctionReports: rows(1) as unknown as ReportRow[],
    auctionState: rows(2) as unknown as AuctionState[],
    statReports: rows(3) as unknown as ReportRow[],
    limits: { contributor: lim.get(id.buckets.contributor) ?? 0, network: lim.get(id.buckets.network) ?? 0 },
    meta: { writesToday: meta.get(day) ?? 0, rows: nSales + nAuctions + nStats, nSales, nAuctions, nStats },
  };
}

/** Rate limit first (cheapest to explain), then the budget. */
export function gate(reads: Reads, estimatedWrites: number, now: number): Gate {
  if (reads.limits.contributor >= BUDGET.perHour || reads.limits.network >= BUDGET.perHour) {
    return { ok: false, status: 429, code: 'rate_limited', message: `At most ${BUDGET.perHour} contributions per hour (per browser and per network). Try again later.`, retryAfter: Math.ceil((HOUR - (now % HOUR)) / 1000) };
  }
  if (reads.meta.writesToday + estimatedWrites > BUDGET.dailyWrites) {
    return { ok: false, status: 503, code: 'daily_budget', message: 'The community database has used its free daily write budget. Your local import is unaffected — contribute again after 00:00 UTC.', retryAfter: Math.ceil((DAY - (now % DAY)) / 1000) };
  }
  if (reads.meta.rows > BUDGET.maxRows) {
    return { ok: false, status: 503, code: 'row_cap', message: 'The community database is full until old rows are pruned (hourly). Try again later.', retryAfter: 3600 };
  }
  return { ok: true };
}

/* --------------------------------------- the plan --------------------------------------- */

/** Build every statement of one contribution. Pure given the reads, so it is cheap to test and to price BEFORE anything is written. */
export function plan(db: D1Database, c: Cleaned, id: Identity, reads: Reads, now: number): Plan {
  const p = (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args);
  const st: Stmt[] = [];
  const result: ContributeResult = {
    accepted: { auctions: c.auctions.length, sales: c.sales.length, stats: c.stats.length },
    new: zero(), duplicates: zero(), corroborated: zero(), alreadyYours: zero(), newlyVerified: zero(),
    dropped: c.dropped, estimatedWrites: 0,
  };
  let writes = 0;

  /* ---- sales ---- */
  {
    const reports = group(reads.saleReports);
    const fresh: CleanSale[] = [];
    const corroborate: string[] = [];
    for (const s of c.sales) {
      const v = verdict(reports.get(s.key), id);
      if (v === 'new') fresh.push(s);
      else {
        result.duplicates.sales++;
        if (v === 'corroborate') {
          corroborate.push(s.key);
          result.corroborated.sales++;
          if (reports.get(s.key)!.length === 1) result.newlyVerified.sales++;
        } else result.alreadyYours.sales++;
      }
    }
    result.new.sales = fresh.length;
    if (fresh.length) {
      st.push(
        p(
          `INSERT OR IGNORE INTO sales (sale_key, sport, type, player, serial, rating, rarity, price, per_rating, at, outcome, first_seen, last_seen, reports)
           SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'),
                  json_extract(value,'$[6]'), json_extract(value,'$[7]'), json_extract(value,'$[8]'), json_extract(value,'$[9]'), json_extract(value,'$[10]'), ?2, ?2, 1
           FROM json_each(?1)`,
          json(fresh.map((s) => [s.key, s.sport, s.type, s.player, s.serial, s.rating, s.rarity, s.price, s.perRating, s.at, s.outcome])), now,
        ),
      );
      writes += fresh.length * 2; // row + idx_sales_at
    }
    const needReport = [...fresh.map((s) => s.key), ...corroborate];
    if (needReport.length) {
      st.push(p('INSERT OR IGNORE INTO sale_reports (sale_key, contributor_hash, net) SELECT value, ?2, ?3 FROM json_each(?1)', json(needReport), id.hash, id.net));
      writes += needReport.length;
    }
    if (corroborate.length) {
      st.push(p('UPDATE sales SET reports = (SELECT COUNT(*) FROM sale_reports r WHERE r.sale_key = sales.sale_key), last_seen = ?2 WHERE sale_key IN (SELECT value FROM json_each(?1))', json(corroborate), now));
      writes += corroborate.length * 2; // row + the verified index when it crosses 2
    }
  }

  /* ---- auctions ---- */
  {
    const reports = group(reads.auctionReports);
    const state = new Map(reads.auctionState.map((a) => [a.k, a]));
    const fresh: CleanAuction[] = [];
    const updates: Array<[string, number, number, number, number, number, number | null, number | null, string | null, string | null, string | null, number]> = [];
    const points: Array<[string, number, number, number]> = [];
    const needReport: string[] = [];
    for (const a of c.auctions) {
      const ex = state.get(a.key);
      const v = verdict(reports.get(a.key), id);
      if (!ex) {
        fresh.push(a);
        points.push([a.key, a.seen, a.bid, a.bids]);
        needReport.push(a.key);
        continue;
      }
      result.duplicates.auctions++;
      if (v === 'corroborate') {
        needReport.push(a.key);
        result.corroborated.auctions++;
        if (reports.get(a.key)!.length === 1) result.newlyVerified.auctions++;
      } else result.alreadyYours.auctions++;
      // A newer sighting only rewrites the row when something moved (or the old one is stale): identical re-reports cost nothing.
      const changed = a.bid !== ex.bid || a.bids !== ex.bids || a.watchers !== ex.watchers;
      const s = a.seen > ex.last_seen && (changed || a.seen - ex.last_seen > 30 * 60_000) ? 1 : 0;
      const bidMoved = s === 1 && a.bid !== ex.bid && ex.npts < BUDGET.maxPoints;
      if (bidMoved) points.push([a.key, a.seen, a.bid, a.bids]);
      if (s === 1 || v === 'corroborate') updates.push([a.key, s, a.seen, a.bid, a.bids, a.watchers, a.timeLeftSec, a.endAt, a.play, a.team, a.season, bidMoved ? 1 : 0]);
    }
    result.new.auctions = fresh.length;
    if (fresh.length) {
      st.push(
        p(
          `INSERT OR IGNORE INTO auctions (auction_key, sport, season, rarity, type, rating, play, player, team, serial, bid, bids, watchers, time_left_sec, end_at, first_seen, last_seen, npts, reports)
           SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'),
                  json_extract(value,'$[6]'), json_extract(value,'$[7]'), json_extract(value,'$[8]'), json_extract(value,'$[9]'), json_extract(value,'$[10]'), json_extract(value,'$[11]'),
                  json_extract(value,'$[12]'), json_extract(value,'$[13]'), json_extract(value,'$[14]'), json_extract(value,'$[15]'), json_extract(value,'$[15]'), 1, 1
           FROM json_each(?1)`,
          json(fresh.map((a) => [a.key, a.sport, a.season, a.rarity, a.type, a.rating, a.play, a.player, a.team, a.serial, a.bid, a.bids, a.watchers, a.timeLeftSec, a.endAt, a.seen])),
        ),
      );
      writes += fresh.length * 2;
    }
    if (needReport.length) {
      st.push(p('INSERT OR IGNORE INTO auction_reports (auction_key, contributor_hash, net) SELECT value, ?2, ?3 FROM json_each(?1)', json(needReport), id.hash, id.net));
      writes += needReport.length;
    }
    if (points.length) {
      st.push(p(`INSERT OR IGNORE INTO auction_points (auction_key, seen_at, bid, bids) SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]') FROM json_each(?1)`, json(points)));
      writes += points.length;
    }
    if (updates.length) {
      st.push(
        p(
          `UPDATE auctions SET
             bid           = CASE WHEN j.s = 1 THEN j.b  ELSE auctions.bid END,
             bids          = CASE WHEN j.s = 1 THEN j.bs ELSE auctions.bids END,
             watchers      = CASE WHEN j.s = 1 THEN j.w  ELSE auctions.watchers END,
             time_left_sec = CASE WHEN j.s = 1 THEN j.tl ELSE auctions.time_left_sec END,
             end_at        = CASE WHEN j.s = 1 THEN j.ea ELSE auctions.end_at END,
             play          = CASE WHEN j.s = 1 THEN COALESCE(j.pl, auctions.play) ELSE auctions.play END,
             team          = CASE WHEN j.s = 1 THEN COALESCE(j.tm, auctions.team) ELSE auctions.team END,
             season        = CASE WHEN j.s = 1 THEN COALESCE(j.se, auctions.season) ELSE auctions.season END,
             last_seen     = CASE WHEN j.s = 1 THEN j.sn ELSE auctions.last_seen END,
             npts          = auctions.npts + j.p,
             reports       = (SELECT COUNT(*) FROM auction_reports r WHERE r.auction_key = auctions.auction_key)
           FROM (SELECT json_extract(value,'$[0]') AS k, json_extract(value,'$[1]') AS s, json_extract(value,'$[2]') AS sn, json_extract(value,'$[3]') AS b, json_extract(value,'$[4]') AS bs,
                        json_extract(value,'$[5]') AS w, json_extract(value,'$[6]') AS tl, json_extract(value,'$[7]') AS ea, json_extract(value,'$[8]') AS pl, json_extract(value,'$[9]') AS tm,
                        json_extract(value,'$[10]') AS se, json_extract(value,'$[11]') AS p FROM json_each(?1)) AS j
           WHERE auctions.auction_key = j.k AND (j.s = 0 OR j.sn > auctions.last_seen)`,
          json(updates),
        ),
      );
      writes += updates.length * 3; // row + idx_auctions_seen out and in
    }
  }

  /* ---- stats ---- */
  {
    const reports = group(reads.statReports);
    const fresh: CleanStat[] = [];
    const corroborate: string[] = [];
    for (const s of c.stats) {
      const v = verdict(reports.get(s.key), id);
      if (v === 'new') fresh.push(s);
      else {
        result.duplicates.stats++;
        if (v === 'corroborate') {
          corroborate.push(s.key);
          result.corroborated.stats++;
          if (reports.get(s.key)!.length === 1) result.newlyVerified.stats++;
        } else result.alreadyYours.stats++;
      }
    }
    result.new.stats = fresh.length;
    if (fresh.length) {
      st.push(
        p(
          `INSERT OR IGNORE INTO stats (stat_key, name, rating, rarity, serial, scope, win, median, median_per_rating, total_sales, premium, min, max, q1, q3, seen_at, first_seen, last_seen, reports)
           SELECT json_extract(value,'$[0]'), json_extract(value,'$[1]'), json_extract(value,'$[2]'), json_extract(value,'$[3]'), json_extract(value,'$[4]'), json_extract(value,'$[5]'),
                  json_extract(value,'$[6]'), json_extract(value,'$[7]'), json_extract(value,'$[8]'), json_extract(value,'$[9]'), json_extract(value,'$[10]'), json_extract(value,'$[11]'),
                  json_extract(value,'$[12]'), json_extract(value,'$[13]'), json_extract(value,'$[14]'), json_extract(value,'$[15]'), ?2, ?2, 1
           FROM json_each(?1)`,
          json(fresh.map((s) => [s.key, s.name, s.rating, s.rarity, s.serial, s.scope, s.win, s.median, s.medianPerRating, s.totalSales, s.premium, s.min, s.max, s.q1, s.q3, s.seen])), now,
        ),
      );
      writes += fresh.length * 2;
    }
    const needReport = [...fresh.map((s) => s.key), ...corroborate];
    if (needReport.length) {
      st.push(p('INSERT OR IGNORE INTO stat_reports (stat_key, contributor_hash, net) SELECT value, ?2, ?3 FROM json_each(?1)', json(needReport), id.hash, id.net));
      writes += needReport.length;
    }
    if (corroborate.length) {
      st.push(p('UPDATE stats SET reports = (SELECT COUNT(*) FROM stat_reports r WHERE r.stat_key = stats.stat_key), last_seen = ?2 WHERE stat_key IN (SELECT value FROM json_each(?1))', json(corroborate), now));
      writes += corroborate.length;
    }
  }

  /* ---- bookkeeping: contributor, rate-limit counters, meta (~10 rows) ---- */
  const fixed = 11 + (result.newlyVerified.sales ? 1 : 0) + (result.newlyVerified.auctions ? 1 : 0) + (result.newlyVerified.stats ? 1 : 0);
  const total = writes + fixed;
  result.estimatedWrites = total;
  const add = (k: string, n: number) => p("INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(v AS INTEGER) + CAST(excluded.v AS INTEGER) AS TEXT)", k, String(n));
  st.push(
    p('INSERT INTO contributors (contributor_hash, first_seen, last_seen, contributions) VALUES (?1, ?2, ?2, 1) ON CONFLICT(contributor_hash) DO UPDATE SET last_seen = ?2, contributions = contributions + 1', id.hash, now),
    p('INSERT INTO rate_limits (bucket, n, expires) VALUES (?1, 1, ?2) ON CONFLICT(bucket) DO UPDATE SET n = n + 1', id.buckets.contributor, now + 2 * HOUR),
    p('INSERT INTO rate_limits (bucket, n, expires) VALUES (?1, 1, ?2) ON CONFLICT(bucket) DO UPDATE SET n = n + 1', id.buckets.network, now + 2 * HOUR),
    add(`writes:${dayKey(now)}`, total),
    p("INSERT INTO meta (k, v) VALUES ('last_contribution', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v", String(now)),
  );
  if (result.new.sales) st.push(add('n_sales', result.new.sales));
  if (result.new.auctions) st.push(add('n_auctions', result.new.auctions));
  if (result.new.stats) st.push(add('n_stats', result.new.stats));
  if (result.newlyVerified.sales) st.push(add('v_sales', result.newlyVerified.sales));
  if (result.newlyVerified.auctions) st.push(add('v_auctions', result.newlyVerified.auctions));
  if (result.newlyVerified.stats) st.push(add('v_stats', result.newlyVerified.stats));
  return { statements: st, result, newCounts: result.new };
}

/** Price a contribution without writing (the reads are the same ones plan() will use). */
export const estimate = (db: D1Database, c: Cleaned, id: Identity, reads: Reads, now: number) => plan(db, c, id, reads, now).result.estimatedWrites;

/* ------------------------------------- pruning ------------------------------------- */

export interface PruneReport {
  ran: boolean;
  sales: number;
  auctions: number;
  stats: number;
  recounted: boolean;
}

/**
 * Retention and caps. Runs at most once an hour (a meta row is the lease, claimed with a conditional UPDATE so two requests
 * can't both prune) from inside the contribute path; `force` is for the row-cap guard. Deletes are bounded per run because every
 * deleted row is a write too. Exact row counts are re-read only every 6 h (COUNT(*) reads every row).
 */
export async function prune(db: D1Database, now: number, force = false): Promise<PruneReport> {
  const out: PruneReport = { ran: false, sales: 0, auctions: 0, stats: 0, recounted: false };
  if (!force) {
    const lease = await db.prepare("UPDATE meta SET v = ?1 WHERE k = 'last_prune' AND CAST(v AS INTEGER) <= ?2").bind(String(now), now - BUDGET.pruneEveryMs).run();
    if (!lease.meta.changes) return out;
  } else {
    await db.prepare("UPDATE meta SET v = ?1 WHERE k = 'last_prune'").bind(String(now)).run();
  }
  out.ran = true;
  const B = BUDGET.pruneBatch;
  const q = (sql: string, ...p: unknown[]) => db.prepare(sql).bind(...p);
  const [ns, na, nt] = ['n_sales', 'n_auctions', 'n_stats'];
  const counts = await db.prepare("SELECT k, v FROM meta WHERE k IN ('n_sales','n_auctions','n_stats','last_recount')").all<Row>();
  const m = new Map((counts.results ?? []).map((r) => [String(r.k), Number(r.v) || 0]));

  const over = (n: number, cap: number) => Math.min(B, Math.max(0, n - cap));
  const sel = await db.batch<Row>([
    q('SELECT sale_key AS k FROM sales WHERE at < ?1 LIMIT ?2', now - BUDGET.salesKeepDays * DAY, B),
    q('SELECT auction_key AS k FROM auctions WHERE last_seen < ?1 LIMIT ?2', now - BUDGET.auctionsKeepDays * DAY, B),
    q('SELECT stat_key AS k FROM stats WHERE seen_at < ?1 LIMIT ?2', now - BUDGET.statsKeepDays * DAY, B),
    q('SELECT sale_key AS k FROM sales ORDER BY at LIMIT ?1', over(m.get(ns) ?? 0, BUDGET.salesCap)),
    q('SELECT auction_key AS k FROM auctions ORDER BY last_seen LIMIT ?1', over(m.get(na) ?? 0, BUDGET.auctionsCap)),
    q('SELECT stat_key AS k FROM stats ORDER BY seen_at LIMIT ?1', over(m.get(nt) ?? 0, BUDGET.statsCap)),
  ]);
  const keys = (a: number, b: number) => [...new Set([...(sel[a].results ?? []), ...(sel[b].results ?? [])].map((r) => String(r.k)))];
  const sk = keys(0, 3);
  const ak = keys(1, 4);
  const tk = keys(2, 5);
  out.sales = sk.length;
  out.auctions = ak.length;
  out.stats = tk.length;

  const del: Stmt[] = [];
  const byKeys = (table: string, col: string, ks: string[]) => del.push(q(`DELETE FROM ${table} WHERE ${col} IN (SELECT value FROM json_each(?1))`, json(ks)));
  if (sk.length) (byKeys('sale_reports', 'sale_key', sk), byKeys('sales', 'sale_key', sk));
  if (ak.length) (byKeys('auction_points', 'auction_key', ak), byKeys('auction_reports', 'auction_key', ak), byKeys('auctions', 'auction_key', ak));
  if (tk.length) (byKeys('stat_reports', 'stat_key', tk), byKeys('stats', 'stat_key', tk));
  const add = (k: string, n: number) => q("INSERT INTO meta (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = CAST(MAX(0, CAST(v AS INTEGER) + CAST(excluded.v AS INTEGER)) AS TEXT)", k, String(n));
  if (sk.length) del.push(add(ns, -sk.length));
  if (ak.length) del.push(add(na, -ak.length));
  if (tk.length) del.push(add(nt, -tk.length));
  del.push(
    q('DELETE FROM rate_limits WHERE expires < ?1', now),
    q('DELETE FROM contributors WHERE last_seen < ?1', now - BUDGET.contributorsKeepDays * DAY),
    q("DELETE FROM meta WHERE k LIKE 'writes:%' AND k < ?1", `writes:${dayKey(now - 3 * DAY)}`),
  );
  await db.batch(del);

  if (force || now - (m.get('last_recount') ?? 0) >= BUDGET.recountEveryMs) {
    await recount(db, now);
    out.recounted = true;
  }
  return out;
}

export interface Summary {
  sales: number;
  salesVerified: number;
  auctions: number;
  auctionsVerified: number;
  stats: number;
  statsVerified: number;
  bySport: Record<string, { auctions: number; sales: number }>;
  asOf: number;
}

/** Exact counts + coverage by sport, stored as one meta row so GET ?kind=summary never has to scan a table. */
export async function recount(db: D1Database, now: number): Promise<Summary> {
  const q = (sql: string) => db.prepare(sql);
  const r = await db.batch<Row>([
    q('SELECT COUNT(*) AS n FROM sales'),
    q('SELECT COUNT(*) AS n FROM sales WHERE reports >= 2'),
    q('SELECT COUNT(*) AS n FROM auctions'),
    q('SELECT COUNT(*) AS n FROM auctions WHERE reports >= 2'),
    q('SELECT COUNT(*) AS n FROM stats'),
    q('SELECT COUNT(*) AS n FROM stats WHERE reports >= 2'),
    q('SELECT sport, COUNT(*) AS n FROM auctions GROUP BY sport'),
    q('SELECT sport, COUNT(*) AS n FROM sales WHERE sport IS NOT NULL GROUP BY sport'),
  ]);
  const n = (i: number) => Number(r[i].results?.[0]?.n) || 0;
  const bySport: Summary['bySport'] = {};
  for (const x of r[6].results ?? []) (bySport[String(x.sport)] ??= { auctions: 0, sales: 0 }).auctions = Number(x.n);
  for (const x of r[7].results ?? []) (bySport[String(x.sport)] ??= { auctions: 0, sales: 0 }).sales = Number(x.n);
  const s: Summary = { sales: n(0), salesVerified: n(1), auctions: n(2), auctionsVerified: n(3), stats: n(4), statsVerified: n(5), bySport, asOf: now };
  await db.batch([
    db.prepare("INSERT INTO meta (k, v) VALUES ('summary', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(json(s)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('n_sales', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(s.sales)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('n_auctions', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(s.auctions)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('n_stats', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(s.stats)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('v_sales', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(s.salesVerified)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('v_auctions', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(s.auctionsVerified)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('v_stats', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(s.statsVerified)),
    db.prepare("INSERT INTO meta (k, v) VALUES ('last_recount', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(now)),
  ]);
  return s;
}
