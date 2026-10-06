/**
 * Auction aggregator  —  /api/scout/auctions[?sport=NFL&limit=300]
 *
 * Per-Rating Price = Highest Bid / Card Rating, with a 7-day median baseline per player so the UI can
 * show how far each bid sits above market. Live when REAL_API_BASE + AUCTIONS_ENDPOINT are configured;
 * otherwise a deterministic SAMPLE dataset (source: "sample") so the UI is fully usable.
 *
 * NOTE: the live normaliser below is written against the AuctionBid schema in the spec plus a few common
 * aliases. Real's actual response shape could not be verified — adjust `normalizeAuction` once you've seen it.
 */
import type { AuctionBid, AuctionsResponse, ContenderActivity } from '../../../src/types/market';
import type { Rarity, Sport } from '../../../src/types/real';
import { median, perRatingPrice, playerKey, RARITIES, SPORTS } from '../../../shared/formulas';
import { sampleAuctions } from '../../../shared/sample';
import { cached, DEFAULT_REAL_UA, err, json, preflight, type Env } from '../../_lib/http';
import { loadHistory, recordSnapshot } from '../../_lib/history';

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

export const onRequest: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');

  const params = new URL(request.url).searchParams;
  const sport = params.get('sport')?.toUpperCase();
  if (sport && !SPORTS.includes(sport as Sport)) return err(400, 'bad_sport', 'Unknown sport.');
  const limit = Math.min(1000, Math.max(1, Number(params.get('limit') || 400)));

  const produce = async (): Promise<Response> => {
    const now = Date.now();
    let out: AuctionsResponse | null = null;

    if (env.REAL_API_BASE && env.AUCTIONS_ENDPOINT) {
      try {
        const res = await fetch(`${env.REAL_API_BASE.replace(/\/+$/, '')}/${env.AUCTIONS_ENDPOINT.replace(/^\/+/, '')}`, {
          headers: { 'User-Agent': env.REAL_USER_AGENT || DEFAULT_REAL_UA, Accept: 'application/json' },
        });
        if (res.ok) {
          const body: any = await res.json();
          const list: unknown[] = Array.isArray(body) ? body : body?.auctions ?? body?.items ?? [];
          const bids = list.map((r) => normalizeAuction(r, now)).filter((b): b is AuctionBid => !!b);
          if (bids.length) {
            const prior = await loadHistory(env);
            const doc = await recordSnapshot(env, bids, now, prior);
            const baselines: Record<string, number> = {};
            for (const [k, p] of Object.entries(doc.players)) {
              const w = p.points.filter((x) => x.t > now - 7 * DAY && x.volume > 0).map((x) => x.medPrp);
              if (w.length) baselines[k] = median(w);
            }
            out = { source: 'live', generatedAt: new Date(now).toISOString(), bids, baselines, contenders: deriveContenders(bids, now) };
          }
        }
      } catch {
        /* fall through to sample */
      }
    }

    if (!out) {
      const s = sampleAuctions(now);
      out = {
        source: 'sample',
        generatedAt: new Date(now).toISOString(),
        ...s,
        note: env.REAL_API_BASE && env.AUCTIONS_ENDPOINT ? 'Live feed unavailable — showing sample data.' : 'Live auction feed not configured — showing sample data.',
      };
    }
    const filtered = sport ? out.bids.filter((b) => b.sport === sport) : out.bids;
    return json({ ...out, bids: filtered.slice(0, limit), contenders: sport ? out.contenders.filter((c) => c.sport === sport) : out.contenders });
  };

  return cached(`scout/auctions/${sport ?? 'all'}/${limit}`, 60, produce, (p) => waitUntil(p));
};
