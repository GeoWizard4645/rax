import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { parseRealCapture, type RealAuctionRow, type RealMarketCapture, type RealMarketStat, type RealSale } from '../../shared/realMarketCapture';
import {
  MIN_REF_SALES,
  abbrevKey,
  auctionStatus,
  bidVsFair,
  buildRefContext,
  coverageOf,
  coverageText,
  dailyAggregate,
  dailyByPool,
  deriveRealSeries,
  describePrune,
  emptyStore,
  fairTable,
  fitToBudget,
  mergeCapture,
  packStore,
  premiumOf,
  pruneStore,
  radarItems,
  realFair,
  realForecastInputs,
  realSpikes,
  referenceFor,
  samePlayerName,
  saleObservations,
  sourceLabel,
  timeLeftLabel,
  timerGranularitySec,
  unpackStore,
  type RealStore,
} from '../../shared/realMarket';

const fx = fs.readFileSync('tests/fixtures/real/capture_sample.json', 'utf8');
const CAP = parseRealCapture(fx).capture!;
const CAP_AT = Date.parse(CAP.at); // 2026-10-11T17:23:03.727Z
const SEEN = Date.parse('2026-10-11T17:22:55.716Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const load = (cap: RealMarketCapture = CAP, base: RealStore = emptyStore(), now = CAP_AT) => mergeCapture(base, cap, now);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const auction = (o: Partial<RealAuctionRow>): RealAuctionRow => ({ sport: 'NFL', season: '2026-27', rarity: 'COMMON', type: 'RUSH', rating: 2, play: '1-YD RUSH', player: 'PLAYER ONE', team: 'ATL', serial: '#1', bid: 40, bids: 1, watchers: 0, timeLeftSec: 7200, seenAt: '2026-10-11T17:22:55.716Z', ...o });
const stat = (o: Partial<RealMarketStat>): RealMarketStat => ({ name: 'Bijan Robinson', rating: 2.6, rarity: 'Common', serial: '#1353', scope: 'Card', window: '30d', median: 80, medianPerRating: 31, totalSales: 529, premium: 2.15, min: 20, max: 250, q1: 60, q3: 110, seenAt: '2026-10-11T17:22:55.716Z', ...o });
const sale = (o: Partial<RealSale>): RealSale => ({ player: 'B. Robinson', rating: 2.6, rarity: 'Common', serial: '#1', price: 80, perRating: 31, at: '2026-10-10T17:00:00.000Z', outcome: 'Sold', ...o });
const cap = (o: Partial<RealMarketCapture>): RealMarketCapture => ({ v: 1, kind: 'real-market', at: '2026-10-11T17:23:03.727Z', auctions: [], stats: [], sales: [], ...o });

describe('names', () => {
  it('abbreviated and full names meet on initial + surname', () => {
    expect(abbrevKey('BIJAN ROBINSON')).toBe('b robinson');
    expect(abbrevKey('B. Robinson')).toBe('b robinson');
    expect(abbrevKey("KA'IMI FAIRBAIRN")).toBe('k fairbairn');
    expect(abbrevKey('Marvin Harrison Jr.')).toBe(abbrevKey('M. Harrison Jr.'));
    expect(samePlayerName('BIJAN ROBINSON', 'Bijan Robinson')).toBe(true);
    expect(samePlayerName('Bijan Robinson', 'B. Robinson')).toBe(true);
    expect(samePlayerName('Bijan Robinson', 'Brian Robinson')).toBe(false);
    expect(samePlayerName('J. Allen', 'Josh Allen')).toBe(true);
  });
});

describe('mergeCapture: dedupe and history', () => {
  it('loads the real fixture', () => {
    const { store, report } = load();
    expect(report).toMatchObject({ auctionsNew: 9, salesNew: 10, statsNew: 1 });
    expect(store.auctions).toHaveLength(9);
    expect(store.sales).toHaveLength(10);
    expect(store.stats).toHaveLength(1);
    expect(store.meta).toMatchObject({ imports: 1, lastCaptureAt: CAP.at });
    // the Hansen player has two different cards (PERFORMANCE and DEFENSE/ST) at the same serial: two auctions, not one
    expect(store.auctions.filter((a) => a.player === 'JAKE HANSEN')).toHaveLength(2);
  });

  it('importing the same capture twice changes nothing', () => {
    const once = load().store;
    const twice = load(CAP, once);
    expect(twice.report).toMatchObject({ auctionsNew: 0, auctionsUnchanged: 9, salesNew: 0, salesDuplicate: 10, statsNew: 0, statsReplaced: 1 });
    expect(twice.store.auctions).toHaveLength(9);
    expect(twice.store.sales).toHaveLength(10);
    expect(twice.store.auctions.every((a) => a.pts.length === 1)).toBe(true);
    expect(twice.store.stats).toHaveLength(1);
  });

  it('keeps the latest sighting and every differing sighting as its own seenAt point', () => {
    const a = load().store;
    const later = clone(CAP);
    const bijan = later.auctions.find((x) => x.player === 'BIJAN ROBINSON')!;
    bijan.bid = 130;
    bijan.bids = 3;
    bijan.timeLeftSec = 432000 - 1800;
    bijan.seenAt = '2026-10-11T17:52:55.716Z';
    later.sales = [{ ...CAP.sales[0] }, { player: 'B. Robinson', rating: 2.6, rarity: 'Common', serial: '#2900', price: 120, perRating: 46, at: '2026-10-11T17:40:00.000Z', outcome: 'Sold' }];
    later.at = '2026-10-11T17:53:00.000Z';
    const m = load(later, a, Date.parse(later.at));
    const b = m.store.auctions.find((x) => x.player === 'BIJAN ROBINSON')!;
    expect(b.pts).toHaveLength(2);
    expect(b.pts.map((p) => p.bid)).toEqual([110, 130]);
    expect(b.pts[1].bids).toBe(3);
    expect(m.store.auctions).toHaveLength(9); // same key, not a new row
    expect(m.report).toMatchObject({ auctionsUpdated: 1, auctionsNew: 0, salesNew: 1, salesDuplicate: 1 });
    expect(m.store.sales).toHaveLength(11);
    expect(m.store.meta).toMatchObject({ imports: 2, lastCaptureAt: later.at });
  });

  it('collapses runs of identical sightings to first + last', () => {
    let s = load(cap({ auctions: [auction({ seenAt: '2026-10-11T10:00:00Z' })] })).store;
    for (const h of [11, 12, 13, 14]) s = load(cap({ auctions: [auction({ seenAt: `2026-10-11T${h}:00:00Z` })] }), s).store;
    const pts = s.auctions[0].pts;
    expect(pts.map((p) => p.at.slice(11, 13))).toEqual(['10', '14']);
    s = load(cap({ auctions: [auction({ seenAt: '2026-10-11T15:00:00Z', bid: 50 })] }), s).store;
    expect(s.auctions[0].pts.map((p) => p.bid)).toEqual([40, 40, 50]);
  });

  it('a card seen again after its timer ran out is a relisting with fresh history', () => {
    let s = load(cap({ auctions: [auction({ timeLeftSec: 3600, bid: 40 })] })).store;
    s = load(cap({ auctions: [auction({ seenAt: '2026-10-13T09:00:00Z', timeLeftSec: 86400, bid: 25 })] }), s).store;
    expect(s.auctions).toHaveLength(1);
    expect(s.auctions[0]).toMatchObject({ relists: 1 });
    expect(s.auctions[0].pts.map((p) => p.bid)).toEqual([25]);
  });

  it('out-of-order imports slot in by time without resetting', () => {
    let s = load(cap({ auctions: [auction({ seenAt: '2026-10-11T18:00:00Z', bid: 60, timeLeftSec: 86400 })] })).store;
    s = load(cap({ auctions: [auction({ seenAt: '2026-10-11T17:00:00Z', bid: 50, timeLeftSec: 86400 })] }), s).store;
    expect(s.auctions[0].pts.map((p) => p.bid)).toEqual([50, 60]);
    expect(s.auctions[0].relists).toBe(0);
  });

  it('sales are keyed by saleKey; a completed sale beats a listing that never closed', () => {
    const open = sale({ serial: '#7', outcome: 'Open' });
    let s = load(cap({ sales: [open] })).store;
    expect(s.sales[0].outcome).toBe('Open');
    s = load(cap({ sales: [{ ...open, outcome: 'Sold' }, { ...open }] }), s).store;
    expect(s.sales).toHaveLength(1);
    expect(s.sales[0].outcome).toBe('Sold');
  });

  it('stats dedupe by name + serial + scope + window + day; another day or scope is another row', () => {
    let s = load(cap({ stats: [stat({ median: 80 })] })).store;
    s = load(cap({ stats: [stat({ median: 82, seenAt: '2026-10-11T20:00:00Z' })] }), s).store;
    expect(s.stats).toHaveLength(1);
    expect(s.stats[0].median).toBe(82);
    s = load(cap({ stats: [stat({ median: 70, seenAt: '2026-10-10T09:00:00Z' }), stat({ scope: 'Player', seenAt: '2026-10-11T20:00:00Z' })] }), s).store;
    expect(s.stats).toHaveLength(3);
    // an older sighting the same day never replaces a newer one
    s = load(cap({ stats: [stat({ median: 1, seenAt: '2026-10-11T01:00:00Z' })] }), s).store;
    expect(s.stats.find((x) => x.scope === 'Card' && x.seenAt.startsWith('2026-10-11'))!.median).toBe(82);
  });
});

describe('storage: pack, prune, budget', () => {
  it('round-trips the compact form', () => {
    const { store } = load();
    const text = packStore(store);
    const back = unpackStore(text);
    expect(back.auctions).toEqual(store.auctions);
    expect(back.sales).toEqual(store.sales);
    expect(back.stats).toEqual(store.stats);
    expect(back.meta).toEqual(store.meta);
    expect(text.length).toBeLessThan(JSON.stringify(store).length); // compact on purpose
    expect(unpackStore('garbage').sales).toEqual([]);
    expect(unpackStore(null).auctions).toEqual([]);
  });

  it('prunes auctions that ended long ago, caps sales to the newest, and says what went', () => {
    const base = load().store;
    const now = SEEN + 20 * DAY; // everything in the fixture ended more than 14 days ago
    const r = pruneStore(base, now);
    expect(r.store.auctions).toHaveLength(0);
    expect(r.report.auctionsEnded).toBe(9);
    expect(r.store.sales).toHaveLength(10);

    const recent = pruneStore(base, SEEN + 6 * DAY); // ended, but within 14 days: kept
    expect(recent.store.auctions).toHaveLength(9);

    const capped = pruneStore(base, CAP_AT, { sales: 4, stats: 2000, auctions: 3000, endedKeepDays: 14, statsKeepDays: 90 });
    expect(capped.store.sales).toHaveLength(4);
    expect(capped.report.salesOverCap).toBe(6);
    expect(capped.store.sales[0].at).toBe('2026-10-11T03:35:00.000Z'); // newest kept
    expect(describePrune(capped.report, { sales: 4, stats: 2000, auctions: 3000, endedKeepDays: 14, statsKeepDays: 90 })).toMatch(/6 oldest sales/);
    expect(describePrune({ auctionsEnded: 0, auctionsOverCap: 0, salesOverCap: 0, statsOld: 0, statsOverCap: 0 })).toBe('');
  });

  it('never prunes a live auction for the auction cap before an ended one', () => {
    const base = load(cap({ auctions: [auction({ serial: '#1', timeLeftSec: 100 }), auction({ serial: '#2', timeLeftSec: 86400 * 3 })] })).store;
    const r = pruneStore(base, SEEN + 2 * HOUR, { sales: 1, stats: 1, auctions: 1, endedKeepDays: 14, statsKeepDays: 90 });
    expect(r.store.auctions.map((a) => a.serial)).toEqual(['#2']);
    expect(r.report.auctionsOverCap).toBe(1);
  });

  it('fitToBudget shrinks to the budget, dropping stale auctions then old sales', () => {
    const sales: RealSale[] = Array.from({ length: 800 }, (_, i) => sale({ serial: `#${i}`, price: 50 + (i % 40), at: new Date(Date.UTC(2026, 9, 1) + i * HOUR).toISOString() }));
    const base = load(cap({ sales, auctions: [auction({ serial: '#9', timeLeftSec: 60 })] })).store;
    const full = packStore(base).length;
    const r = fitToBudget(base, Math.floor(full / 3), SEEN + 3 * DAY);
    expect(r.chars).toBeLessThanOrEqual(Math.floor(full / 3));
    expect(r.report.auctionsOverCap).toBe(1); // the stale auction goes first
    expect(r.report.salesOverCap).toBeGreaterThan(0);
    // the newest sales survive
    expect(r.store.sales[0].serial).toBe('#799');
    expect(fitToBudget(base, full + 10, SEEN).store).toBe(base);
  });
});

describe('ended-auction detection', () => {
  const { store } = load();
  const get = (p: string, type?: string) => store.auctions.find((a) => a.player === p && (!type || a.type === type))!;
  it('granularity follows the displayed unit', () => {
    expect([timerGranularitySec(14400), timerGranularitySec(432000), timerGranularitySec(1800), timerGranularitySec(45)]).toEqual([3600, 86400, 60, 1]);
  });
  it('live before seenAt + timeLeft, closing within one timer unit after, ended beyond', () => {
    const stafford = get('MATTHEW STAFFORD'); // "1h" at 17:22:55
    expect(auctionStatus(stafford, SEEN + 30 * 60_000)).toMatchObject({ state: 'live', secondsLeft: 1800 });
    expect(auctionStatus(stafford, SEEN + 3600_000 + 5 * 60_000).state).toBe('closing');
    expect(auctionStatus(stafford, SEEN + 2 * 3600_000 + 1000).state).toBe('ended');
    const bijan = get('BIJAN ROBINSON'); // "5d"
    expect(auctionStatus(bijan, SEEN + 4 * DAY).state).toBe('live');
    expect(auctionStatus(bijan, SEEN + 5 * DAY + 1000).state).toBe('closing');
    expect(auctionStatus(bijan, SEEN + 6 * DAY + 1000).state).toBe('ended');
    expect(auctionStatus(bijan, SEEN + 4 * DAY).endAt).toBe(SEEN + 5 * DAY);
  });
  it('an unknown timer is unknown, never "live"', () => {
    const s = load(cap({ auctions: [auction({ timeLeftSec: null })] })).store;
    expect(auctionStatus(s.auctions[0], SEEN)).toEqual({ state: 'unknown', endAt: null, secondsLeft: null });
  });
  it('labels', () => {
    expect([timeLeftLabel(432000), timeLeftLabel(14400), timeLeftLabel(2700), timeLeftLabel(0), timeLeftLabel(null)]).toEqual(['5d 0h', '4h 0m', '45m', 'ended', '—']);
  });
});

describe('reference prices', () => {
  const all = load().store;
  const item = (s: RealStore, player = 'BIJAN ROBINSON', now = CAP_AT) => radarItems(s, now).find((i) => i.auction.player === player)!;

  it('Bijan Robinson: bid 110 on a 2.6 against Real’s own 31 per rating = +36.5%', () => {
    const i = item(all);
    expect(i.bid).toBe(110);
    expect(i.perRating).toBeCloseTo(110 / 2.6, 10);
    expect(i.ref).toMatchObject({ kind: 'card-stats', perRating: 31, n: 529, thin: false, weak: false });
    expect(i.premium).toBeCloseTo(((110 / 2.6) / 31 - 1) * 100, 10);
    expect(i.premium!).toBeCloseTo(36.4766, 3);
    expect(i.fair).toBeCloseTo(80.6, 10);
    expect(i.ref!.detail).toMatch(/529 sales/);
  });

  it('(a) card stats beat (b) player stats beat (c) sales pool', () => {
    const withPlayer = { ...all, stats: [...all.stats, stat({ scope: 'Player', medianPerRating: 40, median: 104, totalSales: 900 })] };
    expect(item(withPlayer).ref!.kind).toBe('card-stats');
    const noCard = { ...withPlayer, stats: withPlayer.stats.filter((s) => s.scope === 'Player') };
    expect(item(noCard).ref).toMatchObject({ kind: 'player-stats', perRating: 40, n: 900 });
    const salesOnly = { ...all, stats: [] };
    const r = item(salesOnly).ref!;
    // ten captured sales of that card, which the captured auction identifies as NFL / COMMON / RUSH: median price 80 → 80 / 2.6
    expect(r).toMatchObject({ kind: 'sales-pool', n: 10, thin: false });
    expect(r.perRating).toBeCloseTo(80 / 2.6, 10);
    expect(item(salesOnly).premium!).toBeCloseTo(((110 / 2.6) / (80 / 2.6) - 1) * 100, 8);
    expect(item(salesOnly).premium!).toBeCloseTo(37.5, 8);
  });

  it('a reference resting on fewer than 5 sales is shown but gives no premium; a sturdier lower-priority one wins when it exists', () => {
    expect(MIN_REF_SALES).toBe(5);
    const thinStat = { ...all, stats: [stat({ totalSales: 4 })], sales: [] };
    const t = item(thinStat);
    expect(t.ref).toMatchObject({ kind: 'card-stats', n: 4, thin: true });
    expect(t.premium).toBeNull();
    expect(item({ ...thinStat, stats: [stat({ totalSales: 5 })] }).premium).not.toBeNull();
    expect(item({ ...thinStat, stats: [stat({ totalSales: null })] }).ref!.thin).toBe(true);
    // thin card stats but ten captured sales → the sales pool backs the number instead
    const both = { ...all, stats: [stat({ totalSales: 3 })] };
    expect(item(both).ref).toMatchObject({ kind: 'sales-pool', n: 10 });
    expect(item(both).premium).not.toBeNull();
    expect(premiumOf(50, null)).toBeNull();
  });

  it('stats without a usable per-rating are skipped, median ÷ rating stands in when the per-rating is missing', () => {
    const noPpr = { ...all, stats: [stat({ medianPerRating: null, median: 78 })] };
    expect(item(noPpr).ref!.perRating).toBeCloseTo(78 / 2.6, 10);
    const none = { ...all, stats: [stat({ medianPerRating: null, median: null })], sales: [] };
    expect(item(none).ref).toBeNull();
  });

  it('(d) live auctions of the same sport + rarity + type, excluding itself, need 5 others', () => {
    const rows = Array.from({ length: 6 }, (_, i) => auction({ player: `P${i}`, serial: `#${i}`, rating: 2, bid: 40 + i * 2 })); // ppr 20,21,22,23,24,25
    const s = load(cap({ auctions: rows })).store;
    const first = radarItems(s, SEEN).find((i) => i.auction.player === 'P0')!;
    expect(first.ref).toMatchObject({ kind: 'live-auctions', n: 5, thin: false });
    expect(first.ref!.perRating).toBe(23); // median of the other five: 21..25
    expect(first.premium!).toBeCloseTo((20 / 23 - 1) * 100, 8);
    const four = load(cap({ auctions: rows.slice(0, 5) })).store;
    const f = radarItems(four, SEEN).find((i) => i.auction.player === 'P0')!;
    expect(f.ref).toMatchObject({ kind: 'live-auctions', n: 4, thin: true });
    expect(f.premium).toBeNull();
    // ended auctions are not references
    const ended = radarItems(s, SEEN + 3 * DAY).find((i) => i.auction.player === 'P0')!;
    expect(ended.ref).toBeNull();
  });

  it('(e) rarity-wide sales are the weak last resort', () => {
    const sales = Array.from({ length: 6 }, (_, i) => sale({ player: `Z${i}. Nobody`, serial: `#${i}`, price: 20 + i, rating: 2 })); // not in any captured auction
    const s = load(cap({ auctions: [auction({ player: 'LONE PLAYER' })], sales })).store;
    const i = radarItems(s, SEEN)[0];
    expect(i.ref).toMatchObject({ kind: 'sales-rarity', weak: true, n: 6, thin: false });
    expect(i.ref!.detail).toMatch(/Weak/);
  });

  it('Accepted / Open / No Sale rows are never counted as sale prices', () => {
    const rows = Array.from({ length: 8 }, (_, i) => sale({ serial: `#${i}`, outcome: i < 3 ? 'Sold' : i < 5 ? 'Accepted' : i < 7 ? 'Open' : 'No Sale' }));
    const s = load(cap({ auctions: [auction({ player: 'BIJAN ROBINSON', rating: 2.6 })], sales: rows })).store;
    expect(saleObservations(s)).toHaveLength(3);
    expect(radarItems(s, SEEN)[0].ref).toMatchObject({ kind: 'sales-pool', n: 3, thin: true });
  });

  it('referenceFor matches the card by name + rating + rarity, ignoring the serial the stat was opened on', () => {
    const ctx = buildRefContext(all, CAP_AT);
    const other = { ...all.auctions.find((a) => a.player === 'BIJAN ROBINSON')!, serial: '#9999', key: 'x' };
    expect(referenceFor(other, ctx)).toMatchObject({ kind: 'card-stats', perRating: 31 });
    expect(referenceFor({ ...other, rating: 4.2 }, ctx)?.kind).not.toBe('card-stats');
  });

  it('bidVsFair keeps live auctions with a trustworthy reference only', () => {
    const pts = bidVsFair(radarItems(all, CAP_AT));
    expect(pts).toHaveLength(1);
    expect(pts[0]).toMatchObject({ bid: 110, kind: 'card-stats', n: 529 });
    expect(pts[0].fair).toBeCloseTo(80.6, 10);
    expect(bidVsFair(radarItems(all, SEEN + 9 * DAY))).toHaveLength(0);
  });
});

describe('coverage and provenance', () => {
  it('counts what was captured', () => {
    const c = coverageOf(load().store, CAP_AT);
    expect(c).toMatchObject({ sales: 10, priceSales: 10, salesDays: 3, cardsWithStats: 1, auctions: 9, liveAuctions: 9, imports: 1 });
    expect(c.spanDays).toBeCloseTo((Date.parse('2026-10-11T03:35:00Z') - Date.parse('2026-10-09T20:45:00Z')) / DAY, 6);
    expect(coverageText(c)).toBe('10 sales over 3 days, 1 card with market stats');
    expect(sourceLabel(c, CAP_AT + 3 * HOUR)).toBe('Real marketplace (captured by you, 3 h ago)');
    expect(sourceLabel(c, CAP_AT + 10 * 60_000)).toBe('Real marketplace (captured by you, 10 min ago)');
  });
});

describe('daily aggregation of captured sales', () => {
  const obs = saleObservations(load().store);
  it('is by UTC day with real timestamps, median price per rating and volume', () => {
    expect(obs).toHaveLength(10);
    const d = dailyAggregate(obs);
    expect(d.map((x) => [x.day, x.n])).toEqual([['2026-10-09', 1], ['2026-10-10', 7], ['2026-10-11', 2]]);
    expect(d[2].medianPrice).toBe(100);
    expect(d[2].medianPpr).toBeCloseTo(100 / 2.6, 10);
    expect(d[1].medianPrice).toBe(80); // 40,40,60,80,80,80,90
    expect(d[1].medianPpr).toBeCloseTo(80 / 2.6, 10);
    expect(d[1].raxVolume).toBe(40 + 90 + 80 + 80 + 80 + 40 + 60);
    expect(d[0]).toMatchObject({ n: 1, medianPrice: 110, minPpr: 110 / 2.6, maxPpr: 110 / 2.6 });
  });
  it('pools by sport + rarity + type through the captured auctions; the unmatched stay out of the narrower pools', () => {
    expect([...dailyByPool(obs, 'sport+rarity+type').keys()]).toEqual(['NFL|common|RUSH']);
    expect([...dailyByPool(obs, 'rarity').keys()]).toEqual(['common']);
    const noAuctions = saleObservations(load(cap({ sales: CAP.sales })).store);
    expect(noAuctions.every((o) => o.sport === null)).toBe(true);
    expect(dailyByPool(noAuctions, 'sport+rarity').size).toBe(0);
    expect(dailyByPool(noAuctions, 'rarity').size).toBe(1);
  });
  it('a card whose sport/type the auctions leave ambiguous is not guessed', () => {
    const s = load(cap({ auctions: [auction({ player: 'BIJAN ROBINSON', rating: 2.6, type: 'RUSH' }), auction({ player: 'BIJAN ROBINSON', rating: 2.6, type: 'CATCH', serial: '#2' })], sales: CAP.sales })).store;
    expect(saleObservations(s).every((o) => o.type === null)).toBe(true);
  });
  it('series: one card (Bijan) with its full name and sport, plus the Common pool', () => {
    const d = deriveRealSeries(load().store);
    expect(d.asOf).toBe(Date.parse('2026-10-11T03:35:00Z'));
    expect(d.series.map((s) => [s.kind, s.playerName, s.sales, s.days])).toEqual([['card', 'Bijan Robinson', 10, 3], ['pool', 'All Common cards', 10, 3]]);
    const card = d.series[0];
    expect(card).toMatchObject({ sport: 'NFL', rating: 2.6, rarity: 'Common', perRating: false });
    expect(d.series[1]).toMatchObject({ rating: 1, perRating: true, sport: 'ALL' });
    expect(card.points.reduce((a, p) => a + p.volume, 0)).toBe(10);
    // 17:05, 17:07, 17:08, 17:09 on 10-10 share an hour: open = first sale, close = last
    const hr = card.points.find((p) => p.t === Date.parse('2026-10-10T17:00:00Z'))!;
    expect(hr).toMatchObject({ volume: 4, open: 80, close: 90, high: 90, low: 80 });
  });
});

describe('fair-value table', () => {
  it('lists Real’s own stats with the live bid next to it', () => {
    const t = fairTable(load().store, CAP_AT);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ name: 'Bijan Robinson', median: 80, medianPerRating: 31, totalSales: 529, q1: 60, q3: 110, min: 20, max: 250, scope: 'Card' });
    expect(t[0].inAuction!.bid).toBe(110);
    expect(t[0].inAuction!.perRating).toBeCloseTo(110 / 2.6, 10);
    expect(fairTable(load().store, SEEN + 9 * DAY)[0].inAuction).toBeNull();
  });
});

