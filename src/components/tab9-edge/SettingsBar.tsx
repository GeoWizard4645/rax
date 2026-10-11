import { Segmented } from '../ui/Segmented';
import { NumInput } from './fields';
import type { EdgeState } from './useEdgeState';

const FRACTIONS: Array<{ value: string; label: string }> = [
  { value: '0.125', label: '⅛' },
  { value: '0.25', label: '¼' },
  { value: '0.5', label: '½' },
  { value: '1', label: 'Full' },
];

/** Bankroll, Kelly fraction, max-stake cap and de-vig method — the user-side knobs (Real’s own rules live in RulesPanel). */
export default function SettingsBar({ s, set }: { s: EdgeState; set: (p: Partial<EdgeState>) => void }) {
  return (
    <div className="panel">
      <div className="panel-bd grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="label">Bankroll (Rax)</span>
          <NumInput label="Bankroll in Rax" value={s.bankroll} onCommit={(v) => set({ bankroll: v ?? 0 })} placeholder="1000" suffix="Rax" />
          <p className="hint mt-1">What Kelly sizes against. Use only Rax you can afford to lose.</p>
        </div>
        <div>
          <span className="label">Kelly fraction</span>
          <Segmented label="Kelly fraction" value={String(s.fraction)} onChange={(v) => set({ fraction: Number(v) })} options={FRACTIONS} />
          <p className="hint mt-1">¼ Kelly is the default: fair odds from thin markets are noisy, and full Kelly swings hard.</p>
        </div>
        <div>
          <span className="label">Max stake cap (Rax)</span>
          <NumInput
            label="Maximum stake in Rax"
            value={s.rules.maxStake}
            onCommit={(v) => set({ rules: { ...s.rules, maxStake: v && v > 0 ? v : null } })}
            placeholder="no cap"
            suffix="Rax"
          />
          <p className="hint mt-1">Your own ceiling per bet. Real’s real limit is not published.</p>
        </div>
        <div>
          <span className="label">De-vig method (DraftKings)</span>
          <Segmented
            label="De-vig method"
            value={s.devig}
            onChange={(v) => set({ devig: v })}
            options={[
              { value: 'proportional', label: 'Proportional' },
              { value: 'power', label: 'Power' },
            ]}
          />
          <p className="hint mt-1">Power gives favourites slightly more than proportional. Exchanges have no vig and are only re-normalised.</p>
        </div>
      </div>
    </div>
  );
}
