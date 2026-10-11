import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useScoutSurface } from '../../agent/surfaces/useSimpleSurfaces';
import { useAuctions } from '../../hooks/useAuctions';
import { clearSnapshot, loadSnapshot, snapshotToResponse, type Snapshot } from '../../lib/snapshots';
import ImportPanel from './ImportPanel';
import { useCollections } from '../../hooks/useRealUser';
import { useRbBoard } from '../../hooks/useRbBoard';
import { useRateHistory } from '../../hooks/useRateHistory';
import SourceSelect, { type SourceId, type SourceOption } from '../ui/SourceSelect';
import RateboardBids, { useBidStats } from './RateboardBids';
import { RB_PULLABLE, type RbSport } from '../../../shared/rateboard';
import { DataBadge, SampleNotice } from '../ui/DataBadge';
import { Explain } from '../ui/Explain';
import { ErrorBlock, Loading, Spinner } from '../ui/StateBlock';
import { Segmented } from '../ui/Segmented';
import { Stat } from '../ui/Stat';
import { rax } from '../../lib/format';
import ContenderBoard from './ContenderBoard';
import DiscountSlider from './DiscountSlider';
import OverpricedRadar, { toRadarRows } from './OverpricedRadar';
import UserMatcherTable, { matchBids } from './UserMatcherTable';

type View = 'radar' | 'scout' | 'contenders';
const NO_BASELINES: Record<string, number> = {};
const PULL: RbSport[] = RB_PULLABLE.filter((s) => s !== 'FC'); // sports shared with the auction feed: NFL, CFB, UFC

