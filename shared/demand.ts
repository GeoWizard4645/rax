/**
 * Live demand view built from Rateboard's public board (offers, floors, house list, keep list).
 * Pure — the board itself is fetched through /api/proxy/rateboard. Rateboard owns the data.
 *
 * This is Rateboard *offer* demand (the rate per rating point buyers say they'll pay), not Real auction prices.
 */
import { median } from './formulas';
import { houseFor, minimumFor, norm, samePlayer, type RbBoard, type RbSport } from './rateboard';

const DAY = 86_400_000;

export interface DemandRow {
  key: string;
  sport: RbSport;
  player: string;
  buyers: number;
  best: number;
  median: number;
  /** Rateboard's minimum rate for this player, when it has one. */
  floor: number | null;
  /** Position on the keep list (1 = most wanted), when listed. */
  keepRank: number | null;
  /** The house buyer's standing rate, when the player is on that list. */
  house: number | null;
  /** Offers placed in the last 24h / 7d. */
  new24h: number;
  new7d: number;
  lastTs: number;
}

export interface DemandDay {
  /** UTC day start, ms. */
  t: number;
  offers: number;
}

export interface DemandSummary {
  rows: DemandRow[];
  liveOffers: number;
  buyers: number;
  new24h: number;
  new7d: number;
  /** New offers per UTC day, oldest first, ending today. */
  days: DemandDay[];
}

/** Roll the board's live (non-banned) offers up per player, hottest first (7d activity, then best rate). */
export function buildDemand(board: RbBoard, sport: RbSport | 'ALL', now: number, dayCount = 14): DemandSummary {
  const live = board.offers.filter((o) => (sport === 'ALL' || o.sport === sport) && !board.users[o.user]?.banned);

  const groups = new Map<string, typeof live>();
  for (const o of live) {
    const k = `${o.sport}|${norm(o.player)}`;
    const g = groups.get(k);
    if (g) g.push(o);
    else groups.set(k, [o]);
  }

  const rows: DemandRow[] = [];
  for (const [key, offers] of groups) {
    const { sport: sp, player } = offers[0];
    const rates = offers.map((o) => o.rate);
    const keep = board.keeplist.find((x) => x.sport === sp && samePlayer(x.player, player));
    rows.push({
      key,
      sport: sp,
      player,
      buyers: new Set(offers.map((o) => o.user)).size,
      best: Math.max(...rates),
      median: median(rates),
      floor: minimumFor(board, sp, player)?.rate ?? null,
      keepRank: keep?.rank ?? null,
      house: houseFor(board, sp, player)?.rate ?? null,
      new24h: offers.filter((o) => now - o.ts < DAY).length,
      new7d: offers.filter((o) => now - o.ts < 7 * DAY).length,
      lastTs: Math.max(...offers.map((o) => o.ts)),
    });
  }
  rows.sort((a, b) => b.new7d - a.new7d || b.best - a.best || a.player.localeCompare(b.player));

  const today = Math.floor(now / DAY) * DAY;
  const days: DemandDay[] = Array.from({ length: dayCount }, (_, i) => ({ t: today - (dayCount - 1 - i) * DAY, offers: 0 }));
  for (const o of live) {
    const idx = dayCount - 1 - Math.floor((today + DAY - 1 - o.ts) / DAY);
    if (idx >= 0 && idx < dayCount) days[idx].offers++;
  }

  return {
    rows,
    liveOffers: live.length,
    buyers: new Set(live.map((o) => o.user)).size,
    new24h: live.filter((o) => now - o.ts < DAY).length,
    new7d: live.filter((o) => now - o.ts < 7 * DAY).length,
    days,
  };
}
