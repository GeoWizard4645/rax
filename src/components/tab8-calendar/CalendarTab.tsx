import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buildCalendar, buildPortfolio, payoutScale, sportCeilings, type DayCell } from '../../../shared/otdEfficiency';
import { OTD_SPORTS, type OtdCardRecord, type OtdSport } from '../../../shared/otdSnapshot';
import { useCalendarSurface } from '../../agent/surfaces/useCalendarSurface';
import { rax } from '../../lib/format';
import { Loading } from '../ui/StateBlock';
import { buildPackIndex } from '../../../shared/raxedgePackOdds';
import { useRaxEdge } from '../../lib/raxedgeStore';
import { buildLevels, effParams, withCustom } from '../tab7-efficiency/model';
import MultiYearPanel from './MultiYearPanel';
import { useEffState } from '../tab7-efficiency/useEffState';
import { useOtdSnapshot } from '../tab7-efficiency/useOtdSnapshot';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const keyOf = (month: number, day: number) => month * 100 + day;

type Source = 'mine' | 'best';

/**
 * OTD calendar, in the spirit of RaxEdge's OTD view: the Rax your cards pay on every day of a month, with the claim
 * limit (2, or 3 with Pro's bonus) applied per sport, overlap days flagged, and the best cards you could add for any day.
 * Uses the same set of owned cards as Tab 7's "My cards".
 */
