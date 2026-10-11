import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import type { OddsEvent, OddsMarket, OddsResponse } from '../../shared/odds';
import { americanToImplied, devig2 } from '../../shared/odds';
import { bestLines, consensusFair, mainLine } from '../../shared/oddsConsensus';
import { AbbrTable, mergeRaxEdgeOdds, parseDraftKings, parseFanDuel, parseRealProbs, planRaxEdge } from '../../shared/oddsRaxEdge';
import type { RaxEdgeOddsExport } from '../../shared/raxedgeBridge';

const fx = (n: string) => JSON.parse(fs.readFileSync(`tests/fixtures/raxedge/${n}.json`, 'utf8'));
/** The instant the fixtures were captured (live-probs `now`). */
const NOW = 1791692899 * 1000;
const AT = new Date(NOW - 2 * 60_000).toISOString();

const bundle = (over: Partial<RaxEdgeOddsExport> = {}): RaxEdgeOddsExport => ({
  fd: { nhl: fx('fd_nhl'), mlb: fx('fd_mlb'), nbaalts: fx('fd_nbaalts'), ufc: fx('fd_ufc') },
  dk: { 'nhl-lines': fx('dk_nhl_lines'), 'nfl-lines': fx('dk_nfl_lines') },
  real: { sync: { football_nfl: fx('real_sync_nfl') }, live: fx('real_live_probs') },
  errors: { 'fd/fc': 'Pro plan required', 'real/sync/hockey_nhl': 'Pro plan required' },
  ...over,
});

const byType = (e: OddsEvent, type: string, source?: string) => e.markets.filter((m) => m.type === type && (!source || m.source === source));

describe('parseFanDuel', () => {
  const nhl = parseFanDuel('nhl', fx('fd_nhl'), NOW, AT);
  const kings = nhl.events.find((e) => e.away === 'Los Angeles Kings')!;

  it('reads moneyline, spread and total with American odds → implied (positive and negative prices)', () => {
    expect(nhl.error).toBeNull();
    expect(nhl.events).toHaveLength(2);
    expect(kings.home).toBe('Vegas Golden Knights');
    expect(kings.sport).toBe('NHL');
    const ml = byType(kings, 'moneyline')[0];
    expect(ml.source).toBe('fanduel');
    expect(ml.outcomes[0].american).toBe(-130); // home
    expect(ml.outcomes[1].american).toBe(102); // away
    expect(ml.outcomes[0].implied).toBeCloseTo(130 / 230, 4);
    expect(ml.outcomes[1].implied).toBeCloseTo(100 / 202, 4);
    // Home line is −1.5 at +550; the away +1.5 side is −1000.
    const sp = byType(kings, 'spread')[0];
    expect(sp.line).toBe(-1.5);
    expect(sp.outcomes.map((o) => o.american)).toEqual([550, -1000]);
    const tot = byType(kings, 'total')[0];
    expect(tot.line).toBe(3.5);
    expect(tot.outcomes.map((o) => [o.side, o.american])).toEqual([['over', 154], ['under', -205]]);
  });

  it('hand-checked de-vig: Kings +102 / Golden Knights −130 → VGK 53.31% fair (overround 106.0%)', () => {
    const ml = byType(kings, 'moneyline')[0];
    const pv = 130 / 230; // 0.565217
    const pk = 100 / 202; // 0.495050
    expect(pv + pk).toBeCloseTo(1.0603, 3);
    expect(devig2(ml.outcomes[0].implied, ml.outcomes[1].implied)[0]).toBeCloseTo(pv / (pv + pk), 3);
    expect(pv / (pv + pk)).toBeCloseTo(0.5331, 4);
  });

  it('pairs alternate spread/total ladders by line and keeps home/away orientation (NBA alts)', () => {
    const p = parseFanDuel('nbaalts', fx('fd_nbaalts'), NOW, AT);
    const e = p.events[0];
    expect(e.sport).toBe('NBA');
    const sp = byType(e, 'spread')[0];
    expect(sp.line).toBe(-8.5); // Phoenix (home) −8.5 at −102, Spurs +8.5 at −130
    expect(sp.outcomes.map((o) => o.american)).toEqual([-102, -130]);
    const tot = byType(e, 'total')[0];
    expect(tot.outcomes.map((o) => o.american)).toEqual([100, -132]);
    expect(byType(e, 'moneyline')[0].outcomes.map((o) => o.american)).toEqual([-700, 440]);
  });

  it('UFC uses `fights`; totals are rounds; start parsed from a 7-digit fraction', () => {
    const p = parseFanDuel('ufc', fx('fd_ufc'), NOW, AT);
    expect(p.events).toHaveLength(2);
    const yan = p.events.find((e) => e.home === 'Petr Yan')!;
    expect(yan.sport).toBe('UFC');
    expect(yan.startsAt).toBe('2026-10-25T03:30:00.000Z');
    expect(byType(yan, 'moneyline')[0].outcomes.map((o) => o.american)).toEqual([-185, 154]);
    expect(byType(yan, 'total')[0].line).toBe(4.5);
    const cody = p.events.find((e) => e.home === 'Cody Chovancek')!;
    expect(byType(cody, 'total')).toHaveLength(0); // empty totals object
  });

  it('MLB ml only; Pro-gated and malformed feeds become an error, not an exception', () => {
    expect(parseFanDuel('mlb', fx('fd_mlb'), NOW, AT).events[0].markets).toHaveLength(1);
    expect(parseFanDuel('fc', { error: 'Pro plan required' }, NOW).error).toBe('Pro plan required');
    expect(parseFanDuel('nhl', { ok: true }, NOW).error).toMatch(/unexpected/);
    expect(parseFanDuel('nhl', null, NOW).events).toEqual([]);
    expect(parseFanDuel('zzz', {}, NOW).error).toMatch(/not used/);
  });

  it('drops games that began more than 5 h ago and marks started ones live', () => {
    expect(parseFanDuel('nhl', fx('fd_nhl'), NOW + 6 * 3600_000).events.map((e) => e.away)).toEqual(['Seattle Kraken']);
    expect(kings.status).toBe('live'); // started 02:09Z, now 04:28Z
    expect(nhl.events.find((e) => e.away === 'Seattle Kraken')!.status).toBe('scheduled');
  });
});

