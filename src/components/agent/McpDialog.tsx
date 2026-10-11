import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Play, XCircle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Segmented } from '../ui/Segmented';
import { CopyButton } from '../ui/CopyButton';
import { Spinner } from '../ui/StateBlock';

interface McpTool {
  name: string;
  title?: string;
  description: string;
}
type Status = { state: 'checking' } | { state: 'ok'; version: string; protocol: string; tools: McpTool[]; ms: number } | { state: 'down'; message: string };

async function rpc(url: string, method: string, params?: unknown, id = 1): Promise<any> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message ?? 'MCP error');
  return j.result;
}

type Client = 'instinct' | 'claude' | 'cursor' | 'vscode' | 'bridge';
const CLIENTS: Array<{ value: Client; label: string }> = [
  { value: 'instinct', label: 'Instinct' },
  { value: 'claude', label: 'Claude' },
  { value: 'cursor', label: 'Cursor' },
  { value: 'vscode', label: 'VS Code' },
  { value: 'bridge', label: 'Other / stdio' },
];

const PRESETS: Array<{ label: string; tool: string; args: object }> = [
  { label: 'Search the docs', tool: 'search_docs', args: { query: 'how many claims per day on this day', limit: 2 } },
  { label: 'OTD payout', tool: 'otd_payout', args: { rarity: 'Legendary 3', generalRaxPerSeason: 700 } },
  { label: 'Prediction EV', tool: 'ev_calc', args: { fairProb: 0.62, realPct: 55, bankroll: 1000 } },
  { label: 'Calculator', tool: 'calculate', args: { expression: '(1200*0.35 + 300) / 12' } },
];

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="label !mb-0">{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="num overflow-x-auto rounded-md border border-line bg-base p-2 text-[12px] leading-snug">{text}</pre>
    </div>
  );
}

