/**
 * Rateboard's `/api/rax` — per-game and per-season Rax data (owner-approved for use here).
 * Pure helpers only: the allow-list that guards the proxy, sport/season mapping, and row → app-model conversion.
 * Rateboard owns the data; it is reached through /api/proxy/rateboard?path=api/rax&…
 */
import type { HistoricalGame, Sport } from '../src/types/real';
import { norm, type RbSport } from './rateboard';

/** Rax's sport keys → this app's sports. soccer / wnba have no equivalent here and are skipped. */
export const RAX_TO_SPORT: Record<string, Sport> = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', ncaaf: 'CFB', ncaam: 'CBB', golf: 'PGA' };
export const SPORT_TO_RAX: Partial<Record<Sport, string>> = Object.fromEntries(Object.entries(RAX_TO_SPORT).map(([k, v]) => [v, k]));

/** Rateboard board sports that have Rax data, and the season Rateboard itself reads for its owners / rax chips. */
export const RB_TO_RAX: Partial<Record<RbSport, { key: string; season: number }>> = {
  CFB: { key: 'ncaaf', season: 2026 },
  FC: { key: 'soccer', season: 2026 },
  NFL: { key: 'nfl', season: 2026 },
  NHL: { key: 'nhl', season: 2026 },
};

export interface RaxSeason {
  sport: string;
  season: number;
  rows: number;
  players: number;
}

/**
 * The season label Rax uses for a game played on `day` (YYYY-MM-DD). Labels differ per sport — NFL / NHL / CFB use
 * the starting year, NBA / CBB the ending year, MLB / golf the calendar year (checked against each season's first and
 * last game date).
 */
export function seasonLabel(sportKey: string, day: string): number {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  switch (sportKey) {
    case 'nfl':
    case 'nhl':
    case 'ncaaf':
      return m >= 7 ? y : y - 1;
    case 'nba':
    case 'ncaam':
      return m >= 8 ? y + 1 : y;
    default:
      return y;
  }
}

/* ------------------------------ query allow-list ------------------------------ */

const WORD = /^[a-z0-9]{1,12}$/i;
const SEASONS = /^[a-z0-9]{2,8}:\d{4}(,[a-z0-9]{2,8}:\d{4}){0,59}$/;
const MD = /^\d{2}-\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SORTS = new Set(['rax', 'raxPerGame', 'bestRax', 'owners', 'rating', 'ratingPerGame', 'games', 'day', 'player', 'team']);
const DIRS = new Set(['asc', 'desc']);
const MODES = new Set(['players', 'games']);
const GAMELOGS = new Set(['seasons', 'query']);
export const RAX_MAX_LIMIT = 500;

/**
 * Validate a browser-supplied `/api/rax` query and rebuild it from known keys only, so the proxy never forwards
 * anything it hasn't looked at. Returns null when the query isn't one we allow. Golf pages and `gamelog=top` aren't used.
 */
export function buildRaxQuery(params: URLSearchParams): string | null {
  const out = new URLSearchParams();
  const gamelog = params.get('gamelog');
  if (!gamelog || !GAMELOGS.has(gamelog)) return null;
  out.set('gamelog', gamelog);
  if (gamelog === 'seasons') return out.toString();

  const mode = params.get('mode') || 'players';
  if (!MODES.has(mode)) return null;
  out.set('mode', mode);

  const sport = params.get('sport');
  const season = params.get('season');
  const seasons = params.get('seasons');
  if (!sport || !WORD.test(sport) || !season || !/^\d{4}$/.test(season) || !seasons || !SEASONS.test(seasons)) return null;
  out.set('sport', sport);
  out.set('season', season);
  out.set('seasons', seasons);

  const q = params.get('q');
  if (q) {
    if (q.length > 60 || /[\u0000-\u001f]/.test(q)) return null;
    out.set('q', q);
  }
  const sort = params.get('sort');
  if (sort) {
    if (!SORTS.has(sort)) return null;
    out.set('sort', sort);
  }
  const dir = params.get('dir');
  if (dir) {
    if (!DIRS.has(dir)) return null;
    out.set('dir', dir);
  }
  const limit = params.get('limit');
  if (limit) {
    if (!/^\d{1,3}$/.test(limit) || +limit < 1 || +limit > RAX_MAX_LIMIT) return null;
    out.set('limit', limit);
  }
  const offset = params.get('offset');
  if (offset) {
    if (!/^\d{1,6}$/.test(offset)) return null;
    out.set('offset', offset);
  }
  for (const k of ['fromMD', 'toMD'] as const) {
    const v = params.get(k);
    if (v) {
      if (!MD.test(v)) return null;
      out.set(k, v);
    }
  }
  for (const k of ['from', 'to'] as const) {
    const v = params.get(k);
    if (v) {
      if (!DAY.test(v)) return null;
      out.set(k, v);
    }
  }
  return out.toString();
}

