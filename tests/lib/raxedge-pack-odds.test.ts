import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { packRowsFrom, type PackRow } from '../../shared/raxedgeBridge';
import { DEFAULT_PRICE_PARAMS, cloneParams, estimateCardPrice, estimateUpgradeCost, rateBand, type PriceCardInput } from '../../shared/otdPricing';
import {
  buildPackIndex, coverage, lookupPack, packRateFor, packResaleView, packStats, raxedgeSportKey,
} from '../../shared/raxedgePackOdds';
import { DEFAULT_STATE, buildLevels, priceParamsFor, type EffState } from '../../src/components/tab7-efficiency/model';
import type { OtdCardRecord } from '../../shared/otdSnapshot';

const rows = packRowsFrom(JSON.parse(fs.readFileSync('tests/fixtures/raxedge/pack_odds.json', 'utf8')));
const index = buildPackIndex(rows);

const card = (name: string, sport: OtdCardRecord['sport'], season: number, id = `${sport}|${season}|${name}`): OtdCardRecord => ({
  id, sport, season, seasonLabel: String(season), playerId: id, name, team: '', owners: null, games: 10, annual: 300, best: 60, days: [],
});
const barkley = card('Saquon Barkley', 'NFL', 2023);
const stafford = card('Matthew Stafford', 'NFL', 2025);
const cypress = card('Fentrell Cypress II', 'CFB', 2023);
const nobody = card('Nobody Real', 'NFL', 2025);
const asInput = (c: OtdCardRecord): PriceCardInput => ({ id: c.id, sport: c.sport, season: c.season, name: c.name, annual: c.annual, owners: c.owners });

describe('matching', () => {
  it('maps OtdSport to RaxEdge keys and passes unknown sports through', () => {
    expect(raxedgeSportKey('NFL')).toBe('nfl');
    expect(raxedgeSportKey('CFB')).toBe('ncaaf');
    expect(raxedgeSportKey('NBA')).toBe('nba');
    expect(raxedgeSportKey('PGA')).toBe('pga');
  });
  it('finds rows by sport + season + normalised name', () => {
    expect(lookupPack(index, barkley)?.avgCardValue).toBe(3.73);
    expect(lookupPack(index, { sport: 'NFL', season: 2022, name: 'Saquon Barkley' })).toBeNull(); // wrong season
    expect(lookupPack(index, { sport: 'CFB', season: 2023, name: 'Saquon Barkley' })).toBeNull(); // wrong sport
  });
  it('ignores accents, punctuation and Jr/II suffixes on either side', () => {
    expect(lookupPack(index, { sport: 'CFB', season: 2023, name: 'Fentrell Cypress' })?.name).toBe('Fentrell Cypress II');
    expect(lookupPack(index, { sport: 'CFB', season: 2023, name: 'Fentrell Cypress Jr.' })?.name).toBe('Fentrell Cypress II');
    expect(lookupPack(index, { sport: 'NFL', season: 2023, name: 'Saquón  BARKLEY' })?.id).toBe('19766');
    const accent = buildPackIndex([['nba', '2026', '1', 'Nikola Jokić', 'C', 12, 30, 0, 0, 0] as PackRow]);
    expect(lookupPack(accent, { sport: 'NBA', season: 2026, name: 'Nikola Jokic' })?.id).toBe('1');
  });
  it('keeps the larger sample on a duplicate key and skips unusable rows', () => {
    const a: PackRow = ['nfl', '2025', '1', 'Josh Allen', 'QB', 5, 3, 0, 0, 0];
    const b: PackRow = ['nfl', '2025', '2', 'Josh Allen', 'LB', 4, 20, 0, 0, 0];
    const bad: PackRow = ['nfl', '2025', '3', 'Zero Value', 'QB', 0, 9, 0, 0, 0];
    const i = buildPackIndex([a, b, bad]);
    expect(i.size).toBe(1);
    expect(lookupPack(i, { sport: 'NFL', season: 2025, name: 'Josh Allen' })?.id).toBe('2');
    expect(buildPackIndex(null).size).toBe(0);
  });
  it('packStats: expected rating per pack = avg x 3', () => {
    const st = packStats(rows.find((r) => r[3] === 'Saquon Barkley')!);
    expect(st.expectedRatingPerPack).toBeCloseTo(11.19, 9);
    expect(st.tierOdds).toEqual({ epic: 41.19, legendary: 0, rare: 58.81 });
    expect(st.sample).toBe(37);
  });
});

