/** Auction normalisation shared by the edge feed and the browser-side snapshot importer. */
import type { AuctionBid, ContenderActivity } from '../src/types/market';
import type { Rarity, Sport } from '../src/types/real';
import { median, perRatingPrice, playerKey, RARITIES, SPORTS } from './formulas';

const DAY = 86_400_000;

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

export function normalizeAuction(raw: any, now = Date.now()): AuctionBid | null {
  if (!raw || typeof raw !== 'object') return null;
  const playerName = raw.playerName ?? raw.player?.name ?? raw.card?.playerName ?? raw.card?.player?.name;
  const sport = String(raw.sport ?? raw.card?.sport ?? '').toUpperCase() as Sport;
  const rarity = cap(String(raw.rarity ?? raw.card?.rarity ?? '')) as Rarity;
  const rating = Number(raw.cardRating ?? raw.rating ?? raw.card?.rating);
  const bid = Number(raw.highestBidRax ?? raw.highestBid ?? raw.currentBid ?? raw.bid);
  const bidder = raw.bidderUsername ?? raw.highestBidder?.username ?? raw.bidder?.username;
  if (!playerName || !SPORTS.includes(sport) || !RARITIES.includes(rarity) || !(rating > 0) || !(bid > 0) || !bidder) return null;
  const expiresAt = raw.expiresAt ?? raw.endsAt ?? raw.endTime ?? new Date(now).toISOString();
  return {
    auctionId: String(raw.auctionId ?? raw.id ?? `${playerName}-${raw.timestamp ?? now}`),
    cardId: String(raw.cardId ?? raw.card?.id ?? playerKey(sport, playerName)),
    playerName: String(playerName),
    sport,
    rarity,
    cardRating: rating,
    highestBidRax: bid,
    perRatingPrice: perRatingPrice(bid, rating),
    bidderUsername: String(bidder),
    bidderUserId: String(raw.bidderUserId ?? raw.highestBidder?.id ?? raw.bidder?.id ?? bidder),
    timestamp: String(raw.timestamp ?? raw.bidAt ?? raw.updatedAt ?? new Date(now).toISOString()),
    expiresAt: String(expiresAt),
    status: Date.parse(String(expiresAt)) > now && raw.status !== 'closed' ? 'active' : 'closed',
  };
}

/** Repeat contenders from a live feed: Mystic/Legendary bidders with several bids on one card. */
export function deriveContenders(bids: AuctionBid[], now: number): ContenderActivity[] {
  const groups = new Map<string, AuctionBid[]>();
  for (const b of bids) {
    if (b.rarity !== 'Mystic' && b.rarity !== 'Legendary') continue;
    if (Date.parse(b.timestamp) < now - 7 * DAY) continue;
    const k = `${b.bidderUsername}|${playerKey(b.sport, b.playerName)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => {
      const f = g[0];
      return {
        bidderUsername: f.bidderUsername,
        bidderUserId: f.bidderUserId,
        playerName: f.playerName,
        sport: f.sport,
        rarity: f.rarity,
        cardRating: f.cardRating,
        copiesOwned: 0, // not exposed by the feed
        bids7d: g.length,
        buys7d: g.filter((b) => b.status === 'closed').length,
        avgPerRating7d: median(g.map((b) => b.perRatingPrice)),
        lastActivityAt: g.map((b) => b.timestamp).sort().pop()!,
      };
    })
    .sort((a, b) => b.bids7d + 2 * b.buys7d - (a.bids7d + 2 * a.buys7d));
}
