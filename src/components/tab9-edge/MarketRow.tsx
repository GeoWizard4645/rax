import { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Pencil } from 'lucide-react';
import type { MarketType, OddsEvent, OddsSource } from '../../../shared/odds';
import type { Consensus, SourceFair } from '../../../shared/oddsConsensus';
import MarketEditor, { type EditorValue } from './MarketEditor';
import {
  MARKET_LABEL,
  agreement,
  consensusFor,
  evalMarket,
  fmtAge,
  fmtP,
  fmtSigned,
  fmtVol,
  hasDraw,
  lookupEntry,
  sideFairs,
  withAuto,
  type AutoReal,
  type Cfg,
  type EntryStore,
} from './edgeLogic';

export const SOURCE_ORDER: OddsSource[] = ['kalshi', 'polymarket', 'espn-dk'];
/** Extra columns when the user has switched on FanDuel / DraftKings from their RaxEdge export. */
export const RAX_SOURCE_ORDER: OddsSource[] = ['fanduel', 'draftkings'];
const SHORT: Record<OddsSource, string> = { kalshi: 'Kalshi', polymarket: 'Polymarket', 'espn-dk': 'DraftKings', fanduel: 'FanDuel', draftkings: 'DK · RaxEdge' };
const SOURCE_TIP: Partial<Record<OddsSource, string>> = {
  fanduel: 'FanDuel line from your RaxEdge export (a snapshot — check its age in the settings)',
  draftkings: 'DraftKings from your RaxEdge export. It is the same book as the DraftKings (ESPN) column, so it only counts where ESPN has no DraftKings quote for that line.',
};

/** One source’s fair % for the first outcome, with its volume / spread (exchanges) or vig (the book). */
function SourceCell({ sf, name0 }: { sf: SourceFair | undefined; name0: string }) {
  if (!sf) return <span className="num text-muted">—</span>;
  const f = sf.fair[0];
  const sub = sf.vigRemoved
    ? `vig ${((sf.overround - 1) * 100).toFixed(1)}%`
    : `${sf.volume != null ? `vol ${fmtVol(sf.volume)}` : 'no vol'}${sf.width != null ? ` · ${(sf.width * 100).toFixed(0)}¢` : ''}`;
  const thin = !sf.vigRemoved && (sf.volume == null || sf.volume < 100 || (sf.width ?? 0) >= 0.05);
  return (
    <span title={`${name0}: ${fmtP(f)} fair (${sf.vigRemoved ? 'vig removed' : 'exchange price, re-normalised'}); weight ${sf.weight.toFixed(2)}`}>
      <span className="num block text-sm font-semibold text-head">{fmtP(f)}</span>
      <span className={`num block text-[10px] ${thin ? 'text-amber' : 'text-muted'}`}>{sub}</span>
    </span>
  );
}

function AgreeChip({ c }: { c: Consensus }) {
  const a = agreement(c.spread);
  const pp = c.spread == null ? '' : `${(c.spread * 100).toFixed(1)} pp`;
  if (a === 'single') return <span className="chip-muted" title="Only one source quotes this market — nothing to cross-check">{c.sources.length ? '1 source' : 'no quotes'}</span>;
  if (a === 'tight') return <span className="chip-emerald" title={`Sources within ${pp} of each other`}><CheckCircle2 size={11} /> agree · {pp}</span>;
  return (
    <span className={a === 'mild' ? 'chip-amber' : 'chip-amber !border-danger/50 !bg-danger/10 !text-danger'} title={`Sources are ${pp} apart — check for a stale quote or a different line`}>
      <AlertTriangle size={11} /> {pp} apart
    </span>
  );
}

export interface MarketRowProps {
  event: OddsEvent;
  type: MarketType;
  /** All lines offered (spread / total), best first. */
  lines: number[];
  line: number | null;
  onLine: (l: number) => void;
  cfg: Cfg;
  store: EntryStore;
  open: boolean;
  onToggle: () => void;
  onSave: (v: EditorValue) => void;
  anchorId: string;
  /** Source columns to show, in order (defaults to Kalshi / Polymarket / DraftKings (ESPN)). */
  cols?: OddsSource[];
  /** RaxEdge's number for Real's own market (opt-in, moneyline only) and the current time for its age label. */
  auto?: AutoReal | null;
  now?: number;
}

/** Column header strip for the rows (desktop only). Exported so the list can render it once. Static class strings so Tailwind sees them. */
export const ROW_GRID = 'md:grid-cols-[9.5rem_minmax(0,1.25fr)_repeat(3,minmax(0,6.5rem))_minmax(0,9.5rem)]';
export const ROW_GRID_WIDE = 'md:grid-cols-[9rem_minmax(0,1.2fr)_repeat(5,minmax(0,5.25rem))_minmax(0,9.5rem)]';
export const gridFor = (cols: OddsSource[]) => (cols.length > 3 ? ROW_GRID_WIDE : ROW_GRID);
export function RowHeader({ cols = SOURCE_ORDER }: { cols?: OddsSource[] }) {
  return (
    <div className={`hidden gap-3 border-b border-line px-3 py-1.5 text-[11px] uppercase tracking-wider text-muted md:grid ${gridFor(cols)}`}>
      <span>Market</span>
      <span>Fair (consensus) · agreement</span>
      {cols.map((s) => <span key={s} title={SOURCE_TIP[s]} className="truncate">{SHORT[s]}</span>)}
      <span>Your Real % → EV</span>
    </div>
  );
}

