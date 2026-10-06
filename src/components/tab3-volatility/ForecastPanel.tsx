import { useDeferredValue, useMemo, useState } from 'react';
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Dices } from 'lucide-react';
import { useForecastInputs } from '../../hooks/useMarketSpikes';
import { DEFAULT_SCENARIO, simulate, type BandPoint, type Scenario } from '../../../shared/montecarlo';
import { dec, pct, rax } from '../../lib/format';
import { DataBadge } from '../ui/DataBadge';
import { Explain } from '../ui/Explain';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { Segmented } from '../ui/Segmented';

type Metric = 'ppr' | 'price' | 'rating';
const HORIZONS = [7, 14, 30, 60, 90] as const;
const annualToDaily = (yearlyPct: number) => Math.log(1 + yearlyPct / 100) / 365;
const PHASE_LABEL: Record<string, string> = {
  early: 'early season', mid: 'mid-season', stretch: 'stretch run', playoffs: 'playoffs', offseason: 'off-season', 'year-round': 'year-round (no season)',
};

/**
 * Monte Carlo projection for one player: a fan of 4,000 simulated paths for per-rating price, card price and rating.
 * Stochastic simulation only (no ML) — see shared/montecarlo.ts for the model and its stated assumptions.
 */
export default function ForecastPanel({ playerKey, name }: { playerKey: string; name: string }) {
  const { data: inp, error, loading, reload } = useForecastInputs(playerKey);
  const [metric, setMetric] = useState<Metric>('ppr');
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>(30);
  const [autoHype, setAutoHype] = useState(true);
  const [hype, setHype] = useState(40);
  const [driftYr, setDriftYr] = useState(0);
  const [volMult, setVolMult] = useState(1);
  const [salt, setSalt] = useState(0);

  const scenario: Scenario = useDeferredValue({
    ...DEFAULT_SCENARIO,
    horizonDays: horizon,
    hypeShare: autoHype ? null : hype / 100,
    driftBias: annualToDaily(driftYr),
    volMult,
    salt,
  });
  // `now` is pinned per input load so slider changes re-run the same market snapshot, not a moving clock.
  const now = useMemo(() => Date.now(), [inp]); // eslint-disable-line react-hooks/exhaustive-deps
  const fc = useMemo(() => (inp ? simulate(inp, scenario, now) : null), [inp, scenario, now]);

  const chart = useMemo(() => {
    if (!inp || !fc) return [];
    const bands: BandPoint[] = metric === 'ppr' ? fc.ppr : metric === 'price' ? fc.price : fc.rating;
    const mult = metric === 'price' ? inp.rating : 1;
    const hist = metric === 'rating' ? [] : inp.daily.map((d) => ({ d: Math.round((d.t - now) / 86_400_000), hist: d.ppr * mult }));
    const fut = bands.map((b) => ({ d: b.d, base: b.p5, lo: b.p25 - b.p5, mid: b.p75 - b.p25, hi: b.p95 - b.p75, p50: b.p50, p5: b.p5, p25: b.p25, p75: b.p75, p95: b.p95 }));
    return [...hist, ...fut];
  }, [inp, fc, metric, now]);

  if (loading && !inp) return <Loading label="Loading forecast inputs…" />;
  if (error) return <ErrorBlock message={error} onRetry={reload} />;
  if (!inp || !fc) return null;

  const f = metric === 'ppr' ? (v: number) => dec(v, 2) : metric === 'price' ? (v: number) => rax(v) : (v: number) => dec(v, 1);
  const stats = metric === 'price' ? fc.priceStats : metric === 'ppr' ? fc.pprStats : null;
  const last = (metric === 'ppr' ? fc.ppr : metric === 'price' ? fc.price : fc.rating).at(-1)!;
  const start = metric === 'ppr' ? inp.currentPpr : metric === 'price' ? inp.currentPpr * inp.rating : inp.rating;
  const d = fc.params.diagnostics;
  const unit = metric === 'ppr' ? 'Rax per rating point' : metric === 'price' ? 'Rax per card' : 'rating points';
  const checkpoints = HORIZONS.filter((h) => h <= horizon || h === horizon);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>
          {name} — Monte Carlo projection <span className="num ml-1 text-xs font-normal text-muted">{fc.paths.toLocaleString()} paths</span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <DataBadge source={inp.source} />
          <Segmented value={metric} onChange={setMetric} label="Metric" options={[{ value: 'ppr', label: 'Per rating' }, { value: 'price', label: 'Card price' }, { value: 'rating', label: 'Rating' }]} />
        </div>
      </div>

      <div className="grid gap-3 border-b border-line p-3 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <span className="label">Horizon</span>
          <Segmented value={String(horizon) as `${number}`} onChange={(v) => setHorizon(+v as (typeof HORIZONS)[number])} label="Horizon" options={HORIZONS.map((h) => ({ value: String(h) as `${number}`, label: `${h}d` }))} />
        </div>
        <div>
          <label className="label flex items-center justify-between" htmlFor="hype">
            <span>Hype share of today's premium</span>
            <label className="flex items-center gap-1 normal-case tracking-normal">
              <input type="checkbox" checked={autoHype} onChange={(e) => setAutoHype(e.target.checked)} /> auto ({Math.round(fc.params.hypeShare * 100)}%)
            </label>
          </label>
          <input id="hype" type="range" min={0} max={90} step={5} value={autoHype ? Math.round(fc.params.hypeShare * 100) : hype} disabled={autoHype} onChange={(e) => setHype(+e.target.value)} className="w-full accent-[#F59E0B]" />
          <p className="hint">Hype fades (6-day half-life); the rest of any premium/discount is treated as level.</p>
        </div>
        <div>
          <label className="label flex justify-between" htmlFor="drift">
            <span>Drift bias</span>
            <span className="num normal-case tracking-normal text-head">{driftYr > 0 ? '+' : ''}{driftYr}% / yr</span>
          </label>
          <input id="drift" type="range" min={-60} max={60} step={5} value={driftYr} onChange={(e) => setDriftYr(+e.target.value)} className="w-full accent-[#3B82F6]" />
          <p className="hint">Your view on top of the seasonal drift.</p>
        </div>
        <div>
          <label className="label flex justify-between" htmlFor="vol">
            <span>Volatility ×</span>
            <span className="num normal-case tracking-normal text-head">{dec(volMult, 2)}</span>
          </label>
          <div className="flex items-center gap-2">
            <input id="vol" type="range" min={0.5} max={2.5} step={0.05} value={volMult} onChange={(e) => setVolMult(+e.target.value)} className="w-full accent-[#F59E0B]" />
            <button className="btn-ghost btn-sm shrink-0" onClick={() => setSalt((s) => s + 1)} title="Re-run with fresh random draws">
              <Dices size={13} /> Re-roll
            </button>
          </div>
        </div>
      </div>

      <div className="h-[360px] px-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#232D3F" strokeDasharray="3 3" />
            <XAxis dataKey="d" type="number" domain={[metric === 'rating' ? 0 : 'dataMin', horizon]} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" tickFormatter={(v: number) => (v === 0 ? 'today' : `${v > 0 ? '+' : ''}${v}d`)} />
            <YAxis domain={['auto', 'auto']} tick={{ fill: '#9CA3AF', fontSize: 11 }} stroke="#232D3F" width={56} tickFormatter={(v: number) => f(v)} />
            <Tooltip
              content={({ active, payload }) => {
                const p = payload?.[0]?.payload as Record<string, number> | undefined;
                if (!active || !p) return null;
                return (
                  <div className="num rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-xl">
                    <div className="mb-1 font-sans text-muted">{p.d === 0 ? 'today' : p.d < 0 ? `${-p.d}d ago` : `in ${p.d}d`}</div>
                    {p.hist != null ? (
                      <div>actual {f(p.hist)}</div>
                    ) : (
                      <>
                        <div>95% {f(p.p95)}</div>
                        <div>75% {f(p.p75)}</div>
                        <div className="text-head">median {f(p.p50)}</div>
                        <div>25% {f(p.p25)}</div>
                        <div>5% {f(p.p5)}</div>
                      </>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} payload={[{ value: 'actual', type: 'line', color: '#F9FAFB', id: 'a' }, { value: 'median', type: 'line', color: '#10B981', id: 'm' }, { value: '25–75%', type: 'rect', color: '#3B82F6', id: 'i' }, { value: '5–95%', type: 'rect', color: '#3B82F6', id: 'o' }]} />
            <Area dataKey="base" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" activeDot={false} />
            <Area dataKey="lo" stackId="band" stroke="none" fill="#3B82F6" fillOpacity={0.14} isAnimationActive={false} legendType="none" activeDot={false} />
            <Area dataKey="mid" stackId="band" stroke="none" fill="#3B82F6" fillOpacity={0.34} isAnimationActive={false} legendType="none" activeDot={false} />
            <Area dataKey="hi" stackId="band" stroke="none" fill="#3B82F6" fillOpacity={0.14} isAnimationActive={false} legendType="none" activeDot={false} />
            <Line dataKey="p50" stroke="#10B981" strokeWidth={2} dot={false} isAnimationActive={false} legendType="none" />
            <Line dataKey="hist" stroke="#F9FAFB" strokeWidth={1.6} dot={false} connectNulls isAnimationActive={false} legendType="none" />
            <ReferenceLine x={0} stroke="#9CA3AF" strokeDasharray="4 4" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        {[
          { l: `Median @ ${horizon}d`, v: f(last.p50), s: `${pct((last.p50 / start - 1) * 100, 1)} vs now`, c: 'text-emerald' },
          { l: '90% range', v: `${f(last.p5)} – ${f(last.p95)}`, s: unit, c: '' },
          { l: 'P(higher)', v: stats ? `${Math.round(stats.pUp * 100)}%` : '—', s: 'than today', c: '' },
          { l: 'P(+20% or more)', v: stats ? `${Math.round(stats.pUp20 * 100)}%` : '—', s: '', c: 'text-emerald' },
          { l: 'P(−20% or worse)', v: stats ? `${Math.round(stats.pDown20 * 100)}%` : '—', s: '', c: 'text-danger' },
          { l: 'Bad-case avg (worst 5%)', v: stats ? f(stats.expectedShortfall5) : '—', s: stats ? `1% tail ${f(stats.p1)}` : '', c: 'text-amber' },
        ].map((x) => (
          <div key={x.l} className="bg-surface px-3 py-2">
            <div className="text-[11px] uppercase tracking-wider text-muted">{x.l}</div>
            <div className={`num text-sm font-semibold ${x.c}`}>{x.v}</div>
            <div className="num text-[11px] text-muted">{x.s}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto border-t border-line">
        <table className="tbl">
          <thead>
            <tr>
              <th>{unit}</th>
              {checkpoints.map((h) => <th key={h} className="r">+{h}d</th>)}
            </tr>
          </thead>
          <tbody>
            {([['5%', 'p5'], ['25%', 'p25'], ['Median', 'p50'], ['75%', 'p75'], ['95%', 'p95']] as const).map(([label, k]) => (
              <tr key={k}>
                <td className={k === 'p50' ? 'font-semibold text-emerald' : 'text-muted'}>{label}</td>
                {checkpoints.map((h) => {
                  const b = (metric === 'ppr' ? fc.ppr : metric === 'price' ? fc.price : fc.rating)[h];
                  return <td key={h} className={`r num ${k === 'p50' ? 'font-semibold' : ''}`}>{b ? f(b[k]) : '—'}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 border-t border-line p-3">
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <span>Season: <b className="text-head">{PHASE_LABEL[fc.phaseNow.phase] ?? fc.phaseNow.phase}</b>{fc.phaseNow.daysToStart != null && ` · ${Math.round(fc.phaseNow.daysToStart)}d to kickoff`}</span>
          <span className="num">daily σ {dec(fc.params.sigma * 100, 1)}% → {dec(fc.params.sigmaEff * 100, 1)}% (thin-market ×{dec(d.thinInflation, 2)})</span>
          <span className="num">{dec(d.volPerDay, 1)} trades/day · quote noise ±{dec(fc.params.obsSd * 100, 0)}%</span>
          <span className="num">anchor {dec(d.anchorPpr, 2)}/rating · now {dec(inp.currentPpr, 2)}</span>
          <span className="num">own history weight {Math.round(d.wOwn * 100)}% ({d.returnsUsed} days) · peers n={inp.peers.n} ({inp.peers.scope})</span>
        </div>
        <Explain title="How this projection works — and its limits">
          <p>
            Each of the {fc.paths.toLocaleString()} paths simulates the log per-rating price day by day as a <b className="text-head">fundamental level plus decaying hype</b>. The level drifts with the <b className="text-head">season calendar</b> (pre-season ramp, in-season, playoffs, post-season decay, off-season), reverts slowly to an anchor built from this card's own 30-day median shrunk toward <b className="text-head">similar cards</b> (same sport &amp; rarity), and is hit by fat-tailed (Student-t) shocks and occasional jumps. Rating follows its own bounded, mean-reverting process with weekly in-season shocks and a refresh at season start, and is correlated with price.
          </p>
          <p>
            <b className="text-head">Why the range is wide on purpose:</b> volatility is inflated when few trades happen, each path draws its own uncertain drift and volatility, jumps and fat tails are included, and the quoted price at each date carries extra noise that grows as volume falls — Real is a thin, non-efficient market where one bidder can move a price. Treat the 5–95% band as "plausible", not "certain".
          </p>
          <p className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-amber/90">
            <b>Assumptions, not facts:</b> the seasonal drift sizes, hype half-life, jump frequency and rating volatility are sensible priors — they are not fitted to Real's market (only ~30 days of price history exist here, so "previous seasons" enter as priors rather than data). Once multi-season history is available these should be re-fitted. {inp.source === 'sample' ? 'This card is on SAMPLE data, so the numbers illustrate the method only. ' : ''}Not financial advice.
          </p>
        </Explain>
      </div>
    </div>
  );
}
