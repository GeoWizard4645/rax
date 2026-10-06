/**
 * On-This-Day (OTD) engine — Tab 4.
 *
 * A past-season ("retired") card pays out each year on the anniversary of each of its
 * historical games. Final Yield = baseRax × Sport Multiplier × Card Tier Multiplier.
 * Only the top 2 historical performances per sport per day can be claimed.
 */
import type { HistoricalGame, Rarity, Sport } from '../src/types/real';
import { DEFAULT_SPORT_MULT, RARITY_MULT, median, sum } from './formulas';

export const CLAIMS_PER_SPORT_PER_DAY = 2;
export const ASSUMED_BASE_RAX_PER_RATING = 10;

export interface OwnedCard {
  playerName: string;
  sport: Sport;
  /** Season of the historical card, e.g. "2019". */
  season: string;
  rarity: Rarity;
}

export type SportMult = Record<Sport, number>;

export const monthDay = (isoDate: string) => isoDate.slice(5, 10);

export const toMonthDay = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** Identifies one historical card (a player in a given season). */
export const cardId = (g: { sport: string; playerName: string; season: string }) =>
  `${g.sport}|${g.playerName}|${g.season}`;

const lower = (s: string) => s.trim().toLowerCase();

export function gameYield(g: HistoricalGame, rarity: Rarity, sportMult: SportMult = DEFAULT_SPORT_MULT): number {
  return g.baseRax * (sportMult[g.sport] ?? 1) * RARITY_MULT[rarity];
}

export interface ClaimRow {
  card: OwnedCard;
  game: HistoricalGame;
  yieldRax: number;
  /** Among the top 2 for this sport today — worth claiming. */
  claim: boolean;
  rank: number;
}

export interface DailyPlan {
  monthDay: string;
  bySport: Partial<Record<Sport, ClaimRow[]>>;
  /** Total of the claimable (top-2-per-sport) rows. */
  claimableTotal: number;
  /** Total of rows that would be wasted because they fall outside the top 2. */
  leftOnTable: number;
}

/** Find the games for an owned card that fall on `md` (MM-DD). */
function gamesFor(card: OwnedCard, games: HistoricalGame[], md: string) {
  return games.filter(
    (g) =>
      g.sport === card.sport &&
      g.season === card.season &&
      lower(g.playerName) === lower(card.playerName) &&
      monthDay(g.date) === md,
  );
}

/** 2-Claim Daily Optimizer: today's payout per owned card, top 2 per sport flagged. */
export function planDay(owned: OwnedCard[], games: HistoricalGame[], md: string, sportMult: SportMult = DEFAULT_SPORT_MULT): DailyPlan {
  const rows: ClaimRow[] = [];
  for (const card of owned) {
    for (const game of gamesFor(card, games, md)) {
      rows.push({ card, game, yieldRax: gameYield(game, card.rarity, sportMult), claim: false, rank: 0 });
    }
  }
  const bySport: DailyPlan['bySport'] = {};
  for (const r of rows) (bySport[r.card.sport] ||= []).push(r);
  let claimableTotal = 0;
  let leftOnTable = 0;
  for (const list of Object.values(bySport)) {
    list!.sort((a, b) => b.yieldRax - a.yieldRax);
    list!.forEach((r, i) => {
      r.rank = i + 1;
      r.claim = i < CLAIMS_PER_SPORT_PER_DAY;
      if (r.claim) claimableTotal += r.yieldRax;
      else leftOnTable += r.yieldRax;
    });
  }
  return { monthDay: md, bySport, claimableTotal, leftOnTable };
}

export interface CardRoi {
  id: string;
  playerName: string;
  sport: Sport;
  season: string;
  team: string;
  games: number;
  /** Anniversaries still to come this calendar year. */
  remainingGames: number;
  /** Expected Remaining Yield = Σ upcoming anniversary yields × rarity multiplier. */
  remainingYield: number;
  /** Total yield across a full year of anniversaries. */
  annualYield: number;
  maxGame: number;
  medianGame: number;
}

/** Group a games list into per-card ROI stats at a given rarity, as of `md`. */
export function cardRoi(games: HistoricalGame[], rarity: Rarity, md: string, sportMult: SportMult = DEFAULT_SPORT_MULT): CardRoi[] {
  const groups = new Map<string, HistoricalGame[]>();
  for (const g of games) {
    const id = cardId(g);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(g);
  }
  return [...groups.entries()].map(([id, gs]) => {
    const ys = gs.map((g) => gameYield(g, rarity, sportMult));
    const upcoming = gs.filter((g) => monthDay(g.date) > md);
    return {
      id,
      playerName: gs[0].playerName,
      sport: gs[0].sport,
      season: gs[0].season,
      team: gs[0].team,
      games: gs.length,
      remainingGames: upcoming.length,
      remainingYield: sum(upcoming.map((g) => gameYield(g, rarity, sportMult))),
      annualYield: sum(ys),
      maxGame: ys.length ? Math.max(...ys) : 0,
      medianGame: median(ys),
    };
  });
}

