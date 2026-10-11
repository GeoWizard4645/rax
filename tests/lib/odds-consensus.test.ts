import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/odds/load';
import { devig2, devig2Power, devigN } from '../../shared/odds';
import type { OddsEvent, OddsMarket, OddsSource } from '../../shared/odds';
import { bestLines, consensusFair, exchangeWeight, mainLine, marketFair } from '../../shared/oddsConsensus';
import { ESPN_LEAGUES, KALSHI_SERIES, POLY_TAGS, matchEvents, parseEspnOdds, parseKalshi, parsePolymarket } from '../../shared/oddsSources';

const mk = (source: OddsSource, type: OddsMarket['type'], line: number | null, p0: number, p1: number, over: Partial<OddsMarket> = {}): OddsMarket => ({
  source,
  type,
  line,
  outcomes: [{ side: type === 'total' ? 'over' : 'home', name: 'H', implied: p0, american: null }, { side: type === 'total' ? 'under' : 'away', name: 'A', implied: p1, american: null }],
  updatedAt: '2026-10-11T00:00:00Z',
  volume: null,
  url: null,
  ...over,
});
const ev = (markets: OddsMarket[]): Pick<OddsEvent, 'markets' | 'home' | 'away'> => ({ markets, home: 'Home', away: 'Away' });

describe('de-vig maths', () => {
  it('proportional: -218 / +180 → 65.8% / 34.2%', () => {
    const [a, b] = devig2(218 / 318, 100 / 280);
    expect(a).toBeCloseTo(0.6575, 3);
    expect(a + b).toBeCloseTo(1, 10);
  });
  it('power method gives the favourite a little MORE than proportional (longshot bias) and sums to 1', () => {
    const pa = 0.8, pb = 0.27; // 1.07 overround
    const [x, y] = devig2Power(pa, pb);
    expect(x + y).toBeCloseTo(1, 6);
    const [px] = devig2(pa, pb);
    expect(x).toBeGreaterThan(px);
    expect(devig2Power(0.4, 0.5)).toEqual(devig2(0.4, 0.5)); // under-round → proportional fallback
    expect(devig2Power(0, 1)[0]).toBeNaN();
  });
  it('n-way proportional', () => {
    const d = devigN([0.5, 0.3, 0.3]);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(d[0]).toBeCloseTo(0.4545, 3);
  });
});

describe('marketFair', () => {
  it('books: vig removed and reported; exchanges: normalised only, weighted by volume and width', () => {
    const dk = marketFair(mk('espn-dk', 'moneyline', null, 0.6855, 0.3571));
    expect(dk.vigRemoved).toBe(true);
    expect(dk.overround).toBeCloseTo(1.0426, 3);
    expect(dk.fair[0]).toBeCloseTo(0.6575, 3);
    expect(dk.weight).toBe(1);
    const k = marketFair(mk('kalshi', 'moneyline', null, 0.645, 0.345, { volume: 10_000, width: 0.01 }));
    expect(k.vigRemoved).toBe(false);
    expect(k.fair[0] + k.fair[1]).toBeCloseTo(1, 10);
    expect(k.weight).toBeGreaterThan(0.8);
  });
  it('3-way soccer: normalises home / draw / away together', () => {
    const f = marketFair(mk('espn-dk', 'moneyline', null, 0.4, 0.38, { draw: { implied: 0.26, american: 285 } }));
    expect(f.draw).toBeCloseTo(0.26 / 1.04, 6);
    expect(f.fair[0] + f.fair[1] + f.draw!).toBeCloseTo(1, 10);
  });
  it('exchangeWeight rises with volume and falls with width', () => {
    expect(exchangeWeight(100_000, 0.01)).toBeGreaterThan(exchangeWeight(100, 0.01));
    expect(exchangeWeight(10_000, 0.01)).toBeGreaterThan(exchangeWeight(10_000, 0.06));
    expect(exchangeWeight(null, null)).toBeLessThan(exchangeWeight(10_000, 0.01));
    expect(exchangeWeight(0, 0.5)).toBeGreaterThan(0);
    expect(exchangeWeight(1e12, 0)).toBeLessThanOrEqual(1);
  });
});

