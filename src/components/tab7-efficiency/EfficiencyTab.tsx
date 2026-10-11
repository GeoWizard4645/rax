import { useCallback, useMemo, useState } from 'react';
import { rankCards, type EfficiencyParams, type PortfolioOptions } from '../../../shared/otdEfficiency';
import type { OtdSport } from '../../../shared/otdSnapshot';
import { Explain } from '../ui/Explain';
import { Segmented } from '../ui/Segmented';
import { Loading } from '../ui/StateBlock';
import CardRankings from './CardRankings';
import Controls from './Controls';
import MethodPanel from './MethodPanel';
import OutlookPanel from './OutlookPanel';
import PortfolioPanel from './PortfolioPanel';
import ProfilePanel from './ProfilePanel';
import SwapCalc from './SwapCalc';
import UpgradeLadder from './UpgradeLadder';
import { buildLevels, effParams, windowDays, windowStart } from './model';
import { useEffState } from './useEffState';
import { useOtdSnapshot } from './useOtdSnapshot';

type View = 'rank' | 'portfolio' | 'mine' | 'outlook' | 'ladder' | 'swaps';

export default function EfficiencyTab() {
  const { s, set, setS } = useEffState();
  const [view, setView] = useState<View>('rank');

  const snap = useOtdSnapshot(s.method);
  const all = snap.data?.cards;
  const available = useMemo(() => [...new Set((all ?? []).map((c) => c.sport))] as OtdSport[], [all]);
  const sportsOn = useMemo(() => new Set<OtdSport>(s.sports.length ? s.sports : available), [s.sports, available]);
  const cards = useMemo(() => (all ?? []).filter((c) => sportsOn.has(c.sport)), [all, sportsOn]);

  const levels = useMemo(() => buildLevels(cards, s), [cards, s.rarity, s.autoMin, s.multOverride, s.rate, s.overrides, s.ownedLevels]); // eslint-disable-line react-hooks/exhaustive-deps
  const days = windowDays(s);
  const start = useMemo(() => windowStart(s), [s.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const params = useMemo<EfficiencyParams>(() => effParams(s, levels, sportsOn, { start, days }), [start, days, levels, sportsOn, s.hold, s.flipLoss]); // eslint-disable-line react-hooks/exhaustive-deps

  const ownedSet = useMemo(() => new Set(Object.keys(s.ownedLevels)), [s.ownedLevels]);
  const rows = useMemo(() => rankCards(cards, params), [cards, params]);
  const options = useMemo<PortfolioOptions>(() => ({ budget: s.budget, maxCards: s.maxCards, minMarginalRoi: 0, ownedIds: ownedSet }), [s.budget, s.maxCards, ownedSet]);

  const onOverride = useCallback((id: string, price: number | null) => setS((x) => {
    const rung = levels.get(id)?.key;
    if (!rung) return x;
    const o = { ...x.overrides, [id]: { ...(x.overrides[id] ?? {}) } };
    if (price == null) delete o[id][rung]; else o[id][rung] = price;
    if (!Object.keys(o[id]).length) delete o[id];
    return { ...x, overrides: o };
  }), [levels]);
  const overridesFlat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [id, byRung] of Object.entries(s.overrides)) { const k = levels.get(id)?.key; if (k && byRung[k] != null) m[id] = byRung[k]; }
    return m;
  }, [s.overrides, levels]);
  const toggleOwned = useCallback((id: string) => setS((x) => {
    const o = { ...x.ownedLevels };
    if (o[id]) delete o[id];
    else o[id] = levels.get(id)?.key ?? 'Iconic';
    return { ...x, ownedLevels: o };
  }), [levels, setS]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">OTD Efficiency</h1>
        <p className="text-sm text-muted">Which cards, at which rarity, earn the most On-This-Day Rax per Rax you spend — over the timeframe you pick, with overlapping claims accounted for.</p>
      </div>

      <MethodPanel method={s.method} onMethod={(m) => set({ method: m })} snapshot={snap.data} loading={snap.loading} error={snap.error} />

      <Explain title="How efficiency is calculated">
        <p><span className="num text-head">Payout per card = min(cap, multiplier × Σ General-level rax)</span> — the multiplier and cap come from Real's player-card ladder (Common 2× … Mystic 10 105× … Iconic 1 150× up to Iconic 20 250×). Below Iconic the cap is ≈ 500 × the multiplier, so any card with ~500+ General rax a season pays the same flat amount at, say, Legendary 3 — only Iconic is uncapped.</p>
        <p>You get <b className="text-head">2 guaranteed claims per sport per day</b>, so a card is only worth what it adds on days its sport isn't already covered. The portfolio picker adds cards one at a time by <i>extra</i> payout per Rax of cost, which discounts overlaps automatically. Pro's bonus claim is shown separately as an expected value.</p>
        <p><span className="num text-head">Cost = 200 + rating needed × Rax-per-rating.</span> Real has no upgrade fee: a card's level is the summed rating of the play cards you own for that player-season, so "upgrading" means buying rating. The default rate is Rateboard's median standing offer — an estimate, not a sale price.</p>
      </Explain>

      <Controls s={s} set={set} available={available} />

      <Segmented<View> value={view} onChange={setView} label="View" options={[
        { value: 'rank', label: 'Card rankings' }, { value: 'portfolio', label: 'Best combination' }, { value: 'mine', label: `My cards${Object.keys(s.ownedLevels).length ? ` (${Object.keys(s.ownedLevels).length})` : ''}` }, { value: 'outlook', label: 'Sports coming up' },
        { value: 'ladder', label: 'Upgrade ladder' }, { value: 'swaps', label: 'Swaps & packs' },
      ]} />

      {snap.loading && <Loading label="Loading the dataset…" />}
      {!snap.loading && snap.data && view === 'rank' && (
        <CardRankings rows={rows} overrides={overridesFlat} onOverride={onOverride} owned={ownedSet} onToggleOwned={toggleOwned} priceNote={(r) => `${levels.get(r.card.id)?.key ?? ''}: ${levels.get(r.card.id)?.est.basis ?? ''}`} />
      )}
      {!snap.loading && snap.data && view === 'portfolio' && <PortfolioPanel cards={cards} params={params} options={options} levels={levels} proWin={s.proWin} />}
      {!snap.loading && snap.data && view === 'mine' && <ProfilePanel s={s} set={set} cards={all ?? []} params={params} />}
      {!snap.loading && snap.data && view === 'outlook' && <OutlookPanel cards={cards} params={params} windowDaysN={days} />}
      {!snap.loading && snap.data && view === 'ladder' && <UpgradeLadder cards={cards} s={s} />}
      {view === 'swaps' && <SwapCalc />}
    </div>
  );
}
