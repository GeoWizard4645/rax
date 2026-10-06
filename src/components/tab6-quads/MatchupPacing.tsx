import { useMemo, useState } from 'react';
import { karmaOpportunity } from '../../../shared/quads';
import type { QuadGame } from '../../../shared/sample';
import { SportTabs } from '../ui/SportSelect';
import type { Sport } from '../../types/real';

/** Marquee broadcasts ranked by Karma opportunity (expected polls × pace). */
export default function MatchupPacing({ games, selected, onSelect }: { games: QuadGame[]; selected: string | null; onSelect: (id: string) => void }) {
  const [sport, setSport] = useState<Sport | 'ALL'>('ALL');
  const [marqueeOnly, setMarqueeOnly] = useState(true);
  const sports = useMemo(() => [...new Set(games.map((g) => g.sport))], [games]);
  const rows = useMemo(
    () => games.filter((g) => (sport === 'ALL' || g.sport === sport) && (!marqueeOnly || g.marquee)).sort((a, b) => karmaOpportunity(b) - karmaOpportunity(a)),
    [games, sport, marqueeOnly],
  );
  const max = Math.max(1, ...games.map(karmaOpportunity));

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>Quad matchup optimizer</h2>
        <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={marqueeOnly} onChange={(e) => setMarqueeOnly(e.target.checked)} /> marquee broadcasts only</label>
      </div>
      <div className="border-b border-line px-3 py-2"><SportTabs sports={sports} value={sport} onChange={setSport} allLabel="All" /></div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Matchup</th><th>Broadcast</th><th>Kickoff</th><th className="r">Pace</th><th className="r">Polls / game</th><th style={{ minWidth: 180 }}>Karma opportunity</th></tr></thead>
          <tbody>
            {rows.map((g) => {
              const k = karmaOpportunity(g);
              return (
                <tr key={g.id} className={`cursor-pointer ${selected === g.id ? '!bg-action/10' : ''}`} onClick={() => onSelect(g.id)}>
                  <td><span className="font-medium">{g.away} @ {g.home}</span> <span className="chip-muted">{g.sport}</span>{g.marquee && <span className="chip-amber ml-1">marquee</span>}<div className="text-[11px] text-muted">{g.title}</div></td>
                  <td className="text-muted">{g.broadcast}</td>
                  <td className="num text-xs">{new Date(g.startsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="r num">{g.pace.toFixed(2)}×</td>
                  <td className="r num">{g.pollsPerGame}</td>
                  <td>
                    <div className="flex items-center gap-2"><span className="num w-10 text-right font-semibold text-emerald">{k}</span><div className="h-2 flex-1 rounded bg-base"><div className="h-2 rounded bg-emerald" style={{ width: `${(k / max) * 100}%` }} /></div></div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">Karma opportunity = expected polls per game × pace index (1.0 = league-average tempo). Faster games with more polls give more chances to extend a streak.</div>
    </div>
  );
}
