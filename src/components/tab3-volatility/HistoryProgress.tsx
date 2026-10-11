import type { RateCoverage } from '../../types/market';
import { MIN_HISTORY_DAYS, MIN_HISTORY_HOURS } from '../../../shared/rbHistory';

/** "N days of data" + how far we are from the 3 days the history-based panels need. Shown wherever rates-over-time are withheld. */
export default function HistoryProgress({ coverage, what }: { coverage: RateCoverage; what: string }) {
  const pct = Math.min(100, Math.round(Math.min(coverage.spanDays / MIN_HISTORY_DAYS, coverage.hoursSampled / MIN_HISTORY_HOURS) * 100));
  return (
    <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90" role="status">
      <b>Only {coverage.spanDays.toFixed(1)} day{coverage.spanDays >= 0.95 && coverage.spanDays < 1.05 ? '' : 's'} of bid-rate history so far</b> ({coverage.hoursSampled} hour{coverage.hoursSampled === 1 ? '' : 's'} sampled). Needed for the {what}: {MIN_HISTORY_DAYS} days
      ({MIN_HISTORY_HOURS}+ sampled hours). Until then none are drawn — nothing is filled in. History is recorded from Rateboard’s public board as time passes{coverage.seeded ? ` (including ${coverage.seeded} of Rateboard’s own rolling backups)` : ''}.
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber/20" aria-hidden>
        <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Real marketplace source: how many distinct days of captured SALES a series has against what a feature needs.
 * Unlike the Rateboard recorder this never grows by itself — it grows each time you capture, on a new day.
 */
export function GrowingHistoryProgress({ days, need, what, subject }: { days: number; need: number; what: string; subject?: string }) {
  const pct = Math.min(100, Math.round((days / need) * 100));
  return (
    <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber/90" role="status">
      <b>{subject ? `${subject}: ` : ''}{days} distinct day{days === 1 ? '' : 's'} of captured sales so far</b> — the {what} needs {need}. Nothing is filled in until then. This history grows <b>each time you capture</b>: open “Market data” on the same cards on different days and import again; every import adds the sales you saw and keeps the ones you already had.
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber/20" aria-hidden>
        <div className="h-full bg-amber" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
