import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { SportTabs } from '../ui/SportSelect';
import { CopyButton } from '../ui/CopyButton';
import { Empty } from '../ui/StateBlock';
import { ago, dec, pct, rax } from '../../lib/format';
import { RB_SPORTS, bigOrderMessage, bigOrders, buildMatches, copyMessage, norm, owedFor, type RbBoard, type RbSport } from '../../../shared/rateboard';
import { contenders, radarRows, radarStats, wantsOf, type BaselineKind, type RbRadarRow } from '../../../shared/rbBids';
import type { CollectionPlayer } from '../../types/real';

export type BidView = 'radar' | 'scout' | 'contenders';
const SPORT_LIST = Object.keys(RB_SPORTS) as RbSport[];

const KIND_LABEL: Record<BaselineKind, string> = {
  history: 'his own 7-day median bid rate (recorded)',
  others: 'median of the other buyers on him',
  sport: 'median bid in this sport (weak: no one else is bidding on him)',
};
const KIND_SHORT: Record<BaselineKind, string> = { history: '7d', others: 'others', sport: 'sport' };

const CommentLink = ({ href }: { href: string }) =>
  href ? (
    <a className="btn-ghost btn-sm !no-underline" href={href} target="_blank" rel="noopener noreferrer" title="The buyer’s own comment under Rateboard’s pinned post on Real — reply there to reach them">
      Comment <ExternalLink size={12} />
    </a>
  ) : (
    <span className="text-muted">—</span>
  );

/**
 * Tab 2 on real Rateboard data. Each standing BUY offer is a "bid": buyer, player, sport, rate (Rax per rating point).
 * Rating, rarity and any auction clock are not in the data and are shown as unknown, never guessed.
 */
export default function RateboardBids({
  board,
  baselines,
  collections,
  view,
}: {
  board: RbBoard;
  baselines: Record<string, number>;
  collections: Partial<Record<RbSport, CollectionPlayer[]>>;
  view: BidView;
}) {
  const rows = useMemo(() => radarRows(board, baselines), [board, baselines]);
  return (
    <>
      {view === 'radar' && <Radar rows={rows} hasHistory={Object.keys(baselines).length > 0} />}
      {view === 'scout' && <Scout board={board} collections={collections} />}
      {view === 'contenders' && <Contenders rows={rows} collections={collections} />}
    </>
  );
}

export function useBidStats(board: RbBoard | null, baselines: Record<string, number>) {
  return useMemo(() => (board ? radarStats(radarRows(board, baselines)) : null), [board, baselines]);
}

/* ------------------------------ radar ------------------------------ */

type Key = 'player' | 'rate' | 'baseline' | 'premium' | 'buyers' | 'ts';

