/**
 * Tab 9 (Edge / EV) — pure helpers: persistence keys, matching typed Real % to games, EV per side, the Best-EV board,
 * source-status classification and per-sport empty-state copy. No React, no I/O (testable under vitest/node).
 *
 * The fair probabilities come from shared/oddsConsensus.ts and the payout maths from shared/realPayout.ts; this file
 * only glues them to what the user typed.
 */
import type { MarketType, OddsEvent, OddsResponse, OddsSource, OddsSourceStatus, OddsSport } from '../../../shared/odds';
import { bestLines, consensusFair, type Consensus, type DevigMethod, type SourceFair } from '../../../shared/oddsConsensus';
import type { RealPctSuggestion } from '../../../shared/oddsRaxEdge';
import { teamsMatch } from '../../../shared/oddsSources';
import {
  breakEvenPct,
  evPct,
  maxRakeForBreakeven,
  payoutMultiple,
  recommendStake,
  sensitivity,
  type RealRules,
} from '../../../shared/realPayout';

/* ------------------------------------------------------------------ */
/* Typed Real % store                                                  */
/* ------------------------------------------------------------------ */

/**
 * What the user typed for one market of one game. Persisted in localStorage. Event ids from the API are session keys (the
 * canonical team names depend on which sources answered), so entries are keyed by sport|date|home|away|market|line and
 * re-matched loosely (see `lookupEntry`).
 */
export interface RealEntry {
  sport: OddsSport;
  /** UTC calendar date of the game, YYYY-MM-DD. */
  date: string;
  /** Team names as they were when the entry was saved — used to detect a flipped home/away orientation. */
  home: string;
  away: string;
  type: MarketType;
  line: number | null;
  /** ISO start of the game (for expiry). */
  start: string;
  /** Real's displayed % for [outcome 0, outcome 1] = [home|over, away|under]; null = not entered. */
  p: [number | null, number | null];
  /** Real's displayed % for the draw (3-way soccer moneyline). */
  d: number | null;
  /** Soccer: Real quotes only two outcomes (draw = refund), so the fair probability is conditioned on "no draw". */
  dnb?: boolean;
  /** Saved-at (ms). */
  t: number;
}
export type EntryStore = Record<string, RealEntry>;

export const EXPIRE_AFTER_MS = 24 * 3600_000;

/** Lowercase, accent-free, punctuation → single spaces. */
export const norm = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const eventDate = (e: Pick<OddsEvent, 'startsAt'>): string => e.startsAt.slice(0, 10);

const lineKey = (line: number | null) => (line === null ? '' : String(Math.round(line * 1000) / 1000));

/** sport|date|home|away|market|line — the persistence key. */
export function entryKey(sport: string, date: string, home: string, away: string, type: MarketType, line: number | null): string {
  return [sport, date, norm(home).replace(/ /g, '-'), norm(away).replace(/ /g, '-'), type, lineKey(line)].join('|');
}
export const marketKeyOf = (e: OddsEvent, type: MarketType, line: number | null): string => entryKey(e.sport, eventDate(e), e.home, e.away, type, type === 'moneyline' ? null : line);

/** Loose team-name equality: equal after normalisation, or one's tokens are all contained in the other's ("Detroit" ~ "Detroit Red Wings"). */
export function sameTeam(a: string, b: string): boolean {
  const x = norm(a).split(' ').filter(Boolean);
  const y = norm(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every((t) => l.includes(t));
}

const sameLine = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 1e-6);
const hoursApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 3600_000;

export interface Found {
  /** Key the entry is stored under. */
  key: string;
  entry: RealEntry;
  /** Real % oriented to the CURRENT event's outcome order (home|over first). */
  p: [number | null, number | null];
  d: number | null;
  dnb: boolean;
}

/**
 * Find what the user typed for (event, market, line): exact key first, then the same game with home/away mirrored (moneyline/spread,
 * where a mirrored spread line is negated), then a loose scan on team names within 12 h. Returns the values oriented to this event.
 */
