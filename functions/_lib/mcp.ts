/**
 * A small, stateless Model Context Protocol server (Streamable HTTP transport, JSON responses).
 *
 * Implements: initialize, ping, tools/list, tools/call, resources/list, resources/read, resources/templates/list, prompts/list,
 * prompts/get, and swallows notifications. No sessions, no SSE stream (the spec lets a server answer every POST with plain JSON
 * and refuse the optional GET stream with 405), so it runs on Cloudflare's free tier with no Durable Objects.
 * Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *
 * Everything exposed is read-only and public: the tools in shared/agent/tools.ts, the knowledge-base documents as resources,
 * and a few prompt templates.
 */
import { SITE_TABS } from '../../shared/agent/siteMap';
import { MCP_TOOLS as TOOLS, runTool, type ToolCtx } from '../../shared/agent/tools';

export const MCP_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const LATEST = MCP_VERSIONS[0];

export const SERVER_INFO = { name: 'rax-super-suite', title: 'RAX — RealApp Super-Suite', version: '1.0.0' };

export const INSTRUCTIONS =
  "RAX (rax.vivaanshahani.com) is an unofficial analytics terminal for the Real Sports app (cards, Rax, On-This-Day claims, prediction markets). " +
  "Use search_docs first for any question about how Real or the site works (it searches Real's public docs and the site's research notes and returns source URLs). " +
  "Use otd_payout / otd_top_cards / otd_rules for card maths, ev_calc / odds_convert / devig / live_odds for prediction-market edge, calculate for arithmetic. " +
  "Card prices and Real's prediction rake are estimates/unknown — say so. Not financial advice; unaffiliated with Real.";

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

