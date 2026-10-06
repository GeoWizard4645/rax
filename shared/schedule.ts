/**
 * Real game schedules from ESPN's public scoreboard JSON (free, no key) → Quad matchup rows.
 *
 * What is real: teams, start time, broadcaster, live/final status, postseason flag, betting total when ESPN has one.
 * What is estimated: pace index (sport average, scaled by the over/under when available) and polls per game.
 * Community poll results are NOT from here — they remain sample data.
 */
import type { Sport } from '../src/types/real';
import type { QuadGame } from './sample';

export const ESPN_PATH: Partial<Record<Sport, string>> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
  CFB: 'football/college-football',
  CBB: 'basketball/mens-college-basketball',
};

/** Typical possessions/plays tempo (1.0 = NFL) — priors, scaled per game by the betting total when present. */
const PACE_PRIOR: Partial<Record<Sport, number>> = { NFL: 1.0, NBA: 1.15, NHL: 0.9, MLB: 0.7, CFB: 1.1, CBB: 1.1 };
const AVG_TOTAL: Partial<Record<Sport, number>> = { NFL: 45, NBA: 225, NHL: 6, MLB: 8.5, CFB: 55, CBB: 140 };
const POLLS_PRIOR: Partial<Record<Sport, number>> = { NFL: 17, NBA: 21, NHL: 12, MLB: 11, CFB: 18, CBB: 16 };

const MARQUEE_NETWORKS = new Set(['ESPN', 'ESPN2', 'ABC', 'NBC', 'TNT', 'TBS', 'FOX', 'CBS', 'PRIME VIDEO', 'AMAZON PRIME VIDEO', 'PEACOCK', 'NETFLIX']);

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Weekday (0 = Sun) and hour in US Eastern time. */
function easternParts(iso: string): { dow: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), hour };
}

export function isMarquee(sport: Sport, startsAt: string, nationalNetworks: string[], seasonType: number | undefined): boolean {
  if (seasonType === 3) return true; // postseason
  if (sport === 'NFL') {
    const { dow, hour } = easternParts(startsAt);
    return dow === 4 || dow === 1 || (dow === 0 && hour >= 19) || nationalNetworks.some((n) => /prime|amazon|netflix|peacock/i.test(n));
  }
  return nationalNetworks.some((n) => MARQUEE_NETWORKS.has(n.toUpperCase()));
}

interface EspnComp {
  competitors?: Array<{ homeAway: string; team?: { displayName?: string } }>;
  broadcasts?: Array<{ market?: string; names?: string[] }>;
  odds?: Array<{ overUnder?: number }>;
  notes?: Array<{ headline?: string }>;
}
interface EspnEvent {
  id: string;
  date: string;
  season?: { type?: number };
  status?: { type?: { state?: string } };
  competitions?: EspnComp[];
}

/** ESPN scoreboard JSON → QuadGame[]. Skips events it can't read; never throws. */
export function normalizeEspn(sport: Sport, json: unknown): QuadGame[] {
  const events = (json as { events?: EspnEvent[] } | null)?.events;
  if (!Array.isArray(events)) return [];
  const out: QuadGame[] = [];
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    const c = e.competitions?.[0];
    const home = c?.competitors?.find((x) => x.homeAway === 'home')?.team?.displayName;
    const away = c?.competitors?.find((x) => x.homeAway === 'away')?.team?.displayName;
    if (!e.id || !e.date || !home || !away) continue;
    const all = c?.broadcasts ?? [];
    const national = all.filter((b) => b.market === 'national').flatMap((b) => b.names ?? []);
    const names = (national.length ? national : all.flatMap((b) => b.names ?? [])).slice(0, 3);
    const total = c?.odds?.find((o) => typeof o.overUnder === 'number')?.overUnder;
    const priorPace = PACE_PRIOR[sport] ?? 1;
    const avgTotal = AVG_TOTAL[sport];
    const pace = total && avgTotal ? clamp(priorPace * (total / avgTotal), priorPace * 0.8, priorPace * 1.25) : priorPace;
    const marquee = isMarquee(sport, e.date, national, e.season?.type);
    const state = e.status?.type?.state;
    out.push({
      id: `espn-${sport}-${e.id}`,
      sport,
      title: c?.notes?.[0]?.headline || (e.season?.type === 3 ? 'Postseason' : 'Regular season'),
      broadcast: names.join(' / ') || '—',
      home,
      away,
      startsAt: new Date(e.date).toISOString(),
      pace: Math.round(pace * 100) / 100,
      pollsPerGame: Math.round((POLLS_PRIOR[sport] ?? 14) * (marquee ? 1.1 : 0.9)),
      marquee,
      status: state === 'in' ? 'live' : state === 'post' ? 'final' : 'scheduled',
      estimated: true,
    });
  }
  return out;
}

/** US Eastern calendar date `offset` days from `now`, as YYYYMMDD (what ESPN's `dates=` expects). */
export function espnDate(now: number, offset: number): string {
  const d = new Date(now + offset * 86_400_000);
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replace(/-/g, '');
}
