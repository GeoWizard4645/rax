import { useState } from 'react';
import { Upload } from 'lucide-react';
import { useMemo } from 'react';
import { useOTDCalendar, localMonthDay } from '../../hooks/useOTDCalendar';
import { useCardGames } from '../../hooks/useRax';
import { topCards } from '../../../shared/rax';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { SPORTS } from '../../../shared/formulas';
import { DataBadge } from '../ui/DataBadge';
import { Explain } from '../ui/Explain';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import BreakEvenCalc from './BreakEvenCalc';
import CompareTool from './CompareTool';
import DailyOptimizer from './DailyOptimizer';
import HistoricalTable from './HistoricalTable';

type View = 'daily' | 'roi' | 'compare' | 'catalog';

export default function OtdTab() {
  const notify = useToast();
  const [md, setMd] = useState(localMonthDay());
  const o = useOTDCalendar(md);
  const [view, setView] = useState<View>('daily');
  const live = o.source === 'live';
  // ROI / compare need each card's whole calendar, not just today's game: load it for the biggest anniversaries today.
  const candidates = useMemo(() => (live ? topCards(o.games, 6) : []), [live, o.games]);
  const cardGames = useCardGames(candidates, live && (view === 'roi' || view === 'compare'));
  const roiGames = live ? cardGames.data ?? [] : o.games;
  const [text, setText] = useState('');
  const [errs, setErrs] = useState<string[]>([]);

  const doImport = (t: string) => {
    const r = o.importGames(t);
    setErrs(r.errors.slice(0, 6));
    if (r.games.length) {
      notify(`Imported ${r.games.length.toLocaleString()} games${r.errors.length ? ` (${r.errors.length} rows skipped)` : ''}.`);
      setText('');
    } else notify('Nothing imported.', 'error');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">OTD Rax Master</h1>
          <p className="text-sm text-muted">Passive Rax from past-season cards on game anniversaries — optimise your two daily claims and find what to buy. Inspired by otdrax.vercel.app.</p>
        </div>
        <div className="flex items-center gap-2">
          <DataBadge source={o.source === 'sample' ? 'sample' : o.source === 'live' ? 'live' : 'imported'} note={o.source === 'sample' ? 'Synthetic historical games — the live feed was unreachable; import your own dataset below.' : o.source === 'live' ? "Live from Rateboard's Rax game logs" : 'Your imported dataset'} />
          {o.source === 'imported' && <span className="chip-blue">imported · {o.games.length.toLocaleString()} games</span>}
        </div>
      </div>

      {o.loading && <Loading label="Reading this date's games from Rateboard…" />}
      {o.source === 'sample' && !o.loading && (
        <>
          {o.liveError && <ErrorBlock message={`Couldn't load live games (${o.liveError}).`} onRetry={o.reloadLive} />}
          <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90">
            <b>Sample data.</b> The live game feed is unreachable, so a synthetic database (~{o.games.length.toLocaleString()} games) is used. The yield maths, 2-claim optimizer, ROI and comparison are real — retry, or import a CSV/JSON below.
          </div>
        </>
      )}
      {live && (
        <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">
          <b className="text-head">Live game data.</b> {o.games.length.toLocaleString()} of the biggest games played on {md} across every collected season (NFL, NBA, MLB, NHL, college football and basketball, golf), from Rateboard's Rax logs. "Base Rax" is Rax's per-game figure; soccer, WNBA and UFC aren't covered. The ROI and Compare views load each card's full calendar for today's top anniversaries.
        </div>
      )}
      {o.derivedBase && <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">Your file had no base-Rax column, so base Rax was assumed to be rating × 10.</div>}

      <Explain title="How yield is calculated">
        <p><span className="num text-head">Final yield = base Rax × sport multiplier × card tier multiplier</span>. Tier multipliers: Common 1.0×, Uncommon 1.2×, Rare 1.6×, Epic 2.0×, Legendary 2.5×, Mystic 3.2×, Iconic 4.0×. Only the top 2 historical performances per sport per day can be claimed.</p>
        <p><span className="num text-head">Days to break even = price ÷ (annual expected yield ÷ 365)</span>. The spec doesn't give sport multipliers, so they default to 1.0 — edit them below.</p>
      </Explain>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={view} onChange={setView} label="View" options={[{ value: 'daily', label: '2-Claim Optimizer' }, { value: 'roi', label: 'Who to Buy' }, { value: 'compare', label: 'Compare' }, { value: 'catalog', label: 'Catalog' }]} />
        <label className="flex items-center gap-2 text-xs text-muted">
          Date
          <input type="date" className="field num !w-auto" value={`2000-${md}`} onChange={(e) => e.target.value && setMd(e.target.value.slice(5))} aria-label="Date (year ignored)" />
          <button className="btn-ghost btn-sm" onClick={() => setMd(localMonthDay())}>Today</button>
        </label>
      </div>

      {live && (view === 'roi' || view === 'compare') && cardGames.loading && <Loading label={`Loading full calendars for ${candidates.length} cards…`} />}
      {view === 'daily' && <DailyOptimizer games={o.games} md={md} sportMult={o.sportMult} live={live} />}
      {view === 'roi' && <BreakEvenCalc games={roiGames} md={md} sportMult={o.sportMult} />}
      {view === 'compare' && <CompareTool games={roiGames} md={md} sportMult={o.sportMult} />}
      {view === 'catalog' && <HistoricalTable games={o.games} md={md} onMd={setMd} sportMult={o.sportMult} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-hd"><h2>Sport multipliers</h2><button className="btn-ghost btn-sm" onClick={() => o.setSportMult(Object.fromEntries(SPORTS.map((s) => [s, 1])) as typeof o.sportMult)}>Reset to 1.0</button></div>
          <div className="panel-bd grid grid-cols-4 gap-2">
            {SPORTS.map((s) => (
              <label key={s} className="text-xs text-muted">{s}
                <input className="field num mt-0.5" type="number" step="0.05" min="0" value={o.sportMult[s]} onChange={(e) => o.setSportMult({ ...o.sportMult, [s]: Math.max(0, +e.target.value || 0) })} />
              </label>
            ))}
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd"><h2>Import historical games</h2>{o.source === 'imported' && <button className="btn-ghost btn-sm" onClick={o.resetToSample}>Back to sample</button>}</div>
          <div className="panel-bd space-y-2">
            <p className="hint">CSV with header <span className="num">player,sport,team,season,date,rating,baseRax</span> (date YYYY-MM-DD, rating 0–10), or a JSON array of the same fields.</p>
            <textarea className="field num min-h-[70px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="player,sport,team,season,date,rating,baseRax" aria-label="Paste CSV or JSON" />
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" disabled={!text.trim()} onClick={() => doImport(text)}>Import pasted data</button>
              <label className="btn-ghost btn-sm cursor-pointer"><Upload size={12} /> Choose file
                <input type="file" accept=".csv,.json,text/csv,application/json" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) doImport(await f.text()); e.target.value = ''; }} />
              </label>
            </div>
            {errs.length > 0 && <ul className="list-disc pl-5 text-xs text-danger">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        </div>
      </div>
    </div>
  );
}
