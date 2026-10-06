/**
 * Live game schedule  —  /api/intel/schedule[?days=4]
 *
 * Real schedules for NFL / NBA / MLB / NHL / CFB / CBB from ESPN's public scoreboard (free, no API key; unofficial
 * and unguaranteed). Powers Tab 6's matchup list. Falls back to labelled sample data if ESPN is unreachable.
 */
import type { QuadGame } from '../../../shared/sample';
import { sampleQuads } from '../../../shared/sample';
import { ESPN_PATH, espnDate, normalizeEspn } from '../../../shared/schedule';
import type { Sport } from '../../../src/types/real';
import { cached, err, json, preflight, type Env } from '../../_lib/http';

export interface ScheduleResponse {
  source: 'live' | 'sample';
  generatedAt: string;
  games: QuadGame[];
  note?: string;
}

const TTL = 600;

export const onRequest: PagesFunction<Env> = async ({ request, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');
  const days = Math.min(5, Math.max(1, Number(new URL(request.url).searchParams.get('days') || 4)));

  return cached(`intel/schedule/${days}`, TTL, async () => {
    const now = Date.now();
    const jobs: Array<Promise<QuadGame[]>> = [];
    for (const [sport, path] of Object.entries(ESPN_PATH) as Array<[Sport, string]>) {
      for (let d = 0; d < days; d++) {
        const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${espnDate(now, d)}`;
        jobs.push(
          // No custom User-Agent: ESPN's CDN rejects unfamiliar agent strings (403) but serves default clients.
          fetch(url, { headers: { Accept: 'application/json' } })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => normalizeEspn(sport, j))
            .catch(() => []),
        );
      }
    }
    const seen = new Set<string>();
    const games = (await Promise.all(jobs))
      .flat()
      .filter((g) => g.status !== 'final' && !seen.has(g.id) && !!seen.add(g.id))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

    if (!games.length) {
      const body: ScheduleResponse = { source: 'sample', generatedAt: new Date(now).toISOString(), games: sampleQuads(now).games, note: 'Schedule source unavailable — showing sample matchups.' };
      return json(body);
    }
    const body: ScheduleResponse = {
      source: 'live',
      generatedAt: new Date(now).toISOString(),
      games,
      note: 'Teams, times, broadcasts and status are live from ESPN. Pace and polls-per-game are estimated from sport averages.',
    };
    return json(body, 200, { 'X-Data-Source': 'site.api.espn.com' });
  }, (p) => waitUntil(p));
};