/** A card with `perDay` sales on each of `days` consecutive days ending at AS_OF. */
const AS_OF = Date.UTC(2026, 9, 11, 12);
function history(days: number, perDay: number, price: (d: number, i: number) => number, recent?: number[], player = 'Q. Test'): RealSale[] {
  const out: RealSale[] = [];
  let n = 0;
  for (let k = 1; k <= days; k++) for (let i = 0; i < perDay; i++) out.push(sale({ player, serial: `#${n++}`, rating: 4, rarity: 'Rare', price: price(k, i), at: new Date(AS_OF - k * DAY - (i + 1) * HOUR).toISOString() }));
  (recent ?? []).forEach((p, i) => out.push(sale({ player, serial: `#${n++}`, rating: 4, rarity: 'Rare', price: p, at: new Date(AS_OF - (i + 1) * HOUR).toISOString() })));
  return out;
}

describe('price spikes on real sales', () => {
  const flat = (k: number, i: number) => 100 + ((k + i) % 3) - 1;
  it('flags a 24h median far above the earlier windows', () => {
    const d = deriveRealSeries(load(cap({ sales: history(7, 3, flat, [150, 152, 148]) })).store);
    const r = realSpikes(d);
    expect(r.eligible).toBe(1);
    expect(r.spikes).toHaveLength(1);
    expect(r.spikes[0]).toMatchObject({ playerName: 'Q. Test', volume24h: 3, avgBid24h: 150 });
    expect(r.spikes[0].z).toBeGreaterThan(2);
    expect(r.spikes[0].avgBidBaseline).toBeCloseTo(100, 0);
  });
  it('does not flag a flat series, but it is tested', () => {
    const r = realSpikes(deriveRealSeries(load(cap({ sales: history(7, 3, flat, [100, 101, 99]) })).store));
    expect(r).toMatchObject({ eligible: 1, spikes: [] });
  });
  it('refuses to test thin data and says why', () => {
    for (const sales of [history(7, 3, flat, [150, 152]), history(2, 3, flat, [150, 152, 148]), history(7, 1, flat, [150, 152, 148]), load().store.sales]) {
      const r = realSpikes(deriveRealSeries(load(cap({ sales })).store));
      expect(r.eligible).toBe(0);
      expect(r.spikes).toEqual([]);
      expect(r.reason).toMatch(/needs/);
    }
  });
  it('requires a real rise, not just a statistical one', () => {
    const tight = (k: number) => 100 + (k % 2) * 0.1;
    const r = realSpikes(deriveRealSeries(load(cap({ sales: history(7, 3, tight, [105, 105, 105]) })).store));
    expect(r.eligible).toBe(1);
    expect(r.spikes).toEqual([]); // z is large but +5% is under the 15% floor
  });
});

