/**
 * Tab 2 on Rateboard data: standing BUY offers read as "bids".
 *
 * What is real: who offered (Rateboard account), for which player and sport, at what rate (Rax per rating point), when
 * they posted it and the link to their comment under the pinned post. What is NOT in the data and is therefore left
 * unknown, never invented: the card's rating and rarity, any auction clock, any sale or highest-bid history. The Rax
 * a seller would actually get is rating × rate, and the rating comes from the seller's own collection (Rateboard's
 * collection pull), not from the offer.
 */
import { median } from './formulas';
import { houseFor, minimumFor, norm, type RbBoard, type RbSport } from './rateboard';
import { rbKey } from './rbHistory';

export interface RbBid {
  id: string;
  /** Series key (shared with the history recorder). */
  key: string;
  user: string;
  /** Display name of the buyer on Rateboard (not necessarily their Real handle). */
  who: string;
  sport: RbSport;
  player: string;
  /** Rax per rating point. */
  rate: number;
  /** The buyer's comment permalink under the pinned post — the way to reach them. */
  link: string;
  ts: number;
}

/** Live (non-banned) offers as bids. */
export function toRbBids(board: RbBoard): RbBid[] {
  return board.offers
    .filter((o) => !board.users[o.user]?.banned && o.rate > 0 && o.player)
    .map((o) => ({
      id: o.id,
      key: rbKey(o.sport, o.player),
      user: o.user,
      who: board.users[o.user]?.name || o.user,
      sport: o.sport,
      player: o.player,
      rate: o.rate,
      link: o.link || '',
      ts: o.ts,
    }));
}

/** Where a bid's comparison rate came from, weakest last. */
export type BaselineKind = 'history' | 'others' | 'sport';

export interface RbRadarRow extends RbBid {
  baseline: number;
  baselineKind: BaselineKind | null;
  /** (rate / baseline − 1) × 100, or null when there is nothing to compare with. */
  premium: number | null;
  /** Distinct buyers currently bidding on this player. */
  buyers: number;
  floor: number | null;
  house: number | null;
}

/**
 * Compare every bid with the going rate for that player:
 *  1. `history`  — the player's own 7-day median bid rate from the recorder (only once ≥ 3 days exist);
 *  2. `others`   — the median of the OTHER buyers' offers on the same player (needs ≥ 2 others);
 *  3. `sport`    — the median of all offers in that sport (weakest: says "high for the sport", not "high for him").
 */
export function radarRows(board: RbBoard, historyBaselines: Record<string, number> = {}): RbRadarRow[] {
  const bids = toRbBids(board);
  const byPlayer = new Map<string, RbBid[]>();
  const bySport = new Map<RbSport, number[]>();
  for (const b of bids) {
    (byPlayer.get(b.key) ?? byPlayer.set(b.key, []).get(b.key)!).push(b);
    (bySport.get(b.sport) ?? bySport.set(b.sport, []).get(b.sport)!).push(b.rate);
  }
  const sportMed = new Map([...bySport].map(([s, r]) => [s, median(r)]));
  return bids.map((b) => {
    const same = byPlayer.get(b.key)!;
    const others = same.filter((x) => x.user !== b.user).map((x) => x.rate);
    let baseline = 0;
    let kind: BaselineKind | null = null;
    if (historyBaselines[b.key] > 0) (baseline = historyBaselines[b.key]), (kind = 'history');
    else if (others.length >= 2) (baseline = median(others)), (kind = 'others');
    else if (sportMed.get(b.sport)) (baseline = sportMed.get(b.sport)!), (kind = 'sport');
    return {
      ...b,
      baseline,
      baselineKind: kind,
      premium: baseline > 0 ? (b.rate / baseline - 1) * 100 : null,
      buyers: new Set(same.map((x) => x.user)).size,
      floor: minimumFor(board, b.sport, b.player)?.rate ?? null,
      house: houseFor(board, b.sport, b.player)?.rate ?? null,
    };
  });
}

export interface RbContender {
  user: string;
  who: string;
  /** Standing offers this buyer has up. */
  offers: number;
  /** …of which are at least `aboveAt`% over their comparison rate. */
  above: number;
  /** Mean premium over the offers that have a real comparison (history or other buyers); null if none do. */
  avgPremium: number | null;
  /** Highest rate they are offering. */
  topRate: number;
  sports: RbSport[];
  /** Their offers, highest rate first. */
  wants: Array<{ player: string; sport: RbSport; rate: number; premium: number | null; link: string; ts: number }>;
  lastTs: number;
}

/** Repeat bidders: buyers with ≥ `minOffers` standing offers, ranked by how many and how far above market they bid. */
export function contenders(rows: RbRadarRow[], minOffers = 2, aboveAt = 25): RbContender[] {
  const per = new Map<string, RbRadarRow[]>();
  for (const r of rows) (per.get(r.user) ?? per.set(r.user, []).get(r.user)!).push(r);
  const out: RbContender[] = [];
  for (const [user, rs] of per) {
    if (rs.length < minOffers) continue;
    const prem = rs.filter(isStrong).map((r) => r.premium as number);
    const wants = [...rs].sort((a, b) => b.rate - a.rate || b.ts - a.ts).map((r) => ({ player: r.player, sport: r.sport, rate: r.rate, premium: r.premium, link: r.link, ts: r.ts }));
    out.push({
      user,
      who: rs[0].who,
      offers: rs.length,
      above: prem.filter((p) => p >= aboveAt).length,
      avgPremium: prem.length ? prem.reduce((a, b) => a + b, 0) / prem.length : null,
      topRate: Math.max(...rs.map((r) => r.rate)),
      sports: [...new Set(rs.map((r) => r.sport))],
      wants,
      lastTs: Math.max(...rs.map((r) => r.ts)),
    });
  }
  return out.sort((a, b) => b.offers + 2 * b.above - (a.offers + 2 * a.above) || b.topRate - a.topRate);
}

/** Contenders who want at least one player in `owned` (normalised names). */
export function wantsOf(c: RbContender, owned: Set<string>) {
  return c.wants.filter((w) => owned.has(norm(w.player)));
}

/** Premiums measured against the player's own market (history or other buyers) — not the weak sport-median fallback. */
export const isStrong = (r: RbRadarRow) => r.premium != null && r.baselineKind !== 'sport';

export const radarStats = (rows: RbRadarRow[], hotAt = 40) => ({
  bids: rows.length,
  buyers: new Set(rows.map((r) => r.user)).size,
  players: new Set(rows.map((r) => r.key)).size,
  hot: rows.filter((r) => isStrong(r) && r.premium! >= hotAt).length,
  topPremium: rows.reduce((m, r) => (isStrong(r) ? Math.max(m, r.premium!) : m), 0),
});
