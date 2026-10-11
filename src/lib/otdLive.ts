/** Live per-card lookup via Rateboard's /api/rax (through our proxy) for passes the static snapshot doesn't contain. */
import { getJson } from './api';
import { recordFromGames } from '../../shared/otdProfile';
import { OTD_TO_RAX_KEY, type OtdCardRecord, type OtdSport } from '../../shared/otdSnapshot';
import { norm } from '../../shared/rateboard';

const url = (params: Record<string, string | number>) =>
  `/api/proxy/rateboard?${new URLSearchParams({ path: 'api/rax', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) }).toString()}`;

/** Every game one player-season has, as an OTD card record. Null if Rateboard has no such card. */
export async function fetchCardRecord(sport: OtdSport, season: number, name: string): Promise<OtdCardRecord | null> {
  const key = OTD_TO_RAX_KEY[sport];
  const d = await getJson<{ rows?: Array<{ day: string; player: string; rax?: number; seasonType?: string; team?: string; playerId?: number }> }>(
    url({ gamelog: 'query', mode: 'games', sport: key, season, seasons: `${key}:${season}`, q: name, sort: 'day', dir: 'asc', limit: 500 }),
  );
  const rows = (d.rows ?? []).filter((r) => norm(r.player) === norm(name));
  return recordFromGames(sport, season, rows[0]?.player ?? name, rows);
}
