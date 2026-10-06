import { useMemo, useState } from 'react';
import { QUAD_PAYOUTS, SQUAD_SIZE, squadTotal } from '../../../shared/quads';
import { samplePolls } from '../../../shared/sample';
import { useSchedule } from '../../hooks/useSchedule';
import { DataBadge } from '../ui/DataBadge';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { Segmented } from '../ui/Segmented';
import MatchupPacing from './MatchupPacing';
import PollAnalytics from './PollAnalytics';
import SquadBoard from './SquadBoard';

export default function QuadsTab() {
  const { data, error, loading, reload } = useSchedule();
  const [view, setView] = useState<'matchups' | 'squad'>('matchups');
  const [picked, setPicked] = useState<string | null>(null);
  const games = data?.games ?? [];
  const gameId = picked && games.some((g) => g.id === picked) ? picked : games.find((g) => g.marquee)?.id ?? games[0]?.id ?? null;
  // Community poll results aren't available from any free source, so they stay synthetic — on real matchups.
  const polls = useMemo(() => samplePolls(games, Date.now()), [games]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Quads &amp; Game Intel</h1>
          <p className="text-sm text-muted">Pick Quad matchups with the most Karma opportunity, read community polls, and line up active partners. Inspired by raxintel.com.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted">Schedule</span>
          <DataBadge source={data?.source} note={data?.note} />
        </div>
      </div>
      <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">
        <b className="text-head">What's real here:</b> {data?.source === 'live' ? 'the matchups, kickoff times, broadcasters and live/upcoming status (ESPN public scoreboards).' : 'nothing yet — the schedule source is unavailable, so sample matchups are shown.'}{' '}
        <b className="text-head">Estimated:</b> pace and polls-per-game come from sport averages (scaled by the betting total when ESPN has one).{' '}
        <b className="text-head">Sample:</b> the community poll percentages below are synthetic — Real's poll data needs its private API.
      </div>

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
        loading && !data ? <Loading label="Loading the schedule…" /> : error ? <ErrorBlock message={error} onRetry={reload} /> : (
          <>
            <MatchupPacing games={games} selected={gameId} onSelect={setPicked} />
            <PollAnalytics polls={polls} games={games} gameId={gameId} />
          </>
        )
      ) : (
        <SquadBoard />
      )}
    </div>
  );
}
