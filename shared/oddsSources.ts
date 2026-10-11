/**
 * Tab 9 data layer — pure parsing / matching for the three FREE odds sources. NO fetch in this file (the Pages Function
 * does the I/O); everything here is deterministic and unit-tested against recorded responses in tests/fixtures/odds/.
 *
 *   Kalshi      https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=…   (exchange, prices in dollars)
 *   Polymarket  https://gamma-api.polymarket.com/markets?tag_id=…&sports_market_types=… (exchange, outcomePrices)
 *   ESPN / DK   https://site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard?dates=YYYYMMDD (DraftKings lines)
 *
 * FanDuel (and every other sportsbook) has no public API and is deliberately NOT used. See docs/ODDS-SOURCES.md.
 */
import type { MarketType, OddsEvent, OddsMarket, OddsOutcome, OddsSource, OddsSport } from './odds';
import { americanToImplied, impliedToAmerican } from './odds';

/* ------------------------------------------------------------------ */
/* Registries (what to call, per sport)                                */
/* ------------------------------------------------------------------ */

export interface KalshiSeriesSpec {
  sport: OddsSport;
  league: string;
  type: MarketType;
  series: string;
}
export interface PolyTagSpec {
  sport: OddsSport;
  league: string;
  /** Gamma tag id (the `primaryTagId` from gamma-api.polymarket.com/sports). */
  tag: number;
  /** Which side Polymarket lists first in titles/outcomes: US sports list the AWAY team first, soccer the HOME team. */
  first: 'away' | 'home';
  /** Also pull spreads/totals (second, heavier call). */
  props: boolean;
  /** Polymarket's market `endDate` is the game start for most leagues, but start + ~8 days for MLB; shift the date filter by this many days. */
  endLagDays?: number;
}
export interface EspnLeagueSpec {
  sport: OddsSport;
  league: string;
  path: string;
}

const K = (sport: OddsSport, league: string, prefix: string, types: Array<'GAME' | 'SPREAD' | 'TOTAL'> = ['GAME', 'SPREAD', 'TOTAL']): KalshiSeriesSpec[] =>
  types.map((t) => ({ sport, league, series: prefix + t, type: (t === 'GAME' ? 'moneyline' : t === 'SPREAD' ? 'spread' : 'total') as MarketType }));

export const KALSHI_SERIES: KalshiSeriesSpec[] = [
  ...K('NBA', 'NBA', 'KXNBA'),
  ...K('NHL', 'NHL', 'KXNHL'),
  ...K('MLB', 'MLB', 'KXMLB'),
  ...K('WNBA', 'WNBA', 'KXWNBA'),
  ...K('NFL', 'NFL', 'KXNFL'),
  ...K('CFB', 'NCAAF', 'KXNCAAF'),
  ...K('CBB', 'NCAAB', 'KXNCAAMB'),
  { sport: 'UFC', league: 'UFC', series: 'KXUFCFIGHT', type: 'moneyline' },
  { sport: 'UFC', league: 'UFC', series: 'KXUFCROUNDS', type: 'total' },
  // Soccer: game winners for every league, spread/total only for the two biggest (subrequest budget).
  ...K('FC', 'EPL', 'KXEPL'),
  ...K('FC', 'UCL', 'KXUCL'),
  ...K('FC', 'LALIGA', 'KXLALIGA', ['GAME']),
  ...K('FC', 'SERIEA', 'KXSERIEA', ['GAME']),
  ...K('FC', 'BUNDESLIGA', 'KXBUNDESLIGA', ['GAME']),
  ...K('FC', 'LIGUE1', 'KXLIGUE1', ['GAME']),
  ...K('FC', 'UEL', 'KXUEL', ['GAME']),
  ...K('FC', 'MLS', 'KXMLS', ['GAME']),
];

export const POLY_TAGS: PolyTagSpec[] = [
  { sport: 'NBA', league: 'NBA', tag: 745, first: 'away', props: true },
  { sport: 'NHL', league: 'NHL', tag: 899, first: 'away', props: true },
  { sport: 'MLB', league: 'MLB', tag: 100381, first: 'away', props: true, endLagDays: 8 },
  { sport: 'WNBA', league: 'WNBA', tag: 100254, first: 'away', props: true },
  { sport: 'NFL', league: 'NFL', tag: 450, first: 'away', props: true },
  { sport: 'CFB', league: 'NCAAF', tag: 100351, first: 'away', props: true },
  { sport: 'CBB', league: 'NCAAB', tag: 101178, first: 'away', props: true },
  { sport: 'UFC', league: 'UFC', tag: 279, first: 'home', props: true },
  { sport: 'FC', league: 'EPL', tag: 306, first: 'home', props: false },
  { sport: 'FC', league: 'UCL', tag: 100977, first: 'home', props: false },
  { sport: 'FC', league: 'LALIGA', tag: 780, first: 'home', props: false },
  { sport: 'FC', league: 'SERIEA', tag: 101962, first: 'home', props: false },
  { sport: 'FC', league: 'BUNDESLIGA', tag: 1494, first: 'home', props: false },
  { sport: 'FC', league: 'LIGUE1', tag: 102070, first: 'home', props: false },
  { sport: 'FC', league: 'UEL', tag: 101787, first: 'home', props: false },
  { sport: 'FC', league: 'MLS', tag: 100100, first: 'home', props: false },
];

export const ESPN_LEAGUES: EspnLeagueSpec[] = [
  { sport: 'NBA', league: 'NBA', path: 'basketball/nba' },
  { sport: 'NHL', league: 'NHL', path: 'hockey/nhl' },
  { sport: 'MLB', league: 'MLB', path: 'baseball/mlb' },
  { sport: 'WNBA', league: 'WNBA', path: 'basketball/wnba' },
  { sport: 'NFL', league: 'NFL', path: 'football/nfl' },
  { sport: 'CFB', league: 'NCAAF', path: 'football/college-football' },
  { sport: 'CBB', league: 'NCAAB', path: 'basketball/mens-college-basketball' },
  { sport: 'UFC', league: 'UFC', path: 'mma/ufc' },
  { sport: 'FC', league: 'EPL', path: 'soccer/eng.1' },
  { sport: 'FC', league: 'LALIGA', path: 'soccer/esp.1' },
  { sport: 'FC', league: 'SERIEA', path: 'soccer/ita.1' },
  { sport: 'FC', league: 'BUNDESLIGA', path: 'soccer/ger.1' },
  { sport: 'FC', league: 'LIGUE1', path: 'soccer/fra.1' },
  { sport: 'FC', league: 'UCL', path: 'soccer/uefa.champions' },
  { sport: 'FC', league: 'UEL', path: 'soccer/uefa.europa' },
  { sport: 'FC', league: 'MLS', path: 'soccer/usa.1' },
];

