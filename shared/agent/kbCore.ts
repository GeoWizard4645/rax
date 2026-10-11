/**
 * Knowledge-base core for the assistant + MCP server: markdown chunking, a tiny tokenizer and BM25 over an inverted index.
 *
 * Self-contained on purpose (no relative imports) so the build script can run it straight under Node's type stripping
 * (`node scripts/build-kb.mjs`) and the edge can run the *same* tokenizer at query time — the index is only valid if both
 * sides tokenize identically.
 *
 * Why BM25 and not embeddings: it is free (Workers AI embeddings burn the 10,000-neuron daily allowance), deterministic,
 * and needs ~1 ms of CPU against a few hundred chunks. The index stores postings only; chunk text lives in per-document
 * shards (`/data/kb/<doc>.json`) that are fetched just for the handful of hits, so a cold isolate parses ~100 KB, not 600.
 */

export interface KbDocMeta {
  /** Stable slug, also the shard file name. */
  id: string;
  title: string;
  /** Where a human can read the original (Real's docs page, or the GitHub-hosted doc). */
  url: string;
  /** Which corpus: Real's own public docs, this repo's research notes, or the site guide. */
  source: 'real-docs' | 'rax-docs' | 'site-guide';
  /** Number of chunks in the shard. */
  chunks: number;
}

export interface KbIndex {
  v: 1;
  builtAt: string;
  docs: KbDocMeta[];
  /** Per chunk (global id = array position): [docIndex, chunkIndexInDoc, heading]. */
  meta: Array<[number, number, string]>;
  /** Token count per chunk (after weighting), for BM25 length normalisation. */
  len: number[];
  avgLen: number;
  /** term → [[chunkId, tf], …] */
  terms: Record<string, Array<[number, number]>>;
}

export interface KbHit {
  score: number;
  doc: string;
  docTitle: string;
  heading: string;
  url: string;
  source: KbDocMeta['source'];
  /** Global chunk id and the position inside the shard — used to fetch the text. */
  chunkId: number;
  shard: string;
  index: number;
}

/* ------------------------------ tokenizer ------------------------------ */

const STOP = new Set(
  ('a an and are as at be but by for from has have how i if in into is it its me my of on or our so than that the their them then there these they this to was we were what when where which who why will with you your can do does did not no ' +
    'about also any all just more most other some such very').split(' '),
);

/** Light plural/gerund stemmer — good enough for English docs, and identical on both sides of the index. */
export function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ed')) return w.slice(0, -2);
  return w;
}

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw || (raw.length < 2 && !/\d/.test(raw))) continue;
    if (STOP.has(raw)) continue;
    out.push(stem(raw));
  }
  return out;
}

/* ------------------------------- chunking ------------------------------ */

export interface RawChunk {
  heading: string;
  text: string;
}

const MAX_CHARS = 1100;
const MIN_CHARS = 260;

/** Split markdown into heading-scoped chunks of ~300 tokens. Headings are kept as breadcrumbs ("Player cards › Earn Rax"). */
export function chunkMarkdown(md: string, docTitle: string): RawChunk[] {
  const lines = md.replace(/\r/g, '').split('\n');
  const crumbs: string[] = [];
  const sections: Array<{ heading: string; body: string[] }> = [];
  let cur: { heading: string; body: string[] } = { heading: docTitle, body: [] };
  let fence = false;
  for (const line of lines) {
    if (/^```/.test(line)) fence = !fence;
    const h = !fence ? /^(#{1,4})\s+(.*\S)\s*$/.exec(line) : null;
    if (h) {
      sections.push(cur);
      const level = h[1].length;
      crumbs.length = Math.max(0, level - 1);
      crumbs[level - 1] = h[2].replace(/[*_`]/g, '').trim();
      const trail = crumbs.filter(Boolean);
      cur = { heading: trail.length && trail[0] !== docTitle ? [docTitle, ...trail].join(' › ') : trail.join(' › ') || docTitle, body: [] };
    } else cur.body.push(line);
  }
  sections.push(cur);

  const out: RawChunk[] = [];
  for (const s of sections) {
    const paras = s.body.join('\n').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    let buf = '';
    const flush = () => {
      if (buf.trim()) out.push({ heading: s.heading, text: buf.trim() });
      buf = '';
    };
    for (const p of paras) {
      if (p.length > MAX_CHARS) {
        // a very long paragraph / table: break on line (then sentence) boundaries
        flush();
        let piece = '';
        // sentence/line pieces, with any piece still over the limit hard-wrapped on whitespace
        const parts = p.split(/\n|(?<=[.!?])\s+/).flatMap((x) => (x.length > MAX_CHARS ? (x.match(new RegExp(`.{1,${MAX_CHARS}}(\\s|$)`, 'g')) ?? [x]) : [x]));
        for (const part of parts) {
          if (piece.length + part.length + 1 > MAX_CHARS && piece) {
            out.push({ heading: s.heading, text: piece.trim() });
            piece = '';
          }
          piece += `${piece ? '\n' : ''}${part}`;
        }
        if (piece.trim()) out.push({ heading: s.heading, text: piece.trim() });
        continue;
      }
      if (buf.length + p.length + 2 > MAX_CHARS) flush();
      buf += `${buf ? '\n\n' : ''}${p}`;
    }
    flush();
  }
  // fold tiny trailing chunks into the previous chunk of the same section
  const merged: RawChunk[] = [];
  for (const c of out) {
    const prev = merged[merged.length - 1];
    if (prev && prev.heading === c.heading && c.text.length < MIN_CHARS && prev.text.length + c.text.length < MAX_CHARS * 1.3) prev.text += `\n\n${c.text}`;
    else merged.push({ ...c });
  }
  return merged;
}

