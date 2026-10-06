import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { playerKey, premiumPct } from '../../../shared/formulas';
import type { AuctionBid } from '../../types/market';
import { dec, pct, rax, until } from '../../lib/format';
import { SportTabs } from '../ui/SportSelect';
import { Empty } from '../ui/StateBlock';
import { SPORTS } from '../../../shared/formulas';
import type { Sport } from '../../types/real';
import DirectDMLink from './DirectDMLink';

type Key = 'player' | 'rating' | 'bid' | 'prp' | 'premium';

export interface RadarRow extends AuctionBid {
  baseline: number;
  premium: number;
}

export function toRadarRows(bids: AuctionBid[], baselines: Record<string, number>): RadarRow[] {
  return bids.map((b) => {
    const baseline = baselines[playerKey(b.sport, b.playerName)] ?? 0;
    return { ...b, baseline, premium: premiumPct(b.perRatingPrice, baseline) };
  });
}

/** Mode A — recently bid-on auctions where buyers pay a premium over the player's 7-day median per-rating price. */
export default function OverpricedRadar({ bids, baselines }: { bids: AuctionBid[]; baselines: Record<string, number> }) {
  const [sport, setSport] = useState<Sport | 'ALL'>('ALL');
  const [status, setStatus] = useState<'all' | 'active' | 'closed'>('all');
  const [minPremium, setMinPremium] = useState(0);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'prp', dir: -1 });

  const rows = useMemo(() => {
    let r = toRadarRows(bids, baselines);
    if (sport !== 'ALL') r = r.filter((x) => x.sport === sport);
    if (status !== 'all') r = r.filter((x) => x.status === status);
    r = r.filter((x) => x.premium >= minPremium);
    const val: Record<Key, (x: RadarRow) => number | string> = { player: (x) => x.playerName, rating: (x) => x.cardRating, bid: (x) => x.highestBidRax, prp: (x) => x.perRatingPrice, premium: (x) => x.premium };
    return [...r].sort((a, b) => {
      const x = val[sort.key](a), y = val[sort.key](b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : (x as number) - (y as number)) * sort.dir;
    });
  }, [bids, baselines, sport, status, minPremium, sort]);

  const th = (key: Key, label: string, right = false) => (
    <th className={`sortable ${right ? 'r' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />)}
    </th>
  );

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>
          Overpriced Radar <span className="num text-xs font-normal text-muted">({rows.length})</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <SportTabs sports={SPORTS} value={sport} onChange={setSport} allLabel="All" />
          <div className="seg" role="group" aria-label="Status">
            {(['all', 'active', 'closed'] as const).map((s) => (
              <button key={s} aria-pressed={status === s} onClick={() => setStatus(s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            Min premium
            <input type="range" min={0} max={100} step={5} value={minPremium} onChange={(e) => setMinPremium(+e.target.value)} className="w-24 accent-[#F59E0B]" aria-label="Minimum premium percent" />
            <span className="num w-9 text-head">{minPremium}%</span>
          </label>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="No bids match those filters" />
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                {th('player', 'Player')}
                {th('rating', 'Rating · Rarity', true)}
                {th('bid', 'Highest bid (Rax)', true)}
                {th('prp', 'Per-rating', true)}
                {th('premium', 'Premium vs 7d median', true)}
                <th>Bidder</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.auctionId}>
                  <td>
                    <span className="font-medium">{r.playerName}</span> <span className="chip-muted">{r.sport}</span>
                    <div className="text-[11px] text-muted">
                      {r.status === 'active' ? <span className="text-emerald">live · ends in {until(r.expiresAt)}</span> : 'closed'}
                    </div>
                  </td>
                  <td className="r num">
                    {r.cardRating} <span className="text-xs text-muted">{r.rarity}</span>
                  </td>
                  <td className="r num">{rax(r.highestBidRax)}</td>
                  <td className="r num">{dec(r.perRatingPrice, 2)}</td>
                  <td className="r num">
                    {r.baseline > 0 ? (
                      <span className={r.premium >= 40 ? 'chip-amber' : r.premium > 0 ? 'text-emerald' : 'text-muted'}>{pct(r.premium, 0)}</span>
                    ) : (
                      <span className="text-muted" title="No 7-day baseline yet">—</span>
                    )}
                  </td>
                  <td className="num text-xs">{r.bidderUsername}</td>
                  <td>
                    <DirectDMLink username={r.bidderUsername} userId={r.bidderUserId} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
        Per-rating = highest bid ÷ card rating. Premium compares it with that player's median per-rating price over the last 7 days. A high premium marks an irrational bidding war — check whether you own that card.
      </div>
    </div>
  );
}
