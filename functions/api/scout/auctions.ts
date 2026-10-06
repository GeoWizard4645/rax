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
import type { AuctionBid, AuctionsResponse } from '../../../src/types/market';
import type { Sport } from '../../../src/types/real';
import { median, SPORTS } from '../../../shared/formulas';
import { deriveContenders, normalizeAuction } from '../../../shared/auctions';
import { sampleAuctions } from '../../../shared/sample';
import { cached, err, json, OUR_UA, preflight, type Env } from '../../_lib/http';
import { loadHistory, recordSnapshot } from '../../_lib/history';

const DAY = 86_400_000;

export { deriveContenders, normalizeAuction };

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
          headers: { 'User-Agent': env.REAL_USER_AGENT || OUR_UA, Accept: 'application/json' },
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