export default function ScoutTab() {
  const api = useAuctions();
  const [snap, setSnap] = useState<Snapshot | null>(loadSnapshot);
  const imported = useMemo(() => (snap ? snapshotToResponse(snap) : null), [snap]);
  const rb = useRbBoard();
  const hist = useRateHistory();
  const baselines = hist.data?.baselines ?? NO_BASELINES;
  const [chosen, setChosen] = useState<SourceId | null>(null);
  const bidStats = useBidStats(rb.board, baselines);
  // Default: the best REAL source that has data — Rateboard's live board; else an import; else sample.
  const rbHasData = !!rb.board && rb.board.offers.length > 0;
  const source: SourceId = chosen ?? (rb.loading ? 'rateboard' : rbHasData ? 'rateboard' : snap ? 'imported' : 'sample');
  const rate = source === 'rateboard';
  const data = source === 'imported' ? imported : source === 'sample' ? api.data : null;
  const { error, loading, reload } = source === 'imported' ? { error: null, loading: false, reload: () => {} } : source === 'sample' ? api : { error: null, loading: false, reload: () => {} };
  const col = useCollections();
  const [input, setInput] = useState('');
  const [view, setView] = useState<View>('radar');
  const [discount, setDiscount] = useState(0);
  const hasUser = !!col.username;

  const submit = () => {
    if (!input.trim()) return;
    void col.load(input, rate ? RB_PULLABLE : PULL);
    setView((v) => (v === 'radar' ? 'scout' : v));
  };
  const clear = () => {
    col.clear();
    setInput('');
    setView('radar');
  };

  const stats = useMemo(() => {
    if (!data || rate) return null;
    const rows = toRadarRows(data.bids, data.baselines);
    const hot = rows.filter((r) => r.premium >= 40 && r.status === 'active');
    return { active: data.bids.filter((b) => b.status === 'active').length, hot: hot.length, top: rows.reduce((m, r) => Math.max(m, r.premium), 0), contenders: data.contenders.length };
  }, [data]);

  const matches = useMemo(() => (data ? matchBids(data.bids, col.collections).length : 0), [data, col.collections]);
  useScoutSurface({ username: input, setUsername: setInput, view, setView, discount, setDiscount, stats, source: data?.source, imported: !!imported, matches, pulling: col.pulling ? String(col.pulling) : null, collectionsLoaded: Object.keys(col.collections), submit, reload });

  const options: SourceOption[] = [
    {
      value: 'rateboard',
      label: 'Live · Rateboard bids',
      available: true,
      status: rb.board ? String(rb.board.offers.length) : undefined,
      hint: 'REAL data: every standing buy offer on Rateboard’s public board is a “bid” (buyer, player, sport, Rax per rating point). Card rating, rarity and auction timing are not in the data and are shown as unknown. Not Real sale prices.',
    },
    {
      value: 'imported',
      label: 'Imported snapshot',
      available: !!snap,
      status: snap ? String(snap.bids.length) : undefined,
      hint: snap ? `REAL auctions you copied from your own Real session (${snap.bids.length}, ${new Date(snap.t).toLocaleString()}); parsed and stored in this browser only.` : 'Nothing imported yet — paste auctions you copied from your own Real session below.',
    },
    api.data?.source === 'live'
      ? { value: 'sample', label: 'Live · Real feed', available: true, hint: 'Auctions from the authorised Real upstream configured for this deployment.' }
      : { value: 'sample', label: 'Sample', available: true, hint: 'SYNTHETIC demo auctions and bidders (made-up prices) so every view can be explored. Not real.' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Proactive Scout &amp; Overpriced Auction Radar</h1>
          <p className="text-sm text-muted">Find bidders already willing to pay a premium — and DM them a price for the card you own.</p>
        </div>
        <DataBadge source={rate ? 'rateboard' : data?.source} note={data?.note} />
      </div>
      <SourceSelect value={source} onChange={setChosen} options={options} />
      <SampleNotice source={data?.source} note={data?.note} />
      {source === 'imported' && imported && snap && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-action/30 bg-action/5 px-3 py-2 text-xs text-head">
          <span>Showing <b>your imported snapshot</b> of {snap.bids.length} auctions from {new Date(snap.t).toLocaleString()}. Premiums use {Object.values(imported.baselineKinds).includes('history') ? 'your earlier imports where available, otherwise' : ''} similar cards in the same snapshot.</span>
          <button className="btn-ghost btn-sm" onClick={() => { clearSnapshot(); setSnap(null); setChosen(null); }}>Forget my import</button>
        </div>
      )}

      <Explain title={rate ? 'How this works on Rateboard data — and what it can’t tell you' : 'How this works — and what to expect'}>
        {rate ? (
          <>
            <p>
              <b className="text-head">Where the data comes from.</b> Rateboard’s public board lists standing <i>buy offers</i>: a buyer, a player and a rate — “I’ll pay 20 Rax per rating point.” Real’s own marketplace and auction data needs a signed-in app session and isn’t available to this site, so these offers are the real demand signal we <i>can</i> read for free, with its owner’s permission.
            </p>
            <p>
              <b className="text-head">Bids above market.</b> Each offer is compared with the going rate for that player: his own 7-day median bid rate once ≥ 3 days of history are recorded, otherwise the median of the other buyers on him (or, if nobody else bids, the sport’s median — flagged in the row). A big premium means that buyer is offering well over what others pay.
            </p>
            <p>
              <b className="text-head">Proactive Scout.</b> Enter your Real username (we pull your collection through Rateboard’s card pull) to list the buyers bidding on cards you own, with Rateboard’s copy-ready message and the link to their comment. <b className="text-head">Repeat bidders</b> are accounts with several live offers at once.
            </p>
            <p className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-amber/90">
              <b>What is unknown, and shown as unknown:</b> the card’s rating and rarity, whether the buyer holds copies, any auction timer, any highest-bid or sale history. An offer can also be stale — people don’t always remove them. Contact goes through the buyer’s own comment under Rateboard’s pinned post; be polite and don’t spam.
            </p>
          </>
        ) : (
          <>
            <p>
              <b className="text-head">Overpriced Radar.</b> Every auction row shows <span className="num">per-rating price = highest bid ÷ card rating</span>, compared with that player's own 7-day median per-rating price. A big <i>premium</i> means someone is paying well above normal for that card.
            </p>
            <p>
              <b className="text-head">Proactive Scout.</b> Enter your Real username and we pull your collection (through Rateboard's card pull — NFL, CFB and UFC overlap with the auction feed), then list bidders who are bidding on a card <i>you already own</i>. The slider sets your asking price from −70% off up to +30% over their bid, and the pitch box writes the DM for you.
            </p>
            <p>
              <b className="text-head">Repeat Contenders.</b> A separate view for Mystic/Legendary holders who are hammering the same player — e.g. someone with Jaxon Smith-Njigba at Mystic ×4 who has bid and bought him all week. They're priced at the average per-rating they've actually been paying.
            </p>
            <p className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-amber/90">
              <b>Be realistic:</b> there is a good chance the person you DM never replies, let alone makes an offer. Bidders may already have won elsewhere, be inactive, or simply ignore unsolicited messages. Treat this as a lead list — a handful of polite, specific DMs, not a mass blast — and never spam.
            </p>
            <p>
              Note the feed shows only each auction's <i>highest</i> bidder, so a bidder who was outbid can't be identified; "recent buyer" rows show people who just paid, which signals demand but not that they still want one.
            </p>
          </>
        )}
      </Explain>

      <form
        className="panel flex flex-wrap items-end gap-3 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="min-w-[220px] flex-1">
          <label className="label" htmlFor="sc-user">
            Your Real username <span className="normal-case tracking-normal">(optional — unlocks Proactive Scout)</span>
          </label>
          <input id="sc-user" className="field" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Leave empty for the Overpriced Radar" autoComplete="off" spellCheck={false} />
        </div>
        <button className="btn-primary" type="submit" disabled={!input.trim() || !!col.pulling}>
          {col.pulling ? <Spinner /> : <Search size={14} />} {col.pulling ? 'Pulling…' : 'Scout my cards'}
        </button>
        {hasUser && (
          <button type="button" className="btn-ghost" onClick={clear}>
            Clear
          </button>
        )}
        {col.pulling && (
          <span className="w-full text-xs text-muted">
            {col.progress?.waitSec ? `Starting ${col.pulling} pull in ${col.progress.waitSec}s…` : `Fetching ${col.pulling} cards…`} (collection pulls are spread out to protect Real — up to ~10 s per sport)
          </span>
        )}
        {Object.entries(col.errors).map(([s, m]) => (
          <span key={s} className="w-full text-xs text-danger">
            {s}: {m}
          </span>
        ))}
      </form>

      <ImportPanel onImported={(s) => { setSnap(s); setChosen('imported'); }} />

      {rate && (
        <>
          {rb.loading && !rb.board && <Loading label="Reading Rateboard’s board…" />}
          {rb.error && !rb.board && (
            <div>
              <ErrorBlock message={rb.error} onRetry={() => void rb.refresh(true)} />
              <button className="btn-ghost btn-sm ml-3" onClick={() => setChosen('sample')}>Switch to sample data</button>
            </div>
          )}
          {rb.board && bidStats && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Standing bids" value={rax(bidStats.bids)} sub={`${rax(bidStats.players)} players`} />
                <Stat label="Buyers" value={rax(bidStats.buyers)} tone="blue" />
                <Stat label="Bids ≥ 40% over market" value={rax(bidStats.hot)} sub="vs the going rate" tone="amber" />
                <Stat label="Top premium" value={`+${Math.round(bidStats.topPremium)}%`} tone="amber" />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  value={view}
                  onChange={setView}
                  label="View"
                  options={[
                    { value: 'radar', label: 'Bids above market' },
                    { value: 'scout', label: 'Proactive Scout' },
                    { value: 'contenders', label: 'Repeat bidders' },
                  ]}
                />
                <button className="btn-ghost btn-sm" onClick={() => void rb.refresh(true)}>
                  Refresh
                </button>
              </div>
              {view === 'scout' && col.pulling ? (
                <div className="panel px-4 py-8 text-center text-sm text-muted">Pulling your collection…</div>
              ) : (
                <RateboardBids board={rb.board} baselines={baselines} collections={col.collections} view={view} />
              )}
              <p className="text-[11px] text-muted">
                Source: Rateboard’s public board ({rb.fetchedAt ? `read ${new Date(rb.fetchedAt).toLocaleTimeString()}` : 'live'}); history baselines from the bid-rate recorder ({hist.data ? `${hist.data.coverage.spanDays.toFixed(1)} days recorded` : 'loading'}).
              </p>
            </>
          )}
        </>
      )}

      {!rate && loading && !data && <Loading label="Reading auctions…" />}
      {!rate && error && <ErrorBlock message={error} onRetry={reload} />}

      {!rate && data && stats && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Live auctions" value={rax(stats.active)} />
            <Stat label="Bidding wars" value={rax(stats.hot)} sub="premium ≥ 40%" tone="amber" />
            <Stat label="Top premium" value={`+${Math.round(stats.top)}%`} tone="amber" />
            <Stat label={hasUser ? 'Bidders on your cards' : 'Repeat contenders'} value={rax(hasUser ? matches : stats.contenders)} tone={hasUser ? 'emerald' : 'blue'} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented
              value={view}
              onChange={setView}
              label="View"
              options={[
                { value: 'radar', label: 'Overpriced Radar' },
                { value: 'scout', label: 'Proactive Scout' },
                { value: 'contenders', label: 'Repeat Contenders' },
              ]}
            />
            <button className="btn-ghost btn-sm" onClick={reload}>
              Refresh
            </button>
          </div>

          {view !== 'radar' && <DiscountSlider value={discount} onChange={setDiscount} />}

          {view === 'radar' && <OverpricedRadar bids={data.bids} baselines={data.baselines} />}
          {view === 'scout' &&
            (hasUser && !col.pulling ? (
              <UserMatcherTable bids={data.bids} collections={col.collections} discount={discount} />
            ) : (
              <div className="panel px-4 py-8 text-center text-sm text-muted">{col.pulling ? 'Pulling your collection…' : 'Enter your username above to see bidders on the cards you own.'}</div>
            ))}
          {view === 'contenders' && <ContenderBoard contenders={data.contenders} collections={col.collections} discount={discount} />}
        </>
      )}
    </div>
  );
}
