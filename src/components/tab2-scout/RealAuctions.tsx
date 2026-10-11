import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { capWord, timeLeftLabel, type RadarItem } from '../../../shared/realMarket';
import type { RealMarketState } from '../../lib/realMarketStore';
import { ago, dec, pct, rax } from '../../lib/format';
import { SportTabs } from '../ui/SportSelect';
import { Segmented } from '../ui/Segmented';
import { Empty } from '../ui/StateBlock';
import { Stat } from '../ui/Stat';

type View = 'radar' | 'scout' | 'contenders';
type Status = 'live' | 'stale' | 'all';
type Soon = 'any' | '1h' | '6h' | '24h';
type Sort = 'premium' | 'time' | 'bid' | 'prp';
const SOON_SEC: Record<Soon, number> = { any: Infinity, '1h': 3600, '6h': 6 * 3600, '24h': 24 * 3600 };

const title = (s: string) => s.toLowerCase().replace(/(^|[\s/-])\w/g, (c) => c.toUpperCase());

/** "ended" for auctions whose timer ran out; the three states are explained in the tooltip. */
function TimeCell({ r, now }: { r: RadarItem; now: number }) {
  const s = r.status;
  const seen = Date.parse(r.last.at);
  const tip = `Last seen ${ago(seen, now)} with ${r.last.timeLeftSec == null ? 'no timer' : timeLeftLabel(r.last.timeLeftSec)} left. Real shows the timer rounded to one unit, so the end time is approximate.`;
  if (s.state === 'live') return <span title={tip} className={`num ${s.secondsLeft! <= 3600 ? 'text-amber' : ''}`}>{timeLeftLabel(s.secondsLeft)}</span>;
  if (s.state === 'closing') return <span title={`${tip} The timer has run out, but because it was rounded the auction may still be finishing.`} className="chip-amber">timer ran out</span>;
  if (s.state === 'ended') return <span title={`${tip} By the clock this auction is over; the bid shown is stale.`} className="chip-muted">ended · stale</span>;
  return <span title={tip} className="text-muted">unknown</span>;
}

function RefCell({ r, label, now }: { r: RadarItem; label: string; now: number }) {
  const ref = r.ref;
  if (!ref) return <span className="text-muted" title="No captured reference: open “Market data” on this card in Real (Card and Player views) or capture more sales and auctions.">—</span>;
  const seen = ref.seenAt ? ` Read ${ago(ref.seenAt, now)}.` : '';
  const unit = ref.kind === 'live-auctions' ? 'bids' : 'sales';
  return (
    <span title={`${ref.detail}.${seen} Source: ${label}.${ref.thin ? ` Resting on only ${ref.n} ${unit} (< 5), so no premium is computed.` : ''}`}>
      <span className="num">{dec(ref.perRating, 1)}</span>
      <div className="text-[10px] text-muted">
        <span className={ref.weak ? 'text-amber' : ref.kind === 'live-auctions' ? 'text-amber' : ''}>{ref.short}</span> · <span className={ref.thin ? 'text-amber' : ''}>{ref.n.toLocaleString('en-US')} {unit}</span>
      </div>
    </span>
  );
}

/**
 * Tab 2 on the Real marketplace data the user captured: every live auction with its current bid per rating point,
 * compared with a REAL reference price (see shared/realMarket.referenceFor). Bidders are not on Real's cards, so none are shown.
 */
