import type { RealParse } from '../../../shared/oddsRaxEdge';
import type { RaxEdgeStored } from '../../lib/raxedgeStore';
import BridgeImport from '../raxedge/BridgeImport';
import { Explain } from '../ui/Explain';
import { ageTone, fmtAge } from './edgeLogic';
import type { EdgeState } from './useEdgeState';

/** Human names for the export's route keys, for the plan-limit notes. */
const ROUTE_NAME: Record<string, string> = {
  'fd/fc': 'FanDuel soccer',
  'fd/wc': 'FanDuel World Cup',
  'fd/ufc': 'FanDuel UFC',
  'dk/contender-series': 'DraftKings contender series',
  'real/live-probs': 'Real live probabilities',
  'real/sync/hockey_nhl': 'Real markets for NHL',
  'real/sync/football_ncaaf': 'Real markets for college football',
  'real/sync/mma_ufc': 'Real markets for UFC',
  'real/sync/soccer_fc': 'Real markets for soccer',
};
const routeName = (k: string) => ROUTE_NAME[k] ?? k.replace(/^real\/sync\//, 'Real markets for ').replace(/^fd\//, 'FanDuel ').replace(/^dk\//, 'DraftKings ');

const TONE: Record<'ok' | 'amber' | 'red', string> = { ok: 'text-emerald', amber: 'text-amber', red: 'text-danger' };

function Switch({ checked, disabled, onChange, label, hint }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? 'cursor-not-allowed text-muted opacity-70' : 'cursor-pointer text-head'}`}>
      <input type="checkbox" className="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span>
        {label}
        <span className="hint block">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Two opt-in switches (both OFF by default) that use the user's own RaxEdge export, plus the export's age (amber after 15 min, red
 * after 60), what their RaxEdge plan could not provide, and the importer (collapsed). Nothing here changes a number until a switch is on.
 */
export default function RaxEdgePanel({ s, set, stored, now, real }: { s: EdgeState; set: (p: Partial<EdgeState>) => void; stored: RaxEdgeStored['odds']; now: number; real: RealParse | null }) {
  const has = !!stored?.data;
  const age = has ? now - Date.parse(stored!.at) : NaN;
  const known = Number.isFinite(age);
  const tone = known ? ageTone(age) : 'amber';
  const errors = Object.entries(stored?.data?.errors ?? {});
  const free = (stored?.plan ?? '').toLowerCase() === 'free';
  const nFd = has ? Object.keys(stored!.data.fd ?? {}).length : 0;
  const nDk = has ? Object.keys(stored!.data.dk ?? {}).length : 0;

  return (
    <>
      <div className="panel">
        <div className="panel-hd">
          <h2>Optional: use my RaxEdge export</h2>
          <span className="chip-blue">off by default</span>
        </div>
        <div className="panel-bd space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <Switch
              checked={has && s.raxLines}
              disabled={!has}
              onChange={(v) => set({ raxLines: v })}
              label="Include FanDuel & DraftKings lines from my RaxEdge export"
              hint={has ? 'Adds FanDuel and DraftKings columns and lets them join the consensus (de-vigged like a sportsbook). DraftKings is the same book as the ESPN column, so it only counts where ESPN has no DraftKings line.' : 'Import your RaxEdge export below to enable this.'}
            />
            <Switch
              checked={has && s.raxAutoReal}
              disabled={!has}
              onChange={(v) => set({ raxAutoReal: v })}
              label="Auto-fill Real % from my RaxEdge export (only where I haven’t typed one)"
              hint={has ? 'Fills the Real % of games in play (and pre-game markets once Real’s pool opens) from Real’s own numbers. Marked “from RaxEdge”; anything you type wins. Check the % in Real before you bet.' : 'Import your RaxEdge export below to enable this.'}
            />
          </div>

          {has && (
            <div className="space-y-1 text-xs">
              <p>
                <span className="text-muted">Export taken: </span>
                <b className={TONE[tone]}>{known ? fmtAge(age) : 'time unknown'}</b>
                <span className="text-muted"> · {nFd} FanDuel and {nDk} DraftKings feeds{stored!.plan ? ` · RaxEdge plan: ${stored!.plan}` : ''}</span>
                {tone !== 'ok' && <span className={TONE[tone]}> — odds go stale in minutes; re-run the export to refresh.</span>}
              </p>
              {errors.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted">
                  {errors.map(([k, v]) => (
                    <li key={k}>
                      <b className="text-head">{routeName(k)}</b>: {v}
                      {/pro/i.test(v) ? ` — needs a RaxEdge Pro plan${free ? ' (your export is from a free account)' : ''}; skipped.` : ' — skipped.'}
                    </li>
                  ))}
                </ul>
              )}
              {real && (
                <p className="text-muted">
                  Real % in this export: <b className="text-head">{real.suggestions.length}</b> usable game{real.suggestions.length === 1 ? '' : 's'}
                  {real.pending > 0 && <>, {real.pending} pre-game market{real.pending === 1 ? '' : 's'} still empty (Real’s pool has not opened)</>}
                  {real.closed > 0 && <>, {real.closed} locked/settled skipped</>}. Real’s numbers exist only for games in play or open pools — most games will have nothing to auto-fill.
                </p>
              )}
              {real && real.warnings.length > 0 && (
                <details className="text-amber/90">
                  <summary className="cursor-pointer">{real.warnings.length} thing{real.warnings.length === 1 ? '' : 's'} in the export could not be read</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">
                    {real.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
      <Explain title={has ? 'Re-import or refresh from RaxEdge' : 'Import FanDuel / DraftKings / Real % from RaxEdge (needs your own RaxEdge login)'}>
        <BridgeImport sections={['odds']} title="Import FanDuel / DraftKings / Real % from RaxEdge" />
      </Explain>
    </>
  );
}
