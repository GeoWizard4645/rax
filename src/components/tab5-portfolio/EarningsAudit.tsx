import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { RARITIES, RARITY_MULT, fmtRax } from '../../../shared/formulas';
import { planDay, type OwnedCard } from '../../../shared/otd';
import { bestOfferFor, owedFor, RB_SPORTS, type RbSport } from '../../../shared/rateboard';
import { findFighter } from '../../../shared/ufc';
import { useRbBoard } from '../../hooks/useRbBoard';
import { useUfc } from '../../hooks/useUfc';
import UfcChip from '../ui/UfcChip';
import { useCollections } from '../../hooks/useRealUser';
import { useOTDCalendar, localMonthDay } from '../../hooks/useOTDCalendar';
import { load, save } from '../../lib/storage';
import type { Rarity } from '../../types/real';
import { Empty, Spinner } from '../ui/StateBlock';
import { Stat } from '../ui/Stat';
import { Explain } from '../ui/Explain';

const SPORTS_PULL: RbSport[] = ['NFL', 'CFB', 'UFC', 'FC'];
const KEY = 'rax_audit_rows_v1';

interface Row {
  id: string;
  sport: RbSport;
  name: string;
  copies: number;
  rarity: Rarity;
  /** Base Rax this card earns from today's live game, per copy — as shown in the app. */
  liveBase: number;
  /** Summed rating of the pulled copies (Rateboard's "value"), when known. */
  value?: number;
}

const rowId = (sport: string, name: string) => `${sport}|${name.toLowerCase()}`;

/**
 * Daily earnings audit. Holdings come from the collection pull (or are typed in), each with a rarity-tier
 * adjuster. OTD earnings are computed for real from the OTD dataset and your Tab 4 cards. Live-game earnings
 * need a per-game base yield that no feed supplies here, so you enter it per card from the app.
 */