export function lookupEntry(store: EntryStore, e: OddsEvent, type: MarketType, line: number | null): Found | null {
  const ln = type === 'moneyline' ? null : line;
  const oriented = (key: string, entry: RealEntry, flipped: boolean): Found => ({
    key,
    entry,
    p: flipped ? [entry.p[1], entry.p[0]] : [entry.p[0], entry.p[1]],
    d: entry.d,
    dnb: !!entry.dnb,
  });
  const exact = store[marketKeyOf(e, type, ln)];
  if (exact) return oriented(marketKeyOf(e, type, ln), exact, false);
  // Mirrored orientation: moneyline/spread swap sides (spread line negates); a total is orientation-free, so it matches as-is.
  const isTotal = type === 'total';
  const mirLine = ln === null || isTotal ? ln : -ln;
  const fk = entryKey(e.sport, eventDate(e), e.away, e.home, type, mirLine);
  if (store[fk]) return oriented(fk, store[fk], !isTotal);
  for (const [key, en] of Object.entries(store)) {
    if (en.sport !== e.sport || en.type !== type) continue;
    if (en.date !== eventDate(e) && hoursApart(en.start, e.startsAt) > 12) continue;
    if (sameLine(en.line, ln) && sameTeam(en.home, e.home) && sameTeam(en.away, e.away)) return oriented(key, en, false);
    if (sameLine(en.line, mirLine) && sameTeam(en.home, e.away) && sameTeam(en.away, e.home)) return oriented(key, en, !isTotal);
  }
  return null;
}

/** Store (or, if every field is empty, remove) the typed values for one market. Replaces a loosely-matched old key so there are no duplicates. */
export function putEntry(
  store: EntryStore,
  e: OddsEvent,
  type: MarketType,
  line: number | null,
  v: { p: [number | null, number | null]; d: number | null; dnb?: boolean },
  now = Date.now(),
): EntryStore {
  const ln = type === 'moneyline' ? null : line;
  const key = marketKeyOf(e, type, ln);
  const old = lookupEntry(store, e, type, ln);
  const next = { ...store };
  if (old) delete next[old.key];
  if (v.p[0] === null && v.p[1] === null && v.d === null) return next;
  next[key] = { sport: e.sport, date: eventDate(e), home: e.home, away: e.away, type, line: ln, start: e.startsAt, p: v.p, d: v.d, ...(v.dnb ? { dnb: true } : {}), t: now };
  return next;
}

/** Drop entries for games that started more than 24 h ago (and entries with nothing in them). */
export function pruneEntries(store: EntryStore, now = Date.now(), graceMs = EXPIRE_AFTER_MS): EntryStore {
  const out: EntryStore = {};
  for (const [k, en] of Object.entries(store ?? {})) {
    const start = Date.parse(en?.start);
    if (!en || !Number.isFinite(start) || start < now - graceMs) continue;
    if (en.p?.[0] == null && en.p?.[1] == null && en.d == null) continue;
    out[k] = en;
  }
  return out;
}

export const sportsWithEntries = (store: EntryStore): OddsSport[] => [...new Set(Object.values(store).map((e) => e.sport))];

/* ------------------------------------------------------------------ */
/* Input parsing                                                       */
/* ------------------------------------------------------------------ */

export const PCT_MIN = 0.5;
export const PCT_MAX = 99.5;
export const isValidPct = (x: number | null | undefined): x is number => x != null && Number.isFinite(x) && x >= PCT_MIN && x <= PCT_MAX;

/** "58", "58.5", "58%", " 58,5 " → number; "" → null (cleared); anything else → 'invalid'. Values outside 0.5–99.5 are 'invalid'. */
export function parsePct(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/%$/, '').replace(',', '.').trim();
  if (t === '') return null;
  if (!/^\d{1,3}(\.\d{0,3})?$|^\.\d{1,3}$/.test(t)) return 'invalid';
  const n = Number(t);
  return isValidPct(n) ? n : 'invalid';
}

/* ------------------------------------------------------------------ */
/* Fair probabilities → EV per side                                    */
/* ------------------------------------------------------------------ */

export interface Cfg {
  /** Rules incl. the user's own `minStake` / `maxStake` cap. */
  rules: RealRules;
  bankroll: number;
  /** Kelly fraction (0.25 = quarter Kelly). */
  fraction: number;
  devig: DevigMethod;
  /**
   * Opt-in sources that may join a consensus (FanDuel / DraftKings from the user's RaxEdge export). Absent or empty = exactly the
   * sources the API serves, i.e. the behaviour before those options existed.
   */
  include?: ReadonlySet<OddsSource>;
}

/** idx: 0 = home / over, 1 = away / under, 2 = draw. */
export type SideIdx = 0 | 1 | 2;

export interface SideFair {
  idx: SideIdx;
  label: string;
  fair: number;
}

