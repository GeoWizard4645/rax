import { describe, expect, it } from 'vitest';
import { buildCalendar, buildPortfolio, capFactor, rankCards, sportCeilings, windowKeys, type EfficiencyParams } from '../../shared/otdEfficiency';
import type { OtdCardRecord, OtdDay } from '../../shared/otdSnapshot';

const card = (id: string, sport: OtdCardRecord['sport'], raw: Array<[number, number]>, annualExtra = 0): OtdCardRecord => {
  const days: OtdDay[] = raw.map(([d, r]) => [d, r, 0]);
  return {
  id, sport, season: 2024, seasonLabel: '2024', playerId: id, name: id, team: 'T', owners: null,
  games: days.length, annual: days.reduce((s, d) => s + d[1], 0) + annualExtra, best: Math.max(...days.map((d) => d[1])), days,
  };
};

const base = (over: Partial<EfficiencyParams> = {}): EfficiencyParams => ({
  window: { start: new Date(Date.UTC(2026, 0, 1)), days: 365 },
  claimsPerDay: 2,
  scope: 'per-sport',
  multiplier: 150,
  annualCap: null,
  sports: new Set(['NBA', 'MLB'] as const),
  priceOf: () => 1000,
  sunkFraction: 1,
  ...over,
});

describe('windowKeys', () => {
  it('wraps the year and counts days', () => {
    const k = windowKeys({ start: new Date(Date.UTC(2026, 11, 30)), days: 4 });
    expect(k).toEqual([1230, 1231, 101, 102]);
  });
  it('clamps to 366', () => expect(windowKeys({ start: new Date(Date.UTC(2026, 0, 1)), days: 999 })).toHaveLength(365));
});

describe('capFactor', () => {
  it('scales payouts so the card never exceeds its cap', () => {
    const c = card('a', 'NBA', [[101, 600]]);
    expect(capFactor(c, 150, 52_500)).toBeCloseTo(52_500 / 90_000);
    expect(capFactor(c, 150, null)).toBe(1);
    expect(capFactor(c, 1, 52_500)).toBe(1);
  });
});

describe('rankCards', () => {
  it('prices a window by the anniversaries inside it', () => {
    const c = card('a', 'NBA', [[105, 10], [701, 20]]);
    const [r] = rankCards([c], base({ window: { start: new Date(Date.UTC(2026, 0, 1)), days: 31 } }));
    expect(r.windowEarn).toBe(10 * 150);
    expect(r.windowGames).toBe(1);
    expect(r.annualEarn).toBe(30 * 150);
    expect(r.paybackDays).toBeCloseTo(1000 / (4500 / 365));
  });
  it('uses the true annual total when days are truncated', () => {
    const c = card('a', 'NBA', [[105, 10]], 40);
    expect(rankCards([c], base())[0].annualEarn).toBe(50 * 150);
  });
  it('skips excluded sports', () => {
    expect(rankCards([card('a', 'NFL', [[105, 10]])], base())).toHaveLength(0);
  });
});

describe('buildPortfolio', () => {
  // Two cards overlap on every day; a third covers different days. With 1 claim/day the greedy pick must avoid the duplicate.
  const a = card('a', 'NBA', [[101, 10], [102, 10]]);
  const b = card('b', 'NBA', [[101, 9], [102, 9]]);
  const c = card('c', 'NBA', [[103, 5], [104, 5]]);
  it('prefers non-overlapping cards (marginal gain)', () => {
    const p = base({ claimsPerDay: 1, priceOf: () => 100 });
    const r = buildPortfolio([a, b, c], p, { budget: 200, maxCards: 2, minMarginalRoi: 0 });
    expect(r.picks.map((x) => x.row.card.id).sort()).toEqual(['a', 'c']);
    expect(r.totalEarn).toBe((20 + 10) * 150);
    expect(r.totalPrice).toBe(200);
  });
  it('respects the budget and stops when nothing adds value', () => {
    const p = base({ claimsPerDay: 1, priceOf: () => 100 });
    const r = buildPortfolio([a, b, c], p, { budget: 100, maxCards: 5, minMarginalRoi: 0 });
    expect(r.picks).toHaveLength(1);
    expect(r.stoppedBecause).toBe('budget');
    const r2 = buildPortfolio([a, b, c], p, { budget: 1e9, maxCards: 5, minMarginalRoi: 0 });
    expect(r2.picks.map((x) => x.row.card.id).sort()).toEqual(['a', 'c']); // b adds nothing
    expect(r2.stoppedBecause).toBe('no-gain');
  });
  it('a second claim slot makes the overlapping card valuable', () => {
    const p = base({ claimsPerDay: 2, priceOf: () => 100 });
    const r = buildPortfolio([a, b, c], p, { budget: 1e9, maxCards: 5, minMarginalRoi: 0 });
    expect(r.picks).toHaveLength(3);
    expect(r.wasted).toBe(0);
  });
  it('counts owned cards as free and already in the set', () => {
    const p = base({ claimsPerDay: 1, priceOf: () => 100 });
    const r = buildPortfolio([a, b, c], p, { budget: 100, maxCards: 1, minMarginalRoi: 0, ownedIds: new Set(['a']) });
    expect(r.picks.map((x) => x.row.card.id)).toEqual(['a', 'c']);
    expect(r.totalPrice).toBe(100);
  });
  it('global scope shares the claim limit across sports', () => {
    const n = card('n', 'NBA', [[101, 10]]);
    const m = card('m', 'MLB', [[101, 8]]);
    const perSport = buildPortfolio([n, m], base({ claimsPerDay: 1 }), { budget: 1e9, maxCards: 5, minMarginalRoi: 0 });
    const global = buildPortfolio([n, m], base({ claimsPerDay: 1, scope: 'global' }), { budget: 1e9, maxCards: 5, minMarginalRoi: 0 });
    expect(perSport.totalEarn).toBe(18 * 150);
    expect(global.totalEarn).toBe(10 * 150);
  });
});

describe('buildCalendar & sportCeilings', () => {
  const cards = [card('a', 'NBA', [[101, 10]]), card('b', 'NBA', [[101, 6]]), card('c', 'NBA', [[101, 3]])];
  it('reports claimed, wasted and empty slots', () => {
    const cal = buildCalendar(cards, base({ window: { start: new Date(Date.UTC(2026, 0, 1)), days: 2 }, sports: new Set(['NBA'] as const) }));
    const d1 = cal.find((x) => x.mmdd === 101)!;
    expect(d1.claimed).toBe(16 * 150);
    expect(d1.wasted).toBe(3 * 150);
    expect(cal.find((x) => x.mmdd === 102)!.emptySlots).toBe(2);
  });
  it('ceilings show the best a sport can pay', () => {
    const [nba] = sportCeilings(cards, base({ window: { start: new Date(Date.UTC(2026, 0, 1)), days: 5 }, sports: new Set(['NBA'] as const) }));
    expect(nba.total).toBe(16 * 150);
    expect(nba.activeDays).toBe(1);
  });
});
