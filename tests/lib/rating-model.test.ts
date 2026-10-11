import { describe, expect, it } from 'vitest';
import {
  MODEL_ACCURACY, MODEL_DATA, MODEL_NOTES, isModeled, ownersUplift, ownersPercentile, predictRating, predictRax, ratingToRax, raxFactor,
} from '../../shared/ratingModel';
import { OTD_SPORTS } from '../../shared/otdSnapshot';

/** Real Rateboard rows (rating / rax are Real's own numbers, stats are the box-score line). */
const ROWS = [
  { sport: 'NBA', who: 'Jokic 2024-05-14 (playoffs)', stats: { min: 41, pts: 40, reb: 7, ast: 13, stl: 2, blk: 1, tov: 0, pf: 2, fgm: 15, fga: 22, tpm: 2, tpa: 3, ftm: 8, fta: 9 }, ctx: { won: true, postseason: true, season: 2024 }, rating: 8.62, rax: 17 },
  { sport: 'NFL', who: 'Jayden Daniels 2024-12-15', stats: { pcmp: 25, patt: 31, pyds: 226, ptd: 2, pint: 0, sacked: 8, ratt: 11, ryds: 66, rtd: 0, fuml: 0 }, ctx: { won: true, season: 2024 }, rating: 4.47, rax: 22 },
  { sport: 'NFL', who: 'James Conner 2024-12-15', stats: { ratt: 16, ryds: 110, rtd: 2, rec: 5, recyds: 28, rectd: 0, tgt: 5, fuml: 0 }, ctx: { won: true, season: 2024 }, rating: 6.45, rax: 32 },
  { sport: 'NHL', who: 'Zibanejad 2025-01-04', stats: { g: 0, goals: 1, ast: 0, sog: 3, blk: 0, hit: 0, tk: 0, gv: 0, pm: 1, toi: 17.8, pim: 0, fow: 5, fol: 7 }, ctx: { won: false, season: 2024 }, rating: 3.21, rax: 4 },
  { sport: 'NHL', who: 'Bobrovsky 2024-10-08', stats: { g: 1, ga: 4, sa: 28, sv: 24, toi: 60 }, ctx: { won: true, season: 2024 }, rating: -2.16, rax: 0 },
  { sport: 'MLB', who: 'Joey Gallo 2024-09-21', stats: { p: 0, ab: 3, r: 1, h: 2, rbi: 3, hr: 1, bb: 1, k: 0 }, ctx: { won: true, season: 2024 }, rating: 4.32, rax: 9 },
  { sport: 'MLB', who: 'Gavin Stone 2024-08-25', stats: { p: 1, outs: 21, h: 3, r: 1, er: 1, bb: 2, k: 7, hr: 1, pit: 80 }, ctx: { won: true, season: 2024 }, rating: 5.57, rax: 17 },
] as const;

describe('rating model', () => {
  it('predicts Real ratings of known Rateboard rows within 0.4 and Rax within 2', () => {
    for (const r of ROWS) {
      const sport = r.sport as (typeof OTD_SPORTS)[number];
      const ctx = { ...r.ctx, factors: 'rateboard' as const };
      expect(Math.abs(predictRating(sport, r.stats, ctx) - r.rating), r.who).toBeLessThan(0.4);
      expect(Math.abs(predictRax(sport, r.stats, ctx) - r.rax), r.who).toBeLessThanOrEqual(2);
    }
  });

  it('rating → Rax is max(0, round(k × rating)) with doubled playoff factors', () => {
    expect(ratingToRax('NBA', 8.17, { postseason: true })).toBe(16); // Luka all-star row: 8.17 → 16
    expect(ratingToRax('NBA', 8.622, { postseason: true })).toBe(17);
    expect(ratingToRax('NBA', 6.4)).toBe(6);
    expect(ratingToRax('NBA', -1)).toBe(0);
    expect(ratingToRax('NFL', 9.838, { postseason: true, stats: { ratt: 20 } })).toBe(98); // Barkley 98
    expect(ratingToRax('NFL', 2.0, { stats: { ratt: 5 } })).toBe(10);
    expect(raxFactor('NHL', { g: 1 })).toBe(3);
    expect(raxFactor('NHL', { g: 0, goals: 1 })).toBeCloseTo(1.2);
    expect(raxFactor('MLB', { p: 0, ab: 4 })).toBe(2);
    expect(raxFactor('MLB', { p: 1, outs: 18 })).toBe(3);
    expect(raxFactor('MLB', { p: 1, outs: 3 })).toBe(5);
    expect(raxFactor('MLB', { p: 1, outs: 3 }, { factors: 'rateboard', season: 2025 })).toBe(4);
  });

  it('is monotone in good stats and anti-monotone in bad ones', () => {
    const base = { min: 30, pts: 20, reb: 5, ast: 5, stl: 1, blk: 0, tov: 2, pf: 2, fgm: 8, fga: 17, tpm: 1, tpa: 4, ftm: 3, fta: 4 };
    const r0 = predictRating('NBA', base, { won: true });
    for (const k of ['pts', 'reb', 'ast', 'stl', 'blk'] as const) expect(predictRating('NBA', { ...base, [k]: base[k] + 3 }, { won: true })).toBeGreaterThan(r0);
    expect(predictRating('NBA', { ...base, tov: 6 }, { won: true })).toBeLessThan(r0);
    const qb = { pcmp: 20, patt: 30, pyds: 250, ptd: 1, pint: 0, sacked: 1, ratt: 3, ryds: 10, rtd: 0, fuml: 0 };
    const q0 = predictRating('NFL', qb, {});
    expect(predictRating('NFL', { ...qb, ptd: 3 }, {})).toBeGreaterThan(q0);
    expect(predictRating('NFL', { ...qb, pint: 2 }, {})).toBeLessThan(q0);
    expect(predictRating('NFL', { ...qb, pyds: 350 }, {})).toBeGreaterThan(q0);
    expect(predictRating('NBA', { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fga: 0, fta: 0 }, {})).toBe(0);
    // Rax is non-decreasing in rating
    let prev = -1;
    for (let r = -1; r <= 12; r += 0.25) {
      const x = ratingToRax('CFB', r, { stats: { ratt: 5 } });
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
  });

  it('exposes coverage, accuracy and notes', () => {
    expect(isModeled('NFL')).toBe(true);
    expect(isModeled('PGA')).toBe(false);
    expect(Number.isNaN(predictRating('PGA', {}, {}))).toBe(true);
    for (const s of ['NFL', 'NBA', 'MLB', 'NHL', 'CBB', 'CFB', 'WNBA'] as const) {
      expect(MODEL_DATA[s]?.groups.length, s).toBeGreaterThan(0);
      const a = MODEL_ACCURACY[s];
      expect(a?.n, s).toBeGreaterThan(100);
      expect(a?.r2Rating, s).toBeGreaterThan(0.75);
      expect(a?.maeRax).not.toBeNull();
    }
    expect(MODEL_NOTES.length).toBeGreaterThan(3);
  });

  it('low-owner uplift helpers', () => {
    expect(ownersUplift(0.1)).toBeGreaterThan(1.4);
    expect(ownersUplift(0.95)).toBe(1);
    expect(ownersUplift(null)).toBe(1);
    expect(ownersPercentile(10, [1, 5, 10, 20])).toBe(0.5);
    expect(ratingToRax('NFL', 4, { stats: { ratt: 5 }, ownersPercentile: 0.1 })).toBeGreaterThan(ratingToRax('NFL', 4, { stats: { ratt: 5 } }));
  });
});
