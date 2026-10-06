import { useMemo, useState } from 'react';
import { ClipboardPaste, Upload } from 'lucide-react';
import { FIELDS, applyMapping, flatten, guessMapping, parsePasted, type Field, type Mapping } from '../../../shared/importer';
import { saveSnapshot, type Snapshot } from '../../lib/snapshots';
import { useToast } from '../ui/Toast';
import { Explain } from '../ui/Explain';

const NONE = '__none__';
const CONST = '__const__';

/** Import auctions you copied from your own Real session. Parsed in this browser; nothing is uploaded. */
export default function ImportPanel({ onImported }: { onImported: (s: Snapshot) => void }) {
  const notify = useToast();
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Mapping>({});
  const parsed = useMemo(() => (text.trim() ? parsePasted(text) : null), [text]);
  const rows = parsed && 'rows' in parsed ? parsed.rows : [];
  const paths = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows.slice(0, 30)) for (const p of Object.keys(flatten(r))) s.add(p);
    return [...s].sort();
  }, [rows]);
  const applied = useMemo(() => (rows.length ? applyMapping(rows, mapping) : null), [rows, mapping]);

  const onText = (t: string) => {
    setText(t);
    const p = t.trim() ? parsePasted(t) : null;
    setMapping(p && 'rows' in p ? guessMapping(p.rows) : {});
  };
  const sample = (f: Field) => {
    const s = mapping[f];
    if (!s || !rows[0]) return '';
    const v = 'value' in s ? s.value : flatten(rows[0])[s.path];
    return v == null ? '' : String(v).slice(0, 28);
  };
  const missing = FIELDS.filter((f) => f.required && !mapping[f.key]);

  return (
    <div className="panel">
      <div className="panel-hd">
        <h2>Import real auctions from your own session</h2>
      </div>
      <div className="panel-bd space-y-3">
        <Explain title="How to get the data (≈5 minutes, no tokens needed)">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Open the Real web app (realapp.com) in your browser and sign in as yourself.</li>
            <li>Open DevTools (F12) → <b className="text-head">Network</b> → filter <b className="text-head">Fetch/XHR</b>, then open the marketplace / auctions screen.</li>
            <li>Click the request that returns the list of auctions → <b className="text-head">Response</b> tab → copy it all, and paste it below.</li>
            <li>On a phone you can do the same with a proxy viewer (HTTP Toolkit, Proxyman) — but only to <i>read response bodies</i>.</li>
          </ol>
          <p>Paste only the <b className="text-head">response body</b>. Never paste request headers, cookies or tokens — they aren't needed and shouldn't leave your browser. Everything is parsed locally and stored only in this browser. Re-import every so often: each import also feeds your 7-day baselines.</p>
        </Explain>

        <textarea className="field num min-h-[110px]" value={text} onChange={(e) => onText(e.target.value)} placeholder='Paste the JSON response here…' aria-label="Paste auction JSON" />
        <label className="btn-ghost btn-sm cursor-pointer w-fit">
          <Upload size={12} /> or choose a .json file
          <input type="file" accept=".json,application/json,text/plain" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) onText(await f.text()); e.target.value = ''; }} />
        </label>

        {parsed && 'error' in parsed && <p className="text-sm text-danger" role="alert">{parsed.error}</p>}

        {rows.length > 0 && (
          <>
            <p className="hint">Found <b className="text-head">{rows.length}</b> records{'path' in (parsed as object) && (parsed as { path: string }).path ? <> at <span className="num">{(parsed as { path: string }).path}</span></> : ''}. Check that each field points at the right key — the guesses are editable.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {FIELDS.map((f) => {
                const s = mapping[f.key];
                const sel = !s ? NONE : 'value' in s ? CONST : s.path;
                return (
                  <div key={f.key}>
                    <label className="label" htmlFor={`m-${f.key}`}>{f.label}{f.required && <span className="text-danger"> *</span>}</label>
                    <div className="flex gap-1.5">
                      <select id={`m-${f.key}`} className="field !py-1" value={sel} onChange={(e) => {
                        const v = e.target.value;
                        setMapping((m) => { const n = { ...m }; if (v === NONE) delete n[f.key]; else if (v === CONST) n[f.key] = { value: '' }; else n[f.key] = { path: v }; return n; });
                      }}>
                        <option value={NONE}>— not mapped —</option>
                        <option value={CONST}>Same value for every row…</option>
                        {paths.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      {s && 'value' in s && <input className="field !py-1" aria-label={`${f.label} constant`} value={s.value} onChange={(e) => setMapping((m) => ({ ...m, [f.key]: { value: e.target.value } }))} placeholder="e.g. NFL" />}
                    </div>
                    {s && !('value' in s) && <div className="num mt-0.5 truncate text-[11px] text-muted">e.g. {sample(f.key) || '—'}</div>}
                  </div>
                );
              })}
            </div>

            {applied && (
              <div className="rounded-md border border-line px-3 py-2 text-xs">
                <b className={applied.bids.length ? 'text-emerald' : 'text-danger'}>{applied.bids.length} of {rows.length} records usable</b>
                {missing.length > 0 && <span className="text-amber"> · still needed: {missing.map((m) => m.label).join(', ')}</span>}
                {applied.skipped.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-muted">
                    {applied.skipped.slice(0, 4).map((s) => <li key={s.row}>row {s.row}: {s.reason}</li>)}
                    {applied.skipped.length > 4 && <li>…and {applied.skipped.length - 4} more</li>}
                  </ul>
                )}
              </div>
            )}
            <button className="btn-primary" disabled={!applied?.bids.length} onClick={() => {
              const snap = saveSnapshot(applied!.bids);
              onImported(snap);
              notify(`Imported ${applied!.bids.length} auctions.`);
              setText('');
            }}>
              <ClipboardPaste size={14} /> Use these {applied?.bids.length ?? 0} auctions
            </button>
          </>
        )}
      </div>
    </div>
  );
}
