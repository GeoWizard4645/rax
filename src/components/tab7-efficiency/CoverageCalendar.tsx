import { useMemo } from 'react';
import { dayLabel, type DayCell, type SportCeiling } from '../../../shared/otdEfficiency';
import { rax } from '../../lib/format';

/**
 * One row per sport, one cell per day. Green intensity = share of the day's ceiling (what you'd get holding every
 * card) that your set actually claims. Grey = the sport has nothing to claim that day. Amber ring = you hold more
 * paying cards than claim slots (wasted overlap).
 */
export default function CoverageCalendar({ keys, calendar, ceilings, global }: { keys: number[]; calendar: DayCell[]; ceilings: SportCeiling[]; global: boolean }) {
  const rows = useMemo(() => {
    const by = new Map<string, DayCell>();
    for (const c of calendar) by.set(`${c.pool}|${c.mmdd}`, c);
    return ceilings.map((ce) => ({
      sport: ce.sport,
      cells: keys.map((k, i) => {
        const cell = by.get(`${global ? 'ALL' : ce.sport}|${k}`);
        return { k, ceiling: ce.perDay[i], claimed: global ? 0 : cell?.claimed ?? 0, wasted: global ? 0 : cell?.wasted ?? 0, empty: global ? 0 : cell?.emptySlots ?? 0 };
      }),
    }));
  }, [keys, calendar, ceilings, global]);

  const months = useMemo(() => keys.map((k, i) => (i === 0 || k % 100 === 1 ? Math.floor(k / 100) : 0)), [keys]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px] space-y-1">
        <div className="flex items-end gap-px pl-12 text-[9px] text-muted" aria-hidden>
          {keys.map((_k, i) => (
            <div key={i} className="flex-1 overflow-visible whitespace-nowrap">{months[i] ? ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][months[i]] : ''}</div>
          ))}
        </div>
        {rows.map((r) => (
          <div key={r.sport} className="flex items-center gap-px">
            <div className="w-12 shrink-0 pr-1 text-right text-[11px] font-semibold text-muted">{r.sport}</div>
            {r.cells.map((c, i) => {
              const ratio = c.ceiling > 0 ? Math.min(1, c.claimed / c.ceiling) : 0;
              const style = c.ceiling <= 0 ? { background: '#1b2230' } : { background: `rgba(16,185,129,${0.08 + ratio * 0.92})` };
              return (
                <div
                  key={i}
                  className={`h-4 flex-1 rounded-[1px] ${c.wasted > 0 ? 'ring-1 ring-inset ring-amber' : ''}`}
                  style={style}
                  title={`${r.sport} · ${dayLabel(c.k)}: ${c.ceiling > 0 ? `you claim ${rax(c.claimed)} of a possible ${rax(c.ceiling)}` : 'no games to claim'}${c.wasted > 0 ? ` · ${rax(c.wasted)} wasted on overlap` : ''}${c.empty > 0 && c.ceiling > 0 ? ` · ${c.empty} claim slot(s) unused` : ''}`}
                />
              );
            })}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pl-12 pt-1 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: '#1b2230' }} /> no games</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: 'rgba(16,185,129,0.15)' }} /> mostly unclaimed</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-[1px]" style={{ background: 'rgba(16,185,129,1)' }} /> fully claimed</span>
          <span className="inline-flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-[1px] ring-1 ring-inset ring-amber" /> overlap waste</span>
        </div>
      </div>
    </div>
  );
}
