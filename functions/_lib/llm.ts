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
}

export class ModelError extends Error {
  constructor(message: string, readonly kind: 'quota' | 'other' = 'other') {
    super(message);
  }
}

export const DEFAULT_MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const FALLBACK_MODEL = '@cf/openai/gpt-oss-20b';

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
  return { id: typeof o.id === 'string' && o.id ? o.id : newId(), type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } };
}

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
  return { content: stripThinking(content), toolCalls: rawCalls.map(toToolCall).filter((c): c is ToolCall => !!c), promptTokens, completionTokens };
}

const QUOTA = /(daily|free)\s+(free\s+)?allocation|4006|neurons|quota|exceeded.*limit/i;

export async function runModel(ai: AiBinding, model: string, messages: ChatMessage[], system: string, tools: ModelTool[], maxTokens = 900): Promise<ModelResult> {
  const input: Record<string, unknown> = {
    messages: [{ role: 'system', content: system }, ...messages.map((m) => ({ ...m, content: m.content ?? '' }))],
    max_completion_tokens: maxTokens,
    temperature: 0.2,
  };
  if (tools.length) Object.assign(input, { tools, tool_choice: 'auto' });
  try {
    return normalise(await ai.run(model, input));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ModelError(msg, QUOTA.test(msg) ? 'quota' : 'other');
  }
}
