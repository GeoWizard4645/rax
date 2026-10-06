import { Bar, BarChart, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useCandles } from '../../hooks/useMarketSpikes';
import { dec, rax } from '../../lib/format';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { Segmented } from '../ui/Segmented';
import { useState } from 'react';

type Win = '24h' | '7d' | '30d';
const UP = '#10B981', DOWN = '#F87171';

interface CandleShapeProps {
  x?: number; y?: number; width?: number; height?: number;
  payload?: { open: number; close: number; high: number; low: number };
}
/** Recharts has no candlestick: draw wick + body ourselves inside the [low, high] bar's box. */
function Candle({ x = 0, y = 0, width = 0, height = 0, payload }: CandleShapeProps) {
  if (!payload) return null;
  const { open, close, high, low } = payload;
  const span = high - low || 1;
  const py = (v: number) => y + ((high - v) / span) * height;
  const up = close >= open;
  const color = up ? UP : DOWN;
  const cx = x + width / 2;
  const top = py(Math.max(open, close));
  const bodyH = Math.max(1.5, Math.abs(py(open) - py(close)));
  const bw = Math.max(2, width * 0.7);
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} strokeWidth={1.2} />
      <rect x={cx - bw / 2} y={top} width={bw} height={bodyH} fill={color} />
    </g>
  );
}

const fmtT = (t: number, w: Win) => {
  const d = new Date(t);
  if (w === '24h') return d.toLocaleTimeString([], { hour: 'numeric' });
  if (w === '7d') return `${d.toLocaleDateString([], { weekday: 'short' })} ${d.toLocaleTimeString([], { hour: 'numeric' })}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/** Price history (OHLC) + volume for one player over 24h / 7d / 30d. */
export default function VolumeCandles({ playerKey, name, rating }: { playerKey: string; name: string; rating: number }) {
  const [win, setWin] = useState<Win>('7d');
  const [unit, setUnit] = useState<'card' | 'ppr'>('card');
  const { data, error, loading, reload } = useCandles(playerKey, win);
  const div = unit === 'ppr' ? rating : 1;
  const rows = (data?.candles ?? []).map((c) => ({ ...c, open: c.open / div, close: c.close / div, high: c.high / div, low: c.low / div, range: [c.low / div, c.high / div] as [number, number] }));
  const last = rows[rows.length - 1];
  const first = rows[0];
  const change = first && last ? (last.close / first.open - 1) * 100 : 0;

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>
          {name} — price history
          {last && (
            <span className={`num ml-2 text-xs ${change >= 0 ? 'text-emerald' : 'text-danger'}`}>
              {dec(last.close, unit === 'ppr' ? 2 : 0)} ({change >= 0 ? '+' : ''}
              {dec(change, 1)}%)
            </span>
          )}
        </h2>
        <div className="flex gap-2">
          <Segmented value={unit} onChange={setUnit} label="Unit" options={[{ value: 'card', label: 'Card price' }, { value: 'ppr', label: 'Per rating' }]} />
          <Segmented value={win} onChange={setWin} label="Window" options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }]} />
        </div>
      </div>
      {loading && !data ? (
        <Loading />
      ) : error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : (
        <>
          <div className="h-[250px] px-2 pt-3">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="#232D3F" strokeDasharray="3 3" />
                <XAxis dataKey="t" tickFormatter={(t: number) => fmtT(t, win)} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" minTickGap={28} />
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" width={56} tickFormatter={(v: number) => (unit === 'ppr' ? dec(v, 1) : rax(v))} />
                <Tooltip
                  content={({ active, payload }) => {
                    const c = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                    if (!active || !c) return null;
                    const f = (v: number) => (unit === 'ppr' ? dec(v, 2) : rax(v));
                    return (
                      <div className="num rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
                        <div className="mb-1 font-sans text-muted">{new Date(c.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })}</div>
                        O {f(c.open)} · H {f(c.high)} · L {f(c.low)} · C {f(c.close)}
                        <div className="text-muted">volume {c.volume}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="range" shape={<Candle />} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[90px] px-2 pb-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                <XAxis dataKey="t" hide />
                <YAxis width={56} tick={{ fill: '#9CA3AF', fontSize: 10 }} stroke="#232D3F" />
                <Bar dataKey="volume" fill="#F59E0B" fillOpacity={0.65} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">Candles: 1h (24h view), 6h (7d), 1 day (30d). Bars below show transactions per candle.</div>
    </div>
  );
}
