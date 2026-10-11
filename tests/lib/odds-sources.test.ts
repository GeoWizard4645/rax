import { describe, expect, it } from 'vitest';
import { fixture } from '../fixtures/odds/load';
import {
  ESPN_LEAGUES,
  KALSHI_SERIES,
  POLY_TAGS,
  SUBREQUEST_BUDGET,
  cleanDkUrl,
  espnOddsToMarkets,
  eventId,
  flipMarket,
  kalshiQuote,
  kalshiTickerDate,
  matchEvents,
  normTeam,
  parseAmerican,
  parseEspnOdds,
  parseKalshi,
  parsePolymarket,
  planFanout,
  polyTime,
  resolveTeam,
  splitTitle,
  teamsMatch,
  type RawEvent,
} from '../../shared/oddsSources';

const NOW = Date.parse('2026-10-11T03:30:00Z');
const kal = (spec: (typeof KALSHI_SERIES)[number]['series'], file: string) => ({ spec: KALSHI_SERIES.find((s) => s.series === spec)!, json: fixture(file) });
const nhlKalshi = () => parseKalshi([kal('KXNHLGAME', 'kalshi_nhl_game'), kal('KXNHLSPREAD', 'kalshi_nhl_spread'), kal('KXNHLTOTAL', 'kalshi_nhl_total')]);
const nhlPoly = () => parsePolymarket([{ spec: POLY_TAGS.find((p) => p.league === 'NHL')!, moneyline: fixture('poly_nhl_moneyline'), props: fixture('poly_nhl_props') }]);
const nhlEspn = () => parseEspnOdds(ESPN_LEAGUES.find((l) => l.league === 'NHL')!, fixture('espn_nhl'), new Date(NOW).toISOString());
const find = (evs: RawEvent[], a: string, b: string) => evs.find((e) => teamsMatch(e.home, a) && teamsMatch(e.away, b))!;

describe('team names', () => {
  it('matches the same team across source spellings', () => {
    expect(teamsMatch('Golden Knights', 'Vegas Golden Knights')).toBe(true);
    expect(teamsMatch('Vegas', 'Vegas Golden Knights')).toBe(true);
    expect(teamsMatch('Los Angeles C', 'LA Clippers')).toBe(true);
    expect(teamsMatch('Los Angeles L', 'LA Clippers')).toBe(false);
    expect(teamsMatch('New York R', 'New York Rangers')).toBe(true);
    expect(teamsMatch('New York R', 'New York Islanders')).toBe(false);
    expect(teamsMatch('Arizona St.', 'Arizona State Sun Devils')).toBe(true);
    expect(teamsMatch('St. Louis', 'St. Louis Blues')).toBe(true);
    expect(teamsMatch('Newcastle', 'Newcastle United')).toBe(true);
    expect(teamsMatch('Racing Club de Lens', 'Lens')).toBe(true);
    expect(teamsMatch('Hawai’i', "Hawai'i Rainbow Warriors")).toBe(true);
    expect(teamsMatch('1. FC K\u00f6ln', 'Cologne')).toBe(true);
    expect(teamsMatch('Bayern M\u00fcnchen', 'Bayern Munich')).toBe(true);
    expect(teamsMatch('PSV', 'Eindhoven')).toBe(true);
    expect(teamsMatch('Leipzig', 'RB Leipzig')).toBe(true);
    expect(teamsMatch('Kings', 'Los Angeles Clippers')).toBe(false);
    expect(teamsMatch('Boston', 'Chicago Bears')).toBe(false);
    expect(teamsMatch('', 'x')).toBe(false);
  });
  it('resolves short pro names to the full name only when unambiguous', () => {
    expect(resolveTeam('NHL', 'Red Wings')).toBe('Detroit Red Wings');
    expect(resolveTeam('NHL', 'Detroit')).toBe('Detroit Red Wings');
    expect(resolveTeam('NHL', 'New York')).toBe('New York'); // Rangers or Islanders → ambiguous
    expect(resolveTeam('NFL', 'Los Angeles R')).toBe('Los Angeles Rams');
    expect(resolveTeam('NBA', 'LA Clippers')).toBe('Los Angeles Clippers');
    expect(resolveTeam('FC', 'Arsenal')).toBe('Arsenal');
  });
  it('normalises for ids', () => {
    expect(normTeam('Manchester City FC')).toBe('manchester city');
    expect(normTeam('Man City')).toBe('manchester city');
    expect(eventId('NHL', '2026-10-11T21:00:00.000Z', 'Washington Capitals', 'Seattle Kraken')).toBe('NHL|2026-10-11|washington-capitals|seattle-kraken');
  });
  it('splits Polymarket titles', () => {
    expect(splitTitle('Canucks vs. Rangers')).toEqual(['Canucks', 'Rangers']);
    expect(splitTitle('UFC Fight Night: Brendan Allen vs. Christian Leroy Duncan (Middleweight, Main Card)')).toEqual(['Brendan Allen', 'Christian Leroy Duncan']);
    expect(splitTitle('Futures')).toBeNull();
  });
});

