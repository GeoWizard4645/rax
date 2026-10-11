#!/usr/bin/env node
/**
 * Builds public/data/otd-modeled.json — the "modeled" OTD snapshot (OtdSnapshot, method:'modeled') from ESPN's free public
 * data + the rating model in shared/ratingModel.ts. It never reads Rateboard's Rax values (those are the ground truth the
 * model was fitted against; the observed snapshot uses them).
 *
 *   node scripts/build-modeled-snapshot.mjs [--sports nfl,nba,...] [--top 150] [--min 2] [--out FILE] [--cache DIR]
 *                                           [--seasons nfl:2025,2024;nba:2026,2025] [--today YYYY-MM-DD]
 *
 * Plain Node >= 20, no dependencies. Polite: <= 3 requests in flight, >= 150 ms between request starts, every raw ESPN
 * response cached on disk (env RAX_MODEL_CACHE or --cache; default $TMPDIR/rax-rating-model-cache) so the run is
 * resumable and re-runs never re-fetch.
 *
 * Routes (per sport):
 *   box      NFL, CFB, NHL, MLB, CBB — one scoreboard request per calendar day + one box score per final game (every
 *            player of the league; CBB: the 70 winningest teams only, D1 has ~6,000 games a season)
 *   gamelog  NBA, WNBA — ESPN season-leader pages pick ~160 candidate players, one athlete game log each
 * Then per player-season: stats -> rating (ridge model) -> Rax = round(k × rating) per game, summed; the top --top by
 * modeled annual Rax are written as cards with `days` = [mmdd, rax, flags] per game (games under --min Rax dropped).
 * Golf and soccer have no model (see docs/RATING-MODEL.md). Seasons still in progress (today = 2026-10-10: NFL / NHL /
 * NBA / CBB / CFB 2026-27, MLB 2026 postseason) are excluded and listed in `coverage[].note`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPORTS, CACHE_DIR, SEASON_WINDOW, collectSeasonBox, espnByAthlete, espnGamelog, parseBasketballGamelog, pmap,
} from './lib/ratingData.mjs';
import { modelGame } from './lib/ratingEngine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const OUT = path.resolve(opt('out', path.join(ROOT, 'public', 'data', 'otd-modeled.json')));
const TOP = Number(opt('top', '150'));
const MIN_DAY_RAX = Number(opt('min', '2'));
const TODAY = opt('today', '2026-10-10');
const ONLY = (opt('sports', '') || '').split(',').filter(Boolean);
if (opt('cache', null)) process.env.RAX_MODEL_CACHE = path.resolve(opt('cache', ''));

/** Latest COMPLETED seasons per sport (Rateboard / Rax season labels; see shared/otdSnapshot.ts seasonLabelFor). */
const PLAN = {
  nfl: { seasons: [2025, 2024], route: 'box' },
  ncaaf: { seasons: [2025, 2024], route: 'box' },
  nhl: { seasons: [2025], route: 'box' },
  mlb: { seasons: [2025], route: 'box' },
  ncaam: { seasons: [2026], route: 'box', topTeams: 70 },
  nba: { seasons: [2026, 2025], route: 'gamelog' },
  wnba: { seasons: [2025, 2024], route: 'gamelog' },
};
const IN_PROGRESS_NOTE = {
  nfl: '2026 (26-27) season in progress, excluded',
  ncaaf: '2026 (26-27) season in progress, excluded',
  nhl: '2026 (26-27) season in progress, excluded',
  mlb: '2026 season (postseason) in progress, excluded',
  ncaam: '2027 (26-27) season has not started, excluded',
  nba: '2027 (26-27) season has not started, excluded',
  wnba: '2026 season not finished (Finals), excluded',
};
// optional override:  --seasons nfl:2025,2024;nba:2026
for (const part of (opt('seasons', '') || '').split(';').filter(Boolean)) {
  const [sp, list] = part.split(':');
  if (PLAN[sp]) PLAN[sp].seasons = list.split(',').map(Number);
}

const DAY_POSTSEASON = 1;
const mmddFromIso = (iso) => Number(iso.slice(5, 7)) * 100 + Number(iso.slice(8, 10));
function seasonLabelFor(otd, season) {
  if (['NFL', 'NHL', 'CFB'].includes(otd)) return `${String(season).slice(2)}-${String(season + 1).slice(2)}`;
  if (['NBA', 'CBB'].includes(otd)) return `${String(season - 1).slice(2)}-${String(season).slice(2)}`;
  return String(season);
}

function readModels() {
  const ts = fs.readFileSync(path.join(ROOT, 'shared', 'ratingModel.ts'), 'utf8');
  const m = ts.match(/\/\/ BEGIN GENERATED MODEL_DATA[^\n]*\n[^=]*=\s*([\s\S]*?);\n\/\/ END GENERATED MODEL_DATA/);
  if (!m) throw new Error('MODEL_DATA block not found in shared/ratingModel.ts — run scripts/fit-rating-model.mjs --write');
  return JSON.parse(m[1]);
}
const MODELS = readModels();
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/** games: [{day, post, won, s, season}] -> card numbers. */
function scoreGames(model, season, games) {
  const days = [];
  let annual = 0, best = 0, n = 0;
  for (const g of games) {
    const r = modelGame(model, g.s, { won: g.won, post: g.post, season, factors: 'official' });
    if (!r) continue;
    n++;
    annual += r.rax;
    if (r.rax > best) best = r.rax;
    if (r.rax >= MIN_DAY_RAX) days.push([mmddFromIso(g.day), r.rax, g.post ? DAY_POSTSEASON : 0]);
  }
  days.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  return { annual, best, games: n, days };
}