/** Kalshi's `occurrence_datetime` is the EXPECTED END of the game; start ≈ occurrence − this many hours (calibrated against ESPN/Polymarket, see docs). */
export const KALSHI_DURATION_H: Partial<Record<OddsSport, number>> = { NFL: 3, MLB: 3, NBA: 3, WNBA: 3, NHL: 3, CFB: 3, CBB: 2.5, UFC: 0, FC: 0 };

/* ------------------------------------------------------------------ */
/* Fan-out planner (free-tier: ≤ 50 subrequests per invocation)        */
/* ------------------------------------------------------------------ */

export type FanoutJob =
  | { id: string; source: 'kalshi'; url: string; priority: number; spec: KalshiSeriesSpec }
  | { id: string; source: 'polymarket'; url: string; priority: number; spec: PolyTagSpec; kind: 'moneyline' | 'props' }
  | { id: string; source: 'espn-dk'; url: string; priority: number; spec: EspnLeagueSpec; date: string };

export const SUBREQUEST_BUDGET = 44; // Cloudflare free tier allows 50 per invocation; keep headroom.

/** US Eastern calendar date `offset` days from `now`, as YYYYMMDD (what ESPN's `dates=` expects). */
export function etDate(nowMs: number, offset: number): string {
  const d = new Date(nowMs + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).replace(/-/g, '');
}

/** ESPN's compact "scoreboard header" feed: same DraftKings odds as the scoreboard at ~1/15 of the bytes (NFL Sunday: 13 KB vs 228 KB). */
export const espnUrl = (spec: EspnLeagueSpec, date: string) => {
  const [sport, league] = spec.path.split('/');
  return `https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=${sport}&league=${league}&dates=${date}`;
};

const TIER3_ORDER: OddsSport[] = ['NFL', 'NBA', 'NHL', 'MLB', 'CFB', 'CBB', 'WNBA', 'UFC', 'FC'];

/**
 * Which upstream calls to make. Single sport: everything for that sport (NBA ≈ 8 calls, FC ≈ 36). ALL = every sport except
 * FC (FC is its own request: it alone needs ~36), trimmed by priority to `budget` calls:
 *   1 moneyline (Kalshi *GAME, Polymarket moneyline, ESPN today)  2 ESPN tomorrow  3 Kalshi spread/total  4 Polymarket spreads/totals.
 */
export function planFanout(sport: OddsSport | 'ALL', nowMs: number, budget = SUBREQUEST_BUDGET, lite = false): { jobs: FanoutJob[]; trimmed: number } {
  const all = sport === 'ALL';
  const light = all || lite; // ALL / ?markets=ml: moneyline-only from the exchanges (their spread/total feeds are the bulk of the bytes → CPU)
  const want = (s: OddsSport) => (all ? s !== 'FC' : s === sport);
  const days = all ? 2 : 3;
  const sec = Math.floor(nowMs / 1000);
  const jobs: FanoutJob[] = [];

  for (const spec of KALSHI_SERIES.filter((s) => want(s.sport) && (!light || s.type === 'moneyline'))) {
    // close_time is ~2-3 days AFTER the game, so widen the window by 3 days to see games starting within `days`.
    const url = `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${spec.series}&status=open&limit=1000&max_close_ts=${sec + (days + 3) * 86400}`;
    const tier = spec.type === 'moneyline' ? 1 : 3 + TIER3_ORDER.indexOf(spec.sport) / 100;
    jobs.push({ id: `kalshi:${spec.series}`, source: 'kalshi', url, priority: tier, spec });
  }
  for (const spec of POLY_TAGS.filter((s) => want(s.sport))) {
    const lag = (spec.endLagDays ?? 0) * 86_400_000;
    // With a lag the exact offset varies by ±1 day, so widen the window by a day each side and filter by gameStartTime afterwards.
    const lo = new Date(nowMs - 6 * 3600_000 + (lag ? lag - 86_400_000 : 0)).toISOString();
    const hi = new Date(nowMs + days * 86_400_000 + (lag ? lag + 86_400_000 : 0)).toISOString();
    const base = `https://gamma-api.polymarket.com/markets?tag_id=${spec.tag}&active=true&closed=false&end_date_min=${lo}&end_date_max=${hi}`;
    jobs.push({ id: `polymarket:${spec.league}:ml`, source: 'polymarket', kind: 'moneyline', spec, priority: 1, url: `${base}&sports_market_types=moneyline&order=endDate&ascending=true&limit=100` });
    if (spec.props && !light) {
      jobs.push({ id: `polymarket:${spec.league}:props`, source: 'polymarket', kind: 'props', spec, priority: 4 + TIER3_ORDER.indexOf(spec.sport) / 100, url: `${base}&sports_market_types=spreads&sports_market_types=totals&order=liquidityNum&ascending=false&limit=80` });
    }
  }
  for (const spec of ESPN_LEAGUES.filter((s) => want(s.sport))) {
    for (let d = 0; d < days; d++) {
      const date = etDate(nowMs, d);
      jobs.push({ id: `espn:${spec.league}:${date}`, source: 'espn-dk', spec, date, priority: d === 0 ? 1 : 2, url: espnUrl(spec, date) });
    }
  }
  jobs.sort((a, b) => a.priority - b.priority);
  const kept = jobs.slice(0, budget);
  return { jobs: kept, trimmed: jobs.length - kept.length };
}

/* ------------------------------------------------------------------ */
/* Team-name normalisation + matching                                  */
/* ------------------------------------------------------------------ */

const NOISE = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'club', 'the', 'de', 'fk', 'sk', 'cd', 'ud', 'ca', 'rc', 'cp', 'calcio', 'futbol', 'balompie']);
// Whole-phrase aliases (after lower-casing + punctuation stripping).
const PHRASE_ALIAS: Record<string, string> = {
  lafc: 'los angeles fc',
  'la galaxy': 'los angeles galaxy',
  'man city': 'manchester city',
  'man utd': 'manchester united',
  'man united': 'manchester united',
  psg: 'paris saint germain',
  'ny yankees': 'new york yankees',
  'ny mets': 'new york mets',
  'dc united': 'd c united',
  'm gladbach': 'gladbach',
  psv: 'eindhoven',
  'psv eindhoven': 'eindhoven',
  'deportivo a coruna': 'deportivo coruna',
  'rc deportivo a coruna': 'deportivo coruna',
  'deportivo la coruna': 'deportivo coruna',
  'monchengladbach': 'gladbach',
};
const TOKEN_ALIAS: Record<string, string> = { koln: 'cologne', munchen: 'munich', praha: 'prague', bodoe: 'bodo', bodo: 'bodo', glimt: 'glimt', internazionale: 'inter', monchengladbach: 'gladbach', 'mgladbach': 'gladbach' };

