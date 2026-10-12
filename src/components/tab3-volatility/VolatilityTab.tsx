import { useEffect, useMemo, useState } from 'react';
import { useMarketSpikes, type MarketSportFilter } from '../../hooks/useMarketSpikes';
import { useRateHistory } from '../../hooks/useRateHistory';
import { loadSnapshot } from '../../lib/snapshots';
import { useVolatilitySurface } from '../../agent/surfaces/useSimpleSurfaces';
import { SPORTS } from '../../../shared/formulas';
import { DataBadge, SampleNotice } from '../ui/DataBadge';
import { ErrorBlock, Loading } from '../ui/StateBlock';
import { SportTabs } from '../ui/SportSelect';
import SourceSelect, { type SourceId, type SourceOption } from '../ui/SourceSelect';
import { Stat } from '../ui/Stat';
import ForecastPanel from './ForecastPanel';
import HistoryProgress, { GrowingHistoryProgress } from './HistoryProgress';
import RealCaptureImport from '../RealCaptureImport';
import { useRealMarket } from '../../lib/realMarketStore';
import { useCommunityMarket } from '../../hooks/useCommunityMarket';
import { CommunityBadge, CommunityControls, CommunityLine } from '../CommunityData';
import { BidVsFairScatter, RealDailyHistory, RealFairTable, RealMarketPanel } from './RealPanels';
import PackVsBids from './PackVsBids';
import RateboardDemand from './RateboardDemand';
import RateHistoryPanel from './RateHistoryPanel';
import SpikeCards from './SpikeCards';
import ValuationScatter from './ValuationScatter';
import VolumeCandles from './VolumeCandles';

/** Sports Rateboard lists offers for — the Rateboard source can only be filtered by these. */
const RB_SPORT_LIST = ['NFL', 'CFB', 'FC', 'NHL', 'UFC'] as const;
/** Price spikes compare the last 24 h with the seven days before it; a few days of sales per card is the least that can mean anything. */
const MIN_HISTORY_DAYS_REAL = 4;

const realLabel = (p: { key: string; playerName: string; sport: string; rating: number; rarity: string | null }, sales: number) =>
  p.key.startsWith('pool:') ? `${p.playerName} — pooled, per rating · ${sales} sales` : `${p.playerName} — ${p.sport === 'ALL' ? '' : `${p.sport} `}${p.rating} ${p.rarity ?? ''} · ${sales} sales`;