describe('parseDraftKings', () => {
  it('ML / runline (home line) / total, positive and negative odds, short codes and a clean event URL', () => {
    const p = parseDraftKings('nfl-lines', fx('dk_nfl_lines'), NOW, AT);
    expect(p.events).toHaveLength(2);
    const jax = p.events.find((e) => e.home === 'Jacksonville Jaguars')!;
    expect(jax.away).toBe('Philadelphia Eagles');
    expect(jax.sport).toBe('NFL');
    const ml = byType(jax, 'moneyline')[0];
    expect(ml.source).toBe('draftkings');
    expect(ml.outcomes.map((o) => o.american)).toEqual([-410, 320]);
    expect(ml.url).toBe('https://sportsbook.draftkings.com/event/34118254');
    const sp = byType(jax, 'spread')[0];
    expect(sp.line).toBe(-7.5);
    expect(sp.outcomes.map((o) => o.american)).toEqual([-112, -108]);
    expect(byType(jax, 'total')[0].line).toBe(41.5);
    // MIA is the home underdog: line +7.
    expect(byType(p.events.find((e) => e.home === 'Miami Dolphins')!, 'spread')[0].line).toBe(7);
    expect(p.abbrevs).toContainEqual({ sport: 'NFL', abbr: 'JAX', name: 'Jacksonville Jaguars' });
  });

  it('ignores feeds it does not use and non-ok responses', () => {
    expect(parseDraftKings('contender-series', fx('dk_nfl_lines'), NOW).error).toMatch(/not used/);
    expect(parseDraftKings('nfl-lines', { error: 'Pro plan required' }, NOW).error).toBe('Pro plan required');
    expect(parseDraftKings('nfl-lines', { ok: true, games: 'x' }, NOW).error).toMatch(/unexpected/);
  });
});

/* ------------------------------------------------------------------ */

const mk = (source: OddsMarket['source'], type: OddsMarket['type'], line: number | null, a: number, b: number): OddsMarket => ({
  source,
  type,
  line,
  outcomes: [{ side: type === 'total' ? 'over' : 'home', name: 'x', implied: a, american: null }, { side: type === 'total' ? 'under' : 'away', name: 'y', implied: b, american: null }],
  updatedAt: '2026-10-11T04:00:00.000Z',
  volume: source === 'espn-dk' ? null : 20_000,
  url: null,
  width: source === 'espn-dk' ? null : 0.01,
});

