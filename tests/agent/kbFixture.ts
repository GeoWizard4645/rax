import fs from 'node:fs';
import path from 'node:path';
import { searchIndex, type KbIndex } from '../../shared/agent/kbCore';
import type { KbAccess, OtdIndex, ToolCtx } from '../../shared/agent/tools';

const DIR = path.resolve(__dirname, '../../public/data');
const readJson = <T,>(p: string): T => JSON.parse(fs.readFileSync(path.join(DIR, p), 'utf8')) as T;

/** The real, committed knowledge base read straight from disk — tests exercise what ships. */
export function diskKb(): KbAccess {
  const index = readJson<KbIndex>('kb/index.json');
  const shard = (id: string) => readJson<string[]>(`kb/${id}.json`);
  return {
    async search(q, limit, opts = {}) {
      return searchIndex(index, q, limit, { source: opts.source }).map((h) => ({ doc: h.doc, docTitle: h.docTitle, heading: h.heading, url: h.url, source: h.source, score: h.score, text: shard(h.shard)[h.index] }));
    },
    async docs() {
      return index.docs;
    },
    async read(id) {
      const meta = index.docs.find((d) => d.id === id);
      return meta ? { meta, chunks: shard(id) } : null;
    },
    async otdIndex() {
      return readJson<OtdIndex>('otd-index.json');
    },
  };
}

export const toolCtx = (getJson?: ToolCtx['getJson']): ToolCtx => ({ kb: diskKb(), getJson });
