import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Empty } from '../ui/StateBlock';
import { MARKET_LABEL, agreement, fmtNum, fmtP, fmtSigned, startText, type BoardRow } from './edgeLogic';

/** Best EV across every game that has a Real % entered, sorted by EV. */
export default function BestBoard({
  rows,
  unmatched,
  loadingSports,
  onOpen,
  onClearUnmatched,
}: {
  rows: BoardRow[];
  /** Saved entries whose game is not in the current odds (finished, not yet listed, or sport still loading). */
  unmatched: number;
  loadingSports: boolean;
  onOpen: (r: BoardRow) => void;
  onClearUnmatched: () => void;
}) {
  const [onlyPos, setOnlyPos] = useState(false);
  const shown = onlyPos ? rows.filter((r) => r.eval.ev > 0) : rows;
  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Best EV — games with a Real % entered</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={onlyPos} onChange={(e) => setOnlyPos(e.target.checked)} /> +EV only
        </label>
      </div>
      {shown.length === 0 ? (
        <Empty title={rows.length ? 'No +EV entries right now' : loadingSports ? 'Loading your games…' : 'Nothing entered yet'}>
          {rows.length
            ? 'Every side you entered is at or below break-even at the assumed rake.'
            : 'Open a game in the Games view, click a market row and type the % Real shows for each side. Entered games appear here, sorted by EV, and expire 24 h after kick-off.'}
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Game</th>
                <th>Market · side</th>
                <th className="r">Fair</th>
                <th className="r">Real</th>
                <th className="r">Edge</th>
                <th className="r">EV</th>
                <th className="r">Stake</th>
                <th>Sources</th>
                <th>Starts</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const a = agreement(r.spread);
                return (
                  <tr key={r.id} className="cursor-pointer" onClick={() => onOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(r)} aria-label={`Open ${r.event.away} at ${r.event.home}`}>
                    <td className="num text-muted">{i + 1}</td>
                    <td>
                      <span className="chip-muted mr-1.5">{r.event.sport}</span>
                      {r.event.away} @ {r.event.home}
                    </td>
                    <td>
                      {MARKET_LABEL[r.type]}
                      {r.line !== null && <span className="num text-muted"> {r.type === 'spread' && r.line > 0 ? '+' : ''}{r.line}</span>} · <b className="text-head">{r.side.label}</b>
                    </td>
                    <td className="r num">{fmtP(r.side.fair)}</td>
                    <td className="r num">{fmtNum(r.eval.realPct, 1)}%</td>
                    <td className={`r num ${r.eval.edgePp > 0 ? 'text-emerald' : 'text-danger'}`}>{fmtSigned(r.eval.edgePp, 1, ' pp')}</td>
                    <td className={`r num text-base font-semibold ${r.eval.ev > 0 ? 'text-emerald' : 'text-danger'}`}>{fmtSigned(r.eval.ev, 1, '%')}</td>
                    <td className="r num">{r.eval.stake > 0 ? r.eval.stake.toLocaleString('en-US') : '—'}</td>
                    <td>
                      {a === 'tight' ? (
                        <span className="chip-emerald">{r.nSources} agree</span>
                      ) : a === 'single' ? (
                        <span className="chip-muted">{r.nSources} source</span>
                      ) : (
                        <span className="chip-amber" title="Sources disagree — treat the EV with caution"><AlertTriangle size={11} /> {fmtNum((r.spread ?? 0) * 100, 1)} pp apart</span>
                      )}
                    </td>
                    <td className="num text-xs text-muted">{startText(r.event).text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {unmatched > 0 && !loadingSports && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2 text-xs text-muted">
          {unmatched} saved entr{unmatched === 1 ? 'y has' : 'ies have'} no current odds (game finished, not yet listed by any source, or a source failed this refresh).
          <button className="btn-ghost btn-sm" onClick={onClearUnmatched}>Clear them</button>
        </div>
      )}
    </div>
  );
}
