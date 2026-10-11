import { describe, expect, it } from 'vitest';
import {
  DAY, HOUR, MIN_HISTORY_DAYS, aggregateBoard, appendSample, coverage, currentState, detectRateSpike, docToSeries, emptyDoc, mergeSeed,
  plausibleSample, playerPoints, rateBaselines, rbKey, summarizeRates, type RbAgg, type RbHistDoc,
} from '../../shared/rbHistory';
import { blankBoard, type RbBoard, type RbOffer } from '../../shared/rateboard';
import { buildForecastInputs } from '../../shared/market';
import { buildCandles } from '../../shared/formulas';

const T0 = Date.UTC(2026, 9, 1, 0, 0); // a UTC hour boundary
const offer = (id: string, user: string, player: string, rate: number, sport: RbOffer['sport'] = 'NFL', ts = T0): RbOffer => ({ id, user, sport, player, rate, link: `https://x/${id}`, ts });
const boardOf = (offers: RbOffer[], extra: Partial<RbBoard> = {}): RbBoard => {
  const b = blankBoard();
  for (const o of offers) b.users[o.user] = { name: o.user, hasPassword: true };
  return { ...b, offers, ...extra };
};
const agg = (key: string, best: number, buyers = 1, offers = buyers, over: Partial<RbAgg> = {}): RbAgg => ({ key, sport: 'NFL', name: key, best, med: best, buyers, offers, house: 0, ...over });

describe('aggregateBoard', () => {
  it('groups offers per player (accent/suffix-insensitive), ignoring banned users', () => {
    const b = boardOf([
      offer('1', 'a', 'Josh Allen', 20),
      offer('2', 'b', 'josh allen', 30),
      offer('3', 'b', 'Josh Allen Jr.', 10), // same buyer, same normalised player
      offer('4', 'c', 'Bo Nix', 15),
      offer('5', 'd', 'Bo Nix', 99),
    ]);
    b.users.d.banned = true;
    const out = aggregateBoard(b);
    const allen = out.find((x) => x.key === rbKey('NFL', 'Josh Allen'))!;
    expect(allen).toMatchObject({ best: 30, buyers: 2, offers: 3, med: 20 });
    const nix = out.find((x) => x.name === 'Bo Nix')!;
    expect(nix).toMatchObject({ best: 15, buyers: 1, offers: 1 });
  });
  it('reports the house rate when the player is on the house list', () => {
    const b = boardOf([offer('1', 'a', 'Julian Love', 8)], { house: [{ sport: 'NFL', player: 'Julian Love', rate: 12 }] });
    expect(aggregateBoard(b)[0].house).toBe(12);
  });
});

describe('appendSample', () => {
  it('stores only changes: an unchanged board adds no points but still counts as a sample', () => {
    let d = appendSample(null, [agg('NFL:a', 10)], T0);
    d = appendSample(d, [agg('NFL:a', 10)], T0 + 10 * 60_000);
    d = appendSample(d, [agg('NFL:a', 10)], T0 + 20 * 60_000);
    expect(d.players['NFL:a'].pts).toHaveLength(1);
    expect(d.samples).toBe(3);
    d = appendSample(d, [agg('NFL:a', 15)], T0 + 30 * 60_000);
    expect(d.players['NFL:a'].pts.map((p) => p[1])).toEqual([10, 15]);
  });
  it('records a gap when a player’s offers disappear, and only once', () => {
    let d = appendSample(null, [agg('NFL:a', 10), agg('NFL:b', 5)], T0);
    d = appendSample(d, [agg('NFL:b', 5)], T0 + HOUR);
    d = appendSample(d, [agg('NFL:b', 5)], T0 + 2 * HOUR);
    expect(d.players['NFL:a'].pts.map((p) => p[1])).toEqual([10, 0]);
    expect(currentState(d.players['NFL:a'])).toBeNull();
  });
  it('tracks sampled hours and ignores out-of-order samples', () => {
    let d = appendSample(null, [agg('NFL:a', 10)], T0 + 5 * 60_000);
    d = appendSample(d, [agg('NFL:a', 10)], T0 + 25 * 60_000);
    d = appendSample(d, [agg('NFL:a', 10)], T0 + 3 * HOUR);
    expect(d.hours).toEqual([T0 / HOUR, T0 / HOUR + 3]);
    const before = d.samples;
    d = appendSample(d, [agg('NFL:a', 99)], T0); // older than lastAt
    expect(d.samples).toBe(before);
    expect(d.players['NFL:a'].pts).toHaveLength(1);
  });
  it('prunes change points older than 35 days but keeps the anchor state', () => {
    let d = appendSample(null, [agg('NFL:a', 10)], T0);
    d = appendSample(d, [agg('NFL:a', 12)], T0 + 5 * DAY);
    d = appendSample(d, [agg('NFL:a', 14)], T0 + 50 * DAY);
    const pts = d.players['NFL:a'].pts;
    expect(pts[0][1]).toBe(12); // 10 fell out, 12 is the anchor (last point before the cutoff)
    expect(pts[pts.length - 1][1]).toBe(14);
    expect(d.hours.every((h) => h * HOUR >= T0 + 50 * DAY - 35 * DAY - HOUR)).toBe(true);
  });
});

