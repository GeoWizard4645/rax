/**
 * Data contract for Tab 9 (Edge / EV): normalised betting-market odds from FREE public sources, plus the pure maths
 * that turns them into a no-vig "fair" probability and an expected value against Real's own market.
 *
 * Sources (all free, no API key, read-only): Kalshi's public market-data API, Polymarket's public Gamma/CLOB API, and
 * the DraftKings lines ESPN embeds in its public scoreboard JSON. FanDuel has no public API and is NOT used.
 */

export type OddsSource = 'kalshi' | 'polymarket' | 'espn-dk';
export type OddsSport = 'NBA' | 'NHL' | 'MLB' | 'WNBA' | 'NFL' | 'CFB' | 'CBB' | 'FC' | 'UFC';
export type MarketType = 'moneyline' | 'spread' | 'total';

export const ODDS_SOURCE_LABEL: Record<OddsSource, string> = { kalshi: 'Kalshi', polymarket: 'Polymarket', 'espn-dk': 'DraftKings (via ESPN)' };

/** One side of a two-way market. `side` is 'home' | 'away' for moneyline/spread and 'over' | 'under' for totals. */
export interface OddsOutcome {
  side: 'home' | 'away' | 'over' | 'under';
  /** Display name: team name, or "Over 7.5". */
  name: string;
  /**
   * Implied probability of THIS source's quoted price for the side, vig NOT removed (0–1).
   * Exchanges (Kalshi, Polymarket): the mid/last price of the YES contract. Sportsbooks: from the American odds.
   */
  implied: number;
  /** American odds as quoted (sportsbooks) or derived from `implied` (exchanges). */
  american: number | null;
}

export interface OddsMarket {
  source: OddsSource;
  type: MarketType;
  /** Spread (home team's line, e.g. -4.5) or total points; null for moneyline. */
  line: number | null;
  /** Always exactly two outcomes; for moneyline: [home, away]; for totals: [over, under]. */
  outcomes: [OddsOutcome, OddsOutcome];
  /** ISO timestamp of the quote. */
  updatedAt: string;
  /** Contracts traded / USD volume where the source reports it; null otherwise. Used to weight consensus. */
  volume: number | null;
  /** Deep link to the market on the source. */
  url: string | null;
  /**
   * Optional extras (additive to the original contract). 3-way (soccer) moneyline only: the draw outcome. When present,
   * `outcomes[0..1]` are home/away and the three implied probabilities are normalised together (see oddsConsensus).
   */
  draw?: { implied: number; american: number | null } | null;
  /** Exchanges: bid/ask width of outcome[0]'s quote in probability units (0.02 = 2c). Null/absent = unknown or a book. */
  width?: number | null;
  /** Exchanges: top-of-book depth in contracts (Kalshi) or the book's reported liquidity in USD (Polymarket). */
  liquidity?: number | null;
}

export interface OddsEvent {
  /** Stable id built by the matcher: `${sport}|${startDate}|${normHome}|${normAway}`. */
  id: string;
  sport: OddsSport;
  league: string;
  home: string;
  away: string;
  /** ISO start time. */
  startsAt: string;
  status: 'scheduled' | 'live' | 'final';
  /** Additive: true when no source gave an exact kick-off (Kalshi-only college/soccer/UFC games) so `startsAt` is only the right DAY. */
  startApprox?: boolean;
  markets: OddsMarket[];
}

export interface OddsSourceStatus {
  source: OddsSource;
  ok: boolean;
  /** Events/markets this source contributed. */
  count: number;
  error?: string;
}

export interface OddsResponse {
  generatedAt: string;
  sport: OddsSport | 'ALL';
  events: OddsEvent[];
  sources: OddsSourceStatus[];
  /** Optional diagnostics (additive): upstream subrequests made, and how many planned calls were dropped to stay in budget. */
  meta?: { subrequests: number; trimmed: number; windowDays: number; /** true when Kalshi/Polymarket spreads & totals were skipped (ALL or ?markets=ml). */ lite?: boolean };
}

/* ------------------------------------------------------------------ */
/* Maths                                                               */
/* ------------------------------------------------------------------ */

/** American odds → implied probability (vig included). */
export function americanToImplied(a: number): number {
  if (!Number.isFinite(a) || a === 0) return NaN;
  return a < 0 ? -a / (-a + 100) : 100 / (a + 100);
}

/** Probability → American odds. */
export function impliedToAmerican(p: number): number | null {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? Math.round((-100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

/** Proportional (multiplicative) de-vig of a two-way market → fair probabilities for [a, b]. */
export function devig2(a: number, b: number): [number, number] {
  const s = a + b;
  return s > 0 ? [a / s, b / s] : [NaN, NaN];
}

/** Overround of a two-way market (1.0 = no vig). */
export const overround = (m: Pick<OddsMarket, 'outcomes'>): number => m.outcomes[0].implied + m.outcomes[1].implied;

/** Fair probability of outcome 0 of a market (vig removed). */
export const fairProb0 = (m: Pick<OddsMarket, 'outcomes'>): number => devig2(m.outcomes[0].implied, m.outcomes[1].implied)[0];


/* ------------------------------------------------------------------ */
/* Additive helpers (Tab 9 data layer)                                 */
/* ------------------------------------------------------------------ */

export const ODDS_SPORTS: OddsSport[] = ['NBA', 'NHL', 'MLB', 'WNBA', 'NFL', 'CFB', 'CBB', 'FC', 'UFC'];

/** Fair 2-way probabilities by the power method (solves a^k + b^k = 1). Corrects favourite-longshot bias better than proportional. */
export function devig2Power(a: number, b: number): [number, number] {
  if (!(a > 0 && b > 0)) return [NaN, NaN];
  if (a + b <= 1) return devig2(a, b);
  let lo = 1;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (a ** k + b ** k > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  return [a ** k, b ** k];
}

/** Proportional de-vig of an n-way market (n ≥ 2). */
export function devigN(ps: number[]): number[] {
  const s = ps.reduce((x, y) => x + y, 0);
  return s > 0 ? ps.map((p) => p / s) : ps.map(() => NaN);
}
