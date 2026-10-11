/**
 * The $0 guarantee for the assistant. Workers AI gives 10,000 neurons/day free; on a Workers *Paid* plan anything above
 * that is billed. We therefore keep our own running count of neurons (estimated from each response's token usage and the
 * published per-model rates) and stop calling the model once it reaches AI_DAILY_NEURONS (default 8,000 — headroom for the
 * other things the account might run). The count lives in KV under a per-UTC-day key (one write per model call; the free tier
 * allows ~1,000 writes/day and a call costs ≥ ~15 neurons, so the cap itself bounds the writes).
 */

/** Neurons per million tokens (https://developers.cloudflare.com/workers-ai/platform/pricing/, Oct 2026). */
export const NEURON_RATES: Record<string, { in: number; out: number }> = {
  '@cf/google/gemma-4-26b-a4b-it': { in: 9091, out: 27273 },
  '@cf/openai/gpt-oss-20b': { in: 18182, out: 27273 },
  '@cf/openai/gpt-oss-120b': { in: 31818, out: 68182 },
  '@cf/qwen/qwen3-30b-a3b-fp8': { in: 4625, out: 30475 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { in: 31876, out: 50488 },
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast': { in: 26668, out: 204805 },
  '@cf/meta/llama-3.1-8b-instruct-fp8': { in: 13778, out: 26128 },
};
const UNKNOWN_RATE = { in: 40000, out: 250000 }; // pessimistic for a model we have no price for

export const estimateNeurons = (model: string, promptTokens: number, completionTokens: number): number => {
  const r = NEURON_RATES[model] ?? UNKNOWN_RATE;
  return (promptTokens * r.in + completionTokens * r.out) / 1_000_000;
};

export const DEFAULT_DAILY_CAP = 8000;
/** A call is refused when fewer than this many neurons of headroom remain (one worst-case tool-loop iteration). */
export const RESERVE = 120;

export interface BudgetEnv {
  CACHE?: KVNamespace;
  AI_DAILY_NEURONS?: string;
}

const dayKey = (now = Date.now()) => `ai:neurons:${new Date(now).toISOString().slice(0, 10)}`;
const memory = new Map<string, number>(); // used when KV is unbound, and as a per-isolate floor
// KV's free tier allows ~1,000 writes/day, shared with the market-history recorders — so counts are flushed in batches, not per call.
const FLUSH_NEURONS = 30;
const FLUSH_EVERY_MS = 60_000;
const unflushed = new Map<string, number>();
const lastFlush = new Map<string, number>();

export const capOf = (env: BudgetEnv): number => {
  const n = Number(env.AI_DAILY_NEURONS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
};

export async function used(env: BudgetEnv, now = Date.now()): Promise<number> {
  const k = dayKey(now);
  let kv = 0;
  try {
    kv = Number(await env.CACHE?.get(k)) || 0;
  } catch {
    /* KV hiccup: fall back to the isolate's own count */
  }
  return Math.max(kv, memory.get(k) ?? 0);
}

export async function record(env: BudgetEnv, neurons: number, now = Date.now(), force = false): Promise<number> {
  const k = dayKey(now);
  const next = (await used(env, now)) + neurons;
  memory.set(k, next);
  for (const old of [...memory.keys()]) if (old !== k) (memory.delete(old), unflushed.delete(old), lastFlush.delete(old));
  const pending = (unflushed.get(k) ?? 0) + neurons;
  if (force || pending >= FLUSH_NEURONS || now - (lastFlush.get(k) ?? 0) > FLUSH_EVERY_MS) {
    try {
      await env.CACHE?.put(k, String(Math.round(next * 10) / 10), { expirationTtl: 2 * 86400 });
    } catch {
      /* over the KV write quota: the in-memory floor still protects this isolate */
    }
    unflushed.set(k, 0);
    lastFlush.set(k, now);
  } else unflushed.set(k, pending);
  return next;
}

export async function remaining(env: BudgetEnv, now = Date.now()): Promise<{ left: number; frac: number }> {
  const cap = capOf(env);
  const u = await used(env, now);
  return { left: Math.max(0, cap - u), frac: Math.max(0, Math.min(1, (cap - u) / cap)) };
}

/** Mark today's allowance as spent (Workers AI itself said so). */
export async function exhaust(env: BudgetEnv, now = Date.now()): Promise<void> {
  const { left } = await remaining(env, now);
  await record(env, left + 1, now, true);
}

export const testing = { reset: () => (memory.clear(), unflushed.clear(), lastFlush.clear()) };