export const hasDraw = (c: Consensus): boolean => c.type === 'moneyline' && c.draw != null && c.fair != null;

/** Display order is home, draw, away. `dnb` conditions a 3-way market on "no draw" (draw-no-bet). */
export function sideFairs(c: Consensus, dnb = false): SideFair[] {
  if (!c.fair) return [];
  let [a, b] = c.fair;
  if (hasDraw(c)) {
    if (dnb) {
      const t = a + b;
      return [
        { idx: 0, label: c.names[0], fair: a / t },
        { idx: 1, label: c.names[1], fair: b / t },
      ];
    }
    return [
      { idx: 0, label: c.names[0], fair: a },
      { idx: 2, label: 'Draw', fair: c.draw as number },
      { idx: 1, label: c.names[1], fair: b },
    ];
  }
  const t = a + b;
  a /= t;
  b /= t;
  return [
    { idx: 0, label: c.names[0], fair: a },
    { idx: 1, label: c.names[1], fair: b },
  ];
}

/** One source's fair probability for a side (same conditioning as `sideFairs`). */
export function sourceSideFair(sf: SourceFair, idx: SideIdx, dnb = false): number | null {
  if (idx === 2) return sf.draw;
  const [a, b] = sf.fair;
  const v = sf.draw !== null && dnb ? (idx === 0 ? a : b) / (a + b) : idx === 0 ? a : b;
  return Number.isFinite(v) ? v : null;
}

/** Compact volume: 950 → "950", 12 400 → "12.4k", 1 250 000 → "1.3M". */
export function fmtVol(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—';
  if (x >= 1e6) return `${(x / 1e6).toFixed(1)}M`;
  if (x >= 1e4) return `${Math.round(x / 1e3)}k`;
  if (x >= 1e3) return `${(x / 1e3).toFixed(1)}k`;
  return String(Math.round(x));
}

export interface SideEval {
  fair: number;
  realPct: number;
  /** Fair % − Real %, in percentage points (before any rake). */
  edgePp: number;
  /** EV in % of stake at the displayed price. */
  ev: number;
  /** Net payout multiple (stake returned on a win) at the displayed price, after rake. */
  multiple: number;
  /** Buy only if Real shows less than this %. */
  breakEven: number;
  /** Largest rake at which this is still ≥ 0 EV. */
  maxRake: number;
  /** Fractional-Kelly stake in Rax (0 = no edge / no bankroll / below minimum). */
  stake: number;
  /** Full-Kelly fraction of bankroll. */
  kelly: number;
  /** EV once your own stake moves the price ('pool' model); equals `ev` otherwise. */
  evAtStake: number;
  note: string;
}

export function evalSide(fair: number, realPct: number | null | undefined, cfg: Cfg): SideEval | null {
  if (!isValidPct(realPct) || !(fair >= 0 && fair <= 1)) return null;
  const rec = recommendStake(fair, realPct, cfg.bankroll, cfg.rules, cfg.fraction);
  return {
    fair,
    realPct,
    edgePp: fair * 100 - realPct,
    ev: evPct(fair, realPct, cfg.rules),
    multiple: payoutMultiple(realPct, cfg.rules),
    breakEven: breakEvenPct(fair, cfg.rules),
    maxRake: maxRakeForBreakeven(fair, realPct, cfg.rules.rakeBasis),
    stake: rec.stake,
    kelly: rec.kelly,
    evAtStake: rec.evPct,
    note: rec.note,
  };
}

export interface SideRow extends SideFair {
  real: number | null;
  ev: SideEval | null;
}

/** One row per outcome with the user's Real % and the resulting EV. */
export function evalMarket(c: Consensus, found: Pick<Found, 'p' | 'd' | 'dnb'> | null, cfg: Cfg): { rows: SideRow[]; best: SideRow | null } {
  const rows = sideFairs(c, !!found?.dnb).map((s): SideRow => {
    const real = !found ? null : s.idx === 2 ? found.d : found.p[s.idx];
    return { ...s, real, ev: evalSide(s.fair, real, cfg) };
  });
  const evald = rows.filter((r) => r.ev);
  const best = evald.length ? evald.reduce((m, r) => ((r.ev as SideEval).ev > (m.ev as SideEval).ev ? r : m)) : null;
  return { rows, best };
}

export interface SensRow {
  pct: number;
  ev: number;
  multiple: number;
  stake: number;
  /** The row the user typed. */
  current: boolean;
}