function Radar({ rows, hasHistory }: { rows: RbRadarRow[]; hasHistory: boolean }) {
  const [sport, setSport] = useState<RbSport | 'ALL'>('ALL');
  const [minPremium, setMinPremium] = useState(0);
  const [rating, setRating] = useState('');
  const [weak, setWeak] = useState(false);
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'premium', dir: -1 });
  const r = Math.round(Number(rating));
  const ratingOk = Number.isFinite(r) && r >= 40 && r <= 120;

  const shown = useMemo(() => {
    let x = rows;
    if (sport !== 'ALL') x = x.filter((y) => y.sport === sport);
    if (!weak) x = x.filter((y) => y.baselineKind !== 'sport');
    if (minPremium > 0) x = x.filter((y) => (y.premium ?? -Infinity) >= minPremium);
    const val: Record<Key, (y: RbRadarRow) => number | string> = {
      player: (y) => y.player,
      rate: (y) => y.rate,
      baseline: (y) => y.baseline,
      premium: (y) => y.premium ?? -1e9,
      buyers: (y) => y.buyers,
      ts: (y) => y.ts,
    };
    return [...x].sort((a, b) => {
      const p = val[sort.key](a);
      const q = val[sort.key](b);
      return (typeof p === 'string' ? p.localeCompare(q as string) : (p as number) - (q as number)) * sort.dir;
    });
  }, [rows, sport, minPremium, sort, weak]);

  const th = (key: Key, label: string, right = false) => (
    <th className={`sortable ${right ? 'r' : ''}`} onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={10} className="inline" /> : <ArrowDown size={10} className="inline" />)}
    </th>
  );

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <div>
          <h2>
            Bids above market <span className="num text-xs font-normal text-muted">({shown.length})</span>
          </h2>
          <p className="text-[11px] font-normal text-muted">Who is bidding more per rating point than the going rate for that player — from Rateboard’s live board.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SportTabs sports={SPORT_LIST} value={sport} onChange={setSport} allLabel="All" />
          <label className="flex items-center gap-2 text-xs text-muted">
            Min premium
            <input type="range" min={0} max={200} step={10} value={minPremium} onChange={(e) => setMinPremium(+e.target.value)} className="w-24 accent-[#F59E0B]" aria-label="Minimum premium percent" />
            <span className="num w-9 text-head">{minPremium}%</span>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted" title="Bids on players nobody else is bidding on have nothing to be compared with except the sport’s median — a weak yardstick, so they are hidden unless you ask.">
            <input type="checkbox" checked={weak} onChange={(e) => setWeak(e.target.checked)} /> also lone bids (vs sport median)
          </label>
          <label className="flex items-center gap-2 text-xs text-muted" title="Rateboard offers don’t say which card rating the buyer has in mind. Type one to see what the rate is worth in Rax.">
            If rating is
            <input className="field !w-16 !py-1" inputMode="numeric" placeholder="e.g. 90" value={rating} onChange={(e) => setRating(e.target.value.replace(/[^\d]/g, '').slice(0, 3))} aria-label="What-if card rating" />
          </label>
        </div>
      </div>
      {!hasHistory && (
        <div className="border-b border-line bg-amber/5 px-3 py-2 text-[11px] text-amber/90">
          History baselines unlock after 3 days of recording. Until then “market” is the median of the other buyers on the same player (or the sport’s median when nobody else bids) — the badge in each row says which.
        </div>
      )}
      {shown.length === 0 ? (
        <Empty title="No bids match those filters" />
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                {th('player', 'Player')}
                <th>Buyer</th>
                {th('rate', 'Bid rate', true)}
                {th('baseline', 'Market rate', true)}
                {th('premium', 'Premium', true)}
                {th('buyers', 'Buyers on him', true)}
                {ratingOk && <th className="r">≈ Rax @ {r}</th>}
                <th className="r">Rating · Rarity</th>
                {th('ts', 'Posted', true)}
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, 400).map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="font-medium">{b.player}</span> <span className="chip-muted">{b.sport}</span>
                    <div className="text-[11px] text-muted">
                      {b.house != null && <span title="The house buyer’s standing rate for this player">house {b.house}/1 · </span>}
                      {b.floor != null && <span title="Rateboard’s minimum rate for this player">floor {b.floor}/1</span>}
                    </div>
                  </td>
                  <td className="num text-xs" title="Rateboard account — not necessarily their Real handle">{b.who}</td>
                  <td className="r num font-semibold">{b.rate}/1</td>
                  <td className="r num" title={b.baselineKind ? `Market rate = ${KIND_LABEL[b.baselineKind]}` : 'No comparison available'}>
                    {b.baselineKind ? (
                      <>
                        {dec(b.baseline, 1)}/1 <span className="text-[10px] text-muted">({KIND_SHORT[b.baselineKind]})</span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="r num">
                    {b.premium == null ? <span className="text-muted">—</span> : <span className={b.premium >= 40 ? 'chip-amber' : b.premium > 0 ? 'text-emerald' : 'text-muted'}>{pct(b.premium, 0)}</span>}
                  </td>
                  <td className="r num">{b.buyers}</td>
                  {ratingOk && <td className="r num">{rax(b.rate * r)}</td>}
                  <td className="r num text-muted" title="Not in Rateboard’s data — the offer doesn’t say which card">unknown</td>
                  <td className="r num text-xs text-muted">{ago(b.ts)}</td>
                  <td>
                    <CommentLink href={b.link} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
        <b className="text-head">What this is.</b> Each row is a standing buy offer on Rateboard: “I’ll pay <i>rate</i> Rax per rating point.” A 90-rated card at 20/1 is worth 1,800 Rax to that buyer. <b className="text-head">Not in the data:</b> the card’s rating and rarity, auction end times and any sale history — so there are no “live auctions” here and “premium” means above the going <i>rate</i>, not above a sale price. Offers stay up until the buyer removes them; “Posted” is when the offer was placed.
      </div>
    </div>
  );
}

/* ------------------------------ scout ------------------------------ */

function Scout({ board, collections }: { board: RbBoard; collections: Partial<Record<RbSport, CollectionPlayer[]>> }) {
  const sports = (Object.keys(collections) as RbSport[]).filter((s) => collections[s]?.length);
  const results = useMemo(
    () =>
      sports.map((s) => ({
        sport: s,
        m: buildMatches(board, s, (collections[s] ?? []).map((p) => ({ name: p.name, boost: p.totalValue || null, owned: p.total, totalValue: p.totalValue })), []),
        owned: new Map((collections[s] ?? []).map((p) => [norm(p.name), p])),
      })),
    [board, collections, sports.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!sports.length) {
    return (
      <div className="panel px-4 py-8 text-center text-sm text-muted">Enter your Real username above to see which Rateboard buyers are bidding on cards you own.</div>
    );
  }
  const orders = results.flatMap((r) => bigOrders(r.m.rows));
  const total = results.reduce((n, r) => n + r.m.rows.length, 0);
  return (
    <div className="space-y-4">
      <div className="panel overflow-hidden">
        <div className="panel-hd">
          <h2>
            Buyers on cards you own <span className="num text-xs font-normal text-muted">({total})</span>
          </h2>
        </div>
        {total === 0 ? (
          <Empty title="Nobody on the board is bidding on a card in your collection right now">Check back as new offers are posted, or look at Repeat Contenders.</Empty>
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  <th>Player</th>
                  <th className="r">You own</th>
                  <th className="r">Best bid</th>
                  <th>Buyer</th>
                  <th className="r" title="Rateboard’s own formula: your card value × rate, to the nearest 10">You’d get</th>
                  <th className="r">Other buyers</th>
                  <th>Message · contact</th>
                </tr>
              </thead>
              <tbody>
                {results.flatMap((r) =>
                  r.m.rows.map((h) => {
                    const top = h.buyers[0];
                    const own = r.owned.get(norm(h.player));
                    return (
                      <tr key={`${r.sport}-${h.player}`}>
                        <td>
                          <span className="font-medium">{h.player}</span> <span className="chip-muted">{r.sport}</span>
                        </td>
                        <td className="r num">{own?.total ?? '—'}</td>
                        <td className="r num font-semibold">{top.rate}/1</td>
                        <td className="num text-xs">{top.buyer}</td>
                        <td className="r num text-emerald">{h.value ? rax(owedFor(h.value, top.rate)) : <span className="text-muted" title="Your collection pull gave no rating total for this card">—</span>}</td>
                        <td className="r num text-muted">{h.buyers.length - 1}</td>
                        <td>
                          <span className="inline-flex flex-wrap gap-1.5">
                            {h.value ? <CopyButton text={copyMessage(h.value, h.player, top.rate)} label="Message" toast="Message copied" /> : null}
                            <CommentLink href={top.link} />
                          </span>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
          Matching is Rateboard’s own (same names, same “i have &lt;rating&gt; &lt;player&gt; &lt;owed&gt;” message). “You’d get” uses the card value from your collection pull; it is a standing offer, so confirm with the buyer — nothing here is a completed sale.
        </div>
      </div>

      {orders.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-hd">
            <h2>
              Buyers who want several of your cards <span className="num text-xs font-normal text-muted">({orders.length})</span>
            </h2>
          </div>
          <div className="max-h-[360px] overflow-auto">
            <table className="tbl">
              <tbody>
                {orders.slice(0, 40).map((o) => (
                  <tr key={o.user}>
                    <td className="num text-xs">{o.who}</td>
                    <td className="text-xs">{o.cards.map((c) => `${c.player} ${c.rate}/1`).join(' · ')}</td>
                    <td className="r num text-emerald">{o.total ? rax(o.total) : '—'}</td>
                    <td>
                      <span className="inline-flex gap-1.5">
                        {bigOrderMessage(o) && <CopyButton text={bigOrderMessage(o)!} label="Message" toast="Message copied" />}
                        <CommentLink href={o.link} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ contenders ------------------------------ */

function Contenders({ rows, collections }: { rows: RbRadarRow[]; collections: Partial<Record<RbSport, CollectionPlayer[]>> }) {
  const [minOffers, setMinOffers] = useState(3);
  const [onlyMine, setOnlyMine] = useState(false);
  const [sport, setSport] = useState<RbSport | 'ALL'>('ALL');
  const owned = useMemo(() => new Set(Object.values(collections).flatMap((l) => (l ?? []).map((p) => norm(p.name)))), [collections]);
  const haveCollection = owned.size > 0;

  const list = useMemo(() => {
    const scoped = sport === 'ALL' ? rows : rows.filter((r) => r.sport === sport);
    return contenders(scoped, minOffers)
      .map((c) => ({ c, mine: wantsOf(c, owned) }))
      .filter((x) => !onlyMine || x.mine.length > 0);
  }, [rows, sport, minOffers, onlyMine, owned]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <div>
          <h2>
            Repeat bidders <span className="num text-xs font-normal text-muted">({list.length})</span>
          </h2>
          <p className="text-[11px] font-normal text-muted">Buyers with several standing offers on the board — the people most likely to keep buying.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
          <SportTabs sports={SPORT_LIST} value={sport} onChange={setSport} allLabel="All" />
          <label className="flex items-center gap-2">
            Offers ≥
            <input type="range" min={2} max={15} value={minOffers} onChange={(e) => setMinOffers(+e.target.value)} className="w-20 accent-[#3B82F6]" aria-label="Minimum standing offers" />
            <span className="num w-5 text-head">{minOffers}</span>
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlyMine} disabled={!haveCollection} onChange={(e) => setOnlyMine(e.target.checked)} /> only those wanting my cards
          </label>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty title="No repeat bidders match" />
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th>Buyer</th>
                <th className="r">Offers</th>
                <th className="r" title="Offers at least 25% above the going rate for that player">Above market</th>
                <th className="r">Avg premium</th>
                <th className="r">Top rate</th>
                <th>Wants</th>
                <th>Last posted</th>
                <th>Contact</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 150).map(({ c, mine }) => (
                <tr key={c.user} className={mine.length ? 'bg-emerald/5' : ''}>
                  <td className="num text-xs">
                    {c.who} {c.sports.map((s) => <span key={s} className="chip-muted ml-1">{s}</span>)}
                  </td>
                  <td className="r num">{c.offers}</td>
                  <td className="r num">{c.above}</td>
                  <td className="r num">{c.avgPremium == null ? <span className="text-muted">—</span> : pct(c.avgPremium, 0)}</td>
                  <td className="r num">{c.topRate}/1</td>
                  <td className="text-xs">
                    {c.wants.slice(0, 4).map((w) => (
                      <span key={`${w.sport}-${w.player}`} className={`mr-2 inline-block ${owned.has(norm(w.player)) ? 'text-emerald' : ''}`}>
                        {w.player} <span className="num text-muted">{w.rate}/1</span>
                      </span>
                    ))}
                    {c.wants.length > 4 && <span className="text-muted">+{c.wants.length - 4} more</span>}
                    {mine.length > 0 && <span className="chip-emerald ml-1">wants {mine.length} you own</span>}
                  </td>
                  <td className="num text-xs text-muted">{ago(c.lastTs)}</td>
                  <td>
                    <CommentLink href={c.wants.find((w) => w.link)?.link ?? ''} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
        A “repeat bidder” is a Rateboard account with several live offers at once — it says nothing about what they have actually bought on Real, and the cards’ ratings and rarities aren’t in the data (so there is no Mystic/Legendary filter here). “Above market” compares each offer with the going rate for that player (see the Bids tab). Contact is the buyer’s own comment under Rateboard’s pinned post.
        {haveCollection ? '' : ' Enter your username above to highlight buyers who want a card you own.'}
      </div>
    </div>
  );
}

