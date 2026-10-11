import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REAL_RULES,
  REAL_PREDICTION_FACTS,
  breakEvenPct,
  evPct,
  kellyFraction,
  kellyStake,
  maxRakeForBreakeven,
  netMultiple,
  payoutMultiple,
  poolFromQuotes,
  rakeFromQuote,
  recommendStake,
  sensitivity,
  stakeSensitivity,
  type RealRules,
} from '../../shared/realPayout';

const R = (over: Partial<RealRules> = {}): RealRules => ({ ...DEFAULT_REAL_RULES, ...over });

describe('payout multiple and EV', () => {
  it('matches the RaxEdge formula EV = fair/Real × (1 − rake) − 1 (payout basis)', () => {
    expect(netMultiple(0.5, R({ rake: 0 }))).toBeCloseTo(2, 10);
    expect(netMultiple(0.5, R({ rake: 0.05 }))).toBeCloseTo(1.9, 10);
    expect(evPct(0.6, 50, R({ rake: 0.05 }))).toBeCloseTo((0.6 / 0.5) * 0.95 * 100 - 100, 8); // +14%
    expect(evPct(0.5, 50, R({ rake: 0 }))).toBeCloseTo(0, 10);
    expect(evPct(0.5, 50, R({ rake: 0.05 }))).toBeCloseTo(-5, 8);
  });
  it('profit-basis rake hurts less on favourites than payout-basis', () => {
    const payout = evPct(0.8, 75, R({ rake: 0.05, rakeBasis: 'payout' }));
    const profit = evPct(0.8, 75, R({ rake: 0.05, rakeBasis: 'profit' }));
    expect(profit).toBeGreaterThan(payout);
    expect(netMultiple(0.5, R({ rake: 0.1, rakeBasis: 'profit' }))).toBeCloseTo(1.9, 10); // 1 + (2−1)(0.9)
  });
  it('longshots pay more (documented: lower % → higher payout)', () => {
    expect(payoutMultiple(10, R())).toBeGreaterThan(payoutMultiple(60, R()));
  });
  it('rejects nonsense', () => {
    expect(evPct(1.2, 50)).toBeNaN();
    expect(evPct(0.5, NaN)).toBeNaN();
  });
  it('breakEvenPct is where EV = 0 (both bases)', () => {
    for (const rakeBasis of ['payout', 'profit'] as const) {
      const rules = R({ rake: 0.07, rakeBasis });
      for (const q of [0.2, 0.5, 0.83]) {
        const be = breakEvenPct(q, rules);
        expect(evPct(q, be, rules)).toBeCloseTo(0, 6);
        expect(evPct(q, be - 2, rules)).toBeGreaterThan(0);
        expect(evPct(q, be + 2, rules)).toBeLessThan(0);
      }
    }
  });
  it('maxRakeForBreakeven inverts the EV formula', () => {
    const r = maxRakeForBreakeven(0.6, 52);
    expect(evPct(0.6, 52, R({ rake: r }))).toBeCloseTo(0, 8);
    const rp = maxRakeForBreakeven(0.6, 52, 'profit');
    expect(evPct(0.6, 52, R({ rake: rp, rakeBasis: 'profit' }))).toBeCloseTo(0, 8);
    expect(maxRakeForBreakeven(0, 50)).toBe(-Infinity);
  });
});

describe('sensitivity', () => {
  it('EV falls as Real\'s percentage rises; crosses zero at breakEven', () => {
    const s = sensitivity(0.58, 50, R({ rake: 0.05 }), { rangePp: 10, step: 2 });
    expect(s.rows.length).toBe(11);
    for (let i = 1; i < s.rows.length; i++) expect(s.rows[i].ev).toBeLessThan(s.rows[i - 1].ev);
    expect(s.breakEven).toBeCloseTo(55.1, 1);
    expect(s.evAtPct0).toBeCloseTo(evPct(0.58, 50, R({ rake: 0.05 })), 10);
    const pos = s.rows.filter((r) => r.ev > 0).every((r) => r.pct < s.breakEven);
    expect(pos).toBe(true);
  });
  it('stays inside (0, 100)', () => {
    const s = sensitivity(0.9, 97, R(), { rangePp: 10 });
    expect(s.rows.every((r) => r.pct > 0.5 && r.pct < 99.5)).toBe(true);
  });
  it('pool model: a bigger stake worsens the price you get; fixed model ignores stake', () => {
    const pool = R({ model: 'pool', poolRax: 10_000, rake: 0 });
    const t = stakeSensitivity(0.6, 50, pool, [0, 100, 1000, 5000]);
    expect(t[0].ev).toBeCloseTo(20, 8);
    expect(t[1].ev).toBeLessThan(t[0].ev);
    expect(t[3].ev).toBeLessThan(t[2].ev);
    expect(t[3].effectivePct).toBeGreaterThan(t[1].effectivePct);
    const fixed = stakeSensitivity(0.6, 50, R({ rake: 0 }), [0, 5000]);
    expect(fixed[1].ev).toBeCloseTo(fixed[0].ev, 10);
    // unknown pool size → degrades to fixed
    expect(payoutMultiple(50, R({ model: 'pool', poolRax: null }), 1000)).toBeCloseTo(payoutMultiple(50, R()), 10);
  });
});