const baseResponse = (events: OddsEvent[], sport: OddsResponse['sport'] = 'NHL'): OddsResponse => ({
  generatedAt: new Date(NOW).toISOString(),
  sport,
  events,
  sources: [{ source: 'kalshi', ok: true, count: 3 }, { source: 'polymarket', ok: true, count: 1 }, { source: 'espn-dk', ok: true, count: 2 }],
  meta: { subrequests: 8, trimmed: 0, windowDays: 3 },
});

const vgk = (over: Partial<OddsEvent> = {}): OddsEvent => ({
  id: 'NHL|2026-10-11|vegas-golden-knights|los-angeles-kings',
  sport: 'NHL',
  league: 'NHL',
  home: 'Vegas Golden Knights',
  away: 'Los Angeles Kings',
  startsAt: '2026-10-11T02:09:00.000Z',
  status: 'live',
  markets: [mk('espn-dk', 'moneyline', null, 0.5652, 0.4505), mk('kalshi', 'moneyline', null, 0.54, 0.46)], // sorted by source, like matchEvents output
  ...over,
});

describe('mergeRaxEdgeOdds', () => {
  it('attaches FD markets to the matching event and makes the rest their own events; never mutates the input', () => {
    const resp = baseResponse([vgk()]);
    const snapshot = JSON.stringify(resp);
    const m = mergeRaxEdgeOdds(resp, bundle(), NOW, { at: AT });
    expect(JSON.stringify(resp)).toBe(snapshot);
    const e = m.events.find((x) => x.home === 'Vegas Golden Knights')!;
    expect(e.id).toBe(resp.events[0].id);
    expect(e.markets.filter((x) => x.source === 'fanduel').map((x) => x.type)).toEqual(['moneyline', 'spread', 'total']);
    expect(e.markets.filter((x) => x.source === 'kalshi')).toHaveLength(1);
    // Calgary/Anaheim (DK only) and Seattle/Washington (FD) are NEW events.
    expect(m.events.map((x) => x.home).sort()).toEqual(['Calgary Flames', 'Vegas Golden Knights', 'Washington Capitals']);
    const cgy = m.events.find((x) => x.home === 'Calgary Flames')!;
    expect(cgy.markets.every((x) => x.source === 'draftkings')).toBe(true);
    expect(cgy.away).toBe('Anaheim Ducks');
    // Sorted by start; the three NHL games interleave correctly.
    expect(m.events.map((x) => x.startsAt)).toEqual([...m.events.map((x) => x.startsAt)].sort());
  });

  it('matches a game the source lists the other way round and mirrors its markets', () => {
    const flipped = vgk({ home: 'Los Angeles Kings', away: 'Vegas Golden Knights', id: 'NHL|2026-10-11|los-angeles-kings|vegas-golden-knights' });
    const m = mergeRaxEdgeOdds(baseResponse([flipped]), bundle(), NOW, { at: AT });
    const e = m.events.find((x) => x.id === flipped.id)!;
    const sp = e.markets.find((x) => x.source === 'fanduel' && x.type === 'spread')!;
    expect(sp.line).toBe(1.5); // Kings (home here) get +1.5 at −1000
    expect(sp.outcomes.map((o) => [o.name, o.american])).toEqual([['Los Angeles Kings', -1000], ['Vegas Golden Knights', 550]]);
    const ml = e.markets.find((x) => x.source === 'fanduel' && x.type === 'moneyline')!;
    expect(ml.outcomes[0].american).toBe(102);
  });

  it('only merges games of the requested sport and does not match a different date', () => {
    const nfl = mergeRaxEdgeOdds(baseResponse([], 'NFL'), bundle(), NOW, { at: AT });
    expect(nfl.events.map((e) => e.sport)).toEqual(['NFL', 'NFL']);
    const tomorrow = vgk({ startsAt: '2026-10-12T02:09:00.000Z', id: 'NHL|2026-10-12|v|l' });
    const m = mergeRaxEdgeOdds(baseResponse([tomorrow]), bundle(), NOW, { at: AT });
    expect(m.events.find((e) => e.id === tomorrow.id)!.markets.some((x) => x.source === 'fanduel')).toBe(false);
  });

  it('adds fanduel/draftkings entries to sources[] with counts, plan-limit and staleness notes', () => {
    const m = mergeRaxEdgeOdds(baseResponse([vgk()]), bundle(), NOW, { at: new Date(NOW - 40 * 60_000).toISOString() });
    expect(m.sources.map((s) => s.source)).toEqual(['kalshi', 'polymarket', 'espn-dk', 'fanduel', 'draftkings']);
    const fd = m.sources.find((s) => s.source === 'fanduel')!;
    expect(fd).toMatchObject({ ok: true, count: 6 }); // 3 + 3 markets on the two FD games
    expect(fd.error).toMatch(/40 min old/);
    expect(m.sources.find((s) => s.source === 'draftkings')).toMatchObject({ ok: true, count: 3 });
    // FC: the only FD feed in the export errored with a plan limit; DK has no soccer feed at all.
    const fc = mergeRaxEdgeOdds(baseResponse([], 'FC'), bundle(), NOW, { at: AT });
    expect(fc.sources.find((s) => s.source === 'fanduel')).toMatchObject({ ok: true, count: 0, error: 'fc: Pro plan required' });
    expect(fc.sources.find((s) => s.source === 'draftkings')!.error).toMatch(/no requests planned/);
    // A non-plan failure is a real error.
    const bad = mergeRaxEdgeOdds(baseResponse([]), bundle({ fd: { nhl: { ok: true } } }), NOW, { at: AT });
    expect(bad.sources.find((s) => s.source === 'fanduel')).toMatchObject({ ok: false });
  });

  it('is a no-op on markets for an empty export (still lists the sources as unavailable)', () => {
    const m = mergeRaxEdgeOdds(baseResponse([vgk()]), { fd: {}, dk: {}, real: { sync: {}, live: null }, errors: {} }, NOW);
    expect(m.events).toEqual([vgk()]);
  });
});

