import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIO, estimateParams, simulate, type Scenario } from '../../shared/montecarlo';
import { buildForecastInputs } from '../../shared/market';
import { sampleCatalysts, sampleSeries } from '../../shared/sample';
import { seasonPhase, seasonalDrift } from '../../shared/season';
import { studentT4Unit, rng } from '../../shared/rng';
import type { ForecastInputs } from '../../src/types/market';

const DAY = 86_400_000;
const T = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 12);

/** A calm 30-day history around `ppr`, volume per day `vol`. */
function inputs(over: Partial<ForecastInputs> = {}, vol = 20, ppr = 10): ForecastInputs {
  const r = rng('inputs');
  const daily = Array.from({ length: 30 }, (_, i) => ({ t: T(2026, 9, 1) + i * DAY, ppr: ppr * (1 + (r() - 0.5) * 0.04), volume: vol }));
  return {
    source: 'sample', key: 'NFL:test', playerName: 'Test', sport: 'NFL', rarity: 'Epic', rating: 90, currentPpr: ppr,
    daily, peers: { n: 10, scope: 'sport+rarity', sdLogRet: 0.03, medianPpr: ppr, medianVolPerDay: vol }, catalysts: [], spikeZ: 0, ...over,
  };
}
const sc = (o: Partial<Scenario> = {}): Scenario => ({ ...DEFAULT_SCENARIO, paths: 3000, ...o });
const width = (f: ReturnType<typeof simulate>, d = f.ppr.length - 1) => Math.log(f.ppr[d].p95 / f.ppr[d].p5);

describe('RNG helpers', () => {
  it('Student-t4 draws have unit variance and fat tails', () => {
    const r = rng('t4');
    const xs = Array.from({ length: 200000 }, () => studentT4Unit(r));
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
    expect(Math.abs(m)).toBeLessThan(0.02);
    expect(v).toBeGreaterThan(0.85);
    expect(v).toBeLessThan(1.25);
    expect(xs.filter((x) => Math.abs(x) > 4).length / xs.length).toBeGreaterThan(0.001); // a normal would give ~6e-5
  });
});

describe('seasonal drift', () => {
  it('ramps before the season, decays after it, is flat in-season, none for UFC', () => {
    expect(seasonPhase('NFL', T(2026, 10, 20)).phase).toBe('mid');
    expect(seasonPhase('NFL', T(2026, 7, 20)).phase).toBe('offseason');
    expect(seasonPhase('UFC', T(2026, 7, 20)).phase).toBe('year-round');
    const preSeason = seasonalDrift('NFL', T(2026, 8, 25)); // 11 days before kickoff
    const farOff = seasonalDrift('NFL', T(2026, 5, 1));
    const justAfter = seasonalDrift('NFL', T(2026, 2, 20)); // days after the post-season ends
    expect(preSeason).toBeGreaterThan(0.003);
    expect(farOff).toBeLessThan(0);
    expect(justAfter).toBeLessThan(farOff);
    expect(seasonalDrift('NFL', T(2026, 10, 20))).toBe(0);
    expect(seasonalDrift('UFC', T(2026, 7, 20))).toBe(0);
  });
  it('handles seasons that wrap the new year', () => {
    expect(seasonPhase('NFL', T(2027, 1, 20)).phase).toBe('playoffs');
    expect(seasonPhase('NBA', T(2027, 1, 20)).phase).toBe('mid');
  });
});