export default function MarketRow({ event, type, lines, line, onLine, cfg, store, open, onToggle, onSave, anchorId, cols = SOURCE_ORDER, auto = null, now = Date.now() }: MarketRowProps) {
  const c = useMemo(() => consensusFor(event, type, line, cfg.devig, cfg.include), [event, type, line, cfg.devig, cfg.include]);
  const found = useMemo(() => lookupEntry(store, event, type, line), [store, event, type, line]);
  const eff = useMemo(() => withAuto(found, type === 'moneyline' ? auto : null, hasDraw(c)), [found, auto, type, c]);
  const { best } = useMemo(() => evalMarket(c, eff, cfg), [c, eff, cfg]);
  const bestIsAuto = !!best && !!eff && (best.idx === 2 ? eff.autoD : eff.auto[best.idx]);
  const sides = sideFairs(c, !!found?.dnb);
  const three = hasDraw(c) && !found?.dnb;
  const bySource = new Map(c.sources.map((s) => [s.source, s]));
  const name0 = c.names[0];

  return (
    <div id={anchorId} className="border-b border-line/60 last:border-b-0">
      <div className={`grid items-center gap-x-3 gap-y-2 px-3 py-2 transition-colors hover:bg-hover ${gridFor(cols)} ${open ? 'bg-hover' : ''}`}>
        <div className="flex items-center gap-2">
          <button className="flex min-w-0 items-center gap-1.5 text-left text-sm font-medium text-head" aria-expanded={open} onClick={onToggle} aria-label={`${open ? 'Close' : 'Open'} ${MARKET_LABEL[type]} editor`}>
            <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? 'rotate-180' : '-rotate-90'}`} />
            {MARKET_LABEL[type]}
          </button>
          {type !== 'moneyline' && line !== null && (lines.length > 1 ? (
            <select className="field num !w-auto !px-1.5 !py-0.5 text-xs" aria-label={`${MARKET_LABEL[type]} line`} value={String(line)} onChange={(e) => onLine(Number(e.target.value))}>
              {lines.map((l) => <option key={l} value={String(l)}>{type === 'spread' && l > 0 ? '+' : ''}{l}</option>)}
            </select>
          ) : (
            <span className="chip-muted num">{type === 'spread' && line > 0 ? '+' : ''}{line}</span>
          ))}
        </div>

        <div className="cursor-pointer space-y-1" onClick={onToggle}>
          <div className={`grid gap-2 text-sm ${three ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {sides.map((s) => (
              <div key={s.idx} className="min-w-0">
                <div className="truncate text-xs text-muted" title={s.label}>{s.label}{type === 'spread' && s.idx === 0 && line !== null ? ` ${line > 0 ? '+' : ''}${line}` : type === 'spread' && s.idx === 1 && line !== null ? ` ${-line > 0 ? '+' : ''}${-line}` : ''}</div>
                <div className="num font-semibold text-head">{fmtP(s.fair)}</div>
              </div>
            ))}
            {!sides.length && <span className="col-span-2 text-xs text-muted">no usable quotes</span>}
          </div>
          <AgreeChip c={c} />
        </div>

        <div className="grid grid-cols-3 gap-2 md:contents">
          {cols.map((src) => (
            <div key={src} className="cursor-pointer" onClick={onToggle} title={SOURCE_TIP[src]}>
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-muted md:hidden">{SHORT[src]}</span>
              <SourceCell sf={bySource.get(src)} name0={name0} />
              {bySource.get(src) && three && <span className="num block text-[10px] text-muted">draw {fmtP(bySource.get(src)?.draw)}</span>}
            </div>
          ))}
        </div>

        <div className="cursor-pointer md:text-right" onClick={onToggle}>
          {best?.ev ? (
            <>
              <div className={`num text-lg font-semibold leading-tight ${best.ev.ev > 0 ? 'text-emerald' : 'text-danger'}`}>EV {fmtSigned(best.ev.ev, 1, '%')}</div>
              <div className="num text-[11px] text-muted">
                {best.label.length > 14 ? `${best.label.slice(0, 13)}…` : best.label} @ {best.ev.realPct}% · edge {fmtSigned(best.ev.edgePp, 1, ' pp')}
                {best.ev.stake > 0 && <> · <b className="text-head">{best.ev.stake.toLocaleString('en-US')} Rax</b></>}
              </div>
              {bestIsAuto && eff?.src && (
                <span className="chip-blue mt-0.5" title="Real % filled in from your RaxEdge export (Real's own market number). It is not something you typed — re-check it in Real before betting. Type a value to override.">
                  from RaxEdge · {fmtAge(now - eff.src.s.ts)}
                </span>
              )}
            </>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-action"><Pencil size={12} /> Enter Real %</span>
          )}
          {open && <span className="sr-only">editor open</span>}
        </div>
      </div>
      {open && <MarketEditor event={event} c={c} found={found} auto={type === 'moneyline' ? auto : null} now={now} cfg={cfg} onChange={onSave} />}
      {open && type !== 'moneyline' && <p className="hint px-3 pb-2">The line must be the one Real shows. Lines are compared across sources only when identical; alternates are never interpolated.</p>}
    </div>
  );
}
