import { useMemo } from 'react';
import { dayLabel, sportCeilings, windowKeys, type EfficiencyParams } from '../../../shared/otdEfficiency';
import type { OtdCardRecord } from '../../../shared/otdSnapshot';
import { rax } from '../../lib/format';

const BUCKET = 30;

/**
 * "What's coming up": for each sport, the most the best cards could pay in each 30-day block of the next year.
 * The selected timeframe is outlined. A sport that is quiet now but heavy later is worth waiting for (or buying early
 * if you expect prices to rise into its season — Tab 3).
 */
export default function OutlookPanel({ cards, params, windowDaysN }: { cards: OtdCardRecord[]; params: EfficiencyParams; windowDaysN: number }) {
  const year = useMemo<EfficiencyParams>(() => ({ ...params, window: { ...params.window, days: 360 } }), [params]);
  const keys = useMemo(() => windowKeys(year.window), [year]);
  const ceilings = useMemo(() => sportCeilings(cards, year), [cards, year]);
  const blocks = Math.ceil(keys.length / BUCKET);
  const inWindow = Math.ceil(windowDaysN / BUCKET);

  return (
    <div className="panel">
      <div className="panel-hd"><h2>Sport outlook — 30-day blocks from the start date</h2><span className="hint">ceiling = what the best cards in the dataset pay if you held all of them</span></div>
      <div className="panel-bd overflow-x-auto">
        <div className="min-w-[640px] space-y-2">
          <div className="flex pl-14 text-[10px] text-muted">
            {Array.from({ length: blocks }, (_, b) => <div key={b} className="flex-1">{dayLabel(keys[b * BUCKET])}</div>)}
          </div>
          {ceilings.map((c) => {
            const sums = Array.from({ length: blocks }, (_, b) => c.perDay.slice(b * BUCKET, (b + 1) * BUCKET).reduce((s, v) => s + v, 0));
            const max = Math.max(...sums, 1);
            return (
              <div key={c.sport} className="flex items-end gap-0">
                <div className="w-14 shrink-0 pb-0.5 text-xs font-semibold text-muted">{c.sport}</div>
                {sums.map((v, b) => (
                  <div key={b} className={`flex h-10 flex-1 items-end px-px ${b < inWindow ? 'bg-action/10' : ''}`} title={`${c.sport}, from ${dayLabel(keys[b * BUCKET])}: up to ${rax(v)} Rax`}>
                    <div className="w-full rounded-t-[2px] bg-emerald" style={{ height: `${Math.max(2, (v / max) * 100)}%`, opacity: v > 0 ? 0.35 + 0.65 * (v / max) : 0.15 }} />
                  </div>
                ))}
              </div>
            );
          })}
          <p className="hint">Blue-tinted blocks are inside your timeframe. Bars are scaled per sport, so compare shape (when) here and size in the table below.</p>
          <table className="tbl">
            <thead><tr><th>Sport</th><th className="r">Days with a claim</th><th className="r">Ceiling in timeframe</th><th className="r">Best 30 days of the year</th></tr></thead>
            <tbody>
              {sportCeilingsInWindow(cards, params).map((r) => (
                <tr key={r.sport}><td>{r.sport}</td><td className="r num">{r.activeDays}</td><td className="r num font-semibold text-emerald">{rax(r.total)}</td><td className="r num text-muted">{rax(r.best30)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function sportCeilingsInWindow(cards: OtdCardRecord[], p: EfficiencyParams) {
  const inW = sportCeilings(cards, p);
  const full = sportCeilings(cards, { ...p, window: { ...p.window, days: 365 } });
  return inW.map((c) => {
    const f = full.find((x) => x.sport === c.sport)!;
    let best = 0;
    for (let i = 0; i + BUCKET <= f.perDay.length; i += 5) best = Math.max(best, f.perDay.slice(i, i + BUCKET).reduce((s, v) => s + v, 0));
    return { sport: c.sport, activeDays: c.activeDays, total: c.total, best30: best };
  });
}
