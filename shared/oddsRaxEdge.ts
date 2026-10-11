/**
 * Tab 9 — optional FanDuel / DraftKings lines and Real's own market % from the user's OWN RaxEdge export. Pure: no fetch, no storage.
 *
 * Where the data comes from: the user runs shared/raxedgeBridge.ts's snippet on raxedge.com (their login, their browser) and pastes the
 * result into RAX; src/lib/raxedgeStore.ts keeps it in localStorage as a `RaxEdgeOddsExport` (raw route responses). This file turns those
 * raw responses into the project's own structures:
 *   - `parseFanDuel` / `parseDraftKings`   one feed → OddsEvent[] with markets of source 'fanduel' / 'draftkings'
 *   - `mergeRaxEdgeOdds`                   attaches them to an `/api/odds/events` response (matching games the way matchEvents does)
 *   - `parseRealProbs`                     Real's own market probabilities → `RealPctSuggestion[]` (auto-fill of the typed Real %)
 * Everything is defensive: a missing/changed/Pro-gated feed becomes a note, never an exception, and nothing here changes anything
 * unless the caller opts in (the UI switches are OFF by default).
 *
 * Shapes (verified live on a free RaxEdge plan, fixtures in tests/fixtures/raxedge/):
 *   FanDuel `/api/fd/<key>`   `{ ok, games: { "Away @ Home": { id, away, home, cm, ml:{team:american}, spreads:{team:{line:american}},
 *                              totals:{Over:{line:american},Under:{…}} } } }`; UFC uses `fights` instead of `games`; Pro-gated → `{error}`.
 *   DraftKings `/api/dk/<key>` `{ ok, games:[{ eventId, homeTeam, awayTeam, homeShort, awayShort, startMs, markets:[{ market:
 *                              'team_ml'|'team_runline'|'team_total', homeOdds, awayOdds, homeLine, awayLine, line, overOdds, underOdds }] }] }`
 *   Real `/api/real/live-probs` `{ markets: { "<id>": { outcomes:[{ id, key:'ANA', label, probability }], isLocked, isSettled, ts }, __alive } }`
 *   Real `/api/real/sync?sport=` `{ markets: { "Eagles @ Jaguars": {} (EMPTY until the pool opens), "…__gid", "…__sport", "…__startMs" } }`
 *     The SHAPE of a filled sync entry has not been seen yet, so that parser is written to look for what it needs and say what it could not read.
 */
import type { MarketType, OddsEvent, OddsMarket, OddsOutcome, OddsResponse, OddsSourceStatus, OddsSport } from './odds';
import { americanToImplied, devig2 } from './odds';
import type { RaxEdgeOddsExport } from './raxedgeBridge';
import { TEAM_NAMES, eventId, flipMarket, parseAmerican, resolveTeam, teamsMatch } from './oddsSources';

/* ------------------------------------------------------------------ */
/* Route → sport tables                                                */
/* ------------------------------------------------------------------ */

export const FD_SPORT: Record<string, OddsSport> = { nhl: 'NHL', mlb: 'MLB', nbaalts: 'NBA', nba: 'NBA', wnbaalts: 'WNBA', wnba: 'WNBA', nfl: 'NFL', cfb: 'CFB', ufc: 'UFC', fc: 'FC', wc: 'FC' };
export const DK_SPORT: Record<string, OddsSport> = { 'nfl-lines': 'NFL', 'nhl-lines': 'NHL', 'mlb-lines': 'MLB', 'cfb-lines': 'CFB', 'wnba-lines': 'WNBA', nbaalts: 'NBA', 'nba-lines': 'NBA' };
const LEAGUE: Record<OddsSport, string> = { NBA: 'NBA', NHL: 'NHL', MLB: 'MLB', WNBA: 'WNBA', NFL: 'NFL', CFB: 'NCAAF', CBB: 'NCAAB', FC: 'FC', UFC: 'UFC' };
/** Real's sport slugs (and RaxEdge's short `__sport` values) → our sport. */
const REAL_SPORT: Record<string, OddsSport> = {
  basketball_nba: 'NBA', football_nfl: 'NFL', baseball_mlb: 'MLB', basketball_wnba: 'WNBA', hockey_nhl: 'NHL', football_ncaaf: 'CFB', soccer_fc: 'FC', mma_ufc: 'UFC',
  nba: 'NBA', nfl: 'NFL', mlb: 'MLB', wnba: 'WNBA', nhl: 'NHL', ncaaf: 'CFB', cfb: 'CFB', ufc: 'UFC', fc: 'FC', soccer: 'FC', mma: 'UFC',
};

/** A game that started more than this long ago is treated as over (Kalshi/Polymarket use the same 5 h rule for "live"). */
const LIVE_WINDOW_MS = 5 * 3600_000;
/** Same tolerance as the API's matcher for exact start times. */
const MATCH_TOL_MS = 3 * 3600_000;
const MAX_ALT_LINES = 6;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const rec = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : typeof x === 'number' ? String(x) : '');
const num = (x: unknown): number | null => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const round4 = (x: number) => Math.round(x * 10000) / 10000;
const isoOr = (...ms: Array<number | null | undefined>): string => new Date(ms.find((x): x is number => typeof x === 'number' && Number.isFinite(x)) ?? Date.now()).toISOString();
const fmtLine = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/** ISO-ish string ("2026-10-25T03:30:00.0000000Z" has 7 fractional digits) → ms, or null. */
export function parseWhen(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? (x < 1e11 ? x * 1000 : x) : null;
  const s = str(x).trim();
  if (!s) return null;
  let t = Date.parse(s);
  if (!Number.isFinite(t)) t = Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(t) ? t : null;
}

