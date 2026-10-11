import { Database } from 'lucide-react';
import type { RateCoverage } from '../../types/market';
import { MIN_HISTORY_DAYS } from '../../../shared/rbHistory';
import { ago } from '../../lib/format';
import { Stat } from '../ui/Stat';

const utc = (t: number | null) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—');

/**
 * What the bid-rate recorder has captured so far — the answer to "how much of this is real history?".
 * Shown whenever the Rateboard source is selected.
 */
export default function RateHistoryPanel({ coverage, error }: { coverage: RateCoverage | null; error?: string | null }) {
  return (
    <section className="panel" aria-label="Bid-rate history">
      <div className="panel-hd flex-wrap">
        <div>
          <h2 className="flex items-center gap-2">
            <Database size={14} /> Bid-rate history we are recording
          </h2>
          <p className="text-[11px] font-normal text-muted">
            Every number below the demand table is a <b className="text-head">bid rate</b> — Rax per rating point that Rateboard buyers offer — sampled from Rateboard’s public board about every 10 minutes. It is demand, not Real sale prices; Real publishes no sales to anyone without a login.
          </p>
        </div>
        {coverage && (
          <span className={coverage.ready ? 'chip-emerald' : 'chip-amber'} title={`Spikes, candles and forecasts unlock after ${MIN_HISTORY_DAYS} days of history`}>
            {coverage.spanDays.toFixed(1)} day{coverage.spanDays === 1 ? '' : 's'} of data{coverage.ready ? '' : ` · unlocks at ${MIN_HISTORY_DAYS}`}
          </span>
        )}
      </div>
      <div className="panel-bd space-y-2">
        {error && <p className="text-xs text-danger">Couldn’t reach the recorder ({error}). Showing whatever the board returns right now.</p>}
        {coverage && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Recording since" value={coverage.firstAt ? new Date(coverage.firstAt).toISOString().slice(5, 10) : '—'} sub={utc(coverage.firstAt)} />
              <Stat label="Hours sampled" value={String(coverage.hoursSampled)} sub={`${coverage.samples} samples`} tone="blue" />
              <Stat label="Players tracked" value={String(coverage.players)} sub="with a bid now" tone="emerald" />
              <Stat label="Last sample" value={coverage.lastAt ? ago(coverage.lastAt) : '—'} sub={coverage.seeded ? `incl. ${coverage.seeded} Rateboard backups` : 'live samples only'} tone="amber" />
            </div>
            {!coverage.persisted && (
              <p className="text-[11px] text-amber">No KV namespace is bound to this deployment, so history lives only in memory and will be lost on restart. Bind <span className="num">CACHE</span> (see README).</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
