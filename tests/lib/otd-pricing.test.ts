import { describe, expect, it } from 'vitest';
import * as rules from '../../shared/otdRules';
import {
  DEFAULT_PRICE_PARAMS, RATING_LADDER, afterFee, cloneParams, estimateCardPrice, estimateUpgradeCost, grossForNet,
  packEconomics, ratingBetween, rungFor, swapCost, symmetricSwapCost, type PriceCardInput,
} from '../../shared/otdPricing';

const ohtani: PriceCardInput = { id: 'MLB|2025|660271', sport: 'MLB', season: 2025, name: 'Shohei Ohtani', annual: 715, owners: 30000 };

describe('swapCost', () => {
  it('pack swap reproduces the 241 example (200 + 410 - 369)', () => {
    const r = swapCost({ kind: 'pack-swap', packPrice: 200, offerSent: 410, offerReceived: 410, fee: 0.1, comparePackPrice: 271 });
    expect(r.rows[1].balance).toBe(-610); // "down 610 rax" after sending the offer
    expect(r.netCost).toBeCloseTo(241, 9);
    expect(r.rows[r.rows.length - 1].balance).toBeCloseTo(-241, 9);
    expect(r.savingsVsDirect).toBeCloseTo(30, 9);
    expect(symmetricSwapCost(200, 410, 0.1)).toBeCloseTo(241, 9);
  });
  it('asymmetric swap and booster credit', () => {
    const r = swapCost({ kind: 'pack-swap', packPrice: 200, offerSent: 420, offerReceived: 410, fee: 0.1, boosterValue: 50 });
    expect(r.netCost).toBeCloseTo(200 + 420 - 369, 9);
    expect(r.netCostAfterBooster).toBeCloseTo(251 - 50, 9);
  });
  it('160 back: 271 pack - 160 = 111 net; extra offer reduces it by the post-fee amount', () => {
    expect(swapCost({ kind: 'cash-back', packPrice: 271, cashBack: 160, fee: 0.1 }).netCost).toBe(111);
    const r = swapCost({ kind: 'cash-back', packPrice: 271, cashBack: 160, offerReceived: 100, fee: 0.1 });
    expect(r.netCost).toBeCloseTo(21, 9);
    expect(swapCost({ kind: 'cash-back', packPrice: 200, cashBack: 250, fee: 0.1 }).netCost).toBe(-50); // gain
  });
  it('grossForNet inverts the fee', () => {
    expect(grossForNet(369, 0.1)).toBeCloseTo(410, 9);
  });
});

describe('rarity ladder', () => {
  it('matches the documented totals and multipliers', () => {
    expect(rungFor('Iconic')!.totalRating).toBe(3380);
    expect(rungFor('Iconic')!.multiplier).toBe(150);
    expect(rungFor('Iconic 20')!.totalRating).toBe(40000);
    expect(rungFor('Legendary 3')!.multiplier).toBe(32);
    expect(rungFor('Mystic 6')!.totalRating).toBe(2480);
    expect(rungFor('nope')).toBeNull();
    expect(ratingBetween('Epic', 'Legendary 1')).toBe(200);
    expect(ratingBetween('Iconic', 'Iconic 2')).toBe(420);
  });
  it('is strictly increasing', () => {
    for (let i = 1; i < RATING_LADDER.length; i++) {
      expect(RATING_LADDER[i].totalRating).toBeGreaterThan(RATING_LADDER[i - 1].totalRating);
      expect(RATING_LADDER[i].multiplier).toBeGreaterThan(RATING_LADDER[i - 1].multiplier);
    }
  });
  it('resolves every key in shared/otdRules.ts RARITY_LADDER (integration check)', () => {
    const ladder: Array<{ key: string }> = (rules as any).RARITY_LADDER ?? [];
    for (const r of ladder) expect(rungFor(r.key), r.key).not.toBeNull();
  });
});

