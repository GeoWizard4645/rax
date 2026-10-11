#!/usr/bin/env node
/**
 * Builds public/data/otd-observed.json — Real's OWN per-game Rax (via Rateboard's /api/rax, used with the owner's
 * permission) for the top OTD cards of every sport, in the OtdSnapshot shape of shared/otdSnapshot.ts.
 *
 *   node scripts/build-otd-snapshot.mjs [--cache DIR] [--min 3] [--top 400] [--no-verify] [--out FILE]
 *
 * Plain Node >= 20, no dependencies. Be gentle: <= 3 requests in flight, >= 150 ms between request starts, every
 * raw response cached on disk (default $TMPDIR/rax-otd-rateboard-cache) so re-runs never re-fetch; honest User-Agent, no
 * Accept-Encoding (node:https adds none).
 *
 * Selection per sport: the top TOP player-seasons by annual rax, PLUS every player-season that owns a top-4 game
 * (by rax) on some calendar day (MM-DD) across all included seasons. Each selected card keeps its games with
 * rax >= MIN as `days`.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const CACHE = path.resolve(opt('cache', path.join(os.tmpdir(), 'rax-otd-rateboard-cache')));
const OUT = path.resolve(opt('out', path.join(ROOT, 'public', 'data', 'otd-observed.json')));
const MIN_DAY_RAX = Number(opt('min', '3'));
const TOP = Number(opt('top', '400'));
const PER_DAY = 4;
const VERIFY = !args.includes('--no-verify');
const TODAY = opt('today', new Date().toISOString().slice(0, 10));

const BASE = 'https://rateboard-cgi.pages.dev/api/rax';
const UA = 'rax-super-suite/0.1 (+https://rax.vivaanshahani.com)';
const MAX_INFLIGHT = 3;
const MIN_GAP_MS = 150;

const RAX_KEY_TO_OTD = { nfl: 'NFL', nba: 'NBA', mlb: 'MLB', nhl: 'NHL', ncaam: 'CBB', ncaaf: 'CFB', golf: 'PGA', wnba: 'WNBA', soccer: 'SOC' };

/** Season label as the community writes it (mirror of seasonLabelFor in shared/otdSnapshot.ts). */
function seasonLabelFor(sport, season) {
  const yy = (n) => String(n).slice(2);
  if (sport === 'NFL' || sport === 'NHL' || sport === 'CFB') return `${yy(season)}-${yy(season + 1)}`;
  if (sport === 'NBA' || sport === 'CBB') return `${yy(season - 1)}-${yy(season)}`;
  return String(season);
}

/**
 * Last calendar day on which a season can still produce games (nominal). A season ending after TODAY is
 * "in progress" and its cards are excluded — except where POLICY says otherwise.
 */
function nominalEnd(key, season) {
  switch (key) {
    case 'nfl': return `${season + 1}-02-20`;
    case 'ncaaf': return `${season + 1}-01-31`;
    case 'nhl': return `${season + 1}-06-30`;
    case 'nba': return `${season}-06-30`;
    case 'ncaam': return `${season}-04-15`;
    case 'wnba': return `${season}-10-31`;
    case 'soccer': return `${season + 1}-07-31`;
    case 'mlb': return `${season}-11-05`;
    default: return `${season}-12-31`; // golf: PGA Tour calendar year
  }
}

/** Judgement calls that override the nominal-end rule. Documented in docs/OTD-DATASET.md. */
const POLICY = {
  // Regular season is over and every card-day through the end of the regular season exists; only October playoff days
  // (and the 2026 title run) are still being added. Included with a note; annual for deep-October teams is understated.
  'mlb:2026': 'include',
  // Golf's 2026 PGA Tour calendar year has its fall events still to play; the majors / FedEx playoffs (the big claims) are done.
  'golf:2026': 'include',
  // WNBA finals are being played right now (last game 2026-10-09); regular season + early playoff rounds are final.
  'wnba:2026': 'include',
};

/* ------------------------------ polite HTTP + disk cache ------------------------------ */