/** Unix seconds or ms → ms. */
const tsMs = (x: unknown): number | null => {
  const n = num(x);
  return n === null || n <= 0 ? null : n < 1e11 ? n * 1000 : n;
};

function outcome(side: OddsOutcome['side'], name: string, american: number): OddsOutcome {
  return { side, name, implied: round4(americanToImplied(american)), american };
}

type Book = 'fanduel' | 'draftkings';

interface MarketCtx {
  source: Book;
  updatedAt: string;
  url: string | null;
  home: string;
  away: string;
}

/** Two-way American-odds market, or null when a price is missing/zero. */
function bookMarket(c: MarketCtx, type: MarketType, line: number | null, a: unknown, b: unknown): OddsMarket | null {
  const oa = parseAmerican(a);
  const ob = parseAmerican(b);
  if (oa === null || ob === null) return null;
  if (!Number.isFinite(americanToImplied(oa)) || !Number.isFinite(americanToImplied(ob))) return null;
  const outcomes: [OddsOutcome, OddsOutcome] =
    type === 'total'
      ? [outcome('over', `Over ${fmtLine(line ?? 0)}`, oa), outcome('under', `Under ${fmtLine(line ?? 0)}`, ob)]
      : [outcome('home', c.home, oa), outcome('away', c.away, ob)];
  return { source: c.source, type, line, outcomes, updatedAt: c.updatedAt, volume: null, url: c.url };
}

/** Keep the MAX_ALT_LINES lines nearest a coin flip (alternate-line ladders can be long; the UI lists every line). */
function topLines(ms: OddsMarket[]): OddsMarket[] {
  if (ms.length <= MAX_ALT_LINES) return ms.sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
  const dist = (m: OddsMarket) => Math.abs(devig2(m.outcomes[0].implied, m.outcomes[1].implied)[0] - 0.5);
  return [...ms].sort((x, y) => dist(x) - dist(y)).slice(0, MAX_ALT_LINES).sort((x, y) => (x.line ?? 0) - (y.line ?? 0));
}

/** 'Away @ Home' → [away, home]. */
function splitMatchup(key: string): [string, string] | null {
  const m = key.split(/\s+@\s+|\s+vs\.?\s+/i);
  return m.length === 2 && m[0] && m[1] ? [m[0].trim(), m[1].trim()] : null;
}

/** Find a value in a name-keyed object by exact, then case-insensitive, then team-name match. */
function byTeam<T>(o: Record<string, T>, name: string): T | undefined {
  if (name in o) return o[name];
  const lower = name.toLowerCase();
  for (const k of Object.keys(o)) if (k.toLowerCase() === lower) return o[k];
  for (const k of Object.keys(o)) if (teamsMatch(k, name)) return o[k];
  return undefined;
}

const statusFor = (startMs: number, nowMs: number): OddsEvent['status'] | null => (startMs > nowMs ? 'scheduled' : startMs >= nowMs - LIVE_WINDOW_MS ? 'live' : null);

function makeEvent(sport: OddsSport, home: string, away: string, startMs: number, status: OddsEvent['status'], markets: OddsMarket[]): OddsEvent {
  const h = resolveTeam(sport, home);
  const a = resolveTeam(sport, away);
  const startsAt = new Date(startMs).toISOString();
  const named = markets.map((m) => (m.type === 'total' ? m : { ...m, outcomes: [{ ...m.outcomes[0], name: h }, { ...m.outcomes[1], name: a }] as [OddsOutcome, OddsOutcome] }));
  return { id: eventId(sport, startsAt, h, a), sport, league: LEAGUE[sport], home: h, away: a, startsAt, status, markets: named };
}

/* ------------------------------------------------------------------ */
/* FanDuel                                                             */
/* ------------------------------------------------------------------ */

export interface RaxEdgeParse {
  events: OddsEvent[];
  /** Why the feed gave nothing ("Pro plan required", unexpected shape …); null when it parsed. */
  error: string | null;
  /** Short-code ↔ full-name pairs the feed lists (DraftKings gives them for free) — used to read Real's abbreviations. */
  abbrevs: Array<{ sport: OddsSport; abbr: string; name: string }>;
}

const feedError = (r: Record<string, unknown>): string | null => {
  if (typeof r.error === 'string' && r.error) return r.error;
  if (r.error && typeof r.error === 'object') return str(rec(r.error).message) || 'error';
  if (r.ok === false) return str(r.message) || 'feed reported ok:false';
  return null;
};

