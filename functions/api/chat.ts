/**
 * The in-app assistant  —  POST /api/chat
 *
 * Runs on Cloudflare Workers AI (free: 10,000 neurons/day; this endpoint stops itself at AI_DAILY_NEURONS, default 8,000, so the
 * account never bills). Retrieval is BM25 over Real's public docs + this repo's notes (no embeddings → no neurons).
 * See docs/ASSISTANT.md. When the allowance is spent the response is `{ok:false, code:'budget'}` and the browser falls back to
 * its offline helper.
 */
import { MAX_CONTEXT_CHARS } from '../../shared/agent/prompt';
import type { AgentActionSpec, AgentContext, AgentParamSpec, ChatRequest, ChatResponse } from '../../shared/agent/types';
import { makeToolCtx, type AgentEnv } from '../_lib/agentCtx';
import { remaining, type BudgetEnv } from '../_lib/budget';
import { runChat } from '../_lib/chatCore';
import { CORS, json, preflight } from '../_lib/http';
import type { AiBinding } from '../_lib/llm';
import { rateLimit } from '../_lib/ratelimit';

type ChatEnv = AgentEnv & BudgetEnv & { AI?: AiBinding; CHAT_MODEL?: string };

const MAX_BODY = 80 * 1024;

const reply = (body: ChatResponse, status = 200, extra: Record<string, string> = {}) => json(body, status, { 'Cache-Control': 'no-store', ...extra });

const str = (x: unknown, n: number) => String(x ?? '').slice(0, n);
/** The page tells us what it can change; keep each field bounded so a hand-crafted request can't inflate the prompt. */
const cleanParam = (p: AgentParamSpec): AgentParamSpec => ({
  name: str(p?.name, 40), type: ['number', 'integer', 'boolean', 'string', 'enum', 'string[]', 'date'].includes(p?.type) ? p.type : 'string', description: str(p?.description, 220),
  ...(Array.isArray(p?.values) ? { values: p.values.slice(0, 40).map((v) => str(v, 30)) } : {}),
  ...(Number.isFinite(p?.min) ? { min: p.min } : {}), ...(Number.isFinite(p?.max) ? { max: p.max } : {}),
  value: typeof p?.value === 'object' ? str(JSON.stringify(p.value), 200) : typeof p?.value === 'string' ? str(p.value, 200) : p?.value,
});
const cleanAction = (a: AgentActionSpec): AgentActionSpec => ({ name: str(a?.name, 40), description: str(a?.description, 200), ...(Array.isArray(a?.args) ? { args: a.args.slice(0, 5).map((x) => ({ name: str(x?.name, 30), type: x?.type === 'number' ? 'number' as const : 'string' as const, description: str(x?.description, 100), required: !!x?.required })) } : {}) });

function cleanContext(raw: unknown): AgentContext {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<AgentContext>;
  const tabs = Array.isArray(c.tabs) ? c.tabs.slice(0, 12) : [];
  const ctx: AgentContext = {
    route: typeof c.route === 'string' ? c.route.slice(0, 80) : '/',
    now: typeof c.now === 'string' ? c.now.slice(0, 40) : new Date().toISOString(),
    tabs: tabs.filter((t) => t && typeof t.id === 'string' && typeof t.label === 'string').map((t) => ({ ...t, id: t.id.slice(0, 30), label: t.label.slice(0, 40), route: String(t.route ?? '').slice(0, 40), active: !!t.active, seen: !!t.seen, params: Array.isArray(t.params) ? t.params.slice(0, 40).map(cleanParam) : undefined, actions: Array.isArray(t.actions) ? t.actions.slice(0, 12).map(cleanAction) : undefined })),
    activity: Array.isArray(c.activity) ? c.activity.slice(-20).map((a) => String(a).slice(0, 160)) : [],
  };
  // hard ceiling on what the page can make us pay to read
  while (JSON.stringify(ctx).length > MAX_CONTEXT_CHARS * 2 && ctx.tabs.some((t) => !t.active && t.summary !== undefined)) {
    const t = ctx.tabs.find((x) => !x.active && x.summary !== undefined)!;
    t.summary = undefined;
  }
  return ctx;
}

export const onRequest: PagesFunction<ChatEnv> = async ({ request, env, waitUntil }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method === 'GET') {
    // cheap status probe for the widget: is the AI on, and how much of today's allowance is left?
    const { frac } = await remaining(env);
    return json({ ai: !!env.AI, budgetLeft: Math.round(frac * 100) / 100 }, 200, { 'Cache-Control': 'no-store' });
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, POST, OPTIONS', ...CORS } });

  const rl = await rateLimit(request, 'chat', 40, 600);
  if (!rl.allowed) return reply({ ok: false, code: 'rate_limited', message: `You're sending messages quickly — try again in ${rl.retryAfter}s.`, retryAfter: rl.retryAfter }, 429, { 'Retry-After': String(rl.retryAfter) });

  const text = await request.text();
  if (text.length > MAX_BODY) return reply({ ok: false, code: 'bad_request', message: 'Request too large.' }, 413);
  let body: Partial<ChatRequest>;
  try {
    body = JSON.parse(text);
  } catch {
    return reply({ ok: false, code: 'bad_request', message: 'Body must be JSON.' }, 400);
  }
  if (!env.AI) return reply({ ok: false, code: 'ai_unavailable', message: 'The AI binding is not configured on this deployment.' });

  const input: ChatRequest = { messages: (body.messages ?? []) as ChatRequest['messages'], context: cleanContext(body.context) };
  const deps = { ai: env.AI, model: env.CHAT_MODEL, tools: makeToolCtx(request, env, (p) => waitUntil(p)), env };

  // Streaming transport: newline-delimited JSON — `{"t":"status","text":…}` while it works, then one `{"t":"done","res":ChatResponse}`.
  if ((request.headers.get('Accept') ?? '').includes('application/x-ndjson')) {
    const { readable, writable } = new TransformStream<Uint8Array>();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    const send = (o: unknown) => w.write(enc.encode(`${JSON.stringify(o)}\n`)).catch(() => {});
    const job = (async () => {
      const res = await runChat(input, { ...deps, onStatus: (text) => void send({ t: 'status', text }) }).catch((e): ChatResponse => ({ ok: false, code: 'model_error', message: e instanceof Error ? e.message : 'Unexpected error.' }));
      await send({ t: 'done', res });
      await w.close().catch(() => {});
    })();
    waitUntil(job);
    return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', ...CORS } });
  }

  const out = await runChat(input, deps);
  return reply(out, out.ok ? 200 : out.code === 'bad_request' ? 400 : 200);
};