describe('consensus with FanDuel / DraftKings', () => {
  const include = new Set(['fanduel', 'draftkings'] as const);
  const merged = () => mergeRaxEdgeOdds(baseResponse([vgk()]), bundle(), NOW, { at: AT }).events.find((x) => x.home === 'Vegas Golden Knights')!;

  it('excluded by default: the consensus equals the one computed without any RaxEdge market (regression)', () => {
    const before = consensusFair(vgk(), 'moneyline');
    expect(consensusFair(merged(), 'moneyline')).toEqual(before);
    expect(consensusFair(merged(), 'moneyline', null, 'power')).toEqual(consensusFair(vgk(), 'moneyline', null, 'power'));
    expect(bestLines(merged(), 'total')).toEqual([]); // FD's total is invisible without the option
    expect(mainLine(merged(), 'spread')).toBeNull();
    expect(consensusFair(merged(), 'moneyline', null, 'proportional', new Set()).sources.map((s) => s.source)).toEqual(['espn-dk', 'kalshi']);
  });

  it('included: FD is de-vigged like a book (weight 1) and joins the weighted mean', () => {
    const c = consensusFair(merged(), 'moneyline', null, 'proportional', include);
    const fd = c.sources.find((s) => s.source === 'fanduel')!;
    expect(fd.vigRemoved).toBe(true);
    expect(fd.weight).toBe(1);
    expect(fd.fair[0]).toBeCloseTo(0.5331, 3);
    expect(fd.overround).toBeCloseTo(1.0603, 3);
    const parts = c.sources.map((s) => ({ w: s.weight, f: s.fair[0] }));
    const mean = parts.reduce((a, p) => a + p.w * p.f, 0) / parts.reduce((a, p) => a + p.w, 0);
    expect(c.fair![0]).toBeCloseTo(mean, 6);
    expect(c.sources).toHaveLength(3);
    // Spread / total lines only FD quotes show up once included.
    expect(mainLine(merged(), 'total', include)).toBe(3.5);
    expect(consensusFair(merged(), 'spread', undefined, 'proportional', include).sources.map((s) => s.source)).toEqual(['fanduel']);
  });

  it('DraftKings is one book: RaxEdge DK is ignored wherever ESPN already quotes that line, and fills the gaps otherwise', () => {
    const base: OddsEvent = vgk({
      markets: [mk('espn-dk', 'moneyline', null, 0.55, 0.47), mk('draftkings', 'moneyline', null, 0.56, 0.46), mk('draftkings', 'total', 6.5, 0.5, 0.55), mk('espn-dk', 'total', 5.5, 0.5, 0.55), mk('draftkings', 'total', 5.5, 0.52, 0.53)],
    });
    const only = new Set(['draftkings'] as const);
    const ml = consensusFair(base, 'moneyline', null, 'proportional', only);
    expect(ml.sources.map((s) => s.source)).toEqual(['espn-dk']); // not double counted
    expect(consensusFair(base, 'total', 6.5, 'proportional', only).sources.map((s) => s.source)).toEqual(['draftkings']); // ESPN has no 6.5
    expect(consensusFair(base, 'total', 5.5, 'proportional', only).sources.map((s) => s.source)).toEqual(['espn-dk']);
    expect(bestLines(base, 'total', 'proportional', only).find((l) => l.line === 5.5)!.nSources).toBe(1);
    // Without the option RaxEdge DK is invisible.
    expect(consensusFair(base, 'total', 6.5).sources).toEqual([]);
  });
});

