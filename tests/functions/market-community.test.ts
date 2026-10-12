import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequest as contribute } from '../../functions/api/market/contribute';
import { onRequest as community } from '../../functions/api/market/community';
import { BUDGET, prune, recount } from '../../functions/_lib/marketDb';
import { LIMITS } from '../../functions/_lib/marketValidate';
import { fakeD1, readText, type FakeD1 } from './_d1shim';

/**
 * Community market endpoints against a REAL SQLite engine (Node's built-in `node:sqlite`, wrapped by ./_d1shim.ts as a small D1
 * lookalike) with the real migration applied — so the SQL (json_each, UPDATE … FROM, partial index, ON CONFLICT) is executed, not mocked.
 */
const NOW = Date.parse('2026-10-11T18:00:00.000Z');
const FIXTURE = JSON.parse(readText('tests/fixtures/real/capture_sample.json'));
const cap = (mut?: (c: any) => void) => {
  const c = JSON.parse(JSON.stringify(FIXTURE));
  mut?.(c);
  return c;
};
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa'; // contributor ids (the browser generates 128 random bits; these just match the pattern)
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccccccccccc';
const J = (r: Response): Promise<any> => r.json() as Promise<any>;

let db: FakeD1;
let pending: Promise<unknown>[] = [];
const env = () => ({ MARKET_DB: db }) as any;
const settle = async () => {
  await Promise.all(pending);
  pending = [];
};
const post = async (body: unknown, ip: string | null = '203.0.113.1', init: { raw?: string; len?: number } = {}) => {
  const text = init.raw ?? JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (init.len != null) headers['content-length'] = String(init.len);
  const res = await (contribute as any)({ request: new Request('https://rax.test/api/market/contribute', { method: 'POST', body: text, headers }), env: env(), waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await settle();
  return res as Response;
};
const share = (capture: unknown, contributor: string, ip?: string | null) => post({ capture, contributor }, ip);
const get = async (qs: string) => {
  const res = await (community as any)({ request: new Request(`https://rax.test/api/market/community${qs}`), env: env(), waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await settle();
  return res as Response;
};
const one = (sql: string, ...p: unknown[]) => db.raw.prepare(sql).get(...p);
const all = (sql: string, ...p: unknown[]) => db.raw.prepare(sql).all(...p);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  db = fakeD1();
  pending = [];
});
afterEach(() => vi.useRealTimers());

describe('POST /api/market/contribute', () => {
  it('stores a capture, then recognises the same capture from another person as corroboration (reports = 2)', async () => {
    const r1 = await J(await share(cap(), A, '203.0.113.1'));
    expect(r1).toMatchObject({ ok: true, accepted: { auctions: 9, sales: 10, stats: 1 }, new: { auctions: 9, sales: 10, stats: 1 }, duplicates: { auctions: 0, sales: 0, stats: 0 }, dropped: { auctions: 0, sales: 0, stats: 0 } });
    expect(r1.message).toMatch(/20 new rows shared · 0 already known/);
    expect(one('SELECT COUNT(*) n FROM sales').n).toBe(10);
    expect(all('SELECT DISTINCT reports r FROM sales')).toEqual([{ r: 1 }]);

    // Someone else, on another network, captured the same sales
    const r2 = await J(await share(cap(), B, '198.51.100.7'));
    expect(r2).toMatchObject({ new: { auctions: 0, sales: 0, stats: 0 }, duplicates: { auctions: 9, sales: 10, stats: 1 }, corroborated: { auctions: 9, sales: 10, stats: 1 } });
    expect(r2.message).toMatch(/0 new rows shared · 20 already known \(20 now corroborated by you\)/);
    expect(one('SELECT COUNT(*) n FROM sales').n).toBe(10); // no duplicate rows
    expect(all('SELECT DISTINCT reports r FROM sales')).toEqual([{ r: 2 }]);
    expect(all('SELECT DISTINCT reports r FROM auctions')).toEqual([{ r: 2 }]);
    expect(all('SELECT DISTINCT reports r FROM stats')).toEqual([{ r: 2 }]);
    expect(one('SELECT COUNT(*) n FROM sale_reports').n).toBe(20);
    expect(one('SELECT COUNT(*) n FROM contributors').n).toBe(2);
  });

  it('one contributor, or one network, cannot vote twice', async () => {
    await share(cap(), A, '203.0.113.1');
    const again = await J(await share(cap(), A, '203.0.113.1'));
    expect(again).toMatchObject({ new: { sales: 0 }, corroborated: { sales: 0 }, alreadyYours: { sales: 10 } });
    // a brand-new random id from the SAME network (a Sybil, or a housemate) adds nothing either
    const sybil = await J(await share(cap(), C, '203.0.113.1'));
    expect(sybil).toMatchObject({ corroborated: { sales: 0, auctions: 0, stats: 0 }, alreadyYours: { sales: 10 } });
    expect(all('SELECT DISTINCT reports r FROM sales')).toEqual([{ r: 1 }]);
    // …but a different network does
    await share(cap(), C, '192.0.2.99');
    expect(all('SELECT DISTINCT reports r FROM sales')).toEqual([{ r: 2 }]);
  });

  it('a forged variant of a sale is its own unverified row — it never raises the genuine row, and the genuine row still verifies', async () => {
    await share(cap(), A, '203.0.113.1');
    const forged = cap((c) => (c.sales[0].price = 4000), );
    forged.sales[0].perRating = Math.round(4000 / 2.6);
    await share(forged, B, '198.51.100.7');
    const rows = all("SELECT price, reports FROM sales WHERE player = 'B. Robinson' AND serial = '#2073' ORDER BY price") as any[];
    expect(rows).toEqual([{ price: 100, reports: 1 }, { price: 4000, reports: 1 }]);
    await share(cap(), C, '192.0.2.99');
    expect(all("SELECT price, reports FROM sales WHERE serial = '#2073' ORDER BY price")).toEqual([{ price: 100, reports: 2 }, { price: 4000, reports: 1 }]);
    const verified = await J(await get('?kind=sales&minReports=2'));
    expect(verified.rows.every((r: any) => r.reports >= 2)).toBe(true);
    expect(verified.rows.map((r: any) => r.price)).not.toContain(4000);
  });

  it('writes in a handful of set-based statements, not one per row', async () => {
    await share(cap(), A, '203.0.113.1');
    // batch 1 = the six reads, batch 2 = the whole write (≤ 20 statements for 20 rows of data); the rest is the hourly prune
    expect(db.batches[0]).toBe(6);
    expect(db.batches[1]).toBeLessThanOrEqual(20);
    const r = await J(await share(cap(), B, '198.51.100.7'));
    expect(r.estimatedWrites).toBeLessThan(120);
  });

  it('drops implausible rows and says why, keeping the good ones', async () => {
    const c = cap((x) => {
      x.sales.push(
        { ...x.sales[0], serial: '#9001', rating: 99 }, // rating out of range
        { ...x.sales[0], serial: '#9002', at: '2026-10-12T00:00:00.000Z' }, // future
        { ...x.sales[0], serial: '#9003', at: '2006-05-01T00:00:00.000Z' }, // older than 10 years (older history is kept, absurd dates are not)
        { ...x.sales[0], serial: '#9004', price: 100, perRating: 70 }, // price / rating = 38.5, not 70
        { ...x.sales[0], serial: '#9005', rarity: 'Mythic' },
        { ...x.sales[0], serial: 'abc' },
        { ...x.sales[0], serial: '#9006', price: 6_000_000, perRating: 2307692 },
        { ...x.sales[0], serial: '#9007', player: '<script>alert(1)</script>' },
      );
      x.auctions.push({ ...x.auctions[0], serial: '#9010', bid: -5 }, { ...x.auctions[0], serial: '#9011', sport: 'QUIDDITCH' }, { ...x.auctions[0], serial: '#9012', seenAt: '2006-09-01T00:00:00.000Z' });
      x.stats.push({ ...x.stats[0], serial: '#9020', min: 500, median: 80 }); // min above the median
    });
    const r = await J(await share(c, A));
    expect(r.accepted).toEqual({ auctions: 9, sales: 10, stats: 1 });
    expect(r.dropped).toMatchObject({ sales: 8, auctions: 3, stats: 1 });
    expect(r.dropped.reasons).toMatchObject({ 'sales.rating': 1, 'sales.future': 1, 'sales.too_old': 1, 'sales.inconsistent': 1, 'sales.rarity': 1, 'sales.serial': 1, 'sales.price': 1, 'sales.player': 1, 'auctions.bid': 1, 'auctions.sport': 1, 'auctions.too_old': 1, 'stats.unordered': 1 });
    expect(one('SELECT COUNT(*) n FROM sales').n).toBe(10);
  });

  it('accepts Real\'s rounded per-rating figures (within 5% or half a Rax)', async () => {
    const r = await J(await share(cap((x) => (x.sales = [{ player: 'Test Player', rating: 12, rarity: 'Epic', serial: '#5', price: 10, perRating: 1, at: '2026-10-11T10:00:00.000Z', outcome: 'Sold' }])), A));
    expect(r.accepted.sales).toBe(1);
  });

  it('enforces the hard limits and the shape of the request', async () => {
    const big = (n: number) => Array.from({ length: n }, (_, i) => ({ ...FIXTURE.sales[0], serial: `#${i + 1}` }));
    expect((await share(cap((c) => (c.sales = big(LIMITS.sales + 1))), A)).status).toBe(413);
    expect((await share(cap((c) => (c.auctions = Array(LIMITS.auctions + 1).fill(FIXTURE.auctions[0]))), A)).status).toBe(413);
    expect((await share(cap((c) => (c.stats = Array(LIMITS.stats + 1).fill(FIXTURE.stats[0]))), A)).status).toBe(413);
    const tooBig = await post({ capture: cap(), contributor: A, pad: 'x'.repeat(LIMITS.bodyBytes) });
    expect(tooBig.status).toBe(413);
    expect((await post(null, '203.0.113.1', { raw: '{"capture":{}}', len: LIMITS.bodyBytes + 1 })).status).toBe(413);
    expect((await post(null, '203.0.113.1', { raw: 'not json' })).status).toBe(400);
    expect((await post({ capture: cap(), contributor: 'short' })).status).toBe(400);
    expect((await post({ capture: cap(), contributor: 'a b c d e f g h i j k l' })).status).toBe(400);
    expect((await share({ v: 2, kind: 'real-market' }, A)).status).toBe(400);
    expect((await J(await share(cap((c) => ((c.auctions = []), (c.sales = []), (c.stats = []))), A))).error).toBe('nothing_valid');
    expect(one('SELECT COUNT(*) n FROM sales').n).toBe(0);
    const get405 = await (contribute as any)({ request: new Request('https://rax.test/api/market/contribute'), env: env(), waitUntil: () => {} });
    expect(get405.status).toBe(405);
  });

  it('a full-size contribution is within the limits and one request', async () => {
    const sales = Array.from({ length: 500 }, (_, i) => ({ ...FIXTURE.sales[0], serial: `#${1000 + i}`, price: 100 + i, perRating: Math.round((100 + i) / 2.6) }));
    const auctions = Array.from({ length: 400 }, (_, i) => ({ ...FIXTURE.auctions[0], serial: `#${2000 + i}`, bid: 20 + i }));
    const body = JSON.stringify({ capture: cap((c) => ((c.sales = sales), (c.auctions = auctions))), contributor: A });
    expect(body.length).toBeLessThan(LIMITS.bodyBytes);
    const r = await J(await post(null, '203.0.113.1', { raw: body }));
    expect(r.new).toMatchObject({ sales: 500, auctions: 400 });
    expect(r.estimatedWrites).toBeLessThan(3500);
  });

  it('rate-limits per contributor and per network (12 an hour), and the window rolls over', async () => {
    for (let i = 0; i < BUDGET.perHour; i++) expect((await share(cap(), A, '203.0.113.1')).status).toBe(200);
    const blocked = await share(cap(), A, '203.0.113.1');
    expect(blocked.status).toBe(429);
    expect((await J(blocked)).error).toBe('rate_limited');
    // same contributor id from a new network: still limited (the id counts)
    expect((await share(cap(), A, '192.0.2.50')).status).toBe(429);
    // fresh ids from the same network: limited by the network bucket
    expect((await share(cap(), B, '203.0.113.1')).status).toBe(429);
    // an unrelated person is unaffected
    expect((await share(cap(), C, '198.51.100.9')).status).toBe(200);
    vi.setSystemTime(NOW + 61 * 60_000);
    expect((await share(cap(), A, '203.0.113.1')).status).toBe(200);
  });

  it('refuses when the daily write budget would be exceeded, with a clear message — and recovers the next UTC day', async () => {
    db.raw.prepare("INSERT INTO meta (k, v) VALUES ('writes:2026-10-11', ?)").run(String(BUDGET.dailyWrites - 5));
    const r = await share(cap(), A);
    expect(r.status).toBe(503);
    const b = await J(r);
    expect(b.error).toBe('daily_budget');
    expect(b.message).toMatch(/00:00 UTC/);
    expect(one('SELECT COUNT(*) n FROM sales').n).toBe(0);
    vi.setSystemTime(Date.parse('2026-10-12T00:05:00.000Z'));
    const ok = await share(cap((c) => c.sales.forEach((s: any) => (s.at = '2026-10-12T00:01:00.000Z'))), A);
    expect(ok.status).toBe(200);
  });

  it('tracks estimated writes per day in meta and stays well under the budget for ordinary use', async () => {
    await share(cap(), A, '203.0.113.1');
    await share(cap(), B, '198.51.100.7');
    const w = Number(one("SELECT v FROM meta WHERE k = 'writes:2026-10-11'").v);
    expect(w).toBeGreaterThan(50);
    expect(w).toBeLessThan(BUDGET.dailyWrites / 100);
  });

  it('a newer sighting of a live auction updates its bid and bid history; an older or unchanged one writes nothing', async () => {
    await share(cap(), A, '203.0.113.1');
    const key = "NFL|#1353|bijan robinson|RUSH|2.6";
    expect(one('SELECT bid, bids, npts, reports FROM auctions WHERE auction_key = ?', key)).toEqual({ bid: 110, bids: 1, npts: 1, reports: 1 });
    // B sees it a little later with a higher bid
    const later = cap((c) => c.auctions.forEach((a: any) => ((a.bid += 30), (a.bids += 1), (a.seenAt = '2026-10-11T17:50:00.000Z'))));
    const r = await J(await share(later, B, '198.51.100.7'));
    expect(r.corroborated.auctions).toBe(9);
    expect(one('SELECT bid, bids, npts, reports, last_seen FROM auctions WHERE auction_key = ?', key)).toEqual({ bid: 140, bids: 2, npts: 2, reports: 2, last_seen: Date.parse('2026-10-11T17:50:00.000Z') });
    expect(all('SELECT bid FROM auction_points WHERE auction_key = ? ORDER BY seen_at', key)).toEqual([{ bid: 110 }, { bid: 140 }]);
    // C reports an OLDER state (seen before A's): must not overwrite
    const older = cap((c) => c.auctions.forEach((a: any) => ((a.bid = 50), (a.seenAt = '2026-10-11T16:00:00.000Z'))));
    await share(older, C, '192.0.2.99');
    expect(one('SELECT bid, reports FROM auctions WHERE auction_key = ?', key)).toEqual({ bid: 140, reports: 3 });
    // time_left follows the newest sighting: end_at = seen + timer
    expect(one('SELECT end_at FROM auctions WHERE auction_key = ?', key).end_at).toBe(Date.parse('2026-10-11T17:50:00.000Z') + 432000 * 1000);
  });

  it('infers sport/type for a sale only when the same capture identifies the card unambiguously', async () => {
    await share(cap(), A);
    const row = one("SELECT sport, type FROM sales WHERE serial = '#2073'");
    expect(row).toEqual({ sport: 'NFL', type: 'RUSH' }); // "B. Robinson" 2.6 Common ⇄ the BIJAN ROBINSON 2.6 COMMON RUSH auction
  });

  it('stores no IP address, no username and no raw contributor id anywhere', async () => {
    await share(cap(), A, '203.0.113.1');
    await share(cap(), B, '198.51.100.7');
    const dump = JSON.stringify(
      ['sales', 'sale_reports', 'auctions', 'auction_points', 'auction_reports', 'stats', 'stat_reports', 'contributors', 'rate_limits', 'meta'].map((t) => all(`SELECT * FROM ${t}`)),
    );
    for (const secret of ['203.0.113.1', '198.51.100.7', '203.0.113', A, B]) expect(dump).not.toContain(secret);
    const net = all('SELECT DISTINCT net FROM sale_reports').map((r: any) => r.net);
    expect(net.every((n: string) => n.length === 5)).toBe(true); // 20 bits: ~4,000 addresses share each value
    expect(all('SELECT contributor_hash h FROM contributors').every((r: any) => /^[0-9a-f]{32}$/.test(r.h))).toBe(true);
  });

  it('503 when the database is not bound', async () => {
    const res = await (contribute as any)({ request: new Request('https://rax.test/api/market/contribute', { method: 'POST', body: '{}' }), env: {}, waitUntil: () => {} });
    expect(res.status).toBe(503);
  });
});

describe('history is kept', () => {
  it('housekeeping never deletes sales, auctions, stats, bid points or their reports, however old', async () => {
    await share(cap(), A, '203.0.113.1');
    const old = NOW - 400 * 86_400_000;
    db.raw.prepare('UPDATE sales SET at = ?').run(old);
    db.raw.prepare('UPDATE auctions SET last_seen = ?').run(old);
    db.raw.prepare('UPDATE stats SET seen_at = ?').run(old);
    const count = () => ['sales', 'sale_reports', 'auctions', 'auction_points', 'auction_reports', 'stats', 'stat_reports'].map((t) => one(`SELECT COUNT(*) n FROM ${t}`).n);
    const before = count();
    const rep = await prune(db as any, NOW + 5 * 365 * 86_400_000, true);
    expect(rep).toMatchObject({ ran: true, sales: 0, auctions: 0, stats: 0, recounted: true });
    expect(count()).toEqual(before);
    expect(Number(one("SELECT v FROM meta WHERE k = 'n_sales'").v)).toBe(10);
  });

  it('accepts a capture older than the old 7-day / 120-day windows and keeps its own timestamps', async () => {
    const r = await J(await share(cap((x) => {
      x.at = '2026-08-01T12:00:00.000Z';
      x.sales[0].at = '2026-03-02T10:00:00.000Z';
      x.auctions.forEach((a: any) => (a.seenAt = '2026-08-01T12:00:00.000Z'));
      x.stats.forEach((s: any) => (s.seenAt = '2026-08-01T12:00:00.000Z'));
    }), A));
    expect(r).toMatchObject({ ok: true, accepted: { auctions: 9, sales: 10, stats: 1 }, capturedAt: '2026-08-01T12:00:00.000Z' });
    expect(one('SELECT MIN(at) m FROM sales').m).toBe(Date.parse('2026-03-02T10:00:00.000Z'));
    expect(one('SELECT MIN(last_seen) m FROM auctions').m).toBe(Date.parse('2026-08-01T12:00:00.000Z'));
  });

  it('timestamps everything: receipt time on the response, every report, and a ledger row per contribution', async () => {
    const r = await J(await share(cap(), A, '203.0.113.1'));
    expect(r.receivedAt).toBe(new Date(NOW).toISOString());
    for (const t of ['sale_reports', 'auction_reports', 'stat_reports']) expect(one(`SELECT COUNT(*) n FROM ${t} WHERE reported_at = ?`, NOW).n).toBe(one(`SELECT COUNT(*) n FROM ${t}`).n);
    expect(one('SELECT COUNT(*) n FROM sales WHERE first_seen = ? AND last_seen = ?', NOW, NOW).n).toBe(10);
    expect(one('SELECT * FROM contributions')).toMatchObject({ received_at: NOW, auctions: 9, sales: 10, stats: 1, new_rows: 20 });
    vi.setSystemTime(NOW + 60_000);
    await share(cap(), B, '198.51.100.7');
    expect(all('SELECT received_at, new_rows FROM contributions ORDER BY id').map((x: any) => [x.received_at, x.new_rows])).toEqual([[NOW, 20], [NOW + 60_000, 0]]);
  });

  it('a row ceiling refuses new rows instead of deleting old ones', async () => {
    await share(cap(), A, '203.0.113.1');
    db.raw.prepare("UPDATE meta SET v = ? WHERE k = 'n_sales'").run(String(BUDGET.maxRows + 1));
    const r = await share(cap(), B, '198.51.100.7');
    expect(r.status).toBe(503);
    expect(JSON.stringify(await J(r))).toContain('row_cap');
    expect(one('SELECT COUNT(*) n FROM sales').n).toBe(10);
  });

  it('keeps the full bid history of an auction (up to the new 500-point ceiling)', async () => {
    await share(cap(), A, '203.0.113.1');
    expect(BUDGET.maxPoints).toBe(500);
  });

  it('rate-limit rows expire and are pruned', async () => {
    await share(cap(), A, '203.0.113.1');
    expect(one('SELECT COUNT(*) n FROM rate_limits').n).toBe(2);
    await prune(db as any, NOW + 3 * 3_600_000, true);
    expect(one('SELECT COUNT(*) n FROM rate_limits').n).toBe(0);
  });
});

describe('GET /api/market/community', () => {
  beforeEach(async () => {
    await share(cap(), A, '203.0.113.1');
    await share(cap((c) => (c.sales = c.sales.slice(0, 3))), B, '198.51.100.7');
    await recount(db as any, NOW);
  });

  it('summary: totals, verified, contributors, last update, coverage by sport — without scanning the data tables', async () => {
    const res = await get('?kind=summary');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const s = await J(res);
    expect(s.rows).toEqual({ sales: 10, auctions: 9, stats: 1, total: 20 });
    expect(s.verified).toMatchObject({ sales: 3, auctions: 9, stats: 1 });
    expect(s.contributors).toBe(2);
    expect(s.lastContribution).toBe(new Date(NOW).toISOString());
    expect(s.bySport.NFL.auctions).toBeGreaterThan(0);
    expect(JSON.stringify(s)).not.toMatch(/contributor_hash|net/);
  });

  it('verified counts are live (no recount needed) the moment a row reaches two reporters', async () => {
    db = fakeD1();
    await share(cap(), A, '203.0.113.1');
    expect((await J(await get('?kind=summary'))).verified).toMatchObject({ sales: 0, auctions: 0, stats: 0 });
    await share(cap(), B, '198.51.100.7');
    expect((await J(await get('?kind=summary'))).verified).toMatchObject({ sales: 10, auctions: 9, stats: 1 });
    await share(cap(), C, '192.0.2.99'); // a third reporter does not double-count
    expect((await J(await get('?kind=summary'))).verified).toMatchObject({ sales: 10, auctions: 9, stats: 1 });
  });

  it('sales: newest first, every row carries reports; minReports=2 is the verified view', async () => {
    const all1 = await J(await get('?kind=sales'));
    expect(all1.count).toBe(10);
    expect(all1.rows[0]).toMatchObject({ player: 'B. Robinson', rating: 2.6, rarity: 'COMMON', price: 100, perRating: 38, outcome: 'Sold', reports: 2, sport: 'NFL' });
    expect(all1.rows[0].at >= all1.rows[1].at).toBe(true);
    const ver = await J(await get('?kind=sales&minReports=2'));
    expect(ver.count).toBe(3);
    expect(ver.rows.every((r: any) => r.reports === 2)).toBe(true);
    const lim = await J(await get('?kind=sales&limit=4'));
    expect(lim.count).toBe(4);
    expect(lim.truncated).toBe(true);
    expect((await J(await get('?kind=sales&since=2026-10-11T00:00:00Z'))).count).toBeLessThan(10);
  });

  it('the verified query uses the partial index (so it reads verified rows only)', async () => {
    const plan = db.raw.prepare('EXPLAIN QUERY PLAN SELECT * FROM sales WHERE at >= ? AND reports >= 2 AND reports >= ? ORDER BY at DESC LIMIT ?').all(0, 2, 10).map((r: any) => r.detail).join(' ');
    expect(plan).toMatch(/idx_sales_verified/);
  });

  it('auctions: latest state plus bid history, filterable by sport', async () => {
    const r = await J(await get('?kind=auctions&sport=NFL'));
    expect(r.count).toBe(9);
    const bijan = r.rows.find((x: any) => x.player === 'BIJAN ROBINSON');
    expect(bijan).toMatchObject({ sport: 'NFL', rarity: 'COMMON', type: 'RUSH', rating: 2.6, bid: 110, serial: '#1353', timeLeftSec: 432000, reports: 2 });
    expect(bijan.points.length).toBe(1);
    expect((await J(await get('?kind=auctions&sport=MLB'))).count).toBe(0);
    expect((await J(await get('?kind=auctions&minReports=3'))).count).toBe(0);
  });

  it('stats: Real’s own market figures with reports', async () => {
    const r = await J(await get('?kind=stats'));
    expect(r.rows[0]).toMatchObject({ name: 'Bijan Robinson', scope: 'Card', window: '30d', median: 80, medianPerRating: 31, totalSales: 529, min: 20, max: 250, q1: 60, q3: 110, reports: 2 });
  });

  it('rejects an unknown kind, clamps the limit, handles OPTIONS and a missing database', async () => {
    expect((await get('?kind=users')).status).toBe(400);
    expect((await J(await get('?kind=sales&limit=999999'))).count).toBe(10);
    const opt = await (community as any)({ request: new Request('https://rax.test/api/market/community', { method: 'OPTIONS' }), env: env(), waitUntil: () => {} });
    expect(opt.status).toBe(204);
    const none = await (community as any)({ request: new Request('https://rax.test/api/market/community'), env: {}, waitUntil: () => {} });
    expect(none.status).toBe(503);
  });

  it('an empty database answers with zeros, not an error', async () => {
    db = fakeD1();
    const s = await J(await get('?kind=summary'));
    expect(s.rows.total).toBe(0);
    expect(s.contributors).toBe(0);
    expect(s.lastContribution).toBeNull();
    expect((await J(await get('?kind=sales'))).rows).toEqual([]);
  });
});
