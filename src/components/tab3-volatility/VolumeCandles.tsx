import { Bar, BarChart, CartesianGrid, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { SourceId } from '../ui/SourceSelect';
import HistoryProgress from './HistoryProgress';
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
export default function VolumeCandles({ playerKey, name, rating, source }: { playerKey: string; name: string; rating: number; source: SourceId }) {
  const rate = source === 'rateboard';
  const real = source === 'real' || source === 'community';
  const pooled = real && playerKey.startsWith('pool:');
  const [win, setWin] = useState<Win>('7d');
  const [unit, setUnit] = useState<'card' | 'ppr'>('card');
  const { data, error, loading, reload } = useCandles(playerKey, win, source);
  const div = unit === 'ppr' && !rate && !pooled ? rating : 1;
  const rows = (data?.candles ?? []).map((c) => ({ ...c, open: c.open / div, close: c.close / div, high: c.high / div, low: c.low / div, range: [c.low / div, c.high / div] as [number, number] }));
  const gated = rate && !!data?.coverage && !data.coverage.ready;
  const last = gated ? undefined : rows[rows.length - 1];
  const first = rows[0];
  const change = first && last ? (last.close / first.open - 1) * 100 : 0;

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>
          {name} — {rate ? 'best bid rate history' : real ? (pooled ? 'sale price per rating' : 'sale price history') : 'price history'}
          {last && (
            <span className={`num ml-2 text-xs ${change >= 0 ? 'text-emerald' : 'text-danger'}`}>
              {rate ? `${dec(last.close, 1)}/1` : dec(last.close, unit === 'ppr' ? 2 : 0)} ({change >= 0 ? '+' : ''}
              {dec(change, 1)}%)
            </span>
          )}
        </h2>
        <div className="flex flex-wrap gap-2">
          {!rate && !pooled && <Segmented value={unit} onChange={setUnit} label="Unit" options={[{ value: 'card', label: 'Card price' }, { value: 'ppr', label: 'Per rating' }]} />}
          {!gated && <Segmented value={win} onChange={setWin} label="Window" options={[{ value: '24h', label: '24h' }, { value: '7d', label: '7d' }, { value: '30d', label: '30d' }]} />}
        </div>
      </div>
      {rate && data?.current !== undefined && (
        <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-5">
          {[
            ['Best bid now', data.current ? `${data.current.best}/1` : '—'],
            ['Median bid', data.current ? `${dec(data.current.median, 1)}/1` : '—'],
            ['Buyers standing', data.current ? String(data.current.buyers) : '0'],
            ['Offers', data.current ? String(data.current.offers) : '0'],
            ['House buyer', data.current?.house ? `${data.current.house}/1` : '—'],
          ].map(([l, v]) => (
            <div key={l} className="bg-surface px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider text-muted">{l}</div>
              <div className="num text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>
      )}
      {gated ? (
        <div className="space-y-3 p-3">
          <HistoryProgress coverage={data!.coverage!} what="candles" />
          <RecordedChanges changes={data.changes} />
        </div>
      ) : loading && !data ? (
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
                <YAxis domain={['auto', 'auto']} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" width={56} tickFormatter={(v: number) => (rate ? dec(v, 1) : unit === 'ppr' ? dec(v, 1) : rax(v))} />
                <Tooltip
                  content={({ active, payload }) => {
                    const c = payload?.[0]?.payload as (typeof rows)[number] | undefined;
                    if (!active || !c) return null;
                    const f = (v: number) => (rate ? `${dec(v, 1)}/1` : unit === 'ppr' ? dec(v, 2) : rax(v));
                    return (
                      <div className="num rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
                        <div className="mb-1 font-sans text-muted">{new Date(c.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric' })}</div>
                        O {f(c.open)} · H {f(c.high)} · L {f(c.low)} · C {f(c.close)}
                        <div className="text-muted">{rate ? `${c.volume} buyers standing` : real ? `${c.volume} sale${c.volume === 1 ? '' : 's'} captured` : `volume ${c.volume}`}</div>
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
      {rate && data?.coverage?.ready && <div className="border-t border-line p-3"><RecordedChanges changes={data.changes} /></div>}
      <div className="border-t border-line px-3 py-1.5 text-[11px] text-muted">
        {real
          ? `Candles are built from the individual sales you captured (open/high/low/close of the SALE prices${pooled ? ', per rating point' : ''} in each 1h / 6h / 1-day bucket; timestamps are Real’s own). Windows end at your newest captured sale${data?.asOf ? ` (${new Date(data.asOf).toLocaleString()})` : ''}. Bars show sales captured — what Real’s recent-activity list showed you, not total market volume. Empty buckets are gaps.`
          : rate
          ? 'Candles: 1h (24h view), 6h (7d), 1 day (30d) of the BEST standing bid rate (Rax per rating point) — a buyer’s offer, not a sale price. Bars below show buyers standing. Rates change in steps (people pick 10, 15, 20…), so most candles are flat.'
          : 'Candles: 1h (24h view), 6h (7d), 1 day (30d). Bars below show transactions per candle.'}
      </div>
    </div>
  );
}

type Change = [number, number, number, number, number, number];
/** The raw change log the recorder keeps for one player — real observations, newest first. */
function RecordedChanges({ changes }: { changes?: Change[] }) {
  const rows = [...(changes ?? [])].reverse().slice(0, 12);
  if (!rows.length) return <p className="text-xs text-muted">No recorded changes for this player yet.</p>;
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Recorded changes (when the board first showed each state)</div>
      <div className="max-h-48 overflow-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>Seen (UTC)</th>
              <th className="r">Best bid</th>
              <th className="r">Median</th>
              <th className="r">Buyers</th>
              <th className="r">Offers</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c[0]}>
                <td className="num text-xs">{new Date(c[0]).toISOString().slice(0, 16).replace('T', ' ')}</td>
                <td className="r num">{c[1] ? `${c[1]}/1` : 'no bids'}</td>
                <td className="r num">{c[1] ? `${dec(c[2], 1)}/1` : '—'}</td>
                <td className="r num">{c[3]}</td>
                <td className="r num">{c[4]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