describe('packRateFor', () => {
  it('Barkley 2023: 271 / (3 x 3.73) = 24.22 Rax/rating (37 pulls, fully trusted)', () => {
    const r = packRateFor(barkley, { index, packPrice: 271, globalRate: 10 })!;
    expect(r.raw).toBeCloseTo(271 / 11.19, 9);
    expect(r.rate).toBeCloseTo(24.2181, 3);
    expect(r.weight).toBe(1);
    expect(r.confidence).toBe('high');
    expect(r.clamped).toBeNull();
    expect(r.basis).toContain('271 / (3 x 3.73 avg rating, 37 pulls) = 24.2');
  });
  it('Stafford 2025: 271 / (3 x 8.54) = 10.58, but only 7 pulls is still >= 5 so fully trusted', () => {
    const r = packRateFor(stafford, { index, packPrice: 271, globalRate: 10 })!;
    expect(r.rate).toBeCloseTo(10.5777, 3);
    expect(r.weight).toBe(1);
  });
  it('the pack price scales the rate linearly', () => {
    const lo = packRateFor(barkley, { index, packPrice: 200, globalRate: 10 })!.rate;
    const hi = packRateFor(barkley, { index, packPrice: 400, globalRate: 10 })!.rate;
    expect(hi / lo).toBeCloseTo(2, 9);
  });
  it('returns null when there is no row', () => {
    expect(packRateFor(nobody, { index, globalRate: 10 })).toBeNull();
    expect(packRateFor(barkley, { index: new Map(), globalRate: 10 })).toBeNull();
  });
  it('defaults the pack price to the pricing default', () => {
    const r = packRateFor(barkley, { index, globalRate: 10 })!;
    expect(r.raw).toBeCloseTo(DEFAULT_PRICE_PARAMS.pack.playerPackPrice.value / 11.19, 9);
  });

  describe('shrinkage and clamp', () => {
    const one = (avg: number, total: number) => buildPackIndex([['nfl', '2025', '9', 'Test Player', 'WR', avg, total, 0, 0, 0] as PackRow]);
    const t = { sport: 'NFL', season: 2025, name: 'Test Player' };
    it('a small sample is blended toward the global rate: weight = total / minSample', () => {
      // raw = 271 / (3 x 4) = 22.58; 2 of 5 pulls -> 0.4 x 22.583 + 0.6 x 10 = 15.033
      const r = packRateFor(t, { index: one(4, 2), packPrice: 271, globalRate: 10, minSample: 5 })!;
      expect(r.weight).toBeCloseTo(0.4, 9);
      expect(r.rate).toBeCloseTo(0.4 * (271 / 12) + 6, 9);
      expect(r.confidence).toBe('low');
      expect(r.basis).toMatch(/only 2 of 5 pulls/);
      expect(r.basis).toMatch(/40% pack \+ 60% global/);
    });
    it('is continuous at minSample and equal to the raw rate above it', () => {
      const at = packRateFor(t, { index: one(4, 5), packPrice: 271, globalRate: 10 })!;
      const above = packRateFor(t, { index: one(4, 500), packPrice: 271, globalRate: 10 })!;
      expect(at.rate).toBeCloseTo(271 / 12, 9);
      expect(above.rate).toBe(at.rate);
    });
    it('raises to the Rateboard floor (8) when packs look nearly free', () => {
      const r = packRateFor(t, { index: one(30, 100), packPrice: 271, globalRate: 10 })!; // raw 3.0
      expect(r.rate).toBe(8);
      expect(r.clamped).toBe('floor');
      expect(r.basis).toMatch(/raised to the 8\.0 floor/);
    });
    it('caps at 6x the global rate when a player pulls almost nothing', () => {
      const r = packRateFor(t, { index: one(0.5, 100), packPrice: 271, globalRate: 10 })!; // raw 180
      expect(r.rate).toBe(60);
      expect(r.clamped).toBe('ceiling');
      expect(r.basis).toMatch(/capped at 6x/);
      expect(packRateFor(t, { index: one(0.5, 100), packPrice: 271, globalRate: 15 })!.rate).toBe(90);
    });
    it('the floor never exceeds a low global rate (no inverted band)', () => {
      const r = packRateFor(t, { index: one(30, 100), packPrice: 271, globalRate: 5 })!; // raw 3.0, floor = min(8, 5)
      expect(r.rate).toBe(5);
    });
    it('0 pulls = exactly the global rate', () => {
      expect(packRateFor(t, { index: one(9, 0), packPrice: 271, globalRate: 12 })!.rate).toBeCloseTo(12, 9);
    });
  });
});

