/**
 * The assistant's server loop, free of HTTP so it can be tested with a fake model.
 *
 *   browser ──(history + what's on screen)──▶ here ──▶ Workers AI
 *                                              │   ◀── tool calls
 *     server tools (docs, maths, live data) run here and loop back into the model;
 *     page tools (navigate / set_params / …) are handed to the browser, which runs them and calls again.
 */
import { buildSystemPrompt, type Passage } from '../../shared/agent/prompt';
import { CLIENT_TOOL_NAMES, CLIENT_TOOLS } from '../../shared/agent/clientTools';
import { runTool, TOOLS, type ToolCtx } from '../../shared/agent/tools';
import type { ChatMessage, ChatRequest, ChatResponse, ToolCall } from '../../shared/agent/types';
import { estimateNeurons, exhaust, record, remaining, RESERVE, type BudgetEnv } from './budget';
import { DEFAULT_MODEL, FALLBACK_MODEL, ModelError, runModel, type AiBinding, type ModelTool } from './llm';

export const MAX_ITERATIONS = 4;
const MAX_HISTORY = 14;
const LIMITS = { user: 2000, assistant: 3000, tool: 3500 } as const;

const asString = (x: unknown) => (typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x));

/** Never trust the history the browser sends: roles, sizes and tool-call pairing are all re-checked. */
export function sanitizeMessages(input: unknown): ChatMessage[] {
  if (!Array.isArray(input)) return [];
  const msgs: ChatMessage[] = [];
  for (const raw of input.slice(-60)) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    if (m.role === 'user') msgs.push({ role: 'user', content: asString(m.content).slice(0, LIMITS.user) });
    else if (m.role === 'assistant') {
      const calls = Array.isArray(m.tool_calls)
        ? (m.tool_calls as unknown[]).flatMap((c): ToolCall[] => {
            const o = (c ?? {}) as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
            return typeof o.id === 'string' && typeof o.function?.name === 'string'
              ? [{ id: o.id.slice(0, 80), type: 'function', function: { name: o.function.name.slice(0, 60), arguments: asString(o.function.arguments).slice(0, 4000) } }]
              : [];
          })
        : [];
      msgs.push({ role: 'assistant', content: asString(m.content).slice(0, LIMITS.assistant), ...(calls.length ? { tool_calls: calls } : {}) });
    } else if (m.role === 'tool' && typeof m.tool_call_id === 'string') {
      msgs.push({ role: 'tool', tool_call_id: m.tool_call_id.slice(0, 80), name: typeof m.name === 'string' ? m.name.slice(0, 60) : undefined, content: asString(m.content).slice(0, LIMITS.tool) });
    }
    // anything else — in particular a 'system' message from the browser — is dropped
  }
  // tool-call pairing: an assistant message keeps its tool_calls only if every call is answered right after it
  const out: ChatMessage[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'tool') continue; // handled with its assistant message; orphans are dropped
    if (m.role === 'assistant' && m.tool_calls) {
      const answers: ChatMessage[] = [];
      for (let j = i + 1; j < msgs.length && msgs[j].role === 'tool'; j++) answers.push(msgs[j]);
      const ids = new Set(answers.map((a) => a.tool_call_id));
      if (m.tool_calls.every((c) => ids.has(c.id))) {
        out.push(m, ...answers.filter((a) => m.tool_calls!.some((c) => c.id === a.tool_call_id)));
      } else if (m.content) out.push({ role: 'assistant', content: m.content });
      continue;
    }
    out.push(m);
  }
  // window: start on a user turn
  let start = Math.max(0, out.length - MAX_HISTORY);
  while (start < out.length && out[start].role !== 'user') start++;
  return out.slice(start);
}

const toModelTool = (name: string, description: string, parameters: unknown): ModelTool => ({ type: 'function', function: { name, description, parameters } });
const MODEL_TOOLS: ModelTool[] = [
  ...TOOLS.filter((t) => t.chat).map((t) => toModelTool(t.name, t.chatDescription ?? t.description, t.inputSchema)),
  ...CLIENT_TOOLS.map((t) => toModelTool(t.name, t.description, t.inputSchema)),
];
const SERVER_TOOL_NAMES = new Set(TOOLS.filter((t) => t.chat).map((t) => t.name));

export interface ChatDeps {
  ai: AiBinding;
  model?: string;
  tools: ToolCtx;
  env: BudgetEnv;
  now?: number;
  /** Progress hook for the streaming transport ("Searching the docs…"). */
  onStatus?: (text: string) => void;
}

const STATUS: Record<string, string> = {
  search_docs: 'Searching the docs…', otd_payout: 'Calculating the OTD payout…', otd_top_cards: 'Ranking OTD cards…', otd_rules: 'Looking up the card rules…',
  ev_calc: 'Computing EV…', odds_convert: 'Converting odds…', devig: 'Removing the vig…', live_odds: 'Fetching live odds…', schedule: 'Fetching the schedule…',
  rateboard_owed: 'Pricing the card…', calculate: 'Calculating…',
};

const GREETING = /^\s*(hi|hello|hey|yo|thanks|thank you|ok|okay|cool|nice|help)\b[\s!.?]*$/i;
/** Pure page commands ("set budget to 50k", "open the calendar") don't need doc passages — skipping them saves ~600 prompt tokens. */
const COMMAND = /^\s*(please\s+)?(set|change|make|switch|update|use|put|adjust|open|go to|take me|navigate|show me|undo|reset|raise|lower|increase|decrease)\b/i;

