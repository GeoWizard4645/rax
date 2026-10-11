import { useMemo, useState } from 'react';
import { useRbBoard } from '../../hooks/useRbBoard';
import { useRaxEdge } from '../../lib/raxedgeStore';
import { aggregateBoard } from '../../../shared/rbHistory';
import { DEFAULT_PACK_PRICE, packVsBids } from '../../../shared/packVsBids';
import { dec, pct } from '../../lib/format';
import { Empty, Loading } from '../ui/StateBlock';

const SHOWN = 40;

/**
 * OPTIONAL panel (off by default): cost of a rating point through Player packs (RaxEdge pack odds the user imported)
 * next to the best Rateboard bid for the same player. See shared/packVsBids.ts for the formula and its limits.
 */
export default function PackVsBids() {
  const { packOdds } = useRaxEdge();
  const { board, loading } = useRbBoard();
  const [price, setPrice] = useState(DEFAULT_PACK_PRICE);
  const rows = useMemo(() => (board && packOdds ? packVsBids(aggregateBoard(board), packOdds.players, price) : []), [board, packOdds, price]);

  return (
    <section className="panel overflow-hidden" aria-label="Pack cost versus bids">
      <div className="panel-hd flex-wrap">
        <div>
          <h2>Cost of rating: packs vs bids</h2>
          <p className="text-[11px] font-normal text-muted">Rax per rating point through a Player pack (RaxEdge pack odds you imported) next to the best Rateboard bid for the same player.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-muted">
          Pack price
          <input className="field !w-20 !py-1" inputMode="numeric" value={price} onChange={(e) => setPrice(Math.max(1, Math.round(Number(e.target.value.replace(/[^\d]/g, '')) || 0)))} aria-label="Rax per Player pack" />
          Rax
        </label>
      </div>
      {!packOdds ? (
        <Empty title="No pack odds imported yet">
          Import them from RaxEdge in Tab 7 (My cards → Import from RaxEdge, tick “Pack odds”). They stay in this browser.
        </Empty>
      ) : loading && !board ? (
        <Loading label="Reading the board…" />
      ) : rows.length === 0 ? (
        <Empty title="No player has both a Rateboard bid and a pack-odds row">Only players present in both sources are listed.</Empty>
      ) : (
        <div className="max-h-[460px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th>Player</th>
                <th className="r">Best bid</th>
                <th className="r" title="Cheapest season's pack cost per rating point">Pack cost / rating</th>
                <th className="r">Bid − pack</th>
                <th>Season · avg rating · pulls</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, SHOWN).map((r) => (
                <tr key={r.key}>
                  <td>
                    <span className="font-medium">{r.player}</span> <span className="chip-muted">{r.sport}</span>
                  </td>
                  <td className="r num">{r.bid}/1</td>
                  <td className="r num">{dec(r.cheapest.cost, 1)}</td>
                  <td className={`r num ${r.spread > 0 ? 'text-emerald' : 'text-muted'}`}>
                    {r.spread > 0 ? '+' : ''}
                    {dec(r.spread, 1)} <span className="text-[10px] text-muted">({pct((r.bid / r.cheapest.cost - 1) * 100, 0)})</span>
                  </td>
                  <td className="text-xs">
                    {r.seasons.slice(0, 3).map((s) => (
                      <span key={s.season} className={`mr-2 inline-block ${s.thin ? 'text-amber' : ''}`} title={s.thin ? 'Thin sample — treat with caution' : undefined}>
                        {s.season} · {s.avgCardValue} · {s.sample}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
        Pack cost per rating = pack price ÷ (3 cards × average rating of that player’s pulled cards). Assumes you keep every pull and the pack price above; pulls are random, amber seasons rest on fewer than 5 pulls, bids are standing offers (not sales) and fees are ignored. A comparison of two prices, not advice.
        {rows.length > SHOWN ? ` Showing the ${SHOWN} widest gaps of ${rows.length}.` : ''}
      </div>
    </section>
  );
}