export default function EarningsAudit() {
  const col = useCollections();
  const otd = useOTDCalendar();
  const { board } = useRbBoard();
  const ufc = useUfc(true);
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<Row[]>(() => load<Row[]>(KEY, []));
  const [defaultRarity, setDefaultRarity] = useState<Rarity>('Common');
  const md = localMonthDay();

  const persist = (r: Row[]) => (setRows(r), save(KEY, r));

  const importPulled = () => {
    const next = [...rows];
    for (const [sport, players] of Object.entries(col.collections) as Array<[RbSport, NonNullable<(typeof col.collections)[RbSport]>]>) {
      for (const p of players) {
        const id = rowId(sport, p.name);
        if (!next.some((r) => r.id === id)) next.push({ id, sport, name: p.name, copies: p.total, rarity: defaultRarity, liveBase: 0, value: p.totalValue });
      }
    }
    persist(next);
  };
  const patch = (id: string, p: Partial<Row>) => persist(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const owned = useMemo(() => load<OwnedCard[]>('rax_otd_owned_v1', []), []);
  const plan = useMemo(() => planDay(owned, otd.games, md, otd.sportMult), [owned, otd.games, otd.sportMult, md]);
  const live = rows.reduce((n, r) => n + r.liveBase * RARITY_MULT[r.rarity] * r.copies, 0);
  const total = live + plan.claimableTotal;
  const offers = useMemo(() => new Map(rows.map((r) => [r.id, board ? bestOfferFor(board, r.sport, r.name) : null])), [rows, board]);
  const rbHaul = rows.reduce((n, r) => { const o = offers.get(r.id); return o && r.value ? n + owedFor(r.value, o.rate) : n; }, 0);
  const pulled = Object.values(col.collections).some((l) => l && l.length);

  return (
    <div className="space-y-4">
      <Explain title="What this can and can't see">
        <p>Today's earnings = <b className="text-head">live-game yield</b> (per card, × rarity tier × copies) + <b className="text-head">OTD claims</b> (your top 2 per sport from Tab 4's cards, computed from the OTD dataset).</p>
        <p>Real doesn't publish another player's per-game Rax, so the audit can't be run blind on any username: pulling a username fills in their holdings, and you enter each card's live-game base yield from the app. The rarity adjuster then applies the tier multipliers: {RARITIES.map((r) => `${r} ${RARITY_MULT[r].toFixed(1)}×`).join(' · ')}.</p>
      </Explain>

      <form className="panel flex flex-wrap items-end gap-3 p-3" onSubmit={(e) => { e.preventDefault(); if (input.trim()) void col.load(input, SPORTS_PULL); }}>
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="au-user">Username (pull their holdings)</label>
          <input id="au-user" className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Any Real App username" autoComplete="off" spellCheck={false} />
        </div>
        <div>
          <label className="label" htmlFor="au-rar">Default rarity</label>
          <select id="au-rar" className="field" value={defaultRarity} onChange={(e) => setDefaultRarity(e.target.value as Rarity)}>{RARITIES.map((r) => <option key={r}>{r}</option>)}</select>
        </div>
        <button className="btn-primary" disabled={!input.trim() || !!col.pulling}>{col.pulling ? <Spinner /> : <Search size={14} />} Pull holdings</button>
        {pulled && !col.pulling && <button type="button" className="btn-ghost" onClick={importPulled}>Add {Object.values(col.collections).reduce((n, l) => n + (l?.length ?? 0), 0)} pulled players to audit</button>}
        {col.pulling && <span className="w-full text-xs text-muted">{col.progress?.waitSec ? `Starting ${RB_SPORTS[col.pulling]} pull in ${col.progress.waitSec}s…` : `Fetching ${RB_SPORTS[col.pulling]} cards…`}</span>}
        {Object.entries(col.errors).map(([s, m]) => <span key={s} className="w-full text-xs text-danger">{s}: {m}</span>)}
      </form>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Total today" value={fmtRax(total)} sub="Rax" tone="emerald" />
        <Stat label="Live games" value={fmtRax(live)} sub={`${rows.filter((r) => r.liveBase > 0).length} cards playing`} tone="blue" />
        <Stat label="OTD claims" value={fmtRax(plan.claimableTotal)} sub={owned.length ? `top 2/sport · ${md}` : 'add cards in Tab 4'} tone="amber" />
        <Stat label="OTD left on table" value={fmtRax(plan.leftOnTable)} sub="outside the top 2" />
        <Stat label="Rateboard haul" value={fmtRax(rbHaul)} sub={board ? 'sell every priced card at its best live offer' : 'board unavailable'} tone="blue" />
      </div>
      {total > 0 && (
        <div className="panel p-3" aria-label="Live vs OTD split">
          <div className="mb-1 flex justify-between text-xs text-muted"><span>Live games {Math.round((live / total) * 100)}%</span><span>OTD claims {Math.round((plan.claimableTotal / total) * 100)}%</span></div>
          <div className="flex h-2.5 overflow-hidden rounded bg-base"><div className="bg-action" style={{ width: `${(live / total) * 100}%` }} /><div className="bg-amber" style={{ width: `${(plan.claimableTotal / total) * 100}%` }} /></div>
        </div>
      )}

      <div className="panel overflow-hidden">
        <div className="panel-hd"><h2>Holdings <span className="num text-xs font-normal text-muted">({rows.length})</span></h2>{rows.length > 0 && <button className="btn-ghost btn-sm" onClick={() => persist([])}>Clear all</button>}</div>
        {rows.length === 0 ? <Empty title="No holdings yet">Pull a username above, then add the pulled players here.</Empty> : (
          <div className="max-h-[520px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 bg-surface"><tr><th>Player</th><th className="r">Copies</th><th>Rarity tier</th><th className="r">Live base Rax / copy</th><th className="r">Tier ×</th><th className="r">Earns today</th><th className="r">Rateboard</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td><span className="font-medium">{r.name}</span> <span className="chip-muted">{r.sport}</span></td>
                    <td className="r num">{r.copies}</td>
                    <td><select className="field !w-auto !py-0.5" value={r.rarity} onChange={(e) => patch(r.id, { rarity: e.target.value as Rarity })} aria-label={`Rarity for ${r.name}`}>{RARITIES.map((x) => <option key={x}>{x}</option>)}</select></td>
                    <td className="r"><input className="field num !w-24 !py-0.5 text-right" inputMode="decimal" value={r.liveBase || ''} placeholder="0" onChange={(e) => patch(r.id, { liveBase: Math.max(0, +e.target.value || 0) })} aria-label={`Live base Rax for ${r.name}`} /></td>
                    <td className="r num text-muted">{RARITY_MULT[r.rarity].toFixed(1)}×</td>
                    <td className="r num font-semibold text-emerald">{fmtRax(r.liveBase * RARITY_MULT[r.rarity] * r.copies)}</td>
                    <td className="r num text-xs">
                      {(() => {
                        const o = offers.get(r.id);
                        const f = r.sport === 'UFC' ? findFighter(ufc.index, r.name) : null;
                        return (
                          <>
                            {o ? <span title={`${o.house ? 'House buyer' : o.buyer} is paying ${o.rate}/1`}>{o.rate}/1{r.value ? <span className="text-muted"> · {owedFor(r.value, o.rate).toLocaleString('en-US')}</span> : null}</span> : <span className="text-muted">no offer</span>}
                            {f && <> <UfcChip f={f} /></>}
                          </>
                        );
                      })()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
