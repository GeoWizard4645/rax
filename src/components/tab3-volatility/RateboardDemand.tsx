import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useRbBoard } from '../../hooks/useRbBoard';
import { useUfc } from '../../hooks/useUfc';
import { buildDemand } from '../../../shared/demand';
import { RB_ORIGIN, RB_SPORTS, type RbSport } from '../../../shared/rateboard';
import { findFighter } from '../../../shared/ufc';
import UfcChip from '../ui/UfcChip';
import { DataBadge } from '../ui/DataBadge';
import { Segmented } from '../ui/Segmented';
import { ErrorBlock, Loading, Empty } from '../ui/StateBlock';
import { Stat } from '../ui/Stat';

type Pick = RbSport | 'ALL';
const OPTIONS: Array<{ value: Pick; label: string }> = [{ value: 'ALL', label: 'All' }, ...(Object.keys(RB_SPORTS) as RbSport[]).map((s) => ({ value: s, label: s }))];
const SHOWN = 25;

/** What buyers are asking for on Rateboard right now — live, from Rateboard's public board (+ UFC status from /api/ufc). */
export default function RateboardDemand() {
  const { board, error, loading, fetchedAt, refresh } = useRbBoard();
  const [sport, setSport] = useState<Pick>('ALL');
  const wantUfc = sport === 'ALL' || sport === 'UFC';
  const ufc = useUfc(wantUfc);

  const d = useMemo(() => (board ? buildDemand(board, sport, fetchedAt ?? Date.now()) : null), [board, sport, fetchedAt]);
  const peak = d ? Math.max(1, ...d.days.map((x) => x.offers)) : 1;

  return (
    <section className="panel" aria-label="Rateboard demand">
      <div className="panel-hd">
        <div>
          <h2>Rateboard demand</h2>
          <p className="text-[11px] font-normal text-muted">Rates buyers are offering per rating point, live from the shared board — not Real auction prices.</p>
        </div>
        <div className="flex items-center gap-2">
          <DataBadge source={board ? 'live' : null} note="Live from rateboard-cgi.pages.dev (public board)" />
          <a className="btn-ghost btn-sm" href={RB_ORIGIN} target="_blank" rel="noreferrer">
            Rateboard <ExternalLink size={11} />
          </a>
        </div>
      </div>
      <div className="panel-bd space-y-3">
        <Segmented value={sport} onChange={setSport} label="Sport" options={OPTIONS} />
        {loading && !board && <Loading label="Reading the board…" />}
        {error && <ErrorBlock message={error} onRetry={() => void refresh(true)} />}
        {d && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Live offers" value={d.liveOffers.toLocaleString()} sub={`${d.rows.length.toLocaleString()} players`} />
              <Stat label="Buyers" value={d.buyers.toLocaleString()} tone="blue" />
              <Stat label="New · 24h" value={d.new24h.toLocaleString()} tone="amber" />
              <Stat label="New · 7d" value={d.new7d.toLocaleString()} tone="emerald" />
            </div>

            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">New offers per day (UTC, last {d.days.length})</div>
              <div className="flex h-14 items-end gap-1" role="img" aria-label={`New offers per day, peak ${peak}`}>
                {d.days.map((x) => (
                  <div key={x.t} className="flex h-full flex-1 items-end" title={`${new Date(x.t).toISOString().slice(0, 10)} · ${x.offers} offers`}>
                    <div className="w-full rounded-sm bg-action/70" style={{ height: `${Math.max(x.offers ? 6 : 2, (x.offers / peak) * 100)}%` }} />
                  </div>
                ))}
              </div>
            </div>

            {d.rows.length === 0 ? (
              <Empty title="No live offers for this sport" />
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="tbl">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr>
                      <th>Player</th>
                      <th className="r">Buyers</th>
                      <th className="r">Best</th>
                      <th className="r">Median</th>
                      <th className="r">Floor</th>
                      <th className="r">New 7d</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.slice(0, SHOWN).map((r) => {
                      const f = r.sport === 'UFC' ? findFighter(ufc.index, r.player) : null;
                      return (
                        <tr key={r.key}>
                          <td>
                            <span className="font-medium text-head">{r.player}</span> <span className="text-[11px] text-muted">{r.sport}</span>
                          </td>
                          <td className="num r">{r.buyers}</td>
                          <td className="num r">{r.best}/1</td>
                          <td className="num r">{r.median}/1</td>
                          <td className="num r">{r.floor ? `${r.floor}/1` : '—'}</td>
                          <td className="num r">{r.new7d}</td>
                          <td className="space-x-1">
                            {r.keepRank != null && <span className="chip-blue" title="On Rateboard's keep list">keep #{r.keepRank}</span>}
                            {r.house != null && <span className="chip-amber" title="On the house buyer's list at this rate">house {r.house}/1</span>}
                            {f && <UfcChip f={f} />}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {d.rows.length > SHOWN && <div className="text-[11px] text-muted">Showing the {SHOWN} most active of {d.rows.length.toLocaleString()} players.</div>}
            {ufc.error && wantUfc && <div className="text-[11px] text-muted">UFC status unavailable right now ({ufc.error}).</div>}
            <div className="text-[11px] text-muted">Data from Rateboard (rateboard-cgi.pages.dev) — refreshes every minute. UFC status comes from Rateboard's UFC.com feed.</div>
          </>
        )}
      </div>
    </section>
  );
}
