import { describe, expect, it } from 'vitest';
import type { OddsEvent, OddsMarket } from '../../shared/odds';
import type { RealPctSuggestion } from '../../shared/oddsRaxEdge';
import { DEFAULT_REAL_RULES } from '../../shared/realPayout';
import { ageTone, buildBoard, fmtAge, findAuto, linesOf, putEntry, sourceState, withAuto, type Cfg } from '../../src/components/tab9-edge/edgeLogic';
import { DEFAULT_EDGE } from '../../src/components/tab9-edge/useEdgeState';

const cfg: Cfg = { rules: { ...DEFAULT_REAL_RULES }, bankroll: 1000, fraction: 0.25, devig: 'proportional' };
const mk = (source: OddsMarket['source'], type: OddsMarket['type'], line: number | null, p0: number, p1: number): OddsMarket => ({
  source,
  type,
  line,
  outcomes: [{ side: type === 'total' ? 'over' : 'home', name: 'H', implied: p0, american: null }, { side: type === 'total' ? 'under' : 'away', name: 'A', implied: p1, american: null }],
  updatedAt: '2026-10-11T04:00:00Z',
  volume: source === 'espn-dk' || source === 'fanduel' || source === 'draftkings' ? null : 50_000,
  url: null,
  width: source === 'kalshi' ? 0.01 : null,
});
const ev = (over: Partial<OddsEvent> = {}): OddsEvent => ({
  id: 'NHL|2026-10-11|calgary-flames|anaheim-ducks',
  sport: 'NHL',
  league: 'NHL',
  home: 'Calgary Flames',
  away: 'Anaheim Ducks',
  startsAt: '2026-10-11T02:10:00Z',
  status: 'live',
  markets: [mk('espn-dk', 'moneyline', null, 0.28, 0.78), mk('kalshi', 'moneyline', null, 0.2, 0.8)],
  ...over,
});
const sug = (over: Partial<RealPctSuggestion> = {}): RealPctSuggestion => ({
  sport: 'NHL',
  home: 'Calgary Flames',
  away: 'Anaheim Ducks',
  startsAt: '2026-10-11T02:10:15.000Z',
  type: 'moneyline',
  sideProbs: { home: 0.1899, away: 0.8101 },
  marketId: '9669',
  live: true,
  ts: Date.parse('2026-10-11T04:27:56Z'),
  source: 'raxedge',
  ...over,
});

describe('opt-in settings', () => {
  it('both RaxEdge options default to OFF', () => {
    expect(DEFAULT_EDGE.raxLines).toBe(false);
    expect(DEFAULT_EDGE.raxAutoReal).toBe(false);
  });
});

describe('findAuto / withAuto', () => {
  it('rounds Real’s probability to 0.1% and orients it to the event (swapped home/away)', () => {
    const a = findAuto([sug()], ev())!;
    expect(a.p).toEqual([19, 81]);
    const flipped = findAuto([sug()], ev({ home: 'Anaheim Ducks', away: 'Calgary Flames' }))!;
    expect(flipped.p).toEqual([81, 19]);
  });
  it('needs the same sport, the same teams and a kick-off within 3 h', () => {
    expect(findAuto([sug({ sport: 'NBA' })], ev())).toBeNull();
    expect(findAuto([sug({ home: 'Boston Bruins' })], ev())).toBeNull();
    expect(findAuto([sug({ startsAt: '2026-10-11T07:00:00Z' })], ev())).toBeNull();
    expect(findAuto([sug({ sideProbs: { home: 0.001, away: 0.999 } })], ev())).toBeNull(); // outside Real’s 0.5–99.5
  });
  it('typed values win per side; RaxEdge fills only the empty side', () => {
    const a = findAuto([sug()], ev())!;
    const typedHome = withAuto({ p: [25, null], d: null, dnb: false }, a)!;
    expect(typedHome.p).toEqual([25, 81]);
    expect(typedHome.auto).toEqual([false, true]);
    const bothTyped = withAuto({ p: [25, 75], d: null, dnb: false }, a)!;
    expect(bothTyped.p).toEqual([25, 75]);
    expect(bothTyped.auto).toEqual([false, false]);
    expect(bothTyped.src).not.toBeNull(); // still known, but nothing taken from it
    const none = withAuto(null, a)!;
    expect(none.p).toEqual([19, 81]);
    expect(none.auto).toEqual([true, true]);
    expect(withAuto(null, null)).toBeNull();
  });
  it('a 3-way soccer market is not auto-filled from a 2-outcome Real market (unless Draw No Bet was chosen)', () => {
    const a = findAuto([sug()], ev())!;
    expect(withAuto(null, a, true)!.p).toEqual([null, null]);
    expect(withAuto({ p: [null, null], d: null, dnb: true }, a, true)!.p).toEqual([19, 81]);
  });
});

