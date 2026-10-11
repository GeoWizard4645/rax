import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { buildCalendar, type EfficiencyParams } from '../../../shared/otdEfficiency';
import { matchCollection, parsePasses, type HeldPlayer } from '../../../shared/otdProfile';
import { annualPayout } from '../../../shared/otdRules';
import { parseRaxEdgeExport, type RaxEdgeExport } from '../../../shared/raxedgeBridge';
import BridgeImport from '../raxedge/BridgeImport';
import type { OtdCardRecord, OtdSport } from '../../../shared/otdSnapshot';
import type { RbSport } from '../../../shared/rateboard';
import type { CollectionPlayer } from '../../types/real';
import { pullCollection } from '../../lib/rateboardClient';
import { fetchCardRecord } from '../../lib/otdLive';
import { rax } from '../../lib/format';
import { Stat } from '../ui/Stat';
import { Spinner } from '../ui/StateBlock';
import { RUNG_KEYS, type EffState } from './model';

const PULLABLE: Array<{ sport: OtdSport; rb: RbSport }> = [{ sport: 'NFL', rb: 'NFL' }, { sport: 'CFB', rb: 'CFB' }, { sport: 'SOC', rb: 'FC' }];

/**
 * "My cards": type a Real username (approximate — Rateboard only reports rating per PLAYER, not per season) or paste your
 * passes (exact). Everything you mark as owned is free in the Best-combination view and counts first, so the picker
 * recommends what to ADD to your set.
 */