export default function RealAuctions({ real, view, setView, community = false }: { real: RealMarketState; view: View; setView: (v: View) => void; community?: boolean }) {
  const { radar: items, now, label, coverage } = real;
  const [sport, setSport] = useState('ALL');
  const [status, setStatus] = useState<Status>('live');
  const [soon, setSoon] = useState<Soon>('any');
  const [sort, setSort] = useState<Sort>('premium');

  const sports = useMemo(() => [...new Set(items.map((i) => i.auction.sport))].sort(), [items]);
  const live = items.filter((i) => i.status.state === 'live');
  const stats = useMemo(() => {
    const soonN = live.filter((i) => i.status.secondsLeft! <= 6 * 3600).length;
    const hot = live.filter((i) => (i.premium ?? -1) >= 40);
    const top = live.reduce((m, i) => Math.max(m, i.premium ?? -Infinity), -Infinity);
    return { soonN, hot: hot.length, top, noRef: live.filter((i) => i.premium == null).length };
  }, [live]);

  const rows = useMemo(() => {
    let r = items;
    if (sport !== 'ALL') r = r.filter((i) => i.auction.sport === sport);
    if (status === 'live') r = r.filter((i) => i.status.state === 'live');
    else if (status === 'stale') r = r.filter((i) => i.status.state !== 'live');
    if (soon !== 'any') r = r.filter((i) => i.status.state === 'live' && i.status.secondsLeft! <= SOON_SEC[soon]);
    const val: Record<Sort, (i: RadarItem) => number> = {
      premium: (i) => i.premium ?? -Infinity,
      time: (i) => (i.status.state === 'live' ? -(i.status.secondsLeft ?? 0) : -Infinity), // ascending time left = descending of the negative
      bid: (i) => i.bid,
      prp: (i) => i.perRating,
    };
    return [...r].sort((a, b) => val[sort](b) - val[sort](a) || b.bid - a.bid);
  }, [items, sport, status, soon, sort]);

  if (view !== 'radar') {
    return (
      <div className="space-y-3">
        <ViewSwitch view={view} setView={setView} />
        <div className="panel space-y-2 px-4 py-6 text-sm text-muted">
          <p className="flex items-center gap-2 text-head"><Info size={15} className="text-action" /> This view needs bidder names — Real’s marketplace cards don’t show them.</p>
          <p>
            {view === 'scout' ? 'Proactive Scout matches your collection to the people bidding on cards you own' : 'Repeat Contenders tracks who keeps bidding on the same Mystic/Legendary player'}, so it has nothing to work with on captured Real data: the recorder reads what’s on the card (player, rating, bid, bid count, watchers, time left) and no bidder is ever shown there. Nothing is guessed.
          </p>
          <p>Switch the data source to <b className="text-head">Live · Rateboard bids</b> or <b className="text-head">Imported snapshot</b> above and this view works as before.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Live auctions" value={rax(live.length)} sub={`${items.length - live.length} stale / ended`} />
        <Stat label="Ending ≤ 6 h" value={rax(stats.soonN)} sub="by the clock" tone="blue" />
        <Stat label="≥ 40% over reference" value={rax(stats.hot)} sub={`${stats.noRef} with no usable reference`} tone="amber" />
        <Stat label="Top premium" value={Number.isFinite(stats.top) ? `+${Math.round(stats.top)}%` : '—'} sub="only where the reference has ≥ 5 sales" tone="amber" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ViewSwitch view={view} setView={setView} />
        <span className={community ? 'chip-blue' : 'chip-emerald'} title={community ? `Auctions, sales and market stats other RAX users shared anonymously from their own Real sessions. ${real.summary}.` : `Auctions, sales and market stats you recorded from your own Real session. ${real.summary}.`}>{label}</span>
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-hd flex-wrap">
          <h2>
            Overpriced Radar <span className="num text-xs font-normal text-muted">({rows.length})</span>
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            {sports.length > 1 && <SportTabs sports={sports} value={sport} onChange={setSport} allLabel="All" />}
            <Segmented value={status} onChange={setStatus} label="Status" options={[{ value: 'live', label: 'Live' }, { value: 'stale', label: 'Ended / stale' }, { value: 'all', label: 'All' }]} />
            <Segmented value={soon} onChange={setSoon} label="Ending soon" options={[{ value: 'any', label: 'Any time' }, { value: '1h', label: '≤ 1h' }, { value: '6h', label: '≤ 6h' }, { value: '24h', label: '≤ 24h' }]} />
            <Segmented value={sort} onChange={setSort} label="Sort" options={[{ value: 'premium', label: 'Premium' }, { value: 'time', label: 'Time left' }, { value: 'bid', label: 'Bid' }, { value: 'prp', label: 'Per rating' }]} />
          </div>
        </div>
        {rows.length === 0 ? (
          <Empty title={items.length ? 'No auctions match those filters' : community ? 'No community auctions to show' : 'No auctions captured yet'}>
            {items.length ? 'Try “All” status or “Any time”.' : community ? 'Nothing verified is shared yet, or the filter above is hiding single-reporter rows.' : coverage.sales || coverage.stats ? `You have captured ${coverage.sales.toLocaleString('en-US')} sales and ${coverage.stats} market-data views but no auctions. Scroll the Marketplace with the recorder running to add some; the sales you have will be used as reference prices.` : 'Open the capture box above, run the recorder on the Marketplace and import what it exports.'}
          </Empty>
        ) : (
          <div className="max-h-[640px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  <th>Card</th>
                  <th className="r">Rating · Rarity</th>
                  <th className="r">Current bid</th>
                  <th className="r" title="Current bid ÷ card rating">Per rating</th>
                  <th className="r" title="A real reference price per rating point, and what backs it — hover for the source">Reference / rating</th>
                  <th className="r" title="(per rating ÷ reference − 1). Hidden when the reference rests on fewer than 5 sales">Premium</th>
                  <th className="r">Bids · watching</th>
                  <th className="r">Time left</th>
                  <th title="Real’s cards don’t show who is bidding">Bidder</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => {
                  const a = r.auction;
                  const first = a.pts[0];
                  const hist = a.pts.length > 1 ? a.pts.map((p) => `${rax(p.bid)} Rax (${p.bids} bids) ${ago(p.at, now)}`).join(' → ') : null;
                  const stale = r.status.state !== 'live';
                  return (
                    <tr key={r.key} className={stale ? 'opacity-60' : ''}>
                      <td>
                        <span className="font-medium">{title(a.player)}</span> <span className="chip-muted">{a.sport === 'ALL' ? 'sport ?' : a.sport}</span>
                        <div className="text-[11px] text-muted">{[a.team, a.play ?? a.type, a.season].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="r num">
                        {a.rating} <span className="text-xs text-muted">{capWord(a.rarity)}</span>
                        <div className="text-[11px] text-muted">{title(a.type)} · {a.serial}</div>
                      </td>
                      <td className="r num" title={`${label}. Bid seen ${ago(r.last.at, now)}.${hist ? ` Bid moves you captured: ${hist}.` : ''}`}>
                        {rax(r.bid)}
                        {hist && <div className="text-[11px] text-muted">was {rax(first.bid)} · {a.pts.length} views</div>}
                      </td>
                      <td className="r num">{dec(r.perRating, 1)}</td>
                      <td className="r"><RefCell r={r} label={label} now={now} /></td>
                      <td className="r num">
                        {r.premium != null ? (
                          <span className={r.premium >= 40 ? 'chip-amber' : r.premium > 0 ? 'text-emerald' : 'text-muted'} title={`(${dec(r.perRating, 2)} ÷ ${dec(r.ref!.perRating, 2)} − 1) · ${r.ref!.detail}`}>{r.ref!.weak ? '~' : ''}{pct(r.premium, 0)}</span>
                        ) : (
                          <span className="text-muted" title={r.ref ? `The reference rests on only ${r.ref.n} ${r.ref.kind === 'live-auctions' ? 'live bids' : 'sales'} (< 5), too few to call a premium.` : 'No reference price captured for this card.'}>—</span>
                        )}
                      </td>
                      <td className="r num">
                        {a.pts[a.pts.length - 1].bids} <span className="text-muted">· {a.pts[a.pts.length - 1].watchers}</span>
                      </td>
                      <td className="r"><TimeCell r={r} now={now} /></td>
                      <td className="text-xs text-muted" title="Bidder names aren’t shown on Real’s marketplace cards, so they’re unknown — not guessed.">unknown</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
          <b className="text-head">Source:</b> {label}. Per rating = current bid ÷ card rating. Premium = per rating ÷ reference − 1, where the reference is, in this order: (1) Real’s own median per rating for the same card, (2) for the same player, (3) the median of captured sales of the same sport + rarity + card type, (4) the median bid of the other live auctions of that kind (bids, not sales), (5) a weak rarity-wide sales median. The chip under each reference says which, and how many sales stand behind it; a reference under 5 sales is shown but gives no premium. “Time left” = when you saw it + the timer shown then; it is approximate and a stale row means the auction is over.
        </div>
      </div>
    </div>
  );
}

function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <Segmented
      value={view}
      onChange={setView}
      label="View"
      options={[
        { value: 'radar', label: 'Overpriced Radar' },
        { value: 'scout', label: 'Proactive Scout' },
        { value: 'contenders', label: 'Repeat Contenders' },
      ]}
    />
  );
}
