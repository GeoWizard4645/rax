import { useMemo, useState } from 'react';
import { RARITIES, SPORTS, fmtRax } from '../../../shared/formulas';
import { breakEvenDays, cardRoi, type SportMult } from '../../../shared/otd';
import type { HistoricalGame, Rarity, Sport } from '../../types/real';
import { load, save } from '../../lib/storage';
import { rax } from '../../lib/format';
import { Empty } from '../ui/StateBlock';
import { SportTabs } from '../ui/SportSelect';

const PRICE_KEY = 'rax_otd_prices_v1';
type SortK = 'remaining' | 'annual' | 'days' | 'max';

/**
 * Market ROI screener ("Who to buy"): remaining anniversary yield for every retired card, and days to break
 * even once you enter a market price. Prices aren't available from any feed, so you supply them per card.
 */
export default function BreakEvenCalc({ games, md, sportMult }: { games: HistoricalGame[]; md: string; sportMult: SportMult }) {
  const [rarity, setRarity] = useState<Rarity>('Epic');
  const [sport, setSport] = useState<Sport | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortK>('remaining');
  const [prices, setPrices] = useState<Record<string, number>>(() => load(PRICE_KEY, {}));
  const [shown, setShown] = useState(60);

  const all = useMemo(() => cardRoi(games, rarity, md, sportMult), [games, rarity, md, sportMult]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = all.filter((c) => (sport === 'ALL' || c.sport === sport) && (!s || c.playerName.toLowerCase().includes(s)));
    const days = (c: (typeof all)[number]) => (prices[c.id] > 0 ? breakEvenDays(prices[c.id], c.annualYield) : Infinity);
    const key: Record<SortK, (c: (typeof all)[number]) => number> = { remaining: (c) => -c.remainingYield, annual: (c) => -c.annualYield, max: (c) => -c.maxGame, days };
    return r.sort((a, b) => key[sort](a) - key[sort](b));
  }, [all, sport, q, sort, prices]);

  const setPrice = (id: string, v: string) => {
    const next = { ...prices };
    const n = +v;
    if (n > 0) next[id] = n;
    else delete next[id];
    setPrices(next);
    save(PRICE_KEY, next);
  };

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>Who to buy — ROI screener <span className="num text-xs font-normal text-muted">({rows.length.toLocaleString()} cards)</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted">If bought as
            <select className="field !w-auto" value={rarity} onChange={(e) => setRarity(e.target.value as Rarity)}>{RARITIES.map((r) => <option key={r}>{r}</option>)}</select>
          </label>
          <select className="field !w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortK)} aria-label="Sort by">
            <option value="remaining">Sort: remaining yield</option>
            <option value="annual">Sort: annual yield</option>
            <option value="max">Sort: best single game</option>
            <option value="days">Sort: days to break even</option>
          </select>
          <input className="field !w-40" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search player" />
        </div>
      </div>
      <div className="border-b border-line px-3 py-2"><SportTabs sports={SPORTS} value={sport} onChange={setSport} allLabel="All" /></div>
      {rows.length === 0 ? <Empty title="No cards match" /> : (
        <div className="max-h-[560px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 bg-surface">
              <tr><th>Card</th><th className="r">Games</th><th className="r">Left this year</th><th className="r" title="Σ upcoming anniversary yields × rarity multiplier">Expected remaining</th><th className="r" title="A full year of anniversaries">Annual yield</th><th className="r">Best game</th><th className="r">Market price (Rax)</th><th className="r" title="price ÷ (annual ÷ 365)">Days to break even</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((c) => {
                const price = prices[c.id];
                const days = price > 0 ? breakEvenDays(price, c.annualYield) : null;
                return (
                  <tr key={c.id}>
                    <td><span className="font-medium">{c.playerName}</span> <span className="chip-muted">{c.sport}</span> <span className="num text-xs text-muted">{c.season}</span></td>
                    <td className="r num">{c.games}</td>
                    <td className="r num text-muted">{c.remainingGames}</td>
                    <td className="r num font-semibold text-emerald">{rax(c.remainingYield)}</td>
                    <td className="r num">{rax(c.annualYield)}</td>
                    <td className="r num text-muted">{rax(c.maxGame)}</td>
                    <td className="r"><input className="field num !w-24 !py-0.5 text-right" inputMode="numeric" value={price ?? ''} placeholder="enter" onChange={(e) => setPrice(c.id, e.target.value)} aria-label={`Market price for ${c.playerName} ${c.season}`} /></td>
                    <td className={`r num ${days == null ? 'text-muted' : days <= 365 ? 'text-emerald' : days <= 730 ? '' : 'text-amber'}`}>{days == null ? '—' : Number.isFinite(days) ? `${fmtRax(days)}d` : '∞'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown && <div className="border-t border-line p-2 text-center"><button className="btn-ghost btn-sm" onClick={() => setShown(shown + 60)}>Show more</button></div>}
      <div className="border-t border-line px-3 py-2 text-[11px] text-muted">
        Expected remaining = Σ yields of anniversaries after {md} this calendar year × rarity multiplier. Days to break even = price ÷ (annual yield ÷ 365). There is no market-price feed, so enter prices yourself (saved in this browser). The daily 2-claim cap isn't applied here, so heavily-stacked days can pay less than shown.
      </div>
    </div>
  );
}