/* -------------------------------- indexing ----------------------------- */

export interface IndexedDoc {
  meta: Omit<KbDocMeta, 'chunks'>;
  chunks: RawChunk[];
}

/** Heading + title words count double: a chunk under "Rarity ladder" should win for "rarity ladder". */
const HEAD_WEIGHT = 2;

export function buildIndex(docs: IndexedDoc[], builtAt: string): { index: KbIndex; shards: Record<string, string[]> } {
  const metas: KbDocMeta[] = [];
  const meta: KbIndex['meta'] = [];
  const len: number[] = [];
  const terms: Record<string, Array<[number, number]>> = {};
  const shards: Record<string, string[]> = {};
  docs.forEach((d, di) => {
    metas.push({ ...d.meta, chunks: d.chunks.length });
    shards[d.meta.id] = d.chunks.map((c) => c.text);
    d.chunks.forEach((c, ci) => {
      const id = meta.length;
      meta.push([di, ci, c.heading]);
      const tf = new Map<string, number>();
      let total = 0;
      for (const t of tokenize(c.text)) (tf.set(t, (tf.get(t) ?? 0) + 1), total++);
      for (const t of tokenize(`${d.meta.title} ${c.heading}`)) (tf.set(t, (tf.get(t) ?? 0) + HEAD_WEIGHT), (total += HEAD_WEIGHT));
      len.push(total);
      for (const [t, n] of tf) (terms[t] ??= []).push([id, n]);
    });
  });
  const avgLen = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  return { index: { v: 1, builtAt, docs: metas, meta, len, avgLen: Math.round(avgLen * 10) / 10, terms }, shards };
}

/* --------------------------------- search ------------------------------ */

const K1 = 1.2;
const B = 0.75;

/**
 * BM25 over the inverted index. Query terms that appear in many chunks matter less (idf); a chunk matching *all* the query
 * terms gets a small bonus so "rake basis profit" prefers the chunk that has all three.
 */
export function searchIndex(index: KbIndex, query: string, limit = 5, opts: { source?: KbDocMeta['source']; doc?: string } = {}): KbHit[] {
  const q = [...new Set(tokenize(query))];
  if (!q.length) return [];
  const N = index.meta.length;
  const score = new Map<number, number>();
  const matched = new Map<number, number>();
  for (const term of q) {
    const posts = index.terms[term];
    if (!posts) continue;
    const idf = Math.log(1 + (N - posts.length + 0.5) / (posts.length + 0.5));
    for (const [id, tf] of posts) {
      const norm = tf + K1 * (1 - B + (B * index.len[id]) / index.avgLen);
      score.set(id, (score.get(id) ?? 0) + (idf * tf * (K1 + 1)) / norm);
      matched.set(id, (matched.get(id) ?? 0) + 1);
    }
  }
  const hits: KbHit[] = [];
  for (const [id, s] of score) {
    const [di, ci, heading] = index.meta[id];
    const d = index.docs[di];
    if (opts.source && d.source !== opts.source) continue;
    if (opts.doc && d.id !== opts.doc) continue;
    const coverage = (matched.get(id) ?? 0) / q.length;
    hits.push({ score: s * (0.6 + 0.4 * coverage), doc: d.id, docTitle: d.title, heading, url: d.url, source: d.source, chunkId: id, shard: d.id, index: ci });
  }
  hits.sort((a, b) => b.score - a.score);
  // at most 2 chunks per document in the top results so one long doc can't crowd everything else out
  const per = new Map<string, number>();
  const out: KbHit[] = [];
  for (const h of hits) {
    const n = per.get(h.doc) ?? 0;
    if (n >= 2) continue;
    per.set(h.doc, n + 1);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out;
}