describe('Kelly', () => {
  it('textbook values', () => {
    expect(kellyFraction(0.6, 2)).toBeCloseTo(0.2, 10); // even money, 60% → 20%
    expect(kellyFraction(0.5, 2)).toBe(0);
    expect(kellyFraction(0.4, 2)).toBe(0);
    expect(kellyFraction(0.6, 1)).toBe(0);
    expect(kellyStake(0.6, 2, 1000, 0.25)).toBe(50);
    expect(kellyStake(0.6, 2, 1000, 1)).toBe(200);
    expect(kellyStake(0.4, 2, 1000)).toBe(0);
    expect(kellyStake(0.6, 2, 0)).toBe(0);
  });
  it('recommendStake: no edge → 0; caps, minimum and rounding are honoured', () => {
    const rules = R({ rake: 0 });
    expect(recommendStake(0.5, 50, 1000, rules).stake).toBe(0);
    const ok = recommendStake(0.6, 50, 1000, rules, 0.25);
    expect(ok.stake).toBe(50);
    expect(ok.evPct).toBeCloseTo(20, 8);
    expect(ok.kelly).toBeCloseTo(0.2, 8);
    expect(recommendStake(0.6, 50, 1000, R({ rake: 0, maxStake: 30 })).stake).toBe(30);
    expect(recommendStake(0.6, 50, 1000, R({ rake: 0, minStake: 100 })).stake).toBe(0);
    expect(recommendStake(0.6, 50, 1000, R({ rake: 0, minStake: 100 })).note).toMatch(/minimum/);
    expect(recommendStake(0.6, 50, 0, rules).note).toMatch(/bankroll/);
    expect(recommendStake(0.6, 50, 1000, R({ rake: 0, stakeStep: 25 })).stake).toBe(50);
  });
  it('pool model recommends a smaller stake than fixed for the same edge', () => {
    const fixed = recommendStake(0.6, 50, 10_000, R({ rake: 0 }), 1);
    const pool = recommendStake(0.6, 50, 10_000, R({ rake: 0, model: 'pool', poolRax: 5000 }), 1);
    expect(pool.stake).toBeGreaterThan(0);
    expect(pool.stake).toBeLessThan(fixed.stake);
  });
});

describe('calibration from the in-app quote', () => {
  it('rakeFromQuote recovers the rake (both bases)', () => {
    // 100 Rax at 40% with 5% payout-basis rake → pays 100/0.4*0.95 = 237.5
    expect(rakeFromQuote(40, 100, 237.5)).toBeCloseTo(0.05, 10);
    // profit basis: pays 100 + 150*0.95 = 242.5
    expect(rakeFromQuote(40, 100, 242.5, 'profit')).toBeCloseTo(0.05, 10);
    expect(rakeFromQuote(40, 0, 10)).toBeNaN();
  });
  it('poolFromQuotes recovers the pool from a big-stake quote', () => {
    const rules = R({ rake: 0.05, model: 'pool', poolRax: 20_000 });
    const stake = 4000;
    const payout = stake * payoutMultiple(50, rules, stake);
    expect(poolFromQuotes(50, 0.05, { stake, payout })).toBeCloseTo(20_000, 4);
    expect(poolFromQuotes(50, 0.05, { stake: 100, payout: 100 / 0.5 * 0.95 })).toBeNull(); // no impact
  });
});

describe('fact table', () => {
  it('every undocumented knob is tagged unknown and carries a null value; documented ones cite a source', () => {
    for (const k of ['rake', 'rakeBasis', 'priceImpact', 'minStake', 'maxStake', 'tiesAndPostponements'] as const) {
      expect(REAL_PREDICTION_FACTS[k].confidence).toBe('unknown');
      expect(REAL_PREDICTION_FACTS[k].value).toBeNull();
    }
    for (const k of ['availability', 'currency', 'displayedPercentMeaning', 'payoutDirection', 'structure'] as const) {
      expect(REAL_PREDICTION_FACTS[k].confidence).toBe('documented');
      expect(REAL_PREDICTION_FACTS[k].source).toMatch(/docs\.realapp\.link/);
    }
    expect(REAL_PREDICTION_FACTS.payoutFormula.confidence).toBe('inferred');
    expect(REAL_PREDICTION_FACTS.evFormulaUsedByRaxEdge.confidence).toBe('community');
  });
});
