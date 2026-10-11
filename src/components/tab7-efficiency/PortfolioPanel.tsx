import { useMemo } from 'react';
import { buildPortfolio, proBonusValue, sportCeilings, windowKeys, type EfficiencyParams, type PortfolioOptions } from '../../../shared/otdEfficiency';
import type { OtdCardRecord } from '../../../shared/otdSnapshot';
import { rax } from '../../lib/format';
import { Stat } from '../ui/Stat';
import CoverageCalendar from './CoverageCalendar';
import type { Level } from './model';

const WHY: Record<string, string> = {
  budget: 'Stopped: the next-best card no longer fits the budget.',
  count: 'Stopped: reached the max number of cards.',
  'no-gain': 'Stopped: no remaining card adds any claimable payout in this window.',
  candidates: 'Stopped: ran out of cards.',
};

export default function PortfolioPanel({
  cards, params, options, levels, proWin,
}: { cards: OtdCardRecord[]; params: EfficiencyParams; options: PortfolioOptions; levels: Map<string, Level>; proWin: number }) {
  const pf = useMemo(() => buildPortfolio(cards, params, options), [cards, params, options]);
  const ceilings = useMemo(() => sportCeilings(cards, params), [cards, params]);
  const keys = useMemo(() => windowKeys(params.window), [params.window]);
  const ceilingTotal = ceilings.reduce((s, c) => s + c.total, 0);
  const bonus = useMemo(() => (proWin > 0 ? proBonusValue(pf.picks.map((p) => p.row.card), params, proWin) : null), [pf, params, proWin]);
  const roi = pf.totalNetCost > 0 ? pf.totalEarn / pf.totalNetCost : 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Window earnings" value={rax(pf.totalEarn)} />
        <Stat label="Total price" value={rax(pf.totalPrice)} />
        <Stat label="Efficiency" value={`${(roi * 100).toFixed(roi < 0.1 ? 1 : 0)}%`} />
        <Stat label="Wasted on overlap" value={rax(pf.wasted)} />
        <Stat label="Of the sport ceiling" value={ceilingTotal > 0 ? `${((pf.totalEarn / ceilingTotal) * 100).toFixed(1)}%` : '—'} />
      </div>
      {bonus && (bonus.days > 0
        ? <p className="hint">Pro bonus claim (if you place it well): ≈ <b className="num text-head">{rax(bonus.value)}</b> extra Rax expected across {bonus.days} days at a {Math.round(proWin * 100)}% poll-win rate — not included above.</p>
        : <p className="hint">Pro bonus claim: none of your days has a spare payout beyond the 2 guaranteed claims per sport, so the extra Pro claim would have nothing to claim yet.</p>)}
      <p className="hint">
        <b>{pf.mode === 'min-overlap' ? 'Minimize-overlap' : 'Max-earnings'} mode.</b> Starts from two greedy passes, then improves the set with add / drop / swap and randomised restarts
        {pf.objective > pf.greedyObjective + 1 ? <> (+{rax(pf.objective - pf.greedyObjective)} over plain greedy)</> : null}. Checked against exhaustive search on small cases: it found the true optimum in ≥ 95% and never less than 97% of it. On the full dataset it is a very good answer, not a proof of the global optimum.
      </p>
      <p className="hint">{WHY[pf.stoppedBecause]} Cards are chosen one at a time by <b>extra</b> payout per Rax of cost, so a card that only duplicates days you already cover is skipped — that is how overlaps are handled.</p>
      <div className="panel overflow-hidden">
        <div className="panel-hd"><h2>Recommended set ({pf.picks.length})</h2></div>
        <div className="max-h-[520px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 bg-surface"><tr><th className="r">#</th><th>Card</th><th>Rung</th><th className="r">Price</th><th className="r">Adds</th><th className="r">Adds ÷ cost</th><th className="r">Running total</th></tr></thead>
            <tbody>
              {pf.picks.map((p, i) => (
                <tr key={p.row.card.id}>
                  <td className="r num text-muted">{i + 1}</td>
                  <td><span className="font-medium">{p.row.card.name}</span> <span className="chip-muted">{p.row.card.sport}</span> <span className="num text-xs text-muted">{p.row.card.seasonLabel}</span></td>
                  <td className="text-xs text-muted">{levels.get(p.row.card.id)?.key ?? '—'}</td>
                  <td className="r num">{p.row.price ? rax(p.row.price) : 'owned'}</td>
                  <td className="r num font-semibold text-emerald">{rax(p.marginal)}</td>
                  <td className="r num">{Number.isFinite(p.marginalRoi) ? `${(p.marginalRoi * 100).toFixed(p.marginalRoi < 0.1 ? 1 : 0)}%` : '—'}</td>
                  <td className="r num text-muted">{rax(p.cumEarn)}</td>
                </tr>
              ))}
              {pf.picks.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-muted">Nothing fits — raise the budget or timeframe.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="panel">
        <div className="panel-hd"><h2>Claim coverage, day by day</h2><span className="hint">dark = nothing to claim · green = your cards claim it</span></div>
        <div className="panel-bd"><CoverageCalendar keys={keys} calendar={pf.calendar} ceilings={ceilings} global={params.scope === 'global'} /></div>
      </div>
    </div>
  );
}
