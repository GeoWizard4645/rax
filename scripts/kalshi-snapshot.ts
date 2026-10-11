/**
 * Snapshots Kalshi's public market data per sport, for the odds API to fall back on.
 *
 * Why: Kalshi answers Cloudflare's shared egress IPs with HTTP 429, so /api/odds/events can't reach it live from the edge.
 * A GitHub Actions runner can (see .github/workflows/odds-snapshot.yml). It writes one JSON file per sport; the workflow
 * force-pushes them to the orphan branch `odds-data`, and the function reads them from raw.githubusercontent.com.
 *
 * Run:  npx esbuild scripts/kalshi-snapshot.ts --bundle --platform=node --format=esm --outfile=/tmp/ks.mjs && node /tmp/ks.mjs <outDir>
 * Free: public read-only endpoints, no key. ~25 requests per run, paced under Kalshi's ~10 req/s limit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ODDS_SPORTS } from '../shared/odds';
import { planFanout, type FanoutJob } from '../shared/oddsSources';

const outDir = process.argv[2] || 'kalshi-snapshot';
const UA = 'rax-super-suite/0.1 (+https://rax.vivaanshahani.com)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (r.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  throw new Error('HTTP 429 (gave up)');
}

const now = Date.now();
fs.mkdirSync(outDir, { recursive: true });
let okFiles = 0;
for (const sport of ODDS_SPORTS) {
  const jobs = planFanout(sport, now, 999).jobs.filter((j): j is Extract<FanoutJob, { source: 'kalshi' }> => j.source === 'kalshi');
  const payloads: Array<{ id: string; spec: unknown; json: unknown }> = [];
  for (const j of jobs) {
    try {
      payloads.push({ id: j.id, spec: j.spec, json: await get(j.url) });
    } catch (e) {
      console.error(`${j.id}: ${(e as Error).message}`);
    }
    await sleep(250);
  }
  if (payloads.length) {
    fs.writeFileSync(path.join(outDir, `${sport}.json`), JSON.stringify({ generatedAt: new Date().toISOString(), sport, payloads }));
    okFiles++;
  }
  console.log(`${sport}: ${payloads.length}/${jobs.length} series`);
}
if (!okFiles) {
  console.error('No Kalshi data fetched.');
  process.exit(1);
}
