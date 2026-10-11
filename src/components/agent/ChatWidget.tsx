import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bot, Check, Eye, KeyRound, MessageCircle, SendHorizontal, Square, Trash2, Undo2, X, AlertTriangle } from 'lucide-react';
import { canUndo, describe as describeApp, getVersion, noteRoute, setNavigator, subscribe as subscribeBridge, undo } from '../../agent/bridge';
import { clear, clearOwnKey, getState, OWN_PROVIDERS, probe, send, setOpen, setOwnKey, stop, subscribe, type OwnProvider, type UiMsg } from '../../agent/chatClient';
import { Markdown } from './Markdown';

const SUGGESTIONS: Record<string, string[]> = {
  '/efficiency': ['Set it to Iconic, 90 days, NFL only', 'Which cards pay back fastest?', 'How is the payout calculated?'],
  '/calendar': ['Show next month with 3 claims', 'Why are some days flagged as overlap?', 'What does Pro’s bonus claim do?'],
  '/edge': ['Explain EV and Kelly like I’m new', 'Set bankroll to 2,000 and half Kelly', 'What is the rake assumption?'],
  '/rateboard': ['What does “20/1” mean?', 'How much is an 87 owed at 20/1?', 'Switch to NFL'],
  '/scout': ['What is the premium %?', 'How do I scout my own cards?', 'Set the discount to 15%'],
  '/volatility': ['Is this data real?', 'How does the Monte Carlo work?', 'Show only NFL'],
  '/quads': ['How do Quads payouts work?', 'Which game has the most Karma opportunity?', 'Open the squad board'],
  '/portfolio': ['What is the earnings audit?', 'Where does the CDN art come from?'],
};
const GENERIC = ['What can you do?', 'How does On-This-Day work?', 'Take me to the Edge / EV tab'];

