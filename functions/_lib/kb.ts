/**
 * Knowledge-base access for the edge: the index and shards are static assets (public/data/kb/*), read through the Pages
 * ASSETS binding and cached per isolate. Tools see only the KbAccess interface, so tests can pass an in-memory one.
 */
import { searchIndex, type KbDocMeta, type KbIndex } from '../../shared/agent/kbCore';
import type { KbAccess, KbDocText, KbHitText, OtdIndex } from '../../shared/agent/tools';

export interface AssetsEnv {
  ASSETS?: { fetch: (req: Request | string) => Promise<Response> };
}

/** The SPA fallback (`/* → /index.html 200`) answers unknown asset paths with HTML — treat anything but JSON as "missing". */
async function assetJson<T>(env: AssetsEnv, origin: string, path: string): Promise<T | null> {
  try {
    const url = new URL(path, origin).toString();
    const res = env.ASSETS ? await env.ASSETS.fetch(new Request(url)) : await fetch(url);
    if (!res.ok || !/json/i.test(res.headers.get('content-type') ?? '')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

let indexCache: { origin: string; at: number; value: KbIndex } | null = null;
let otdCache: { origin: string; at: number; value: OtdIndex } | null = null;
const shardCache = new Map<string, string[]>();
const FRESH_MS = 10 * 60_000;

export function makeKb(env: AssetsEnv, origin: string): KbAccess {
  const index = async (): Promise<KbIndex | null> => {
    if (indexCache && indexCache.origin === origin && Date.now() - indexCache.at < FRESH_MS) return indexCache.value;
    const v = await assetJson<KbIndex>(env, origin, '/data/kb/index.json');
    if (v) indexCache = { origin, at: Date.now(), value: v };
    return v ?? indexCache?.value ?? null;
  };
  const shard = async (id: string): Promise<string[] | null> => {
    const key = `${origin}|${id}`;
    const hit = shardCache.get(key);
    if (hit) return hit;
    const v = await assetJson<string[]>(env, origin, `/data/kb/${encodeURIComponent(id)}.json`);
    if (v) {
      if (shardCache.size > 40) shardCache.delete(shardCache.keys().next().value as string);
      shardCache.set(key, v);
    }
    return v;
  };
  return {
    async search(query, limit, opts = {}) {
      const idx = await index();
      if (!idx) return [];
      const hits = searchIndex(idx, query, limit, { source: opts.source });
      const out: KbHitText[] = [];
      await Promise.all(
        hits.map(async (h, i) => {
          const chunks = await shard(h.shard);
          const text = chunks?.[h.index];
          if (text) out[i] = { doc: h.doc, docTitle: h.docTitle, heading: h.heading, url: h.url, source: h.source, score: Math.round(h.score * 100) / 100, text };
        }),
      );
      return out.filter(Boolean);
    },
    async docs(): Promise<KbDocMeta[]> {
      return (await index())?.docs ?? [];
    },
    async read(docId): Promise<KbDocText | null> {
      const idx = await index();
      const meta = idx?.docs.find((d) => d.id === docId);
      if (!meta) return null;
      const chunks = await shard(meta.id);
      return chunks ? { meta, chunks } : null;
    },
    async otdIndex() {
      if (otdCache && otdCache.origin === origin && Date.now() - otdCache.at < FRESH_MS) return otdCache.value;
      const v = await assetJson<OtdIndex>(env, origin, '/data/otd-index.json');
      if (v) otdCache = { origin, at: Date.now(), value: v };
      return v ?? otdCache?.value ?? null;
    },
  };
}
