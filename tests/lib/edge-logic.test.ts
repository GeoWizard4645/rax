import { describe, expect, it } from 'vitest';
import type { OddsEvent, OddsMarket, OddsResponse } from '../../shared/odds';
import { DEFAULT_REAL_RULES } from '../../shared/realPayout';
import {
  agreement,
  buildBoard,
  dayKey,
  emptyReason,
  entryKey,
  evalMarket,
  evalSide,
  fmtVol,
  lookupEntry,
  matchesSearch,
  parsePct,
  putEntry,
  pruneEntries,
  sameTeam,
  sensRows,
  sideFairs,
  sourceState,
  type Cfg,
} from '../../src/components/tab9-edge/edgeLogic';
import { consensusFair } from '../../shared/oddsConsensus';

const cfg: Cfg = { rules: { ...DEFAULT_REAL_RULES }, bankroll: 1000, fraction: 0.25, devig: 'proportional' };

const mk = (source: OddsMarket['source'], p0: number, p1: number, extra: Partial<OddsMarket> = {}): OddsMarket => ({
  source,
  type: 'moneyline',
  line: null,
  outcomes: [
    { side: 'home', name: 'H', implied: p0, american: null },
    { side: 'away', name: 'A', implied: p1, american: null },
  ],
  updatedAt: '2026-10-11T12:00:00Z',
  volume: source === 'espn-dk' ? null : 50_000,
  url: null,
  width: source === 'espn-dk' ? null : 0.01,
  ...extra,
});

const ev = (over: Partial<OddsEvent> = {}): OddsEvent => ({
  id: 'NFL|2026-10-11|detroit lions|green bay packers',
  sport: 'NFL',
  league: 'NFL',
  home: 'Detroit Lions',
  away: 'Green Bay Packers',
  startsAt: '2026-10-11T17:00:00Z',
  status: 'scheduled',
  markets: [mk('kalshi', 0.6, 0.4), mk('polymarket', 0.6, 0.4)],
  ...over,
});

describe('evalSide — hand-checked', () => {
  it('fair 60% vs Real 52%, rake 5% on payout: multiple 1.8269, EV +9.615%, edge +8 pp, quarter-Kelly 29 of 1000', () => {
    const r = evalSide(0.6, 52, cfg)!;
    expect(r.multiple).toBeCloseTo((1 / 0.52) * 0.95, 9);
    expect(r.ev).toBeCloseTo(9.6154, 3);
    expect(r.edgePp).toBeCloseTo(8, 9);
    // f* = (0.6 * 1.826923 - 1) / 0.826923 = 0.116279 -> x 1/4 x 1000 = 29.07 -> 29
    expect(r.kelly).toBeCloseTo(0.116279, 5);
    expect(r.stake).toBe(29);
    expect(r.breakEven).toBeCloseTo(57, 9); // 60 * 0.95
    expect(r.maxRake).toBeCloseTo(1 - 0.52 / 0.6, 9);
  });
  it('no edge → EV < 0, stake 0', () => {
    const r = evalSide(0.5, 55, cfg)!;
    expect(r.ev).toBeLessThan(0);
    expect(r.stake).toBe(0);
  });
  it('max-stake cap and rake changes flow through', () => {
    const capped = evalSide(0.6, 52, { ...cfg, rules: { ...cfg.rules, maxStake: 10 } })!;
    expect(capped.stake).toBe(10);
    const noRake = evalSide(0.6, 52, { ...cfg, rules: { ...cfg.rules, rake: 0 } })!;
    expect(noRake.ev).toBeCloseTo((0.6 / 0.52 - 1) * 100, 6);
  });
  it('rejects invalid input', () => {
    expect(evalSide(0.6, null, cfg)).toBeNull();
    expect(evalSide(0.6, 0, cfg)).toBeNull();
    expect(evalSide(0.6, 100, cfg)).toBeNull();
    expect(evalSide(NaN, 50, cfg)).toBeNull();
  });
});

describe('parsePct', () => {
  it('parses numbers, percent signs and decimal commas', () => {
    expect(parsePct('58')).toBe(58);
    expect(parsePct(' 58.5% ')).toBe(58.5);
    expect(parsePct('58,5')).toBe(58.5);
    expect(parsePct('.5')).toBe(0.5);
  });
  it('empty clears, junk or out of range is invalid', () => {
    expect(parsePct('')).toBeNull();
    expect(parsePct('abc')).toBe('invalid');
    expect(parsePct('0')).toBe('invalid');
    expect(parsePct('100')).toBe('invalid');
    expect(parsePct('-5')).toBe('invalid');
    expect(parsePct('5 8')).toBe('invalid');
  });
});

