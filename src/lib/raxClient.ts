/**
 * Client for Rateboard's `/api/rax` (owner-approved), via /api/proxy/rateboard. Per-game rows power Tab 4 (OTD);
 * per-player season rows give the owners / rax chips on offers.
 */
import { getJson } from './api';
import {
  RAX_TO_SPORT,
  RB_TO_RAX,
  SPORT_TO_RAX,
  statsByName,
  toHistoricalGame,
  type PlayerStat,
  type RaxGameRow,
  type RaxPlayerRow,
  type RaxSeason,
} from '../../shared/rax';
import { norm, type RbSport } from '../../shared/rateboard';
import type { HistoricalGame, Sport } from '../types/real';

const url = (params: Record<string, string | number>) =>
  `/api/proxy/rateboard?${new URLSearchParams({ path: 'api/rax', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString()}`;

let seasonsJob: Promise<RaxSeason[]> | null = null;
/** Every collected sport-season (cached for the page's lifetime). */
export function fetchSeasons(): Promise<RaxSeason[]> {
  seasonsJob ??= getJson<{ seasons?: RaxSeason[] }>(url({ gamelog: 'seasons' }))
    .then((d) => d.seasons ?? [])
    .catch((e) => {
      seasonsJob = null;
      throw e;
    });
  return seasonsJob;
}

const pairsFor = (seasons: RaxSeason[], key: string) => seasons.filter((s) => s.sport === key);
const seasonsParam = (pairs: RaxSeason[]) => pairs.map((p) => `${p.sport}:${p.season}`).join(',');

/**
 * Every sport's biggest games that happened on this calendar day (MM-DD) in any collected season — what pays out
 * on its anniversary. Top 500 per sport by Rax: the 2-claim maths only ever needs the top.
 */
export async function fetchDayGames(md: string, signal?: AbortSignal): Promise<HistoricalGame[]> {
  const seasons = await fetchSeasons();
  const keys = Object.keys(RAX_TO_SPORT).filter((k) => pairsFor(seasons, k).length);
  const lists = await Promise.all(
    keys.map(async (key) => {
      const pairs = pairsFor(seasons, key);
      const latest = Math.max(...pairs.map((p) => p.season));
      const d = await getJson<{ rows?: RaxGameRow[] }>(
        url({ gamelog: 'query', mode: 'games', sport: key, season: latest, seasons: seasonsParam(pairs), fromMD: md, toMD: md, sort: 'rax', dir: 'desc', limit: 500 }),
        signal,
      );
      return (d.rows ?? []).map((r) => toHistoricalGame(key, r)).filter((g): g is HistoricalGame => !!g);
    }),
  );
  return lists.flat();
}

const cardCache = new Map<string, Promise<HistoricalGame[]>>();

/** Every game one card (a player in a given season) has — the card's full anniversary calendar. Cached per card. */
export function fetchCardGames(sport: Sport, season: string, name: string): Promise<HistoricalGame[]> {
  const key = SPORT_TO_RAX[sport];
  if (!key || !/^\d{4}$/.test(season)) return Promise.resolve([]);
  const id = `${key}|${season}|${norm(name)}`;
  let job = cardCache.get(id);
  if (!job) {
    job = getJson<{ rows?: RaxGameRow[] }>(url({ gamelog: 'query', mode: 'games', sport: key, season, seasons: `${key}:${season}`, q: name, sort: 'day', dir: 'asc', limit: 500 }))
      .then((d) => (d.rows ?? []).filter((r) => norm(r.player) === norm(name)).map((r) => toHistoricalGame(key, r, Number(season))).filter((g): g is HistoricalGame => !!g))
      .catch((e) => {
        cardCache.delete(id);
        throw e;
      });
    cardCache.set(id, job);
  }
  return job;
}

/** Player names matching `q` in a sport (any season) — for the card picker. */
export async function searchRaxNames(sport: Sport, q: string, signal?: AbortSignal): Promise<string[]> {
  const key = SPORT_TO_RAX[sport];
  if (!key || q.trim().length < 2) return [];
  const pairs = pairsFor(await fetchSeasons(), key);
  if (!pairs.length) return [];
  const d = await getJson<{ rows?: RaxPlayerRow[] }>(
    url({ gamelog: 'query', mode: 'players', sport: key, season: Math.max(...pairs.map((p) => p.season)), seasons: seasonsParam(pairs), q: q.trim(), sort: 'rax', dir: 'desc', limit: 15 }),
    signal,
  );
  return [...new Set((d.rows ?? []).map((r) => r.player).filter(Boolean))];
}

const statJobs = new Map<string, Promise<Map<string, PlayerStat>>>();

/** Owners + season Rax for the top 500 players of a board sport — the chips Rateboard shows beside offers. */
export function fetchPlayerStats(sport: RbSport): Promise<Map<string, PlayerStat>> {
  const cfg = RB_TO_RAX[sport];
  if (!cfg) return Promise.resolve(new Map());
  let job = statJobs.get(sport);
  if (!job) {
    job = getJson<{ rows?: RaxPlayerRow[] }>(url({ gamelog: 'query', mode: 'players', sport: cfg.key, season: cfg.season, seasons: `${cfg.key}:${cfg.season}`, sort: 'rax', dir: 'desc', limit: 500 }))
      .then((d) => statsByName(d.rows ?? []))
      .catch(() => {
        statJobs.delete(sport);
        return new Map<string, PlayerStat>();
      });
    statJobs.set(sport, job);
  }
  return job;
}