describe('consensusFair', () => {
  const agree = ev([
    mk('espn-dk', 'moneyline', null, 0.6855, 0.3571),
    mk('kalshi', 'moneyline', null, 0.655, 0.345, { volume: 50_000, width: 0.01 }),
    mk('polymarket', 'moneyline', null, 0.66, 0.34, { volume: 20_000, width: 0.01 }),
  ]);
  it('weights sources, reports the spread, and is confident when they agree', () => {
    const c = consensusFair(agree, 'moneyline');
    expect(c.sources).toHaveLength(3);
    expect(c.fair![0]).toBeGreaterThan(0.65);
    expect(c.fair![0]).toBeLessThan(0.67);
    expect(c.fair![0] + c.fair![1]).toBeCloseTo(1, 10);
    expect(c.spread).toBeLessThan(0.02);
    expect(c.confidence).toBe('high');
    expect(c.warnings).toEqual([]);
    expect(c.names).toEqual(['Home', 'Away']);
  });
  it('warns when sources disagree and lowers confidence', () => {
    const c = consensusFair(ev([mk('espn-dk', 'moneyline', null, 0.6, 0.45), mk('kalshi', 'moneyline', null, 0.45, 0.55, { volume: 50_000, width: 0.01 })]), 'moneyline');
    expect(c.spread).toBeGreaterThan(0.1);
    expect(c.warnings.join(' ')).toMatch(/disagree/);
    expect(c.confidence).toBe('low');
  });
  it('single source and empty cases', () => {
    const one = consensusFair(ev([mk('espn-dk', 'moneyline', null, 0.5, 0.52)]), 'moneyline');
    expect(one.spread).toBeNull();
    expect(one.confidence).toBe('low');
    expect(one.warnings[0]).toMatch(/Single source/);
    const none = consensusFair(ev([]), 'spread');
    expect(none.fair).toBeNull();
    expect(none.confidence).toBe('none');
  });
  it('flags thin exchange books', () => {
    const c = consensusFair(ev([mk('kalshi', 'moneyline', null, 0.5, 0.5, { volume: 0, width: 0.08 }), mk('espn-dk', 'moneyline', null, 0.52, 0.52)]), 'moneyline');
    expect(c.warnings.join(' ')).toMatch(/wide bid\/ask/);
    expect(c.warnings.join(' ')).toMatch(/little or no traded volume/);
  });
  it('lines: only the same line is compared; default = most-quoted line nearest 50/50', () => {
    const e = ev([
      mk('espn-dk', 'total', 6.5, 0.5, 0.5455),
      mk('kalshi', 'total', 6.5, 0.475, 0.525, { volume: 5000, width: 0.01 }),
      mk('kalshi', 'total', 5.5, 0.585, 0.415, { volume: 300, width: 0.01 }),
      mk('polymarket', 'total', 5.5, 0.6, 0.4, { volume: 300, width: 0.01 }),
      mk('kalshi', 'total', 7.5, 0.275, 0.725, { volume: 300, width: 0.01 }),
    ]);
    const bl = bestLines(e, 'total');
    expect(bl.map((l) => l.line)).toEqual([6.5, 5.5, 7.5]);
    expect(bl[0].nSources).toBe(2);
    expect(mainLine(e, 'total')).toBe(6.5);
    expect(consensusFair(e, 'total').line).toBe(6.5);
    const c55 = consensusFair(e, 'total', 5.5);
    expect(c55.sources.map((s) => s.source).sort()).toEqual(['kalshi', 'polymarket']);
    expect(c55.names).toEqual(['Over 5.5', 'Under 5.5']);
    expect(consensusFair(e, 'total', 9.5).sources).toHaveLength(0);
    expect(mainLine(ev([]), 'spread')).toBeNull();
  });
  it('3-way moneyline reports the draw', () => {
    const c = consensusFair(ev([mk('espn-dk', 'moneyline', null, 0.4, 0.38, { draw: { implied: 0.26, american: 285 } }), mk('kalshi', 'moneyline', null, 0.39, 0.37, { draw: { implied: 0.25, american: 300 }, volume: 9000, width: 0.02 })]), 'moneyline');
    expect(c.draw).toBeGreaterThan(0.22);
    expect(c.fair![0] + c.fair![1] + c.draw!).toBeCloseTo(1, 10);
  });
  it('power de-vig option changes only the books', () => {
    const e = ev([mk('espn-dk', 'moneyline', null, 0.8, 0.27)]);
    expect(consensusFair(e, 'moneyline', undefined, 'power').fair![0]).toBeGreaterThan(consensusFair(e, 'moneyline').fair![0]);
  });
});

describe('end to end on the recorded NHL fixtures', () => {
  const NOW = Date.parse('2026-10-11T03:30:00Z');
  const evs = matchEvents(
    [
      parseEspnOdds(ESPN_LEAGUES.find((l) => l.league === 'NHL')!, fixture('espn_nhl'), new Date(NOW).toISOString()),
      parsePolymarket([{ spec: POLY_TAGS.find((p) => p.league === 'NHL')!, moneyline: fixture('poly_nhl_moneyline'), props: fixture('poly_nhl_props') }]),
      parseKalshi(['KXNHLGAME', 'KXNHLSPREAD', 'KXNHLTOTAL'].map((s) => ({ spec: KALSHI_SERIES.find((k) => k.series === s)!, json: fixture(`kalshi_nhl_${s.slice(5).toLowerCase().replace('game', 'game')}`) }))),
    ],
    NOW,
  );
  const sea = evs.find((e) => e.home.includes('Capitals'))!;
  it('three-source consensus on the moneyline sits between the books and the exchanges', () => {
    const c = consensusFair(sea, 'moneyline');
    expect(c.sources.map((s) => s.source).sort()).toEqual(['espn-dk', 'kalshi', 'polymarket']);
    expect(c.fair![0]).toBeGreaterThan(0.6);
    expect(c.fair![0]).toBeLessThan(0.7);
    expect(c.spread).toBeLessThan(0.06);
  });
  it('main puck line / total are found', () => {
    expect(mainLine(sea, 'spread')).toBe(-1.5);
    expect(consensusFair(sea, 'spread').sources.length).toBeGreaterThanOrEqual(2);
    expect(mainLine(sea, 'total')).toBe(6.5);
  });
});
