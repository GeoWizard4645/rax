import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Database } from 'lucide-react';
import { REAL_MARKET_SNIPPET, parseRealCapture, realMarketBookmarklet } from '../../shared/realMarketCapture';
import { useRealMarket } from '../lib/realMarketStore';
import { shareCapture, useCommunityState } from '../lib/communityStore';
import { OPEN_CAPTURE_EVENT } from './CommunityData';

/**
 * Shared by Tabs 2 and 3. Records what the user's OWN Real session already shows (Marketplace auctions, and each card's
 * "Market data" stats and recent sales) via a read-only snippet they run on realapp.com, then takes the export pasted back
 * here. Captures accumulate in this browser's storage (src/lib/realMarketStore.ts); importing also shares them anonymously (see below).
 */
export default function RealCaptureImport({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const real = useRealMarket();
  const [open, setOpen] = useState(defaultOpen);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [code, setCode] = useState(false);
  const [sure, setSure] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareMsg, setShareMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const community = useCommunityState();
  const root = useRef<HTMLElement>(null);
  const bm = useRef<HTMLAnchorElement>(null);
  // "How to contribute" in the Community line opens this panel.
  useEffect(() => {
    const on = () => {
      setOpen(true);
      root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener(OPEN_CAPTURE_EVENT, on);
    return () => window.removeEventListener(OPEN_CAPTURE_EVENT, on);
  }, []);
  // React refuses javascript: hrefs, so set the bookmarklet on the DOM node directly (same trick as the RaxEdge bridge).
  useEffect(() => {
    if (open) bm.current?.setAttribute('href', realMarketBookmarklet());
  }, [open]);

  const run = async () => {
    const raw = text;
    const r = real.importText(raw);
    setMsg({ ok: r.ok, text: r.message });
    setShareMsg(null);
    if (!r.ok) return;
    setText('');
    // Always shared, but only after the local import has succeeded. A failure here never touches the local import.
    const parsed = parseRealCapture(raw);
    if (!parsed.capture) return;
    setSharing(true);
    const res = await shareCapture(parsed.capture);
    setSharing(false);
    setShareMsg({ ok: res.ok, text: res.ok ? `Shared anonymously: ${res.message}.` : res.message });
  };
  const c = real.coverage;

  return (
    <section ref={root} className="panel" aria-label="Capture from your Real session">
      <button className="panel-hd w-full flex-wrap text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2 className="flex items-center gap-2">
          <Database size={14} /> Capture real Real-marketplace data from your own session
        </h2>
        <span className="flex items-center gap-2">
          {real.hasData ? <span className="chip-emerald num">{real.summary}</span> : <span className="chip-muted">nothing captured yet</span>}
          <ChevronDown size={15} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="panel-bd space-y-3 text-sm text-muted">
          <p>
            Real shows you every live auction on its Marketplace and, for any card, a “Market data” view (median price, price per rating, total sales, quartiles) with a list of recent sales. This records <b className="text-head">only what is on your screen</b>, as you browse. It runs in <b className="text-head">your own browser on realapp.com while you’re signed in</b>, only <b className="text-head">reads</b> the text already on the page, <b className="text-head">makes no requests</b>, <b className="text-head">clicks nothing</b> and <b className="text-head">sends nothing</b> itself — it just gives you text to paste here (importing it here is what shares it, anonymously). Real’s terms discourage bulk data mining, so record only what you personally look at, at human speed.
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Drag <a ref={bm} href="#" onClick={(e) => e.preventDefault()} className="chip-blue !no-underline" title="Drag to your bookmarks bar">Record Real market → RAX</a> to your bookmarks bar, or{' '}
              <button className="underline" onClick={() => setCode(!code)}>{code ? 'hide' : 'show'} the code to paste in the browser console</button>.
            </li>
            <li>Open <b className="text-head">realapp.com</b>, sign in, go to the <b className="text-head">Marketplace</b> and click the bookmark. A small “RAX recorder” box appears.</li>
            <li>Scroll the auctions you care about; open <b className="text-head">Market data</b> on a few cards (Card, Player and Similar views each add a different reference). Watch the counters in the box go up.</li>
            <li>Press <b className="text-head">Export</b> in the box (it copies the text), then paste below and Import. Come back and capture again later — <b className="text-head">history grows every time you do</b>.</li>
          </ol>
          {code && <textarea readOnly className="field num min-h-[120px] text-[11px]" value={REAL_MARKET_SNIPPET} onFocus={(e) => e.currentTarget.select()} aria-label="Recorder code" />}
          <textarea className="field num min-h-[64px]" value={text} onChange={(e) => setText(e.target.value)} placeholder='Paste the export here ({"v":1,"kind":"real-market",…)' aria-label="Real market capture" />
          <div className="space-y-1 rounded-md border border-line px-3 py-2 text-xs">
            <p className="text-head">
              <b>Importing shares the capture anonymously with everyone using RAX.</b> <span className="chip-muted">always on</span>
            </p>
            {community.status === 'unavailable' ? (
              <p className="text-muted">Community sharing isn’t available on this deployment (no community database is connected), so this import stays in your browser.</p>
            ) : (
              <p className="text-muted">
                Each import also sends (in as many parts as it takes — there is no size limit) <b className="text-head">only the auctions, sales and market stats in this export</b> to RAX’s shared database, so other users get them as the “Community” data source. No username, account or IP address is stored — just a random id made in this browser, kept only as a salted hash so independent reporters can be counted. Shared rows can’t be edited or taken back individually (they are kept permanently, each with the time it was received). Don’t import anything you aren’t comfortable sharing.
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn-primary btn-sm" disabled={!text.trim() || sharing} onClick={() => void run()}>{sharing ? 'Sharing…' : community.status === 'unavailable' ? 'Import' : 'Import and share'}</button>
            {real.hasData && (
              <span className="text-xs" title={`Newest capture ${new Date(c.lastCaptureAt ?? c.lastImportAt ?? 0).toLocaleString()} · ${c.imports} import${c.imports === 1 ? '' : 's'}`}>
                Stored in this browser: <b className="num text-head">{c.auctions.toLocaleString('en-US')}</b> auctions ({c.liveAuctions} live) · <b className="num text-head">{c.sales.toLocaleString('en-US')}</b> sales · <b className="num text-head">{c.stats.toLocaleString('en-US')}</b> market-data view{c.stats === 1 ? '' : 's'} · {real.label}
              </span>
            )}
            {real.hasData && (
              <button
                className="btn-ghost btn-sm"
                onClick={() => {
                  if (!sure) return setSure(true);
                  real.clear();
                  setSure(false);
                  setMsg({ ok: true, text: 'Cleared everything captured in this browser.' });
                }}
                onBlur={() => setSure(false)}
              >
                {sure ? `Really delete ${c.sales.toLocaleString('en-US')} sales and ${c.auctions.toLocaleString('en-US')} auctions?` : 'Clear'}
              </button>
            )}
          </div>
          {msg && (
            <p className={`text-xs ${msg.ok ? 'text-emerald' : 'text-danger'}`} role="status">
              {msg.text}
            </p>
          )}
          {shareMsg && (
            <p className={`text-xs ${shareMsg.ok ? 'text-emerald' : 'text-amber'}`} role="status">
              {shareMsg.text}
            </p>
          )}
          <p className="hint">Bidder names are not shown on Real’s cards, so none are recorded. Price-history chart values are not in the page text either — history here is built from the individual sales and market-data views you open, and only grows as you capture more. Stored locally: newest 20,000 sales, auctions until 14 days after they end.</p>
        </div>
      )}
    </section>
  );
}
