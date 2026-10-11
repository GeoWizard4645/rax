/**
 * Per-player cost of rating from RaxEdge's pack odds (OPT-IN; Tab 7's "Price rating per player from RaxEdge pack odds").
 *
 * WHY
 * A card's level comes from the SUMMED RATING of the play cards you own for a player-season (shared/otdRules.ts ladder).
 * The base model prices every player at ONE global Rax-per-rating rate (default 10, Rateboard's median bid). Buying rating
 * through a Player pack, though, costs  packPrice / (cardsPerPack x avgCardValue)  Rax per rating point, and avgCardValue
 * (the average rating of a play card pulled from THAT player's pack) varies a lot: Barkley 2023 = 3.73 -> ~24 Rax/rating,
 * Stafford 2025 = 8.54 -> ~10.6. RaxEdge's /api/real/pack-odds publishes avgCardValue, the sample size (`total`) and the
 * tier mix per player-season; the user brings it in with the RaxEdge export (shared/raxedgeBridge.ts, `packOdds`).
 *
 * FORMULA (packRateFor)
 *   raw    = packPrice / (cardsPerPack x avgCardValue)                  "what a rating point costs through packs"
 *   weight = min(1, total / minSample)                                  trust in the sample (0 pulls -> 0, >= minSample -> 1)
 *   blend  = weight x raw + (1 - weight) x globalRate                   small samples are shrunk toward the global rate
 *   rate   = clamp(blend, floor, ceiling)
 *            floor   = min(RATEBOARD_FLOOR = 8, globalRate)   Rateboard's lowest standing-offer tier: nobody sells rating below it,
 *                                                             and an inflated avgCardValue from a few lucky pulls must not make a card look free
 *            ceiling = 6 x globalRate                         a handful of low pulls must not price a card absurdly; at the default
 *                                                             10 that is 60, beyond Rateboard's p90 (25-30) and star offers
 *   The clamp is reported in `basis` when it bites.
 *   Linear (rather than total/(total+k)) shrinkage is used so that "enough pulls" is a clear, user-visible threshold and the
 *   blend is continuous at it. Shrinkage is applied to the RATE, not to avgCardValue; the clamp covers the convexity that causes.
 *
 * ASSUMPTIONS (also stated in the UI)
 *  - Pack price defaults to DEFAULT_PRICE_PARAMS.pack.playerPackPrice (271). Real's price runs 200-400 with the player's
 *    season rank, so the user can edit it; this is the single biggest driver of the result.
 *  - Every pulled play card is assumed to be KEPT (its rating counts toward the card's level). Resale of unwanted pulls is
 *    ignored in the rate; `packResaleView` is a separate, clearly-labelled estimate used only by the swap calculator.
 *  - Booster cards are ignored (they carry no rating toward the ladder).
 *  - The rate is a cost per rating point on average; actual pulls are random (sample sizes are small for many players).
 *
 * MATCHING
 * Rows are indexed by sport + season + normalised name (`norm` from shared/rateboard.ts: accents, punctuation and Jr/Sr/II-IV
 * suffixes dropped). Rax's season number equals RaxEdge's `season` for NFL/CFB (the starting year). Sports we have no
 * explicit mapping for pass through lower-cased, so a sport RaxEdge adds later (nba, mlb, nhl, wnba ...) starts matching as
 * soon as the season numbering agrees; if it does not, that card simply has no pack data and keeps the global rate.
 */
import type { PackRow } from './raxedgeBridge';
import { DEFAULT_PRICE_PARAMS } from './otdPricing';
import { norm } from './rateboard';

/** OtdSport -> RaxEdge sport key. Anything not listed passes through lower-cased. */
export const RAXEDGE_SPORT_KEY: Record<string, string> = { NFL: 'nfl', CFB: 'ncaaf', CBB: 'ncaam', NBA: 'nba', MLB: 'mlb', NHL: 'nhl', WNBA: 'wnba' };
export const raxedgeSportKey = (sport: string): string => RAXEDGE_SPORT_KEY[sport] ?? String(sport).toLowerCase();

/** Rateboard's lowest standing-offer tier (Rax per rating); see docs/OTD-MARKET.md. */
export const RATEBOARD_FLOOR = 8;
/** Upper clamp as a multiple of the global rate. */
export const CEILING_MULT = 6;
export const DEFAULT_MIN_SAMPLE = 5;
export const PLAYER_PACK_CARDS = 3;

export interface PackStats {
  sport: string;
  season: string;
  id: string;
  name: string;
  position: string;
  /** Average rating of one play card pulled from this player's Player pack. */
  avgCardValue: number;
  /** avgCardValue x 3: the expected rating one Player pack adds. */
  expectedRatingPerPack: number;
  /** % of sampled cards by tier. */
  tierOdds: { epic: number; legendary: number; rare: number };
  /** Cards sampled (RaxEdge's `total`). */
  sample: number;
}

export function packStats(row: PackRow, cardsPerPack = PLAYER_PACK_CARDS): PackStats {
  const [sport, season, id, name, position, avg, total, epic, legendary, rare] = row;
  return {
    sport, season, id, name, position,
    avgCardValue: avg,
    expectedRatingPerPack: avg * cardsPerPack,
    tierOdds: { epic, legendary, rare },
    sample: total,
  };
}

export type PackIndex = Map<string, PackStats>;