describe('abbreviations', () => {
  it('reads codes through DraftKings short↔full pairs from the same export (ANA/CGY) and a built-in table (LAK/VGK)', () => {
    const plan = planRaxEdge(bundle(), NOW, AT);
    const t = new AbbrTable(plan.abbrevs);
    expect(t.resolve('NHL', 'ANA')).toBe('Anaheim Ducks');
    expect(t.resolve('NHL', 'cgy')).toBe('Calgary Flames');
    expect(t.resolve('NHL', 'LAK')).toBe('Los Angeles Kings');
    expect(t.resolve('NHL', 'VGK')).toBe('Vegas Golden Knights');
    expect(t.resolve('NFL', 'JAX')).toBe('Jacksonville Jaguars');
    expect(t.resolve('NHL', 'ZZZ')).toBeNull();
    // Without the DK pairs the table still knows the NHL (ANA is in both).
    expect(new AbbrTable().resolve('NHL', 'ANA')).toBe('Anaheim Ducks');
    // The export's DK pair wins over the built-in one.
    expect(new AbbrTable([{ sport: 'NHL', abbr: 'ANA', name: 'Somewhere Else' }]).resolve('NHL', 'ANA')).toBe('Somewhere Else');
    expect(t.sportsFor('ANA', 'CGY')).toEqual(['NHL']);
  });
});