describe('plausibleSample', () => {
  it('rejects an empty board and a halved board, accepts normal churn', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => agg(`NFL:p${i}`, 10));
    const d = appendSample(null, many(100), T0);
    expect(plausibleSample(d, [])).toBe(false);
    expect(plausibleSample(d, many(30))).toBe(false);
    expect(plausibleSample(d, many(95))).toBe(true);
    expect(plausibleSample(null, many(3))).toBe(true);
  });
});

describe('series reconstruction', () => {
  it('forward-fills the change log across sampled hours only (gaps stay gaps)', () => {
    let d = appendSample(null, [agg('NFL:a', 10, 2)], T0); // hour 0
    d = appendSample(d, [agg('NFL:a', 10, 2)], T0 + HOUR); // hour 1 (no change)
    d = appendSample(d, [agg('NFL:a', 20, 3)], T0 + 5 * HOUR + 30 * 60_000); // hour 5, a change mid-hour
    const now = T0 + 6 * HOUR;
    const pts = playerPoints(d.players['NFL:a'], d.hours, now);
    expect(pts.map((p) => (p.t - T0) / HOUR)).toEqual([0, 1, 5]); // hours 2–4 were never sampled
    expect(pts[1]).toMatchObject({ open: 10, close: 10, high: 10, low: 10, volume: 2 });
    expect(pts[2]).toMatchObject({ open: 10, close: 20, high: 20, low: 10, volume: 3 });
  });
  it('skips hours with no bids and exposes rating = 1 / rarity = null (unknown, not invented)', () => {
    let d = appendSample(null, [agg('NFL:a', 10)], T0);
    d = appendSample(d, [], T0 + HOUR); // everyone left
    d = appendSample(d, [agg('NFL:a', 12)], T0 + 2 * HOUR);
    const s = docToSeries(d, T0 + 3 * HOUR)[0];
    expect(s.rating).toBe(1);
    expect(s.rarity).toBeNull();
    expect(s.points.map((p) => (p.t - T0) / HOUR)).toEqual([0, 2]);
  });
  it('feeds the existing candle builder', () => {
    let d = emptyDoc();
    for (let h = 0; h < 48; h++) d = appendSample(d, [agg('NFL:a', h < 24 ? 10 : 15)], T0 + h * HOUR);
    const s = docToSeries(d, T0 + 48 * HOUR)[0];
    const c = buildCandles(s, T0 + 48 * HOUR, '7d');
    expect(c.length).toBeGreaterThan(1);
    expect(c[0].open).toBe(10);
    expect(c[c.length - 1].close).toBe(15);
  });
});

describe('coverage / readiness', () => {
  const run = (hours: number, step = 1) => {
    let d: RbHistDoc | null = null;
    for (let h = 0; h <= hours; h += step) d = appendSample(d, [agg('NFL:a', 10)], T0 + h * HOUR);
    return d!;
  };
  it('is not ready before 3 days or 48 sampled hours', () => {
    expect(coverage(null, true).ready).toBe(false);
    expect(coverage(run(30), true).ready).toBe(false);
    expect(coverage(run(80, 6), true).ready).toBe(false); // 3+ days of span but only ~14 hours sampled
    const c = coverage(run(80), true);
    expect(c.ready).toBe(true);
    expect(c.spanDays).toBeGreaterThanOrEqual(MIN_HISTORY_DAYS);
  });
  it('rateBaselines is empty until ready, then the 7-day median of the median bid rate', () => {
    expect(rateBaselines(run(30), T0 + 30 * HOUR)).toEqual({});
    const d = run(80);
    expect(rateBaselines(d, T0 + 80 * HOUR)['NFL:a']).toBe(10);
  });
});

describe('mergeSeed', () => {
  const seedDoc = () => {
    let d: RbHistDoc | null = null;
    for (let h = 0; h < 10; h++) d = appendSample(d, [agg('NFL:a', 8), agg('NFL:old', 5)], T0 - 100 * HOUR + h * HOUR);
    return d!;
  };
  it('puts older seed points under the live ones, once, without touching live data', () => {
    const live = appendSample(null, [agg('NFL:a', 8), agg('NFL:new', 3)], T0);
    const merged = mergeSeed(live, seedDoc());
    expect(merged.seeded).toBe(10);
    expect(merged.samples).toBe(11);
    expect(merged.firstAt).toBeLessThan(T0);
    expect(merged.players['NFL:old']).toBeDefined();
    expect(merged.players['NFL:new'].pts).toHaveLength(1);
    expect(merged.hours.length).toBe(11);
    expect(merged.hours).toEqual([...merged.hours].sort((a, b) => a - b));
    const again = mergeSeed(merged, seedDoc());
    expect(again.samples).toBe(11);
  });
  it('becomes the document when there is no live history yet', () => {
    const m = mergeSeed(null, seedDoc());
    expect(m.seeded).toBe(10);
    expect(m.samples).toBe(10);
  });
});

