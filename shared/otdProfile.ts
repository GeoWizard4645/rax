/**
 * Profile helpers for Tab 7/8: turn "what a user owns" into owned OTD cards at known levels.
 *
 * Two sources, with very different precision:
 *  - **Passes list (exact)** — lines "Player, Sport, Season, Level" (what Real's app / RaxEdge show per pass).
 *  - **Username pull (approximate)** — Rateboard's collection pull returns, per PLAYER, the cards owned and their summed
 *    rating (`totalValue`) across every season; it does not say which season a rating sits on. So it can say who you
 *    hold and how much rating you have, but not each pass's level.
 */
import { RARITY_LADDER, ICONIC_LEVELS, rungForRating } from './otdRules';
import type { OtdCardRecord, OtdSport } from './otdSnapshot';
import { norm } from './rateboard';
import type { CollectionPlayer } from '../src/types/real';

export const SPORT_ALIASES: Record<string, OtdSport> = {
  nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', cbb: 'CBB', ncaam: 'CBB', ncaab: 'CBB', cfb: 'CFB', ncaaf: 'CFB',
  pga: 'PGA', golf: 'PGA', wnba: 'WNBA', soc: 'SOC', soccer: 'SOC', fc: 'SOC',
};

const RUNG_KEYS = [...RARITY_LADDER.map((r) => r.key), ...ICONIC_LEVELS.map((l) => l.key)];

/** "mystic 3" / "Iconic" / "legendary" / "Epic" → a ladder key, or null. */
export function parseLevel(text: string): string | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const direct = RUNG_KEYS.find((k) => k.toLowerCase() === t);
  if (direct) return direct === 'General' ? null : direct;
  const withOne = RUNG_KEYS.find((k) => k.toLowerCase() === `${t} 1`);
  if (withOne) return withOne === 'Iconic 1' ? 'Iconic' : withOne;
  if (t === 'iconic 1') return 'Iconic';
  return null;
}

/** Does a season text like "24-25", "2024-25", "2025" refer to this card? */
function seasonMatches(card: OtdCardRecord, text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (t === card.seasonLabel) return true;
  const m = /^(\d{4})\s*[-/]\s*(\d{2,4})$/.exec(t);
  if (m) return `${m[1].slice(2)}-${m[2].slice(-2)}` === card.seasonLabel;
  return /^\d{4}$/.test(t) && String(card.season) === t;
}

export interface ParsedPasses {
  /** card id → ladder key */
  owned: Record<string, string>;
  errors: string[];
}

/** Parse lines "Player, Sport, Season, Level" against the snapshot's cards. Unmatched lines are reported, not dropped silently. */
export function parsePasses(text: string, cards: OtdCardRecord[]): ParsedPasses {
  const owned: Record<string, string> = {};
  const errors: string[] = [];
  const by = new Map<string, OtdCardRecord[]>();
  for (const c of cards) {
    const k = `${c.sport}|${norm(c.name)}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(c);
  }
  text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line, i) => {
    const [name, sportTxt, seasonTxt, levelTxt] = line.split(/\s*[,\t]\s*/);
    const sport = SPORT_ALIASES[(sportTxt ?? '').toLowerCase()];
    const level = parseLevel(levelTxt ?? '');
    if (!name || !sport || seasonTxt === undefined || !level) return void errors.push(`Line ${i + 1}: expected "Player, Sport, Season, Level" (e.g. Saquon Barkley, NFL, 24-25, Mystic 3).`);
    const hit = (by.get(`${sport}|${norm(name)}`) ?? []).find((c) => seasonMatches(c, seasonTxt));
    if (!hit) return void errors.push(`Line ${i + 1}: no ${sport} card for "${name}" ${seasonTxt} in this dataset (only top cards are included).`);
    owned[hit.id] = level;
  });
  return { owned, errors };
}

export interface HeldPlayer {
  name: string;
  sport: OtdSport;
  cards: number;
  /** Summed rating across ALL seasons of this player (Rateboard's `totalValue`). */
  heldRating: number;
  /** The rung that rating would buy IF it all sat on one season (an upper bound). */
  rungIfConcentrated: string;
  /** The player's season cards in the dataset, best annual first. */
  seasons: OtdCardRecord[];
}

/** Match a pulled collection against the dataset. Players with no card in the dataset are returned separately. */
export function matchCollection(players: CollectionPlayer[], sport: OtdSport, cards: OtdCardRecord[]): { held: HeldPlayer[]; unmatched: CollectionPlayer[] } {
  const by = new Map<string, OtdCardRecord[]>();
  for (const c of cards) if (c.sport === sport) (by.get(norm(c.name)) ?? by.set(norm(c.name), []).get(norm(c.name))!).push(c);
  const held: HeldPlayer[] = [];
  const unmatched: CollectionPlayer[] = [];
  for (const p of players) {
    const seasons = (by.get(norm(p.name)) ?? []).sort((a, b) => b.annual - a.annual);
    if (!seasons.length) { unmatched.push(p); continue; }
    held.push({ name: p.name, sport, cards: p.total, heldRating: p.totalValue, rungIfConcentrated: rungForRating(p.totalValue), seasons });
  }
  return { held: held.sort((a, b) => b.heldRating - a.heldRating), unmatched };
}
