import { useEffect, useMemo, useState } from 'react';
import { useMarketSpikes } from '../../hooks/useMarketSpikes';
import { SPORTS } from '../../../shared/formulas';
import type { Sport } from '../../types/real';
import { DataBadge, SampleNotice } from '../ui/DataBadge';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { SportTabs } from '../ui/SportSelect';
import { Stat } from '../ui/Stat';
import ForecastPanel from './ForecastPanel';
import SpikeCards from './SpikeCards';
import ValuationScatter from './ValuationScatter';
import VolumeCandles from './VolumeCandles';

export default function VolatilityTab() {
  const [sport, setSport] = useState<Sport | 'ALL'>('ALL');
  const { data, error, loading, reload } = useMarketSpikes(sport);
  const [selected, setSelected] = useState<string | null>(null);

  // Keep the selection valid for the current sport; default to the hottest spike, else the first player.
  useEffect(() => {
    if (!data) return;
    if (selected && data.players.some((p) => p.key === selected)) return;
    setSelected(data.spikes[0]?.key ?? data.players[0]?.key ?? null);
  }, [data, selected]);

  const player = useMemo(() => data?.players.find((p) => p.key === selected) ?? null, [data, selected]);
  const buyAlerts = data?.fair.filter((p) => p.undervalued).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Market Volatility &amp; Spike Intelligence</h1>
          <p className="text-sm text-muted">Price surges, volume spikes and mispriced cards — plus a Monte Carlo range of where a card's price and rating could go.</p>
        </div>
        <DataBadge source={data?.source} note={data?.note} />
      </div>
      <SampleNotice source={data?.source} note={data?.note} />
      {data?.source === 'live' && data.note && <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">{data.note}</div>}

      <SportTabs sports={SPORTS} value={sport} onChange={setSport} allLabel="All sports" />

      {loading && !data && <Loading label="Scanning the market…" />}
      {error && <ErrorBlock message={error} onRetry={reload} />}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Cards tracked" value={String(data.players.length)} />
            <Stat label="Velocity spikes" value={String(data.spikes.length)} sub="> 2σ vs 7-day baseline" tone="amber" />
            <Stat label="Buy alerts" value={String(buyAlerts)} sub="below the trendline" tone="emerald" />
            <Stat label="Market value / rating pt" value={`${data.model.slope.toFixed(1)} Rax`} sub={`R² ${data.model.r2.toFixed(2)}`} tone="blue" />
          </div>

          <section aria-label="Velocity spikes">
            <h2 className="mb-2 text-sm font-semibold">Velocity Spike Screener</h2>
            <SpikeCards spikes={data.spikes} selected={selected} onSelect={setSelected} />
          </section>

          <ValuationScatter points={data.fair} model={data.model} selected={selected} onSelect={setSelected} />

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="pl" className="label !mb-0">
              Player
            </label>
            <select id="pl" className="field !w-auto min-w-[260px]" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {[...data.players]
                .sort((a, b) => a.playerName.localeCompare(b.playerName))
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.playerName} — {p.sport} {p.rating} {p.rarity}
                  </option>
                ))}
            </select>
          </div>

          {player && (
            <>
              <VolumeCandles key={player.key} playerKey={player.key} name={player.playerName} rating={player.rating} />
              <ForecastPanel key={`f-${player.key}`} playerKey={player.key} name={player.playerName} />
            </>
          )}
        </>
      )}
    </div>
  );
}
