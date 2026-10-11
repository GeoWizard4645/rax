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

/* ---------------- optimality: compare against exhaustive search ---------------- */

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function randomInstance(seed: number) {
  const r = lcg(seed);
  const n = 7 + Math.floor(r() * 4); // 7–10 cards
  const cards: OtdCardRecord[] = [];
  const prices = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const days: Array<[number, number]> = [];
    const count = 3 + Math.floor(r() * 8);
    const used = new Set<number>();
    for (let j = 0; j < count; j++) {
      const d = 101 + Math.floor(r() * 24); // 24 days → plenty of overlap
      if (!used.has(d)) { used.add(d); days.push([d, 1 + Math.floor(r() * 30)]); }
    }
    const id = `c${i}`;
    cards.push(card(id, r() < 0.7 ? 'NBA' : 'MLB', days));
    prices.set(id, 50 + Math.floor(r() * 400));
  }
  return { cards, prices, r };
}

function bruteForce(cards: OtdCardRecord[], p: EfficiencyParams, budget: number, maxCards: number, lambda: number) {
  let best = -Infinity;
  const n = cards.length;
  for (let mask = 0; mask < 1 << n; mask++) {
    const set = cards.filter((_, i) => mask & (1 << i));
    if (set.length > maxCards) continue;
    if (set.reduce((s, c) => s + p.priceOf(c), 0) > budget) continue;
    const cal = buildCalendar(set, p);
    const v = cal.reduce((s, c) => s + c.claimed - lambda * c.wasted, 0);
    if (v > best) best = v;
  }
  return best;
}

describe('portfolio optimality (vs exhaustive search)', () => {
  const trials = 120;
  for (const [label, mode, lambda] of [['earnings', 'earnings', 0], ['min-overlap', 'min-overlap', 1]] as const) {
    it(`${label}: refined set reaches the true optimum on ≥ 95% of random instances and never falls below 97% of it`, () => {
      let exact = 0;
      let worst = 1;
      for (let t = 0; t < trials; t++) {
        const { cards, prices, r } = randomInstance(1000 + t);
        const claims = r() < 0.5 ? 1 : 2;
        const p = base({ claimsPerDay: claims, multiplier: 1, priceOf: (c) => prices.get(c.id)! });
        const budget = 300 + Math.floor(r() * 900);
        const maxCards = 2 + Math.floor(r() * 4);
        const opt = bruteForce(cards, p, budget, maxCards, lambda);
        const got = buildPortfolio(cards, p, { budget, maxCards, minMarginalRoi: 0, overlapMode: mode });
        expect(got.objective).toBeLessThanOrEqual(opt + 1e-6); // never claims more than is possible
        expect(got.totalPrice).toBeLessThanOrEqual(budget);
        expect(got.picks.length).toBeLessThanOrEqual(maxCards);
        const ratio = opt <= 0 ? 1 : got.objective / opt;
        if (ratio > 1 - 1e-9) exact++;
        worst = Math.min(worst, ratio);
      }
      expect(exact / trials).toBeGreaterThanOrEqual(0.95);
      expect(worst).toBeGreaterThanOrEqual(0.97);
    });
  }

  it('refinement never makes the greedy result worse', () => {
    for (let t = 0; t < 40; t++) {
      const { cards, prices } = randomInstance(5000 + t);
      const p = base({ claimsPerDay: 1, multiplier: 1, priceOf: (c) => prices.get(c.id)! });
      const o = { budget: 700, maxCards: 4, minMarginalRoi: 0 };
      const refined = buildPortfolio(cards, p, o);
      const plain = buildPortfolio(cards, p, { ...o, refine: false });
      expect(refined.objective).toBeGreaterThanOrEqual(plain.objective - 1e-6);
    }
  });
});

describe('min-overlap mode', () => {
  // 1 claim/day, pick 2 of 3. A pays 10 on days 101–104; B pays 9 on 101, 102, 105, 106 (overlaps A on two days);
  // C pays 5 on 107, 108 (disjoint). Totals: A+B 58 (18 wasted), A+C 50 (0 wasted), B+C 46.
  const A = card('A', 'NBA', [[101, 10], [102, 10], [103, 10], [104, 10]]);
  const B = card('B', 'NBA', [[101, 9], [102, 9], [105, 9], [106, 9]]);
  const C = card('C', 'NBA', [[107, 5], [108, 5]]);
  const p = base({ claimsPerDay: 1, priceOf: () => 100 });
  const run = (overlapMode: 'earnings' | 'min-overlap', overlapPenalty = 1) => buildPortfolio([A, B, C], p, { budget: 200, maxCards: 2, minMarginalRoi: 0, overlapMode, overlapPenalty });
  it('earnings mode takes the higher total even with shared days', () => {
    const r = run('earnings');
    expect(r.picks.map((x) => x.row.card.id).sort()).toEqual(['A', 'B']);
    expect(r.totalEarn).toBe(58 * 150);
    expect(r.wasted).toBe(18 * 150);
  });
  it('min-overlap mode takes the set with no wasted payout instead', () => {
    const r = run('min-overlap');
    expect(r.picks.map((x) => x.row.card.id).sort()).toEqual(['A', 'C']);
    expect(r.wasted).toBe(0);
    expect(r.totalEarn).toBe(50 * 150);
  });
  it('a lower penalty lets the overlap back in', () => {
    expect(run('min-overlap', 0.1).picks.map((x) => x.row.card.id).sort()).toEqual(['A', 'B']);
  });
});

describe('windowKeys across leap years', () => {
  it('a leap calendar year has 366 unique days incl. Feb 29; a normal year 365', () => {
    const leap = windowKeys({ start: new Date(Date.UTC(2028, 0, 1)), days: 366 });
    expect(leap).toHaveLength(366);
    expect(leap).toContain(229);
    const normal = windowKeys({ start: new Date(Date.UTC(2027, 0, 1)), days: 366 });
    expect(normal).toHaveLength(365);
    expect(normal).not.toContain(229);
    expect(new Set(leap).size).toBe(366);
  });
});