describe('entry store', () => {
  it('keys by sport|date|home|away|market|line', () => {
    expect(entryKey('NFL', '2026-10-11', 'Detroit Lions', 'Green Bay Packers', 'spread', -3.5)).toBe('NFL|2026-10-11|detroit-lions|green-bay-packers|spread|-3.5');
    expect(entryKey('NFL', '2026-10-11', 'A', 'B', 'moneyline', null)).toBe('NFL|2026-10-11|a|b|moneyline|');
  });
  it('put → lookup round-trips, ignoring the session event id', () => {
    const e = ev();
    const s = putEntry({}, e, 'moneyline', null, { p: [55, 45], d: null }, 1);
    const other = ev({ id: 'different-session-id' });
    const f = lookupEntry(s, other, 'moneyline', null)!;
    expect(f.p).toEqual([55, 45]);
  });
  it('survives a canonical-name change (Detroit vs Detroit Lions) and a flipped orientation', () => {
    const s = putEntry({}, ev(), 'moneyline', null, { p: [55, 45], d: null }, 1);
    expect(lookupEntry(s, ev({ home: 'Detroit', away: 'Green Bay' }), 'moneyline', null)?.p).toEqual([55, 45]);
    const flipped = ev({ home: 'Green Bay Packers', away: 'Detroit Lions' });
    expect(lookupEntry(s, flipped, 'moneyline', null)?.p).toEqual([45, 55]); // swapped to the new orientation
  });
  it('a flipped spread negates the line', () => {
    const s = putEntry({}, ev(), 'spread', -3.5, { p: [52, 48], d: null }, 1);
    const flipped = ev({ home: 'Green Bay Packers', away: 'Detroit Lions' });
    expect(lookupEntry(s, flipped, 'spread', 3.5)?.p).toEqual([48, 52]);
    expect(lookupEntry(s, flipped, 'spread', -3.5)).toBeNull();
  });
  it('different line or market does not match; totals never flip', () => {
    const s = putEntry({}, ev(), 'total', 47.5, { p: [50, 50], d: null }, 1);
    expect(lookupEntry(s, ev(), 'total', 48.5)).toBeNull();
    expect(lookupEntry(s, ev(), 'moneyline', null)).toBeNull();
    expect(lookupEntry(s, ev({ home: 'Green Bay Packers', away: 'Detroit Lions' }), 'total', 47.5)?.p).toEqual([50, 50]);
  });
  it('clearing every field removes the entry; re-saving under a loose match leaves no duplicate', () => {
    let s = putEntry({}, ev(), 'moneyline', null, { p: [55, null], d: null }, 1);
    s = putEntry(s, ev({ home: 'Detroit', away: 'Green Bay' }), 'moneyline', null, { p: [56, null], d: null }, 2);
    expect(Object.keys(s)).toHaveLength(1);
    s = putEntry(s, ev(), 'moneyline', null, { p: [null, null], d: null }, 3);
    expect(Object.keys(s)).toHaveLength(0);
  });
  it('expires entries for games more than 24 h in the past', () => {
    const now = Date.parse('2026-10-12T18:00:00Z');
    const old = putEntry({}, ev({ startsAt: '2026-10-11T17:00:00Z' }), 'moneyline', null, { p: [55, 45], d: null }, now); // 25 h ago
    const fresh = putEntry({}, ev({ startsAt: '2026-10-12T17:00:00Z' }), 'moneyline', null, { p: [55, 45], d: null }, now); // 1 h ago
    const future = putEntry({}, ev({ startsAt: '2026-10-13T17:00:00Z' }), 'moneyline', null, { p: [55, 45], d: null }, now);
    expect(Object.keys(pruneEntries(old, now))).toHaveLength(0);
    expect(Object.keys(pruneEntries(fresh, now))).toHaveLength(1);
    expect(Object.keys(pruneEntries(future, now))).toHaveLength(1);
    expect(Object.keys(pruneEntries({ x: null as never, y: { ...fresh[Object.keys(fresh)[0]], start: 'garbage' } }, now))).toHaveLength(0);
  });
});

describe('sameTeam / search', () => {
  it('matches token subsets only', () => {
    expect(sameTeam('Detroit', 'Detroit Lions')).toBe(true);
    expect(sameTeam('Los Angeles C', 'Los Angeles Clippers')).toBe(false);
    expect(sameTeam('Real Madrid', 'Atlético Madrid')).toBe(false);
    expect(sameTeam('Atlético Madrid', 'Atletico Madrid')).toBe(true);
  });
  it('search is accent/case-insensitive over teams and league', () => {
    const e = ev({ home: 'Atlético Madrid', league: 'La Liga' });
    expect(matchesSearch(e, 'atletico')).toBe(true);
    expect(matchesSearch(e, 'packers liga')).toBe(true);
    expect(matchesSearch(e, 'chelsea')).toBe(false);
    expect(matchesSearch(e, '')).toBe(true);
  });
});

describe('3-way soccer', () => {
  const soccer = ev({
    sport: 'FC',
    markets: [mk('kalshi', 0.5, 0.25, { draw: { implied: 0.25, american: null } })],
  });
  it('sideFairs returns home / draw / away summing to 1, and draw-no-bet conditions on no draw', () => {
    const c = consensusFair(soccer, 'moneyline', null);
    const f = sideFairs(c);
    expect(f.map((s) => s.idx)).toEqual([0, 2, 1]);
    expect(f.reduce((a, s) => a + s.fair, 0)).toBeCloseTo(1, 9);
    expect(f[1].fair).toBeCloseTo(0.25, 9);
    const d = sideFairs(c, true);
    expect(d).toHaveLength(2);
    expect(d[0].fair).toBeCloseTo(0.5 / 0.75, 9);
  });
  it('evalMarket evaluates the draw side from the typed draw %', () => {
    const c = consensusFair(soccer, 'moneyline', null);
    const { rows, best } = evalMarket(c, { p: [null, null], d: 20, dnb: false }, cfg);
    const draw = rows.find((r) => r.idx === 2)!;
    expect(draw.ev!.ev).toBeCloseTo((0.25 / 0.2) * 0.95 * 100 - 100, 6);
    expect(best?.idx).toBe(2);
  });
});