const ok = (id: RpcRequest['id'], result: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, result });
const fail = (id: RpcRequest['id'], code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0' as const, id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } });

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

const PROMPTS = [
  {
    name: 'plan_otd_budget',
    title: 'Plan an OTD card budget',
    description: 'Work out which cards and rarity to buy for On-This-Day Rax with a given budget.',
    arguments: [
      { name: 'budget', description: 'Rax to spend, e.g. 50000', required: true },
      { name: 'sport', description: 'Optional sport (NFL, NBA, …)', required: false },
    ],
    build: (a: Record<string, string>) =>
      `I have ${a.budget || 'a budget of'} Rax to spend on On-This-Day (OTD) cards${a.sport ? ` in ${a.sport}` : ''}. Using the RAX tools: (1) call otd_rules ladder to confirm multipliers and caps, (2) call otd_top_cards (try Legendary 3, Mystic 1 and Iconic) to find the best payout-per-Rax cards, (3) use otd_payout for the finalists, and recommend a combination. State clearly that card prices are estimates and that overlapping claim days reduce the total (the 2-claims-per-sport-per-day limit) — point me to https://rax.vivaanshahani.com/efficiency to optimise it exactly.`,
  },
  {
    name: 'evaluate_prediction_edge',
    title: 'Is there an edge on Real\'s prediction market?',
    description: 'Compare fair odds with the percentage Real shows and size a stake.',
    arguments: [
      { name: 'sport', description: 'NBA, NHL, MLB, WNBA, NFL, CFB, CBB, FC or UFC', required: true },
      { name: 'team', description: 'Team or fighter to look for', required: false },
      { name: 'realPct', description: 'The % Real shows for that side', required: false },
      { name: 'bankroll', description: 'Rax bankroll for a Kelly stake', required: false },
    ],
    build: (a: Record<string, string>) =>
      `Check for an edge on Real's prediction market for ${a.sport || 'a sport'}${a.team ? `, focusing on ${a.team}` : ''}. Call live_odds to get the consensus no-vig probabilities (note which sources agree and how confident the consensus is). ${a.realPct ? `Real shows ${a.realPct}% for the side I care about — call ev_calc with ${a.bankroll ? `bankroll ${a.bankroll}` : 'no bankroll'}.` : 'Ask me for the % Real shows before computing EV.'} Remind me that Real's rake is unknown (default 5% assumed), the % must be typed from the app, and this is not financial advice.`,
  },
  {
    name: 'explain_real_rule',
    title: 'Explain a Real rule',
    description: 'Look up and explain how part of Real works, citing the docs.',
    arguments: [{ name: 'topic', description: 'e.g. "pro bonus claim", "legendary 3 multiplier", "how Karma works"', required: true }],
    build: (a: Record<string, string>) =>
      `Explain this about Real Sports: ${a.topic || '(topic)'}. Call search_docs (try 2 phrasings), answer from what the passages actually say, cite each source URL, and label anything the docs don't state as unknown or inferred.`,
  },
  {
    name: 'rateboard_price_check',
    title: 'Price a card on Rateboard',
    description: 'What a buyer owes for a card at a Rateboard rate, with the copy message.',
    arguments: [
      { name: 'player', description: 'Player name', required: true },
      { name: 'rating', description: 'Card rating', required: true },
      { name: 'rate', description: 'Rate in Rax per rating (e.g. 20)', required: true },
    ],
    build: (a: Record<string, string>) => `Call rateboard_owed for ${a.player || 'the player'} with rating ${a.rating || '?'} at rate ${a.rate || '?'}, then show the amount owed and the exact message to paste.`,
  },
] as const;

const DOC_URI = (id: string) => `rax://doc/${id}`;

async function dispatch(req: RpcRequest, ctx: ToolCtx): Promise<object | null> {
  const { id, method } = req;
  const p = isObj(req.params) ? req.params : {};
  const isNotification = id === undefined;
  if (typeof method !== 'string') {
    // A JSON-RPC *response* from the client (we never send requests) or garbage.
    return req.result !== undefined || req.error !== undefined ? null : fail(id, -32600, 'Invalid Request: missing method.');
  }
  if (method.startsWith('notifications/')) return null;
  if (isNotification) return null;

  switch (method) {
    case 'initialize': {
      const asked = typeof p.protocolVersion === 'string' ? p.protocolVersion : '';
      return ok(id, {
        protocolVersion: (MCP_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST,
        capabilities: { tools: { listChanged: false }, resources: { subscribe: false, listChanged: false }, prompts: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: t.name === 'live_odds' || t.name === 'schedule' },
        })),
      });
    case 'tools/call': {
      const name = p.name;
      if (typeof name !== 'string' || !TOOLS.some((t) => t.name === name)) return fail(id, -32602, `Unknown tool: ${String(name)}`);
      const out = await runTool(name, p.arguments, ctx);
      if (!out.ok) return ok(id, { content: [{ type: 'text', text: out.error }], isError: true });
      return ok(id, { content: [{ type: 'text', text: JSON.stringify(out.result, null, 2) }], structuredContent: isObj(out.result) ? out.result : { result: out.result }, isError: false });
    }
    case 'resources/list': {
      const docs = await ctx.kb.docs();
      return ok(id, {
        resources: [
          { uri: 'rax://site/tabs', name: 'site-tabs', title: 'RAX tabs', description: "The site's tabs, routes and what each does.", mimeType: 'application/json' },
          ...docs.map((d) => ({ uri: DOC_URI(d.id), name: d.id, title: d.title, description: `${d.source === 'real-docs' ? "Real's public docs" : d.source === 'site-guide' ? 'Site guide' : 'RAX research notes'} — ${d.url}`, mimeType: 'text/markdown' })),
        ],
      });
    }
    case 'resources/templates/list':
      return ok(id, { resourceTemplates: [] });
    case 'resources/read': {
      const uri = typeof p.uri === 'string' ? p.uri : '';
      if (uri === 'rax://site/tabs') return ok(id, { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(SITE_TABS.map((t) => ({ tab: t.n, route: t.route, label: t.label, summary: t.summary })), null, 2) }] });
      const m = /^rax:\/\/doc\/([a-z0-9-]+)$/.exec(uri);
      const doc = m ? await ctx.kb.read(m[1]) : null;
      if (!doc) return fail(id, -32002, `Resource not found: ${uri}`, { uri });
      return ok(id, { contents: [{ uri, mimeType: 'text/markdown', text: `# ${doc.meta.title}\n\nSource: ${doc.meta.url}\n\n${doc.chunks.join('\n\n')}` }] });
    }
    case 'prompts/list':
      return ok(id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) });
    case 'prompts/get': {
      const pr = PROMPTS.find((x) => x.name === p.name);
      if (!pr) return fail(id, -32602, `Unknown prompt: ${String(p.name)}`);
      const args = isObj(p.arguments) ? Object.fromEntries(Object.entries(p.arguments).map(([k, v]) => [k, String(v).slice(0, 200)])) : {};
      const missing = pr.arguments.filter((a) => a.required && !args[a.name]).map((a) => a.name);
      if (missing.length) return fail(id, -32602, `Missing required argument(s): ${missing.join(', ')}`);
      return ok(id, { description: pr.description, messages: [{ role: 'user', content: { type: 'text', text: pr.build(args) } }] });
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

export interface McpReply {
  status: number;
  /** undefined → empty body (202 for notifications). */
  body?: object;
}

/** Handle one parsed POST body (single message or batch). */
export async function handleMcp(parsed: unknown, ctx: ToolCtx): Promise<McpReply> {
  if (Array.isArray(parsed)) {
    if (!parsed.length) return { status: 400, body: fail(null, -32600, 'Invalid Request: empty batch.') };
    if (parsed.length > 20) return { status: 400, body: fail(null, -32600, 'Batch too large (max 20).') };
    const replies = (await Promise.all(parsed.map((m) => (isObj(m) ? dispatch(m as unknown as RpcRequest, ctx) : Promise.resolve(fail(null, -32600, 'Invalid Request'))))))
      .filter((x): x is object => x !== null);
    return replies.length ? { status: 200, body: replies } : { status: 202 };
  }
  if (!isObj(parsed) || parsed.jsonrpc !== '2.0') return { status: 400, body: fail(isObj(parsed) ? (parsed.id as RpcRequest['id']) : null, -32600, 'Invalid Request: expected a JSON-RPC 2.0 message.') };
  const reply = await dispatch(parsed as unknown as RpcRequest, ctx);
  return reply ? { status: 200, body: reply } : { status: 202 };
}

export const parseError = () => ({ status: 400, body: fail(null, -32700, 'Parse error: body is not valid JSON.') });