describe('helpers', () => {
  it('parses American odds and times', () => {
    expect(parseAmerican('-108')).toBe(-108);
    expect(parseAmerican('+120')).toBe(120);
    expect(parseAmerican('EVEN')).toBe(100);
    expect(parseAmerican('x')).toBeNull();
    expect(parseAmerican(0)).toBeNull();
    expect(polyTime('2026-10-11 22:00:00+00')).toBe('2026-10-11T22:00:00.000Z');
    expect(polyTime('2026-10-11T22:00:00Z')).toBe('2026-10-11T22:00:00.000Z');
    expect(polyTime(undefined)).toBeNull();
    expect(kalshiTickerDate('26OCT152000MILLAD')).toBe('2026-10-15');
    expect(kalshiTickerDate('junk')).toBeNull();
  });
  it('kalshiQuote: mid of a two-sided book, last price fallback, null for empty/illiquid books', () => {
    expect(kalshiQuote({ yes_bid_dollars: '0.4800', yes_ask_dollars: '0.6200' })).toMatchObject({ p: 0.55, width: 0.14 });
    expect(kalshiQuote({ yes_bid_dollars: '0.0000', yes_ask_dollars: '0.0100', last_price_dollars: '0.0000' })).toBeNull();
    expect(kalshiQuote({ yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000', last_price_dollars: '0.4000', volume_fp: '12.00' })).toMatchObject({ p: 0.4, width: null });
    expect(kalshiQuote({ yes_bid_dollars: '0.0100', yes_ask_dollars: '0.9500' })).toBeNull(); // 94c wide
    expect(kalshiQuote({})).toBeNull();
  });
  it('extracts the clean DraftKings event URL from ESPN tracking links', () => {
    const href = 'https://sportsbook.draftkings.com/gateway?s=__s__&wpcn=ESPN&preurl=https%3A%2F%2Fsportsbook.draftkings.com%2Fevent%2F34118254%3Foutcomes%3D0ML84695697_1';
    expect(cleanDkUrl(href)).toBe('https://sportsbook.draftkings.com/event/34118254');
    expect(cleanDkUrl('https://evil.example/?preurl=https%3A%2F%2Fevil.example%2Fx')).toBeNull();
    expect(cleanDkUrl('not a url')).toBeNull();
  });
});

describe('Kalshi parser (recorded NHL / EPL / NBA fixtures)', () => {
  const evs = nhlKalshi();
  const sea = find(evs, 'Washington', 'Seattle');
  it('builds one event per game from the game-winner series; the first-listed team is AWAY in US sports', () => {
    expect(evs).toHaveLength(2);
    expect(sea).toMatchObject({ source: 'kalshi', sport: 'NHL', league: 'NHL', home: 'Washington', away: 'Seattle', startQuality: 'approx' });
    // start = occurrence − 3 h
    const occ = fixture('kalshi_nhl_game').markets.find((m: any) => m.event_ticker.endsWith('SEAWSH')).occurrence_datetime;
    expect(Date.parse(sea.startsAt)).toBe(Date.parse(occ) - 3 * 3600_000);
  });
  it('moneyline = yes-bid/ask mid per team, with width, volume and depth', () => {
    const ml = sea.markets.find((m) => m.type === 'moneyline')!;
    const k = fixture('kalshi_nhl_game').markets;
    const wsh = k.find((m: any) => m.ticker === 'KXNHLGAME-26OCT11SEAWSH-WSH');
    expect(ml.outcomes[0].implied).toBeCloseTo((Number(wsh.yes_bid_dollars) + Number(wsh.yes_ask_dollars)) / 2, 4);
    expect(ml.outcomes[0].side).toBe('home');
    expect(ml.width).toBeGreaterThan(0);
    expect(ml.volume).not.toBeNull();
    expect(ml.url).toBe('https://kalshi.com/markets/kxnhlgame');
  });
  it('spread: "X wins by over N" → X covers −N; the line is always the HOME team\'s', () => {
    const sp = sea.markets.filter((m) => m.type === 'spread');
    expect(sp.length).toBeGreaterThan(0);
    for (const m of sp) {
      expect(m.outcomes[0].implied + m.outcomes[1].implied).toBeCloseTo(1, 3);
      expect(Math.abs((m.line as number) % 1)).toBe(0.5);
      expect(m.outcomes[0].implied).toBeGreaterThanOrEqual(0.08);
      expect(m.outcomes[0].implied).toBeLessThanOrEqual(0.92);
    }
    // Washington (home) −1.5 exists, Seattle (away) "wins by over 1.5" shows up as home +1.5 with the complementary price.
    const wshMinus = sp.find((m) => m.line === -1.5);
    const wshPlus = sp.find((m) => m.line === 1.5);
    if (wshMinus && wshPlus) expect(wshMinus.outcomes[0].implied).toBeLessThan(wshPlus.outcomes[0].implied);
    expect(sp.length).toBeLessThanOrEqual(12); // ≤ 6 per event per series
  });
  it('totals attach through the shared ticker suffix and carry the full-game line', () => {
    const tt = sea.markets.filter((m) => m.type === 'total');
    expect(tt.length).toBeGreaterThan(0);
    expect(tt[0].outcomes.map((o) => o.side)).toEqual(['over', 'under']);
    expect(tt.every((m) => m.outcomes[0].name.startsWith('Over '))).toBe(true);
    expect(tt.every((m) => m.line !== null)).toBe(true);
  });
  it('soccer: Tie contract becomes the draw of a 3-way moneyline; first-listed team is HOME', () => {
    const epl = parseKalshi([kal('KXEPLGAME', 'kalshi_epl_game')]);
    const g = find(epl, 'Crystal Palace', 'Newcastle');
    expect(g).toBeTruthy();
    const ml = g.markets[0];
    expect(ml.draw?.implied).toBeGreaterThan(0.1);
    expect(ml.outcomes[0].implied + ml.outcomes[1].implied + ml.draw!.implied).toBeGreaterThan(0.85);
    expect(g.dateOnly).toBe('2026-10-25');
  });
  it('skips games whose books are empty, ignores non-active markets', () => {
    const payload = kal('KXNHLGAME', 'kalshi_nhl_game');
    const empty = { spec: payload.spec, json: { markets: payload.json.markets.map((m: any) => ({ ...m, yes_bid_dollars: '0.0000', yes_ask_dollars: '1.0000', last_price_dollars: '0.0000' })) } };
    expect(parseKalshi([empty])).toEqual([]);
    const closed = { spec: payload.spec, json: { markets: payload.json.markets.map((m: any) => ({ ...m, status: 'finalized' })) } };
    expect(parseKalshi([closed])).toEqual([]);
    expect(parseKalshi([{ spec: payload.spec, json: null }])).toEqual([]);
  });
  it('NBA city-only names with a trailing letter keep working', () => {
    const nba = parseKalshi([kal('KXNBAGAME', 'kalshi_nba_game')]);
    expect(nba.length).toBe(2);
    expect(nba.every((e) => e.markets[0].outcomes.every((o) => o.implied > 0 && o.implied < 1))).toBe(true);
  });
});

describe('Polymarket parser (recorded /markets responses)', () => {
  const evs = nhlPoly();
  const sea = find(evs, 'Capitals', 'Kraken');
  it('US sports list the AWAY team first; start time is exact', () => {
    expect(evs).toHaveLength(2);
    expect(sea).toMatchObject({ source: 'polymarket', home: 'Capitals', away: 'Kraken', startQuality: 'exact', startsAt: '2026-10-11T21:00:00.000Z' });
  });
  it('moneyline uses outcomePrices; carries volume, width and liquidity', () => {
    const ml = sea.markets.find((m) => m.type === 'moneyline')!;
    const raw = fixture('poly_nhl_moneyline').find((m: any) => m.slug === 'nhl-sea-wsh-2026-10-11');
    const prices = JSON.parse(raw.outcomePrices).map(Number);
    expect(ml.outcomes[0].implied).toBeCloseTo(prices[1], 4); // outcomes = [Kraken, Capitals] → home is index 1
    expect(ml.outcomes[1].implied).toBeCloseTo(prices[0], 4);
    expect(ml.volume).toBeGreaterThan(0);
    expect(ml.url).toBe('https://polymarket.com/event/nhl-sea-wsh-2026-10-11');
  });
  it('spread: outcomes[0] covers `line`; mapped to the HOME team line', () => {
    const sp = sea.markets.filter((m) => m.type === 'spread');
    const raw = fixture('poly_nhl_props').filter((m: any) => m.sportsMarketType === 'spreads' && m.events[0].slug === 'nhl-sea-wsh-2026-10-11');
    expect(sp.length).toBeGreaterThan(0);
    for (const r of raw) {
      const outs = JSON.parse(r.outcomes);
      const p0 = Number(JSON.parse(r.outcomePrices)[0]);
      if (p0 < 0.08 || p0 > 0.92) continue;
      const mine = sp.find((m) => (outs[0] === 'Capitals' ? m.line === r.line : m.line === -r.line));
      expect(mine).toBeTruthy();
      expect(mine!.outcomes[0].implied).toBeCloseTo(outs[0] === 'Capitals' ? p0 : 1 - p0, 3);
    }
  });
  it('totals: Over price is outcomes[0]', () => {
    const tt = sea.markets.filter((m) => m.type === 'total');
    expect(tt.length).toBeGreaterThan(0);
    expect(tt.every((m) => m.outcomes[0].implied + m.outcomes[1].implied > 0.99 && m.outcomes[0].implied + m.outcomes[1].implied < 1.01)).toBe(true);
  });
  it('soccer: three Yes/No markets are assembled into one 3-way moneyline (home = first in the title)', () => {
    const epl = parsePolymarket([{ spec: POLY_TAGS.find((p) => p.league === 'EPL')!, moneyline: fixture('poly_epl_moneyline') }]);
    const g = find(epl, 'Hull City', 'Everton');
    expect(g.markets).toHaveLength(1);
    expect(g.markets[0].draw?.implied).toBeCloseTo(0.285, 1);
    expect(g.markets[0].outcomes[0].implied + g.markets[0].outcomes[1].implied + g.markets[0].draw!.implied).toBeGreaterThan(0.9);
  });
  it('ignores closed / not-accepting markets and garbage', () => {
    const ml = fixture('poly_nhl_moneyline').map((m: any) => ({ ...m, acceptingOrders: false }));
    expect(parsePolymarket([{ spec: POLY_TAGS.find((p) => p.league === 'NHL')!, moneyline: ml }])).toEqual([]);
    expect(parsePolymarket([{ spec: POLY_TAGS[0], moneyline: 'nope', props: null }])).toEqual([]);
  });
});

describe('ESPN / DraftKings parser (recorded scoreboards)', () => {
  const evs = nhlEspn();
  it('maps teams, start and DraftKings moneyline / spread / total', () => {
    const g = find(evs, 'Washington Capitals', 'Seattle Kraken');
    expect(g).toMatchObject({ source: 'espn-dk', status: 'scheduled', startsAt: '2026-10-11T21:00:00.000Z', startQuality: 'exact' });
    const [ml, sp, tt] = ['moneyline', 'spread', 'total'].map((t) => g.markets.find((m) => m.type === t)!);
    expect(ml.outcomes.map((o) => o.american)).toEqual([-218, 180]);
    expect(ml.outcomes[0].implied).toBeCloseTo(218 / 318, 3);
    expect(sp.line).toBe(-1.5);
    expect(sp.outcomes.map((o) => o.american)).toEqual([120, -142]);
    expect(tt.line).toBe(6.5);
    expect(tt.outcomes.map((o) => o.american)).toEqual([100, -120]);
    expect(ml.url).toMatch(/^https:\/\/sportsbook\.draftkings\.com\/event\/\d+$/);
    expect(ml.volume).toBeNull();
  });
  it('compact header feed (site.web.api.espn.com/apis/v2/scoreboard/header) parses to the same markets as the scoreboard', () => {
    const spec = ESPN_LEAGUES.find((l) => l.league === 'NHL')!;
    const hdr = parseEspnOdds(spec, fixture('espn_header_nhl'), new Date(NOW).toISOString());
    const sb = nhlEspn();
    expect(hdr).toHaveLength(3);
    const a = find(hdr, 'Washington Capitals', 'Seattle Kraken');
    const b = find(sb, 'Washington Capitals', 'Seattle Kraken');
    expect(a.startsAt).toBe(b.startsAt);
    expect(a.status).toBe('scheduled');
    expect(a.markets.map((m) => [m.type, m.line, m.outcomes.map((o) => o.american)])).toEqual(b.markets.map((m) => [m.type, m.line, m.outcomes.map((o) => o.american)]));
  });
  it('UFC bouts: separate events from the header feed, fighters as home/away, "OFF" spread/total ignored', () => {
    const ufc = parseEspnOdds(ESPN_LEAGUES.find((l) => l.league === 'UFC')!, fixture('espn_header_ufc'), '');
    expect(ufc).toHaveLength(4);
    const b = ufc[0];
    expect(b).toMatchObject({ home: 'Katlyn Cerminara', away: 'Mackenzie Stiller', status: 'scheduled' });
    expect(b.markets.map((m) => m.type)).toEqual(['moneyline']);
    expect(b.markets[0].outcomes.map((o) => o.american)).toEqual([-265, 215]);
  });
  it('soccer: draw price comes from moneyline.draw; spread and total too', () => {
    const g = parseEspnOdds(ESPN_LEAGUES.find((l) => l.league === 'UCL')!, fixture('espn_ucl'), new Date(NOW).toISOString())[0];
    const ml = g.markets.find((m) => m.type === 'moneyline')!;
    expect(ml.outcomes.map((o) => o.american)).toEqual([150, 160]);
    expect(ml.draw?.american).toBe(280);
    expect(g.markets.find((m) => m.type === 'spread')?.line).toBe(-0.5);
    expect(g.markets.find((m) => m.type === 'total')?.line).toBe(2.5);
  });
  it('no odds posted (null odds / finished games) → event kept, no markets; soccer lines carry a draw', () => {
    const g = parseEspnOdds(ESPN_LEAGUES.find((l) => l.league === 'EPL')!, fixture('espn_epl'), new Date(NOW).toISOString());
    expect(g.length).toBeGreaterThan(0);
    expect(g.every((e) => e.markets.find((m) => m.type === 'moneyline')?.draw)).toBe(true);
    // ESPN sends odds: [null] for matches without lines (seen on 2026-10-10) → no markets, still an event
    const nul = parseEspnOdds(ESPN_LEAGUES.find((l) => l.league === 'EPL')!, { events: [{ id: '9', date: '2026-10-11T13:00Z', status: { type: { state: 'pre' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'X' } }, { homeAway: 'away', team: { displayName: 'Y' } }], odds: [null] }] }] }, '');
    expect(nul).toHaveLength(1);
    expect(nul[0].markets).toEqual([]);
    const done = parseEspnOdds(ESPN_LEAGUES[0], { events: [{ id: '1', date: '2026-10-10T22:00Z', status: { type: { state: 'post' } }, competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'A' } }, { homeAway: 'away', team: { displayName: 'B' } }], odds: [{ moneyline: { home: { close: { odds: '-110' } }, away: { close: { odds: '-110' } } } }] }] }] }, '');
    expect(done[0].status).toBe('final');
    expect(done[0].markets).toEqual([]);
    expect(parseEspnOdds(ESPN_LEAGUES[0], null, '')).toEqual([]);
    expect(espnOddsToMarkets([null], 'A', 'B', '')).toEqual([]);
  });
  it('falls back to the open line when close is absent; skips half-priced sides', () => {
    const mk = espnOddsToMarkets([{ provider: { name: 'DraftKings' }, moneyline: { home: { open: { odds: '-150' } }, away: { open: { odds: '+130' } } }, pointSpread: { home: { close: { line: '-3.5', odds: '-110' } }, away: {} } }], 'H', 'A', 'x');
    expect(mk.map((m) => m.type)).toEqual(['moneyline']);
    expect(mk[0].outcomes[0].american).toBe(-150);
  });
});