export const packKey = (sport: string, season: number | string, name: string): string => `${raxedgeSportKey(sport)}|${season}|${norm(name)}`;

/** Index rows by sport|season|normalised name. Same key twice (e.g. two "Josh Allen"s): the larger sample wins. */
export function buildPackIndex(rows: PackRow[] | null | undefined): PackIndex {
  const idx: PackIndex = new Map();
  for (const r of rows ?? []) {
    if (!Array.isArray(r) || !(r[5] > 0)) continue;
    const st = packStats(r);
    const k = packKey(st.sport, st.season, st.name);
    const prev = idx.get(k);
    if (!prev || st.sample > prev.sample) idx.set(k, st);
  }
  return idx;
}

export interface PackCardRef { sport: string; season: number; name: string }

export const lookupPack = (index: PackIndex, card: PackCardRef): PackStats | null => index.get(packKey(card.sport, card.season, card.name)) ?? null;

export interface PackRateOptions {
  index: PackIndex;
  /** Rax per Player pack. Default: the pricing model's playerPackPrice. */
  packPrice?: number;
  /** The rate to shrink toward and to scale the clamp from (the card's effective global rate). */
  globalRate: number;
  /** Pulls needed to fully trust a row. Default 5. */
  minSample?: number;
  cardsPerPack?: number;
  /** Lower clamp before capping at globalRate. Default RATEBOARD_FLOOR. */
  floor?: number;
  /** Upper clamp as a multiple of globalRate. Default 6. */
  ceilingMult?: number;
}

export interface PackRate {
  /** Final Rax per rating point for this card. */
  rate: number;
  /** Unshrunk, unclamped packPrice / (cards x avg). */
  raw: number;
  /** Weight given to the pack figure (1 = fully trusted). */
  weight: number;
  clamped: 'floor' | 'ceiling' | null;
  confidence: 'high' | 'low';
  sample: number;
  avgCardValue: number;
  /** One line for the UI, e.g. "pack odds: 271 / (3 x 3.73 avg rating, 37 pulls) = 24.2 Rax/rating". */
  basis: string;
}

/** Per-card rate from pack odds, or null when the index has no row for this player-season. */
export function packRateFor(card: PackCardRef, opts: PackRateOptions): PackRate | null {
  const st = lookupPack(opts.index, card);
  if (!st) return null;
  const packPrice = opts.packPrice ?? DEFAULT_PRICE_PARAMS.pack.playerPackPrice.value;
  const n = opts.cardsPerPack ?? PLAYER_PACK_CARDS;
  const minSample = Math.max(1, opts.minSample ?? DEFAULT_MIN_SAMPLE);
  const g = opts.globalRate;
  const raw = packPrice / (n * st.avgCardValue);
  const weight = Math.min(1, Math.max(0, st.sample / minSample));
  const blend = weight * raw + (1 - weight) * g;
  const floor = Math.min(opts.floor ?? RATEBOARD_FLOOR, g);
  const ceil = (opts.ceilingMult ?? CEILING_MULT) * g;
  const rate = Math.min(ceil, Math.max(floor, blend));
  const clamped = rate > blend ? 'floor' : rate < blend ? 'ceiling' : null;
  const f1 = (x: number) => x.toFixed(1);
  let basis = `pack odds: ${Math.round(packPrice)} / (${n} x ${st.avgCardValue} avg rating, ${st.sample} pulls) = ${f1(raw)} Rax/rating`;
  if (weight < 1) basis += `; only ${st.sample} of ${minSample} pulls needed, so ${Math.round(weight * 100)}% pack + ${Math.round((1 - weight) * 100)}% global ${f1(g)} = ${f1(blend)}`;
  if (clamped === 'floor') basis += `; raised to the ${f1(floor)} floor (Rateboard's lowest bid)`;
  if (clamped === 'ceiling') basis += `; capped at ${CEILING_MULT}x the global rate (${f1(ceil)})`;
  return { rate, raw, weight, clamped, confidence: weight >= 1 ? 'high' : 'low', sample: st.sample, avgCardValue: st.avgCardValue, basis };
}

/** How many of `cards` have a pack row. */
export function coverage(index: PackIndex, cards: PackCardRef[]): { covered: number; total: number } {
  let covered = 0;
  for (const c of cards) if (lookupPack(index, c)) covered++;
  return { covered, total: cards.length };
}

/**
 * ESTIMATE ONLY (swap calculator): what you recover if you sell the pulled cards instead of keeping them, at a market rate
 * per rating point (a standing bid, not a sale price) minus the marketplace fee.
 *   recovered = expectedRatingPerPack x marketRate x (1 - fee);   netPackCost = packPrice - recovered
 *   netCostPerRating = netPackCost / expectedRatingPerPack  (= grossRate - marketRate x (1 - fee))
 * Read it as the spread you lose on a round trip, not as the cost of owning rating.
 */
export function packResaleView(st: PackStats, o: { packPrice: number; marketRate: number; fee: number }) {
  const grossRate = o.packPrice / st.expectedRatingPerPack;
  const recovered = st.expectedRatingPerPack * o.marketRate * (1 - o.fee);
  const netPackCost = o.packPrice - recovered;
  return { grossRate, recovered, netPackCost, netCostPerRating: netPackCost / st.expectedRatingPerPack };
}
