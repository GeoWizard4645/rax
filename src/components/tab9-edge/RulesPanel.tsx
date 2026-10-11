import { useState, type ReactNode } from 'react';
import { DEFAULT_REAL_RULES, REAL_PREDICTION_FACTS as F, rakeFromQuote, type RealRules } from '../../../shared/realPayout';
import { Explain } from '../ui/Explain';
import { Segmented } from '../ui/Segmented';
import { ConfBadge, NumInput } from './fields';

const pctParse = (t: string) => {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  return /^\d+(\.\d+)?$/.test(s) && Number(s) <= 100 ? Number(s) : ('invalid' as const);
};

function Rule({ title, badge, children, note }: { title: string; badge: ReactNode; children?: ReactNode; note: string }) {
  return (
    <div className="rounded-md border border-line p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-head">{title}</span>
        {badge}
      </div>
      {children && <div className="mt-2">{children}</div>}
      <p className="hint mt-1.5">{note}</p>
    </div>
  );
}

/** Editable RealRules with each default’s confidence badge (shared/realPayout.ts REAL_PREDICTION_FACTS) + a rake calibrator. */
export default function RulesPanel({ rules, set }: { rules: RealRules; set: (r: RealRules) => void }) {
  const upd = (p: Partial<RealRules>) => set({ ...rules, ...p });
  const [q, setQ] = useState<{ pct: number | null; stake: number | null; payout: number | null }>({ pct: null, stake: null, payout: null });
  const implied = q.pct && q.stake && q.payout ? rakeFromQuote(q.pct, q.stake, q.payout, rules.rakeBasis) : null;
  const changed = JSON.stringify(rules) !== JSON.stringify(DEFAULT_REAL_RULES);

  return (
    <Explain title={`Real payout rules — editable assumptions (rake ${(rules.rake * 100).toFixed(1)}%, ${rules.rakeBasis} basis${changed ? ', edited' : ', placeholder defaults'})`}>
      <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-relaxed text-amber/90">
        <b>Real does not publish its prediction-market fees.</b> Every “unknown” value below is a labelled placeholder, not a finding — EV is only as good as these assumptions and the Real % you type. The 2-minute in-app check in <code>docs/REAL-PREDICTIONS.md</code> measures the rake from numbers Real shows before you confirm a stake.
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        <Rule
          title="Rake / fee"
          badge={<ConfBadge c={F.rake.confidence} />}
          note={`Placeholder ${DEFAULT_REAL_RULES.rake * 100}%. RaxEdge’s formula has a rake term but never states the value; Arena Rax pots take 10% (a different product). If the true rake is 0, EV is understated by ~5 points; at 10% it is overstated by ~5.`}
        >
          <NumInput label="Rake in percent" value={+(rules.rake * 100).toFixed(2)} parse={pctParse} onCommit={(v) => upd({ rake: Math.min(0.5, Math.max(0, (v ?? 0) / 100)) })} suffix="%" className="w-28" />
        </Rule>

        <Rule
          title="Rake basis"
          badge={<ConfBadge c={F.rakeBasis.confidence} />}
          note="‘Payout’ (RaxEdge’s form): multiple = (1 ÷ Real %) × (1 − rake). ‘Profit’: only the winnings are charged, multiple = 1 + (1 ÷ Real % − 1) × (1 − rake)."
        >
          <Segmented<RealRules['rakeBasis']> label="Rake basis" value={rules.rakeBasis} onChange={(v) => upd({ rakeBasis: v })} options={[{ value: 'payout', label: 'On payout' }, { value: 'profit', label: 'On profit' }]} />
        </Rule>

        <Rule
          title="Does your stake move the price?"
          badge={<ConfBadge c={F.priceImpact.confidence} />}
          note="‘Fixed’: you buy at the displayed % whatever the size. ‘Pool’: your stake joins your side’s pool, so the price drifts against you — needs the pool size (Rax). An ‘automated market’ suggests impact exists; the size is unknown."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Segmented<RealRules['model']> label="Price model" value={rules.model} onChange={(v) => upd({ model: v })} options={[{ value: 'fixed', label: 'Fixed price' }, { value: 'pool', label: 'Pool impact' }]} />
            {rules.model === 'pool' && <NumInput label="Pool size in Rax" value={rules.poolRax} onCommit={(v) => upd({ poolRax: v && v > 0 ? v : null })} placeholder="pool Rax" suffix="Rax" className="w-32" />}
          </div>
        </Rule>

        <Rule title="Minimum stake" badge={<ConfBadge c={F.minStake.confidence} />} note="Real’s minimum bet is not documented. If set, a Kelly stake below it shows ‘skip’. The maximum stake you set under Settings is your own cap.">
          <NumInput label="Minimum stake in Rax" value={rules.minStake} onCommit={(v) => upd({ minStake: v && v > 0 ? v : null })} placeholder="none" suffix="Rax" className="w-32" />
        </Rule>
      </div>

      <div className="rounded-md border border-line p-2.5">
        <div className="mb-1 text-sm font-medium text-head">Measure the rake yourself (no Rax at risk)</div>
        <p className="hint">In Real, open a game’s prediction sheet, type a small stake <i>without confirming</i>, and read the potential payout (total returned, not profit). Enter it here.</p>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-xs text-muted">Real % shown<NumInput label="Real percent shown" value={q.pct} onCommit={(v) => setQ({ ...q, pct: v })} suffix="%" className="mt-1 block w-28" /></label>
          <label className="text-xs text-muted">Stake<NumInput label="Quote stake" value={q.stake} onCommit={(v) => setQ({ ...q, stake: v })} suffix="Rax" className="mt-1 block w-28" /></label>
          <label className="text-xs text-muted">Payout shown<NumInput label="Quoted payout" value={q.payout} onCommit={(v) => setQ({ ...q, payout: v })} suffix="Rax" className="mt-1 block w-28" /></label>
          <div className="num text-sm">
            {implied == null || !Number.isFinite(implied) ? <span className="text-muted">→ implied rake</span> : <>→ implied rake <b className={implied < -0.005 ? 'text-amber' : 'text-head'}>{(implied * 100).toFixed(1)}%</b></>}
          </div>
          <button className="btn-ghost btn-sm" disabled={implied == null || !Number.isFinite(implied) || implied < 0 || implied > 0.5} onClick={() => upd({ rake: Math.round((implied as number) * 1000) / 1000 })}>Use this rake</button>
        </div>
        {implied != null && implied < -0.005 && <p className="hint mt-1 text-amber">Negative: the quote pays more than stake ÷ % — Real’s price probably includes something else (check the % basis).</p>}
      </div>

      <div className="grid gap-x-4 gap-y-1 text-xs md:grid-cols-2">
        {([
          ['Pro-only, Rax-denominated', F.availability.confidence],
          ['Percentage = community’s implied likelihood; lower % pays more', F.displayedPercentMeaning.confidence],
          ['Automated market, peer-to-peer, with cashout', F.structure.confidence],
          ['Payout ≈ stake ÷ displayed % (a share priced at p pays 1)', F.payoutFormula.confidence],
          ['EV = (fair ÷ Real %) × (1 − rake) − 1 (RaxEdge)', F.evFormulaUsedByRaxEdge.confidence],
          ['Spread markets on Real', 'unknown' as const],
          ['Cashout fee; tie / postponement handling', 'unknown' as const],
        ] as const).map(([t, c]) => (
          <div key={t} className="flex items-start justify-between gap-2">
            <span>{t}</span>
            <ConfBadge c={c} />
          </div>
        ))}
      </div>
      <div>
        <button className="btn-ghost btn-sm" disabled={!changed} onClick={() => set({ ...DEFAULT_REAL_RULES, maxStake: rules.maxStake })}>Reset rules to placeholders</button>
      </div>
    </Explain>
  );
}