describe('coverage', () => {
  it('counts cards that have pack data', () => {
    expect(coverage(index, [barkley, stafford, cypress, nobody])).toEqual({ covered: 3, total: 4 });
    expect(coverage(new Map(), [barkley])).toEqual({ covered: 0, total: 1 });
    expect(coverage(index, [])).toEqual({ covered: 0, total: 0 });
  });
});

describe('packResaleView (swap-calculator estimate)', () => {
  it('Barkley: 271 pack, 11.19 rating, resold at 10 less 10% fee', () => {
    const v = packResaleView(packStats(rows.find((r) => r[3] === 'Saquon Barkley')!), { packPrice: 271, marketRate: 10, fee: 0.1 });
    expect(v.grossRate).toBeCloseTo(24.218, 3);
    expect(v.recovered).toBeCloseTo(100.71, 2);
    expect(v.netPackCost).toBeCloseTo(170.29, 2);
    expect(v.netCostPerRating).toBeCloseTo(24.218 - 9, 3);
  });
});

describe('estimateCardPrice with rateByCard', () => {
  const base = DEFAULT_PRICE_PARAMS;
  it('uses the per-card rate for that card only, with its basis and rateUsed', () => {
    const p = cloneParams();
    const r = packRateFor(barkley, { index, packPrice: 271, globalRate: 10 })!;
    p.rateByCard = { [barkley.id]: { rate: r.rate, basis: r.basis } };
    const est = estimateCardPrice(asInput(barkley), 'Iconic', p);
    // 200 + 3380 x 24.2181 = 82,053.4
    expect(est.price).toBe(Math.round(200 + 3380 * (271 / 11.19)));
    expect(est.rateUsed).toBeCloseTo(24.2181, 3);
    expect(est.basis).toContain('pack odds: 271 / (3 x 3.73 avg rating, 37 pulls)');
    expect(est.perCardBasis).toBe(r.basis);
    expect(est.low).toBeCloseTo(200 + 3380 * r.rate * (8 / 10), -1);
    expect(est.high).toBeCloseTo(200 + 3380 * r.rate * (30 / 10), -1);
    // a different card is untouched
    expect(estimateCardPrice(asInput(stafford), 'Iconic', p)).toEqual(estimateCardPrice(asInput(stafford), 'Iconic', base));
    expect(estimateCardPrice(asInput(stafford), 'Iconic', p).perCardBasis).toBeUndefined();
  });
  it('is final: sport / owners / premium multipliers are not applied on top of a per-card rate', () => {
    const p = cloneParams();
    p.sportRateMult = { NFL: 2 };
    p.buyPremium.value = 1.5;
    p.rateByCard = { [barkley.id]: { rate: 20, basis: 'x' } };
    expect(rateBand(asInput(barkley), p).mid).toBe(20);
    expect(rateBand(asInput(stafford), p).mid).toBe(10 * 2 * 1.5); // others keep the multipliers
  });
  it('upgrade cost uses it too, and General / overrides are unaffected', () => {
    const p = cloneParams();
    p.rateByCard = { [barkley.id]: { rate: 20, basis: 'x' } };
    expect(estimateUpgradeCost(asInput(barkley), 'Epic', 'Iconic', p).price).toBe(Math.round((3380 - 180) * 20));
    expect(estimateCardPrice(asInput(barkley), 'General', p).price).toBe(200);
    p.overrides = { [barkley.id]: 5000 };
    expect(estimateCardPrice(asInput(barkley), 'Iconic', p).method).toBe('override');
  });
  it('a missing / empty rateByCard is exactly the old behaviour', () => {
    const empty = cloneParams();
    empty.rateByCard = {};
    for (const c of [barkley, stafford]) for (const k of ['General', 'Common', 'Epic', 'Legendary 3', 'Iconic', 'Iconic 20']) {
      expect(estimateCardPrice(asInput(c), k, empty)).toEqual(estimateCardPrice(asInput(c), k, base));
    }
  });
});

