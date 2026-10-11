import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FlaskConical, Radio, TriangleAlert } from 'lucide-react';
import { REFERENCE_CARDS } from '../../../shared/otdReference';
import { OTD_SPORTS, seasonLabelFor, type OtdSnapshot } from '../../../shared/otdSnapshot';
import { norm } from '../../../shared/rateboard';
import { rax } from '../../lib/format';
import { Explain } from '../ui/Explain';
import { fetchSnapshot, type OtdMethod } from './useOtdSnapshot';

interface Info { key: OtdMethod; title: string; tag: string; icon: typeof Radio; pros: string[]; cons: string[] }

const INFO: Info[] = [
  {
    key: 'observed',
    title: 'Observed — Real\'s own numbers',
    tag: 'More accurate',
    icon: Radio,
    pros: [
      'Every figure is the per-game Rax Real itself produced (read from Rateboard\'s Rax logs), so there is no modelling error — Luka 23-24 is 627, exactly as in the community lists.',
      'Includes real owner counts and the actual game dates, so overlap between cards is exact.',
      'Checked against the community top-10 lists below.',
    ],
    cons: [
      'Depends on Rateboard (a third party, used with its owner\'s permission). It is a static snapshot — it goes stale until rebuilt, and Real changes buffs retroactively (e.g. the July 2026 CBB/CFB buff).',
      'Only the sports and seasons Rateboard has collected, and only the top cards by earnings (plus anyone who owns a top claim on some day). No UFC; soccer / WNBA are recent only.',
      'Can\'t price a season that is still being played or a player Rateboard hasn\'t logged.',
    ],
  },
  {
    key: 'modeled',
    title: 'Modeled — ESPN stats → our rating model',
    tag: 'Broader, less exact',
    icon: FlaskConical,
    pros: [
      'Built only from free public ESPN stat lines and a transparent formula we fitted to Real\'s ratings — no dependency on Rateboard\'s Rax numbers.',
      'Can be re-run for any finished season or player ESPN has, including ones Rateboard doesn\'t cover.',
      'Lets you sanity-check the observed numbers: big gaps between the two flag cards worth a manual look.',
    ],
    cons: [
      'An approximation. Real\'s rating also reflects game context (leverage, playoffs) we can only partly see, so individual games are off by a few Rax and the ranking near the top can swap places.',
      'Covers a smaller candidate set (a polite number of ESPN requests), and ESPN\'s endpoints are unofficial and can change.',
      'Treat modeled totals as ± a margin, and confirm any card you plan to spend on in the observed view or in-app.',
    ],
  },
];

