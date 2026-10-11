/**
 * Snapshots Kalshi's public market data per sport, for the odds API to fall back on.
 *
 * Why: Kalshi answers Cloudflare's shared egress IPs with HTTP 429, so /api/odds/events can't reach it live from the edge.
 * A GitHub Actions runner can (see .github/workflows/odds-snapshot.yml, which runs this every ~40 s in a loop). It writes one
 * JSON file per sport; the workflow force-pushes them to the orphan branch `odds-data`, and the function reads them from
 * raw.githubusercontent.com.
 *
 * Adaptive: a sport with a game live or starting within ~8 h is refreshed on every run; the others only every 5 minutes
 * (their file keeps its own `generatedAt`). Payloads are slimmed to the fields parseKalshi reads (~5x smaller pushes).
 *
 * Run:  npx esbuild scripts/kalshi-snapshot.ts --bundle --platform=node --format=esm --outfile=/tmp/ks.mjs && node /tmp/ks.mjs <outDir> [--all]
 * Free: public read-only endpoints, no key. ≤ 25 requests per run, paced under Kalshi's ~10 req/s limit.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ODDS_SPORTS } from '../shared/odds';
import { planFanout, type FanoutJob } from '../shared/oddsSources';

const outDir = process.argv[2] || 'kalshi-snapshot';
const forceAll = process.argv.includes('--all');
const COLD_REFRESH_MS = 5 * 60_000;
/** Fields parseKalshi / kalshiQuote read — everything else Kalshi returns is dropped. */
const KEEP = ['event_ticker', 'ticker', 'yes_sub_title', 'status', 'yes_bid_dollars', 'yes_ask_dollars', 'yes_bid_size_fp', 'yes_ask_size_fp', 'last_price_dollars', 'volume_fp', 'floor_strike', 'occurrence_datetime', 'updated_time'];
const slim = (json: unknown): unknown => {
  const ms = (json as { markets?: Array<Record<string, unknown>> } | null)?.markets;
  if (!Array.isArray(ms)) return json;
  return { markets: ms.map((m) => Object.fromEntries(KEEP.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]))) };
};
/** Is a game in this sport's previous snapshot live or about to start? (`occurrence_datetime` ≈ expected END of the game.) */
function isHot(file: string, nowMs: number): boolean {
  try {
    const prev = JSON.parse(fs.readFileSync(file, 'utf8')) as { generatedAt: string; payloads: Array<{ json: { markets?: Array<{ occurrence_datetime?: string }> } }> };
    if (nowMs - Date.parse(prev.generatedAt) >= COLD_REFRESH_MS) return true; // due anyway
    return prev.payloads.some((p) => p.json.markets?.some((m) => { const t = Date.parse(m.occurrence_datetime ?? ''); return t > nowMs - 3600_000 && t < nowMs + 8 * 3600_000; }));
  } catch {
    return true;
  }
}
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
  const file = path.join(outDir, `${sport}.json`);
  if (!forceAll && fs.existsSync(file) && !isHot(file, now)) {
    okFiles++;
    continue;
  }
  const jobs = planFanout(sport, now, 999).jobs.filter((j): j is Extract<FanoutJob, { source: 'kalshi' }> => j.source === 'kalshi');
  const payloads: Array<{ id: string; spec: unknown; json: unknown }> = [];
  for (const j of jobs) {
    try {
      payloads.push({ id: j.id, spec: j.spec, json: slim(await get(j.url)) });
    } catch (e) {
      console.error(`${j.id}: ${(e as Error).message}`);
    }
    await sleep(250);
  }
  // Never replace a complete file with a partial one (its generatedAt would then vouch for old + missing data).
  if (payloads.length && (payloads.length === jobs.length || !fs.existsSync(file))) {
    fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), sport, payloads }));
    okFiles++;
  } else if (fs.existsSync(file)) okFiles++;
  console.log(`${sport}: ${payloads.length}/${jobs.length} series`);
}
if (!okFiles) {
  console.error('No Kalshi data fetched.');
  process.exit(1);
}