describe('Tab 7 state: opt-in and off by default', () => {
  const cards = [barkley, stafford, cypress, nobody];
  const on: EffState = { ...DEFAULT_STATE, usePackRates: true, packPrice: 271 };

  it('defaults are off, with the pricing default pack price', () => {
    expect(DEFAULT_STATE.usePackRates).toBe(false);
    expect(DEFAULT_STATE.packPrice).toBe(DEFAULT_PRICE_PARAMS.pack.playerPackPrice.value);
  });
  it('REGRESSION: with the option off, pack data changes nothing (params and every level identical)', () => {
    expect(priceParamsFor(DEFAULT_STATE, cards, index)).toEqual(priceParamsFor(DEFAULT_STATE));
    expect(priceParamsFor(DEFAULT_STATE, cards, index).rateByCard).toBeUndefined();
    for (const rarity of ['Iconic', 'Legendary 3', 'AUTO']) {
      const s = { ...DEFAULT_STATE, rarity };
      expect(buildLevels(cards, s, index)).toEqual(buildLevels(cards, s));
    }
    // and the absolute numbers are the old ones: 200 claim + rating x 10
    const lv = buildLevels(cards, DEFAULT_STATE, index);
    expect(lv.get(barkley.id)!.est.price).toBe(200 + 3380 * 10);
    expect(lv.get(barkley.id)!.est.basis).not.toMatch(/pack odds/);
    expect(lv.get(barkley.id)!.est.perCardBasis).toBeUndefined();
  });
  it('option on but nothing imported: still identical to off', () => {
    expect(buildLevels(cards, on, null)).toEqual(buildLevels(cards, DEFAULT_STATE));
    expect(buildLevels(cards, on, new Map())).toEqual(buildLevels(cards, DEFAULT_STATE));
  });
  it('option on: only cards with data are repriced; others keep the global rate', () => {
    const lv = buildLevels(cards, on, index);
    expect(lv.get(barkley.id)!.est.price).toBe(Math.round(200 + 3380 * (271 / 11.19)));
    expect(lv.get(stafford.id)!.est.price).toBe(Math.round(200 + 3380 * (271 / (3 * 8.54))));
    expect(lv.get(cypress.id)!.est.perCardBasis).toBeTruthy();
    expect(lv.get(nobody.id)).toEqual(buildLevels([nobody], DEFAULT_STATE).get(nobody.id));
    expect(lv.get(barkley.id)!.est.basis).toContain('pack odds');
  });
  it('shrinks toward the user\'s global rate, and the pack price flows through', () => {
    const a = buildLevels([barkley], { ...on, packPrice: 200 }, index).get(barkley.id)!.est.rateUsed!;
    const b = buildLevels([barkley], { ...on, packPrice: 400 }, index).get(barkley.id)!.est.rateUsed!;
    expect(b / a).toBeCloseTo(2, 9);
    // a global rate of 3 caps the pack rate at 6 x 3 = 18
    expect(buildLevels([barkley], { ...on, rate: 3 }, index).get(barkley.id)!.est.rateUsed).toBe(18);
  });
});