/** Method switch + the pros/cons so nobody mistakes an estimate for a guarantee. */
export default function MethodPanel({ method, onMethod, snapshot, loading, error }: { method: OtdMethod; onMethod: (m: OtdMethod) => void; snapshot: OtdSnapshot | null; loading: boolean; error: string | null }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        {INFO.map((i) => {
          const on = method === i.key;
          const Icon = i.icon;
          return (
            <div key={i.key} className={`panel p-3 transition-colors ${on ? 'border-action ring-1 ring-action/40' : 'opacity-80'}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold"><Icon size={15} className={on ? 'text-action' : 'text-muted'} /> {i.title}</div>
                  <span className={i.key === 'observed' ? 'chip-emerald mt-1' : 'chip-amber mt-1'}>{i.tag}</span>
                </div>
                <button className={on ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} aria-pressed={on} onClick={() => onMethod(i.key)}>{on ? 'Selected' : 'Use this'}</button>
              </div>
              <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
                {i.pros.map((t) => <li key={t} className="flex gap-1.5"><CheckCircle2 size={13} className="mt-0.5 shrink-0 text-emerald" />{t}</li>)}
                {i.cons.map((t) => <li key={t} className="flex gap-1.5"><TriangleAlert size={13} className="mt-0.5 shrink-0 text-amber" />{t}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-relaxed text-amber/90">
        <b>This is a ranking aid, not a recommendation.</b> Earnings come from past games and Real's published rules (which change). <b>Prices are estimates</b> — Real publishes no marketplace data, so cost is "claim + rating needed × Rax-per-rating" using Rateboard's standing offers; overwrite any price in the table with what you actually see. Whether a card's cap resets yearly, how long a claim stays open, and the Pro bonus win-rate are not documented and are assumptions here. Not financial advice.
      </div>
      {loading && <p className="hint">Loading the {method} snapshot…</p>}
      {error && <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">{error}</div>}
      {snapshot && method === 'modeled' && <ModelCheck modeled={snapshot} />}
      {snapshot && <SnapshotInfo snapshot={snapshot} />}
    </div>
  );
}

function SnapshotInfo({ snapshot }: { snapshot: OtdSnapshot }) {
  const val = useMemo(() => {
    const byKey = new Map(snapshot.cards.map((c) => [`${c.sport}|${c.seasonLabel}|${norm(c.name)}`, c]));
    return REFERENCE_CARDS.map((r) => {
      const hit = byKey.get(`${r.sport}|${r.rawLabel}|${norm(r.name)}`) ?? byKey.get(`${r.sport}|${seasonLabelFor(r.sport, +r.rawLabel.slice(0, 4) || 0)}|${norm(r.name)}`);
      return { ref: r, got: hit?.annual ?? null };
    });
  }, [snapshot]);
  const found = val.filter((v) => v.got != null);
  const close = found.filter((v) => Math.abs((v.got as number) - v.ref.general) <= Math.max(3, v.ref.general * 0.02));
  return (
    <Explain title={`Snapshot: ${snapshot.cards.length.toLocaleString()} cards · built ${snapshot.generatedAt.slice(0, 10)} · ${snapshot.source}`}>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Sport</th><th>Seasons</th><th className="r">Cards</th><th>Note</th></tr></thead>
          <tbody>
            {[...snapshot.coverage].sort((a, b) => OTD_SPORTS.indexOf(a.sport) - OTD_SPORTS.indexOf(b.sport)).map((c) => (
              <tr key={c.sport}><td>{c.sport}</td><td className="num text-xs">{c.seasons.join(', ')}</td><td className="r num">{c.cards}</td><td className="text-xs">{c.note ?? ''}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <b className="text-head">Check against the community lists:</b> {found.length} of {val.length} reference cards found; <b className="text-head">{close.length}</b> within 2% of the published "Earnings at General".
        Mismatches usually mean a rule change (CBB / CFB buff) or golf's published figures being after overlap removal.
      </p>
      <div className="max-h-60 overflow-auto">
        <table className="tbl">
          <thead><tr><th>Card</th><th className="r">Community list</th><th className="r">This snapshot</th></tr></thead>
          <tbody>
            {val.map((v) => (
              <tr key={`${v.ref.sport}${v.ref.rawLabel}${v.ref.name}`}>
                <td>{v.ref.name} <span className="chip-muted">{v.ref.sport}</span> <span className="num text-xs text-muted">{v.ref.rawLabel}</span></td>
                <td className="r num">{rax(v.ref.general)}</td>
                <td className={`r num ${v.got == null ? 'text-muted' : Math.abs(v.got - v.ref.general) <= Math.max(3, v.ref.general * 0.02) ? 'text-emerald' : 'text-amber'}`}>{v.got == null ? 'not in snapshot' : rax(v.got)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Explain>
  );
}

type Acc = Record<string, { n: number; r2Rating: number | null; maeRax: number | null; within1Rax: number | null; annual?: { spearmanAll: number | null; top30?: { mape: number | null } | undefined } }>;

/** Measured error of the rating model, plus a head-to-head against the observed snapshot for cards present in both. */
function ModelCheck({ modeled }: { modeled: OtdSnapshot }) {
  const [acc, setAcc] = useState<Acc | null>(null);
  const [obs, setObs] = useState<OtdSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    void import('../../../shared/ratingModel').then((m) => alive && setAcc(m.MODEL_ACCURACY as unknown as Acc));
    void fetchSnapshot('observed').then((o) => alive && setObs(o)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const cmp = useMemo(() => {
    if (!obs) return null;
    const by = new Map(obs.cards.map((c) => [`${c.sport}|${c.season}|${norm(c.name)}`, c]));
    const rows = modeled.cards.flatMap((m) => {
      const o = by.get(`${m.sport}|${m.season}|${norm(m.name)}`);
      return o && o.annual > 0 ? [{ m, o, err: (m.annual - o.annual) / o.annual }] : [];
    });
    const abs = rows.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
    return { rows, median: abs.length ? abs[Math.floor(abs.length / 2)] : null, p90: abs.length ? abs[Math.floor(abs.length * 0.9)] : null, worst: [...rows].sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 6) };
  }, [obs, modeled]);

  return (
    <Explain title="How accurate is the model? (measured, held-out season)" defaultOpen>
      <p>Rax per game is <b className="text-head">exactly round(k × rating)</b> (k is Real's published per-sport factor, doubled in the playoffs). The weak step is predicting the <i>rating</i> from a box score — that part is a fitted approximation. Golf and soccer aren't modeled at all.</p>
      {acc && (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>Sport</th><th className="r">Games tested</th><th className="r">Rating R²</th><th className="r" title="Mean absolute error of one game's Rax">Avg error / game</th><th className="r" title="Share of games within ±1 Rax">Within ±1 Rax</th><th className="r" title="Spearman rank agreement between predicted and Real's season totals over every matched player — easy to score well on; see the note below for the top seasons that matter">Season-total rank match (all matched)</th></tr></thead>
            <tbody>
              {Object.entries(acc).map(([sp, a]) => (
                <tr key={sp}>
                  <td>{sp}</td>
                  <td className="r num">{a.n.toLocaleString()}</td>
                  <td className="r num">{a.r2Rating?.toFixed(3) ?? '—'}</td>
                  <td className="r num">{a.maeRax != null ? `${a.maeRax.toFixed(2)} Rax` : '—'}</td>
                  <td className="r num">{a.within1Rax != null ? `${Math.round(a.within1Rax * 100)}%` : '—'}</td>
                  <td className={`r num ${a.annual?.spearmanAll != null && a.annual.spearmanAll < 0.7 ? 'text-amber' : ''}`}>{a.annual?.spearmanAll != null ? a.annual.spearmanAll.toFixed(2) : 'n/a'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p><b className="text-head">Weakest:</b> college football and MLB. Among each sport's top ~150 seasons — the ones that matter for buying — rank agreement falls to ≈ 0.55 (CFB) and 0.63 (MLB) versus 0.9+ for NBA, NFL, NHL and WNBA. Real's top college seasons are full of obscure low-owner defenders, and low-owner players earn up to ~1.5× more than the stats imply — something the model can't see. Treat those two sports' modeled numbers as rough.</p>
      {cmp && cmp.rows.length > 0 && (
        <>
          <p><b className="text-head">Head-to-head vs observed</b> on {cmp.rows.length.toLocaleString()} cards present in both: the typical (median) season total is off by <b className="text-head">{((cmp.median ?? 0) * 100).toFixed(1)}%</b>; 9 in 10 are within {((cmp.p90 ?? 0) * 100).toFixed(0)}%.</p>
          <div className="max-h-48 overflow-auto">
            <table className="tbl">
              <thead><tr><th>Biggest misses</th><th className="r">Modeled</th><th className="r">Observed</th><th className="r">Error</th></tr></thead>
              <tbody>{cmp.worst.map((r) => <tr key={r.m.id}><td>{r.m.name} <span className="chip-muted">{r.m.sport}</span> <span className="num text-xs text-muted">{r.m.seasonLabel}</span></td><td className="r num">{rax(r.m.annual)}</td><td className="r num">{rax(r.o.annual)}</td><td className="r num text-amber">{r.err > 0 ? '+' : ''}{(r.err * 100).toFixed(0)}%</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </Explain>
  );
}
