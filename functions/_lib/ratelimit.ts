/**
 * Soft per-client rate limit on the Cache API (free, no write quota). Counters live per data centre, so this is a speed
 * bump against loops and casual abuse, not an exact quota — the hard $0 guarantee for AI is the neuron budget in llm.ts.
 */
const store = (): Cache | null => {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null;
  } catch {
    return null;
  }
};

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window rolls over. */
  retryAfter: number;
}

export const clientId = (req: Request): string => req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'anon';

export async function rateLimit(req: Request, bucket: string, limit: number, windowSec: number): Promise<LimitResult> {
  const c = store();
  if (!c) return { allowed: true, remaining: limit, retryAfter: 0 };
  const now = Math.floor(Date.now() / 1000);
  const win = Math.floor(now / windowSec);
  const key = new Request(`https://rl.rax.internal/${bucket}/${encodeURIComponent(clientId(req))}/${win}`);
  try {
    const hit = await c.match(key);
    const n = hit ? Number(await hit.text()) || 0 : 0;
    const retryAfter = windowSec - (now % windowSec);
    if (n >= limit) return { allowed: false, remaining: 0, retryAfter };
    await c.put(key, new Response(String(n + 1), { headers: { 'Cache-Control': `max-age=${retryAfter}` } }));
    return { allowed: true, remaining: limit - n - 1, retryAfter };
  } catch {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
}