/** Lower-cased tokens: diacritics/punctuation stripped, "St." → saint (leading) / state (elsewhere), "LA" → los angeles. */
const tokenCache = new Map<string, string[]>();
export function teamTokens(name: string): string[] {
  const hit = tokenCache.get(name);
  if (hit) return hit;
  const t = computeTokens(name);
  if (tokenCache.size > 5000) tokenCache.clear();
  tokenCache.set(name, t);
  return t;
}
function computeTokens(name: string): string[] {
  let s = (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ø/gi, 'o')
    .toLowerCase()
    .replace(/['’`.]/g, '')
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (PHRASE_ALIAS[s]) s = PHRASE_ALIAS[s];
  let t = s.split(' ').filter(Boolean);
  if (t[0] === '1' && t.length > 1) t = t.slice(1); // "1. FC Köln"
  if (t[0] === 'la' && t.length > 1) t = ['los', 'angeles', ...t.slice(1)];
  if (t[0] === 'st') t[0] = 'saint';
  t = t.map((x, i) => (i > 0 && x === 'st' ? 'state' : TOKEN_ALIAS[x] ?? x));
  return t;
}

const noiseCache = new WeakMap<string[], string[]>();
const stripNoise = (t: string[]) => {
  let r = noiseCache.get(t);
  if (!r) {
    const f = t.filter((x) => !NOISE.has(x));
    r = f.length ? f : t;
    noiseCache.set(t, r);
  }
  return r;
};

/** Canonical comparable form (noise words stripped), also used to build stable ids. */
export const normTeam = (name: string): string => stripNoise(teamTokens(name)).join(' ');

const startsWithTokens = (a: string[], p: string[]) => p.length > 0 && p.length <= a.length && p.every((x, i) => a[i] === x);
const endsWithTokens = (a: string[], p: string[]) => p.length > 0 && p.length <= a.length && p.every((x, i) => a[a.length - p.length + i] === x);

/** Kalshi disambiguates same-city teams with a trailing letter: "Los Angeles C" (Clippers), "New York R" (Rangers). */
function singleLetterMatch(short: string[], long: string[]): boolean {
  if (short.length < 2) return false;
  const letter = short[short.length - 1];
  if (letter.length !== 1) return false;
  const city = short.slice(0, -1);
  return startsWithTokens(long, city) && long.length > city.length && long[city.length][0] === letter;
}

/** Do two team-name strings (from different sources) refer to the same team? Pure heuristics, no alias DB beyond the few above. */
export function teamsMatch(a: string, b: string): boolean {
  const ta = teamTokens(a);
  const tb = teamTokens(b);
  if (!ta.length || !tb.length) return false;
  if (singleLetterMatch(ta, tb) || singleLetterMatch(tb, ta)) return true;
  const na = stripNoise(ta);
  const nb = stripNoise(tb);
  if (na.join(' ') === nb.join(' ')) return true;
  const [s, l] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (s.join('').length < 3) return false;
  return startsWithTokens(l, s) || endsWithTokens(l, s);
}


/* ------------------------------------------------------------------ */
/* Pro-league team names (lets city-only Kalshi names meet nickname-only Polymarket names when ESPN is absent) */
/* ------------------------------------------------------------------ */

const nm = (cities: string, nicks: string): string[] => {
  // "A|B|C" cities zipped with "x|y|z" nicknames.
  const c = cities.split('|');
  const n = nicks.split('|');
  return c.map((city, i) => `${city} ${n[i]}`);
};

export const TEAM_NAMES: Partial<Record<OddsSport, string[]>> = {
  NFL: nm(
    'Arizona|Atlanta|Baltimore|Buffalo|Carolina|Chicago|Cincinnati|Cleveland|Dallas|Denver|Detroit|Green Bay|Houston|Indianapolis|Jacksonville|Kansas City|Las Vegas|Los Angeles|Los Angeles|Miami|Minnesota|New England|New Orleans|New York|New York|Philadelphia|Pittsburgh|San Francisco|Seattle|Tampa Bay|Tennessee|Washington',
    'Cardinals|Falcons|Ravens|Bills|Panthers|Bears|Bengals|Browns|Cowboys|Broncos|Lions|Packers|Texans|Colts|Jaguars|Chiefs|Raiders|Chargers|Rams|Dolphins|Vikings|Patriots|Saints|Giants|Jets|Eagles|Steelers|49ers|Seahawks|Buccaneers|Titans|Commanders',
  ),
  NBA: nm(
    'Atlanta|Boston|Brooklyn|Charlotte|Chicago|Cleveland|Dallas|Denver|Detroit|Golden State|Houston|Indiana|Los Angeles|Los Angeles|Memphis|Miami|Milwaukee|Minnesota|New Orleans|New York|Oklahoma City|Orlando|Philadelphia|Phoenix|Portland|Sacramento|San Antonio|Toronto|Utah|Washington',
    'Hawks|Celtics|Nets|Hornets|Bulls|Cavaliers|Mavericks|Nuggets|Pistons|Warriors|Rockets|Pacers|Clippers|Lakers|Grizzlies|Heat|Bucks|Timberwolves|Pelicans|Knicks|Thunder|Magic|76ers|Suns|Trail Blazers|Kings|Spurs|Raptors|Jazz|Wizards',
  ),
  NHL: nm(
    'Anaheim|Boston|Buffalo|Calgary|Carolina|Chicago|Colorado|Columbus|Dallas|Detroit|Edmonton|Florida|Los Angeles|Minnesota|Montreal|Nashville|New Jersey|New York|New York|Ottawa|Philadelphia|Pittsburgh|San Jose|Seattle|St. Louis|Tampa Bay|Toronto|Utah|Vancouver|Vegas|Washington|Winnipeg',
    'Ducks|Bruins|Sabres|Flames|Hurricanes|Blackhawks|Avalanche|Blue Jackets|Stars|Red Wings|Oilers|Panthers|Kings|Wild|Canadiens|Predators|Devils|Islanders|Rangers|Senators|Flyers|Penguins|Sharks|Kraken|Blues|Lightning|Maple Leafs|Mammoth|Canucks|Golden Knights|Capitals|Jets',
  ),
  MLB: nm(
    'Arizona|Atlanta|Baltimore|Boston|Chicago|Chicago|Cincinnati|Cleveland|Colorado|Detroit|Houston|Kansas City|Los Angeles|Los Angeles|Miami|Milwaukee|Minnesota|New York|New York|Athletics|Philadelphia|Pittsburgh|San Diego|San Francisco|Seattle|St. Louis|Tampa Bay|Texas|Toronto|Washington',
    'Diamondbacks|Braves|Orioles|Red Sox|Cubs|White Sox|Reds|Guardians|Rockies|Tigers|Astros|Royals|Angels|Dodgers|Marlins|Brewers|Twins|Yankees|Mets|Athletics|Phillies|Pirates|Padres|Giants|Mariners|Cardinals|Rays|Rangers|Blue Jays|Nationals',
  ).map((x) => x.replace(/^Athletics Athletics$/, 'Athletics')),
  WNBA: nm(
    'Atlanta|Chicago|Connecticut|Dallas|Golden State|Indiana|Las Vegas|Los Angeles|Minnesota|New York|Phoenix|Seattle|Washington|Toronto|Portland',
    'Dream|Sky|Sun|Wings|Valkyries|Fever|Aces|Sparks|Lynx|Liberty|Mercury|Storm|Mystics|Tempo|Fire',
  ),
};

/** Resolve a short source name ("Detroit", "Red Wings", "Los Angeles C") to the full league name when it is unambiguous. */
const resolveCache = new Map<string, string>();
export function resolveTeam(sport: OddsSport, name: string): string {
  const table = TEAM_NAMES[sport];
  if (!table) return name;
  const key = `${sport}|${name}`;
  const hit = resolveCache.get(key);
  if (hit !== undefined) return hit;
  const hits = table.filter((full) => teamsMatch(full, name));
  const out = hits.length === 1 ? hits[0] : name;
  if (resolveCache.size > 5000) resolveCache.clear();
  resolveCache.set(key, out);
  return out;
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

/** A source's view of one game, before cross-source matching. Markets are oriented to THIS record's home/away. */
export interface RawEvent {
  source: OddsSource;
  sport: OddsSport;
  league: string;
  home: string;
  away: string;
  startsAt: string;
  /** 'approx' = derived (Kalshi) → matched with a wider time tolerance. */
  startQuality: 'exact' | 'approx';
  /** Local game date (YYYY-MM-DD) when the source only gives a date, not a time (Kalshi college / soccer / UFC: its `occurrence_datetime` is a placeholder). */
  dateOnly?: string;
  status: 'scheduled' | 'live' | 'final' | null;
  /** Orientation trustworthy (ESPN/Polymarket US sports) — used to pick the canonical home/away. */
  orientationTrusted: boolean;
  markets: OddsMarket[];
}

const num = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const rec = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const round4 = (x: number) => Math.round(x * 10000) / 10000;

function outcome(side: OddsOutcome['side'], name: string, implied: number, american?: number | null): OddsOutcome {
  return { side, name, implied: round4(implied), american: american === undefined ? impliedToAmerican(implied) : american };
}
const fmtLine = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** Mirror a market to the other team's perspective (home ↔ away). Totals are orientation-free. */
export function flipMarket(m: OddsMarket): OddsMarket {
  if (m.type === 'total') return m;
  const [h, a] = m.outcomes;
  const outcomes: [OddsOutcome, OddsOutcome] = [{ ...a, side: 'home' }, { ...h, side: 'away' }];
  return { ...m, line: m.line === null ? null : m.line === 0 ? 0 : -m.line, outcomes, draw: m.draw };
}

/* ------------------------------------------------------------------ */
/* Kalshi                                                              */
/* ------------------------------------------------------------------ */

export interface KalshiPayload {
  spec: KalshiSeriesSpec;
  json: unknown;
}

interface KQuote {
  p: number;
  width: number | null;
  liq: number | null;
  vol: number;
}

/** Usable mid from a Kalshi yes book, or null if empty/illiquid. Prices are `*_dollars` strings (0–1). */
export function kalshiQuote(m: Record<string, unknown>): KQuote | null {
  const bid = num(m.yes_bid_dollars) ?? 0;
  const ask = num(m.yes_ask_dollars) ?? 0;
  const last = num(m.last_price_dollars) ?? 0;
  const vol = num(m.volume_fp) ?? 0;
  if (bid > 0 && ask > 0 && ask < 1 && ask >= bid && ask - bid <= 0.3) {
    const bs = num(m.yes_bid_size_fp);
    const as = num(m.yes_ask_size_fp);
    return { p: (bid + ask) / 2, width: round4(ask - bid), liq: bs !== null && as !== null ? Math.min(bs, as) : null, vol };
  }
  if (last > 0 && last < 1 && vol > 0) return { p: last, width: null, liq: null, vol };
  return null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** `26OCT15…` → "2026-10-15" (the game's local date, from the Kalshi ticker). */
export function kalshiTickerDate(suffix: string): string | null {
  const m = /^(\d{2})([A-Z]{3})(\d{2})/.exec(suffix);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[2]);
  return mo < 0 ? null : `20${m[1]}-${String(mo + 1).padStart(2, '0')}-${m[3]}`;
}

interface KGame {
  suffix: string;
  spec: KalshiSeriesSpec;
  home: string;
  away: string;
  startMs: number;
  startQuality: 'exact' | 'approx';
  dateOnly?: string;
  markets: OddsMarket[];
  vol: number;
}

const groupBy = <T>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const a = m.get(k);
    if (a) a.push(x);
    else m.set(k, [x]);
  }
  return m;
};

const kMarkets = (p: KalshiPayload): Array<Record<string, unknown>> =>
  arr(rec(p.json).markets).map(rec).filter((m) => !m.status || m.status === 'active' || m.status === 'open');

const suffixOf = (eventTicker: string, series: string) => eventTicker.slice(series.length + 1);

/** Which Kalshi team is listed first in the event ticker/title: US sports list the AWAY team first, soccer the HOME team. */
const kalshiFirstIsAway = (sport: OddsSport) => sport !== 'FC' && sport !== 'UFC';

/**
 * Kalshi → RawEvent[]. Game-winner series define the events (teams, order, start); spread and total series attach to them
 * through the shared ticker suffix (`KXNFLGAME-26OCT15SEADEN` ↔ `KXNFLSPREAD-26OCT15SEADEN`).
 */
export function parseKalshi(payloads: KalshiPayload[]): RawEvent[] {
  const games = new Map<string, KGame>(); // key: league|suffix

  // 1. Game winners → events + moneyline.
  for (const p of payloads.filter((x) => x.spec.type === 'moneyline')) {
    const byEvent = groupBy(kalshiMarketsWithEvent(p), (m) => str(m.event_ticker));
    for (const [et, ms] of byEvent) {
      const suffix = suffixOf(et, p.spec.series);
      const teamMs = ms.filter((m) => !/^tie$/i.test(str(m.yes_sub_title)));
      const tieM = ms.find((m) => /^tie$/i.test(str(m.yes_sub_title)));
      if (teamMs.length !== 2) continue;
      const code = (m: Record<string, unknown>) => str(m.ticker).split('-').pop() ?? '';
      const rest = suffix.replace(/^\d{2}[A-Z]{3}\d{2}(\d{4})?/, '');
      const [m1, m2] = teamMs;
      // Order in the ticker is [first][second]; find which market's code is the prefix.
      const firstM = rest.startsWith(code(m1)) && rest.slice(code(m1).length) === code(m2) ? m1 : rest.startsWith(code(m2)) && rest.slice(code(m2).length) === code(m1) ? m2 : m1;
      const secondM = firstM === m1 ? m2 : m1;
      const awayFirst = kalshiFirstIsAway(p.spec.sport);
      const awayM = awayFirst ? firstM : secondM;
      const homeM = awayFirst ? secondM : firstM;
      const date = kalshiTickerDate(suffix);
      const occ = Date.parse(str(firstM.occurrence_datetime));
      const dur = KALSHI_DURATION_H[p.spec.sport] ?? 0;
      const dateOnlySport = p.spec.sport === 'FC' || p.spec.sport === 'UFC' || p.spec.sport === 'CFB' || p.spec.sport === 'CBB';
      let startMs: number;
      const startQuality: 'exact' | 'approx' = 'approx';
      if (dateOnlySport || !Number.isFinite(occ)) startMs = Date.parse(`${date ?? '1970-01-01'}T${p.spec.sport === 'FC' ? '15:00' : '17:00'}:00Z`);
      else startMs = occ - dur * 3600_000;
      const g: KGame = { suffix, spec: p.spec, home: str(homeM.yes_sub_title), away: str(awayM.yes_sub_title), startMs, startQuality, dateOnly: dateOnlySport && date ? date : undefined, markets: [], vol: 0 };

      const qh = kalshiQuote(homeM);
      const qa = kalshiQuote(awayM);
      const qt = tieM ? kalshiQuote(tieM) : null;
      const three = !!tieM;
      if ((qh || qa) && (!three || (qh && qa && qt))) {
        const ph = qh ? qh.p : 1 - (qa as KQuote).p;
        const pa = qa ? qa.p : 1 - (qh as KQuote).p;
        const vol = (qh?.vol ?? 0) + (qa?.vol ?? 0) + (qt?.vol ?? 0);
        const mk: OddsMarket = {
          source: 'kalshi',
          type: 'moneyline',
          line: null,
          outcomes: [outcome('home', g.home, ph), outcome('away', g.away, pa)],
          updatedAt: str(homeM.updated_time) || new Date(startMs).toISOString(),
          volume: vol,
          url: kalshiUrl(p.spec.series),
          width: qh?.width ?? qa?.width ?? null,
          liquidity: qh?.liq ?? qa?.liq ?? null,
        };
        if (three && qt) mk.draw = { implied: round4(qt.p), american: impliedToAmerican(qt.p) };
        g.markets.push(mk);
      }
      games.set(`${p.spec.league}|${suffix}`, g);
    }
  }

  // 2. Spreads: "X wins by over N.5 …" → X covers −N.5.
  for (const p of payloads.filter((x) => x.spec.type === 'spread')) {
    const alt: Map<string, Array<{ mk: OddsMarket; dist: number }>> = new Map();
    for (const m of kalshiMarketsWithEvent(p)) {
      const g = games.get(`${p.spec.league}|${suffixOf(str(m.event_ticker), p.spec.series)}`);
      const strike = num(m.floor_strike);
      const sub = str(m.yes_sub_title);
      const tm = /^(.*?)\s+wins by over/i.exec(sub);
      const q = kalshiQuote(m);
      if (!g || strike === null || !tm || !q || q.p < 0.08 || q.p > 0.92) continue;
      const homeCovers = teamsMatch(tm[1], g.home) && !teamsMatch(tm[1], g.away) ? true : teamsMatch(tm[1], g.away) ? false : null;
      if (homeCovers === null) continue;
      const line = homeCovers ? -strike : strike; // home team's line
      const pHome = homeCovers ? q.p : 1 - q.p;
      const mk: OddsMarket = {
        source: 'kalshi',
        type: 'spread',
        line,
        outcomes: [outcome('home', g.home, pHome), outcome('away', g.away, 1 - pHome)],
        updatedAt: str(m.updated_time) || new Date(g.startMs).toISOString(),
        volume: q.vol,
        url: kalshiUrl(p.spec.series),
        width: q.width,
        liquidity: q.liq,
      };
      const key = `${p.spec.league}|${g.suffix}`;
      const l = alt.get(key) ?? [];
      l.push({ mk, dist: Math.abs(q.p - 0.5) });
      alt.set(key, l);
    }
    for (const [key, l] of alt) games.get(key)?.markets.push(...topLines(l));
  }

  // 3. Totals: "Over N.5 …" (floor_strike = N.5).
  for (const p of payloads.filter((x) => x.spec.type === 'total')) {
    const alt: Map<string, Array<{ mk: OddsMarket; dist: number }>> = new Map();
    for (const m of kalshiMarketsWithEvent(p)) {
      const g = games.get(`${p.spec.league}|${suffixOf(str(m.event_ticker), p.spec.series)}`);
      const strike = num(m.floor_strike);
      const q = kalshiQuote(m);
      if (!g || strike === null || !q || q.p < 0.08 || q.p > 0.92) continue;
      const mk: OddsMarket = {
        source: 'kalshi',
        type: 'total',
        line: strike,
        outcomes: [outcome('over', `Over ${fmtLine(strike)}`, q.p), outcome('under', `Under ${fmtLine(strike)}`, 1 - q.p)],
        updatedAt: str(m.updated_time) || new Date(g.startMs).toISOString(),
        volume: q.vol,
        url: kalshiUrl(p.spec.series),
        width: q.width,
        liquidity: q.liq,
      };
      const key = `${p.spec.league}|${g.suffix}`;
      const l = alt.get(key) ?? [];
      l.push({ mk, dist: Math.abs(q.p - 0.5) });
      alt.set(key, l);
    }
    for (const [key, l] of alt) games.get(key)?.markets.push(...topLines(l));
  }

  const out: RawEvent[] = [];
  for (const g of games.values()) {
    if (!g.markets.length) continue;
    out.push({
      source: 'kalshi',
      sport: g.spec.sport,
      league: g.spec.league,
      home: g.home,
      away: g.away,
      startsAt: new Date(g.startMs).toISOString(),
      startQuality: g.startQuality,
      dateOnly: g.dateOnly,
      status: null,
      orientationTrusted: g.spec.sport !== 'UFC',
      markets: g.markets,
    });
  }
  return out;
}

const MAX_ALT_LINES = 6;
/** Keep the alternate lines closest to a coin-flip (that's where the real "main" lines are). */
function topLines(l: Array<{ mk: OddsMarket; dist: number }>): OddsMarket[] {
  return l
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_ALT_LINES)
    .map((x) => x.mk);
}

const kalshiUrl = (series: string) => `https://kalshi.com/markets/${series.toLowerCase()}`;

/** Markets of a payload (active only). Kept as a function so tests can import it. */
function kalshiMarketsWithEvent(p: KalshiPayload): Array<Record<string, unknown>> {
  return kMarkets(p).filter((m) => str(m.event_ticker).startsWith(p.spec.series + '-'));
}

/* ------------------------------------------------------------------ */
/* Polymarket                                                          */
/* ------------------------------------------------------------------ */

export interface PolyPayload {
  spec: PolyTagSpec;
  /** `/markets?…sports_market_types=moneyline` response (array). */
  moneyline?: unknown;
  /** `/markets?…sports_market_types=spreads&…=totals` response (array). */
  props?: unknown;
}

/** "2026-10-11 22:00:00+00" → ISO. */
export function polyTime(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const iso = s.includes('T') ? s : s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const t = Date.parse(iso.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** "UFC Fight Night: A vs. B (Middleweight, Main Card)" / "Canucks vs. Rangers" → ['A','B']. */
export function splitTitle(title: string): [string, string] | null {
  let t = title.replace(/\s*\([^)]*\)\s*$/, '');
  if (/ vs\.? /i.test(t) && t.includes(':')) t = t.slice(t.indexOf(':') + 1);
  const m = /^(.*?)\s+vs\.?\s+(.*?)$/i.exec(t.trim());
  return m ? [m[1].trim(), m[2].trim()] : null;
}

const parseJsonArr = (x: unknown): unknown[] => {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') {
    try {
      const v = JSON.parse(x);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
};

interface PEvent {
  slug: string;
  title: string;
  startsAt: string;
  home: string;
  away: string;
  trusted: boolean;
  markets: OddsMarket[];
  soccer: { home?: number; away?: number; draw?: number; vol: number; liq: number | null; width: number | null; updatedAt: string };
}

/** Polymarket Gamma `/markets` payloads → RawEvent[]. */
export function parsePolymarket(payloads: PolyPayload[]): RawEvent[] {
  const out: RawEvent[] = [];
  for (const pl of payloads) {
    const events = new Map<string, PEvent>();
    const ms = [...arr(pl.moneyline), ...arr(pl.props)].map(rec);
    const evOf = (m: Record<string, unknown>) => rec(arr(m.events)[0]);
    const get = (m: Record<string, unknown>): PEvent | null => {
      const ev = evOf(m);
      const slug = str(ev.slug) || str(m.slug);
      const title = str(ev.title) || str(m.question);
      if (!slug) return null;
      let e = events.get(slug);
      if (!e) {
        const startsAt = polyTime(m.gameStartTime) ?? polyTime(ev.startTime) ?? polyTime(m.endDate);
        if (!startsAt) return null;
        const t = splitTitle(title);
        const homeFirst = pl.spec.first === 'home';
        e = {
          slug,
          title,
          startsAt,
          home: t ? (homeFirst ? t[0] : t[1]) : '',
          away: t ? (homeFirst ? t[1] : t[0]) : '',
          trusted: pl.spec.sport !== 'UFC' && !!t,
          markets: [],
          soccer: { vol: 0, liq: null, width: null, updatedAt: str(m.updatedAt) },
        };
        events.set(slug, e);
      }
      return e;
    };

    for (const m of ms) {
      if (m.closed === true || m.active === false || m.acceptingOrders === false) continue;
      const kind = str(m.sportsMarketType);
      const e = get(m);
      if (!e) continue;
      const outs = parseJsonArr(m.outcomes).map(String);
      const prices = parseJsonArr(m.outcomePrices).map((x) => num(x));
      const vol = num(m.volumeNum) ?? num(m.volume) ?? 0;
      const liq = num(m.liquidityClob) ?? num(m.liquidityNum) ?? num(m.liquidity);
      const bid = num(m.bestBid);
      const ask = num(m.bestAsk);
      const width = bid !== null && ask !== null && bid > 0 && ask >= bid ? round4(ask - bid) : null;
      const updatedAt = str(m.updatedAt) || e.startsAt;
      const url = `https://polymarket.com/event/${e.slug}`;
      const p0 = prices[0];
      const p1 = prices[1];
      if (p0 === null || p0 === undefined || p1 === null || p1 === undefined) continue;
      if (width !== null && width > 0.3) continue;

      if (kind === 'moneyline') {
        const yesNo = outs[0] === 'Yes' && outs[1] === 'No';
        if (yesNo) {
          // Soccer: one Yes/No market per outcome (home win / draw / away win).
          if (p0 <= 0.005 || p0 >= 0.995) continue;
          const gi = str(m.groupItemTitle);
          const slot = /^draw/i.test(gi) || /draw$/i.test(str(m.slug)) ? 'draw' : teamsMatch(gi, e.home) && !teamsMatch(gi, e.away) ? 'home' : teamsMatch(gi, e.away) ? 'away' : null;
          if (!slot) continue;
          e.soccer[slot] = p0;
          e.soccer.vol += vol;
          e.soccer.liq = Math.min(e.soccer.liq ?? Infinity, liq ?? Infinity);
          if (slot === 'home') e.soccer.width = width;
          e.soccer.updatedAt = updatedAt;
        } else {
          // Two-way (US sports, UFC): outcomes are the two team/fighter names, in title order.
          if (outs.length !== 2 || p0 <= 0.005 || p0 >= 0.995) continue;
          if (!e.trusted) {
            e.away = outs[0];
            e.home = outs[1];
          } else if (pl.spec.first === 'away') {
            e.away = outs[0];
            e.home = outs[1];
          } else {
            e.home = outs[0];
            e.away = outs[1];
          }
          const homeIdx = outs[0] === e.home ? 0 : 1;
          const ph = homeIdx === 0 ? p0 : p1;
          const pa = homeIdx === 0 ? p1 : p0;
          e.markets.push({
            source: 'polymarket',
            type: 'moneyline',
            line: null,
            outcomes: [outcome('home', e.home, ph), outcome('away', e.away, pa)],
            updatedAt,
            volume: vol,
            url,
            width,
            liquidity: liq,
          });
        }
      } else if (kind === 'spreads') {
        const line = num(m.line);
        if (line === null || outs.length !== 2 || !e.home || !e.away) continue;
        if (p0 < 0.08 || p0 > 0.92) continue;
        const firstIsHome = teamsMatch(outs[0], e.home) && !teamsMatch(outs[0], e.away);
        const firstIsAway = teamsMatch(outs[0], e.away) && !teamsMatch(outs[0], e.home);
        if (!firstIsHome && !firstIsAway) continue;
        // outcomes[0] is the team that covers `line` (e.g. "Spread: Rangers (-1.5)").
        const homeLine = firstIsHome ? line : -line;
        const ph = firstIsHome ? p0 : p1;
        e.markets.push({
          source: 'polymarket',
          type: 'spread',
          line: homeLine,
          outcomes: [outcome('home', e.home, ph), outcome('away', e.away, 1 - ph)],
          updatedAt,
          volume: vol,
          url,
          width,
          liquidity: liq,
        });
      } else if (kind === 'totals') {
        const line = num(m.line);
        if (line === null || !/^over$/i.test(outs[0] ?? '')) continue;
        if (p0 < 0.08 || p0 > 0.92) continue;
        e.markets.push({
          source: 'polymarket',
          type: 'total',
          line,
          outcomes: [outcome('over', `Over ${fmtLine(line)}`, p0), outcome('under', `Under ${fmtLine(line)}`, 1 - p0)],
          updatedAt,
          volume: vol,
          url,
          width,
          liquidity: liq,
        });
      }
    }

    for (const e of events.values()) {
      const s = e.soccer;
      if (s.home !== undefined && s.away !== undefined && s.draw !== undefined) {
        e.markets.push({
          source: 'polymarket',
          type: 'moneyline',
          line: null,
          outcomes: [outcome('home', e.home, s.home), outcome('away', e.away, s.away)],
          draw: { implied: round4(s.draw), american: impliedToAmerican(s.draw) },
          updatedAt: s.updatedAt || e.startsAt,
          volume: s.vol,
          url: `https://polymarket.com/event/${e.slug}`,
          width: s.width,
          liquidity: Number.isFinite(s.liq ?? NaN) ? s.liq : null,
        });
      }
      if (!e.markets.length || !e.home || !e.away) continue;
      // Cap alternate lines per type, keeping those nearest a coin-flip.
      const keep: OddsMarket[] = [];
      for (const t of ['moneyline', 'spread', 'total'] as MarketType[]) {
        const l = e.markets.filter((x) => x.type === t);
        keep.push(...(t === 'moneyline' ? l : l.sort((a, b) => Math.abs(a.outcomes[0].implied - 0.5) - Math.abs(b.outcomes[0].implied - 0.5)).slice(0, MAX_ALT_LINES)));
      }
      out.push({ source: 'polymarket', sport: pl.spec.sport, league: pl.spec.league, home: e.home, away: e.away, startsAt: e.startsAt, startQuality: 'exact', status: null, orientationTrusted: e.trusted, markets: keep });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* ESPN scoreboard → DraftKings lines                                  */
/* ------------------------------------------------------------------ */

/** "-108" | "+120" | "EVEN" | 120 → American number, or null. */
export function parseAmerican(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) && x !== 0 ? x : null;
  if (typeof x !== 'string') return null;
  const s = x.trim().toUpperCase();
  if (s === 'EVEN' || s === 'EV' || s === 'PK') return 100;
  const n = Number(s.replace('+', ''));
  return Number.isFinite(n) && n !== 0 ? n : null;
}
const lineNum = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const n = Number(x.replace(/^[ou]/i, '').replace('+', ''));
  return Number.isFinite(n) ? n : null;
};
const side = (o: unknown): { odds: number | null; line: number | null; href: string } => {
  const r = rec(o);
  const c = rec(r.close);
  const cur = Object.keys(c).length ? c : rec(r.open);
  return { odds: parseAmerican(cur.odds), line: lineNum(cur.line), href: str(rec(cur.link).href) };
};

/** DraftKings deep link via ESPN is a tracking gateway; pull the clean event URL out of its `preurl` param. */
export function cleanDkUrl(href: string): string | null {
  try {
    const pre = new URL(href).searchParams.get('preurl');
    if (!pre) return null;
    const u = new URL(pre);
    return u.hostname.endsWith('draftkings.com') ? `${u.origin}${u.pathname}` : null;
  } catch {
    return null;
  }
}

function bookOutcomes(a: number, b: number): [number, number] | null {
  const pa = americanToImplied(a);
  const pb = americanToImplied(b);
  return Number.isFinite(pa) && Number.isFinite(pb) ? [pa, pb] : null;
}

/** One ESPN competition's `odds[]` → OddsMarket[] (DraftKings preferred; any provider if DK is absent). */
export function espnOddsToMarkets(odds: unknown, home: string, away: string, nowIso: string): OddsMarket[] {
  const list = arr(odds).map(rec).filter((o) => Object.keys(o).length);
  if (!list.length) return [];
  const o = list.find((x) => /draftkings/i.test(str(rec(x.provider).name))) ?? list[0];
  const book: OddsSource = 'espn-dk';
  const mks: OddsMarket[] = [];
  const url = cleanDkUrl(str(rec(o.link).href)) ?? cleanDkUrl(side(rec(o.moneyline).home).href);

  // Moneyline (+ draw for soccer).
  const ml = rec(o.moneyline);
  const mh = side(ml.home);
  const ma = side(ml.away);
  const hOdds = mh.odds ?? parseAmerican(rec(o.homeTeamOdds).moneyLine);
  const aOdds = ma.odds ?? parseAmerican(rec(o.awayTeamOdds).moneyLine);
  if (hOdds !== null && aOdds !== null) {
    const dOdds = side(ml.draw).odds ?? parseAmerican(rec(o.drawOdds).moneyLine);
    const pr = bookOutcomes(hOdds, aOdds);
    if (pr) {
      const m: OddsMarket = { source: book, type: 'moneyline', line: null, outcomes: [outcome('home', home, pr[0], hOdds), outcome('away', away, pr[1], aOdds)], updatedAt: nowIso, volume: null, url };
      if (dOdds !== null) m.draw = { implied: round4(americanToImplied(dOdds)), american: dOdds };
      mks.push(m);
    }
  }
  // Spread (home line).
  const ps = rec(o.pointSpread);
  const sh = side(ps.home);
  const sa = side(ps.away);
  if (sh.odds !== null && sa.odds !== null && sh.line !== null) {
    const pr = bookOutcomes(sh.odds, sa.odds);
    if (pr) mks.push({ source: book, type: 'spread', line: sh.line, outcomes: [outcome('home', home, pr[0], sh.odds), outcome('away', away, pr[1], sa.odds)], updatedAt: nowIso, volume: null, url });
  }
  // Total.
  const tt = rec(o.total);
  const to = side(tt.over);
  const tu = side(tt.under);
  const tl = to.line ?? tu.line ?? num(o.overUnder);
  if (to.odds !== null && tu.odds !== null && tl !== null) {
    const pr = bookOutcomes(to.odds, tu.odds);
    if (pr) mks.push({ source: book, type: 'total', line: tl, outcomes: [outcome('over', `Over ${fmtLine(tl)}`, pr[0], to.odds), outcome('under', `Under ${fmtLine(tl)}`, pr[1], tu.odds)], updatedAt: nowIso, volume: null, url });
  }
  return mks;
}

/**
 * ESPN scoreboard JSON → RawEvent[] (one per game, with DraftKings markets when ESPN has posted lines — typically from
 * about a day before kick-off; finished games carry none). UFC: one record per bout (competition).
 */
export function parseEspnOdds(spec: EspnLeagueSpec, json: unknown, nowIso: string): RawEvent[] {
  const out: RawEvent[] = [];
  // Two shapes: the scoreboard (`events[]`, odds under competitions[0].odds[]) and the compact header feed
  // (`sports[].leagues[].events[]`, one `odds` object per event; UFC bouts are separate events there).
  const root = rec(json);
  const header = arr(root.sports).flatMap((s) => arr(rec(s).leagues)).flatMap((l) => arr(rec(l).events));
  const events = header.length ? header : arr(root.events);
  for (const e of events.map(rec)) {
    const rawState = e.status;
    const state = typeof rawState === 'string' ? rawState : str(rec(rec(e.status).type).state) || str(rec(rec(rec(e.fullStatus).type)).state);
    const status: RawEvent['status'] = state === 'in' ? 'live' : state === 'post' ? 'final' : 'scheduled';
    const isHeader = header.length > 0;
    const comps: Array<Record<string, unknown>> = isHeader ? [{ ...e, odds: e.odds ? [e.odds] : [] }] : arr(e.competitions).map(rec);
    for (const c of spec.sport === 'UFC' && !isHeader ? comps : comps.slice(0, 1)) {
      const cs = arr(c.competitors).map(rec);
      let hc = cs.find((x) => x.homeAway === 'home');
      let ac = cs.find((x) => x.homeAway === 'away');
      const nameOf = (x: Record<string, unknown> | undefined) => str(rec(x?.team).displayName) || str(x?.displayName) || str(rec(x?.athlete).displayName);
      if ((!hc || !ac) && spec.sport === 'UFC' && cs.length === 2) {
        const sorted = [...cs].sort((a, b) => (num(a.order) ?? 0) - (num(b.order) ?? 0));
        ac = sorted[0];
        hc = sorted[1];
      }
      const home = nameOf(hc);
      const away = nameOf(ac);
      const date = str(c.date) || str(e.date);
      if (!home || !away || !date || !Number.isFinite(Date.parse(date))) continue;
      out.push({
        source: 'espn-dk',
        sport: spec.sport,
        league: spec.league,
        home,
        away,
        startsAt: new Date(date).toISOString(),
        startQuality: 'exact',
        status,
        orientationTrusted: spec.sport !== 'UFC',
        markets: status === 'final' ? [] : espnOddsToMarkets(c.odds, home, away, nowIso),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Cross-source matching                                               */
/* ------------------------------------------------------------------ */

export const MATCH_TOL_EXACT_MS = 3 * 3600_000;
/** Kalshi starts for pro leagues are derived (occurrence − typical duration), so they get a wider window. */
export const MATCH_TOL_APPROX_MS = 5 * 3600_000;

const SOURCE_RANK: Record<OddsSource, number> = { 'espn-dk': 0, polymarket: 1, kalshi: 2, draftkings: 3, fanduel: 4 }; // the last two never reach matchEvents (client-side merge only)

interface Cluster {
  sport: OddsSport;
  league: string;
  home: string;
  away: string;
  startMs: number;
  startExact: boolean;
  dateOnly?: string;
  status: RawEvent['status'];
  members: Array<{ raw: RawEvent; flipped: boolean }>;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const etDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** Distance in ms between a cluster and a record if they could be the same game, else null. */
function timeDistance(c: Cluster, r: RawEvent, t: number): number | null {
  const d = Math.abs(c.startMs - t);
  const cDate = c.startExact ? undefined : c.dateOnly;
  if (cDate && r.dateOnly) return cDate === r.dateOnly ? d : null;
  if (r.dateOnly) return etDay(c.startMs) === r.dateOnly || utcDay(c.startMs) === r.dateOnly ? d : null;
  if (cDate) return etDay(t) === cDate || utcDay(t) === cDate ? d : null;
  return d <= (r.startQuality === 'approx' || !c.startExact ? MATCH_TOL_APPROX_MS : MATCH_TOL_EXACT_MS) ? d : null;
}

/**
 * Group the per-source records for the SAME game: same league, both teams match (either orientation), start times within
 * tolerance (nearest wins). ESPN → Polymarket → Kalshi order, so the first member sets the home/away orientation and exact
 * start. Markets of members listed the other way round are mirrored. Finished games are dropped; games with no market in any
 * source are dropped.
 */
export function matchEvents(lists: RawEvent[][], nowMs: number = Date.now()): OddsEvent[] {
  const all = lists
    .flat()
    .map((r) => ({ ...r, home: resolveTeam(r.sport, r.home), away: resolveTeam(r.sport, r.away) }))
    .sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const clusters: Cluster[] = [];
  for (const r of all) {
    const t = Date.parse(r.startsAt);
    if (!Number.isFinite(t)) continue;
    let best: { c: Cluster; flipped: boolean; d: number } | null = null;
    for (const c of clusters) {
      if (c.sport !== r.sport || c.league !== r.league) continue;
      const straight = teamsMatch(c.home, r.home) && teamsMatch(c.away, r.away);
      const swapped = teamsMatch(c.home, r.away) && teamsMatch(c.away, r.home);
      if (!straight && !swapped) continue;
      const d = timeDistance(c, r, t);
      if (d === null) continue;
      if (!best || d < best.d) best = { c, flipped: !straight, d };
    }
    if (best) {
      best.c.members.push({ raw: r, flipped: best.flipped });
      if (!best.c.status && r.status) best.c.status = r.status;
      if (r.status === 'final') best.c.status = 'final';
      if (r.startQuality === 'exact' && !best.c.startExact) {
        best.c.startMs = t;
        best.c.startExact = true;
        best.c.dateOnly = undefined;
      }
      // Longer display names win (ESPN "Los Angeles Kings" over Kalshi "Los Angeles").
      const h = best.flipped ? r.away : r.home;
      const a = best.flipped ? r.home : r.away;
      if (h.length > best.c.home.length) best.c.home = h;
      if (a.length > best.c.away.length) best.c.away = a;
    } else {
      clusters.push({ sport: r.sport, league: r.league, home: r.home, away: r.away, startMs: t, startExact: r.startQuality === 'exact', dateOnly: r.dateOnly, status: r.status, members: [{ raw: r, flipped: false }] });
    }
  }

  const events: OddsEvent[] = [];
  for (const c of clusters) {
    if (c.status === 'final') continue;
    // No explicit status (Kalshi/Polymarket only): before start = scheduled; up to 5 h after = live; later = presumed over.
    const status = c.status ?? (c.startMs > nowMs ? 'scheduled' : c.startMs >= nowMs - (c.startExact ? 5 : 12) * 3600_000 ? 'live' : 'final');
    if (status === 'final') continue;
    const markets = c.members.flatMap((m) => (m.flipped ? m.raw.markets.map(flipMarket) : m.raw.markets));
    if (!markets.length) continue;
    // Rename outcomes to the canonical team names.
    const named = markets.map((m) => (m.type === 'total' ? m : { ...m, outcomes: [{ ...m.outcomes[0], name: c.home }, { ...m.outcomes[1], name: c.away }] as [OddsOutcome, OddsOutcome] }));
    const startsAt = new Date(c.startMs).toISOString();
    events.push({
      id: eventId(c.sport, startsAt, c.home, c.away),
      sport: c.sport,
      league: c.league,
      home: c.home,
      away: c.away,
      startsAt,
      status,
      ...(c.startExact ? {} : { startApprox: true }),
      markets: named.sort((x, y) => typeRank(x.type) - typeRank(y.type) || (x.line ?? 0) - (y.line ?? 0) || x.source.localeCompare(y.source)),
    });
  }
  return events.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));
}

const typeRank = (t: MarketType) => (t === 'moneyline' ? 0 : t === 'spread' ? 1 : 2);

/** Stable id: `${sport}|${YYYY-MM-DD (UTC)}|${normHome}|${normAway}`. */
export function eventId(sport: OddsSport, startsAtIso: string, home: string, away: string): string {
  return `${sport}|${startsAtIso.slice(0, 10)}|${normTeam(home).replace(/ /g, '-')}|${normTeam(away).replace(/ /g, '-')}`;
}