/** One `/api/fd/<key>` response → OddsEvent[] (moneyline, spread and total with American odds → implied). */
export function parseFanDuel(key: string, json: unknown, nowMs: number = Date.now(), fallbackIso?: string): RaxEdgeParse {
  const sport = FD_SPORT[key];
  if (!sport) return { events: [], error: `FanDuel feed "${key}" is not used`, abbrevs: [] };
  const r = rec(json);
  const err = feedError(r);
  if (err) return { events: [], error: err, abbrevs: [] };
  const box = r.games ?? r.fights;
  if (box === undefined || box === null || typeof box !== 'object') return { events: [], error: 'unexpected response (no games)', abbrevs: [] };
  const entries: Array<[string, unknown]> = Array.isArray(box) ? box.map((g): [string, unknown] => ['', g]) : Object.entries(box);
  const updatedAt = isoOr(tsMs(r.ts), Date.parse(fallbackIso ?? ''), nowMs);
  const events: OddsEvent[] = [];
  for (const [k, raw] of entries) {
    const g = rec(raw);
    const pair = splitMatchup(k);
    const home = str(g.home) || pair?.[1] || '';
    const away = str(g.away) || pair?.[0] || '';
    const start = parseWhen(g.cm);
    if (!home || !away || start === null) continue;
    const status = statusFor(start, nowMs);
    if (!status) continue;
    const c: MarketCtx = { source: 'fanduel', updatedAt, url: null, home, away };
    const mks: OddsMarket[] = [];

    const ml = rec(g.ml);
    const mlm = bookMarket(c, 'moneyline', null, byTeam(ml, home), byTeam(ml, away));
    if (mlm) {
      // Soccer (fc/wc) lists a third price; keep it as the draw so the book is de-vigged three ways.
      const drawKey = Object.keys(ml).find((x) => /^(draw|tie)$/i.test(x.trim()));
      const d = drawKey ? parseAmerican(ml[drawKey]) : null;
      if (d !== null) mlm.draw = { implied: round4(americanToImplied(d)), american: d };
      mks.push(mlm);
    }

    // Spreads: {team: {line: american}}. Pair each home line L with the away price at −L.
    const sp = rec(g.spreads);
    const homeSp = rec(byTeam(sp, home));
    const awaySp = rec(byTeam(sp, away));
    const spreads: OddsMarket[] = [];
    for (const [ls, hOdds] of Object.entries(homeSp)) {
      const L = num(ls);
      if (L === null) continue;
      const ak = Object.keys(awaySp).find((x) => Math.abs((num(x) ?? NaN) + L) < 1e-9);
      const m = ak === undefined ? null : bookMarket(c, 'spread', L === 0 ? 0 : L, hOdds, awaySp[ak]);
      if (m) spreads.push(m);
    }
    mks.push(...topLines(spreads));

    // Totals: {Over: {line: american}, Under: {line: american}}.
    const tt = rec(g.totals);
    const over = rec(byTeam(tt, 'Over'));
    const under = rec(byTeam(tt, 'Under'));
    const totals: OddsMarket[] = [];
    for (const [ls, oOdds] of Object.entries(over)) {
      const L = num(ls);
      if (L === null) continue;
      const uk = Object.keys(under).find((x) => Math.abs((num(x) ?? NaN) - L) < 1e-9);
      const m = uk === undefined ? null : bookMarket(c, 'total', L, oOdds, under[uk]);
      if (m) totals.push(m);
    }
    mks.push(...topLines(totals));

    if (mks.length) events.push(makeEvent(sport, home, away, start, status, mks));
  }
  return { events, error: null, abbrevs: [] };
}

/* ------------------------------------------------------------------ */
/* DraftKings                                                          */
/* ------------------------------------------------------------------ */

/** One `/api/dk/<key>` response → OddsEvent[]. `team_ml` / `team_runline` / `team_total` only; props and other feeds are ignored. */
export function parseDraftKings(key: string, json: unknown, nowMs: number = Date.now(), fallbackIso?: string): RaxEdgeParse {
  const sport = DK_SPORT[key];
  if (!sport) return { events: [], error: `DraftKings feed "${key}" is not used`, abbrevs: [] };
  const r = rec(json);
  const err = feedError(r);
  if (err) return { events: [], error: err, abbrevs: [] };
  if (!Array.isArray(r.games)) return { events: [], error: 'unexpected response (no games list)', abbrevs: [] };
  const events: OddsEvent[] = [];
  const abbrevs: RaxEdgeParse['abbrevs'] = [];
  for (const raw of r.games) {
    const g = rec(raw);
    const home = str(g.homeTeam);
    const away = str(g.awayTeam);
    const start = parseWhen(g.startMs);
    if (!home || !away || start === null) continue;
    if (str(g.homeShort)) abbrevs.push({ sport, abbr: str(g.homeShort).toUpperCase(), name: resolveTeam(sport, home) });
    if (str(g.awayShort)) abbrevs.push({ sport, abbr: str(g.awayShort).toUpperCase(), name: resolveTeam(sport, away) });
    const live = g.dkLive === true;
    const status = live ? 'live' : statusFor(start, nowMs);
    if (!status) continue;
    const updatedAt = isoOr(tsMs(g.fetchedAt), tsMs(r.ts), Date.parse(fallbackIso ?? ''), nowMs);
    const id = str(g.eventId);
    const c: MarketCtx = { source: 'draftkings', updatedAt, url: id ? `https://sportsbook.draftkings.com/event/${id}` : null, home, away };
    const ml: OddsMarket[] = [];
    const spreads: OddsMarket[] = [];
    const totals: OddsMarket[] = [];
    for (const mr of arr(g.markets)) {
      const m = rec(mr);
      const kind = str(m.market);
      if (kind === 'team_ml') {
        const x = bookMarket(c, 'moneyline', null, m.homeOdds, m.awayOdds);
        if (x) ml.push(x);
      } else if (kind === 'team_runline') {
        const hl = num(m.homeLine);
        const al = num(m.awayLine);
        // Lines must be mirror images; the HOME line is the market's line (OddsMarket convention).
        if (hl === null || (al !== null && Math.abs(hl + al) > 1e-9)) continue;
        const x = bookMarket(c, 'spread', hl === 0 ? 0 : hl, m.homeOdds, m.awayOdds);
        if (x) spreads.push(x);
      } else if (kind === 'team_total') {
        const L = num(m.line);
        const x = L === null ? null : bookMarket(c, 'total', L, m.overOdds, m.underOdds);
        if (x) totals.push(x);
      }
    }
    const mks = [...ml.slice(0, 1), ...topLines(spreads), ...topLines(totals)];
    if (mks.length) events.push(makeEvent(sport, home, away, start, status, mks));
  }
  return { events, error: null, abbrevs };
}

