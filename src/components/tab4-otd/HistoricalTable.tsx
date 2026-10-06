import { useMemo, useState } from 'react';
import { SPORTS } from '../../../shared/formulas';
import { monthDay, type SportMult } from '../../../shared/otd';
import type { HistoricalGame, Sport } from '../../types/real';
import { dec, rax } from '../../lib/format';
import { Empty } from '../ui/StateBlock';
import { SportTabs } from '../ui/SportSelect';

const PAGE = 100;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Searchable calendar catalog of every historical game: original rating, date and base Rax payout. */
export default function HistoricalTable({ games, md, onMd, sportMult }: { games: HistoricalGame[]; md: string; onMd: (md: string) => void; sportMult: SportMult }) {
  const [q, setQ] = useState('');
  const [sport, setSport] = useState<Sport | 'ALL'>('ALL');
  const [season, setSeason] = useState('');
  const [onThisDay, setOnThisDay] = useState(true);
  const [shown, setShown] = useState(PAGE);

  const seasons = useMemo(() => [...new Set(games.map((g) => g.season))].sort().reverse(), [games]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return games
      .filter((g) => (sport === 'ALL' || g.sport === sport) && (!season || g.season === season) && (!onThisDay || monthDay(g.date) === md) && (!s || g.playerName.toLowerCase().includes(s) || g.team.toLowerCase().includes(s)))
      .sort((a, b) => b.baseRax * (sportMult[b.sport] ?? 1) - a.baseRax * (sportMult[a.sport] ?? 1) || b.date.localeCompare(a.date));
  }, [games, q, sport, season, onThisDay, md, sportMult]);

  const [m, d] = md.split('-').map(Number);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>
          Historical catalog <span className="num text-xs font-normal text-muted">({rows.length.toLocaleString()} games)</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={onThisDay} onChange={(e) => (setOnThisDay(e.target.checked), setShown(PAGE))} /> only
          </label>
          <select className="field !w-auto" value={m} onChange={(e) => onMd(`${String(+e.target.value).padStart(2, '0')}-${String(d).padStart(2, '0')}`)} aria-label="Month">
            {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
          </select>
          <input className="field num !w-16" type="number" min={1} max={31} value={d} onChange={(e) => onMd(`${String(m).padStart(2, '0')}-${String(Math.min(31, Math.max(1, +e.target.value || 1))).padStart(2, '0')}`)} aria-label="Day" />
          <select className="field !w-auto" value={season} onChange={(e) => (setSeason(e.target.value), setShown(PAGE))} aria-label="Season">
            <option value="">All seasons</option>
            {seasons.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <input className="field !w-44" placeholder="Search player or team…" value={q} onChange={(e) => (setQ(e.target.value), setShown(PAGE))} aria-label="Search" />
        </div>
      </div>
      <div className="border-b border-line px-3 py-2">
        <SportTabs sports={SPORTS} value={sport} onChange={(s) => (setSport(s), setShown(PAGE))} allLabel="All" />
      </div>
      {rows.length === 0 ? (
        <Empty title="No games match">Try another date or clear the filters.</Empty>
      ) : (
        <div className="max-h-[520px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 bg-surface">
              <tr><th>Date</th><th>Player</th><th>Team</th><th>Season</th><th className="r">Game rating</th><th className="r">Base Rax</th><th className="r" title="× sport multiplier">Rax @ Common</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((g) => (
                <tr key={g.id}>
                  <td className="num text-muted">{g.date}</td>
                  <td><span className="font-medium">{g.playerName}</span> <span className="chip-muted">{g.sport}</span></td>
                  <td className="text-muted">{g.team}</td>
                  <td className="num">{g.season}</td>
                  <td className="r num">{dec(g.rating, 1)}</td>
                  <td className="r num">{rax(g.baseRax)}</td>
                  <td className="r num text-emerald">{rax(g.baseRax * (sportMult[g.sport] ?? 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && (
        <div className="border-t border-line p-2 text-center">
          <button className="btn-ghost btn-sm" onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>
        </div>
      )}
    </div>
  );
}