export default function CalendarTab() {
  const { s, set } = useEffState();
  const snap = useOtdSnapshot(s.method);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const firstYear = now.getFullYear();
  const [year, setYear] = useState(firstYear);
  const lastYear = firstYear + 11; // OTD runs forever; the view spans 12 years from this one
  const [claims, setClaims] = useState<2 | 3>(2);
  const [source, setSource] = useState<Source>('mine');
  const [sportsSel, setSportsSel] = useState<OtdSport[]>([]);
  const [showOverlaps, setShowOverlaps] = useState(false);
  const [sel, setSel] = useState<number>(keyOf(now.getMonth() + 1, now.getDate()));

  const all = useMemo(() => (snap.data ? withCustom(snap.data.cards, s.customCards) : undefined), [snap.data, s.customCards]);
  const available = useMemo(() => [...new Set((all ?? []).map((c) => c.sport))].sort((a, b) => OTD_SPORTS.indexOf(a) - OTD_SPORTS.indexOf(b)), [all]);
  const sportsOn = useMemo(() => new Set<OtdSport>(sportsSel.length ? sportsSel : available), [sportsSel, available]);
  const byId = useMemo(() => new Map((all ?? []).map((c) => [c.id, c])), [all]);
  const stored = useRaxEdge();
  const packIndex = useMemo(() => buildPackIndex(stored.packOdds?.players), [stored.packOdds]);
  const levels = useMemo(() => buildLevels(all ?? [], s, s.usePackRates ? packIndex : null), [all, s.rarity, s.autoMin, s.multOverride, s.rate, s.overrides, s.ownedLevels, s.usePackRates, s.packPrice, packIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = useMemo(() => new Date(Date.UTC(year, month - 1, 1)), [year, month]);
  // 2 guaranteed claims per sport per day; "3 claims" adds Pro's single bonus claim across all sports (best case: poll won).
  const bonus = claims === 3 ? 1 : 0;
  const params = useMemo(() => ({ ...effParams(s, levels, sportsOn, { start, days }), claimsPerDay: 2, bonusPerDay: bonus }), [s, levels, sportsOn, start, days, bonus]);
  const yearWin = useMemo(() => ({ start: new Date(Date.UTC(year, 0, 1)), days: 366 }), [year]);

  const ownedCards = useMemo(() => Object.keys(s.ownedLevels).map((id) => byId.get(id)).filter((c): c is OtdCardRecord => !!c), [s.ownedLevels, byId]);
  // The preview is optimised over the WHOLE year (not the Tab 7 timeframe) and independent of the 2/3-claims toggle, so the
  // month you look at and the 2-vs-3 comparison always use the same set of cards.
  const best = useMemo(() => {
    if (source !== 'best' || !all) return [];
    const p = { ...effParams(s, levels, sportsOn, yearWin), claimsPerDay: 2 };
    return buildPortfolio(all, p, { budget: s.budget, maxCards: s.maxCards, minMarginalRoi: s.minRoi, ownedIds: new Set(Object.keys(s.ownedLevels)), overlapMode: s.overlapMode }).picks.map((x) => x.row.card);
  }, [source, all, s, levels, sportsOn, yearWin]);
  const shown = source === 'mine' ? ownedCards : best;

  const cal = useMemo(() => buildCalendar(shown, params), [shown, params]);
  const yearParams = useMemo(() => ({ ...effParams(s, levels, sportsOn, yearWin), claimsPerDay: 2, bonusPerDay: bonus }), [s, levels, sportsOn, yearWin, bonus]);
  const yearStats = useMemo(() => {
    const ycal = buildCalendar(shown, yearParams);
    const claimed = ycal.reduce((n, c) => n + c.claimed, 0);
    const guaranteed = claimed - ycal.reduce((n, c) => n + c.bonus, 0);
    const ceiling = all ? sportCeilings(all, yearParams).reduce((n, c) => n + c.total, 0) : 0;
    const smallGames = shown.reduce((n, c) => n + Math.max(0, c.annual - c.days.reduce((a, d) => a + d[1], 0)) * payoutScale(c, yearParams), 0);
    return { claimed, guaranteed, ceiling, smallGames, waste: ycal.reduce((n, c) => n + c.wasted, 0) };
  }, [shown, yearParams, all]);
  const byDay = useMemo(() => {
    const m = new Map<number, DayCell[]>();
    for (const c of cal) (m.get(c.mmdd) ?? m.set(c.mmdd, []).get(c.mmdd)!).push(c);
    return m;
  }, [cal]);
  const dayTotal = (k: number) => (byDay.get(k) ?? []).reduce((n, c) => n + c.claimed, 0);
  const dayWaste = (k: number) => (byDay.get(k) ?? []).reduce((n, c) => n + c.wasted, 0);
  const monthTotal = cal.reduce((n, c) => n + c.claimed, 0);
  const overlapDays = useMemo(() => [...byDay.keys()].filter((k) => dayWaste(k) > 0).sort((a, b) => dayWaste(b) - dayWaste(a)), [byDay]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const cells: Array<number | null> = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  const selDay = sel % 100;
  const selMonth = Math.floor(sel / 100);
  const selCells = selMonth === month ? byDay.get(sel) ?? [] : [];

  // best cards you could ADD for the selected day, per sport
  const suggestions = useMemo(() => {
    if (!all || selMonth !== month) return new Map<OtdSport, Array<{ card: OtdCardRecord; value: number }>>();
    const ownedIds = new Set(shown.map((c) => c.id));
    const out = new Map<OtdSport, Array<{ card: OtdCardRecord; value: number }>>();
    for (const c of all) {
      if (!sportsOn.has(c.sport) || ownedIds.has(c.id)) continue;
      const d = c.days.find((x) => x[0] === sel);
      if (!d) continue;
      const value = d[1] * payoutScale(c, params);
      if (value <= 0) continue;
      (out.get(c.sport) ?? out.set(c.sport, []).get(c.sport)!).push({ card: c, value });
    }
    for (const l of out.values()) l.sort((a, b) => b.value - a.value).splice(4);
    return out;
  }, [all, shown, sel, selMonth, month, sportsOn, params]);

  const add = (c: OtdCardRecord) => set({ ownedLevels: { ...s.ownedLevels, [c.id]: levels.get(c.id)?.key ?? 'Iconic' } });
  const remove = (id: string) => { const o = { ...s.ownedLevels }; delete o[id]; set({ ownedLevels: o }); };
  const nav = (d: number) => {
    let m = month + d;
    let y = year;
    if (m < 1) (m = 12), y--;
    if (m > 12) (m = 1), y++;
    if (y < firstYear || y > lastYear) return;
    setMonth(m);
    setYear(y);
  };
  const atStart = year === firstYear && month === 1;
  const atEnd = year === lastYear && month === 12;
  const sportSet = [...new Set([...selCells.map((c) => c.pool), ...suggestions.keys()])] as OtdSport[];

  useCalendarSurface({ s, set, month, setMonth, year, setYear, firstYear, lastYear, claims, setClaims, source, setSource, sportsSel, setSportsSel, ownedCards: ownedCards.length, shownCards: shown.length, monthTotal, overlapDays: overlapDays.length, yearStats });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">OTD Calendar</h1>
          <p className="text-sm text-muted">What your cards pay on each day, with the daily claim limit applied per sport. Anniversaries repeat every year, so you can browse up to 12 years ahead and project the total.</p>
        </div>
        <span className="chip-blue" title="Real's per-game Rax, snapshotted from Rateboard's logs — see Tab 7 for the method">SNAPSHOT · {snap.data ? snap.data.generatedAt.slice(0, 10) : '…'}</span>
      </div>

      {snap.loading && <Loading label="Loading the dataset…" />}
      {snap.error && <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{snap.error}</div>}

      {snap.data && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="seg" role="group" aria-label="Cards shown">
              <button aria-pressed={source === 'mine'} onClick={() => setSource('mine')}>My cards ({ownedCards.length})</button>
              <button aria-pressed={source === 'best'} onClick={() => setSource('best')} title="Preview: my cards plus Tab 7's best combination for its budget">Best combination (preview)</button>
            </div>
            <div className="seg" role="group" aria-label="Claims per day">
              <button aria-pressed={claims === 2} onClick={() => setClaims(2)}>2 claims</button>
              <button aria-pressed={claims === 3} onClick={() => setClaims(3)} title="Real gives 2 guaranteed claims per sport. Pro adds ONE more per day, across all sports, only if you win its poll — this shows the best case.">3 claims (2 per sport + Pro bonus)</button>
            </div>
            <div className="seg" role="group" aria-label="Overlap priority" title="How the Best-combination preview chooses cards">
              <button aria-pressed={s.overlapMode === 'earnings'} onClick={() => set({ overlapMode: 'earnings' })}>Max earnings</button>
              <button aria-pressed={s.overlapMode === 'min-overlap'} onClick={() => set({ overlapMode: 'min-overlap' })}>Minimize overlap</button>
            </div>
            <button className={showOverlaps ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setShowOverlaps(!showOverlaps)}><AlertTriangle size={12} /> Overlaps {overlapDays.length}</button>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Sports">
              {available.map((sp) => (
                <button key={sp} aria-pressed={sportsOn.has(sp)} onClick={() => { const cur = sportsSel.length ? sportsSel : available; const next = cur.includes(sp) ? cur.filter((x) => x !== sp) : [...cur, sp]; setSportsSel(next.length === available.length ? [] : next); }} className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${sportsOn.has(sp) ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:bg-hover'}`}>{sp}</button>
              ))}
            </div>
          </div>

          {source === 'mine' && ownedCards.length === 0 && (
            <div className="rounded-md border border-line px-3 py-3 text-sm text-muted">
              Your set is empty, so the calendar is blank. Add cards from <Link to="/efficiency">Tab 7 → My cards</Link> (username pull or pasted passes), or switch to <b className="text-head">Best combination (preview)</b> to see what an efficient set would pay.
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div className="panel px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-muted">{year} claimable</div><div className="num text-lg font-semibold text-emerald">{rax(yearStats.claimed)}</div><div className="text-[11px] text-muted">{claims === 3 ? `incl. ${rax(yearStats.claimed - yearStats.guaranteed)} Pro bonus` : '2 per sport per day'}</div></div>
            <div className="panel px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-muted">Of the ceiling</div><div className="num text-lg font-semibold">{yearStats.ceiling > 0 ? `${((yearStats.guaranteed / yearStats.ceiling) * 100).toFixed(1)}%` : '—'}</div><div className="text-[11px] text-muted">if you held every card: {rax(yearStats.ceiling)}</div></div>
            <div className="panel px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-muted">Wasted on overlap</div><div className={`num text-lg font-semibold ${yearStats.waste > 0 ? 'text-amber' : ''}`}>{rax(yearStats.waste)}</div><div className="text-[11px] text-muted">{overlapDays.length} overlap day(s) in {MONTHS[month - 1]}</div></div>
            <div className="panel px-3 py-2"><div className="text-[11px] uppercase tracking-wider text-muted">Small games not on the calendar</div><div className="num text-lg font-semibold text-muted">+{rax(yearStats.smallGames)}</div><div className="text-[11px] text-muted">games under 3 General rax, per year</div></div>
          </div>
          {claims === 3 && yearStats.claimed - yearStats.guaranteed <= 0 && (
            <p className="hint">The Pro bonus claim takes the best payout your 2-per-sport claims left unclaimed. Your set has no spare payouts on any day, so it adds nothing yet — hold more cards than claim slots on some days and it will.</p>
          )}
          {source === 'best' && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-line px-3 py-2 text-xs text-muted">
              <span>Preview set is optimised over the whole of {year}, at <b className="text-head">{s.rarity === 'AUTO' ? 'auto' : s.rarity}</b>:</span>
              <label className="flex items-center gap-1">cards <input className="field num !w-16 !py-0.5" type="number" min={1} max={60} value={s.maxCards} onChange={(e) => set({ maxCards: Math.min(60, Math.max(1, +e.target.value || 1)) })} /></label>
              <label className="flex items-center gap-1">budget <input className="field num !w-28 !py-0.5" inputMode="numeric" value={s.budget} onChange={(e) => set({ budget: Math.max(0, +e.target.value.replace(/[^\d]/g, '') || 0) })} /></label>
              <span>(rarity, prices and sports come from Tab 7)</span>
            </div>
          )}

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <div className="panel">
                <div className="flex items-center justify-between px-3 py-2">
                  <button className="btn-ghost btn-sm" disabled={atStart} onClick={() => nav(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-sm font-semibold">{MONTHS[month - 1]}
                      <select className="field !w-auto !py-0 !px-1 text-sm font-semibold" value={year} onChange={(e) => setYear(+e.target.value)} aria-label="Year">
                        {Array.from({ length: 12 }, (_, i) => firstYear + i).map((y) => <option key={y} value={y}>{y}</option>)}
                      </select>
                    </div>
                    <div className="num text-xs text-emerald">{rax(monthTotal)} Rax this month</div>
                  </div>
                  <button className="btn-ghost btn-sm" disabled={atEnd} onClick={() => nav(1)} aria-label="Next month"><ChevronRight size={14} /></button>
                </div>
                <div className="grid grid-cols-7 gap-1 px-2 pb-2">
                  {DOW.map((d) => <div key={d} className="py-1 text-center text-[10px] font-semibold tracking-wider text-muted">{d}</div>)}
                  {cells.map((d, i) => {
                    if (d == null) return <div key={i} className="min-h-[56px] rounded-md bg-base/40" />;
                    const k = keyOf(month, d);
                    const tot = dayTotal(k);
                    const waste = dayWaste(k);
                    const on = k === sel;
                    return (
                      <button key={i} onClick={() => setSel(k)} aria-pressed={on} className={`min-h-[56px] rounded-md border px-1.5 py-1 text-left transition-colors ${on ? 'border-action bg-action/10' : 'border-line hover:bg-hover'}`} title={waste > 0 ? `${rax(waste)} Rax of payouts exceed the 2-claims-per-sport limit` : undefined}>
                        <div className="flex items-center justify-between text-[10px] text-muted"><span>{d}</span>{waste > 0 && <span className="text-amber">●</span>}</div>
                        <div className={`num text-xs font-semibold ${tot > 0 ? 'text-emerald' : 'text-muted/40'}`}>{tot > 0 ? rax(tot) : '—'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {showOverlaps && (
                <div className="panel">
                  <div className="panel-hd"><h2>Overlaps in {MONTHS[month - 1]}</h2><span className="hint">days where more cards pay than your 2 claims per sport allow</span></div>
                  {overlapDays.length === 0 ? <p className="hint px-3 py-4">No overlaps this month.</p> : (
                    <table className="tbl">
                      <thead><tr><th>Day</th><th className="r">You claim</th><th className="r">Wasted</th></tr></thead>
                      <tbody>{overlapDays.map((k) => (
                        <tr key={k} className="cursor-pointer" onClick={() => setSel(k)}><td>{MONTHS[month - 1].slice(0, 3)} {k % 100}</td><td className="r num text-emerald">{rax(dayTotal(k))}</td><td className="r num text-amber">{rax(dayWaste(k))}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                </div>
              )}

              <MultiYearPanel cards={shown} params={params} levels={levels} firstYear={firstYear} />

              <div className="panel">
                <div className="panel-hd"><h2>{MONTHS[selMonth - 1]} {selDay}</h2><span className="num text-xs text-emerald">{rax(dayTotal(sel))} Rax claimed</span></div>
                <div className="panel-bd space-y-3">
                  {sportSet.length === 0 && <p className="hint">Nothing pays on this day for your set{selMonth !== month ? ' (pick a day in the month shown)' : ''}.</p>}
                  {sportSet.map((sp) => {
                    const cell = selCells.find((c) => c.pool === sp);
                    const sug = suggestions.get(sp) ?? [];
                    return (
                      <div key={sp}>
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">{sp}</div>
                        {cell && cell.payouts.length > 0 ? (
                          <table className="tbl"><tbody>
                            {cell.payouts.map((p, i) => {
                              const c = byId.get(p.cardId);
                              return (
                                <tr key={p.cardId} className={i >= 2 && !p.bonus ? 'opacity-50' : ''}>
                                  <td>{c?.name} <span className="num text-xs text-muted">{c?.seasonLabel}</span> <span className="text-[11px] text-muted">{levels.get(p.cardId)?.key}</span></td>
                                  <td className="r num font-semibold">{rax(p.value)}</td>
                                  <td className="r">{i < 2 ? <span className="chip-emerald">claim</span> : p.bonus ? <span className="chip-blue" title="Pro bonus claim">bonus claim</span> : <span className="chip-amber">wasted</span>}</td>
                                </tr>
                              );
                            })}
                            {Array.from({ length: Math.max(0, 2 - cell.payouts.length) }, (_, i) => <tr key={`e${i}`}><td className="text-muted">open claim slot</td><td /><td /></tr>)}
                          </tbody></table>
                        ) : <p className="hint">No card of yours pays here — 2 open claim slots.</p>}
                        {sug.length > 0 && (
                          <div className="mt-1 rounded-md border border-line/70 bg-base/40 px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wider text-muted">best cards to add for this day</div>
                            {sug.map((x) => (
                              <div key={x.card.id} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                                <span>{x.card.name} <span className="num text-muted">{x.card.seasonLabel}</span></span>
                                <span className="flex items-center gap-2"><span className="num text-emerald">{rax(x.value)}</span><button className="btn-ghost btn-sm" onClick={() => add(x.card)} aria-label={`Add ${x.card.name}`}><Plus size={11} /></button></span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="panel h-fit">
              <div className="panel-hd"><h2>Passes ({shown.length})</h2>{source === 'mine' && ownedCards.length > 0 && <span className="hint">level = rarity you hold</span>}</div>
              <div className="max-h-[640px] overflow-auto">
                {shown.length === 0 ? <p className="hint px-3 py-6 text-center">No passes.</p> : (
                  <ul className="divide-y divide-line/60">
                    {shown.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{c.name} <span className="chip-muted">{c.sport}</span> <span className="num text-muted">{c.seasonLabel}</span></div>
                          <div className="text-muted">{levels.get(c.id)?.key} · {rax(c.annual)} General · <span className="text-emerald">{rax(c.annual * payoutScale(c, params))}/yr</span></div>
                        </div>
                        {s.ownedLevels[c.id] ? <button className="btn-ghost btn-sm" onClick={() => remove(c.id)} aria-label={`Remove ${c.name}`}><Trash2 size={12} /></button> : <button className="btn-ghost btn-sm" onClick={() => add(c)} aria-label={`Add ${c.name}`}><Plus size={12} /></button>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </>
      )}
      <p className="hint">Payouts use the rarity set in Tab 7 for cards you add (and each owned card's own level). Prices aren't shown here. Not affiliated with RaxEdge — this is an independent view built on public data.</p>
    </div>
  );
}
