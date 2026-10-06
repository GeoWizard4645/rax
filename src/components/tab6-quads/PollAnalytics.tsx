import { useMemo, useState } from 'react';
import { CONSENSUS_PCT, CONTRARIAN_MAX_PCT, CONTRARIAN_MIN_PCT, readPoll } from '../../../shared/quads';
import type { Poll, QuadGame } from '../../../shared/sample';
import { Empty } from '../ui/StateBlock';

const KIND = { consensus: { label: 'Heavy consensus', cls: 'chip-emerald' }, lean: { label: 'Leaning', cls: 'chip-blue' }, split: { label: 'Split', cls: 'chip-muted' } } as const;

/** Community vote distributions: spot streak-safe consensus picks and rarely-chosen contrarian value. */
export default function PollAnalytics({ polls, games, gameId }: { polls: Poll[]; games: QuadGame[]; gameId: string | null }) {
  const [contrarianOnly, setContrarianOnly] = useState(false);
  const game = games.find((g) => g.id === gameId);
  const reads = useMemo(() => polls.filter((p) => !gameId || p.gameId === gameId).map(readPoll).filter((r) => !contrarianOnly || r.contrarian), [polls, gameId, contrarianOnly]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>Poll trend intelligence{game ? ` — ${game.away} @ ${game.home}` : ''}</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={contrarianOnly} onChange={(e) => setContrarianOnly(e.target.checked)} /> contrarian value only</label>
      </div>
      {reads.length === 0 ? <Empty title="No polls match">Pick a game above, or clear the filter.</Empty> : (
        <ul>
          {reads.map(({ poll, leader, kind, contrarian, contrarianMultiple }) => (
            <li key={poll.id} className="border-b border-line/60 px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{poll.question}</span>
                <span className="flex items-center gap-1.5"><span className={KIND[kind].cls}>{KIND[kind].label}</span><span className="num text-[11px] text-muted">{poll.votes.toLocaleString()} votes</span></span>
              </div>
              <div className="mt-2 space-y-1">
                {poll.options.map((o) => (
                  <div key={o.label} className="flex items-center gap-2 text-xs">
                    <span className="w-28 truncate">{o.label}</span>
                    <div className="h-2 flex-1 rounded bg-base"><div className={`h-2 rounded ${o === leader ? 'bg-emerald' : contrarian && o.label === contrarian.label ? 'bg-amber' : 'bg-action/60'}`} style={{ width: `${o.pct}%` }} /></div>
                    <span className="num w-9 text-right">{o.pct}%</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="text-muted">Streak-safe pick: <b className="text-emerald">{leader.label}</b> ({leader.pct}%)</span>
                {contrarian && <span className="text-muted">Contrarian value: <b className="text-amber">{contrarian.label}</b> ({contrarian.pct}% pick it → ≈{contrarianMultiple}× the crowd's payoff if right)</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">Consensus = leader ≥ {CONSENSUS_PCT}%. Contrarian = a non-leading option with {CONTRARIAN_MIN_PCT}–{CONTRARIAN_MAX_PCT}% of votes (rare but plausible). Crowds are often right: use the streak-safe pick to protect a Karma streak, the contrarian pick only when you have an edge.</div>
    </div>
  );
}