describe('parseRealProbs', () => {
  it('turns live-probs into suggestions oriented to the game (ANA 81.01% away at Calgary; LAK/VGK)', () => {
    const r = parseRealProbs(bundle(), NOW, [], { at: AT });
    expect(r.warnings).toEqual([]);
    expect(r.suggestions).toHaveLength(2);
    const ana = r.suggestions.find((s) => s.marketId === '9669')!;
    expect(ana).toMatchObject({ sport: 'NHL', home: 'Calgary Flames', away: 'Anaheim Ducks', live: true, source: 'raxedge', type: 'moneyline' });
    expect(ana.sideProbs.away).toBeCloseTo(0.8101, 4);
    expect(ana.sideProbs.home).toBeCloseTo(0.1899, 4);
    expect(ana.ts).toBe(1791692876 * 1000);
    const lak = r.suggestions.find((s) => s.marketId === '9670')!;
    expect(lak).toMatchObject({ home: 'Vegas Golden Knights', away: 'Los Angeles Kings' });
    expect(lak.sideProbs.home).toBeCloseTo(0.5959, 4);
    expect(lak.startsAt).toBe('2026-10-11T02:09:00.000Z');
  });

  it('drops locked and settled markets, and quotes older than 3 h', () => {
    const live = fx('real_live_probs');
    live.markets['9669'].isLocked = true;
    live.markets['9670'].isSettled = true;
    const r = parseRealProbs(bundle({ real: { sync: {}, live } }), NOW, [], { at: AT });
    expect(r.suggestions).toEqual([]);
    expect(r.closed).toBe(2);
    const old = parseRealProbs(bundle(), NOW + 4 * 3600_000, [], { at: AT });
    expect(old.suggestions).toEqual([]);
  });

  it('empty pre-game sync entries are just "pending" — nothing to auto-fill, no warning', () => {
    const r = parseRealProbs(bundle({ real: { sync: { football_nfl: fx('real_sync_nfl') }, live: null } }), NOW, [], { at: AT });
    expect(r.suggestions).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.pending).toBe(2);
  });

  it('a FILLED sync entry of unknown shape: warns with the keys it saw instead of guessing', () => {
    const sync = fx('real_sync_nfl');
    sync.markets['Eagles @ Jaguars'] = { weird: { nested: [1, 2, 3] }, pool: 1200, status: 'open' };
    const r = parseRealProbs(bundle({ real: { sync: { football_nfl: sync }, live: null } }), NOW, [], { at: AT });
    expect(r.suggestions).toEqual([]);
    expect(r.pending).toBe(1);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/Eagles @ Jaguars/);
    expect(r.warnings[0]).toMatch(/weird/);
  });

  it('a filled sync entry that carries an outcome list with team names is read (fractions or percents)', () => {
    const mkSync = (body: unknown) => {
      const s = fx('real_sync_nfl');
      s.markets['Eagles @ Jaguars'] = body;
      return parseRealProbs(bundle({ real: { sync: { football_nfl: s }, live: null } }), NOW, [], { at: AT });
    };
    const a = mkSync({ market: { id: 77, outcomes: [{ key: 'PHI', probability: 0.22 }, { key: 'JAX', probability: 0.78 }] } });
    expect(a.warnings).toEqual([]);
    expect(a.suggestions[0]).toMatchObject({ sport: 'NFL', home: 'Jacksonville Jaguars', away: 'Philadelphia Eagles', live: false });
    expect(a.suggestions[0].sideProbs.home).toBeCloseTo(0.78, 6);
    const b = mkSync({ outcomes: [{ label: 'Eagles', pct: 21 }, { label: 'Jaguars', pct: 79 }] });
    expect(b.suggestions[0].sideProbs).toEqual({ away: 0.21, home: 0.79 });
    // Probabilities that do not add up to 100% are rejected, not massaged.
    expect(mkSync({ outcomes: [{ label: 'Eagles', pct: 21 }, { label: 'Jaguars', pct: 40 }] }).suggestions).toEqual([]);
  });

  it('a filled sync entry that points at a live-probs market id uses live-probs (and honours its locked flag)', () => {
    const live = { markets: { '555': { outcomes: [{ key: 'PHI', probability: 0.3 }, { key: 'JAX', probability: 0.7 }], isLocked: false, isSettled: false, ts: 1791692870 } } };
    const s = fx('real_sync_nfl');
    s.markets['Eagles @ Jaguars'] = { marketId: 555, whatever: true };
    const r = parseRealProbs(bundle({ real: { sync: { football_nfl: s }, live } }), NOW, [], { at: AT });
    // live-probs alone cannot place PHI/JAX on a game here (both are NFL codes, game is in the export) — the sync entry and live both resolve to one suggestion.
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0].sideProbs.home).toBeCloseTo(0.7, 6);
    const s2 = fx('real_sync_nfl');
    s2.markets['Eagles @ Jaguars'] = { marketId: 555, isLocked: true };
    expect(parseRealProbs(bundle({ real: { sync: { football_nfl: s2 }, live } }), NOW, [], { at: AT }).suggestions.filter((x) => x.marketId === '555' && !x.live)).toEqual([]);
  });

  it('garbage in → nothing out, never a throw', () => {
    expect(parseRealProbs(bundle({ real: { sync: {}, live: null } }), NOW).suggestions).toEqual([]);
    expect(parseRealProbs(bundle({ real: { sync: { x: 5 as unknown }, live: { markets: { '1': { outcomes: 'nope' }, '2': { outcomes: [{ key: 'AAA', probability: 0.5 }, { key: 'BBB', probability: 0.5 }] } } } } }), NOW).suggestions).toEqual([]);
    expect(parseRealProbs({} as RaxEdgeOddsExport, NOW).suggestions).toEqual([]);
    expect(americanToImplied(-130)).toBeCloseTo(0.5652, 4);
  });
});