describe('sensitivity', () => {
  it('EV falls as Real % rises, crosses zero at break-even, and marks the typed row', () => {
    const { rows, breakEven } = sensRows(0.6, 52, cfg, 10, 2);
    expect(breakEven).toBeCloseTo(57, 9);
    for (let i = 1; i < rows.length; i++) expect(rows[i].ev).toBeLessThan(rows[i - 1].ev);
    expect(rows.filter((r) => r.current).map((r) => r.pct)).toEqual([52]);
    expect(rows.find((r) => r.pct === 58)!.ev).toBeLessThan(0);
    expect(rows.find((r) => r.pct === 56)!.ev).toBeGreaterThan(0);
    expect(rows.find((r) => r.pct === 58)!.stake).toBe(0);
  });
});

describe('best-EV board', () => {
  it('lists typed sides across events, sorted by EV, with the right numbers', () => {
    const a = ev();
    const b = ev({ home: 'Buffalo Bills', away: 'Miami Dolphins', id: 'x', markets: [mk('kalshi', 0.7, 0.3), mk('polymarket', 0.7, 0.3)] });
    let st = putEntry({}, a, 'moneyline', null, { p: [52, 50], d: null }, 1);
    st = putEntry(st, b, 'moneyline', null, { p: [60, null], d: null }, 1);
    const { rows, used } = buildBoard([a, b], st, cfg);
    expect(used.size).toBe(2);
    expect(rows).toHaveLength(3);
    // Bills 70% @ 60% => 0.7/0.6*0.95-1 = +10.83%; Lions 60% @ 52% => +9.62%; Packers 40% @ 50% => -24%
    expect(rows.map((r) => r.side.label)).toEqual(['Buffalo Bills', 'Detroit Lions', 'Green Bay Packers']);
    expect(rows[0].eval.ev).toBeCloseTo(10.8333, 3);
    expect(rows[1].eval.ev).toBeCloseTo(9.6154, 3);
    expect(rows[2].eval.ev).toBeCloseTo(-24, 6);
  });
  it('an empty store gives an empty board', () => {
    expect(buildBoard([ev()], {}, cfg).rows).toEqual([]);
  });
});

describe('status, agreement, empty states, formatting', () => {
  it('classifies source status', () => {
    expect(sourceState({ source: 'kalshi', ok: true, count: 5 })).toBe('ok');
    expect(sourceState({ source: 'kalshi', ok: true, count: 0 })).toBe('empty');
    expect(sourceState({ source: 'kalshi', ok: false, count: 0, error: 'HTTP 429' })).toBe('error');
    expect(sourceState({ source: 'kalshi', ok: true, count: 3, error: '1 of 3 requests failed (x)' })).toBe('partial');
    expect(sourceState({ source: 'polymarket', ok: true, count: 0, error: 'no requests planned for this sport/budget' })).toBe('skipped');
  });
  it('agreement thresholds are 3 pp and 5 pp', () => {
    expect(agreement(null)).toBe('single');
    expect(agreement(0.02)).toBe('tight');
    expect(agreement(0.04)).toBe('mild');
    expect(agreement(0.06)).toBe('wide');
  });
  it('explains empty WNBA/CBB/UFC and surfaces failures', () => {
    const empty: OddsResponse = { generatedAt: '', sport: 'WNBA', events: [], sources: [{ source: 'kalshi', ok: true, count: 0 }, { source: 'polymarket', ok: true, count: 0 }, { source: 'espn-dk', ok: true, count: 0 }] };
    expect(emptyReason('WNBA', empty).title).toMatch(/WNBA/);
    expect(emptyReason('CBB', empty).body).toMatch(/season/i);
    expect(emptyReason('UFC', empty).title).toMatch(/UFC/);
    expect(emptyReason('NBA', empty).title).toMatch(/No upcoming NBA/);
    const down: OddsResponse = { ...empty, sources: empty.sources.map((s) => ({ ...s, ok: false, error: 'HTTP 500' })) };
    expect(emptyReason('NFL', down).tone).toBe('error');
  });
  it('compact volumes and date-only day keys', () => {
    expect(fmtVol(950)).toBe('950');
    expect(fmtVol(12_400)).toBe('12k');
    expect(fmtVol(1_250)).toBe('1.3k');
    expect(fmtVol(1_250_000)).toBe('1.3M');
    expect(fmtVol(null)).toBe('—');
    expect(dayKey({ startsAt: '2026-10-11T17:00:00Z', startApprox: true })).toBe('2026-10-11');
  });
});
