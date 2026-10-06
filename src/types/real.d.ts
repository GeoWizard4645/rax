// Domain types for Real App entities (cards, users, games).

export type Sport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'CBB' | 'CFB' | 'PGA' | 'UFC';

export type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mystic' | 'Iconic';

export interface Card {
  id: string;
  playerId: string;
  playerName: string;
  sport: Sport;
  season: string;
  rarity: Rarity;
  rating: number;
  multiplier: number;
  isHistorical: boolean;
}

/** A user's holding of one player as returned by Rateboard's collection pull. */
export interface CollectionPlayer {
  name: string;
  /** How many cards of this player the user owns. */
  total: number;
  /** Summed boost value across those cards. */
  totalValue: number;
}

export interface RealUserProfile {
  username: string;
  userId?: string;
  avatarUrl?: string | null;
  badges?: string[];
  karma?: number | null;
  raxBalance?: number | null;
  cardCount?: number | null;
}

/** One historical game performance — the unit of the On-This-Day (OTD) database. */
export interface HistoricalGame {
  id: string;
  playerId: string;
  playerName: string;
  sport: Sport;
  team: string;
  /** Season label, e.g. "2019". */
  season: string;
  /** ISO date (YYYY-MM-DD) of the original game. */
  date: string;
  /** Original game rating on the 1.0–10.0 performance scale. */
  rating: number;
  /** Base Rax payout of that performance (before sport and tier multipliers). */
  baseRax: number;
}

export interface LiveGame {
  id: string;
  sport: Sport;
  home: string;
  away: string;
  startsAt: string;
  status: 'scheduled' | 'live' | 'final';
}
