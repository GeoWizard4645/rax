/**
 * Optional Tab 3 panel: what a rating point costs through Player packs (RaxEdge's pack odds) next to what Rateboard buyers
 * offer per rating point for the same player. Both are per-rating-point, in Rax, so they can sit side by side.
 *
 *   pack cost per rating  = packPrice / (cardsPerPack × avgCardValue)      (shared/raxedgePackOdds.ts uses the same formula)
 *   bid                   = best standing buy offer on Rateboard (Rax per rating point)
 *
 * What it is NOT: advice, or a sale price. Pack pulls are random (small samples are flagged), the pack price is an assumption
 * (editable), bids are standing offers that may be stale, and marketplace fees / resale are ignored. Rows are only produced
 * for players that have BOTH a Rateboard bid and a pack-odds row; a player-season with no pack row simply has no panel row.
 */
import type { PackRow } from './raxedgeBridge';
import { DEFAULT_PRICE_PARAMS } from './otdPricing';
import { PLAYER_PACK_CARDS } from './raxedgePackOdds';
import { norm, type RbSport } from './rateboard';
import type { RbAgg } from './rbHistory';

export const DEFAULT_PACK_PRICE = DEFAULT_PRICE_PARAMS.pack.playerPackPrice.value;
/** Pulls below this are flagged as a thin sample. */
export const THIN_SAMPLE = 5;

/** Rateboard sport → the sport key RaxEdge's pack odds use (RaxEdge calls college football "ncaaf"). */
export const RB_TO_PACK_SPORT: Record<RbSport, string> = { NFL: 'nfl', CFB: 'ncaaf', NHL: 'nhl', UFC: 'ufc', FC: 'fc' };

export interface PackSeasonCost {
  season: string;
  avgCardValue: number;
  sample: number;
  /** Rax per rating point through a Player pack. */
  cost: number;
  thin: boolean;
}

export interface PackVsBidRow {
  key: string;
  player: string;
  sport: RbSport;
  /** Best standing Rateboard bid, Rax per rating point. */
  bid: number;
  buyers: number;
  seasons: PackSeasonCost[];
  /** The cheapest pack season (lowest cost per rating). */
  cheapest: PackSeasonCost;
  /** bid − cheapest.cost: positive = buyers offer more per point than a pack costs to pull. */
  spread: number;
}

export function packVsBids(aggs: RbAgg[], rows: PackRow[] | null | undefined, packPrice = DEFAULT_PACK_PRICE, cards = PLAYER_PACK_CARDS): PackVsBidRow[] {
  if (!rows?.length || !(packPrice > 0)) return [];
  const bySportName = new Map<string, PackSeasonCost[]>();
  for (const r of rows) {
    if (!Array.isArray(r) || !(r[5] > 0)) continue;
    const k = `${String(r[0]).toLowerCase()}|${norm(String(r[3]))}`;
    const list = bySportName.get(k) ?? [];
    list.push({ season: String(r[1]), avgCardValue: r[5], sample: r[6] ?? 0, cost: packPrice / (cards * r[5]), thin: (r[6] ?? 0) < THIN_SAMPLE });
    bySportName.set(k, list);
  }
  const out: PackVsBidRow[] = [];
  for (const a of aggs) {
    if (!(a.best > 0)) continue;
    const seasons = bySportName.get(`${RB_TO_PACK_SPORT[a.sport]}|${norm(a.name)}`);
    if (!seasons?.length) continue;
    const sorted = [...seasons].sort((x, y) => x.cost - y.cost);
    out.push({ key: a.key, player: a.name, sport: a.sport, bid: a.best, buyers: a.buyers, seasons: sorted, cheapest: sorted[0], spread: a.best - sorted[0].cost });
  }
  return out.sort((x, y) => y.spread - x.spread);
}