/* ------------------------------------------------------------------ */
/* Whole export → events + feed status                                 */
/* ------------------------------------------------------------------ */

interface FeedStatus {
  /** Feeds in the export for this book. */
  feeds: Array<{ key: string; sport: OddsSport | null; error: string | null; games: number }>;
}
export interface RaxEdgePlan {
  events: OddsEvent[];
  fanduel: FeedStatus;
  draftkings: FeedStatus;
  abbrevs: RaxEdgeParse['abbrevs'];
}

/** Parse every feed of an export. Feeds listed in `errors` (e.g. 'fd/fc': 'Pro plan required') are reported as failed. */
export function planRaxEdge(bundle: RaxEdgeOddsExport, nowMs: number, at?: string): RaxEdgePlan {
  const events: OddsEvent[] = [];
  const abbrevs: RaxEdgeParse['abbrevs'] = [];
  const mk = (): FeedStatus => ({ feeds: [] });
  const out: RaxEdgePlan = { events, fanduel: mk(), draftkings: mk(), abbrevs };
  const errors = rec(bundle?.errors);
  const run = (book: Book, prefix: 'fd' | 'dk', map: Record<string, OddsSport>, data: Record<string, unknown>, parse: typeof parseFanDuel) => {
    const keys = new Set<string>([...Object.keys(rec(data)), ...Object.keys(errors).filter((k) => k.startsWith(`${prefix}/`)).map((k) => k.slice(3))]);
    for (const key of keys) {
      const sport = map[key] ?? null;
      const routeErr = str(errors[`${prefix}/${key}`]) || null;
      if (!(key in rec(data))) {
        out[book].feeds.push({ key, sport, error: routeErr ?? 'missing', games: 0 });
        continue;
      }
      const p = parse(key, rec(data)[key], nowMs, at);
      events.push(...p.events);
      abbrevs.push(...p.abbrevs);
      out[book].feeds.push({ key, sport, error: p.error, games: p.events.length });
    }
  };
  run('fanduel', 'fd', FD_SPORT, rec(bundle?.fd), parseFanDuel);
  run('draftkings', 'dk', DK_SPORT, rec(bundle?.dk), parseDraftKings);
  return out;
}

/* ------------------------------------------------------------------ */
/* Merge into an /api/odds/events response                             */
/* ------------------------------------------------------------------ */

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const etDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

/** Distance in ms if `r` could be the same game as `t` (an existing event); null otherwise. Date-only (startApprox) events match on the calendar day. */
function sameGameDistance(t: OddsEvent, rStart: number): number | null {
  const tStart = Date.parse(t.startsAt);
  const d = Math.abs(tStart - rStart);
  if (t.startApprox) {
    const day = t.startsAt.slice(0, 10);
    return day === utcDay(rStart) || day === etDay(rStart) ? d : null;
  }
  return d <= MATCH_TOL_MS ? d : null;
}

const typeRank = (t: MarketType) => (t === 'moneyline' ? 0 : t === 'spread' ? 1 : 2);

function planAge(at: string | undefined, nowMs: number): number | null {
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : null;
}

const ageWords = (ms: number) => (ms < 90 * 60_000 ? `${Math.round(ms / 60_000)} min` : ms < 48 * 3600_000 ? `${Math.round(ms / 3600_000)} h` : `${Math.round(ms / 86400_000)} d`);
/** An export older than this gets a note on its source chip (the UI also colours the age amber/red). */
export const STALE_NOTE_MS = 15 * 60_000;

/**
 * Add the user's FanDuel/DraftKings lines to an odds response. Existing events get the RaxEdge markets attached (teams matched like
 * `matchEvents`: either orientation, mirrored if needed; same sport; start within 3 h, or the same day for date-only events); RaxEdge
 * games nobody else lists become their own events. Adds 'fanduel' and 'draftkings' entries to `sources[]` (ok/count + plan-limit and
 * staleness notes). The input is never mutated. Does nothing to consensus by itself — see `include` in oddsConsensus.
 */
