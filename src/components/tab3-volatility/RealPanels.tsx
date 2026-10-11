import { useMemo } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis, Area, BarChart, ScatterChart } from 'recharts';
import { Database } from 'lucide-react';
import { FORECAST_MIN_DAYS, MIN_REF_SALES, REF_SHORT, bidVsFair, capWord, dailyAggregate, fairTable, type BidFairPoint, type RefKind, type SaleObs } from '../../../shared/realMarket';
import { MIN_HISTORY_DAYS } from '../../../shared/rbHistory';
import type { RealMarketState } from '../../lib/realMarketStore';
import { ago, dec, pct, rax } from '../../lib/format';
import { Empty } from '../ui/StateBlock';
import { Stat } from '../ui/Stat';
import { GrowingHistoryProgress } from './HistoryProgress';

const KIND_COLOR: Record<RefKind, string> = { 'card-stats': '#10B981', 'player-stats': '#3B82F6', 'sales-pool': '#8B5CF6', 'live-auctions': '#F59E0B', 'sales-rarity': '#9CA3AF' };

const day = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 10) : '—');

/** What was captured, how old it is, and how far it is from unlocking spikes and forecasts — the Tab 3 counterpart of the Rateboard recorder panel. */
export function RealMarketPanel({ real }: { real: RealMarketState }) {
  const c = real.coverage;
  const other = c.sales - c.priceSales;
  return (
    <section className="panel" aria-label="Captured Real marketplace data">
      <div className="panel-hd flex-wrap">
        <div>
          <h2 className="flex items-center gap-2">
            <Database size={14} /> Real marketplace data you’ve captured
          </h2>
          <p className="text-[11px] font-normal text-muted">
            Every number on this source comes from your own signed-in Real session: individual sales (price + time), Real’s “Market data” summaries and the live auctions you scrolled past. {real.label}. Price-history <i>chart</i> values are not in Real’s page text, so history here is built from the sales themselves and grows only as you capture.
          </p>
        </div>
        <span className={c.salesDays >= FORECAST_MIN_DAYS ? 'chip-emerald' : 'chip-amber'} title={`Spikes need ≥ ${MIN_HISTORY_DAYS} days of sales for a card; forecasts need ≥ ${FORECAST_MIN_DAYS} distinct days`}>
          {c.salesDays} day{c.salesDays === 1 ? '' : 's'} of sales{c.salesDays >= FORECAST_MIN_DAYS ? '' : ` · forecast unlocks at ${FORECAST_MIN_DAYS}`}
        </span>
      </div>
      <div className="panel-bd space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Sales captured" value={rax(c.priceSales)} sub={other ? `+${other} Accepted/Open/No Sale rows, not counted` : 'sold prices'} />
          <Stat label="Days with sales" value={String(c.salesDays)} sub={c.firstSaleAt ? `${day(c.firstSaleAt)} → ${day(c.lastSaleAt)}` : 'none yet'} tone="blue" />
          <Stat label="Cards with market stats" value={String(c.cardsWithStats)} sub={`${c.stats} views`} tone="emerald" />
          <Stat label="Last capture" value={ago(c.lastCaptureAt ?? c.lastImportAt ?? Date.now(), real.now)} sub={`${c.imports} import${c.imports === 1 ? '' : 's'} · ${c.liveAuctions} live auctions`} tone="amber" />
        </div>
        {c.salesDays < FORECAST_MIN_DAYS && <GrowingHistoryProgress days={c.salesDays} need={FORECAST_MIN_DAYS} what="Monte Carlo forecast (per card or pool)" />}
        <p className="text-[11px] text-muted">
          Sales captured shows only the latest ones Real lists for a card, so counts per day are what you captured, not how busy the market was — volume is therefore never tested for spikes. Price windows end at your newest captured sale ({c.lastSaleAt ? new Date(c.lastSaleAt).toLocaleString() : '—'}).
        </p>
      </div>
    </section>
  );
}

