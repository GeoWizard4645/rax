/** Read side of the community market database (GET /api/market/community). Times go out as ISO strings; rows carry `reports`. */
import type { Summary } from './marketDb';

type Row = Record<string, unknown>;
export interface ReadOpts {
  sport: string;
  since: number;
  minReports: number;
  limit: number;
}
const iso = (ms: unknown) => (ms == null ? null : new Date(Number(ms)).toISOString());
const num = (x: unknown) => (x == null ? null : Number(x));

/** `reports >= 2` is spelled out so SQLite can use the partial index idx_sales_verified (a bound parameter can't prove the predicate). */
const verifiedClause = (min: number) => (min >= 2 ? 'AND reports >= 2 AND reports >= ?' : 'AND reports >= ?');

export async function readSales(db: D1Database, o: ReadOpts) {
  const sport = o.sport ? 'AND (sport = ? OR sport IS NULL)' : '';
  const args = [o.since, o.minReports, ...(o.sport ? [o.sport] : []), o.limit];
  const r = await db
    .prepare(`SELECT sport, type, player, serial, rating, rarity, price, per_rating, at, outcome, reports, first_seen, last_seen FROM sales WHERE at >= ? ${verifiedClause(o.minReports)} ${sport} ORDER BY at DESC LIMIT ?`)
    .bind(...args)
    .all<Row>();
  const rows = (r.results ?? []).map((x) => ({
    sport: (x.sport as string | null) ?? null, type: (x.type as string | null) ?? null, player: x.player, serial: x.serial, rating: num(x.rating), rarity: x.rarity,
    price: num(x.price), perRating: num(x.per_rating), at: iso(x.at), outcome: (x.outcome as string | null) ?? null, reports: num(x.reports), firstSeen: iso(x.first_seen), lastSeen: iso(x.last_seen),
  }));
  return { count: rows.length, truncated: rows.length >= o.limit, rows };
}

export async function readAuctions(db: D1Database, o: ReadOpts) {
  const sport = o.sport ? 'AND sport = ?' : '';
  const args = [o.since, o.minReports, ...(o.sport ? [o.sport] : []), o.limit];
  const r = await db
    .prepare(`SELECT auction_key, sport, season, rarity, type, rating, play, player, team, serial, bid, bids, watchers, time_left_sec, end_at, first_seen, last_seen, reports FROM auctions WHERE last_seen >= ? AND reports >= ? ${sport} ORDER BY last_seen DESC LIMIT ?`)
    .bind(...args)
    .all<Row>();
  const list = r.results ?? [];
  const pts = new Map<string, Array<[number, number, number]>>();
  if (list.length) {
    const p = await db
      .prepare('SELECT auction_key AS k, seen_at, bid, bids FROM auction_points WHERE auction_key IN (SELECT value FROM json_each(?1)) ORDER BY seen_at')
      .bind(JSON.stringify(list.map((x) => x.auction_key)))
      .all<Row>();
    for (const x of p.results ?? []) {
      const k = String(x.k);
      (pts.get(k) ?? pts.set(k, []).get(k)!).push([Number(x.seen_at), Number(x.bid), Number(x.bids)]);
    }
  }
  const rows = list.map((x) => ({
    sport: x.sport, season: (x.season as string | null) ?? null, rarity: x.rarity, type: x.type, rating: num(x.rating), play: (x.play as string | null) ?? null, player: x.player, team: (x.team as string | null) ?? null,
    serial: x.serial, bid: num(x.bid), bids: num(x.bids), watchers: num(x.watchers), timeLeftSec: num(x.time_left_sec), endAt: iso(x.end_at), firstSeen: iso(x.first_seen), lastSeen: iso(x.last_seen), reports: num(x.reports),
    /** earlier bid changes: [time, bid, bids] (the row itself is the newest point) */
    points: (pts.get(String(x.auction_key)) ?? []).map(([t, b, n]) => [iso(t), b, n]),
  }));
  return { count: rows.length, truncated: rows.length >= o.limit, rows };
}

export async function readStats(db: D1Database, o: ReadOpts) {
  // Stats carry no sport of their own (the card's sport is resolved client-side from the auctions), so `sport` does not filter them.
  const r = await db
    .prepare('SELECT name, rating, rarity, serial, scope, win, median, median_per_rating, total_sales, premium, min, max, q1, q3, seen_at, reports FROM stats WHERE seen_at >= ? AND reports >= ? ORDER BY seen_at DESC LIMIT ?')
    .bind(o.since, o.minReports, o.limit)
    .all<Row>();
  const rows = (r.results ?? []).map((x) => ({
    name: x.name, rating: num(x.rating), rarity: x.rarity, serial: x.serial, scope: (x.scope as string | null) ?? null, window: (x.win as string | null) ?? null, median: num(x.median),
    medianPerRating: num(x.median_per_rating), totalSales: num(x.total_sales), premium: num(x.premium), min: num(x.min), max: num(x.max), q1: num(x.q1), q3: num(x.q3), seenAt: iso(x.seen_at), reports: num(x.reports),
  }));
  return { count: rows.length, truncated: rows.length >= o.limit, rows };
}

export async function readSummary(db: D1Database, now: number) {
  const r = await db.batch<Row>([
    db.prepare("SELECT k, v FROM meta WHERE k IN ('summary','n_sales','n_auctions','n_stats','v_sales','v_auctions','v_stats','last_contribution')"),
    db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(last_seen >= ?1), 0) AS active FROM contributors').bind(now - 30 * 86_400_000),
  ]);
  const meta = new Map((r[0].results ?? []).map((x) => [String(x.k), String(x.v)]));
  let exact: Summary | null = null;
  try {
    exact = meta.get('summary') ? (JSON.parse(meta.get('summary')!) as Summary) : null;
  } catch {
    exact = null;
  }
  const sales = Number(meta.get('n_sales')) || 0;
  const auctions = Number(meta.get('n_auctions')) || 0;
  const stats = Number(meta.get('n_stats')) || 0;
  const last = Number(meta.get('last_contribution')) || 0;
  const v = (k: string) => Math.max(0, Number(meta.get(k)) || 0);
  const c = r[1].results?.[0] ?? {};
  return {
    rows: { sales, auctions, stats, total: sales + auctions + stats },
    // live counters (bumped when a row reaches 2 reporters); re-read exactly at each recount
    verified: { sales: Math.min(sales, v('v_sales')), auctions: Math.min(auctions, v('v_auctions')), stats: Math.min(stats, v('v_stats')), exactAsOf: exact ? iso(exact.asOf) : null },
    contributors: Number(c.n) || 0,
    contributors30d: Number(c.active) || 0,
    lastContribution: last ? iso(last) : null,
    bySport: exact?.bySport ?? {},
    note: 'Counts are kept by the write path (approximate between hourly/6-hourly recounts); "verified" rows were reported by at least 2 distinct contributors.',
  };
}
