import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buildCalendar, buildPortfolio, payoutScale, type DayCell } from '../../../shared/otdEfficiency';
import { OTD_SPORTS, type OtdCardRecord, type OtdSport } from '../../../shared/otdSnapshot';
import { rax } from '../../lib/format';
import { Loading } from '../ui/StateBlock';
import { buildLevels, effParams } from '../tab7-efficiency/model';
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
  const [year] = useState(now.getFullYear());
  const [claims, setClaims] = useState<2 | 3>(2);
  const [source, setSource] = useState<Source>('mine');
  const [sportsSel, setSportsSel] = useState<OtdSport[]>([]);
  const [showOverlaps, setShowOverlaps] = useState(false);
  const [sel, setSel] = useState<number>(keyOf(now.getMonth() + 1, now.getDate()));

  const all = snap.data?.cards;
  const available = useMemo(() => [...new Set((all ?? []).map((c) => c.sport))].sort((a, b) => OTD_SPORTS.indexOf(a) - OTD_SPORTS.indexOf(b)), [all]);
  const sportsOn = useMemo(() => new Set<OtdSport>(sportsSel.length ? sportsSel : available), [sportsSel, available]);
  const byId = useMemo(() => new Map((all ?? []).map((c) => [c.id, c])), [all]);
  const levels = useMemo(() => buildLevels(all ?? [], s), [all, s.rarity, s.autoMin, s.multOverride, s.rate, s.overrides, s.ownedLevels]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = useMemo(() => new Date(Date.UTC(year, month - 1, 1)), [year, month]);
  const params = useMemo(() => ({ ...effParams(s, levels, sportsOn, { start, days }), claimsPerDay: claims }), [s, levels, sportsOn, start, days, claims]);

  const ownedCards = useMemo(() => Object.keys(s.ownedLevels).map((id) => byId.get(id)).filter((c): c is OtdCardRecord => !!c), [s.ownedLevels, byId]);
  const best = useMemo(() => {
    if (source !== 'best' || !all) return [];
    const p = { ...effParams(s, levels, sportsOn), claimsPerDay: claims };
    return buildPortfolio(all, p, { budget: s.budget, maxCards: s.maxCards, minMarginalRoi: 0, ownedIds: new Set(Object.keys(s.ownedLevels)) }).picks.map((x) => x.row.card);
  }, [source, all, s, levels, sportsOn, claims]);
  const shown = source === 'mine' ? ownedCards : best;

  const cal = useMemo(() => buildCalendar(shown, params), [shown, params]);
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
  const nav = (d: number) => setMonth((m) => ((m - 1 + d + 12) % 12) + 1);
  const sportSet = [...new Set([...selCells.map((c) => c.pool), ...suggestions.keys()])] as OtdSport[];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">OTD Calendar</h1>
          <p className="text-sm text-muted">What your cards pay on each day of the year, with the daily claim limit applied per sport. Anniversaries repeat every year.</p>
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
              <button aria-pressed={claims === 3} onClick={() => setClaims(3)} title="Pro's extra claim is only granted if you win its poll — this shows the best case">3 claims (Pro, best case)</button>
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

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <div className="panel">
                <div className="flex items-center justify-between px-3 py-2">
                  <button className="btn-ghost btn-sm" onClick={() => nav(-1)} aria-label="Previous month"><ChevronLeft size={14} /></button>
                  <div className="text-center">
                    <div className="text-sm font-semibold">{MONTHS[month - 1]} {year}</div>
                    <div className="num text-xs text-emerald">{rax(monthTotal)} Rax</div>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={() => nav(1)} aria-label="Next month"><ChevronRight size={14} /></button>
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
                      <button key={i} onClick={() => setSel(k)} aria-pressed={on} className={`min-h-[56px] rounded-md border px-1.5 py-1 text-left transition-colors ${on ? 'border-action bg-action/10' : 'border-line hover:bg-hover'}`} title={waste > 0 ? `${rax(waste)} Rax of payouts exceed the ${claims}-claim limit` : undefined}>
                        <div className="flex items-center justify-between text-[10px] text-muted"><span>{d}</span>{waste > 0 && <span className="text-amber">●</span>}</div>
                        <div className={`num text-xs font-semibold ${tot > 0 ? 'text-emerald' : 'text-muted/40'}`}>{tot > 0 ? rax(tot) : '—'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {showOverlaps && (
                <div className="panel">
                  <div className="panel-hd"><h2>Overlaps in {MONTHS[month - 1]}</h2><span className="hint">days where more cards pay than the {claims} claims allow</span></div>
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
                                <tr key={p.cardId} className={i >= claims ? 'opacity-50' : ''}>
                                  <td>{c?.name} <span className="num text-xs text-muted">{c?.seasonLabel}</span> <span className="text-[11px] text-muted">{levels.get(p.cardId)?.key}</span></td>
                                  <td className="r num font-semibold">{rax(p.value)}</td>
                                  <td className="r">{i < claims ? <span className="chip-emerald">claim</span> : <span className="chip-amber">wasted</span>}</td>
                                </tr>
                              );
                            })}
                            {Array.from({ length: Math.max(0, claims - cell.payouts.length) }, (_, i) => <tr key={`e${i}`}><td className="text-muted">open claim slot</td><td /><td /></tr>)}
                          </tbody></table>
                        ) : <p className="hint">No card of yours pays here — {claims} open claim slots.</p>}
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