/** EV / payout / stake as Real's % moves ±`rangePp` (the pool fills during the day). */
export function sensRows(fair: number, pct0: number, cfg: Cfg, rangePp = 10, step = 2): { rows: SensRow[]; breakEven: number } {
  const s = sensitivity(fair, pct0, cfg.rules, { rangePp, step });
  const rows = s.rows.map((r): SensRow => ({
    pct: r.pct,
    ev: r.ev,
    multiple: r.multiple,
    stake: recommendStake(fair, r.pct, cfg.bankroll, cfg.rules, cfg.fraction).stake,
    current: Math.abs(r.pct - pct0) < 1e-6,
  }));
  return { rows, breakEven: s.breakEven };
}

/* ------------------------------------------------------------------ */
/* Markets of an event                                                 */
/* ------------------------------------------------------------------ */

export const MARKET_ORDER: MarketType[] = ['moneyline', 'spread', 'total'];
export const MARKET_LABEL: Record<MarketType, string> = { moneyline: 'Moneyline', spread: 'Spread', total: 'Total' };

/** Market types an event has any quote for, in display order. */
export const marketTypes = (e: Pick<OddsEvent, 'markets'>): MarketType[] => MARKET_ORDER.filter((t) => e.markets.some((m) => m.type === t));

/** Lines offered for a spread/total, best (most sources, nearest 50/50) first; `[null]` for a moneyline. */
export function linesOf(e: Pick<OddsEvent, 'markets'>, type: MarketType, method: DevigMethod, include?: ReadonlySet<OddsSource>): number[] {
  if (type === 'moneyline') return [];
  return bestLines(e, type, method, include).flatMap((l) => (l.line === null ? [] : [l.line]));
}

export const consensusFor = (e: OddsEvent, type: MarketType, line: number | null, method: DevigMethod, include?: ReadonlySet<OddsSource>): Consensus =>
  consensusFair(e, type, type === 'moneyline' ? null : line, method, include);

/** "Seattle -7.5" / "Over 47.5": how a line reads for a spread (home line) or total. */
export const lineText = (type: MarketType, line: number | null, e: Pick<OddsEvent, 'home'>): string =>
  line === null ? '' : type === 'spread' ? `${e.home} ${line > 0 ? '+' : ''}${line}` : String(line);

/* ------------------------------------------------------------------ */
/* Source agreement and status                                         */
/* ------------------------------------------------------------------ */

export type Agreement = 'single' | 'tight' | 'mild' | 'wide';
/** `spread` = max − min of the sources' fair probability (0.04 = 4 pp). > 3 pp is flagged, > 5 pp is a warning. */
export function agreement(spread: number | null): Agreement {
  if (spread === null) return 'single';
  if (spread <= 0.03) return 'tight';
  return spread <= 0.05 ? 'mild' : 'wide';
}

export type SourceState = 'ok' | 'partial' | 'error' | 'empty' | 'skipped';
export function sourceState(s: OddsSourceStatus): SourceState {
  if (!s.ok) return 'error';
  if (s.error && /no requests planned/i.test(s.error)) return 'skipped';
  if (s.error) return 'partial';
  return s.count === 0 ? 'empty' : 'ok';
}

const SPORT_NOTES: Partial<Record<OddsSport, { title: string; body: string }>> = {
  WNBA: {
    title: 'No WNBA markets right now',
    body: 'The WNBA is in its off-season, so Kalshi and Polymarket have no open game markets and ESPN has no DraftKings lines. They return when next season’s schedule opens.',
  },
  CBB: {
    title: 'No college basketball markets yet',
    body: 'The men’s college basketball season has not started, so Kalshi and Polymarket have not listed any games (and DraftKings lines only appear about a day before tip-off).',
  },
  UFC: {
    title: 'No UFC card in the next few days with markets',
    body: 'Kalshi and Polymarket list a card close to fight night, and ESPN shows DraftKings lines about a day before. A card further out (e.g. next week) will appear once any source posts a line.',
  },
};

