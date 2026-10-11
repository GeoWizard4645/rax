import { useMemo, useState } from 'react';
import { buildCalendar, type EfficiencyParams } from '../../../shared/otdEfficiency';
import type { OtdCardRecord } from '../../../shared/otdSnapshot';
import { rax } from '../../lib/format';
import type { Level } from '../tab7-efficiency/model';

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Up to 12 years of the same set: each year's claimable total (leap years add Feb 29 anniversaries), waste, and a running
 * total. Whether a card's cap resets every year or is a lifetime total is NOT documented by Real, so both are offered.
 */
export default function MultiYearPanel({ cards, params, levels, firstYear }: { cards: OtdCardRecord[]; params: EfficiencyParams; levels: Map<string, Level>; firstYear: number }) {
  const [years, setYears] = useState(12);
  const [capMode, setCapMode] = useState<'yearly' | 'lifetime'>('yearly');

  const rows = useMemo(() => {
    const cum = new Map<string, number>(); // per-card running total for the lifetime-cap case
    const out: Array<{ year: number; claimed: number; wasted: number; days: number }> = [];
    for (let i = 0; i < years; i++) {
      const y = firstYear + i;
      const win = { start: new Date(Date.UTC(y, 0, 1)), days: isLeap(y) ? 366 : 365 };
      const cal = buildCalendar(cards, { ...params, window: win });
      let claimed = 0;
      let wasted = 0;
      const perCard = new Map<string, number>();
      for (const c of cal) {
        wasted += c.wasted;
        c.payouts.forEach((p, i) => (i < params.claimsPerDay || p.bonus) && perCard.set(p.cardId, (perCard.get(p.cardId) ?? 0) + p.value));
      }
      for (const [id, v] of perCard) {
        const cap = levels.get(id)?.annualCap ?? null;
        if (capMode === 'lifetime' && cap != null) {
          const room = Math.max(0, cap - (cum.get(id) ?? 0));
          const take = Math.min(v, room);
          cum.set(id, (cum.get(id) ?? 0) + take);
          claimed += take;
        } else claimed += v;
      }
      out.push({ year: y, claimed, wasted, days: win.days });
    }
    return out;
  }, [cards, params, levels, firstYear, years, capMode]);

  const total = rows.reduce((s, r) => s + r.claimed, 0);
  const max = Math.max(1, ...rows.map((r) => r.claimed));
  let run = 0;

  return (
    <div className="panel">
      <div className="panel-hd flex-wrap">
        <h2>Multi-year projection</h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs text-muted">years
            <select className="field !w-auto" value={years} onChange={(e) => setYears(+e.target.value)} aria-label="Years to project">{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <div className="seg" role="group" aria-label="Cap period">
            <button aria-pressed={capMode === 'yearly'} onClick={() => setCapMode('yearly')} title="Each card's cap resets every year (working assumption)">Cap resets yearly</button>
            <button aria-pressed={capMode === 'lifetime'} onClick={() => setCapMode('lifetime')} title="A card can only ever earn its cap in total">Cap is lifetime</button>
          </div>
        </div>
      </div>
      {cards.length === 0 ? <p className="hint px-3 py-4">Add cards (or preview the best combination) to project them.</p> : (
        <div className="max-h-[420px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 bg-surface"><tr><th>Year</th><th className="r">Claimable</th><th /><th className="r">Wasted</th><th className="r">Running total</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                run += r.claimed;
                return (
                  <tr key={r.year}>
                    <td>{r.year}{r.days === 366 && <span className="chip-muted ml-1" title="Leap year: Feb 29 anniversaries pay">leap</span>}</td>
                    <td className="r num font-semibold text-emerald">{rax(r.claimed)}</td>
                    <td className="w-32"><div className="h-1.5 rounded bg-emerald/70" style={{ width: `${(r.claimed / max) * 100}%` }} /></td>
                    <td className="r num text-amber">{rax(r.wasted)}</td>
                    <td className="r num text-muted">{rax(run)}</td>
                  </tr>
                );
              })}
              <tr className="font-semibold"><td>Total, {years} yr</td><td className="r num text-emerald">{rax(total)}</td><td /><td /><td /></tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="hint px-3 pb-3">Assumes today's rules, payouts and card levels stay the same (Real changes them — e.g. the July 2026 college buff) and you claim every day. Under a lifetime cap, capped rarities stop earning once they hit it — Real's docs only say "total Rax a card can earn", so check which applies in-app.</p>
    </div>
  );
}