export function mergeRaxEdgeOdds(response: OddsResponse, bundle: RaxEdgeOddsExport, now: number | Date = Date.now(), opts: { at?: string } = {}): OddsResponse {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const plan = planRaxEdge(bundle, nowMs, opts.at);
  const sportOk = (s: OddsSport | null) => response.sport === 'ALL' || s === response.sport;
  const incoming = plan.events.filter((e) => sportOk(e.sport));

  const targets: OddsEvent[] = response.events.map((e) => ({ ...e }));
  const touched = new Set<OddsEvent>();
  const counts: Record<Book, number> = { fanduel: 0, draftkings: 0 };
  const DK_FIRST = (a: OddsEvent, b: OddsEvent) => (a.markets[0]?.source === 'draftkings' ? 0 : 1) - (b.markets[0]?.source === 'draftkings' ? 0 : 1);

  for (const r of [...incoming].sort(DK_FIRST)) {
    const rStart = Date.parse(r.startsAt);
    let best: { t: OddsEvent; flipped: boolean; d: number } | null = null;
    for (const t of targets) {
      if (t.sport !== r.sport) continue;
      const th = resolveTeam(t.sport, t.home);
      const ta = resolveTeam(t.sport, t.away);
      const straight = teamsMatch(th, r.home) && teamsMatch(ta, r.away);
      const swapped = !straight && teamsMatch(th, r.away) && teamsMatch(ta, r.home);
      if (!straight && !swapped) continue;
      const d = sameGameDistance(t, rStart);
      if (d !== null && (!best || d < best.d)) best = { t, flipped: swapped, d };
    }
    for (const m of r.markets) counts[m.source as Book]++;
    if (best) {
      const t = best.t;
      const add = r.markets.map((m) => {
        const x = best!.flipped ? flipMarket(m) : m;
        return x.type === 'total' ? x : { ...x, outcomes: [{ ...x.outcomes[0], name: t.home }, { ...x.outcomes[1], name: t.away }] as [OddsOutcome, OddsOutcome] };
      });
      t.markets = [...t.markets, ...add];
      touched.add(t);
    } else {
      const fresh = { ...r, markets: [...r.markets] };
      targets.push(fresh);
      touched.add(fresh);
    }
  }
  for (const t of touched) t.markets.sort((x, y) => typeRank(x.type) - typeRank(y.type) || (x.line ?? 0) - (y.line ?? 0) || x.source.localeCompare(y.source));
  const events = targets.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || a.id.localeCompare(b.id));

  const age = planAge(opts.at, nowMs);
  const sources: OddsSourceStatus[] = (['fanduel', 'draftkings'] as Book[]).map((source) => {
    const label = source === 'fanduel' ? 'FanDuel' : 'DraftKings';
    const feeds = plan[source].feeds.filter((f) => response.sport === 'ALL' || f.sport === response.sport);
    if (!feeds.length) return { source, ok: true, count: 0, error: `no requests planned — your RaxEdge export has no ${label} feed for ${response.sport}` };
    const bad = feeds.filter((f) => f.error);
    const notes = bad.map((f) => `${f.key}: ${f.error}`);
    if (age !== null && age > STALE_NOTE_MS) notes.push(`export is ${ageWords(age)} old — re-run it to refresh`);
    const allBad = bad.length === feeds.length;
    const planLimit = allBad && bad.every((f) => /pro plan|upgrade|subscription|forbidden|402|403/i.test(f.error ?? ''));
    return { source, ok: !allBad || planLimit, count: counts[source], ...(notes.length ? { error: notes.join(' · ') } : {}) };
  });
  return { ...response, events, sources: [...response.sources.filter((s) => s.source !== 'fanduel' && s.source !== 'draftkings'), ...sources] };
}

/* ------------------------------------------------------------------ */
/* Team abbreviations (Real's live-probs use them)                     */
/* ------------------------------------------------------------------ */

/** abbr(s)=nickname; the nickname is resolved to the full name through TEAM_NAMES. Several codes per team cover ESPN/NHL/DK/Real variants. */
const ABBR_SRC: Partial<Record<OddsSport, string>> = {
  NHL: 'ANA=Ducks;BOS=Bruins;BUF=Sabres;CGY=Flames;CAR=Hurricanes;CHI=Blackhawks;COL=Avalanche;CBJ=Blue Jackets;DAL=Stars;DET=Red Wings;EDM=Oilers;FLA=Panthers;LAK|LA=Kings;MIN=Wild;MTL|MON=Canadiens;NSH|NAS=Predators;NJD|NJ=Devils;NYI=Islanders;NYR=Rangers;OTT=Senators;PHI=Flyers;PIT=Penguins;SJS|SJ=Sharks;SEA=Kraken;STL=Blues;TBL|TB=Lightning;TOR=Maple Leafs;UTA|UTAH=Mammoth;VAN=Canucks;VGK|VEG=Golden Knights;WSH|WAS=Capitals;WPG=Jets',
  NFL: 'ARI=Cardinals;ATL=Falcons;BAL=Ravens;BUF=Bills;CAR=Panthers;CHI=Bears;CIN=Bengals;CLE=Browns;DAL=Cowboys;DEN=Broncos;DET=Lions;GB|GNB=Packers;HOU=Texans;IND=Colts;JAX|JAC=Jaguars;KC|KAN=Chiefs;LV|LVR|OAK=Raiders;LAC=Chargers;LAR|LA=Rams;MIA=Dolphins;MIN=Vikings;NE|NWE=Patriots;NO|NOR=Saints;NYG=Giants;NYJ=Jets;PHI=Eagles;PIT=Steelers;SF|SFO=49ers;SEA=Seahawks;TB|TAM=Buccaneers;TEN=Titans;WAS|WSH=Commanders',
  NBA: 'ATL=Hawks;BOS=Celtics;BKN|BRK=Nets;CHA|CHO=Hornets;CHI=Bulls;CLE=Cavaliers;DAL=Mavericks;DEN=Nuggets;DET=Pistons;GS|GSW=Warriors;HOU=Rockets;IND=Pacers;LAC=Clippers;LAL=Lakers;MEM=Grizzlies;MIA=Heat;MIL=Bucks;MIN=Timberwolves;NO|NOP=Pelicans;NY|NYK=Knicks;OKC=Thunder;ORL=Magic;PHI|PHL=76ers;PHX|PHO=Suns;POR=Trail Blazers;SAC=Kings;SA|SAS=Spurs;TOR=Raptors;UTA|UTAH=Jazz;WAS|WSH=Wizards',
  MLB: 'ARI|AZ=Diamondbacks;ATL=Braves;BAL=Orioles;BOS=Red Sox;CHC=Cubs;CWS|CHW=White Sox;CIN=Reds;CLE=Guardians;COL=Rockies;DET=Tigers;HOU=Astros;KC|KCR=Royals;LAA=Angels;LAD=Dodgers;MIA=Marlins;MIL=Brewers;MIN=Twins;NYM=Mets;NYY=Yankees;ATH|OAK=Athletics;PHI=Phillies;PIT=Pirates;SD|SDP=Padres;SF|SFG=Giants;SEA=Mariners;STL=Cardinals;TB|TBR=Rays;TEX=Rangers;TOR=Blue Jays;WSH|WAS=Nationals',
  WNBA: 'ATL=Dream;CHI=Sky;CON|CONN=Sun;DAL=Wings;GS|GSV=Valkyries;IND=Fever;LV|LVA=Aces;LA|LAS=Sparks;MIN=Lynx;NY|NYL=Liberty;PHX|PHO=Mercury;SEA=Storm;WAS|WSH=Mystics;TOR=Tempo;POR=Fire',
};

