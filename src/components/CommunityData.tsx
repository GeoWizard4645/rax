import { Users } from 'lucide-react';
import { communityLine } from '../../shared/communityMarket';
import type { CommunityMarket } from '../hooks/useCommunityMarket';

/** Tabs 2–3 open the capture panel when this fires (RealCaptureImport listens for it). */
export const OPEN_CAPTURE_EVENT = 'rax-open-capture';

/** Chip carrying the provenance of Community-sourced numbers: "Community database · 12 reporters · updated 5 min ago". */
export function CommunityBadge({ label }: { label: string }) {
  return (
    <span className="chip-blue" title="Rows other RAX users shared anonymously (every import is shared) from their own Real sessions. Not Real’s data feed; every row says how many independent reporters saw it.">
      <Users size={11} /> {label}
    </span>
  );
}

/** The small public summary line in Tabs 2–3: what the community database holds and how to add to it. Nothing is shown if the endpoint is unavailable. */
export function CommunityLine({ community }: { community: CommunityMarket }) {
  const s = community.summary;
  if (community.status !== 'ready' || !s) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted" aria-label="Community data">
      <Users size={12} className="shrink-0" />
      <span className="num" title={`${s.verified.sales.toLocaleString('en-US')} sales, ${s.verified.auctions.toLocaleString('en-US')} auctions and ${s.verified.stats.toLocaleString('en-US')} market views are verified (≥ 2 independent reporters). ${s.contributors30d} reporter${s.contributors30d === 1 ? '' : 's'} in the last 30 days.`}>
        {communityLine(s, Date.now())}
      </span>
      <button className="underline" onClick={() => window.dispatchEvent(new Event(OPEN_CAPTURE_EVENT))}>
        How to contribute
      </button>
    </p>
  );
}

/** Shown while the Community source is selected: provenance, the verified filter, the combine option and honest empty states. */
export function CommunityControls({ community }: { community: CommunityMarket }) {
  const c = community;
  const empty = c.state.store.auctions.length + c.state.store.sales.length + c.state.store.stats.length === 0;
  return (
    <div className="space-y-2 rounded-md border border-line px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <CommunityBadge label={c.label} />
        <label className="inline-flex items-center gap-1.5" title="A row is verified when at least 2 different people, on different networks, reported it. One person can’t verify their own data, so this is the filter that keeps a single bad contribution out of the premium and spike calculations.">
          <input type="checkbox" checked={c.verifiedOnly} onChange={(e) => c.setVerifiedOnly(e.target.checked)} /> Verified only <span className="text-muted">(≥ 2 independent reporters)</span>
        </label>
        {c.hasLocal && (
          <label className="inline-flex items-center gap-1.5" title="Add what you captured yourself. A sale or auction that is in both is counted once.">
            <input type="checkbox" checked={c.combine} onChange={(e) => c.setCombine(e.target.checked)} /> Also include my local capture <span className="text-muted">(de-duplicated)</span>
          </label>
        )}
        <button className="btn-ghost btn-sm" onClick={c.reload} disabled={c.loading}>
          {c.loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      {c.verifiedOnly && c.hidden > 0 && (
        <p className="text-muted">
          {c.hidden.toLocaleString('en-US')} community row{c.hidden === 1 ? ' is' : 's are'} hidden because only one person has reported {c.hidden === 1 ? 'it' : 'them'} so far — untick “Verified only” to see {c.hidden === 1 ? 'it' : 'them'}, at your own risk.
        </p>
      )}
      {c.truncated && <p className="text-amber">The database holds more rows than this page loads; the newest are shown.</p>}
      {empty && !c.loading && (
        <p className="text-muted">{c.available ? (c.verifiedOnly ? 'Nothing is verified yet for this view — more people sharing the same captures is what verifies them.' : 'Nothing to show yet.') : 'The community database is empty (or unreachable).'}</p>
      )}
    </div>
  );
}