async function boxSeason(sport, season, model) {
  const plan = PLAN[sport];
  const { players, events, teams } = await collectSeasonBox(sport, season, { onProgress: log, topTeams: plan.topTeams });
  log(`${sport} ${season}: ${events} games, ${players.size} players`);
  const cards = [];
  for (const p of players.values()) {
    if (p.games.length < 3) continue;
    const sc = scoreGames(model, season, p.games);
    if (sc.annual <= 0) continue;
    cards.push({ playerId: p.id, name: p.name, team: p.team, ...sc });
  }
  return { cards, events, note: teams ? `box scores of the ${teams.length} winningest teams` : null };
}

async function gamelogSeason(sport, season, model) {
  const sorts = sport === 'nba'
    ? [['offensive.avgPoints:desc', 100], ['general.avgRebounds:desc', 60], ['offensive.avgAssists:desc', 60]]
    : [['offensive.avgPoints:desc', 60], ['general.avgRebounds:desc', 30], ['offensive.avgAssists:desc', 30]];
  const cand = new Map();
  for (const [sort, n] of sorts) {
    const j = await espnByAthlete(sport, season, sort, 1, 100);
    for (const a of (j?.athletes ?? []).slice(0, n)) if (!cand.has(a.athlete.id)) cand.set(a.athlete.id, { id: a.athlete.id, name: a.athlete.displayName, team: a.athlete.teamShortName ?? '' });
  }
  log(`${sport} ${season}: ${cand.size} candidate players -> game logs`);
  const out = await pmap([...cand.values()], async (c) => {
    const gl = parseBasketballGamelog(sport, await espnGamelog(sport, c.id, season));
    if (gl.length < 3) return null;
    const sc = scoreGames(model, season, gl);
    return sc.annual > 0 ? { playerId: c.id, name: c.name, team: c.team, ...sc } : null;
  });
  return { cards: out.filter(Boolean), events: cand.size, note: `${cand.size} candidates from ESPN points / rebounds / assists leaders` };
}

async function main() {
  const sports = Object.keys(PLAN).filter((s) => (ONLY.length ? ONLY.includes(s) : s !== 'ncaam'));
  if (ONLY.length === 0) log('CBB (ncaam) is skipped by default; pass --sports ncaam to build it');
  const cards = [];
  const coverage = [];
  for (const sport of sports) {
    const plan = PLAN[sport];
    const otd = SPORTS[sport].otd;
    const model = MODELS[otd];
    if (!model) { log(`skip ${sport}: no model`); continue; }
    const doneSeasons = [];
    const notes = [];
    for (const season of plan.seasons) {
      if (!SEASON_WINDOW[sport]?.[season]) { notes.push(`${season}: no season window configured`); continue; }
      if (SEASON_WINDOW[sport][season][1] >= TODAY) { notes.push(`${seasonLabelFor(otd, season)} still in progress, excluded`); continue; }
      const res = plan.route === 'box' ? await boxSeason(sport, season, model) : await gamelogSeason(sport, season, model);
      const top = res.cards.sort((a, b) => b.annual - a.annual).slice(0, TOP);
      for (const c of top) {
        cards.push({
          id: `${otd}|${season}|${c.playerId}`, sport: otd, season, seasonLabel: seasonLabelFor(otd, season), playerId: String(c.playerId), name: c.name, team: c.team,
          owners: null, games: c.games, annual: c.annual, best: c.best, days: c.days,
        });
      }
      doneSeasons.push(season);
      if (res.note) notes.push(`${seasonLabelFor(otd, season)}: ${res.note}`);
      log(`${sport} ${season}: kept ${top.length} cards (top annual ${top[0]?.name} ${top[0]?.annual}, #${top.length} ${top.at(-1)?.annual})`);
    }
    coverage.push({
      sport: otd, seasons: doneSeasons, cards: cards.filter((c) => c.sport === otd).length,
      note: [`modeled (${plan.route === 'box' ? 'ESPN box scores' : 'ESPN game logs'}); top ${TOP} player-seasons by modeled annual Rax per season`, ...notes, IN_PROGRESS_NOTE[sport]].filter(Boolean).join('; '),
    });
  }
  if (!sports.includes('ncaam')) coverage.push({ sport: 'CBB', seasons: [], cards: 0, note: 'rating model exists (R² 0.97) but this snapshot was built without CBB: it needs ~2,000 ESPN box scores of the 70 winningest teams; run `node scripts/build-modeled-snapshot.mjs --sports ncaam` (or all) to add it' });
  for (const [otd, why] of [['PGA', 'golf ratings depend on the whole field\'s scores — not modeled'], ['SOC', 'soccer not modeled (position- and league-specific ratings, no stable stat mapping)']]) {
    coverage.push({ sport: otd, seasons: [], cards: 0, note: why });
  }
  cards.sort((a, b) => (a.sport < b.sport ? -1 : a.sport > b.sport ? 1 : b.season - a.season || b.annual - a.annual));
  const snapshot = {
    version: 1,
    method: 'modeled',
    generatedAt: new Date().toISOString(),
    source: 'ESPN public box scores / game logs (free, unofficial JSON) → transparent rating model fitted to Real\'s own ratings (shared/ratingModel.ts) → Rax = round(k × rating). Not Real\'s numbers; see docs/RATING-MODEL.md for measured error.',
    minDayRax: MIN_DAY_RAX,
    coverage,
    cards,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const json = JSON.stringify(snapshot);
  fs.writeFileSync(OUT, json);
  log(`wrote ${path.relative(ROOT, OUT)}: ${cards.length} cards, ${(json.length / 1e6).toFixed(2)} MB`);
}

await main();
