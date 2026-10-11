import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { ODDS_SOURCE_LABEL, type OddsEvent } from '../../../shared/odds';
import type { Consensus } from '../../../shared/oddsConsensus';
import { Segmented } from '../ui/Segmented';
import { NumInput } from './fields';
import {
  evalMarket,
  evalSide,
  fmtAge,
  fmtNum,
  fmtP,
  fmtSigned,
  fmtVol,
  hasDraw,
  parsePct,
  sensRows,
  sideFairs,
  sourceSideFair,
  withAuto,
  type AutoReal,
  type Cfg,
  type Found,
  type SideIdx,
} from './edgeLogic';

export interface EditorValue {
  p: [number | null, number | null];
  d: number | null;
  dnb: boolean;
}

const evTone = (x: number) => (x > 0 ? 'text-emerald' : 'text-danger');

/**
 * Inline editor under a market row: type Real’s % for each side → EV, edge, break-even, Kelly stake, a sensitivity table and the
 * per-source breakdown.
 */
export default function MarketEditor({ event, c, found, auto = null, now = Date.now(), cfg, onChange }: { event: OddsEvent; c: Consensus; found: Found | null; auto?: AutoReal | null; now?: number; cfg: Cfg; onChange: (v: EditorValue) => void }) {
  const three = hasDraw(c);
  const [dnb, setDnb] = useState(found?.dnb ?? false);
  // `val` is only what the user TYPED — it is what gets saved. RaxEdge's numbers (`eff`) are used for display and EV, and are never written back.
  const val: EditorValue = { p: found?.p ?? [null, null], d: dnb ? null : found?.d ?? null, dnb };
  const eff = withAuto({ p: val.p, d: val.d, dnb }, auto, three);
  const { rows, best } = evalMarket(c, eff ?? { p: val.p, d: val.d, dnb }, cfg);
  const typedOf = (idx: SideIdx): number | null => (idx === 2 ? val.d : val.p[idx]);
  const autoOf = (idx: SideIdx): boolean => !!eff && (idx === 2 ? eff.autoD : eff.auto[idx]);
  const [sideSel, setSideSel] = useState<SideIdx | null>(null);
  const selRow = rows.find((r) => r.idx === sideSel && r.ev) ?? best ?? null;

  const setSide = (idx: SideIdx, v: number | null) => {
    const next: EditorValue = { p: [...val.p] as EditorValue['p'], d: val.d, dnb };
    if (idx === 2) next.d = v;
    else next.p[idx] = v;
    onChange(next);
  };
  const filled = rows.filter((r) => typedOf(r.idx) != null);
  const fillOther = !three && filled.length === 1 && typedOf(filled[0].idx) != null ? filled[0] : null;

  const sens = useMemo(() => (selRow?.ev ? sensRows(selRow.fair, selRow.ev.realPct, cfg) : null), [selRow, cfg]);
  const sideLabel = (idx: SideIdx) => sideFairs(c, dnb).find((s) => s.idx === idx)?.label ?? '';

  return (
    <div className="space-y-3 border-t border-line bg-base/40 px-3 py-3">
      <div className={`grid gap-3 ${three && !dnb ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
        {sideFairs(c, dnb).map((s) => {
          const r = rows.find((x) => x.idx === s.idx);
          const ev = r?.ev ?? null;
          return (
            <div key={s.idx} className={`rounded-md border p-2.5 ${ev && ev.ev > 0 ? 'border-emerald/40' : 'border-line'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-head" title={s.label}>{s.label}</span>
                <span className="num text-xs text-muted">fair <b className="text-sm text-head">{fmtP(s.fair)}</b></span>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                Real shows
                <NumInput
                  label={`Real percentage for ${s.label}`}
                  value={typedOf(s.idx)}
                  parse={parsePct}
                  onCommit={(v) => setSide(s.idx, v)}
                  placeholder={autoOf(s.idx) && r?.real != null ? `${r.real} · RaxEdge` : 'e.g. 52'}
                  suffix="%"
                  className="w-28"
                  autoFocus={s.idx === 0}
                />
              </label>
              {ev ? (
                <dl className="num mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted">EV</dt>
                  <dd className={`text-right text-sm font-semibold ${evTone(ev.ev)}`}>{fmtSigned(ev.ev, 2, '%')}</dd>
                  <dt className="text-muted">Edge</dt>
                  <dd className={`text-right ${evTone(ev.edgePp)}`}>{fmtSigned(ev.edgePp, 1, ' pp')}</dd>
                  <dt className="text-muted">Payout multiple</dt>
                  <dd className="text-right">×{ev.multiple.toFixed(3)}</dd>
                  <dt className="text-muted">Buy only below</dt>
                  <dd className="text-right">{fmtNum(ev.breakEven, 1)}%</dd>
                  <dt className="text-muted" title="The highest rake at which this bet still has EV ≥ 0">Survives rake up to</dt>
                  <dd className="text-right">{ev.maxRake >= 0 ? `${fmtNum(ev.maxRake * 100, 1)}%` : 'none'}</dd>
                  <dt className="text-muted">{(cfg.fraction * 100).toFixed(cfg.fraction * 100 % 1 ? 1 : 0)}% Kelly stake</dt>
                  <dd className="text-right text-sm font-semibold text-head">{ev.stake > 0 ? `${ev.stake.toLocaleString('en-US')} Rax` : '0'}</dd>
                </dl>
              ) : (
                <p className="hint mt-2">Type the % Real shows for this side.</p>
              )}
              {ev && autoOf(s.idx) && eff?.src && (
                <p className="mt-1 text-xs text-action">
                  <span className="chip-blue mr-1.5">from RaxEdge · {fmtAge(now - eff.src.s.ts)}</span>
                  Real’s own number for this side ({eff.src.s.live ? 'live market' : 'pre-game market'}). Type your own value to replace it; check the % in Real before betting.
                </p>
              )}
              {ev && <p className="hint mt-1">{ev.note}{cfg.rules.model === 'pool' && ev.stake > 0 ? ` EV at that stake: ${fmtSigned(ev.evAtStake, 2, '%')}.` : ''}</p>}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {fillOther && fillOther.real != null && (
          <button className="btn-ghost btn-sm" onClick={() => setSide(fillOther.idx === 0 ? 1 : 0, Math.round((100 - (fillOther.real as number)) * 100) / 100)}>
            Set {sideLabel(fillOther.idx === 0 ? 1 : 0)} to {Math.round((100 - fillOther.real) * 100) / 100}% (100 − x)
          </button>
        )}
        {three && (
          <span className="flex items-center gap-2 text-xs text-muted">
            Real’s market:
            <Segmented<'3way' | 'dnb'> label="Soccer market type" value={dnb ? 'dnb' : '3way'} onChange={(v) => { setDnb(v === 'dnb'); onChange({ ...val, d: v === 'dnb' ? null : val.d, dnb: v === 'dnb' }); }} options={[{ value: '3way', label: '3-way (home / draw / away)' }, { value: 'dnb', label: 'Draw no bet (2-way)' }]} />
          </span>
        )}
        {filled.length > 0 && (
          <button className="btn-ghost btn-sm ml-auto" onClick={() => onChange({ p: [null, null], d: null, dnb })}>Clear entry</button>
        )}
      </div>

      {c.warnings.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber/90">
          {c.warnings.map((w) => <li key={w}>⚠ {w}</li>)}
        </ul>
      )}

      {sens && selRow?.ev && (
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="label !mb-0">Sensitivity — if Real’s % for</span>
            {rows.filter((r) => r.ev).length > 1 ? (
              <Segmented<string> label="Sensitivity side" value={String(selRow.idx)} onChange={(v) => setSideSel(Number(v) as SideIdx)} options={rows.filter((r) => r.ev).map((r) => ({ value: String(r.idx), label: r.label }))} />
            ) : (
              <b className="text-sm text-head">{selRow.label}</b>
            )}
            <span className="text-xs text-muted">moves as the pool fills (now {selRow.ev.realPct}%, break-even {fmtNum(sens.breakEven, 1)}%)</span>
          </div>
          <div className="max-h-64 overflow-auto rounded-md border border-line">
            <table className="tbl">
              <thead><tr><th>Real %</th><th className="r">Edge</th><th className="r">Multiple</th><th className="r">EV</th><th className="r">Stake (Rax)</th></tr></thead>
              <tbody>
                {sens.rows.map((r) => (
                  <tr key={r.pct} className={r.current ? 'bg-action/10' : ''}>
                    <td className="num">{r.pct}%{r.current && <span className="chip-blue ml-2">{autoOf(selRow.idx) ? 'RaxEdge' : 'typed'}</span>}{!r.current && r.pct <= sens.breakEven && r.pct + 2 > sens.breakEven && <span className="chip-amber ml-2">break-even ≈ {fmtNum(sens.breakEven, 1)}%</span>}</td>
                    <td className={`r num ${evTone(selRow.fair * 100 - r.pct)}`}>{fmtSigned(selRow.fair * 100 - r.pct, 1, ' pp')}</td>
                    <td className="r num">×{r.multiple.toFixed(3)}</td>
                    <td className={`r num font-medium ${evTone(r.ev)}`}>{fmtSigned(r.ev, 2, '%')}</td>
                    <td className="r num">{r.stake > 0 ? r.stake.toLocaleString('en-US') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <span className="label">Sources — fair probabilities{three ? ' (home / draw / away)' : ''}</span>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="tbl">
            <thead>
              <tr>
                <th>Source</th>
                {sideFairs(c, dnb).map((s) => <th key={s.idx} className="r">{s.label}</th>)}
                <th className="r" title="Sum of the raw implied probabilities. Books ≈ 104–110% (the vig); exchanges ≈ 100%.">Overround</th>
                <th className="r" title="Weight in the consensus: books 1, exchanges 0.04–1 by volume and bid/ask tightness">Weight</th>
                <th className="r" title="Kalshi: contracts traded; Polymarket: USD traded">Volume</th>
                <th className="r" title="Bid/ask width of the first outcome’s quote">Spread</th>
                {selRow?.ev && <th className="r" title={`EV if this source’s fair % for ${selRow.label} were the truth, at Real’s ${selRow.ev.realPct}%`}>EV @ {selRow.label.split(' ').slice(-1)[0]}</th>}
              </tr>
            </thead>
            <tbody>
              {c.sources.map((sf) => {
                const evS = selRow?.ev ? evalSide(sourceSideFair(sf, selRow.idx, dnb) ?? NaN, selRow.ev.realPct, cfg) : null;
                return (
                  <tr key={sf.source}>
                    <td>
                      {sf.url ? <a href={sf.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1">{ODDS_SOURCE_LABEL[sf.source]}<ExternalLink size={11} /></a> : ODDS_SOURCE_LABEL[sf.source]}
                      {sf.vigRemoved ? <span className="chip-muted ml-2" title="Raw prices carry a margin; it was removed">vig removed</span> : <span className="chip-muted ml-2" title="Exchange price: no vig, only re-normalised">no vig</span>}
                    </td>
                    {sideFairs(c, dnb).map((s) => <td key={s.idx} className="r num">{fmtP(sourceSideFair(sf, s.idx, dnb))}</td>)}
                    <td className="r num">{fmtNum(sf.overround * 100, 1)}%</td>
                    <td className="r num">{sf.weight.toFixed(2)}</td>
                    <td className="r num">{sf.vigRemoved ? '—' : fmtVol(sf.volume)}</td>
                    <td className="r num">{sf.width != null ? `${(sf.width * 100).toFixed(0)}¢` : '—'}</td>
                    {selRow?.ev && <td className={`r num ${evS ? evTone(evS.ev) : ''}`}>{evS ? fmtSigned(evS.ev, 1, '%') : '—'}</td>}
                  </tr>
                );
              })}
              {c.fair && (
                <tr className="font-medium">
                  <td>Consensus</td>
                  {sideFairs(c, dnb).map((s) => <td key={s.idx} className="r num text-head">{fmtP(s.fair)}</td>)}
                  <td /><td /><td /><td />
                  {selRow?.ev && <td className={`r num ${evTone(selRow.ev.ev)}`}>{fmtSigned(selRow.ev.ev, 1, '%')}</td>}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="hint mt-1">
          {event.away} @ {event.home}. EV = fair × (1 ÷ Real %) × (1 − rake) − 1 with rake {(cfg.rules.rake * 100).toFixed(1)}% on the {cfg.rules.rakeBasis} (a placeholder — see Real payout rules). The last column re-runs it against each single source, so you can see how much the answer depends on who you trust.
        </p>
      </div>
    </div>
  );
}