describe('forecast gating and inputs', () => {
  it('days of sales are counted per distinct UTC day; fewer than 5 means no forecast', () => {
    const d3 = deriveRealSeries(load().store);
    const f3 = realForecastInputs(d3, d3.series[0].key)!;
    expect(f3.daily).toHaveLength(3);
    expect(f3.source).toBe('real');
    expect(f3.currentPpr).toBeCloseTo(100 / 2.6, 10);
    const d5 = deriveRealSeries(load(cap({ sales: history(5, 3, (k) => 100 + k) })).store);
    const f5 = realForecastInputs(d5, d5.series[0].key)!;
    expect(f5.daily).toHaveLength(5);
    expect(f5.daily[0].t).toBeLessThan(f5.daily[4].t);
    expect(f5.daily.every((x) => x.volume === 3)).toBe(true);
    expect(realForecastInputs(d5, 'nope')).toBeNull();
  });
  it('peers are other cards of the same rarity', () => {
    const sales = [...history(6, 3, (k) => 100 + k * 3, undefined, 'Q. Test'), ...history(6, 3, (k) => 50 + k, undefined, 'W. Other')];
    const d = deriveRealSeries(load(cap({ sales })).store);
    const f = realForecastInputs(d, d.series.find((s) => s.playerName === 'Q. Test')!.key)!;
    expect(f.peers.n).toBe(1);
    expect(f.peers.scope).toBe('rarity');
    expect(f.peers.sdLogRet).toBeGreaterThanOrEqual(0);
  });
  it('realFair needs four cards before it fits anything', () => {
    const d = deriveRealSeries(load().store);
    expect(realFair(d, 'ALL').points).toEqual([]);
    const sales = ['A', 'B', 'C', 'D', 'E'].flatMap((n, i) => history(2, 2, () => 50 + i * 20, undefined, `${n}. Card`).map((s) => ({ ...s, rating: 2 + i })));
    const f = realFair(deriveRealSeries(load(cap({ sales })).store), 'ALL');
    expect(f.points).toHaveLength(5);
    expect(f.model.slope).toBeGreaterThan(0);
  });
});