export interface EmptyReason {
  tone: 'info' | 'error';
  title: string;
  body: string;
}
/** Why the list of games is empty for a sport (call only when `events` is empty). */
export function emptyReason(sport: OddsSport, r: OddsResponse | null): EmptyReason {
  const down = (r?.sources ?? []).filter((s) => sourceState(s) === 'error');
  if (r && down.length === r.sources.filter((s) => sourceState(s) !== 'skipped').length && down.length > 0) {
    return { tone: 'error', title: 'Every odds source failed', body: down.map((s) => `${s.source}: ${s.error ?? 'error'}`).join(' · ') };
  }
  const note = SPORT_NOTES[sport];
  if (note) return { tone: 'info', ...note };
  return {
    tone: 'info',
    title: `No upcoming ${sport} games with markets`,
    body: down.length
      ? `Nothing in the next ~3 days. Note: ${down.map((s) => s.source).join(', ')} failed this refresh, so a game may be missing.`
      : 'No game in the next ~3 days has a line from Kalshi, Polymarket or DraftKings (ESPN posts DraftKings lines about a day ahead, and finished games drop off).',
  };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** "just now" / "12 min ago" / "3 h ago" / "2 d ago" for an age in ms. */
export function fmtAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}
/** How stale a RaxEdge snapshot is: odds move in minutes, so amber after 15 min and red after 60. */
export const ageTone = (ms: number): 'ok' | 'amber' | 'red' => (ms > 60 * 60_000 ? 'red' : ms > 15 * 60_000 ? 'amber' : 'ok');

export const fmtP = (x: number | null | undefined, d = 1): string => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(d)}%`);
export const fmtNum = (x: number | null | undefined, d = 1): string => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(d));
export const fmtSigned = (x: number | null | undefined, d = 1, suffix = ''): string => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(d)}${suffix}`);

/** Local calendar-day key for grouping; date-only (startApprox) games use their UTC date because their clock time is a placeholder. */
export function dayKey(e: Pick<OddsEvent, 'startsAt' | 'startApprox'>): string {
  if (e.startApprox) return e.startsAt.slice(0, 10);
  const d = new Date(e.startsAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dayLabel(key: string, now = new Date()): string {
  const today = dayKey({ startsAt: now.toISOString(), startApprox: false });
  const tm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrow = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}`;
  const [y, m, d] = key.split('-').map(Number);
  const nice = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  return key === today ? `Today · ${nice}` : key === tomorrow ? `Tomorrow · ${nice}` : nice;
}

/** "Sun 1:05 PM", or "≈ Sun" for a game whose kick-off time no source published. */
export function startText(e: Pick<OddsEvent, 'startsAt' | 'startApprox'>): { text: string; approx: boolean } {
  const d = new Date(e.startsAt);
  if (e.startApprox) {
    const [y, m, dd] = e.startsAt.slice(0, 10).split('-').map(Number);
    return { text: `≈ ${new Date(y, m - 1, dd).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}`, approx: true };
  }
  return { text: d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), approx: false };
}

/** Case/accent-insensitive search over teams + league + sport. */
export const matchesSearch = (e: Pick<OddsEvent, 'home' | 'away' | 'league' | 'sport'>, q: string): boolean => {
  const n = norm(q);
  if (!n) return true;
  const hay = norm(`${e.home} ${e.away} ${e.league} ${e.sport}`);
  return n.split(' ').every((t) => hay.includes(t));
};

/* ------------------------------------------------------------------ */
/* Best-EV board                                                       */
/* ------------------------------------------------------------------ */

export interface BoardRow {
  /** Stable React key. */
  id: string;
  /** Key of the stored entry. */
  entryKey: string;
  event: OddsEvent;
  type: MarketType;
  line: number | null;
  side: SideRow;
  eval: SideEval;
  confidence: Consensus['confidence'];
  spread: number | null;
  nSources: number;
  /** This side's Real % came from the user's RaxEdge export (not typed). */
  auto?: AutoReal | null;
}

/**
 * Every side with a Real % across the given events, sorted by EV (best first). The % is what the user typed; with `suggestions`
 * (opt-in, from RaxEdge) a side the user left empty falls back to Real's own number. Without `suggestions` this is exactly the
 * typed-only board.
 */
export function buildBoard(events: OddsEvent[], store: EntryStore, cfg: Cfg, suggestions: RealPctSuggestion[] = []): { rows: BoardRow[]; used: Set<string> } {
  const rows: BoardRow[] = [];
  const used = new Set<string>();
  if (!Object.keys(store).length && !suggestions.length) return { rows, used };
  for (const e of events) {
    for (const type of marketTypes(e)) {
      const lines: Array<number | null> = type === 'moneyline' ? [null] : linesOf(e, type, cfg.devig, cfg.include);
      for (const line of lines) {
        const typed = lookupEntry(store, e, type, line);
        const sug = type === 'moneyline' ? findAuto(suggestions, e) : null;
        if (typed && used.has(typed.key)) continue;
        if (!typed && !sug) continue;
        if (typed) used.add(typed.key);
        const c = consensusFor(e, type, line, cfg.devig, cfg.include);
        const eff = withAuto(typed, sug, hasDraw(c));
        const { rows: sides } = evalMarket(c, eff, cfg);
        for (const s of sides) {
          if (!s.ev) continue;
          const isAuto = s.idx === 2 ? !!eff?.autoD : !!eff?.auto[s.idx];
          rows.push({ id: `${typed?.key ?? `auto|${e.id}|${type}`}#${s.idx}`, entryKey: typed?.key ?? '', event: e, type, line, side: s, eval: s.ev, confidence: c.confidence, spread: c.spread, nSources: c.sources.length, auto: isAuto ? sug : null });
        }
      }
    }
  }
  rows.sort((a, b) => b.eval.ev - a.eval.ev);
  return { rows, used };
}