function StepChips({ steps }: { steps?: UiMsg['steps'] }) {
  if (!steps?.length) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="What I did">
      {steps.map((s, i) => (
        <li key={i} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${s.ok ? 'border-emerald/30 text-emerald' : 'border-amber/40 text-amber'}`}>
          {s.ok ? <Check size={11} /> : <AlertTriangle size={11} />} {s.label}
        </li>
      ))}
    </ul>
  );
}

function KeyPanel() {
  const st = useSyncExternalStore(subscribe, getState);
  const [provider, setProvider] = useState<OwnProvider>(st.own?.provider ?? 'groq');
  const [key, setKey] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const info = OWN_PROVIDERS[provider];
  return (
    <form
      className="space-y-2 border-b border-line bg-base/60 p-3 text-[11px] text-muted"
      onSubmit={(e) => {
        e.preventDefault();
        const bad = setOwnKey(provider, key);
        setErr(bad);
        if (!bad) setKey('');
      }}
    >
      <p>
        <b className="text-head">Use your own free AI key</b> — no daily limit from this site, and it never counts against the shared allowance. The key stays in this browser
        (localStorage); each message sends it through this site's server to {st.own ? OWN_PROVIDERS[st.own.provider].label : info.label} for that one request, and it is never stored or logged.
      </p>
      {st.own && (
        <p className="flex items-center gap-2 text-emerald">
          <Check size={12} /> Using your {OWN_PROVIDERS[st.own.provider].label} key ({st.own.hint}).
          <button type="button" className="btn-ghost btn-sm ml-auto" onClick={clearOwnKey}>Remove key</button>
        </p>
      )}
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="rax-key-provider">Provider</label>
        <select id="rax-key-provider" className="field w-auto" value={provider} onChange={(e) => setProvider(e.target.value as OwnProvider)}>
          {(Object.keys(OWN_PROVIDERS) as OwnProvider[]).map((p) => <option key={p} value={p}>{OWN_PROVIDERS[p].label}</option>)}
        </select>
        <label className="sr-only" htmlFor="rax-key-input">API key</label>
        <input id="rax-key-input" className="field min-w-0 flex-1" type="password" autoComplete="off" spellCheck={false} placeholder={st.own ? 'Paste a new key to replace it' : 'Paste your API key'} value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn-primary btn-sm" type="submit" disabled={!key.trim()}>Save</button>
      </div>
      {err && <p className="text-amber" role="alert">{err}</p>}
      <p>
        {info.note} <a className="text-link underline" href={info.keyUrl} target="_blank" rel="noreferrer noopener">Get a free {info.label} key ↗</a>
      </p>
    </form>
  );
}

function ContextPanel() {
  useSyncExternalStore(subscribeBridge, getVersion);
  const ctx = useMemo(() => describeApp(), [getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto border-b border-line bg-base/60 p-3 text-[11px] text-muted">
      <p>
        This is what I can see of your session. It lives in your browser; when you send a message, it goes to Cloudflare Workers AI to answer it, and isn't stored.
        I never see passwords or Rateboard sign-in details.
      </p>
      {ctx.tabs.map((t) => (
        <div key={t.id}>
          <b className="text-head">{t.label}</b> {t.active ? <span className="chip-emerald">on screen</span> : <span className="chip-muted">{t.seen ? 'visited' : 'from saved settings'}</span>}
          {t.summary !== undefined && <pre className="num mt-1 overflow-x-auto whitespace-pre-wrap break-all text-[10.5px] leading-snug">{JSON.stringify(t.summary, null, 1).slice(0, 700)}</pre>}
        </div>
      ))}
      {ctx.activity.length > 0 && (
        <div>
          <b className="text-head">Recent activity</b>
          <ul className="mt-1 list-disc pl-4">{ctx.activity.slice(-8).map((a, i) => <li key={i}>{a}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

export default function ChatWidget() {
  const st = useSyncExternalStore(subscribe, getState);
  useSyncExternalStore(subscribeBridge, getVersion);
  const loc = useLocation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  const [showCtx, setShowCtx] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    setNavigator((to) => navigate(to));
    return () => setNavigator(null);
  }, [navigate]);
  useEffect(() => noteRoute(loc.pathname), [loc.pathname]);

  // other parts of the page can open the assistant with a question: window.dispatchEvent(new CustomEvent('rax:ask', { detail: '…' }))
  useEffect(() => {
    const h = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<string>).detail;
      if (typeof q === 'string' && q.trim()) void send(q);
    };
    window.addEventListener('rax:ask', h);
    return () => window.removeEventListener('rax:ask', h);
  }, []);

  useEffect(() => {
    if (st.open) {
      void probe();
      setTimeout(() => input.current?.focus(), 50);
    }
  }, [st.open]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [st.msgs.length, st.busy, st.status, st.open]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && st.open && !document.querySelector('[role="dialog"][aria-modal="true"]') && setOpen(false);
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [st.open]);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(120, el.scrollHeight)}px`;
  }, [draft, st.open]);

  const route = Object.keys(SUGGESTIONS).find((r) => loc.pathname.startsWith(r));
  const suggestions = route ? SUGGESTIONS[route] : GENERIC;
  const submit = () => {
    const t = draft.trim();
    if (!t || st.busy) return;
    setDraft('');
    void send(t);
  };

  return (
    <>
      {st.open && (
        <section
          aria-label="RAX Assistant"
          className="fixed inset-x-2 bottom-[4.5rem] z-40 flex h-[min(640px,calc(100dvh-6rem))] flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-2xl sm:inset-x-auto sm:right-4 sm:w-[420px]"
        >
          <header className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="grid h-7 w-7 place-items-center rounded-md border border-line bg-base text-emerald"><Bot size={15} /></span>
            <div className="min-w-0 flex-1 leading-tight">
              <h2 className="text-sm font-semibold">RAX Assistant</h2>
              <p className="truncate text-[11px] text-muted">
                {st.mode === 'ai' ? (
                  st.own ? (
                    <>Your {OWN_PROVIDERS[st.own.provider].label} key · no site limit</>
                  ) : (
                    <>Free AI{st.budgetLeft !== undefined ? ` · ${Math.round(st.budgetLeft * 100)}% left today` : ' on Cloudflare'}{st.answeredBy && st.answeredBy !== 'cloudflare' ? ` · via ${st.answeredBy}` : ''}</>
                  )
                ) : (
                  <span className="text-amber">Offline mode · {st.offlineReason ?? 'AI unavailable'}</span>
                )}
              </p>
            </div>
            <button className="btn-ghost btn-sm" onClick={() => setShowKey((v) => !v)} aria-pressed={showKey} title="Use your own free AI key" aria-label="Use your own free AI key">
              <KeyRound size={13} />
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setShowCtx((v) => !v)} aria-pressed={showCtx} title="What the assistant can see">
              <Eye size={13} /> <span className="hidden sm:inline">Context</span>
            </button>
            <button className="btn-ghost btn-sm" disabled={!canUndo()} onClick={() => void undo()} title="Undo the assistant's last change" aria-label="Undo the assistant's last change">
              <Undo2 size={13} />
            </button>
            <button className="btn-ghost btn-sm" disabled={!st.msgs.length} onClick={clear} title="Clear conversation" aria-label="Clear conversation">
              <Trash2 size={13} />
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close assistant">
              <X size={13} />
            </button>
          </header>

          {showKey && <KeyPanel />}
          {showCtx && <ContextPanel />}

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite" aria-relevant="additions">
            {!st.msgs.length && (
              <div className="space-y-3 text-[13px]">
                <p>
                  Hi — I know Real's docs, this site's formulas and whatever you've entered on any tab. I can <b>answer questions</b>, <b>do the maths</b>, <b>open tabs</b> and <b>change settings for you</b>.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => (
                    <button key={s} className="rounded-full border border-line px-2.5 py-1 text-left text-xs text-head transition-colors hover:bg-hover" onClick={() => void send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
                <p className="hint">Not financial advice. Card prices are estimates; Real’s prediction fee is unknown. I can’t sign in, post offers or spend anything.</p>
              </div>
            )}
            {st.msgs.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="ml-8 rounded-lg rounded-br-sm bg-action/15 px-3 py-2 text-[13px] text-head">{m.text}</div>
              ) : (
                <div key={m.id} className={`mr-4 rounded-lg rounded-bl-sm border px-3 py-2 ${m.error ? 'border-danger/40' : 'border-line bg-base/50'}`}>
                  <Markdown text={m.text} />
                  <StepChips steps={m.steps} />
                  {m.offline && <p className="mt-1 text-[10.5px] text-amber">offline helper — no AI used</p>}
                </div>
              ),
            )}
            {st.busy && (
              <div className="flex items-center gap-2 text-xs text-muted" role="status">
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line border-t-emerald" aria-hidden />
                {st.status || 'Thinking…'}
                <button className="btn-ghost btn-sm ml-auto" onClick={stop}><Square size={10} /> Stop</button>
              </div>
            )}
          </div>

          <form className="flex items-end gap-2 border-t border-line p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <label htmlFor="rax-chat-input" className="sr-only">Message the assistant</label>
            <textarea
              id="rax-chat-input"
              ref={input}
              rows={1}
              maxLength={1500}
              value={draft}
              placeholder={st.busy ? 'Working…' : 'Ask, calculate, or say “set budget to 50k”'}
              className="field max-h-[120px] min-h-[36px] flex-1 resize-none"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            />
            <button className="btn-primary h-9" type="submit" disabled={!draft.trim() || st.busy} aria-label="Send">
              <SendHorizontal size={15} />
            </button>
          </form>
        </section>
      )}
      <button
        onClick={() => setOpen(!st.open)}
        aria-label={st.open ? 'Close the RAX Assistant' : 'Open the RAX Assistant'}
        aria-expanded={st.open}
        className="fixed bottom-4 right-4 z-40 grid h-12 w-12 place-items-center rounded-full border border-emerald/40 bg-surface text-emerald shadow-xl transition-transform hover:scale-105 hover:bg-hover"
      >
        {st.open ? <X size={20} /> : <MessageCircle size={22} />}
        {!st.open && st.msgs.length === 0 && <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-base bg-emerald" aria-hidden />}
      </button>
    </>
  );
}