let staticAbbr: Map<string, string> | null = null;
function staticAbbrTable(): Map<string, string> {
  if (staticAbbr) return staticAbbr;
  const m = new Map<string, string>();
  for (const [sport, src] of Object.entries(ABBR_SRC) as Array<[OddsSport, string]>) {
    const names = TEAM_NAMES[sport] ?? [];
    for (const item of src.split(';')) {
      const [codes, nick] = item.split('=');
      const full = names.find((n) => n === nick || n.endsWith(` ${nick}`));
      if (!full) continue;
      for (const c of codes.split('|')) m.set(`${sport}|${c}`, full);
    }
  }
  return (staticAbbr = m);
}

/** Resolves short codes ("ANA") to full team names for a sport: DraftKings' own short↔full pairs from the same export first, then the built-in table. */
export class AbbrTable {
  private dyn = new Map<string, string>();
  constructor(pairs: RaxEdgeParse['abbrevs'] = []) {
    for (const p of pairs) this.dyn.set(`${p.sport}|${p.abbr.toUpperCase()}`, p.name);
  }
  resolve(sport: OddsSport, abbr: string): string | null {
    const k = `${sport}|${abbr.trim().toUpperCase()}`;
    return this.dyn.get(k) ?? staticAbbrTable().get(k) ?? null;
  }
  /** Sports in which BOTH codes are known teams. */
  sportsFor(a: string, b: string): OddsSport[] {
    const all: OddsSport[] = ['NHL', 'NFL', 'NBA', 'MLB', 'WNBA', 'CFB', 'CBB', 'FC', 'UFC'];
    return all.filter((s) => this.resolve(s, a) && this.resolve(s, b));
  }
}

/* ------------------------------------------------------------------ */
/* Real's own market % → suggestions                                   */
/* ------------------------------------------------------------------ */

export interface RealPctSuggestion {
  sport: OddsSport;
  /** Full team names as in the matched game. */
  home: string;
  away: string;
  startsAt: string;
  type: 'moneyline';
  /** Real's probability for each side, 0–1 (0.81 = Real shows 81%). */
  sideProbs: { home: number; away: number };
  /** 3-way (soccer) only. */
  draw?: number | null;
  /** Real's market id (live-probs key) or a `sync:<gid>` placeholder. */
  marketId: string;
  /** True when it came from live-probs (a game in play); false for a pre-game entry from /sync. */
  live: boolean;
  /** When Real's number was current, ms since epoch. */
  ts: number;
  source: 'raxedge';
}
export interface RealParse {
  suggestions: RealPctSuggestion[];
  /** Things in the export that could not be read or placed. Shown in the UI; never fatal. */
  warnings: string[];
  /** Pre-game Real markets that are still empty (Real's pool has not opened). */
  pending: number;
  /** Markets skipped because Real had locked or settled them. */
  closed: number;
}

/** A quote older than this is not used (live odds move in minutes; this is only the hard floor, the UI colours the age). */
export const MAX_REAL_AGE_MS = 3 * 3600_000;
const PCT_MIN = 0.5;
const PCT_MAX = 99.5;
const MAX_WARNINGS = 25;

interface Outcome {
  label: string;
  p: number;
}
const PROB_KEYS = ['probability', 'prob', 'pct', 'percent', 'percentage', 'impliedProbability', 'implied', 'chance', 'price', 'p'];
const LABEL_KEYS = ['key', 'label', 'abbr', 'abbreviation', 'teamAbbr', 'shortName', 'name', 'team', 'side', 'outcome', 'title'];

/** Read `{label, probability}` pairs from an array of outcome-like objects; null if it is not one. Fractions or percents are told apart by their sum. */
function readOutcomes(list: unknown[]): Outcome[] | null {
  if (list.length < 2 || list.length > 3) return null;
  const raw: Outcome[] = [];
  for (const o of list) {
    const r = rec(o);
    const pk = PROB_KEYS.find((k) => num(r[k]) !== null);
    const lk = LABEL_KEYS.find((k) => typeof r[k] === 'string' && (r[k] as string).trim() !== '');
    if (!pk || !lk) return null;
    raw.push({ label: (r[lk] as string).trim(), p: num(r[pk]) as number });
  }
  const sum = raw.reduce((s, o) => s + o.p, 0);
  if (Math.abs(sum - 1) <= 0.06) return raw;
  if (Math.abs(sum - 100) <= 6) return raw.map((o) => ({ ...o, p: o.p / 100 }));
  return null;
}

const isDraw = (label: string) => /^(draw|tie|x)$/i.test(label.trim());

interface GameRef {
  sport: OddsSport;
  home: string;
  away: string;
  startMs: number;
}

