import { useMemo, useState } from 'react';
import { buildPitch, targetPrice } from '../../../shared/formulas';
import { RB_PULLABLE, samePlayer, type RbSport } from '../../../shared/rateboard';
import type { AuctionBid } from '../../types/market';
import type { CollectionPlayer } from '../../types/real';
import { dec, rax, until } from '../../lib/format';
import { CopyButton } from '../ui/CopyButton';
import { Empty } from '../ui/StateBlock';
import DirectDMLink from './DirectDMLink';

export const toRb = (s: string): RbSport | null => (RB_PULLABLE.includes(s as RbSport) ? (s as RbSport) : null);

export function matchBids(bids: AuctionBid[], collections: Partial<Record<RbSport, CollectionPlayer[]>>) {
  const out: Array<{ bid: AuctionBid; owned: CollectionPlayer }> = [];
  for (const bid of bids) {
    const sp = toRb(bid.sport);
    const list = sp && collections[sp];
    if (!list) continue;
    const owned = list.find((c) => samePlayer(c.name, bid.playerName));
    if (owned) out.push({ bid, owned });
  }
  return out.sort((a, b) => Number(b.bid.status === 'active') - Number(a.bid.status === 'active') || b.bid.highestBidRax - a.bid.highestBidRax);
}

/** Mode B — bidders on cards you own, with the target price, pitch and DM links. */
export default function UserMatcherTable({ bids, collections, discount }: { bids: AuctionBid[]; collections: Partial<Record<RbSport, CollectionPlayer[]>>; discount: number }) {
  const rows = useMemo(() => matchBids(bids, collections), [bids, collections]);
  const [sel, setSel] = useState<string | null>(null);
  const picked = rows.find((r) => r.bid.auctionId === sel) ?? rows[0];

  if (!rows.length) {
    return (
      <div className="panel">
        <Empty title="No bidders on cards you own right now">Nobody in the current feed is bidding on a card in your collection. Check back as new auctions open, or look at Repeat Contenders.</Empty>
      </div>
    );
  }

  const pitchFor = (b: AuctionBid) => buildPitch({ highestBid: b.highestBidRax, playerName: b.playerName, targetPrice: targetPrice(b.highestBidRax, discount), cardRating: b.cardRating });

  return (
    <div className="space-y-3">
      <div className="panel overflow-hidden">
        <div className="panel-hd">
          <h2>
            Bidders on cards you own <span className="num text-xs font-normal text-muted">({rows.length})</span>
          </h2>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 bg-surface">
              <tr>
                <th>Player</th>
                <th className="r">You own</th>
                <th>Status</th>
                <th className="r">Their bid</th>
                <th className="r">Per-rating</th>
                <th className="r">Your target</th>
                <th className="r">Your per-rating</th>
                <th>Bidder</th>
                <th>Pitch / contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ bid, owned }) => {
                const tp = targetPrice(bid.highestBidRax, discount);
                const active = picked?.bid.auctionId === bid.auctionId;
                return (
                  <tr key={bid.auctionId} onClick={() => setSel(bid.auctionId)} className={`cursor-pointer ${active ? '!bg-action/10' : ''}`}>
                    <td>
                      <span className="font-medium">{bid.playerName}</span> <span className="chip-muted">{bid.sport}</span>
                    </td>
                    <td className="r num">{owned.total}</td>
                    <td>
                      {bid.status === 'active' ? (
                        <span className="chip-emerald">bidding · {until(bid.expiresAt)}</span>
                      ) : (
                        <span className="chip-muted" title="The feed only shows the highest bidder, so this is a recent buyer, not a confirmed losing bidder.">
                          recent buyer
                        </span>
                      )}
                    </td>
                    <td className="r num">{rax(bid.highestBidRax)}</td>
                    <td className="r num text-muted">{dec(bid.perRatingPrice, 2)}</td>
                    <td className="r num font-semibold text-emerald">{rax(tp)}</td>
                    <td className="r num">{dec(tp / bid.cardRating, 2)}/1</td>
                    <td className="num text-xs">{bid.bidderUsername}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex flex-wrap gap-1.5">
                        <CopyButton text={pitchFor(bid)} label="Pitch" toast="Pitch copied" />
                        <DirectDMLink username={bid.bidderUsername} userId={bid.bidderUserId} compact />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {picked && (
        <div className="panel">
          <div className="panel-hd">
            <h2>Pitch for {picked.bid.bidderUsername}</h2>
            <CopyButton text={pitchFor(picked.bid)} label="Click to copy" className="btn-primary btn-sm" toast="Pitch copied" />
          </div>
          <div className="panel-bd">
            <button className="w-full rounded-md border border-line bg-base p-3 text-left text-sm leading-relaxed hover:border-action" onClick={() => void navigator.clipboard?.writeText(pitchFor(picked.bid))} title="Click to copy">
              {pitchFor(picked.bid)}
            </button>
            <p className="hint mt-2">
              Send it as a DM, or use "Profile" to open their page. Remember: bidders often don't reply — see "How this works" above.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
