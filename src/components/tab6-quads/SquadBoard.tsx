import { useMemo, useState } from 'react';
import { Trash2, UserPlus } from 'lucide-react';
import { SPORTS } from '../../../shared/formulas';
import { load, save } from '../../lib/storage';
import { ago } from '../../lib/format';
import type { Sport } from '../../types/real';
import { CopyButton } from '../ui/CopyButton';
import { Empty } from '../ui/StateBlock';
import { SportTabs } from '../ui/SportSelect';
import { useToast } from '../ui/Toast';
import { realLink } from '../../../shared/formulas';

const KEY = 'rax_squad_board_v1';
interface Entry { id: string; username: string; sports: Sport[]; karma: number; note: string; ts: number }

/** A lightweight board for finding active Quad partners. Stored only in this browser (no server, no accounts). */
export default function SquadBoard() {
  const notify = useToast();
  const [entries, setEntries] = useState<Entry[]>(() => load<Entry[]>(KEY, []));
  const [username, setUsername] = useState('');
  const [sports, setSports] = useState<Sport[]>(['NFL']);
  const [karma, setKarma] = useState('');
  const [note, setNote] = useState('');
  const [filter, setFilter] = useState<Sport | 'ALL'>('ALL');
  const persist = (e: Entry[]) => (setEntries(e), save(KEY, e));

  const add = () => {
    const u = username.trim();
    const k = Math.round(+karma);
    if (u.length < 2) return notify('Enter a username.', 'error');
    if (!sports.length) return notify('Pick at least one sport.', 'error');
    if (!Number.isFinite(k) || k < 0) return notify('Enter your typical Karma score.', 'error');
    persist([{ id: Date.now().toString(36), username: u, sports, karma: k, note: note.trim().slice(0, 140), ts: Date.now() }, ...entries.filter((x) => x.username.toLowerCase() !== u.toLowerCase())]);
    setUsername(''); setKarma(''); setNote('');
    notify('Added to the board.');
  };
  const rows = useMemo(() => entries.filter((e) => filter === 'ALL' || e.sports.includes(filter)).sort((a, b) => b.karma - a.karma), [entries, filter]);
  const toggle = (s: Sport) => setSports((c) => (c.includes(s) ? c.filter((x) => x !== s) : [...c, s]));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="panel">
        <div className="panel-hd"><h2>Find a Quad partner</h2></div>
        <div className="panel-bd space-y-3">
          <div><label className="label" htmlFor="sq-u">Your username</label><input id="sq-u" className="field" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" spellCheck={false} /></div>
          <div>
            <span className="label">Favourite sports</span>
            <div className="flex flex-wrap gap-1">{SPORTS.map((s) => <button key={s} aria-pressed={sports.includes(s)} onClick={() => toggle(s)} className={`rounded-md border px-2 py-1 text-xs font-semibold ${sports.includes(s) ? 'border-action bg-action/15 text-head' : 'border-line text-muted hover:text-head'}`}>{s}</button>)}</div>
          </div>
          <div><label className="label" htmlFor="sq-k">Typical Karma score</label><input id="sq-k" className="field num" inputMode="numeric" value={karma} onChange={(e) => setKarma(e.target.value)} /></div>
          <div><label className="label" htmlFor="sq-n">Note (optional)</label><input id="sq-n" className="field" maxLength={140} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. play every TNF, in the Eastern time zone" /></div>
          <button className="btn-primary w-full" onClick={add}><UserPlus size={14} /> Add to board</button>
          <p className="hint">This board is local to your browser — it's a place to keep a shortlist of active partners. To recruit, copy the invite and DM people from their profile.</p>
        </div>
      </div>
      <div className="panel overflow-hidden">
        <div className="panel-hd flex-wrap"><h2>Squad board <span className="num text-xs font-normal text-muted">({rows.length})</span></h2><SportTabs sports={SPORTS} value={filter} onChange={setFilter} allLabel="All" /></div>
        {rows.length === 0 ? <Empty title="No one on the board yet">Add yourself, or people you've found, to build a list of active partners for prime-time Quads.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Player</th><th>Sports</th><th className="r">Karma</th><th>Added</th><th /></tr></thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td><a href={realLink(e.username)} target="_blank" rel="noopener noreferrer" className="font-medium">{e.username}</a>{e.note && <div className="text-[11px] text-muted">{e.note}</div>}</td>
                  <td><span className="flex flex-wrap gap-1">{e.sports.map((s) => <span key={s} className="chip-muted">{s}</span>)}</span></td>
                  <td className="r num">{e.karma.toLocaleString()}</td>
                  <td className="num text-xs text-muted">{ago(e.ts)}</td>
                  <td className="r"><span className="inline-flex gap-1.5"><CopyButton text={`Hey ${e.username}, want to run Quads together for ${e.sports.join('/')} prime time? I'm around most nights — drop a reply if you're in.`} label="Invite" toast="Invite copied" /><button className="btn-ghost btn-sm" aria-label={`Remove ${e.username}`} onClick={() => persist(entries.filter((x) => x.id !== e.id))}><Trash2 size={12} /></button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