/**
 * Real's market probabilities from a RaxEdge export. Self-contained: games (names, sport, kick-off) come from the export's own
 * FanDuel/DraftKings feeds, plus `extraGames` (the loaded odds events) when given; codes like ANA/CGY are read through DraftKings'
 * short↔full pairs and a built-in table. Locked or settled markets are dropped. Anything it cannot read becomes a warning.
 *
 * live-probs is the reliable source (verified shape). `sync` entries are EMPTY until Real's pool opens, so a FILLED entry's shape is
 * unknown: for those we (1) look for a market id that appears in live-probs, (2) else look for an array of {label, probability}
 * outcomes that name the two teams, and (3) otherwise warn with the keys we saw instead of guessing.
 */
export function parseRealProbs(bundle: RaxEdgeOddsExport, now: number | Date = Date.now(), extraGames: Array<Pick<OddsEvent, 'sport' | 'home' | 'away' | 'startsAt'>> = [], opts: { at?: string } = {}): RealParse {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const out: RealParse = { suggestions: [], warnings: [], pending: 0, closed: 0 };
  const warn = (w: string) => {
    if (out.warnings.length < MAX_WARNINGS && !out.warnings.includes(w)) out.warnings.push(w);
  };
  const real = rec(bundle?.real);
  const liveMarkets = rec(rec(real.live).markets);
  const syncAll = rec(real.sync);
  if (!Object.keys(liveMarkets).length && !Object.keys(syncAll).length) return out;

  const plan = planRaxEdge(bundle, nowMs, opts.at);
  const abbr = new AbbrTable(plan.abbrevs);
  const games: GameRef[] = [
    ...plan.events.map((e) => ({ sport: e.sport, home: e.home, away: e.away, startMs: Date.parse(e.startsAt) })),
    ...extraGames.map((e) => ({ sport: e.sport, home: e.home, away: e.away, startMs: Date.parse(e.startsAt) })),
  ].filter((g) => Number.isFinite(g.startMs));
  const fallbackTs = Date.parse(opts.at ?? '') || nowMs;

  /** Which of this sport's two teams does a label ("ANA", "Ducks", "Anaheim Ducks") denote? */
  const sideOf = (sport: OddsSport, label: string, g: GameRef): 'home' | 'away' | null => {
    const full = abbr.resolve(sport, label);
    const hit = (name: string) => (full ? teamsMatch(full, name) : false) || teamsMatch(label, name);
    const h = hit(g.home);
    const a = hit(g.away);
    return h && !a ? 'home' : a && !h ? 'away' : null;
  };
  const near = (g: GameRef) => g.startMs > nowMs - 8 * 3600_000; // upcoming, in play, or only just finished
  const key = (g: GameRef) => `${g.sport}|${new Date(g.startMs).toISOString().slice(0, 10)}|${g.home}|${g.away}`;

  /** Place an outcome list on a game; returns the suggestion or a reason. */
  const place = (g: GameRef, outs: Outcome[], marketId: string, live: boolean, ts: number): RealPctSuggestion | string => {
    const sides: { home?: number; away?: number; draw?: number } = {};
    for (const o of outs) {
      if (isDraw(o.label)) sides.draw = o.p;
      else {
        const s = sideOf(g.sport, o.label, g);
        if (!s) return `outcome "${o.label}" is neither ${g.home} nor ${g.away}`;
        if (sides[s] !== undefined) return `two outcomes both mean ${s === 'home' ? g.home : g.away}`;
        sides[s] = o.p;
      }
    }
    if (sides.home === undefined || sides.away === undefined) return 'did not name both teams';
    for (const v of [sides.home, sides.away]) if (!(v * 100 >= PCT_MIN && v * 100 <= PCT_MAX)) return `probability ${v} is outside ${PCT_MIN}–${PCT_MAX}%`;
    if (nowMs - ts > MAX_REAL_AGE_MS) return `quote is ${Math.round((nowMs - ts) / 60_000)} min old`;
    return { sport: g.sport, home: g.home, away: g.away, startsAt: new Date(g.startMs).toISOString(), type: 'moneyline', sideProbs: { home: sides.home, away: sides.away }, ...(sides.draw !== undefined ? { draw: sides.draw } : {}), marketId, live, ts, source: 'raxedge' };
  };

  const alive = arr(rec(liveMarkets.__alive).ids).map(String);
  const liveById = new Map<string, { outs: Outcome[] | null; ts: number }>();

  // 1) live-probs: the verified shape.
  for (const [id, mv] of Object.entries(liveMarkets)) {
    if (id.startsWith('__')) continue;
    const m = rec(mv);
    if (m.isSettled === true || m.isLocked === true) {
      out.closed++;
      continue;
    }
    const outs = readOutcomes(arr(m.outcomes));
    const ts = tsMs(m.ts) ?? fallbackTs;
    liveById.set(id, { outs, ts });
    if (!outs) {
      warn(`Real market ${id}: outcomes were not 2–3 labelled probabilities that sum to 100% — skipped.`);
      continue;
    }
    const labels = outs.filter((o) => !isDraw(o.label)).map((o) => o.label);
    if (labels.length !== 2) {
      warn(`Real market ${id}: ${labels.length} team outcomes (${labels.join(', ')}) — only two-team game markets are read.`);
      continue;
    }
    const cand = abbr.sportsFor(labels[0], labels[1]);
    const matches: GameRef[] = [];
    for (const g of games) {
      if (!near(g) || !cand.includes(g.sport)) continue;
      if (sideOf(g.sport, labels[0], g) && sideOf(g.sport, labels[1], g) && sideOf(g.sport, labels[0], g) !== sideOf(g.sport, labels[1], g)) matches.push(g);
    }
    const uniq = [...new Map(matches.map((g) => [key(g), g])).values()];
    // Same teams listed twice (FD + DK of one game) collapse; two different sports/dates stay ambiguous. Prefer a game in play.
    let g: GameRef | undefined = uniq.length === 1 ? uniq[0] : uniq.filter((x) => x.startMs <= nowMs + 15 * 60_000)[0];
    if (uniq.length > 1 && uniq.filter((x) => x.startMs <= nowMs + 15 * 60_000).length !== 1) g = undefined;
    if (!g) {
      warn(uniq.length > 1 ? `Real market ${id} (${labels.join(' vs ')}): fits ${uniq.length} games — not guessing.` : `Real market ${id} (${labels.join(' vs ')}): no matching game in your export or the loaded odds.`);
      continue;
    }
    const s = place(g, outs, id, alive.length ? alive.includes(id) : true, ts);
    if (typeof s === 'string') warn(`Real market ${id} (${g.away} @ ${g.home}): ${s} — skipped.`);
    else out.suggestions.push(s);
  }

  // 2) sync: pre-game markets. Empty until Real's pool opens.
  for (const [slug, resp] of Object.entries(syncAll)) {
    const r = rec(resp);
    const markets = rec(r.markets);
    if (!Object.keys(markets).length) continue;
    for (const [name, body] of Object.entries(markets)) {
      if (name.includes('__')) continue;
      const isEmpty = body === null || body === undefined || (typeof body === 'object' && Object.keys(body as object).length === 0);
      if (isEmpty) {
        out.pending++;
        continue;
      }
      const sport = REAL_SPORT[str(markets[`${name}__sport`]).toLowerCase()] ?? REAL_SPORT[slug.toLowerCase()];
      const startMs = parseWhen(markets[`${name}__startMs`]);
      const pair = splitMatchup(name);
      if (!sport || startMs === null || !pair) {
        warn(`Real sync ${slug} "${name}": missing sport, start time or "Away @ Home" — skipped.`);
        continue;
      }
      const near2 = games.find((x) => x.sport === sport && teamsMatch(x.home, resolveTeam(sport, pair[1])) && teamsMatch(x.away, resolveTeam(sport, pair[0])) && Math.abs(x.startMs - startMs) <= MATCH_TOL_MS);
      const g: GameRef = near2 ?? { sport, home: resolveTeam(sport, pair[1]), away: resolveTeam(sport, pair[0]), startMs };
      if (!near(g)) continue;
      const found = scanSyncEntry(body, liveById);
      if (found.closed) {
        out.closed++;
        continue;
      }
      const ts = found.ts ?? tsMs(r.syncedAt) ?? fallbackTs;
      let result: RealPctSuggestion | string = 'no market id or outcome list in the entry';
      if (found.liveId && liveById.get(found.liveId)?.outs) result = place(g, liveById.get(found.liveId)!.outs!, found.liveId, false, liveById.get(found.liveId)!.ts);
      else if (found.outs) result = place(g, found.outs, found.marketId ?? `sync:${str(markets[`${name}__gid`])}`, false, ts);
      if (typeof result === 'string') {
        warn(`Real sync ${slug} "${name}": filled, but could not be read (${result}; keys seen: ${found.keys.slice(0, 8).join(', ') || 'none'}) — not used.`);
      } else out.suggestions.push(result);
    }
  }

  // De-duplicate one game seen twice (live-probs + sync): keep the freshest quote.
  const best = new Map<string, RealPctSuggestion>();
  for (const s of out.suggestions) {
    const k = key({ sport: s.sport, home: s.home, away: s.away, startMs: Date.parse(s.startsAt) });
    const old = best.get(k);
    if (!old || s.ts > old.ts) best.set(k, s);
  }
  out.suggestions = [...best.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return out;
}

/** Walk an unknown filled sync entry: a market id that live-probs also has, an outcome list, locked/settled flags, and the keys seen. */
function scanSyncEntry(body: unknown, liveById: Map<string, unknown>): { liveId: string | null; outs: Outcome[] | null; marketId: string | null; ts: number | null; closed: boolean; keys: string[] } {
  const res = { liveId: null as string | null, outs: null as Outcome[] | null, marketId: null as string | null, ts: null as number | null, closed: false, keys: [] as string[] };
  const seen = new Set<string>();
  let nodes = 0;
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || nodes++ > 2000 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      if (!res.outs) {
        const o = readOutcomes(v);
        if (o) res.outs = o;
      }
      for (const x of v) walk(x, depth + 1);
      return;
    }
    const r = v as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      if (seen.size < 40) seen.add(k);
      const val = r[k];
      if ((k === 'isLocked' || k === 'locked' || k === 'isSettled' || k === 'settled') && val === true) res.closed = true;
      if (/^(market_?id|mid|id|marketIds?)$/i.test(k) && (typeof val === 'string' || typeof val === 'number')) {
        const id = String(val);
        if (liveById.has(id)) res.liveId = res.liveId ?? id;
        if (!res.marketId && /market/i.test(k)) res.marketId = id;
      }
      if (/^(ts|updatedAt|updated_at|asOf)$/i.test(k) && res.ts === null) res.ts = tsMs(val) ?? parseWhen(val);
      walk(val, depth + 1);
    }
  };
  walk(body, 0);
  res.keys = [...seen];
  return res;
}
