/**
 * Builds a bid-rate history SEED from Rateboard's own rolling board backups.
 *
 * Rateboard keeps ~25 rolling snapshots of its board (`GET /api/kv?snap=list` lists them, `GET /api/kv?snap=<slot>` returns
 * one — its owner OK'd use of all of his routes). Replaying them through the same recorder the edge uses gives a day or
 * so of real history immediately, instead of waiting for it to accumulate. Run it again any time to fill a gap (e.g.
 * if the recorder was down): the edge only takes seed points that are older than its own first live sample.
 *
 * Privacy: each snapshot contains every account's password hash. They are parsed in memory and dropped — only the
 * per-player bid-rate aggregates are written. The output has no usernames at all.
 *
 * Run:
 *   npx esbuild scripts/seed-rb-history.ts --bundle --platform=node --format=esm --outfile=/tmp/seed-rb.mjs && node /tmp/seed-rb.mjs public/data/rb-rates-seed.json
 * Politeness: 1 list request + ≤25 snapshot requests (~0.5 MB each), 3 s apart, honest User-Agent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { appendSample, aggregateBoard, distinctBuyers, emptyDoc, type RbHistDoc } from '../shared/rbHistory';
import { RB_ORIGIN, sanitizeBoard } from '../shared/rateboard';

const out = process.argv[2] || 'public/data/rb-rates-seed.json';
const UA = 'rax-super-suite/0.1 (+https://rax.vivaanshahani.com)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<any> {
  const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

const list = await get(`${RB_ORIGIN}/api/kv?snap=list`);
const slots: Array<{ slot: string; takenAt: string }> = list.snapshots ?? [];
// "safe" is a copy of the newest slot; dedupe by timestamp and replay oldest → newest.
const byTime = new Map<number, string>();
for (const s of slots) byTime.set(Date.parse(s.takenAt), byTime.get(Date.parse(s.takenAt)) ?? s.slot);
const order = [...byTime.entries()].sort((a, b) => a[0] - b[0]);
console.log(`${slots.length} backups listed, ${order.length} distinct`);

let doc: RbHistDoc | null = emptyDoc();
let n = 0;
for (const [takenAt, slot] of order) {
  try {
    const snap = await get(`${RB_ORIGIN}/api/kv?snap=${encodeURIComponent(slot)}`);
    const board = sanitizeBoard({ value: snap.value }); // drops hashes, reports, gamedata
    doc = appendSample(doc, aggregateBoard(board), snap.ts ?? takenAt, distinctBuyers(board));
    n++;
    console.log(`${new Date(takenAt).toISOString()}  slot ${slot}: ${board.offers.length} offers`);
  } catch (e) {
    console.error(`slot ${slot}: ${(e as Error).message}`);
  }
  await sleep(3000);
}
if (!n || !doc) {
  console.error('No snapshots read.');
  process.exit(1);
}
doc.updatedAt = Date.now();
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(doc));
console.log(`wrote ${out}: ${n} snapshots, ${Object.keys(doc.players).length} players, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