export default function VolatilityTab() {
  const localReal = useRealMarket();
  const community = useCommunityMarket();
  const [chosen, setChosen] = useState<SourceId | null>(null);
  // Default: your own captured Real data when there is some (sales or market stats); else the community database when it has some; else Rateboard's recorded bid rates.
  const pick = (chosen === 'real' && !localReal.hasData) || (chosen === 'community' && !community.available) ? null : chosen; // the capture was cleared (or the community DB is unreachable) while it was selected
  const source: SourceId = pick ?? (localReal.hasHistory ? 'real' : community.hasHistory ? 'community' : 'rateboard');
  const setSource = setChosen;
  const [sport, setSport] = useState<MarketSportFilter>('ALL');
  const rate = source === 'rateboard';
  const isCommunity = source === 'community';
  const isReal = source === 'real' || isCommunity;
  const real = isCommunity ? community.state : localReal; // what the Real-style panels render
  const { loadRows } = community;
  useEffect(() => {
    if (isCommunity) void loadRows();
  }, [isCommunity, loadRows]);
  const hist = useRateHistory(rate);
  const { data, error, loading, reload } = useMarketSpikes(sport, source);
  const [selected, setSelected] = useState<string | null>(null);
  const [showPacks, setShowPacks] = useState(false); // optional RaxEdge pack-odds panel — off by default
  const snap = useMemo(() => loadSnapshot(), []);

  const options: SourceOption[] = [
    {
      value: 'real',
      label: 'Real marketplace · captured',
      available: localReal.hasData,
      status: localReal.hasData ? `${localReal.coverage.priceSales} sales` : undefined,
      hint: localReal.hasData
        ? `REAL data you recorded from your own signed-in Real session: ${localReal.summary}. Prices, timestamps and market stats are Real’s own; history only grows as you capture. ${localReal.label}.`
        : 'Nothing captured yet — open “Capture real Real-marketplace data” below and record the Marketplace and some “Market data” views from your own session.',
    },
    {
      value: 'community',
      label: 'Community (shared by RAX users)',
      available: community.available,
      status: community.available ? `${community.counts.sales} sales` : undefined,
      hint: community.available
        ? `Sales and market stats other RAX users shared anonymously from their own Real sessions — ${community.summary?.rows.total.toLocaleString('en-US')} rows from ${community.summary?.contributors} reporter${community.summary?.contributors === 1 ? '' : 's'}. “Verified only” (≥ 2 independent reporters) is on by default. History only reaches back as far as people have shared.`
        : 'The community database is empty or unavailable. Importing a capture shares it anonymously and starts it.',
    },
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
  // Real: only the sports the captured auctions identified (sales carry no sport); pooled series of unknown sport appear under "All".
  const realSports = useMemo(() => [...new Set(real.derived.series.map((x) => x.sport as string))].filter((x) => x !== 'ALL').sort(), [real.derived]);
  const sports = isReal ? realSports : rate ? RB_SPORT_LIST : (SPORTS as readonly string[]);
  useVolatilitySurface({
    source, setSource: switchSource, availableSources: options.filter((o) => o.available).map((o) => o.value), sport, setSport, allowedSports: isReal ? realSports : rate ? RB_SPORT_LIST : (SPORTS as readonly string[]),
    players: data?.players ?? [], selected, setSelected, spikes: data?.spikes ?? [], fair: data?.fair ?? [], dataSource: data?.source, slope: data?.model?.slope, r2: data?.model?.r2, historyDays: isReal ? real.coverage.spanDays : cov?.spanDays,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Market Volatility &amp; Spike Intelligence</h1>
          <p className="text-sm text-muted">
            {isReal
              ? isCommunity
                ? 'Real sale prices and fair values other RAX users shared anonymously from their own Real sessions — daily price history, price spikes, bids against fair value, and a Monte Carlo range once there are enough days of sales.'
                : 'Real sale prices and fair values you captured from your own Real session — daily price history, price spikes, bids against fair value, and a Monte Carlo range once there are enough days of sales.'
              : rate
              ? 'How buyers’ standing bid rates move over time — spikes, depth, history and a Monte Carlo range for a player’s bid rate.'
              : 'Price surges, volume spikes and mispriced cards — plus a Monte Carlo range of where a card’s price and rating could go.'}
          </p>
        </div>
        {isCommunity ? <CommunityBadge label={community.label} /> : <DataBadge source={data?.source} note={data?.note} />}
      </div>
      <SourceSelect value={source} onChange={switchSource} options={options} />
      <SampleNotice source={data?.source} note={data?.note} />
      <CommunityLine community={community} />
      {isCommunity && <CommunityControls community={community} />}
      <RealCaptureImport />
      {data?.source === 'live' && data.note && <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">{data.note}</div>}
      {(data?.source === 'imported' || data?.source === 'real' || rate) && data?.note && <div className="rounded-md border border-line px-3 py-2 text-xs text-muted">{data.note}</div>}

      {rate && <RateHistoryPanel coverage={cov} error={hist.error} />}
      {isReal && <RealMarketPanel real={real} community={isCommunity} />}
      {isReal && <RealFairTable real={real} community={isCommunity} />}
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
      {isReal && error && <div className="panel px-4 py-6 text-center text-sm text-muted">{error}</div>}
      {error && !isReal && (
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
            <Stat label={rate ? 'Players with a bid' : isReal ? 'Cards & pools with sales' : 'Cards tracked'} value={String(data.players.length)} />
            <Stat label={rate ? 'Demand spikes' : isReal ? 'Price spikes' : 'Velocity spikes'} value={waiting ? 'n/a' : isReal && data.real && !data.real.eligible ? 'n/a' : String(data.spikes.length)} sub={waiting ? 'needs 3 days of history' : isReal ? (data.real?.eligible ? `${data.real.eligible} card${data.real.eligible === 1 ? '' : 's'} tested` : 'not enough sales yet') : '> 2σ vs 7-day baseline'} tone="amber" />
            <Stat label={rate ? 'Low bid for demand' : 'Buy alerts'} value={isReal && !data.fair.length ? 'n/a' : String(buyAlerts)} sub={rate ? 'below the depth trendline' : isReal && !data.fair.length ? 'needs ≥ 4 cards' : 'below the trendline'} tone="emerald" />
            <Stat
              label={rate ? 'Rate per extra buyer' : 'Market value / rating pt'}
              value={rate ? `${data.model.slope >= 0 ? '+' : ''}${data.model.slope.toFixed(2)}` : isReal && !data.fair.length ? 'n/a' : `${data.model.slope.toFixed(1)} Rax`}
              sub={isReal && !data.fair.length ? 'needs ≥ 4 cards' : `R² ${data.model.r2.toFixed(2)}`}
              tone="blue"
            />
          </div>

          <section aria-label={rate ? 'Demand spikes' : isReal ? 'Price spikes' : 'Velocity spikes'}>
            <h2 className="mb-2 text-sm font-semibold">{rate ? 'Demand Spike Screener' : isReal ? 'Price Spike Screener (real sale prices)' : 'Velocity Spike Screener'}</h2>
            {rate && cov && !cov.ready && (
              <div className="mb-2">
                <HistoryProgress coverage={cov} what="demand spike screen (it compares the last 24 hours with the seven days before)" />
              </div>
            )}
            {isReal && data.real && !data.real.eligible && real.coverage.salesDays < MIN_HISTORY_DAYS_REAL && (
              <div className="mb-2">
                <GrowingHistoryProgress days={real.coverage.salesDays} need={MIN_HISTORY_DAYS_REAL} what="price-spike screen (it needs several earlier days of sales per card to compare with)" />
              </div>
            )}
            <SpikeCards spikes={data.spikes} selected={selected} onSelect={setSelected} unit={data.unit} emptyNote={isReal ? data.real?.reason : undefined} waiting={waiting && 'The screener compares the last 24 hours with the seven days before it, so it stays off until the recorder has 3 days.'} />
          </section>

          {isReal && <BidVsFairScatter real={real} />}

          {(!isReal || data.fair.length > 0) && <ValuationScatter points={data.fair} model={data.model} selected={selected} onSelect={setSelected} unit={data.unit} />}

          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="pl" className="label !mb-0">
              Player
            </label>
            <select id="pl" className="field !w-auto min-w-[260px] max-w-full" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {[...data.players]
                .sort((a, b) => a.playerName.localeCompare(b.playerName))
                .map((p) => (
                  <option key={p.key} value={p.key}>
                    {isReal ? realLabel(p, real.derived.byKey.get(p.key)?.series.sales ?? 0) : `${p.playerName} — ${p.sport}${rate ? '' : ` ${p.rating} ${p.rarity ?? ''}`}`}
                  </option>
                ))}
            </select>
          </div>

          {player && (
            <>
              {isReal && real.derived.byKey.get(player.key) && <RealDailyHistory key={`d-${player.key}`} name={player.playerName} obs={real.derived.byKey.get(player.key)!.obs} perRating={player.key.startsWith('pool:')} label={real.label} />}
              <VolumeCandles key={`${source}-${player.key}`} playerKey={player.key} name={player.playerName} rating={player.rating} source={source} />
              <ForecastPanel key={`f-${source}-${player.key}`} playerKey={player.key} name={player.playerName} source={source} />
            </>
          )}
        </>
      )}
    </div>
  );
}