fs.mkdirSync(CACHE, { recursive: true });
let networkRequests = 0;
let cacheHits = 0;
let inflight = 0;
let lastStart = 0;
const waiters = [];

async function acquire() {
  while (inflight >= MAX_INFLIGHT) await new Promise((r) => waiters.push(r));
  inflight++;
  const wait = lastStart + MIN_GAP_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_GAP_MS); // reserve our start slot synchronously
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
function release() {
  inflight--;
  waiters.shift()?.();
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': UA, accept: 'application/json' }, timeout: 60_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/** GET `?query` with on-disk caching (key = sha1 of the full URL). */
async function get(query) {
  const url = `${BASE}?${query}`;
  const file = path.join(CACHE, `${crypto.createHash('sha1').update(url).digest('hex')}.json`);
  if (fs.existsSync(file)) {
    cacheHits++;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  for (let attempt = 1; ; attempt++) {
    await acquire();
    let res;
    try {
      networkRequests++;
      fs.appendFileSync(path.join(CACHE, '_requests.log'), `${new Date().toISOString()} ${query}\n`);
      res = await httpGet(url);
    } catch (e) {
      res = { status: 0, body: String(e) };
    } finally {
      release();
    }
    if (res.status === 200) {
      fs.writeFileSync(file, res.body);
      return JSON.parse(res.body);
    }
    if (attempt >= 5 || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
      throw new Error(`HTTP ${res.status} for ${url}: ${res.body.slice(0, 200)}`);
    }
    const backoff = 2000 * attempt * attempt;
    console.error(`  retry ${attempt} in ${backoff}ms (HTTP ${res.status}) ${query}`);
    await new Promise((r) => setTimeout(r, backoff));
  }
}

const qs = (mode, key, season, extra) => `gamelog=query&mode=${mode}&sport=${key}&season=${season}&seasons=${key}:${season}&${extra}`;
const PAGE = 500;

/* ------------------------------ helpers ------------------------------ */

const mmddOf = (day) => Number(day.slice(5, 7)) * 100 + Number(day.slice(8, 10));
const flagsOf = (seasonType) => {
  const t = String(seasonType || '').toLowerCase();
  if (t.startsWith('regular')) return 0;
  if (t.startsWith('post')) return 1;
  return 2; // allstar / preseason / exhibition / anything else
};

/** Run async tasks over `items` with a small worker pool (the HTTP layer enforces the real global limits). */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }));
  return out;
}

/* ------------------------------ main ------------------------------ */

const t0 = Date.now();
const seasonsDoc = await get('gamelog=seasons');
const allPairs = seasonsDoc.seasons; // {sport, season, rows, players}
const keys = Object.keys(RAX_KEY_TO_OTD).filter((k) => allPairs.some((p) => p.sport === k));

const cards = [];
const coverage = [];
const stats = {}; // per-sport diagnostics for the build log
const seasonTypeCounts = {};

