import { useMemo } from 'react';
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import type { FairValueModel, FairValuePoint } from '../../types/market';
import { dec, pct, rax } from '../../lib/format';

/** Fair Value Index: median sale price vs card rating, with the linear-regression "market value per rating point" line. */
export default function ValuationScatter({ points, model, selected, onSelect }: { points: FairValuePoint[]; model: FairValueModel; selected: string | null; onSelect: (key: string) => void }) {
  const { normal, under, line } = useMemo(() => {
    const ratings = points.map((p) => p.rating);
    const lo = Math.min(...ratings), hi = Math.max(...ratings);
    return {
      normal: points.filter((p) => !p.undervalued),
      under: points.filter((p) => p.undervalued),
      line: points.length ? [lo, hi].map((x) => ({ rating: x, fair: Math.max(0, model.intercept + model.slope * x) })) : [],
    };
  }, [points, model]);
  const undervalued = [...under].sort((a, b) => a.deviation - b.deviation);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>Fair Value Index</h2>
        <span className="num text-xs text-muted">
          {dec(model.slope, 2)} Rax / rating point · R² {dec(model.r2, 2)} · n={model.n}
        </span>
      </div>
      <div className="h-[340px] px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid stroke="#232D3F" strokeDasharray="3 3" />
            <XAxis type="number" dataKey="rating" name="Rating" domain={['dataMin - 1', 'dataMax + 1']} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" label={{ value: 'Card rating points', position: 'insideBottom', offset: -2, fill: '#9CA3AF', fontSize: 11 }} />
            <YAxis type="number" dataKey="medianPrice" name="Median price" tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" tickFormatter={(v: number) => rax(v)} width={56} label={{ value: 'Median sale price (Rax)', angle: -90, position: 'insideLeft', fill: '#9CA3AF', fontSize: 11 }} />
            <ZAxis range={[40, 40]} />
            <Tooltip
              cursor={{ strokeDasharray: '3 3', stroke: '#3B82F6' }}
              content={({ active, payload }) => {
                const p = payload?.find((x) => x.payload?.playerName)?.payload as FairValuePoint | undefined;
                if (!active || !p) return null;
                return (
                  <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
                    <div className="text-sm font-semibold">{p.playerName}</div>
                    <div className="num text-muted">{p.sport} · rating {p.rating}</div>
                    <div className="num">median {rax(p.medianPrice)} Rax · fair {rax(p.fairPrice)}</div>
                    <div className={`num ${p.undervalued ? 'text-emerald' : 'text-muted'}`}>{pct(p.deviation * 100, 0)} vs trendline{p.undervalued ? ' — Undervalued / Buy Alert' : ''}</div>
                  </div>
                );
              }}
            />
            <Scatter name="Cards" data={normal} fill="#3B82F6" fillOpacity={0.55} onClick={(d: any) => d?.key && onSelect(d.key)} cursor="pointer" />
            <Scatter name="Undervalued" data={under} fill="#10B981" onClick={(d: any) => d?.key && onSelect(d.key)} cursor="pointer" />
            {selected && <Scatter name="Selected" data={points.filter((p) => p.key === selected)} fill="none" stroke="#F59E0B" strokeWidth={2} shape="circle" legendType="none" />}
            <Line data={line} dataKey="fair" type="linear" stroke="#F59E0B" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} name="Trend" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="border-t border-line">
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted">
          <span className="chip-emerald">Undervalued / Buy Alert</span> ≥ 1 residual-σ and ≥ 15% below the trendline ({undervalued.length})
        </div>
        {undervalued.length > 0 && (
          <div className="max-h-48 overflow-auto">
            <table className="tbl">
              <tbody>
                {undervalued.map((p) => (
                  <tr key={p.key} className="cursor-pointer" onClick={() => onSelect(p.key)}>
                    <td className="font-medium">
                      {p.playerName} <span className="chip-muted">{p.sport}</span>
                    </td>
                    <td className="r num">{p.rating}</td>
                    <td className="r num">{rax(p.medianPrice)}</td>
                    <td className="r num text-muted">fair {rax(p.fairPrice)}</td>
                    <td className="r num text-emerald">{pct(p.deviation * 100, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
