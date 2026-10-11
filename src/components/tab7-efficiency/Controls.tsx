import { RARITY_LADDER, multiplierFor } from '../../../shared/otdRules';
import { OTD_SPORTS, type OtdSport } from '../../../shared/otdSnapshot';
import { DEFAULT_PRICE_PARAMS } from '../../../shared/otdPricing';
import { DEFAULT_STATE, RUNG_KEYS, windowDays, type EffState, type WindowPreset } from './model';

const PRESETS: Array<{ v: WindowPreset; l: string }> = [
  { v: '7', l: '1 week' }, { v: '30', l: '1 month' }, { v: '90', l: '3 months' }, { v: '180', l: '6 months' }, { v: '365', l: '1 year' }, { v: 'custom', l: 'Custom' },
];

const num = (v: string, min = 0) => Math.max(min, +v.replace(/[^\d.]/g, '') || 0);

export default function Controls({ s, set, available }: { s: EffState; set: (p: Partial<EffState>) => void; available: OtdSport[] }) {
  const sportsOn = s.sports.length ? s.sports : available;
  const toggle = (sp: OtdSport) => {
    const next = sportsOn.includes(sp) ? sportsOn.filter((x) => x !== sp) : [...sportsOn, sp];
    set({ sports: next.length === available.length ? [] : next });
  };
  const fixedMult = s.rarity !== 'AUTO' ? multiplierFor(s.rarity) : null;
  return (
    <div className="panel">
      <div className="panel-hd"><h2>Parameters</h2><button className="btn-ghost btn-sm" onClick={() => set({ ...DEFAULT_STATE, method: s.method })}>Reset</button></div>
      <div className="panel-bd grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <span className="label">Timeframe</span>
          <div className="seg flex-wrap" role="group" aria-label="Timeframe">
            {PRESETS.map((p) => <button key={p.v} aria-pressed={s.preset === p.v} onClick={() => set({ preset: p.v })}>{p.l}</button>)}
          </div>
          {s.preset === 'custom' && (
            <label className="flex items-center gap-2 text-xs text-muted">days
              <input className="field num !w-20" type="number" min={1} max={365} value={s.customDays} onChange={(e) => set({ customDays: Math.min(365, num(e.target.value, 1)) })} />
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-muted">starting
            <input className="field num !w-auto" type="date" value={s.start} onChange={(e) => set({ start: e.target.value })} />
            <button className="btn-ghost btn-sm" onClick={() => set({ start: '' })}>today</button>
          </label>
          <p className="hint">{windowDays(s)} days. Shorter windows only count anniversaries that fall inside them, so sports that are in-season later score lower now.</p>
        </div>

        <div className="space-y-2">
          <span className="label">Rarity to hold</span>
          <select className="field" value={s.rarity} onChange={(e) => set({ rarity: e.target.value })} aria-label="Rarity">
            <option value="AUTO">Auto — fastest payback per card</option>
            {RUNG_KEYS.map((k) => <option key={k} value={k}>{k}{k === 'Iconic' ? ' 1' : ''} · {multiplierFor(k)}×</option>)}
          </select>
          {s.rarity === 'AUTO' ? (
            <label className="flex items-center gap-2 text-xs text-muted">but at least
              <select className="field !w-auto" value={s.autoMin} onChange={(e) => set({ autoMin: e.target.value })}>
                {RARITY_LADDER.filter((r) => r.otdEligible).map((r) => <option key={r.key}>{r.key}</option>)}
              </select>
            </label>
          ) : (
            <label className="flex items-center gap-2 text-xs text-muted">multiplier
              <input className="field num !w-20" type="number" min={0} step="1" value={s.multOverride || fixedMult || ''} onChange={(e) => set({ multOverride: num(e.target.value) === fixedMult ? 0 : num(e.target.value) })} />
              <span>(Real: {fixedMult ?? '?'}×)</span>
            </label>
          )}
          <p className="hint">Below Iconic every card is capped (≈ 500 General rax × multiplier). Iconic is uncapped.</p>
        </div>

        <div className="space-y-2">
          <span className="label">Cost &amp; budget</span>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">Budget (Rax)
            <input className="field num !w-28" inputMode="numeric" value={s.budget} onChange={(e) => set({ budget: num(e.target.value) })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">Max cards
            <input className="field num !w-28" type="number" min={1} max={60} value={s.maxCards} onChange={(e) => set({ maxCards: Math.min(60, num(e.target.value, 1)) })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted" title="Price of one rating point of play cards. Default = Rateboard's median standing offer.">Rax per rating
            <input className="field num !w-28" type="number" min={1} step="0.5" value={s.rate} onChange={(e) => set({ rate: num(e.target.value, 1) })} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted" title="The combination picker won't add a card that earns less than this share of its cost inside the timeframe.">Min. return per card %
            <input className="field num !w-20" type="number" min={0} value={Math.round(s.minRoi * 100)} onChange={(e) => set({ minRoi: num(e.target.value) / 100 })} />
          </label>
          <p className="hint">Default {DEFAULT_PRICE_PARAMS.ratePerRating.mid.value} = Rateboard's median offer (8 floor, ~30 for stars). Overwrite any card's price in the table.</p>
        </div>

        <div className="space-y-2">
          <span className="label">Holding &amp; claims</span>
          <div className="seg" role="group" aria-label="Hold mode">
            <button aria-pressed={s.hold === 'keep'} onClick={() => set({ hold: 'keep' })}>Keep the cards</button>
            <button aria-pressed={s.hold === 'flip'} onClick={() => set({ hold: 'flip' })}>Sell at end</button>
          </div>
          {s.hold === 'flip' && (
            <label className="flex items-center justify-between gap-2 text-xs text-muted">Lost on resale %
              <input className="field num !w-20" type="number" min={0} max={100} value={Math.round(s.flipLoss * 100)} onChange={(e) => set({ flipLoss: Math.min(100, num(e.target.value)) / 100 })} />
            </label>
          )}
          <label className="flex items-center justify-between gap-2 text-xs text-muted" title="Pro adds 1 bonus claim per day across all sports, but only if you win the poll you place it on.">Pro bonus win %
            <input className="field num !w-20" type="number" min={0} max={100} value={Math.round(s.proWin * 100)} onChange={(e) => set({ proWin: Math.min(100, num(e.target.value)) / 100 })} />
          </label>
          <p className="hint">2 guaranteed claims per sport per day (documented). Pro's extra claim is a poll-win bet — 0% to ignore it.</p>
          <span className="label pt-1">Best-combination priority</span>
          <div className="seg" role="group" aria-label="Overlap priority">
            <button aria-pressed={s.overlapMode === 'earnings'} onClick={() => set({ overlapMode: 'earnings' })} title="Maximise total claimable payout. Overlap only matters through the claims it costs you.">Max earnings</button>
            <button aria-pressed={s.overlapMode === 'min-overlap'} onClick={() => set({ overlapMode: 'min-overlap' })} title="Payout your claim slots can't take counts against the set, so it spreads cards across different days.">Minimize overlap</button>
          </div>
          <p className="hint">{s.overlapMode === 'earnings' ? 'Picks the set that claims the most Rax, even if some cards share days.' : 'Counts payout that overlaps (and so can\'t be claimed) as a loss — spreads your cards over different days, trading a little total for far less waste.'}</p>
        </div>

        <div className="md:col-span-2 xl:col-span-4">
          <span className="label">Sports</span>
          <div className="flex flex-wrap gap-1">
            {OTD_SPORTS.filter((x) => available.includes(x)).map((sp) => (
              <button key={sp} aria-pressed={sportsOn.includes(sp)} onClick={() => toggle(sp)} className={`rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors ${sportsOn.includes(sp) ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:bg-hover hover:text-head'}`}>{sp}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