/* ------------------------------------------------------------------ */
/* Real % from the user's RaxEdge export (opt-in auto-fill)            */
/* ------------------------------------------------------------------ */

/** A RaxEdge Real % suggestion oriented to one event (home|over first), in percent. */
export interface AutoReal {
  /** Real's % for [home, away]. */
  p: [number, number];
  /** Real's % for the draw when the suggestion carries one. */
  d: number | null;
  s: RealPctSuggestion;
}

const round1 = (x: number) => Math.round(x * 1000) / 10;

/** The suggestion for this game (same sport and teams in either orientation, kick-off within 3 h), oriented to the event. Moneyline only. */
export function findAuto(suggestions: RealPctSuggestion[], e: Pick<OddsEvent, 'sport' | 'home' | 'away' | 'startsAt' | 'startApprox'>): AutoReal | null {
  let best: { a: AutoReal; d: number } | null = null;
  for (const s of suggestions) {
    if (s.sport !== e.sport) continue;
    const straight = teamsMatch(e.home, s.home) && teamsMatch(e.away, s.away);
    const swapped = !straight && teamsMatch(e.home, s.away) && teamsMatch(e.away, s.home);
    if (!straight && !swapped) continue;
    const d = Math.abs(Date.parse(e.startsAt) - Date.parse(s.startsAt));
    const sameDay = e.startsAt.slice(0, 10) === s.startsAt.slice(0, 10) || hoursApart(e.startsAt, s.startsAt) <= 24;
    if (e.startApprox ? !sameDay : d > 3 * 3600_000) continue;
    const h = round1(s.sideProbs.home);
    const a = round1(s.sideProbs.away);
    const p: [number, number] = straight ? [h, a] : [a, h];
    if (!isValidPct(p[0]) || !isValidPct(p[1])) continue;
    if (!best || d < best.d) best = { a: { p, d: s.draw != null ? round1(s.draw) : null, s }, d };
  }
  return best?.a ?? null;
}

/** What the editor/EV should use: typed values win per side; RaxEdge fills only the sides the user left empty. */
export interface Resolved extends Pick<Found, 'p' | 'd' | 'dnb'> {
  /** Per [side 0, side 1]: this value is RaxEdge's, not typed. */
  auto: [boolean, boolean];
  /** The draw value is RaxEdge's. */
  autoD: boolean;
  src: AutoReal | null;
}
export function withAuto(typed: Pick<Found, 'p' | 'd' | 'dnb'> | null, auto: AutoReal | null, threeWay = false): Resolved | null {
  if (!typed && !auto) return null;
  const tp = typed?.p ?? [null, null];
  // A 3-way (soccer) market needs Real's draw price too; without it a RaxEdge pair would be a different market. Skip.
  const use = auto && (!threeWay || typed?.dnb || auto.d != null) ? auto : null;
  const p: [number | null, number | null] = [tp[0] ?? use?.p[0] ?? null, tp[1] ?? use?.p[1] ?? null];
  return {
    p,
    d: typed?.d ?? (use && !typed?.dnb ? use.d : null),
    dnb: !!typed?.dnb,
    auto: [tp[0] == null && use != null, tp[1] == null && use != null],
    autoD: typed?.d == null && !typed?.dnb && use?.d != null,
    src: use,
  };
}
