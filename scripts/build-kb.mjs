#!/usr/bin/env node
/**
 * Builds the assistant's knowledge base → public/data/kb/ (index.json + one shard per document).
 *
 *   node scripts/build-kb.mjs [--no-real] [--cache DIR]
 *
 * Corpus
 *   • Real's own public docs (docs.realapp.link, a GitBook; every page is readable as Markdown by appending `.md`),
 *     discovered through its llms.txt. Legal / jobs pages are skipped. Fetched politely (sequential, identifying UA) and cached
 *     on disk so re-runs are free; `--no-real` rebuilds from the cache only.
 *   • This repo's own notes: README.md and docs/*.md (research on OTD mechanics, odds sources, Rateboard, …).
 *   • docs/SITE-GUIDE.md — what every tab does and which parameters the assistant can change.
 *
 * The result is committed (it is a build artefact of public docs); the app build never touches the network.
 * Retrieval is BM25 over an inverted index (shared/agent/kbCore.ts) — no embeddings, no neurons spent.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex, chunkMarkdown } from '../shared/agent/kbCore.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'data', 'kb');
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const CACHE = opt('cache', path.join(os.tmpdir(), 'rax-kb-cache'));
const DOCS_ORIGIN = 'https://docs.realapp.link';
const UA = 'rax-super-suite/0.1 (+https://rax.vivaanshahani.com; knowledge-base build)';
const SKIP = /\/(policies|jobs)\//;

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** GitBook markdown → plain markdown the chunker (and the model) can read. */
export function cleanGitbook(md) {
  return md
    .replace(/^> For the complete documentation index[^\n]*\n/m, '')
    .replace(/\{%\s*hint[^%]*%\}/g, '\n> ')
    .replace(/\{%\s*endhint\s*%\}/g, '\n')
    .replace(/\{%[^%]*%\}/g, '')
    .replace(/<\/?(details|div|center|figure|figcaption|span|u|mark)[^>]*>/gi, '\n')
    .replace(/<summary[^>]*>([\s\S]*?)<\/summary>/gi, (_, s) => `\n**${s.replace(/<br\s*\/?>/gi, ' — ').replace(/<[^>]+>/g, '')}**\n`)
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/gi, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x20;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchText(url, cacheFile) {
  if (fs.existsSync(cacheFile)) return fs.readFileSync(cacheFile, 'utf8');
  if (flag('no-real')) return null;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/markdown, text/plain' } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  const t = await r.text();
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, t);
  await new Promise((res) => setTimeout(res, 250));
  return t;
}

async function realDocs() {
  const out = [];
  const idx = await fetchText(`${DOCS_ORIGIN}/llms.txt`, path.join(CACHE, 'llms.txt'));
  if (!idx) return out;
  const pages = [...idx.matchAll(/\[([^\]]+)\]\((https:\/\/docs\.realapp\.link\/[^)\s]+?)\.md\)/g)].map((m) => ({ title: m[1], url: m[2] }));
  for (const p of pages) {
    const rel = p.url.replace(DOCS_ORIGIN, '');
    if (SKIP.test(rel)) continue;
    const raw = await fetchText(`${p.url}.md`, path.join(CACHE, `${slug(rel || 'home')}.md`));
    if (!raw) continue;
    const text = cleanGitbook(raw);
    if (text.length < 80) continue;
    out.push({ meta: { id: `real-${slug(rel || 'welcome')}`, title: `Real docs — ${p.title}`, url: p.url, source: 'real-docs' }, text });
  }
  return out;
}

function repoDocs() {
  const out = [];
  const add = (file, id, title, source) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) return;
    const url = `https://github.com/GeoWizard4645/rax/blob/main/${file}`;
    out.push({ meta: { id, title, url, source }, text: fs.readFileSync(full, 'utf8') });
  };
  add('README.md', 'rax-readme', 'RAX README (architecture, tabs, deployment, limits)', 'rax-docs');
  for (const f of fs.readdirSync(path.join(ROOT, 'docs')).sort()) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(ROOT, 'docs', f), 'utf8');
    const title = /^#\s+(.*)$/m.exec(text)?.[1]?.replace(/[*`]/g, '') ?? f;
    add(`docs/${f}`, `rax-${slug(f.replace(/\.md$/, ''))}`, title, f === 'SITE-GUIDE.md' ? 'site-guide' : 'rax-docs');
  }
  return out;
}

const all = [...(await realDocs()), ...repoDocs()];
const docs = all.map((d) => ({ meta: d.meta, chunks: chunkMarkdown(d.text, d.meta.title) })).filter((d) => d.chunks.length);
const { index, shards } = buildIndex(docs, new Date().toISOString());

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
for (const [id, chunks] of Object.entries(shards)) fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify(chunks));

/* A slim per-card table for the server-side `otd_top_cards` tool: the full snapshot (~3 MB with every game) is too heavy to
 * parse inside a free-tier Worker's ~10 ms CPU budget, and ranking by annual General-level Rax needs none of the per-game rows. */
try {
  const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'data', 'otd-observed.json'), 'utf8'));
  const slim = {
    v: 1,
    generatedAt: snap.generatedAt,
    source: snap.source,
    method: snap.method,
    // [id, sport, seasonLabel, name, team, owners, annualGeneralRax, bestGame, games]
    cards: Object.values(
      snap.cards.filter((c) => !c.fixed).reduce((m, c) => ((m[c.sport] ??= []).push(c), m), {}),
    )
      .flatMap((list) => list.sort((a, b) => b.annual - a.annual).slice(0, 150)) // top 150 per sport keeps the file ~100 KB
      .map((c) => [c.id, c.sport, c.seasonLabel, c.name, c.team, c.owners, Math.round(c.annual), Math.round(c.best), c.games]),
  };
  fs.writeFileSync(path.join(ROOT, 'public', 'data', 'otd-index.json'), JSON.stringify(slim));
  console.log(`OTD index: ${slim.cards.length} cards — ${(fs.statSync(path.join(ROOT, 'public', 'data', 'otd-index.json')).size / 1024).toFixed(0)} KB`);
} catch (e) {
  console.warn(`OTD index skipped: ${e instanceof Error ? e.message : e}`);
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const idxSize = fs.statSync(path.join(OUT, 'index.json')).size;
console.log(`KB: ${docs.length} documents, ${index.meta.length} chunks, ${Object.keys(index.terms).length} terms — index.json ${kb(idxSize)}`);
for (const d of index.docs) console.log(`  ${d.source.padEnd(10)} ${String(d.chunks).padStart(3)}  ${d.id}`);
