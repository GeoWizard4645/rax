import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { CardRow } from '../../../shared/otdEfficiency';
import { OTD_SPORTS, type OtdSport } from '../../../shared/otdSnapshot';
import { rax } from '../../lib/format';
import { Empty } from '../ui/StateBlock';

type SortKey = 'roi' | 'window' | 'annual' | 'payback' | 'price' | 'games';

const SORTS: Array<{ key: SortKey; label: string; hint: string }> = [
  { key: 'roi', label: 'Efficiency (window earn ÷ cost)', hint: 'Window earnings per Rax of net cost — the headline efficiency metric.' },
  { key: 'window', label: 'Window earnings', hint: 'Raw payout inside the selected timeframe, ignoring price.' },
  { key: 'annual', label: 'Annual earnings', hint: 'A full year of anniversaries.' },
  { key: 'payback', label: 'Payback (days)', hint: 'Price ÷ (annual earnings ÷ 365).' },
  { key: 'price', label: 'Price (cheapest)', hint: 'Estimated or overridden price.' },
  { key: 'games', label: 'Games in window', hint: 'How many anniversaries fall inside the timeframe.' },
];

const key: Record<SortKey, (r: CardRow) => number> = {
  roi: (r) => -(Number.isFinite(r.roi) ? r.roi : 1e12),
  window: (r) => -r.windowEarn,
  annual: (r) => -r.annualEarn,
  payback: (r) => (Number.isFinite(r.paybackDays) ? r.paybackDays : 1e12),
  price: (r) => r.price,
  games: (r) => -r.windowGames,
};

/** Top-N cards table: sortable, filterable, with per-card price overrides. */
export default function CardRankings({
  rows,
  overrides,
  onOverride,
  priceNote,
  packPriced,
  owned,
  onToggleOwned,
  limit = 500,
}: {
  rows: CardRow[];
  overrides: Record<string, number>;
  onOverride: (id: string, price: number | null) => void;
  priceNote: (r: CardRow) => string;
  /** True for cards whose price used a per-player rate from RaxEdge pack odds (shows a chip). */
  packPriced?: (id: string) => boolean;
  owned: ReadonlySet<string>;
  onToggleOwned: (id: string) => void;
  limit?: number;
}) {
  const [sort, setSort] = useState<SortKey>('roi');
  const [sport, setSport] = useState<OtdSport | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [minGames, setMinGames] = useState(0);
  const [shown, setShown] = useState(50);

  const sorted = useMemo(() => {
    const s = q.trim().toLowerCase();
    const r = rows.filter((x) => (sport === 'ALL' || x.card.sport === sport) && x.windowGames >= minGames && x.windowEarn > 0 && (!s || x.card.name.toLowerCase().includes(s)));
    return r.sort((a, b) => key[sort](a) - key[sort](b)).slice(0, limit);
  }, [rows, sort, sport, q, minGames, limit]);

  const present = useMemo(() => OTD_SPORTS.filter((s) => rows.some((r) => r.card.sport === s)), [rows]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>Top {Math.min(limit, sorted.length).toLocaleString()} cards <span className="num text-xs font-normal text-muted">of {rows.length.toLocaleString()} scored</span></h2>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input className="field !w-40 !pl-7" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search player" />
          </label>
          <select className="field !w-auto" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort by" title={SORTS.find((s) => s.key === sort)?.hint}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-muted">min games
            <input type="number" min={0} className="field num !w-16 !py-1" value={minGames} onChange={(e) => setMinGames(Math.max(0, +e.target.value || 0))} />
          </label>
        </div>
      </div>
      <p className="hint border-b border-line px-3 py-2">Each card is scored <b>on its own</b>. Cards of the same sport that pay on the same days compete for your 2 daily claims, so don't buy the top-N from this list — use <b>Best combination</b>, which removes overlaps.</p>
      <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2" role="tablist" aria-label="Sport">
        {(['ALL', ...present] as const).map((s) => (
          <button key={s} role="tab" aria-selected={sport === s} onClick={() => setSport(s)} className={`rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors ${sport === s ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:bg-hover hover:text-head'}`}>{s === 'ALL' ? 'All sports' : s}</button>
        ))}
      </div>
      {sorted.length === 0 ? <Empty title="No cards match" /> : (
        <div className="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr>
                <th className="r">#</th><th title="Tick the cards you already own: they cost 0 and count first in the portfolio">Own</th><th>Card</th>
                <th className="r" title="Σ General-level rax across the card's season (Real's “Earnings at General”)">General annual</th>
                <th className="r" title="Games whose anniversary falls inside the timeframe">Games</th>
                <th className="r">Window earn</th><th className="r">Annual earn</th>
                <th className="r">Price (Rax)</th><th className="r" title="Price ÷ (annual earn ÷ 365)">Payback</th><th className="r" title="Window earnings ÷ net cost">Efficiency</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, shown).map((r, i) => {
                const ov = overrides[r.card.id];
                return (
                  <tr key={r.card.id}>
                    <td className="r num text-muted">{i + 1}</td>
                    <td><input type="checkbox" checked={owned.has(r.card.id)} onChange={() => onToggleOwned(r.card.id)} aria-label={`I own ${r.card.name} ${r.card.seasonLabel}`} /></td>
                    <td>
                      <span className="font-medium">{r.card.name}</span> <span className="chip-muted">{r.card.sport}</span> <span className="num text-xs text-muted">{r.card.seasonLabel}</span>
                      {r.capped && <span className="chip-amber ml-1" title="Hits the rarity's annual cap; payouts are scaled down to it">capped</span>}
                    </td>
                    <td className="r num text-muted">{rax(r.card.annual)}</td>
                    <td className="r num text-muted">{r.windowGames}</td>
                    <td className="r num font-semibold text-emerald">{rax(r.windowEarn)}</td>
                    <td className="r num">{rax(r.annualEarn)}</td>
                    <td className="r">
                      {packPriced?.(r.card.id) && ov == null && <span className="chip-blue mr-1" title={`Priced with this player's own rate from RaxEdge pack odds. ${priceNote(r)}`}>pack</span>}
                      <input
                        className={`field num !w-24 !py-0.5 text-right ${ov != null ? 'border-action' : ''}`}
                        inputMode="numeric"
                        value={ov != null ? ov : Math.round(r.price)}
                        title={ov != null ? 'Your price override (clear to go back to the estimate)' : priceNote(r)}
                        onChange={(e) => { const v = Math.round(+e.target.value.replace(/[^\d.]/g, '')); onOverride(r.card.id, v > 0 ? v : null); }}
                        aria-label={`Price for ${r.card.name} ${r.card.seasonLabel}`}
                      />
                    </td>
                    <td className={`r num ${!Number.isFinite(r.paybackDays) ? 'text-muted' : r.paybackDays <= 365 ? 'text-emerald' : r.paybackDays <= 730 ? '' : 'text-amber'}`}>{Number.isFinite(r.paybackDays) ? `${rax(r.paybackDays)}d` : '∞'}</td>
                    <td className="r num font-semibold">{Number.isFinite(r.roi) ? `${(r.roi * 100).toFixed(r.roi < 0.1 ? 1 : 0)}%` : '∞'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown < sorted.length && <div className="p-3 text-center"><button className="btn-ghost btn-sm" onClick={() => setShown(shown + 100)}>Show more ({sorted.length - shown} left)</button></div>}
        </div>
      )}
    </div>
  );
}