/** Days to Break Even = Purchase Price / (Annual Expected OTD Yield / 365). */
export function breakEvenDays(price: number, annualYield: number): number {
  if (!(annualYield > 0) || !(price >= 0)) return Infinity;
  return price / (annualYield / 365);
}

export interface Comparison {
  a: CardRoi;
  b: CardRoi;
  winners: { games: 'a' | 'b' | 'tie'; median: 'a' | 'b' | 'tie'; ceiling: 'a' | 'b' | 'tie'; annual: 'a' | 'b' | 'tie' };
}

const pick = (x: number, y: number): 'a' | 'b' | 'tie' => (x === y ? 'tie' : x > y ? 'a' : 'b');

export function compareCards(a: CardRoi, b: CardRoi): Comparison {
  return {
    a,
    b,
    winners: {
      games: pick(a.games, b.games),
      median: pick(a.medianGame, b.medianGame),
      ceiling: pick(a.maxGame, b.maxGame),
      annual: pick(a.annualYield, b.annualYield),
    },
  };
}

/* ------------------------------ import ------------------------------ */

export interface ImportResult {
  games: HistoricalGame[];
  errors: string[];
  /** True when baseRax was missing and derived from rating × ASSUMED_BASE_RAX_PER_RATING. */
  derivedBase: boolean;
}

const VALID_SPORTS = new Set(['NFL', 'NBA', 'MLB', 'NHL', 'CBB', 'CFB', 'PGA', 'UFC']);

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse a CSV (header row: player,sport,team,season,date,rating,baseRax) or a JSON array of
 * the same fields into HistoricalGame[]. Bad rows are reported, not silently dropped.
 */
export function parseGamesInput(text: string): ImportResult {
  const errors: string[] = [];
  let derivedBase = false;
  let rawRows: Array<Record<string, unknown>> = [];
  const trimmed = text.trim();
  if (!trimmed) return { games: [], errors: ['Nothing to import.'], derivedBase };

  if (trimmed.startsWith('[')) {
    try {
      rawRows = JSON.parse(trimmed);
    } catch (e) {
      return { games: [], errors: [`Invalid JSON: ${(e as Error).message}`], derivedBase };
    }
  } else {
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
    const col = (names: string[]) => header.findIndex((h) => names.includes(h));
    const idx = {
      player: col(['player', 'playername', 'name']),
      sport: col(['sport', 'league']),
      team: col(['team']),
      season: col(['season', 'year']),
      date: col(['date', 'gamedate']),
      rating: col(['rating', 'gamerating', 'grade']),
      baseRax: col(['baserax', 'rax', 'payout', 'baseraxpayout']),
    };
    for (const k of ['player', 'sport', 'date', 'rating'] as const) {
      if (idx[k] < 0) return { games: [], errors: [`Missing required column "${k}".`], derivedBase };
    }
    for (const line of lines.slice(1)) {
      const c = splitCsvLine(line);
      rawRows.push({
        player: c[idx.player],
        sport: c[idx.sport],
        team: idx.team >= 0 ? c[idx.team] : '',
        season: idx.season >= 0 ? c[idx.season] : undefined,
        date: c[idx.date],
        rating: c[idx.rating],
        baseRax: idx.baseRax >= 0 ? c[idx.baseRax] : undefined,
      });
    }
  }

  const games: HistoricalGame[] = [];
  rawRows.forEach((r, i) => {
    const row = i + 1;
    const player = String(r.player ?? r.playerName ?? '').trim();
    const sport = String(r.sport ?? '').trim().toUpperCase();
    const date = String(r.date ?? '').trim();
    const rating = Number(r.rating);
    if (!player) return void errors.push(`Row ${row}: missing player.`);
    if (!VALID_SPORTS.has(sport)) return void errors.push(`Row ${row}: unknown sport "${sport}".`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return void errors.push(`Row ${row}: date must be YYYY-MM-DD.`);
    if (!Number.isFinite(rating) || rating < 0 || rating > 10) return void errors.push(`Row ${row}: rating must be 0–10.`);
    let baseRax = Number(r.baseRax);
    if (r.baseRax === undefined || r.baseRax === '' || !Number.isFinite(baseRax)) {
      baseRax = Math.round(rating * ASSUMED_BASE_RAX_PER_RATING);
      derivedBase = true;
    }
    const season = String(r.season ?? date.slice(0, 4)).trim() || date.slice(0, 4);
    games.push({
      id: `${sport}-${player}-${date}`.replace(/\s+/g, '_'),
      playerId: player.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      playerName: player,
      sport: sport as Sport,
      team: String(r.team ?? '').trim(),
      season,
      date,
      rating,
      baseRax,
    });
  });
  return { games, errors, derivedBase };
}