describe('matchEvents', () => {
  const lists = () => [nhlEspn(), nhlPoly(), nhlKalshi()];
  it('merges the same game across the three sources (names differ, Kalshi start is derived)', () => {
    const evs = matchEvents(lists(), NOW);
    expect(evs).toHaveLength(2);
    const sea = evs.find((e) => e.home.includes('Capitals'))!;
    expect(sea.id).toBe('NHL|2026-10-11|washington-capitals|seattle-kraken');
    expect(sea.home).toBe('Washington Capitals');
    expect(new Set(sea.markets.map((m) => m.source))).toEqual(new Set(['espn-dk', 'polymarket', 'kalshi']));
    expect(sea.status).toBe('scheduled');
    expect(sea.startsAt).toBe('2026-10-11T21:00:00.000Z'); // exact ESPN time wins over Kalshi's estimate
    expect(sea.startApprox).toBeUndefined();
    // outcome names canonicalised
    const ml = sea.markets.filter((m) => m.type === 'moneyline');
    expect(ml).toHaveLength(3);
    expect(ml.every((m) => m.outcomes[0].name === 'Washington Capitals')).toBe(true);
  });
  it('sorts by start time and orders markets moneyline → spread → total', () => {
    const evs = matchEvents(lists(), NOW);
    expect(evs.map((e) => e.startsAt)).toEqual([...evs.map((e) => e.startsAt)].sort());
    const types = evs[0].markets.map((m) => m.type);
    expect(types).toEqual([...types].sort((a, b) => ['moneyline', 'spread', 'total'].indexOf(a) - ['moneyline', 'spread', 'total'].indexOf(b)));
  });
  it('mirrors a source that lists the teams the other way round', () => {
    const [e, p, k] = lists();
    const reversed: RawEvent[] = p.map((x) => ({ ...x, home: x.away, away: x.home, markets: x.markets.map(flipMarket) }));
    const evs = matchEvents([e, reversed, k], NOW);
    expect(evs).toHaveLength(2);
    const sea = evs.find((x) => x.home.includes('Capitals'))!;
    const orig = p.find((x) => x.home === 'Capitals')!.markets.find((m) => m.type === 'spread')!;
    const merged = sea.markets.find((m) => m.source === 'polymarket' && m.type === 'spread' && m.line === orig.line)!;
    expect(merged.outcomes[0].implied).toBeCloseTo(orig.outcomes[0].implied, 6);
  });
  it('flipMarket negates the spread line and swaps sides; totals untouched', () => {
    const sp = flipMarket({ source: 'kalshi', type: 'spread', line: -1.5, outcomes: [{ side: 'home', name: 'H', implied: 0.4, american: 150 }, { side: 'away', name: 'A', implied: 0.6, american: -150 }], updatedAt: '', volume: null, url: null });
    expect(sp.line).toBe(1.5);
    expect(sp.outcomes.map((o) => [o.side, o.name, o.implied])).toEqual([['home', 'A', 0.6], ['away', 'H', 0.4]]);
    const tt = { source: 'kalshi' as const, type: 'total' as const, line: 5.5, outcomes: sp.outcomes, updatedAt: '', volume: null, url: null };
    expect(flipMarket(tt)).toBe(tt);
  });
  it('does not merge games a day apart, or different leagues; drops finished and market-less games', () => {
    const mk = (over: Partial<RawEvent>): RawEvent => ({ source: 'polymarket', sport: 'NHL', league: 'NHL', home: 'Boston Bruins', away: 'Buffalo Sabres', startsAt: '2026-10-12T00:00:00Z', startQuality: 'exact', status: null, orientationTrusted: true, markets: [flipMarket({ source: 'polymarket', type: 'spread', line: 1.5, outcomes: [{ side: 'home', name: 'a', implied: 0.5, american: 100 }, { side: 'away', name: 'b', implied: 0.5, american: 100 }], updatedAt: '', volume: 1, url: null })], ...over });
    const a = mk({});
    const b = mk({ source: 'kalshi', startsAt: '2026-10-13T00:00:00Z', startQuality: 'approx' });
    expect(matchEvents([[a], [b]], NOW)).toHaveLength(2);
    const c = mk({ source: 'kalshi', league: 'AHL' });
    expect(matchEvents([[a], [c]], NOW)).toHaveLength(2);
    expect(matchEvents([[mk({ status: 'final' })]], NOW)).toHaveLength(0);
    expect(matchEvents([[mk({ markets: [] })]], NOW)).toHaveLength(0);
    expect(matchEvents([[mk({ startsAt: '2026-10-10T10:00:00Z' })]], NOW)).toHaveLength(0); // started > 5 h ago, no status → presumed over
  });
  it('date-only Kalshi records (college/soccer) join by local date and flag startApprox when alone', () => {
    const base = { sport: 'CFB' as const, league: 'NCAAF', home: 'Boise St.', away: 'Fresno St.', orientationTrusted: true, status: null, markets: nhlKalshi()[0].markets };
    const k: RawEvent = { ...base, source: 'kalshi', startsAt: '2026-10-10T17:00:00Z', startQuality: 'approx', dateOnly: '2026-10-10' };
    const p: RawEvent = { ...base, source: 'polymarket', home: 'Boise State', away: 'Fresno State', startsAt: '2026-10-11T02:30:00Z', startQuality: 'exact' };
    const merged = matchEvents([[p], [k]], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0].startsAt).toBe('2026-10-11T02:30:00.000Z');
    const alone = matchEvents([[{ ...k, startsAt: '2026-10-12T17:00:00Z', dateOnly: '2026-10-12' }]], NOW);
    expect(alone[0].startApprox).toBe(true);
  });
});