export default function ProfilePanel({ s, set, cards, params }: { s: EffState; set: (p: Partial<EffState>) => void; cards: OtdCardRecord[]; params: EfficiencyParams }) {
  const [user, setUser] = useState(s.username);
  const [sportsOn, setSportsOn] = useState<OtdSport[]>(['NFL', 'CFB']);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pulled, setPulled] = useState<Partial<Record<OtdSport, CollectionPlayer[]>>>({});
  const [paste, setPaste] = useState('');
  const [errs, setErrs] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const owned = useMemo(() => Object.entries(s.ownedLevels).map(([id, level]) => ({ card: byId.get(id), id, level })).filter((x): x is { card: OtdCardRecord; id: string; level: string } => !!x.card), [s.ownedLevels, byId]);
  const cal = useMemo(() => buildCalendar(owned.map((o) => o.card), params), [owned, params]);
  const claimed = cal.reduce((n, c) => n + c.claimed, 0);
  const wasted = cal.reduce((n, c) => n + c.wasted, 0);
  const annualOwned = owned.reduce((n, o) => n + (o.card.fixed ? (o.card.fixed.annualCap == null ? o.card.annual * o.card.fixed.multiplier : Math.min(o.card.fixed.annualCap, o.card.annual * o.card.fixed.multiplier)) : annualPayout(Math.max(o.card.annual, 0), o.level)), 0);

  const matched = useMemo(() => {
    const held: HeldPlayer[] = [];
    const unmatched: CollectionPlayer[] = [];
    for (const sp of Object.keys(pulled) as OtdSport[]) {
      const r = matchCollection(pulled[sp] ?? [], sp, cards);
      held.push(...r.held);
      unmatched.push(...r.unmatched);
    }
    return { held: held.sort((a, b) => b.heldRating - a.heldRating), unmatched };
  }, [pulled, cards]);

  const pull = async () => {
    const name = user.trim().replace(/^@/, '');
    if (!name) return;
    setError(null);
    set({ username: name });
    const next: Partial<Record<OtdSport, CollectionPlayer[]>> = {};
    try {
      for (const sp of PULLABLE.filter((p) => sportsOn.includes(p.sport))) {
        setBusy(`Pulling ${sp.sport} cards for ${name}…`);
        next[sp.sport] = await pullCollection(name, sp.rb, (p) => setBusy(`Pulling ${sp.sport} cards (chunk ${p.chunk}${p.waitSec ? `, Rateboard asks for a ${p.waitSec}s pause` : ''})…`));
      }
      setPulled(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const importPasses = async () => {
    const r = parsePasses(paste, cards);
    const errors = [...r.errors];
    const owned = { ...s.ownedLevels, ...r.owned };
    const custom = [...s.customCards];
    if (r.missing.length) {
      // Not in the snapshot (it only holds the top cards) → look each up live so nothing is silently dropped.
      for (const m of r.missing.slice(0, 40)) {
        setBusy(`Looking up ${m.name} (${m.sport} ${m.season}) on Rateboard…`);
        try {
          const rec = await fetchCardRecord(m.sport, m.season, m.name);
          if (!rec) errors.push(`Line ${m.line}: Rateboard has no ${m.sport} ${m.season} games for "${m.name}".`);
          else {
            if (!custom.some((c) => c.id === rec.id)) custom.push(rec);
            owned[rec.id] = m.level;
          }
        } catch (e) {
          errors.push(`Line ${m.line}: lookup failed (${(e as Error).message}).`);
        }
      }
      setBusy(null);
    }
    setErrs(errors.slice(0, 8));
    if (Object.keys(owned).length !== Object.keys(s.ownedLevels).length || custom.length !== s.customCards.length) {
      set({ ownedLevels: owned, customCards: custom });
      setPaste('');
    }
  };
  const importOtd = (otd: RaxEdgeExport): string => {
    const r = parseRaxEdgeExport(JSON.stringify(otd), cards);
    if (!Object.keys(r.owned).length) return r.errors[0] ?? 'no passes found in the OTD section';
    const ids = new Set(r.cards.map((c) => c.id));
    set({ ownedLevels: { ...s.ownedLevels, ...r.owned }, customCards: [...s.customCards.filter((c) => !ids.has(c.id)), ...r.cards] });
    return `${Object.keys(r.owned).length} passes${r.user ? ` for ${r.user}` : ''} (${r.matchedToDataset} matched the dataset; ${r.cards.filter((c) => c.id.startsWith('re|')).length} more came from RaxEdge's own data, incl. team and UFC cards)${r.errors.length ? ' — ' + r.errors[0] : ''}`;
  };
  const setLevel = (id: string, level: string) => set({ ownedLevels: { ...s.ownedLevels, [id]: level } });
  const remove = (id: string) => { const o = { ...s.ownedLevels }; delete o[id]; set({ ownedLevels: o }); };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs leading-relaxed text-amber/90">
        <b>How exact is this?</b> A username pull tells us <i>which players</i> you hold and the <i>total rating</i> across all their seasons (via Rateboard) — not which season a rating sits on, so it can't know each pass's level. For an exact set, paste your passes below (or tick cards in the rankings). Rateboard's pull covers NFL, college football and soccer only.
      </div>

      <BridgeImport sections={['otd', 'packOdds']} title="Import from RaxEdge (exact passes, team & UFC cards, pack odds)" onOtd={importOtd} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-hd"><h2>Pull by username</h2></div>
          <div className="panel-bd space-y-2">
            <div className="flex gap-2">
              <input className="field" placeholder="Real username" value={user} onChange={(e) => setUser(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void pull()} aria-label="Real username" />
              <button className="btn-primary" disabled={!user.trim() || !!busy} onClick={() => void pull()}>{busy ? <Spinner /> : null} Pull</button>
            </div>
            <div className="flex flex-wrap gap-1">
              {PULLABLE.map((p) => (
                <button key={p.sport} aria-pressed={sportsOn.includes(p.sport)} onClick={() => setSportsOn(sportsOn.includes(p.sport) ? sportsOn.filter((x) => x !== p.sport) : [...sportsOn, p.sport])} className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${sportsOn.includes(p.sport) ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:bg-hover'}`}>{p.sport}</button>
              ))}
            </div>
            {busy && <p className="hint">{busy}</p>}
            {error && <p className="text-xs text-danger">{error}</p>}
            <p className="hint">Uses Rateboard's "pull my cards" (cached ~2 h; it may ask for a short pause to spread load on Real).</p>
          </div>
        </div>
        <div className="panel">
          <div className="panel-hd"><h2>Paste your passes (exact)</h2></div>
          <div className="panel-bd space-y-2">
            <textarea className="field num min-h-[88px]" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Saquon Barkley, NFL, 24-25, Mystic 3\nAshton Jeanty, CFB, 24-25, Epic\nShohei Ohtani, MLB, 2025, Iconic'} aria-label="Passes" />
            <div className="flex items-center gap-2"><button className="btn-primary btn-sm" disabled={!paste.trim()} onClick={() => void importPasses()}>Add to my set</button><span className="hint">Player, Sport, Season, Level — one per line. Cards missing from the snapshot are looked up live.</span></div>
            {errs.length > 0 && <ul className="list-disc pl-5 text-xs text-danger">{errs.map((e) => <li key={e}>{e}</li>)}</ul>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label="Passes in my set" value={String(owned.length)} />
        <Stat label="Earn in timeframe" value={rax(claimed)} tone="emerald" sub="after the 2-claims-per-sport limit" />
        <Stat label="Wasted on overlap" value={rax(wasted)} tone={wasted > 0 ? 'amber' : 'default'} />
        <Stat label="Annual if all claimed" value={rax(annualOwned)} sub="before overlaps" />
      </div>

      <div className="panel overflow-hidden">
        <div className="panel-hd"><h2>My set ({owned.length})</h2>{owned.length > 0 && <button className="btn-ghost btn-sm" onClick={() => set({ ownedLevels: {} })}>Clear</button>}</div>
        {owned.length === 0 ? <p className="hint px-3 py-6 text-center">Nothing yet. Pull a username, paste passes, or tick "Own" in the rankings.</p> : (
          <div className="max-h-[420px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 bg-surface"><tr><th>Card</th><th>Level</th><th className="r">General/yr</th><th className="r">Pays / yr</th><th /></tr></thead>
              <tbody>
                {owned.map((o) => (
                  <tr key={o.id}>
                    <td><span className="font-medium">{o.card.name}</span> <span className="chip-muted">{o.card.sport}</span> <span className="num text-xs text-muted">{o.card.seasonLabel}</span></td>
                    <td>{o.card.fixed ? <span className="text-xs">{o.card.fixed.label} · {o.card.fixed.multiplier}×</span> : <select className="field !w-auto !py-0.5" value={o.level} onChange={(e) => setLevel(o.id, e.target.value)} aria-label={`Level of ${o.card.name}`}>{RUNG_KEYS.map((k) => <option key={k}>{k}</option>)}</select>}</td>
                    <td className="r num text-muted">{rax(o.card.annual)}</td>
                    <td className="r num font-semibold text-emerald">{rax(o.card.fixed ? (o.card.fixed.annualCap == null ? o.card.annual * o.card.fixed.multiplier : Math.min(o.card.fixed.annualCap, o.card.annual * o.card.fixed.multiplier)) : annualPayout(o.card.annual, o.level))}</td>
                    <td className="r"><button className="btn-ghost btn-sm" onClick={() => remove(o.id)} aria-label={`Remove ${o.card.name}`}><Trash2 size={12} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {matched.held.length > 0 && (
        <div className="panel overflow-hidden">
          <div className="panel-hd"><h2>Players pulled for @{s.username} ({matched.held.length})</h2><span className="hint">{matched.unmatched.length} more have no card in the dataset</span></div>
          <p className="hint border-b border-line px-3 py-2">"Rating held" is summed across all of a player's seasons. "Level if concentrated" is the most it could be on a single season — check in Real which season your rating is actually on, then mark it owned at its real level.</p>
          <div className="max-h-[480px] overflow-auto">
            <table className="tbl">
              <thead className="sticky top-0 z-10 bg-surface"><tr><th /><th>Player</th><th className="r">Cards</th><th className="r">Rating held</th><th>Level if concentrated</th><th className="r">Best season / yr</th></tr></thead>
              <tbody>
                {matched.held.map((h) => {
                  const k = `${h.sport}|${h.name}`;
                  const isOpen = open === k;
                  return (
                    <Fragment key={k}>
                      <tr className="cursor-pointer" onClick={() => setOpen(isOpen ? null : k)}>
                        <td>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                        <td><span className="font-medium">{h.name}</span> <span className="chip-muted">{h.sport}</span></td>
                        <td className="r num text-muted">{h.cards}</td>
                        <td className="r num">{rax(h.heldRating)}</td>
                        <td className="text-xs">{h.heldRating >= 10 ? h.rungIfConcentrated : '—'}</td>
                        <td className="r num text-emerald">{rax(annualPayout(h.seasons[0].annual, h.heldRating >= 10 ? h.rungIfConcentrated : 'Common'))}</td>
                      </tr>
                      {isOpen && h.seasons.slice(0, 6).map((c) => (
                        <tr key={`${k}|${c.id}`} className="bg-base/50">
                          <td /><td className="pl-6 text-xs text-muted">{c.seasonLabel}</td><td /><td className="r num text-xs text-muted">{rax(c.annual)} General/yr</td>
                          <td className="text-xs">{s.ownedLevels[c.id] ? <span className="chip-emerald">owned · {s.ownedLevels[c.id]}</span> : null}</td>
                          <td className="r"><button className="btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); setLevel(c.id, s.ownedLevels[c.id] ?? (h.heldRating >= 10 ? h.rungIfConcentrated : 'Common')); }}>{s.ownedLevels[c.id] ? 'Update' : 'Mark owned'}</button></td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
