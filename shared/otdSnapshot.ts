/**
 * Data contract for Tab 7 (OTD Efficiency).
 *
 * Both methods — "observed" (Real's own per-game Rax, via Rateboard's /api/rax) and "modeled" (our reverse-engineered
 * rating model applied to free ESPN stats) — produce the SAME snapshot shape so the UI can swap between them.
 *
 * Units: `rax` is the per-claim payout of a card at **General** level ("Earnings at General" in Real's community lists).
 * A card's real payout = rax × rarity multiplier (Iconic = 150×; see shared/otdRules.ts). `annual` = Σ rax over the
 * card's whole season of games (what Dennis's lists call "Earnings at General").
 */

/** Sports with per-game OTD data. UFC is intentionally absent (no data source; low priority per community guides). */
export type OtdSport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'CBB' | 'CFB' | 'PGA' | 'WNBA' | 'SOC' | 'UFC';

export const OTD_SPORTS: OtdSport[] = ['NFL', 'NBA', 'MLB', 'NHL', 'CBB', 'CFB', 'PGA', 'WNBA', 'SOC', 'UFC'];

/** Rateboard /api/rax sport key ↔ OtdSport. */
export const RAX_KEY_TO_OTD: Record<string, OtdSport> = {
  nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', ncaam: 'CBB', ncaaf: 'CFB', golf: 'PGA', wnba: 'WNBA', soccer: 'SOC',
};  // (UFC has no Rateboard rax feed; UFC cards only arrive through a RaxEdge import)
export const OTD_TO_RAX_KEY: Record<OtdSport, string> = {
  ...(Object.fromEntries(Object.entries(RAX_KEY_TO_OTD).map(([k, v]) => [v, k])) as Record<string, string>),
  UFC: 'ufc',
} as Record<OtdSport, string>;

/** Bit flags on a day entry. */
export const DAY_POSTSEASON = 1;
export const DAY_OTHER = 2; // all-star / exhibition / etc.

/**
 * One anniversary claim: [mmdd, rax, flags].
 * `mmdd` = month*100 + day (e.g. Nov 4 → 1104). `rax` = General-level payout of that game.
 */
export type OtdDay = [mmdd: number, rax: number, flags: number];

export interface OtdCardRecord {
  /** `${sport}|${season}|${playerId}` */
  id: string;
  sport: OtdSport;
  /** Rax's season label: starting year for NFL/NHL/CFB, ending year for NBA/CBB/WNBA-style, calendar year for MLB/golf/soccer. */
  season: number;
  /** Human label as the community writes it: "23-24" or "2025". */
  seasonLabel: string;
  playerId: string;
  name: string;
  team: string;
  /** Owners of this player on Real (observed only; null when unknown). */
  owners: number | null;
  games: number;
  /** Σ rax over ALL games of the season (General level). ×150 = Iconic. */
  annual: number;
  /** Best single game. */
  best: number;
  /**
   * Cards that don't follow the player rarity ladder (team cards, UFC fighters — imported from RaxEdge) carry their own
   * multiplier and cap; the optimizer uses these instead of a ladder rung.
   */
  fixed?: { multiplier: number; annualCap: number | null; label: string };
  kind?: 'player' | 'team' | 'fighter';
  /**
   * Claimable anniversaries, one per game, sorted by mmdd. May be truncated to games with rax ≥ `minDayRax`
   * (see snapshot) — `annual` still includes the dropped small games.
   */
  days: OtdDay[];
}

export interface OtdCoverage {
  sport: OtdSport;
  seasons: number[];
  cards: number;
  note?: string;
}

export interface OtdSnapshot {
  version: 1;
  method: 'observed' | 'modeled';
  generatedAt: string;
  /** Where the numbers came from, shown in the UI. */
  source: string;
  /** Games below this General-level rax were dropped from `days` to keep the file small. */
  minDayRax: number;
  coverage: OtdCoverage[];
  cards: OtdCardRecord[];
}

export const mmdd = (month: number, day: number) => month * 100 + day;
export const mmddFromIso = (iso: string) => Number(iso.slice(5, 7)) * 100 + Number(iso.slice(8, 10));
export const mmddToLabel = (v: number) => `${String(Math.floor(v / 100)).padStart(2, '0')}-${String(v % 100).padStart(2, '0')}`;

/** Season label the way the community writes it. */
export function seasonLabelFor(sport: OtdSport, season: number): string {
  switch (sport) {
    case 'NFL':
    case 'NHL':
    case 'CFB':
      return `${String(season).slice(2)}-${String(season + 1).slice(2)}`;
    case 'NBA':
    case 'CBB':
      return `${String(season - 1).slice(2)}-${String(season).slice(2)}`;
    default:
      return String(season);
  }
}

/**
 * Calendar year in which a game of this card's season was actually played, from the season label and the game's month.
 * Needed because OTD pays on the ANNIVERSARY of a game: a game played in 2026 can't pay until 2027.
 * Label conventions (Rax / RaxEdge): NFL/NHL/CFB/soccer = start year; NBA/CBB = end year; MLB/golf/WNBA/UFC = the year.
 */
export function gameYear(sport: OtdSport, season: number, mmddValue: number): number {
  const month = Math.floor(mmddValue / 100);
  switch (sport) {
    case 'NFL':
    case 'NHL':
    case 'CFB':
    case 'SOC':
      return month >= 7 ? season : season + 1;
    case 'NBA':
    case 'CBB':
      return month >= 8 ? season - 1 : season;
    default:
      return season;
  }
}
