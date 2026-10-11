/**
 * Thin wrapper over Workers AI chat models that speaks OpenAI-style messages and tool calls.
 * Models differ in response shape (OpenAI `choices[]` vs Workers' legacy `{response, tool_calls}`), so both are normalised.
 */
import type { ChatMessage, ToolCall } from '../../shared/agent/types';

export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

export interface ModelResult {
  content: string;
  toolCalls: ToolCall[];
  promptTokens: number;
  completionTokens: number;
  /** Neurons Workers AI says this call cost (usage.neurons), when reported — exact, unlike our per-model estimate. */
  neurons?: number;
}

export class ModelError extends Error {
  /** quota: Workers AI's daily allocation is spent · rate: a provider 429 (retry after `retryAfter` s) · auth: a rejected API key. */
  constructor(message: string, readonly kind: 'quota' | 'rate' | 'auth' | 'other' = 'other', readonly retryAfter?: number) {
    super(message);
  }
}

// Qwen3-30B-A3B: ~half Gemma 4's input price ($0.051 vs $0.100 per M tokens), native function calling, and its thinking mode
// can be switched off per call. Gemma 4 is the single fallback if Qwen errors.
export const DEFAULT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const FALLBACK_MODEL = '@cf/google/gemma-4-26b-a4b-it';

const asObj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {});

/** Remove reasoning blocks some models inline into their answer. */
export const stripThinking = (s: string): string => s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<\|channel\|>analysis[\s\S]*?<\|end\|>/g, '').trim();

let idn = 0;
const newId = () => `call_${Date.now().toString(36)}${(idn++).toString(36)}`;

function toToolCall(raw: unknown): ToolCall | null {
  const o = asObj(raw);
  const fn = asObj(o.function);
  const name = typeof fn.name === 'string' ? fn.name : typeof o.name === 'string' ? o.name : '';
  if (!name) return null;
  const args = fn.arguments ?? o.arguments ?? o.parameters ?? {};
  // Gemini 3 (OpenAI-compatible endpoint) attaches an opaque thought signature that must be echoed back with the call.
  const extra = o.extra_content && JSON.stringify(o.extra_content).length < 4000 ? { extra_content: o.extra_content } : {};
  return { id: typeof o.id === 'string' && o.id ? o.id : newId(), type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) }, ...extra };
}

/**
 * Qwen3 on Workers AI sometimes emits its call as text — `<tool_call>{"name":…,"arguments":{…}}</tool_call>` — in the content or
 * (with thinking off) in the reasoning field, leaving `tool_calls` empty. Recover those so the loop still runs the tool.
 */
const TOOL_BLOCK = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/gi;
export function textToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = [];
  for (const m of text.matchAll(TOOL_BLOCK)) {
    try {
      const c = toToolCall(JSON.parse(m[1]));
      if (c) out.push(c);
    } catch {
      /* not JSON: ignore */
    }
  }
  return out;
}
const stripToolText = (s: string) => s.replace(TOOL_BLOCK, '').replace(/<\/?tools?>/gi, '').trim();

export function normalise(raw: unknown): ModelResult {
  const o = asObj(raw);
  const usage = asObj(o.usage);
  const promptTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
  const completionTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
  const choice = asObj(Array.isArray(o.choices) ? o.choices[0] : undefined);
  const msg = asObj(choice.message);
  const contentRaw = msg.content ?? o.response ?? o.result ?? '';
  const content = typeof contentRaw === 'string' ? contentRaw : Array.isArray(contentRaw) ? contentRaw.map((p) => asObj(p).text ?? '').join('') : '';
  const rawCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : Array.isArray(o.tool_calls) ? o.tool_calls : []) as unknown[];
  const neurons = Number(usage.neurons);
  let toolCalls = rawCalls.map(toToolCall).filter((c): c is ToolCall => !!c);
  if (!toolCalls.length) {
    const reasoning = [msg.reasoning_content, msg.reasoning].find((x) => typeof x === 'string') as string | undefined;
    toolCalls = textToolCalls(`${content}\n${reasoning ?? ''}`);
  }
  return { content: stripToolText(stripThinking(content)), toolCalls, promptTokens, completionTokens, ...(Number.isFinite(neurons) && neurons > 0 ? { neurons } : {}) };
}

/** Only the "you've used the day's free neurons" family — a transient 429 or a subrequest limit must not switch the AI off for the day. */
const QUOTA = /daily free allocation|free allocation|4006|used up your/i;

export async function runModel(ai: AiBinding, model: string, messages: ChatMessage[], system: string, tools: ModelTool[], maxTokens = 900, think = false): Promise<ModelResult> {
  const qwen = model.includes('qwen3');
  const convo = messages.map((m) => ({ ...m, content: m.content ?? '' }));
  // Qwen3's soft switch: "/no_think" in the newest user turn. (chat_template_kwargs.enable_thinking=false makes Workers AI skip its
  // tool-call parser, so calls come back as raw text — measured Oct 2026.)
  if (qwen && !think) {
    const i = convo.map((m) => m.role).lastIndexOf('user');
    if (i >= 0) convo[i] = { ...convo[i], content: `${convo[i].content} /no_think` };
  }
  const input: Record<string, unknown> = {
    messages: [{ role: 'system', content: system }, ...convo],
    max_completion_tokens: maxTokens,
    temperature: 0.2,
  };
  // Gemma 4 "thinks" before answering by default: ~3× slower (measured: 2.7 s vs 0.85 s for the same tool call). Choosing a tool
  // doesn't need it, but reading tool results back to the user does — with thinking off it once reported a +EV result as "not +EV".
  if (model.includes('gemma-4')) input.chat_template_kwargs = { enable_thinking: think };
  if (tools.length) Object.assign(input, { tools, tool_choice: 'auto' });
  try {
    return normalise(await ai.run(model, input));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ModelError(msg, QUOTA.test(msg) ? 'quota' : 'other');
  }
}
