import { useMemo, useState } from 'react';
import { capFor } from '../../../shared/otdRules';
import { ladderPriceTable } from '../../../shared/otdPricing';
import type { OtdCardRecord } from '../../../shared/otdSnapshot';
import { rax } from '../../lib/format';
import { priceParamsFor, type EffState } from './model';

/**
 * Per-card rung table: what each rarity costs (rating × rate), what it pays (min(cap, multiplier × General annual)),
 * and what each STEP up buys. Real has no upgrade fee — a card's level is the summed rating of the play cards you own for it.
 */
export default function UpgradeLadder({ cards, s }: { cards: OtdCardRecord[]; s: EffState }) {
  const sorted = useMemo(() => [...cards].sort((a, b) => b.annual - a.annual), [cards]);
  const [id, setId] = useState('');
  const [q, setQ] = useState('');
  const card = useMemo(() => sorted.find((c) => c.id === id) ?? sorted[0], [sorted, id]);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? sorted.filter((c) => c.name.toLowerCase().includes(t)).slice(0, 40) : sorted.slice(0, 40);
  }, [sorted, q]);

  const rows = useMemo(() => {
    if (!card) return [];
    const table = ladderPriceTable({ id: card.id, sport: card.sport, season: card.season, name: card.name, annual: card.annual, owners: card.owners }, priceParamsFor(s));
    let prev: { earn: number; price: number } | null = null;
    return table.filter((r) => r.key !== 'General').map((r) => {
      const cap = capFor(r.key);
      const earn = cap == null ? card.annual * r.multiplier : Math.min(cap, card.annual * r.multiplier);
      const step = prev ? { dEarn: earn - prev.earn, dPrice: r.price - prev.price } : null;
      prev = { earn, price: r.price };
      return { ...r, cap, earn, payback: earn > 0 ? r.price / earn : Infinity, step, capped: cap != null && card.annual * r.multiplier > cap };
    });
  }, [card, s]);

  const best = rows.reduce((b, r) => (r.payback < b.payback ? r : b), rows[0]);

  return (
    <div className="panel overflow-hidden">
      <div className="panel-hd flex-wrap">
        <h2>Upgrade ladder{card && <span className="ml-2 text-xs font-normal text-muted">{card.name} · {card.sport} · {card.seasonLabel} · {rax(card.annual)} General/yr</span>}</h2>
        <div className="flex items-center gap-2">
          <input className="field !w-40" placeholder="Search player…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search player" />
          <select className="field !w-56" value={card?.id ?? ''} onChange={(e) => setId(e.target.value)} aria-label="Card">
            {matches.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.sport} {c.seasonLabel} · {rax(c.annual)}</option>)}
          </select>
        </div>
      </div>
      <p className="hint border-b border-line px-3 py-2">
        Prices = 200 claim + total rating × {s.rate} Rax/rating — an <b>estimate</b> from Rateboard's standing offers, not observed sales. Fastest payback is highlighted; the last two columns show what each <i>step up</i> buys, which is where the sweet spots are (a capped rung beyond the cap point buys nothing).
      </p>
      <div className="max-h-[560px] overflow-auto">
        <table className="tbl">
          <thead className="sticky top-0 bg-surface"><tr><th>Rung</th><th className="r">Rating needed</th><th className="r">×</th><th className="r">Cap</th><th className="r">Price (est.)</th><th className="r">Pays / yr</th><th className="r">Payback</th><th className="r">Step: +price</th><th className="r">Step: +earn/yr</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={best && r.key === best.key ? 'bg-emerald/10' : ''}>
                <td className="font-medium">{r.key}{r.capped && <span className="chip-amber ml-1">capped</span>}</td>
                <td className="r num text-muted">{rax(r.totalRating)}</td>
                <td className="r num">{r.multiplier}</td>
                <td className="r num text-muted">{r.cap == null ? '∞' : rax(r.cap)}</td>
                <td className="r num" title={r.basis}>{rax(r.price)}</td>
                <td className="r num font-semibold text-emerald">{rax(r.earn)}</td>
                <td className="r num">{Number.isFinite(r.payback) ? `${(r.payback * 365).toFixed(0)}d` : '∞'}</td>
                <td className="r num text-muted">{r.step ? rax(r.step.dPrice) : '—'}</td>
                <td className={`r num ${r.step && r.step.dEarn <= 0 ? 'text-amber' : ''}`}>{r.step ? rax(r.step.dEarn) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