/** Real's own "Market data" numbers, as you saw them, with how old each is. */
export function RealFairTable({ real }: { real: RealMarketState }) {
  const rows = useMemo(() => fairTable(real.store, real.now), [real.store, real.now]);
  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <div>
          <h2>Fair value — Real’s own market stats <span className="num text-xs font-normal text-muted">({rows.length})</span></h2>
          <p className="text-[11px] font-normal text-muted">Median price, price per rating, sales count and quartiles exactly as Real’s “Market data” view showed them when you opened it ({real.label}). This is the closest thing to a fair market value that exists.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty title="No market-data views captured yet">Open “Market data” on a card in Real with the recorder running (Card, Player and Similar tabs each give a different view), export, and import.</Empty>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th>Card</th>
                <th>View</th>
                <th className="r">Median</th>
                <th className="r">Per rating</th>
                <th className="r" title="25th–75th percentile">Middle half</th>
                <th className="r">Min – max</th>
                <th className="r">Sales</th>
                <th className="r" title="Real’s own “Premium ×” — its meaning is not verified, so it is shown but never used in any calculation here">Premium ×</th>
                <th className="r">In auction</th>
                <th className="r">Seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const old = r.seenAt != null && real.now - r.seenAt > 7 * 86_400_000;
                return (
                  <tr key={`${r.name}|${r.rating}|${r.rarity}|${r.scope}`}>
                    <td>
                      <span className="font-medium">{r.name}</span>
                      <div className="text-[11px] text-muted">{r.rating} {capWord(r.rarity.toLowerCase())} · {r.serial}</div>
                    </td>
                    <td className="text-xs text-muted">{r.scope ?? '?'} · {r.window ?? '?'}</td>
                    <td className="r num" title={`Real marketplace (captured by you, ${r.seenAt ? ago(r.seenAt, real.now) : 'unknown age'})`}>{rax(r.median)}</td>
                    <td className="r num">{rax(r.medianPerRating)}</td>
                    <td className="r num">{r.q1 != null && r.q3 != null ? `${rax(r.q1)} – ${rax(r.q3)}` : '—'}</td>
                    <td className="r num">{r.min != null && r.max != null ? `${rax(r.min)} – ${rax(r.max)}` : '—'}</td>
                    <td className="r num">{r.totalSales != null ? <span className={r.totalSales < MIN_REF_SALES ? 'text-amber' : ''}>{r.totalSales.toLocaleString('en-US')}</span> : '—'}</td>
                    <td className="r num text-muted">{r.premium != null ? `${dec(r.premium, 2)}×` : '—'}</td>
                    <td className="r num">
                      {r.inAuction ? (
                        <span title={`Current bid ${r.inAuction.bid} Rax = ${dec(r.inAuction.perRating, 1)} per rating`}>
                          {rax(r.inAuction.bid)}
                          {r.medianPerRating ? <span className={`ml-1 text-[11px] ${r.inAuction.perRating > r.medianPerRating ? 'text-amber' : 'text-emerald'}`}>{pct((r.inAuction.perRating / r.medianPerRating - 1) * 100, 0)}</span> : null}
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`r text-xs ${old ? 'text-amber' : 'text-muted'}`}>{r.seenAt ? ago(r.seenAt, real.now) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Each live auction’s current bid against the fair value its real reference implies (above the line = bid over fair). */
export function BidVsFairScatter({ real }: { real: RealMarketState }) {
  const pts = useMemo(() => bidVsFair(real.radar), [real.radar]);
  const live = real.radar.filter((i) => i.status.state === 'live').length;
  const max = Math.max(10, ...pts.flatMap((p) => [p.bid, p.fair])) * 1.08;
  const kinds = [...new Set(pts.map((p) => p.kind))];
  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <div>
          <h2>Bid vs fair value <span className="num text-xs font-normal text-muted">({pts.length} of {live} live auctions)</span></h2>
          <p className="text-[11px] font-normal text-muted">Each dot is a live auction: its current bid (up) against what its reference price per rating implies the card is worth (across). Above the diagonal = bid over fair. Only auctions whose reference rests on ≥ {MIN_REF_SALES} sales are drawn.</p>
        </div>
        <span className="chip-emerald">{real.label}</span>
      </div>
      {pts.length === 0 ? (
        <Empty title="No live auction has a trustworthy reference yet">{live ? `${live} live auctions are captured, but none has a reference price from ≥ ${MIN_REF_SALES} sales. Open “Market data” on those cards (Card view) to give them one.` : 'Capture some Marketplace auctions and open Market data on them.'}</Empty>
      ) : (
        <>
          <div className="h-[320px] px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 18, left: 0 }}>
                <CartesianGrid stroke="#232D3F" strokeDasharray="3 3" />
                <XAxis type="number" dataKey="fair" name="Fair value" domain={[0, Math.ceil(max)]} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" label={{ value: 'Fair value implied by the reference (Rax)', position: 'insideBottom', offset: -8, fill: '#9CA3AF', fontSize: 11 }} />
                <YAxis type="number" dataKey="bid" name="Current bid" domain={[0, Math.ceil(max)]} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" width={52} label={{ value: 'Current bid (Rax)', angle: -90, position: 'insideLeft', fill: '#9CA3AF', fontSize: 11 }} />
                <ZAxis range={[60, 60]} />
                <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.ceil(max), y: Math.ceil(max) }]} stroke="#F59E0B" strokeDasharray="6 4" ifOverflow="extendDomain" />
                <Tooltip
                  cursor={{ strokeDasharray: '3 3', stroke: '#3B82F6' }}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as BidFairPoint | undefined;
                    if (!active || !p) return null;
                    return (
                      <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
                        <div className="text-sm font-semibold">{p.label}</div>
                        <div className="num text-muted">{p.sport}</div>
                        <div className="num">bid {rax(p.bid)} · fair {dec(p.fair, 1)}</div>
                        <div className={`num ${p.premium >= 40 ? 'text-amber' : 'text-muted'}`}>{pct(p.premium, 0)} vs reference</div>
                        <div className="text-muted">{REF_SHORT[p.kind]} · {p.n.toLocaleString('en-US')} {p.kind === 'live-auctions' ? 'live bids' : 'sales'}</div>
                      </div>
                    );
                  }}
                />
                {kinds.map((k) => (
                  <Scatter key={k} name={REF_SHORT[k]} data={pts.filter((p) => p.kind === k)} fill={KIND_COLOR[k]} fillOpacity={0.85} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-2 text-[11px] text-muted">
            {kinds.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: KIND_COLOR[k] }} /> reference: {REF_SHORT[k]}
              </span>
            ))}
            <span>Fair value = reference per rating × the card’s rating.</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Daily median price per rating (with the day’s range) and how many sales were captured that day, for one card or pool. Days without a sale stay gaps. */
export function RealDailyHistory({ name, obs, perRating, label }: { name: string; obs: SaleObs[]; perRating: boolean; label: string }) {
  const rows = useMemo(() => dailyAggregate(obs).map((d) => ({ ...d, range: [d.minPpr, d.maxPpr] as [number, number] })), [obs]);
  const fmt = (t: number) => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <div>
          <h2>{name} — daily median price per rating</h2>
          <p className="text-[11px] font-normal text-muted">One point per UTC day that has a captured sale: the median of price ÷ rating{perRating ? ' across the pooled cards' : ''}, the day’s lowest–highest, and the number of sales captured. {label}.</p>
        </div>
        <span className="num text-xs text-muted">{rows.length} day{rows.length === 1 ? '' : 's'} · {obs.length} sales</span>
      </div>
      <div className="h-[220px] px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#232D3F" strokeDasharray="3 3" />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin - 43200000', 'dataMax + 43200000']} tickFormatter={fmt} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" minTickGap={28} />
            <YAxis domain={['auto', 'auto']} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" width={48} tickFormatter={(v: number) => dec(v, 0)} />
            <Tooltip
              content={({ active, payload }) => {
                const d = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                if (!active || !d) return null;
                return (
                  <div className="num rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 font-sans text-muted">{d.day} (UTC)</div>
                    median {dec(d.medianPpr, 1)} per rating · {rax(d.medianPrice)} Rax
                    <div className="text-muted">range {dec(d.minPpr, 1)} – {dec(d.maxPpr, 1)} · {d.n} sale{d.n === 1 ? '' : 's'} · {rax(d.raxVolume)} Rax</div>
                  </div>
                );
              }}
            />
            <Area dataKey="range" stroke="none" fill="#3B82F6" fillOpacity={0.15} isAnimationActive={false} />
            <Line dataKey="medianPpr" stroke="#10B981" strokeWidth={2} dot={{ r: 3, fill: '#10B981' }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="h-[80px] px-2 pb-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin - 43200000', 'dataMax + 43200000']} hide />
            <YAxis width={48} tick={{ fill: '#9CA3AF', fontSize: 10 }} stroke="#232D3F" allowDecimals={false} />
            <Bar dataKey="n" fill="#F59E0B" fillOpacity={0.65} barSize={14} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Bars: sales captured per day (what you saw in Real’s recent-activity list, not the market’s total volume).</div>
    </div>
  );
}
