/**
 * Season calendar + seasonal value drift.
 *
 * Cards tend to gain value as a season approaches (hype ramp), hold in-season, spike into the playoffs,
 * then decay once the season ends. The dates below are approximate league calendars and the drift sizes
 * are PRIORS — assumptions, not values fitted to Real's market. They are exposed so they can be edited
 * (Tab 3 scenario controls) and replaced with fitted values once multi-season price history is available.
 */
import type { Sport } from '../src/types/real';

const DAY = 86_400_000;

interface Cal {
  /** [month, day] of the regular season start / end, and the end of the post-season. */
  start: [number, number];
  end: [number, number];
  post: [number, number];
  yearRound?: boolean;
}

export const SEASON_CAL: Record<Sport, Cal> = {
  NFL: { start: [9, 5], end: [1, 5], post: [2, 12] },
  NBA: { start: [10, 22], end: [4, 13], post: [6, 20] },
  MLB: { start: [3, 27], end: [9, 28], post: [11, 1] },
  NHL: { start: [10, 8], end: [4, 17], post: [6, 25] },
  CBB: { start: [11, 4], end: [3, 10], post: [4, 7] },
  CFB: { start: [8, 30], end: [12, 6], post: [1, 20] },
  PGA: { start: [1, 2], end: [8, 25], post: [8, 31] },
  UFC: { start: [1, 1], end: [12, 31], post: [12, 31], yearRound: true },
};

export type SeasonPhase = 'ramp' | 'early' | 'mid' | 'stretch' | 'playoffs' | 'post-decay' | 'offseason' | 'year-round';

export interface SeasonProfile {
  /** Log-drift per day in the weeks before the season starts (hype ramp). */
  rampPerDay: number;
  rampWindowDays: number;
  earlyPerDay: number;
  midPerDay: number;
  stretchPerDay: number;
  playoffsPerDay: number;
  /** Fast decay right after the season ends. */
  postDecayPerDay: number;
  postDecayDays: number;
  /** Slow decay for the rest of the off-season. */
  offseasonPerDay: number;
}

export const DEFAULT_SEASON_PROFILE: SeasonProfile = {
  rampPerDay: 0.0035,
  rampWindowDays: 45,
  earlyPerDay: 0.0008,
  midPerDay: 0,
  stretchPerDay: 0.0008,
  playoffsPerDay: 0.002,
  postDecayPerDay: -0.004,
  postDecayDays: 30,
  offseasonPerDay: -0.0012,
};

const utc = (y: number, md: [number, number]) => Date.UTC(y, md[0] - 1, md[1]);

/** The season (start, regular-season end, post-season end) that is current or next relative to `t`. */
function seasonAround(cal: Cal, t: number) {
  const y = new Date(t).getUTCFullYear();
  const seasons = [y - 1, y, y + 1].map((sy) => {
    const start = utc(sy, cal.start);
    let end = utc(sy, cal.end);
    if (end < start) end = utc(sy + 1, cal.end);
    let post = utc(sy, cal.post);
    while (post < end) post = utc(new Date(post).getUTCFullYear() + 1, cal.post);
    return { start, end, post };
  });
  const current = seasons.find((s) => t >= s.start && t <= s.post);
  const next = seasons.find((s) => s.start > t)!;
  const prev = [...seasons].reverse().find((s) => s.post < t);
  return { current, next, prev };
}

export interface PhaseInfo {
  phase: SeasonPhase;
  daysToStart: number | null;
  daysSinceEnd: number | null;
  /** 0–1 through the regular season, when in it. */
  progress: number | null;
}

export function seasonPhase(sport: Sport, t: number): PhaseInfo {
  const cal = SEASON_CAL[sport];
  if (cal.yearRound) return { phase: 'year-round', daysToStart: null, daysSinceEnd: null, progress: null };
  const { current, next, prev } = seasonAround(cal, t);
  if (current) {
    if (t > current.end) return { phase: 'playoffs', daysToStart: null, daysSinceEnd: null, progress: 1 };
    const progress = (t - current.start) / Math.max(1, current.end - current.start);
    const phase: SeasonPhase = progress < 0.15 ? 'early' : progress > 0.85 ? 'stretch' : 'mid';
    return { phase, daysToStart: null, daysSinceEnd: null, progress };
  }
  const daysToStart = (next.start - t) / DAY;
  const daysSinceEnd = prev ? (t - prev.post) / DAY : null;
  return { phase: 'offseason', daysToStart, daysSinceEnd, progress: null };
}

/** Log-drift per day for `sport` at time `t`. */
export function seasonalDrift(sport: Sport, t: number, profile: SeasonProfile = DEFAULT_SEASON_PROFILE): number {
  const p = seasonPhase(sport, t);
  switch (p.phase) {
    case 'year-round': return 0;
    case 'early': return profile.earlyPerDay;
    case 'mid': return profile.midPerDay;
    case 'stretch': return profile.stretchPerDay;
    case 'playoffs': return profile.playoffsPerDay;
    case 'offseason': {
      if (p.daysToStart != null && p.daysToStart <= profile.rampWindowDays) {
        // ramps up as the start nears: 0 at the window edge → full rampPerDay at kickoff
        return profile.rampPerDay * (1 - p.daysToStart / profile.rampWindowDays) * 1.6;
      }
      if (p.daysSinceEnd != null && p.daysSinceEnd <= profile.postDecayDays) return profile.postDecayPerDay;
      return profile.offseasonPerDay;
    }
    default:
      return 0; // 'ramp' / 'post-decay' are labels for UI only; seasonPhase() reports them as 'offseason'
  }
}

/** True when `t`'s UTC day is the first day of a new regular season (ratings refresh). */
export function isSeasonStartDay(sport: Sport, t: number): boolean {
  const cal = SEASON_CAL[sport];
  if (cal.yearRound) return false;
  const d = new Date(t);
  return d.getUTCMonth() + 1 === cal.start[0] && d.getUTCDate() === cal.start[1];
}