export default function McpDialog({ onClose }: { onClose: () => void }) {
  const url = `${window.location.origin}/mcp`;
  const [status, setStatus] = useState<Status>({ state: 'checking' });
  const [client, setClient] = useState<Client>('instinct');
  const [showTools, setShowTools] = useState(false);
  const [out, setOut] = useState<{ label: string; text: string; ok: boolean } | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const outRef = useRef<HTMLDivElement>(null);
  useEffect(() => outRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [out]);

  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    (async () => {
      try {
        const init = await rpc(url, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rax-web', version: '1' } });
        const list = await rpc(url, 'tools/list', undefined, 2);
        if (alive) setStatus({ state: 'ok', version: init.serverInfo?.version ?? '?', protocol: init.protocolVersion, tools: list.tools, ms: Math.round(performance.now() - t0) });
      } catch (e) {
        if (alive) setStatus({ state: 'down', message: e instanceof Error ? e.message : 'Could not reach the server.' });
      }
    })();
    return () => { alive = false; };
  }, [url]);

  const configs = useMemo(() => {
    const q = JSON.stringify;
    return {
      remote: q({ mcpServers: { rax: { type: 'http', url } } }, null, 2),
      cursor: q({ mcpServers: { rax: { url } } }, null, 2),
      vscode: q({ servers: { rax: { type: 'http', url } } }, null, 2),
      bridge: q({ mcpServers: { rax: { command: 'npx', args: ['-y', 'mcp-remote', url] } } }, null, 2),
      claudeCode: `claude mcp add --transport http rax ${url}`,
    };
  }, [url]);

  const run = async (p: (typeof PRESETS)[number]) => {
    setRunning(p.label);
    try {
      const r = await rpc(url, 'tools/call', { name: p.tool, arguments: p.args }, 3);
      setOut({ label: `${p.tool}(${JSON.stringify(p.args)})`, text: r.content?.[0]?.text ?? JSON.stringify(r, null, 2), ok: !r.isError });
    } catch (e) {
      setOut({ label: p.tool, text: e instanceof Error ? e.message : 'failed', ok: false });
    } finally {
      setRunning(null);
    }
  };

  return (
    <Modal title="Connect an AI app to RAX (MCP)" onClose={onClose} wide>
      <p className="text-sm text-muted">
        RAX runs a public, <b className="text-head">read-only</b> <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer">Model Context Protocol</a> server. Connect
        Instinct (or any MCP-capable app) and it can search Real's docs, run the OTD, EV and Kelly maths, and read live odds and schedules — the same tools the chat assistant here uses. No account, no API key.
      </p>

      <div>
        <span className="label">Server URL <span className="normal-case tracking-normal">(Streamable HTTP · no authentication)</span></span>
        <div className="flex items-center gap-2">
          <input readOnly className="field num flex-1" value={url} onFocus={(e) => e.currentTarget.select()} aria-label="MCP server URL" />
          <CopyButton text={url} />
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-xs" role="status">
          {status.state === 'checking' && <><Spinner /> <span className="text-muted">Checking the server…</span></>}
          {status.state === 'ok' && <><CheckCircle2 size={14} className="text-emerald" /> <span className="text-emerald">Online</span><span className="text-muted">· {status.tools.length} tools · protocol {status.protocol} · {status.ms} ms</span></>}
          {status.state === 'down' && <><XCircle size={14} className="text-danger" /> <span className="text-danger">Not reachable: {status.message}</span></>}
        </p>
      </div>

      <div className="space-y-3">
        <Segmented<Client> value={client} onChange={setClient} options={CLIENTS} label="App" />
        {client === 'instinct' && (
          <div className="space-y-3 text-sm">
            <ol className="list-decimal space-y-1 pl-5 text-muted">
              <li>In Instinct, open its settings and find where MCP servers / integrations / tools are added.</li>
              <li>Add a <b className="text-head">remote</b> (HTTP) server, name it <span className="num text-head">rax</span> and paste the URL above. Transport: <b className="text-head">Streamable HTTP</b>. Authentication: <b className="text-head">none</b>.</li>
              <li>If Instinct takes a JSON config instead of a form, use the snippet below. If it only supports local (stdio) servers, use the <b className="text-head">Other / stdio</b> tab.</li>
            </ol>
            <Snippet label="JSON config" text={configs.remote} />
          </div>
        )}
        {client === 'claude' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted"><b className="text-head">Claude (claude.ai / Desktop):</b> Settings → Connectors → Add custom connector → paste the URL above.</p>
            <Snippet label="Claude Code" text={configs.claudeCode} />
          </div>
        )}
        {client === 'cursor' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Add to <span className="num text-head">~/.cursor/mcp.json</span> (or the project's <span className="num text-head">.cursor/mcp.json</span>), then enable it in Cursor Settings → MCP.</p>
            <Snippet label=".cursor/mcp.json" text={configs.cursor} />
          </div>
        )}
        {client === 'vscode' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">Add to <span className="num text-head">.vscode/mcp.json</span> (or run “MCP: Add Server” → HTTP and paste the URL).</p>
            <Snippet label=".vscode/mcp.json" text={configs.vscode} />
          </div>
        )}
        {client === 'bridge' && (
          <div className="space-y-3 text-sm">
            <p className="text-muted">For apps that only launch local (stdio) servers — Windsurf, older Claude Desktop builds, many others — the <span className="num text-head">mcp-remote</span> bridge forwards stdio to this URL (needs Node 18+).</p>
            <Snippet label="mcpServers entry" text={configs.bridge} />
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label !mb-0">Try it from here</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} className="btn-ghost btn-sm" disabled={status.state !== 'ok' || !!running} onClick={() => void run(p)}>
              {running === p.label ? <Spinner /> : <Play size={11} />} {p.label}
            </button>
          ))}
        </div>
        {out && (
          <div className="mt-2" ref={outRef}>
            <p className={`num mb-1 text-[11px] ${out.ok ? 'text-muted' : 'text-danger'}`}>{out.label}</p>
            <pre className="num max-h-56 overflow-auto rounded-md border border-line bg-base p-2 text-[11.5px] leading-snug">{out.text.slice(0, 3000)}</pre>
          </div>
        )}
      </div>

      <div>
        <button className="btn-ghost btn-sm" aria-expanded={showTools} onClick={() => setShowTools((v) => !v)}>
          {showTools ? 'Hide' : 'Show'} the {status.state === 'ok' ? status.tools.length : ''} tools it exposes
        </button>
        {showTools && status.state === 'ok' && (
          <ul className="mt-2 space-y-2 text-xs">
            {status.tools.map((t) => (
              <li key={t.name}>
                <span className="num text-emerald">{t.name}</span> <span className="text-muted">— {t.description.length > 220 ? `${t.description.slice(0, 220)}…` : t.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="hint">
        Read-only and public: nothing you do here or in the app is shared with a connected client, and clients can't change anything on this site. Rate-limited per IP. It also publishes Real's docs and the site guide as MCP
        resources, and a few prompt templates. Details: <a href="https://github.com/GeoWizard4645/rax/blob/main/docs/MCP.md" target="_blank" rel="noopener noreferrer">docs/MCP.md</a>. Not financial advice; unaffiliated with Real.
      </p>
    </Modal>
  );
}
