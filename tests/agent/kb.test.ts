import { describe, expect, it } from 'vitest';
import { buildIndex, chunkMarkdown, searchIndex, tokenize } from '../../shared/agent/kbCore';
import { diskKb } from './kbFixture';

describe('tokenizer', () => {
  it('lowercases, drops stopwords and stems plurals', () => {
    expect(tokenize('The Legendary cards, and multipliers!')).toEqual(['legendary', 'card', 'multiplier']);
    expect(tokenize('earning claims')).toEqual(['earn', 'claim']);
  });
  it('keeps numbers', () => {
    expect(tokenize('Mystic 10 pays 105x')).toContain('10');
  });
});

describe('chunkMarkdown', () => {
  it('splits on headings and keeps breadcrumbs', () => {
    const md = '# Doc\n\nintro text here\n\n## Rarity\n\nCommon is 2x.\n\n### Legendary\n\nLegendary 3 is 32x.';
    const c = chunkMarkdown(md, 'Doc');
    expect(c.map((x) => x.heading)).toContain('Doc › Rarity › Legendary');
    expect(c.find((x) => x.text.includes('32x'))).toBeTruthy();
  });
  it('breaks very long paragraphs', () => {
    const c = chunkMarkdown(`# T\n\n${'word '.repeat(1000)}`, 'T');
    expect(c.length).toBeGreaterThan(2);
    expect(c.every((x) => x.text.length <= 1300)).toBe(true);
  });
});

describe('BM25 index', () => {
  const docs = [
    { meta: { id: 'a', title: 'Cards', url: 'u/a', source: 'real-docs' as const }, chunks: [{ heading: 'Cards', text: 'Legendary cards pay 25x Rax multiplier.' }, { heading: 'Cards › Packs', text: 'Packs cost 200 Rax and contain play cards.' }] },
    { meta: { id: 'b', title: 'Odds', url: 'u/b', source: 'rax-docs' as const }, chunks: [{ heading: 'Odds', text: 'Kalshi and Polymarket prices need no vig removal.' }] },
  ];
  const { index, shards } = buildIndex(docs, 'now');
  it('ranks the relevant chunk first and maps back to its shard', () => {
    const h = searchIndex(index, 'legendary multiplier', 3);
    expect(h[0].doc).toBe('a');
    expect(shards[h[0].shard][h[0].index]).toContain('25x');
  });
  it('filters by source and returns nothing for unknown words', () => {
    expect(searchIndex(index, 'polymarket', 3, { source: 'real-docs' })).toHaveLength(0);
    expect(searchIndex(index, 'zzzzqqq', 3)).toHaveLength(0);
  });
});

describe('the shipped knowledge base', () => {
  const kb = diskKb();
  it.each([
    ['legendary 3 multiplier', 'real-collect-player-cards'],
    ['pro bonus claim on this day', 'real-collect-on-this-day'],
    ['how is edge ev computed for real predictions', 'rax-real-predictions'],
    ['change tab 7 parameters assistant', 'rax-site-guide'],
  ])('finds the right doc for "%s"', async (q, doc) => {
    const hits = await kb.search(q, 5);
    expect(hits.map((h) => h.doc)).toContain(doc);
    expect(hits.every((h) => h.text.length > 20 && h.url.startsWith('http'))).toBe(true);
  });
  it('covers Real\'s docs and the repo notes', async () => {
    const docs = await kb.docs();
    expect(docs.filter((d) => d.source === 'real-docs').length).toBeGreaterThan(15);
    expect(docs.some((d) => d.source === 'site-guide')).toBe(true);
  });
});
