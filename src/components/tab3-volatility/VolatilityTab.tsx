import { useEffect, useMemo, useState } from 'react';
import { useMarketSpikes, type MarketSportFilter } from '../../hooks/useMarketSpikes';
import { useRateHistory } from '../../hooks/useRateHistory';
import { loadSnapshot } from '../../lib/snapshots';
import { SPORTS } from '../../../shared/formulas';
import { DataBadge, SampleNotice } from '../ui/DataBadge';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { SportTabs } from '../ui/SportSelect';
import SourceSelect, { type SourceId, type SourceOption } from '../ui/SourceSelect';
import { Stat } from '../ui/Stat';
import ForecastPanel from './ForecastPanel';
import HistoryProgress from './HistoryProgress';
import PackVsBids from './PackVsBids';
import RateboardDemand from './RateboardDemand';
import RateHistoryPanel from './RateHistoryPanel';
import SpikeCards from './SpikeCards';
import ValuationScatter from './ValuationScatter';
import VolumeCandles from './VolumeCandles';

/** Sports Rateboard lists offers for — the Rateboard source can only be filtered by these. */
const RB_SPORT_LIST = ['NFL', 'CFB', 'FC', 'NHL', 'UFC'] as const;

export default function VolatilityTab() {
  const [source, setSource] = useState<SourceId>('rateboard');
  const [sport, setSport] = useState<MarketSportFilter>('ALL');
  const rate = source === 'rateboard';
  const hist = useRateHistory(rate);
  const { data, error, loading, reload } = useMarketSpikes(sport, source);
  const [selected, setSelected] = useState<string | null>(null);
  const [showPacks, setShowPacks] = useState(false); // optional RaxEdge pack-odds panel — off by default
  const snap = useMemo(() => loadSnapshot(), []);

  const options: SourceOption[] = [
    {
      value: 'rateboard',
      label: 'Live · Rateboard bids',
      available: true,
      status: hist.data ? `${hist.data.coverage.spanDays.toFixed(1)}d` : undefined,
      hint: 'REAL data: standing buy offers on Rateboard’s public board (Rax per rating point), recorded over time into a growing history. These are what buyers offer, not what cards sold for on Real; ratings and rarities are not in the data.',
    },
    {
      value: 'imported',
      label: 'Imported snapshot',
      available: !!snap,
      status: snap ? `${snap.bids.length}` : undefined,
      hint: snap ? `REAL data you copied from your own Real session in Tab 2 (${snap.bids.length} auctions, ${new Date(snap.t).toLocaleString()}); charts are built in this browser only.` : 'Nothing imported yet — paste auctions you copied from your own Real session in Tab 2.',
    },
    { value: 'sample', label: 'Sample', available: true, hint: 'SYNTHETIC demo data (made-up prices) so every chart and the forecast can be explored. Not real.' },
  ];

  const switchSource = (s: SourceId) => {
    setSource(s);
    setSport('ALL');
    setSelected(null);
  };

  // Keep the selection valid for the current sport; default to the hottest spike, else the first player.
  useEffect(() => {
    if (!data) return;
    if (selected && (data.players.some((p) => p.key === selected) || data.spikes.some((p) => p.key === selected))) return;
    setSelected(data.spikes[0]?.key ?? data.players[0]?.key ?? null);
  }, [data, selected]);

  // A card can spike and then lose its bids, so it may be selectable from the spike list without being in the player list.
  const player = useMemo(() => data?.players.find((p) => p.key === selected) ?? data?.spikes.find((p) => p.key === selected) ?? null, [data, selected]);
  const buyAlerts = data?.fair.filter((p) => p.undervalued).length ?? 0;
  const cov = data?.coverage ?? hist.data?.coverage ?? null;
  const waiting = rate && cov && !cov.ready ? `${cov.spanDays.toFixed(1)} day(s) recorded; needs 3. Current rates, buyer counts and the depth-vs-rate chart below are real and already available.` : undefined;
  const sports = rate ? RB_SPORT_LIST : (SPORTS as readonly string[]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Market Volatility &amp; Spike Intelligence</h1>
          <p className="text-sm text-muted">
            {rate
              ? 'How buyers’ standing bid rates move over time — spikes, depth, history and a Monte Carlo range for a player’s bid rate.'
              : 'Price surges, volume spikes and mispriced cards — plus a Monte Carlo range of where a card’s price and rating could go.'}
          </p>
        </div>
        <DataBadge source={data?.source} note={data?.note} />
      </div>
      <SourceSelect value={source} onChange={switchSource} options={options} />
      <SampleNotice source={data?.source} note={data?.note} />
      {data?.source === 'live' && data.note && <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">{data.note}</div>}
      {(data?.source === 'imported' || rate) && data?.note && <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">{data.note}</div>}

      {rate && <RateHistoryPanel coverage={cov} error={hist.error} />}
      <RateboardDemand />

      {rate && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showPacks} onChange={(e) => setShowPacks(e.target.checked)} /> Show cost of rating via packs vs bids <span className="chip-muted">optional · needs your RaxEdge pack-odds import</span>
          </label>
          {showPacks && <PackVsBids />}
        </div>
      )}

      <SportTabs sports={sports as readonly string[]} value={sport as string} onChange={(s) => setSport(s as MarketSportFilter)} allLabel="All sports" />

      {loading && !data && <Loading label={rate ? 'Reading the recorded bid rates…' : 'Scanning the market…'} />}
      {error && (
        <div>
          <ErrorBlock message={error} onRetry={reload} />
          {source !== 'sample' && (
            <button className="btn-ghost btn-sm ml-3" onClick={() => switchSource('sample')}>
              Switch to sample data
            </button>
          )}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={rate ? 'Players with a bid' : 'Cards tracked'} value={String(data.players.length)} />
            <Stat label={rate ? 'Demand spikes' : 'Velocity spikes'} value={waiting ? 'n/a' : String(data.spikes.length)} sub={waiting ? 'needs 3 days of history' : '> 2σ vs 7-day baseline'} tone="amber" />
            <Stat label={rate ? 'Low bid for demand' : 'Buy alerts'} value={String(buyAlerts)} sub={rate ? 'below the depth trendline' : 'below the trendline'} tone="emerald" />
            <Stat
              label={rate ? 'Rate per extra buyer' : 'Market value / rating pt'}
              value={rate ? `${data.model.slope >= 0 ? '+' : ''}${data.model.slope.toFixed(2)}` : `${data.model.slope.toFixed(1)} Rax`}
              sub={`R² ${data.model.r2.toFixed(2)}`}
              tone="blue"
            />
          </div>

          <section aria-label={rate ? 'Demand spikes' : 'Velocity spikes'}>
            <h2 className="mb-2 text-sm font-semibold">{rate ? 'Demand Spike Screener' : 'Velocity Spike Screener'}</h2>
            {rate && cov && !cov.ready && (
              <div className="mb-2">
                <HistoryProgress coverage={cov} what="demand spike screen (it compares the last 24 hours with the seven days before)" />
              </div>
            )}
            <SpikeCards spikes={data.spikes} selected={selected} onSelect={setSelected} unit={data.unit} waiting={waiting && 'The screener compares the last 24 hours with the seven days before it, so it stays off until the recorder has 3 days.'} />
          </section>

          <ValuationScatter points={data.fair} model={data.model} selected={selected} onSelect={setSelected} unit={data.unit} />

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="pl" className="label !mb-0">
              Player
            </label>
            <select id="pl" className="field !w-auto min-w-[260px] max-w-full" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {[...data.players]
                .sort((a, b) => a.playerName.localeCompare(b.playerName))
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.playerName} — {p.sport}
                    {rate ? '' : ` ${p.rating} ${p.rarity ?? ''}`}
                  </option>
                ))}
            </select>
          </div>

          {player && (
            <>
              <VolumeCandles key={`${source}-${player.key}`} playerKey={player.key} name={player.playerName} rating={player.rating} source={source} />
              <ForecastPanel key={`f-${source}-${player.key}`} playerKey={player.key} name={player.playerName} source={source} />
            </>
          )}
        </>
      )}
    </div>
  );
}