for (const key of keys) {
  const sport = RAX_KEY_TO_OTD[key];
  const pairs = allPairs.filter((p) => p.sport === key).sort((a, b) => a.season - b.season);
  const included = [];
  const excluded = [];
  for (const p of pairs) {
    const done = nominalEnd(key, p.season) < TODAY;
    const policy = POLICY[`${key}:${p.season}`];
    if (done || policy === 'include') included.push(p);
    else excluded.push(p);
  }
  console.error(`\n[${sport}] included ${included.map((p) => p.season).join(',')} | excluded (in progress) ${excluded.map((p) => p.season).join(',') || '-'}`);

  // 1. Player-season totals, page 1 (top 500 by rax) of each season → the "top TOP by annual" pool.
  const playerRows = new Map(); // `${season}|${playerId}` → row
  const pageState = {}; // season → { total, fetched }
  await pool(included, 3, async (p) => {
    const d = await get(qs('players', key, p.season, `sort=rax&dir=desc&limit=${PAGE}&offset=0`));
    pageState[p.season] = { total: d.total, fetched: d.rows.length };
    for (const r of d.rows) playerRows.set(`${p.season}|${r.playerId}`, r);
  });
  const ranked = [...playerRows.entries()].sort((a, b) => b[1].rax - a[1].rax || String(a[0]).localeCompare(String(b[0])));
  const selected = new Set(ranked.slice(0, TOP).map(([k]) => k));
  const annualCutoff = ranked[Math.min(TOP, ranked.length) - 1]?.[1].rax ?? 0;

  // 2. Games, largest rax first, until rax < MIN_DAY_RAX.
  const games = []; // compact rows: [season, playerId, day, rax, flags, team, name]
  const seasonSpan = {};
  await pool(included, 3, async (p) => {
    let offset = 0;
    let total = Infinity;
    let pages = 0;
    let kept = 0;
    let dups = 0;
    const seen = new Set();
    while (offset < total) {
      const d = await get(qs('games', key, p.season, `sort=rax&dir=desc&limit=${PAGE}&offset=${offset}`));
      total = d.total;
      pages++;
      let stop = false;
      for (const r of d.rows) {
        if (!(r.rax >= MIN_DAY_RAX)) { stop = true; continue; }
        seasonTypeCounts[`${sport}:${r.seasonType}`] = (seasonTypeCounts[`${sport}:${r.seasonType}`] || 0) + 1;
        const id = `${r.playerId}|${r.day}|${r.opponent}|${r.rating}`;
        if (seen.has(id)) { dups++; continue; }
        seen.add(id);
        games.push([p.season, r.playerId, r.day, r.rax, flagsOf(r.seasonType), r.team, r.player]);
        kept++;
        const sp = (seasonSpan[p.season] ??= { first: r.day, last: r.day });
        if (r.day < sp.first) sp.first = r.day;
        if (r.day > sp.last) sp.last = r.day;
      }
      if (stop || d.rows.length < PAGE) break;
      offset += PAGE;
    }
    console.error(`  ${sport} ${p.season}: ${pages} game pages, ${kept} games >= ${MIN_DAY_RAX} (of ${total})${dups ? `, ${dups} duplicate rows skipped` : ''}`);
  });

  // 3. Top-PER_DAY games per calendar day across all seasons → extra cards.
  const byDay = new Map(); // mmdd → games
  for (const g of games) {
    const k = mmddOf(g[2]);
    (byDay.get(k) ?? byDay.set(k, []).get(k)).push(g);
  }
  const extras = new Set();
  for (const list of byDay.values()) {
    list.sort((a, b) => b[3] - a[3] || b[0] - a[0] || a[1] - b[1]);
    for (const g of list.slice(0, PER_DAY)) extras.add(`${g[0]}|${g[1]}`);
  }
  const need = new Set([...selected, ...extras]);
  const extraOnly = [...extras].filter((k) => !selected.has(k)).length;

  // 4. Players page 2.. only for seasons where a needed card is still missing.
  const missing = () => [...need].filter((k) => !playerRows.has(k));
  for (const p of included) {
    const st = pageState[p.season];
    while (st.fetched < st.total && missing().some((k) => k.startsWith(`${p.season}|`))) {
      const d = await get(qs('players', key, p.season, `sort=rax&dir=desc&limit=${PAGE}&offset=${st.fetched}`));
      for (const r of d.rows) playerRows.set(`${p.season}|${r.playerId}`, r);
      st.fetched += d.rows.length;
      if (!d.rows.length) break;
    }
  }
  const stillMissing = missing();
  if (stillMissing.length) console.error(`  WARNING: ${stillMissing.length} needed player-seasons not found in players endpoint (dropped)`);

  // 5. Assemble cards.
  const gamesByCard = new Map();
  for (const g of games) {
    const k = `${g[0]}|${g[1]}`;
    if (!need.has(k)) continue;
    (gamesByCard.get(k) ?? gamesByCard.set(k, []).get(k)).push(g);
  }
  let built = 0;
  for (const k of need) {
    const r = playerRows.get(k);
    if (!r) continue;
    const gs = (gamesByCard.get(k) ?? []).sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0));
    const days = gs.map((g) => [mmddOf(g[2]), g[3], g[4]]).sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    // The players endpoint's `team` is the LAST game's team (often an all-star squad); use the modal regular-season team.
    const tally = {};
    for (const g of gs) if (g[4] !== 2 && g[5]) tally[g[5]] = (tally[g[5]] || 0) + 1;
    const team = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? r.team ?? '';
    cards.push({
      id: `${sport}|${r.season}|${r.playerId}`,
      sport,
      season: r.season,
      seasonLabel: seasonLabelFor(sport, r.season),
      playerId: String(r.playerId),
      name: r.player,
      team: String(team),
      owners: r.owners ?? null,
      games: r.games ?? 0,
      annual: r.rax,
      best: r.bestRax ?? 0,
      days,
    });
    built++;
  }

  const notes = [];
  for (const p of included) {
    const sp = seasonSpan[p.season];
    if (sp && nominalEnd(key, p.season) < TODAY && sp.last > nominalEnd(key, p.season)) notes.push(`${p.season} has games through ${sp.last} (past the nominal season end ${nominalEnd(key, p.season)}; the feed's season key spans competitions)`);
    if (sp && nominalEnd(key, p.season) >= TODAY) notes.push(`${p.season} not finished: games through ${sp.last} (regular season done, postseason / late events still being played; annual totals may still grow)`);
  }
  if (excluded.length) notes.push(`${excluded.map((p) => `${p.season} (${seasonLabelFor(sport, p.season)})`).join(', ')} excluded: season in progress`);
  notes.push(`top ${TOP} by annual rax (>= ${annualCutoff}) + ${extraOnly} extra cards owning a top-${PER_DAY} game on some day`);
  coverage.push({ sport, seasons: included.map((p) => p.season), cards: built, note: notes.join('; ') });
  stats[sport] = { cards: built, extraOnly, annualCutoff, spans: seasonSpan, games: games.length };
}

