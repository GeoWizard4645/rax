import { DISCOUNT_MAX, DISCOUNT_MIN } from '../../../shared/formulas';

const PRESETS = [-10, 0, 10, 20, 30, 50];

/** +30% above the bid … 70% off. Negative values = asking above their bid. */
export default function DiscountSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const label = value === 0 ? 'At their bid' : value < 0 ? `${Math.abs(value)}% above their bid` : `${value}% off their bid`;
  return (
    <div className="panel p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor="discount" className="label !mb-0">
          Offer vs. their highest bid
        </label>
        <span className={`num text-sm font-semibold ${value < 0 ? 'text-amber' : value > 0 ? 'text-emerald' : 'text-head'}`}>{label}</span>
      </div>
      <input id="discount" type="range" min={DISCOUNT_MIN} max={DISCOUNT_MAX} step={1} value={value} onChange={(e) => onChange(+e.target.value)} className="w-full accent-[#3B82F6]" aria-valuetext={label} />
      <div className="num mt-0.5 flex justify-between text-[10px] text-muted">
        <span>+{-DISCOUNT_MIN}% above</span>
        <span>0%</span>
        <span>−{DISCOUNT_MAX}% off</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p} className={`chip-muted hover:bg-hover ${value === p ? '!border-action !text-head' : ''}`} onClick={() => onChange(p)}>
            {p === 0 ? '0%' : p < 0 ? `+${-p}%` : `−${p}%`}
          </button>
        ))}
      </div>
      <p className="hint mt-2">
        Target price = highest bid × (1 − discount). Default 0% asks exactly what they bid.
      </p>
    </div>
  );
}
