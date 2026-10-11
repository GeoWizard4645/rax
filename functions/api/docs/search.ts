/**
 * Docs search without the AI  —  GET /api/docs/search?q=…&limit=4&source=real-docs|rax-docs|site-guide
 * BM25 over Real's public docs + this site's notes. Used by the assistant's offline helper when the day's free AI allowance is spent.
 */
import { makeKb } from '../../_lib/kb';
import { err, json, preflight } from '../../_lib/http';
import { rateLimit } from '../../_lib/ratelimit';
import type { AssetsEnv } from '../../_lib/kb';

export const onRequest: PagesFunction<AssetsEnv> = async ({ request, env }) => {
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'GET only.');
  const u = new URL(request.url);
  const q = (u.searchParams.get('q') ?? '').slice(0, 300).trim();
  if (q.length < 2) return err(400, 'bad_query', 'Pass ?q= with at least 2 characters.');
  const rl = await rateLimit(request, 'docs', 60, 600);
  if (!rl.allowed) return err(429, 'rate_limited', `Try again in ${rl.retryAfter}s.`, { retryAfter: rl.retryAfter });
  const src = u.searchParams.get('source');
  const source = src === 'real-docs' || src === 'rax-docs' || src === 'site-guide' ? src : undefined;
  const limit = Math.min(8, Math.max(1, Number(u.searchParams.get('limit')) || 4));
  const hits = await makeKb(env, u.origin).search(q, limit, { source });
  return json({ query: q, results: hits.map((h) => ({ title: h.docTitle, section: h.heading, source: h.source, url: h.url, text: h.text })) }, 200, { 'Cache-Control': 'public, max-age=300' });
};
