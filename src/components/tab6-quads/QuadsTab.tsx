import { useMemo, useState } from 'react';
import { QUAD_PAYOUTS, SQUAD_SIZE, squadTotal } from '../../../shared/quads';
import { sampleQuads } from '../../../shared/sample';
import { DataBadge, SampleNotice } from '../ui/DataBadge';
import { Segmented } from '../ui/Segmented';
import MatchupPacing from './MatchupPacing';
import PollAnalytics from './PollAnalytics';
import SquadBoard from './SquadBoard';

export default function QuadsTab() {
  const { games, polls } = useMemo(() => sampleQuads(Date.now()), []);
  const [view, setView] = useState<'matchups' | 'squad'>('matchups');
  const [gameId, setGameId] = useState<string | null>(games[0]?.id ?? null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Quads &amp; Game Intel</h1>
          <p className="text-sm text-muted">Pick Quad matchups with the most Karma opportunity, read community polls, and line up active partners. Inspired by raxintel.com.</p>
        </div>
        <DataBadge source="sample" note="Schedule, pace and poll distributions are synthetic — the live feeds aren't connected." />
      </div>
      <SampleNotice source="sample" note="The game schedule, pace and community poll distributions are synthetic. The scoring maths, payout reference and squad board are real." />

      <div className="panel">
        <div className="panel-hd"><h2>Quads payout reference</h2><span className="text-xs text-muted">per teammate · squad of {SQUAD_SIZE}</span></div>
        <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-3">
          {QUAD_PAYOUTS.map((p) => (
            <div key={p.tier} className="bg-surface px-4 py-3">
              <div className="text-[11px] uppercase tracking-wider text-muted">{p.tier}</div>
              <div className="num text-xl font-semibold text-emerald">{p.raxPerTeammate} Rax</div>
              <div className="num text-[11px] text-muted">{squadTotal(p.raxPerTeammate)} Rax across the squad</div>
            </div>
          ))}
        </div>
      </div>

      <Segmented value={view} onChange={setView} label="View" options={[{ value: 'matchups', label: 'Matchups & polls' }, { value: 'squad', label: 'Squad board' }]} />
      {view === 'matchups' ? (
        <>
          <MatchupPacing games={games} selected={gameId} onSelect={setGameId} />
          <PollAnalytics polls={polls} games={games} gameId={gameId} />
        </>
      ) : (
        <SquadBoard />
      )}
    </div>
  );
}