describe('browser store: import into storage', async () => {
  const { importRealCapture, loadRealMarket, saveRealMarket, clearRealMarket, REAL_MARKET_KEY } = await import('../../src/lib/realMarketStore');
  const fake = (limit = Infinity) => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { if (v.length > limit) throw new Error('QuotaExceededError'); m.set(k, v); }, removeItem: (k: string) => void m.delete(k) };
  };
  it('accumulates across imports and reports counts', () => {
    const st = fake();
    const a = importRealCapture(fx, st, CAP_AT);
    expect(a.ok).toBe(true);
    expect(a.message).toMatch(/9 auctions \(9 new/);
    expect(a.message).toMatch(/Stored now: 10 sales over 3 days, 1 card with market stats/);
    const second = clone(CAP);
    second.sales = [{ player: 'B. Robinson', rating: 2.6, rarity: 'Common', serial: '#3000', price: 90, perRating: 35, at: '2026-10-12T01:00:00.000Z', outcome: 'Sold' }];
    second.auctions = []; second.stats = [];
    second.at = '2026-10-12T02:00:00.000Z';
    const b = importRealCapture(JSON.stringify(second), st, Date.parse(second.at));
    expect(b.ok).toBe(true);
    const s = loadRealMarket(st);
    expect(s.sales).toHaveLength(11);
    expect(s.auctions).toHaveLength(9);
    expect(s.meta.imports).toBe(2);
    clearRealMarket(st);
    expect(st.m.has(REAL_MARKET_KEY)).toBe(false);
  });
  it('rejects garbage and empty captures without touching storage', () => {
    const st = fake();
    expect(importRealCapture('nope', st).ok).toBe(false);
    expect(importRealCapture(JSON.stringify(cap({})), st).message).toMatch(/empty/);
    expect(st.m.size).toBe(0);
  });
  it('guards the quota: drops the oldest and says so, or refuses and keeps what it had', () => {
    const sales: RealSale[] = Array.from({ length: 600 }, (_, i) => sale({ serial: `#${i}`, price: 50 + (i % 40), at: new Date(Date.UTC(2026, 9, 1) + i * HOUR).toISOString() }));
    const st = fake(12_000);
    const r = importRealCapture(JSON.stringify(cap({ sales })), st, CAP_AT);
    expect(r.ok).toBe(true);
    expect(r.pruned!.salesOverCap).toBeGreaterThan(0);
    expect(r.message).toMatch(/Dropped .* oldest sales/);
    const kept = loadRealMarket(st).sales;
    expect(kept.length).toBeLessThan(600);
    expect(kept[0].serial).toBe('#599'); // newest survive
    const tiny = fake(10);
    const before = tiny.m.size;
    const bad = importRealCapture(fx, tiny, CAP_AT);
    expect(bad.ok).toBe(false);
    expect(bad.message).toMatch(/storage is full/);
    expect(tiny.m.size).toBe(before);
    expect(saveRealMarket(emptyStore(), CAP_AT, null).ok).toBe(false);
  });
});
