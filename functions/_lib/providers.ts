/**
 * OpenAI-compatible chat providers used besides Workers AI: Groq, Google Gemini, Cerebras and OpenRouter.
 *
 * Two ways in:
 *  - the visitor's own key (BYOK): pasted in the chat settings, kept in their browser, sent per request in `X-AI-Key` /
 *    `X-AI-Provider` headers and used for that request only (never stored or logged). It costs the site nothing and skips the
 *    shared neuron budget.
 *  - site fallbacks: when Workers AI's free neurons are spent the loop falls through to any provider whose key is set as a
 *    Pages secret (GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY). Each is a free tier with its own allowance.
 *
 * Free tiers change; model lists live here in one place. A route that answers 429 is parked until its Retry-After (per isolate).
 */
import type { ChatMessage } from '../../shared/agent/types';
import { ModelError, normalise, type ModelResult, type ModelTool } from './llm';

export type ProviderId = 'groq' | 'gemini' | 'cerebras' | 'openrouter';

export interface ProviderSpec {
  id: ProviderId;
  label: string;
  base: string;
  /**
   * Tried in order: the best model that is cheap/free and has a long context (all ≥ 64k; our prompts are ~3–6k tokens), then others.
   * Each model has its own rate limit on these services, so a second model adds free allowance. Verified Oct 2026 — Groq against
   * the account's own limits page (llama-3.3-70b is no longer offered), Cerebras docs, OpenRouter's /models API, Gemini pricing page.
   */
  models: string[];
  secret: 'GROQ_API_KEY' | 'GEMINI_API_KEY' | 'CEREBRAS_API_KEY' | 'OPENROUTER_API_KEY';
  /** Where a visitor creates a free key. */
  keyUrl: string;
  /** Free tier may use prompts to improve the provider's products. */
  trainsOnFreeTier?: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderSpec> = {
  groq: { id: 'groq', label: 'Groq', base: 'https://api.groq.com/openai/v1', models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'], secret: 'GROQ_API_KEY', keyUrl: 'https://console.groq.com/keys' },
  cerebras: { id: 'cerebras', label: 'Cerebras', base: 'https://api.cerebras.ai/v1', models: ['gpt-oss-120b', 'qwen-3.8-27b'], secret: 'CEREBRAS_API_KEY', keyUrl: 'https://cloud.cerebras.ai' },
  openrouter: { id: 'openrouter', label: 'OpenRouter', base: 'https://openrouter.ai/api/v1', models: ['nvidia/nemotron-3-super-120b-a12b:free', 'google/gemma-4-31b-it:free'], secret: 'OPENROUTER_API_KEY', keyUrl: 'https://openrouter.ai/keys' },
  gemini: { id: 'gemini', label: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'], secret: 'GEMINI_API_KEY', keyUrl: 'https://aistudio.google.com/apikey', trainsOnFreeTier: true },
};

/** Order the site falls back in: no-training providers first, Gemini (free tier may train on prompts) last. */
export const FALLBACK_ORDER: ProviderId[] = ['groq', 'cerebras', 'openrouter', 'gemini'];

/** The only providers a visitor can bring a key for. */
export const BYOK_PROVIDERS: ProviderId[] = ['groq', 'gemini'];

export interface Route {
  provider: ProviderId;
  model: string;
  apiKey: string;
  byok: boolean;
}

export type ProviderEnv = Partial<Record<ProviderSpec['secret'], string>> & { PROVIDER_FALLBACKS?: string };

/** Sanity-check a pasted key before it goes anywhere: printable, no spaces, plausible length. */
export const plausibleKey = (k: string): boolean => /^[\w.\-]{16,200}$/.test(k);

export const isProviderId = (x: unknown): x is ProviderId => typeof x === 'string' && x in PROVIDERS;

/** Routes for the visitor's own key (empty when they sent none, or a malformed one). */
export function byokRoutes(req: Request): Route[] {
  const provider = req.headers.get('X-AI-Provider')?.toLowerCase();
  const key = req.headers.get('X-AI-Key')?.trim() ?? '';
  if (!isProviderId(provider) || !BYOK_PROVIDERS.includes(provider) || !plausibleKey(key)) return [];
  return PROVIDERS[provider].models.map((model) => ({ provider, model, apiKey: key, byok: true }));
}

/** Routes for the keys configured on the site, in fallback order (`PROVIDER_FALLBACKS=groq,cerebras` can narrow/reorder; `off` disables). */
export function siteRoutes(env: ProviderEnv): Route[] {
  const raw = (env.PROVIDER_FALLBACKS ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'none') return [];
  const order = raw ? (raw.split(/[\s,]+/).filter(isProviderId) as ProviderId[]) : FALLBACK_ORDER;
  return order.flatMap((id) => {
    const key = env[PROVIDERS[id].secret]?.trim();
    return key ? PROVIDERS[id].models.map((model) => ({ provider: id, model, apiKey: key, byok: false })) : [];
  });
}

/* ------------------------------ cooldowns -------------------------------- */

const parked = new Map<string, number>();
const routeKey = (r: Route) => `${r.byok ? 'u' : 's'}:${r.provider}:${r.model}:${r.apiKey.slice(-6)}`;
export const isParked = (r: Route, now = Date.now()) => (parked.get(routeKey(r)) ?? 0) > now;
export const park = (r: Route, seconds: number, now = Date.now()) => void parked.set(routeKey(r), now + Math.min(Math.max(seconds, 5), 6 * 3600) * 1000);
export const resetParked = () => parked.clear();

/* -------------------------------- calling -------------------------------- */

const asKB = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Providers reject unknown fields differently, so only send what each is known to accept. */
function body(r: Route, messages: ChatMessage[], system: string, tools: ModelTool[], maxTokens: number, think: boolean): Record<string, unknown> {
  const gemini = r.provider === 'gemini';
  const msgs = [
    { role: 'system', content: system },
    ...messages.map((m) => {
      const out: Record<string, unknown> = { ...m, content: m.content ?? '' };
      if (m.tool_calls) {
        out.tool_calls = m.tool_calls.map((c) => ({
          ...c,
          // Gemini 3 insists on a signature for each function call; history that came from another model has none, so use Google's documented bypass.
          ...(gemini && !c.extra_content ? { extra_content: { google: { thought_signature: 'skip_thought_signature_validator' } } } : {}),
        }));
      }
      if (!gemini) for (const c of (out.tool_calls as Array<Record<string, unknown>> | undefined) ?? []) delete c.extra_content;
      return out;
    }),
  ];
  const b: Record<string, unknown> = { model: r.model, messages: msgs, max_tokens: maxTokens, temperature: 0.2 };
  if (tools.length) Object.assign(b, { tools, tool_choice: 'auto' });
  if (gemini) b.reasoning_effort = think ? 'medium' : 'low';
  else if (r.model.includes('gpt-oss')) b.reasoning_effort = think ? 'medium' : 'low';
  return b;
}

export async function runRoute(r: Route, messages: ChatMessage[], system: string, tools: ModelTool[], maxTokens: number, think: boolean): Promise<ModelResult> {
  const spec = PROVIDERS[r.provider];
  let res: Response;
  try {
    res = await fetch(`${spec.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${r.apiKey}` },
      body: JSON.stringify(body(r, messages, system, tools, maxTokens + (think ? 800 : 0), think)),
      signal: AbortSignal.timeout(28_000),
    });
  } catch (e) {
    throw new ModelError(`${spec.label} did not respond (${e instanceof Error ? e.name : 'network error'}).`, 'other');
  }
  if (res.ok) {
    const j = (await res.json().catch(() => null)) as unknown;
    return normalise(j);
  }
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string }[] | { error?: { message?: string } | string; message?: string };
    const o = (Array.isArray(j) ? j[0] : j) ?? {};
    detail = typeof o.error === 'string' ? o.error : o.error?.message ?? o.message ?? text;
  } catch {
    /* keep the raw text */
  }
  const msg = `${spec.label} ${res.status}: ${asKB(detail)}`.replace(r.apiKey, '•••');
  if (res.status === 401 || res.status === 403 || (res.status === 400 && /api key|api_key|invalid key|permission denied/i.test(detail))) throw new ModelError(msg, 'auth');
  // a retired / not-offered model: stop asking for it for a while instead of failing every request first
  if (res.status === 404 || (res.status === 400 && /model/i.test(detail) && /not found|does not exist|decommission|no longer|not supported|unavailable|no access|not available/i.test(detail))) throw new ModelError(msg, 'other', 6 * 3600);
  if (res.status === 429 || res.status === 402) {
    const ra = Number(res.headers.get('retry-after'));
    throw new ModelError(msg, 'rate', Number.isFinite(ra) && ra > 0 ? ra : /per day|daily|RPD|TPD/i.test(detail) ? 3600 : 60);
  }
  throw new ModelError(msg, 'other');
}