/* ------------------------------ finish ------------------------------ */

cards.sort((a, b) => a.sport.localeCompare(b.sport) || b.season - a.season || b.annual - a.annual || a.id.localeCompare(b.id));

// Optional integrity check: re-fetch the #1 card of each sport via q=<name> and compare with what paging produced.
if (VERIFY) {
  console.error('\nverify (q=<name> per-card requests vs paged results):');
  for (const key of keys) {
    const sport = RAX_KEY_TO_OTD[key];
    const top = cards.filter((c) => c.sport === sport).sort((a, b) => b.annual - a.annual)[0];
    if (!top) continue;
    const d = await get(qs('games', key, top.season, `q=${encodeURIComponent(top.name)}&sort=day&dir=asc&limit=${PAGE}`));
    const mine = d.rows.filter((r) => String(r.playerId) === top.playerId);
    const sumAll = mine.reduce((s, r) => s + (r.rax || 0), 0);
    const sumMin = mine.filter((r) => r.rax >= MIN_DAY_RAX).reduce((s, r) => s + r.rax, 0);
    const sumDays = top.days.reduce((s, x) => s + x[1], 0);
    console.error(`  ${top.id} ${top.name}: annual ${top.annual}, sum(all ${mine.length} games) ${sumAll}, sum(>=min) ${sumMin} vs days ${sumDays} (${top.days.length} days)${sumMin === sumDays ? '' : '  <-- MISMATCH'}`);
  }
}

const snapshot = {
  version: 1,
  method: 'observed',
  generatedAt: new Date().toISOString(),
  source: "Real's own per-game Rax as logged by Rateboard (rateboard-cgi.pages.dev/api/rax); rax = General-level payout, annual = sum over the season's games",
  minDayRax: MIN_DAY_RAX,
  coverage,
  cards,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(snapshot));
const bytes = fs.statSync(OUT).size;
console.error(`\nwrote ${path.relative(ROOT, OUT)}: ${cards.length} cards, ${(bytes / 1e6).toFixed(2)} MB`);
console.error(`requests this run: ${networkRequests} network, ${cacheHits} cache hits, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.error('season types seen:', JSON.stringify(seasonTypeCounts));
console.error('per-sport:', JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, { cards: v.cards, extraOnly: v.extraOnly, annualCutoff: v.annualCutoff, games: v.games }]))));
console.error('spans:', JSON.stringify(Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, v.spans]))));
