import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useAuctions } from '../../hooks/useAuctions';
import { useCollections } from '../../hooks/useRealUser';
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
const PULL: RbSport[] = RB_PULLABLE.filter((s) => s !== 'FC'); // sports shared with the auction feed: NFL, CFB, UFC

export default function ScoutTab() {
  const { data, error, loading, reload } = useAuctions();
  const col = useCollections();
  const [input, setInput] = useState('');
  const [view, setView] = useState<View>('radar');
  const [discount, setDiscount] = useState(0);
  const hasUser = !!col.username;

  const submit = () => {
    if (!input.trim()) return;
    void col.load(input, PULL);
    setView((v) => (v === 'radar' ? 'scout' : v));
  };
  const clear = () => {
    col.clear();
    setInput('');
    setView('radar');
  };

  const stats = useMemo(() => {
    if (!data) return null;
    const rows = toRadarRows(data.bids, data.baselines);
    const hot = rows.filter((r) => r.premium >= 40 && r.status === 'active');
    return { active: data.bids.filter((b) => b.status === 'active').length, hot: hot.length, top: rows.reduce((m, r) => Math.max(m, r.premium), 0), contenders: data.contenders.length };
  }, [data]);

  const matches = useMemo(() => (data ? matchBids(data.bids, col.collections).length : 0), [data, col.collections]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Proactive Scout &amp; Overpriced Auction Radar</h1>
          <p className="text-sm text-muted">Find bidders already willing to pay a premium — and DM them a price for the card you own.</p>
        </div>
        <DataBadge source={data?.source} note={data?.note} />
      </div>
      <SampleNotice source={data?.source} note={data?.note} />

      <Explain title="How this works — and what to expect">
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

      {loading && !data && <Loading label="Reading auctions…" />}
      {error && <ErrorBlock message={error} onRetry={reload} />}

      {data && stats && (
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
