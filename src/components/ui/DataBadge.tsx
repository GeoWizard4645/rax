import { ClipboardPaste, FlaskConical, Radio } from 'lucide-react';
import type { DataSource } from '../../types/market';

/** Every panel that can show synthetic data carries one of these, so SAMPLE is never mistaken for LIVE. */
export function DataBadge({ source, note }: { source: DataSource | null | undefined; note?: string }) {
  if (!source) return null;
  if (source === 'imported') {
    return (
      <span className="chip-blue" title={note || 'A snapshot you imported from your own session'}>
        <ClipboardPaste size={11} /> IMPORTED
      </span>
    );
  }
  return source === 'live' ? (
    <span className="chip-emerald" title={note || 'Live upstream data'}>
      <Radio size={11} /> LIVE
    </span>
  ) : (
    <span className="chip-amber" title={note || 'Synthetic sample data — the live feed is not connected'}>
      <FlaskConical size={11} /> SAMPLE DATA
    </span>
  );
}

export function SampleNotice({ source, note }: { source: DataSource | null | undefined; note?: string }) {
  if (source !== 'sample') return null;
  return (
    <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90">
      <b>Sample data.</b> {note || 'The live feed for this panel is not connected, so prices, bids and bidders shown are synthetic.'} The maths, filters and workflows are the real thing — see the README to connect a feed.
    </div>
  );
}