describe('buildBoard with RaxEdge suggestions', () => {
  const events = [ev()];
  it('is identical to before when no suggestions are given (regression)', () => {
    const store = putEntry({}, events[0], 'moneyline', null, { p: [25, 75], d: null });
    expect(buildBoard(events, store, cfg, [])).toEqual(buildBoard(events, store, cfg));
    expect(buildBoard(events, {}, cfg, []).rows).toEqual([]);
  });
  it('adds rows for games with only a RaxEdge number, flagged auto; a typed value is never replaced', () => {
    const b = buildBoard(events, {}, cfg, [sug()]);
    expect(b.rows.length).toBe(2);
    expect(b.rows.every((r) => r.auto && r.entryKey === '')).toBe(true);
    const ana = b.rows.find((r) => r.side.idx === 1)!;
    expect(ana.eval.realPct).toBe(81);
    // The user typed 70 for Anaheim: that side uses 70 and is not flagged; the other side still comes from RaxEdge.
    const store = putEntry({}, events[0], 'moneyline', null, { p: [null, 70], d: null });
    const t = buildBoard(events, store, cfg, [sug()]);
    const typedSide = t.rows.find((r) => r.side.idx === 1)!;
    expect(typedSide.eval.realPct).toBe(70);
    expect(typedSide.auto).toBeNull();
    expect(t.rows.find((r) => r.side.idx === 0)!.auto).not.toBeNull();
    expect(t.used.size).toBe(1);
  });
});

describe('opt-in sources and lines', () => {
  it('linesOf ignores FanDuel/DraftKings lines unless included', () => {
    const e = ev({ markets: [mk('espn-dk', 'total', 5.5, 0.5, 0.55), mk('fanduel', 'total', 6.5, 0.5, 0.55)] });
    expect(linesOf(e, 'total', 'proportional')).toEqual([5.5]);
    expect(linesOf(e, 'total', 'proportional', new Set(['fanduel']))).toContain(6.5);
  });
});

describe('age + status helpers', () => {
  it('amber after 15 min, red after 60 min', () => {
    expect(ageTone(5 * 60_000)).toBe('ok');
    expect(ageTone(15 * 60_000)).toBe('ok');
    expect(ageTone(16 * 60_000)).toBe('amber');
    expect(ageTone(60 * 60_000)).toBe('amber');
    expect(ageTone(61 * 60_000)).toBe('red');
    expect(fmtAge(2 * 60_000)).toBe('2 min ago');
    expect(fmtAge(10_000)).toBe('just now');
    expect(fmtAge(3 * 3600_000)).toBe('3 h ago');
  });
  it('a RaxEdge source with nothing for this sport shows as n/a, a plan limit as partial', () => {
    expect(sourceState({ source: 'fanduel', ok: true, count: 0, error: 'no requests planned — your RaxEdge export has no FanDuel feed for NFL' })).toBe('skipped');
    expect(sourceState({ source: 'fanduel', ok: true, count: 0, error: 'fc: Pro plan required' })).toBe('partial');
  });
});