async function passagesFor(req: ChatRequest, msgs: ChatMessage[], ctx: ToolCtx): Promise<Passage[]> {
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user' || !last.content || GREETING.test(last.content) || (COMMAND.test(last.content) && !/\b(why|how|what|explain|tell me|\?)/i.test(last.content))) return [];
  const hits = await ctx.kb.search(`${last.content.slice(0, 300)} ${req.context.route.replace(/\//g, ' ')}`, 3).catch(() => []);
  return hits.map((h) => ({ title: h.docTitle, heading: h.heading, url: h.url, text: h.text }));
}

/** `{"a":1}` → [{a:1}];  `{"a":1}{"a":2}` → two objects; anything else → null. */
export function parseArgs(raw: string): unknown[] | null {
  if (!raw || !raw.trim()) return [{}];
  try {
    return [JSON.parse(raw)];
  } catch {
    const parts = raw.trim().replace(/\}\s*\{/g, '}\u0000{').split('\u0000');
    if (parts.length < 2 || parts.length > 4) return null;
    try {
      return parts.map((p) => JSON.parse(p));
    } catch {
      return null;
    }
  }
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…(truncated)` : s);

export async function runChat(req: ChatRequest, deps: ChatDeps): Promise<ChatResponse> {
  const now = deps.now ?? Date.now();
  const history = sanitizeMessages(req.messages);
  if (!history.length || history[history.length - 1].role === 'assistant') return { ok: false, code: 'bad_request', message: 'Send a user message.' };

  let model = deps.model || DEFAULT_MODEL;
  const system = buildSystemPrompt(req.context, await passagesFor(req, history, deps.tools));
  const added: ChatMessage[] = [];
  let usedFallback = false;

  const budgetLeft = async () => (await remaining(deps.env, now)).frac;
  const done = async (type: 'message' | 'tool_calls', calls?: ToolCall[]): Promise<ChatResponse> => ({ ok: true, type, messages: added, ...(calls ? { calls } : {}), model, budgetLeft: Math.round((await budgetLeft()) * 100) / 100 });

  for (let iter = 0; iter < MAX_ITERATIONS + 1; iter++) {
    const { left } = await remaining(deps.env, now);
    if (left < RESERVE) return { ok: false, code: 'budget', message: "Today's free AI allowance is used up — it resets at 00:00 UTC." };
    const final = iter === MAX_ITERATIONS; // out of tool rounds: force a plain answer
    let res;
    deps.onStatus?.(iter === 0 ? 'Thinking…' : 'Putting it together…');
    const convo = [...history, ...added];
    let think = false;
    try {
      // Reasoning stays ON except for pure page commands / greetings: with it off the model once quoted a wrong multiplier from a
      // retrieved passage and once reported a +EV result as "not +EV". The cost is ~2 s and ~3 neurons per call.
      const last = convo[convo.length - 1];
      const lite = last?.role === 'user' && (COMMAND.test(last.content ?? '') || GREETING.test(last.content ?? '')) && !/\b(why|how|what|explain|tell me|\?)/i.test(last.content ?? '');
      think = final || !lite;
      res = await runModel(deps.ai, model, convo, final ? `${system}\n\nAnswer now using what you have; do not call tools.` : system, final ? [] : MODEL_TOOLS, think ? 1500 : 900, think);
    } catch (e) {
      if (e instanceof ModelError && e.kind === 'quota') {
        await exhaust(deps.env, now);
        return { ok: false, code: 'budget', message: "Today's free AI allowance is used up — it resets at 00:00 UTC." };
      }
      if (!usedFallback && model !== FALLBACK_MODEL) {
        usedFallback = true;
        model = FALLBACK_MODEL;
        iter--;
        continue;
      }
      return { ok: false, code: 'model_error', message: `The AI model failed: ${e instanceof Error ? clip(e.message, 200) : 'unknown error'}` };
    }
    await record(deps.env, res.neurons ?? estimateNeurons(model, res.promptTokens, res.completionTokens), now);
    if (!res.toolCalls.length && !res.content && think) {
      // the reasoning ate the whole token budget and nothing was said: ask once more with reasoning off
      deps.onStatus?.('Putting it together…');
      try {
        res = await runModel(deps.ai, model, convo, final ? `${system}\n\nAnswer now using what you have; do not call tools.` : system, final ? [] : MODEL_TOOLS, 900, false);
        await record(deps.env, res.neurons ?? estimateNeurons(model, res.promptTokens, res.completionTokens), now);
      } catch {
        /* fall through to the generic reply below */
      }
    }

    if (!res.toolCalls.length || final) {
      added.push({ role: 'assistant', content: res.content || "I couldn't put together an answer — could you rephrase?" });
      return done('message');
    }

    added.push({ role: 'assistant', content: res.content, tool_calls: res.toolCalls });
    const pageCalls: ToolCall[] = [];
    for (const call of res.toolCalls) {
      const name = call.function.name;
      if (CLIENT_TOOL_NAMES.has(name)) {
        pageCalls.push(call);
        continue;
      }
      let result: unknown;
      deps.onStatus?.(STATUS[name] ?? `Running ${name}…`);
      if (!SERVER_TOOL_NAMES.has(name)) result = { error: `Unknown tool "${name}".` };
      else {
        const argsList = parseArgs(call.function.arguments);
        if (!argsList) result = { error: 'Tool arguments were not valid JSON.' };
        else {
          // some models emit parallel calls glued into one arguments string: run each and return the list
          const outs = await Promise.all(argsList.map((a) => runTool(name, a, deps.tools)));
          const vals = outs.map((o) => (o.ok ? o.result : { error: o.error }));
          result = vals.length === 1 ? vals[0] : { results: vals };
        }
      }
      added.push({ role: 'tool', tool_call_id: call.id, name, content: clip(JSON.stringify(result), LIMITS.tool) });
    }
    if (pageCalls.length) return done('tool_calls', pageCalls);
  }
  return done('message');
}