describe('Monte Carlo forecast', () => {
  const NOW = T(2026, 10, 5);

  it('is reproducible, and a new salt re-rolls it', () => {
    const a = simulate(inputs(), sc(), NOW);
    const b = simulate(inputs(), sc(), NOW);
    expect(a.ppr[10].p50).toBe(b.ppr[10].p50);
    expect(simulate(inputs(), sc({ salt: 1 }), NOW).ppr[10].p50).not.toBe(a.ppr[10].p50);
  });

  it('starts at today\'s value and bands are ordered and widen with the horizon', () => {
    const f = simulate(inputs(), sc({ horizonDays: 60 }), NOW);
    expect(f.ppr[0].p50).toBeCloseTo(10);
    expect(f.price[0].p50).toBeCloseTo(900);
    for (const b of [...f.ppr, ...f.price, ...f.rating]) {
      expect(b.p5).toBeLessThanOrEqual(b.p25);
      expect(b.p25).toBeLessThanOrEqual(b.p50);
      expect(b.p50).toBeLessThanOrEqual(b.p75);
      expect(b.p75).toBeLessThanOrEqual(b.p95);
    }
    expect(width(f, 60)).toBeGreaterThan(width(f, 7));
    expect(width(f, 7)).toBeGreaterThan(width(f, 1));
  });

  it('is much wider in a thin market than a liquid one', () => {
    const thin = simulate(inputs({}, 1), sc(), NOW);
    const liquid = simulate(inputs({}, 80), sc(), NOW);
    expect(width(thin)).toBeGreaterThan(width(liquid) * 1.4);
    expect(estimateParams(inputs({}, 1), sc()).obsSd).toBeGreaterThan(estimateParams(inputs({}, 80), sc()).obsSd * 2);
  });

  it('leans on similar cards when own history is short', () => {
    const short = inputs({ daily: inputs().daily.slice(-3), peers: { n: 12, scope: 'sport+rarity', sdLogRet: 0.12, medianPpr: 10, medianVolPerDay: 20 } });
    const p = estimateParams(short, sc());
    expect(p.diagnostics.wOwn).toBe(0); // <3 returns → no own estimate, all peer
    expect(p.sigma).toBeCloseTo(0.12, 2);
    const long = estimateParams(inputs({ peers: { n: 12, scope: 'sport+rarity', sdLogRet: 0.12, medianPpr: 10, medianVolPerDay: 20 } }), sc());
    expect(long.diagnostics.wOwn).toBeGreaterThan(0.6);
    expect(long.sigma).toBeLessThan(0.08); // own (calm) history dominates once there is plenty of it
  });

  it('uses a deliberately wide default with no information at all', () => {
    const p = estimateParams(inputs({ daily: inputs().daily.slice(-2), peers: { n: 0, scope: 'none', sdLogRet: 0, medianPpr: 0, medianVolPerDay: 0 } }), sc());
    expect(p.sigma).toBe(0.05);
  });

  it('shows pre-season appreciation and post-season decay', () => {
    const ramp = simulate(inputs(), sc({ horizonDays: 45 }), T(2026, 7, 22)); // → kickoff Sep 5
    const decay = simulate(inputs(), sc({ horizonDays: 45 }), T(2027, 2, 14)); // post-season just ended
    expect(ramp.ppr[45].p50).toBeGreaterThan(10.5);
    expect(decay.ppr[45].p50).toBeLessThan(9.5);
  });

  it('hype decays: a hyped premium fades toward the anchor, a discount recovers', () => {
    const hot = simulate(inputs({ currentPpr: 15, catalysts: ['Game Tonight', 'Streak Multiplier'], spikeZ: 4 }), sc({ horizonDays: 30, hypeShare: 0.9 }), T(2026, 10, 5));
    expect(hot.ppr[30].p50).toBeLessThan(15 * 0.85);
    const noHype = simulate(inputs({ currentPpr: 15 }), sc({ horizonDays: 30, hypeShare: 0 }), T(2026, 10, 5));
    expect(noHype.ppr[30].p50).toBeGreaterThan(hot.ppr[30].p50);
    const cheap = simulate(inputs({ currentPpr: 7 }), sc({ horizonDays: 60, hypeShare: 0 }), T(2026, 10, 5));
    expect(cheap.ppr[60].p50).toBeGreaterThan(7); // slow reversion up toward the anchor
  });

  it('drift bias and volatility scenarios behave', () => {
    const base = simulate(inputs(), sc(), NOW);
    expect(simulate(inputs(), sc({ driftBias: 0.003 }), NOW).ppr[30].p50).toBeGreaterThan(base.ppr[30].p50 * 1.05);
    expect(width(simulate(inputs(), sc({ volMult: 2 }), NOW))).toBeGreaterThan(width(base) * 1.3);
  });

  it('keeps ratings inside [40, 99], moves them more in-season than in the off-season, and refreshes at season start', () => {
    const inSeason = simulate(inputs(), sc({ horizonDays: 60 }), T(2026, 10, 1));
    const off = simulate(inputs(), sc({ horizonDays: 60 }), T(2027, 3, 1));
    const spread = (f: typeof inSeason) => { const b = f.rating[f.rating.length - 1]; return b.p95 - b.p5; };
    expect(spread(inSeason)).toBeGreaterThan(spread(off) * 2);
    for (const b of inSeason.rating) { expect(b.p5).toBeGreaterThanOrEqual(40); expect(b.p95).toBeLessThanOrEqual(99); }
    const crossesKickoff = simulate(inputs(), sc({ horizonDays: 30 }), T(2026, 8, 20)); // season starts Sep 5
    expect(spread(crossesKickoff)).toBeGreaterThan(spread(simulate(inputs(), sc({ horizonDays: 30 }), T(2027, 3, 1))) * 2);
  });

  it('reports tail stats consistent with the bands', () => {
    const f = simulate(inputs(), sc({ horizonDays: 30 }), NOW);
    const s = f.pprStats;
    expect(s.p1).toBeLessThanOrEqual(f.ppr[30].p5);
    expect(s.p99).toBeGreaterThanOrEqual(f.ppr[30].p95);
    expect(s.expectedShortfall5).toBeGreaterThanOrEqual(s.p1 - 1e-9); // mean of the worst 5% sits between the 1st and 5th percentiles
    expect(s.expectedShortfall5).toBeLessThanOrEqual(f.ppr[30].p5);
    expect(s.pUp + (1 - s.pUp)).toBe(1);
    expect(s.pUp20).toBeLessThan(s.pUp);
  });
});

describe('walk-forward calibration on the sample market', () => {
  /** Forecast every player 7 days ahead using only data up to then; count how often reality lands in the band. */
  it('realised per-rating prices land inside the 5–95% band at least ~85% of the time, without absurdly wide bands', () => {
    const NOW = Date.UTC(2026, 9, 5, 15);
    const full = sampleSeries(NOW);
    const t0 = NOW - 7 * DAY;
    const cut = full.map((s) => ({ ...s, points: s.points.filter((p) => p.t <= t0) }));
    let inside90 = 0, inside50 = 0, n = 0;
    for (const s of full) {
      const inp = buildForecastInputs(cut, s.key, t0, sampleCatalysts(t0)[s.key] ?? [], 'sample');
      if (!inp) continue;
      const f = simulate(inp, { ...DEFAULT_SCENARIO, paths: 1500, horizonDays: 7 }, t0);
      const realised = s.points[s.points.length - 1].close / s.rating;
      const b = f.ppr[7];
      n++;
      if (realised >= b.p5 && realised <= b.p95) inside90++;
      if (realised >= b.p25 && realised <= b.p75) inside50++;
    }
    expect(n).toBeGreaterThan(100);
    expect(inside90 / n).toBeGreaterThanOrEqual(0.85);
    expect(inside50 / n).toBeLessThan(0.95); // not so wide that it says nothing
  });
});