/* ------------------------------ rows → app models ------------------------------ */

export interface RaxGameRow {
  day: string;
  player: string;
  team?: string | null;
  rax?: number | null;
  rating?: number | null;
  playerId?: number | string | null;
}

/** One `mode=games` row → a HistoricalGame (null when the row is unusable). */
export function toHistoricalGame(sportKey: string, row: RaxGameRow, season?: number): HistoricalGame | null {
  const sport = RAX_TO_SPORT[sportKey];
  if (!sport || !row?.player || !/^\d{4}-\d{2}-\d{2}$/.test(String(row.day))) return null;
  const rax = Number(row.rax);
  if (!Number.isFinite(rax) || rax <= 0) return null;
  const rating = Number(row.rating);
  const pid = String(row.playerId ?? norm(row.player).replace(/ /g, '-'));
  return {
    id: `${sportKey}-${pid}-${row.day}`,
    playerId: pid,
    playerName: row.player,
    sport,
    team: row.team ? String(row.team) : '',
    season: String(season ?? seasonLabel(sportKey, row.day)),
    date: row.day,
    rating: Number.isFinite(rating) ? Math.round(Math.min(10, Math.max(0, rating)) * 10) / 10 : 0,
    baseRax: Math.round(rax),
  };
}

export interface RaxPlayerRow {
  player: string;
  team?: string | null;
  games?: number | null;
  rax?: number | null;
  raxPerGame?: number | null;
  bestRax?: number | null;
  owners?: number | null;
  rating?: number | null;
}

export interface PlayerStat {
  rax: number | null;
  owners: number | null;
  rating: number | null;
  games: number | null;
}

/** name (normalised) → stat, as Rateboard's own offer chips do. */
export function statsByName(rows: RaxPlayerRow[]): Map<string, PlayerStat> {
  const m = new Map<string, PlayerStat>();
  for (const r of rows) {
    if (!r?.player) continue;
    const k = norm(r.player);
    if (m.has(k)) continue; // rows arrive best-first; keep the first
    m.set(k, { rax: r.rax ?? null, owners: r.owners ?? null, rating: r.rating ?? null, games: r.games ?? null });
  }
  return m;
}

/** The biggest anniversaries today per sport, one entry per card (player + season) — the ROI screener's candidates. */
export function topCards(games: HistoricalGame[], perSport: number): Array<{ playerName: string; sport: Sport; season: string }> {
  const bySport = new Map<Sport, HistoricalGame[]>();
  for (const g of games) (bySport.get(g.sport) ?? bySport.set(g.sport, []).get(g.sport)!).push(g);
  const out: Array<{ playerName: string; sport: Sport; season: string }> = [];
  for (const [sport, list] of bySport) {
    const seen = new Set<string>();
    for (const g of [...list].sort((a, b) => b.baseRax - a.baseRax)) {
      const id = `${g.playerName}|${g.season}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ playerName: g.playerName, sport, season: g.season });
      if (seen.size >= perSport) break;
    }
  }
  return out;
}
