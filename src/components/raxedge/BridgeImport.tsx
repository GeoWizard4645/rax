import { useEffect, useRef, useState } from 'react';
import { RAXEDGE_BRIDGE_SNIPPET, parseBridge, raxedgeBridgeBookmarklet, type RaxEdgeExport } from '../../../shared/raxedgeBridge';
import { clearRaxEdge, saveRaxEdge, useRaxEdge } from '../../lib/raxedgeStore';

type Section = 'otd' | 'odds' | 'packOdds';
const LABEL: Record<Section, string> = { otd: 'your OTD passes', odds: 'FanDuel / DraftKings lines & Real market %', packOdds: 'pack odds (cost of rating)' };

const ageText = (iso?: string | number) => {
  if (!iso) return '';
  const ms = Date.now() - (typeof iso === 'number' ? iso : Date.parse(iso));
  if (!(ms >= 0)) return '';
  const m = Math.round(ms / 60000);
  return m < 1 ? 'just now' : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

/**
 * One export from the user's own RaxEdge session covers every RaxEdge-backed feature. `sections` says which parts this
 * place cares about (the snippet always offers all three; whatever is pasted is stored). OTD passes are handed to `onOtd`
 * (Tab 7 owns that state); odds and pack odds go to the browser store (src/lib/raxedgeStore.ts). Nothing is sent anywhere.
 */
export default function BridgeImport({ sections, onOtd, title = 'Import from RaxEdge' }: { sections: Section[]; onOtd?: (otd: RaxEdgeExport) => string; title?: string }) {
  const stored = useRaxEdge();
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState(false);
  const bm = useRef<HTMLAnchorElement>(null);
  // React refuses javascript: hrefs, so set the bookmarklet on the DOM node directly.
  useEffect(() => bm.current?.setAttribute('href', raxedgeBridgeBookmarklet()), []);

  const run = () => {
    const r = parseBridge(text);
    if (!r.bundle) return setMsg(r.errors[0]);
    const b = r.bundle;
    const done: string[] = [];
    if (b.odds) done.push(saveRaxEdge('odds', { at: b.at, plan: b.plan, data: b.odds }) ? `odds (${Object.keys(b.odds.fd).length} FanDuel feeds, ${Object.keys(b.odds.dk).length} DraftKings feeds)` : 'odds NOT saved (browser storage is full)');
    if (b.packOdds) done.push(saveRaxEdge('packOdds', b.packOdds) ? `${b.packOdds.players.length.toLocaleString()} pack-odds rows` : 'pack odds NOT saved (browser storage is full — clear some imported data)');
    if (b.otd) done.push(onOtd ? onOtd(b.otd) : 'OTD passes found — import them in Tab 7 → My cards');
    setText('');
    setMsg(done.length ? `Imported: ${done.join('; ')}.` : 'The export had nothing in it — tick at least one box in the RaxEdge window.');
  };

  const have: string[] = [];
  if (stored.odds) have.push(`odds ${ageText(stored.odds.at)}`);
  if (stored.packOdds) have.push(`${stored.packOdds.players.length.toLocaleString()} pack rows ${ageText(stored.packOdds.at)}`);

  return (
    <div className="panel">
      <div className="panel-hd"><h2>{title}</h2><span className="chip-blue">optional · off until you enable it</span></div>
      <div className="panel-bd space-y-2 text-sm text-muted">
        <p>Brings in {sections.map((s) => LABEL[s]).join(', ')} from <b className="text-head">your own RaxEdge login</b>. It runs in your browser while you're on raxedge.com; your login never reaches us and nothing is sent anywhere — it only copies text you then paste here. Importing changes nothing until you switch the matching option on.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Drag <a ref={bm} href="#" onClick={(e) => e.preventDefault()} className="chip-blue !no-underline" title="Drag to your bookmarks bar">Export RaxEdge → RAX</a> to your bookmarks bar, or <button className="underline" onClick={() => setCode(!code)}>{code ? 'hide' : 'show'} the code to paste in the browser console</button>.</li>
          <li>Open <b className="text-head">raxedge.com</b>, log in, click the bookmark, tick what you want, press Export, then Copy.</li>
          <li>Paste below and Import.</li>
        </ol>
        {code && <textarea readOnly className="field num min-h-[120px] text-[11px]" value={RAXEDGE_BRIDGE_SNIPPET} onFocus={(e) => e.currentTarget.select()} aria-label="Export code" />}
        <textarea className="field num min-h-[64px]" value={text} onChange={(e) => setText(e.target.value)} placeholder='Paste the export here ({"v":2,"kind":"rax-bridge",…)' aria-label="RaxEdge export" />
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-primary btn-sm" disabled={!text.trim()} onClick={run}>Import</button>
          {have.length > 0 && <span className="text-xs">Stored: {have.join(' · ')}</span>}
          {stored.odds && <button className="btn-ghost btn-sm" onClick={() => clearRaxEdge('odds')}>Forget odds</button>}
          {stored.packOdds && <button className="btn-ghost btn-sm" onClick={() => clearRaxEdge('packOdds')}>Forget pack odds</button>}
        </div>
        {msg && <p className="text-xs">{msg}</p>}
        <p className="hint">A free RaxEdge account covers most feeds; FD soccer/World Cup and Real markets for NHL, college football, UFC and soccer say "Pro plan required" and are skipped.</p>
      </div>
    </div>
  );
}