describe('estimateCardPrice', () => {
  it('General = claim cost', () => {
    const e = estimateCardPrice(ohtani, 'General', DEFAULT_PRICE_PARAMS);
    expect(e.price).toBe(200);
    expect(e.confidence).toBe('documented');
  });
  it('Iconic = 200 + 3380 x rate, with an ordered band', () => {
    const e = estimateCardPrice(ohtani, 'Iconic', DEFAULT_PRICE_PARAMS);
    expect(e.price).toBe(200 + 3380 * 10);
    expect(e.low).toBe(200 + 3380 * 8);
    expect(e.high).toBe(200 + 3380 * 30);
    expect(e.low).toBeLessThan(e.price);
    expect(e.price).toBeLessThan(e.high);
    expect(e.confidence).toBe('inferred');
    expect(e.basis).toMatch(/3,380 rating/);
  });
  it('price is monotonic up the ladder', () => {
    let prev = -1;
    for (const r of RATING_LADDER) {
      const p = estimateCardPrice(ohtani, r.key, DEFAULT_PRICE_PARAMS).price;
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });
  it('override beats anchor beats model; unknown rarity is flagged', () => {
    const p = cloneParams();
    p.rarityAnchors['Iconic'] = { median: 40000, low: 30000, high: 60000, confidence: 'community', source: 'test' };
    expect(estimateCardPrice(ohtani, 'Iconic', p)).toMatchObject({ price: 40000, low: 30000, high: 60000, method: 'anchor' });
    p.overrides[ohtani.id] = { Iconic: 25000 };
    expect(estimateCardPrice(ohtani, 'Iconic', p)).toMatchObject({ price: 25000, method: 'override' });
    expect(estimateCardPrice(ohtani, 'Epic', p).method).toBe('ladder'); // override is per-rarity here
    p.overrides[ohtani.id] = 1234;
    expect(estimateCardPrice(ohtani, 'Epic', p).price).toBe(1234);
    expect(estimateCardPrice(ohtani, 'Bogus', p).confidence).toBe('unknown');
  });
  it('payback and blend methods fall back to ladder without an anchor, and use it when set', () => {
    const p = cloneParams();
    p.method = 'payback';
    expect(estimateCardPrice(ohtani, 'Iconic', p).method).toBe('ladder');
    p.pricePerAnnualRax = { median: 0.5, low: 0.25, high: 1, confidence: 'community', source: 'test' };
    const e = estimateCardPrice(ohtani, 'Iconic', p);
    expect(e.price).toBeCloseTo(715 * 150 * 0.5, 6);
    p.method = 'blend';
    const b = estimateCardPrice(ohtani, 'Iconic', p);
    expect(b.method).toBe('blend');
    expect(b.price).toBeGreaterThan(Math.min(e.price, 200 + 33800));
  });
  it('sport multiplier and owners elasticity move the rate', () => {
    const p = cloneParams();
    p.sportRateMult = { MLB: 2 };
    expect(estimateCardPrice(ohtani, 'Rare', p).price).toBe(200 + 80 * 20);
    p.sportRateMult = {};
    p.ownersAdj.elasticity = 1;
    expect(estimateCardPrice({ ...ohtani, owners: 40000 }, 'Rare', p).price).toBe(200 + 80 * 20);
    expect(estimateCardPrice({ ...ohtani, owners: null }, 'Rare', p).price).toBe(200 + 80 * 10);
  });
  it('upgrade cost is the rating delta x rate', () => {
    const u = estimateUpgradeCost(ohtani, 'Epic', 'Legendary 1', DEFAULT_PRICE_PARAMS);
    expect(u.price).toBe(2000);
  });
});

describe('packEconomics', () => {
  it('is null with an explanation when pull data is unknown', () => {
    const e = packEconomics(DEFAULT_PRICE_PARAMS);
    expect(e.netValue).toBeNull();
    expect(e.netCost).toBeNull();
    expect(e.explanation).toMatch(/not published/);
  });
  it('computes EV once an average rating is supplied', () => {
    const p = cloneParams();
    p.pack.avgPlayRating = { value: 17, confidence: 'inferred', source: 'test' };
    const e = packEconomics(p);
    expect(e.grossValue).toBe(3 * 17 * 10);
    expect(e.netValue).toBeCloseTo(510 * 0.9, 9);
    expect(e.netCost).toBeCloseTo(271 - 459, 9);
    expect(afterFee(1000, p)).toBe(900);
  });
});