describe('detectRateSpike / summarizeRates', () => {
  const build = (jump: { rate?: number; buyers?: number } | null) => {
    let d: RbHistDoc | null = null;
    const hours = 9 * 24;
    for (let h = 0; h < hours; h++) {
      const late = h >= hours - 20;
      d = appendSample(d, [agg('NFL:a', late && jump?.rate ? jump.rate : 10, late && jump?.buyers ? jump.buyers : 2), agg('NFL:flat', 20, 3)], T0 + h * HOUR);
    }
    return { d: d!, now: T0 + hours * HOUR };
  };
  it('flags a material jump in the best bid rate and a surge in buyers', () => {
    const r = build({ rate: 25 });
    const s = docToSeries(r.d, r.now).find((x) => x.key === 'NFL:a')!;
    const sp = detectRateSpike(s, r.now)!;
    expect(sp.z).toBeGreaterThan(2);
    expect(sp.avgBid24h).toBeGreaterThan(sp.avgBidBaseline * 1.2);
    expect(sp.rarity).toBeNull();
    const b = build({ buyers: 6 });
    const sb = docToSeries(b.d, b.now).find((x) => x.key === 'NFL:a')!;
    expect(detectRateSpike(sb, b.now)!.volume24h).toBeGreaterThan(2);
  });
  it('does not flag flat series or small wobbles, and needs 3 baseline days', () => {
    const r = build(null);
    for (const s of docToSeries(r.d, r.now)) expect(detectRateSpike(s, r.now)).toBeNull();
    const wobble = build({ rate: 11 });
    expect(detectRateSpike(docToSeries(wobble.d, wobble.now).find((x) => x.key === 'NFL:a')!, wobble.now)).toBeNull();
    // only ~2 days of history: no spike even for a big jump
    let d: RbHistDoc | null = null;
    for (let h = 0; h < 48; h++) d = appendSample(d, [agg('NFL:a', h > 30 ? 40 : 10, 2)], T0 + h * HOUR);
    expect(detectRateSpike(docToSeries(d!, T0 + 48 * HOUR)[0], T0 + 48 * HOUR)).toBeNull();
  });
  it('summarizeRates: spikes withheld until ready, depth-vs-rate scatter available immediately', () => {
    let d: RbHistDoc | null = null;
    for (let h = 0; h < 5; h++) d = appendSample(d, [agg('NFL:a', 10, 1), agg('NFL:b', 30, 4), agg('NFL:c', 20, 2), agg('NFL:d', 12, 1)], T0 + h * HOUR);
    const s = summarizeRates(d, T0 + 5 * HOUR, true);
    expect(s.source).toBe('rateboard');
    expect(s.unit).toBe('rate');
    expect(s.xAxis).toBe('buyers');
    expect(s.coverage!.ready).toBe(false);
    expect(s.spikes).toEqual([]);
    expect(s.fair).toHaveLength(4);
    expect(s.model.slope).toBeGreaterThan(0);
    expect(s.note).toMatch(/unlock after 3 days/);
    const empty = summarizeRates(null, T0, false);
    expect(empty.players).toEqual([]);
    expect(empty.note).toMatch(/No bid-rate history/);
  });
  it('feeds the Monte Carlo input builder with rate-per-point values', () => {
    const r = build(null);
    const series = docToSeries(r.d, r.now);
    const inp = buildForecastInputs(series, 'NFL:a', r.now, [], 'rateboard')!;
    expect(inp.currentPpr).toBe(10);
    expect(inp.daily.length).toBeGreaterThanOrEqual(7);
    expect(inp.rarity).toBeNull();
  });
});

describe('Monte Carlo on a bid-rate series (no rating)', () => {
  it('stays in a sane range instead of exploding via the rating clamp', async () => {
    const { simulate, DEFAULT_SCENARIO } = await import('../../shared/montecarlo');
    let d: RbHistDoc | null = null;
    for (let h = 0; h < 12 * 24; h++) {
      const peers = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => agg(`NFL:${k}`, 10 + i + Math.round(Math.sin(h / 20 + i) * 2), 2));
      d = appendSample(d, peers, T0 + h * HOUR);
    }
    const now = T0 + 12 * 24 * HOUR;
    const inp = buildForecastInputs(docToSeries(d!, now), 'NFL:a', now, [], 'rateboard')!;
    const fc = simulate(inp, { ...DEFAULT_SCENARIO, horizonDays: 30 }, now);
    const end = fc.ppr[fc.ppr.length - 1];
    expect(end.p50).toBeGreaterThan(inp.currentPpr * 0.5);
    expect(end.p50).toBeLessThan(inp.currentPpr * 2);
    expect(end.p95).toBeLessThan(inp.currentPpr * 10);
    expect(fc.rating[fc.rating.length - 1].p50).toBe(1);
  });
});