describe('fan-out planner (free tier: ≤ 50 subrequests)', () => {
  it('single sports stay small', () => {
    const nba = planFanout('NBA', NOW);
    expect(nba.jobs.map((j) => j.source).sort()).toEqual(['espn-dk', 'espn-dk', 'espn-dk', 'kalshi', 'kalshi', 'kalshi', 'polymarket', 'polymarket']);
    expect(nba.trimmed).toBe(0);
    for (const s of ['NHL', 'MLB', 'WNBA', 'NFL', 'CFB', 'CBB', 'UFC'] as const) expect(planFanout(s, NOW).jobs.length).toBeLessThanOrEqual(10);
  });
  it('FC (all leagues) and ALL never exceed the budget; ALL excludes soccer and trims the lowest-priority calls', () => {
    const fc = planFanout('FC', NOW);
    expect(fc.jobs.length).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    const all = planFanout('ALL', NOW);
    expect(all.jobs.length).toBeLessThanOrEqual(SUBREQUEST_BUDGET);
    expect(all.jobs.some((j) => j.spec.sport === 'FC')).toBe(false);
    // ALL is "lite": exchanges' bulky spread/total feeds are skipped (CPU), moneyline + all DraftKings lines kept
    expect(all.jobs.some((j) => j.source === 'kalshi' && j.spec.type !== 'moneyline')).toBe(false);
    expect(all.jobs.some((j) => j.source === 'polymarket' && j.kind === 'props')).toBe(false);
    // a tiny budget trims lowest priority first: moneyline calls survive, ESPN "tomorrow" goes first
    const tiny = planFanout('NBA', NOW, 5);
    expect(tiny.trimmed).toBe(3);
    expect(tiny.jobs.every((j) => j.priority <= 2)).toBe(true);
    expect(planFanout('NBA', NOW, 44, true).jobs.some((j) => j.id === 'kalshi:KXNBASPREAD')).toBe(false);
    // every league's moneyline + today's ESPN call survives the trim
    for (const l of ['NBA', 'NHL', 'MLB', 'NFL', 'WNBA', 'NCAAF', 'NCAAB', 'UFC']) {
      expect(all.jobs.some((j) => j.source === 'espn-dk' && j.spec.league === l)).toBe(true);
      expect(all.jobs.some((j) => j.source === 'polymarket' && j.spec.league === l)).toBe(true);
    }
  });
  it('URLs: Kalshi close window, Polymarket tag + type filters, ESPN single ET date and no custom headers needed', () => {
    const { jobs } = planFanout('NHL', NOW);
    const k = jobs.find((j) => j.id === 'kalshi:KXNHLGAME')!;
    expect(k.url).toContain('series_ticker=KXNHLGAME&status=open&limit=1000&max_close_ts=' + (Math.floor(NOW / 1000) + 6 * 86400));
    const p = jobs.find((j) => j.id === 'polymarket:NHL:props')!;
    expect(p.url).toContain('tag_id=899');
    expect(p.url).toContain('sports_market_types=spreads&sports_market_types=totals');
    const e = jobs.filter((j) => j.source === 'espn-dk');
    expect(e.map((j) => j.url.match(/dates=(\d{8})$/)?.[1])).toEqual(['20261010', '20261011', '20261012']);
    expect(e[0].url).toBe('https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=hockey&league=nhl&dates=20261010');
  });
});
