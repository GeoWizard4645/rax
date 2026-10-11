#!/usr/bin/env node
/**
 * Reproducible fit of the "modeled" OTD method: game stat line -> Real's game RATING (-> Rax = round(k * rating)).
 *
 *   node scripts/fit-rating-model.mjs [--stage fit|validate|all] [--sports nba,nfl,...] [--write] [--cache DIR]
 *
 *   fit       collect training data, fit one transparent additive model per sport / position group, evaluate on a
 *             held-out SEASON (rating R^2 / MAE and Rax MAE vs Rateboard's actual Rax) and print the tables
 *   validate  ESPN pipeline proof: real player-seasons from Rateboard's top list are rebuilt from ESPN data only
 *             (box score / gamelog -> model -> Rax) and compared with Rateboard's actual per-game and annual Rax
 *   all       both
 *   --write   rewrite the GENERATED blocks of shared/ratingModel.ts (coefficients, accuracy table) and
 *             docs/rating-model-fit.json (full report)
 *
 * Ground truth: Rateboard's `/api/rax` (Real's own per-game rating and Rax), read with its owner's permission, gently
 * (<= 3 requests in flight, >= 150 ms between starts, every raw response cached on disk). Inputs: ESPN's unofficial
 * public JSON (no key). Plain Node >= 20, no dependencies. Re-runs are served from the cache (env RAX_MODEL_CACHE).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SPORTS, CACHE_DIR, pmap, rbSeasonPages, rbDay, rbPlayers, rbPlayerGames, seasonLabel, addDays, dayDiff, rng, norm,
  espnEvents, espnSummary, boxPlayers, espnGamelog, espnSearch, parseBasketballGamelog, collectSeasonBox,
} from './lib/ratingData.mjs';
import { fitOLS, dot, metrics, spearman, pickGroup, evalGroupRating, groupK, groupRole, raxFromRating, statNum, modelGame, upliftForPct } from './lib/ratingEngine.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, d) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const STAGE = opt('stage', 'fit');
const WRITE = args.includes('--write');
const ONLY = (opt('sports', '') || '').split(',').filter(Boolean);
const MODEL_TS = path.join(ROOT, 'shared', 'ratingModel.ts');
const REPORT_JSON = path.join(ROOT, 'docs', 'rating-model-fit.json');

/* ======================================================================================================
 * Configuration
 * ==================================================================================================== */

/** Seasons are Rateboard labels (see shared/rax.ts `seasonLabel`). `days` = sampled game days per season for ESPN-joined sports. */
const CFG = {
  nba: { train: [2024, 2025], test: 2026, pages: 30 },
  wnba: { train: [2024], test: 2025, pages: 30 },
  ncaam: { train: [2024, 2025], test: 2026, pages: 40, route: 'box', topTeams: 70 },
  nfl: { train: [2023, 2024], test: 2025, days: { 2023: 10, 2024: 10, 2025: 10 } },
  ncaaf: { train: [2023, 2024], test: 2025, days: { 2023: 6, 2024: 8, 2025: 8 } },
  nhl: { train: [2023, 2024], test: 2025, days: { 2023: 10, 2024: 16, 2025: 12 } },
  mlb: { train: [2023, 2024], test: 2025, days: { 2023: 10, 2024: 14, 2025: 10 } },
};
/** Approximate regular+post season windows (used only to sample days). */
const WIN = {
  nfl: { 2023: ['2023-09-07', '2024-02-11'], 2024: ['2024-09-05', '2025-02-09'], 2025: ['2025-09-04', '2026-02-08'] },
  nhl: { 2023: ['2023-10-10', '2024-06-24'], 2024: ['2024-10-04', '2025-06-24'], 2025: ['2025-10-07', '2026-06-20'] },
  mlb: { 2023: ['2023-03-30', '2023-11-01'], 2024: ['2024-03-28', '2024-10-30'], 2025: ['2025-03-27', '2025-11-01'] },
  ncaaf: { 2023: ['2023-08-26', '2024-01-08'], 2024: ['2024-08-24', '2025-01-20'], 2025: ['2025-08-23', '2026-01-20'] },
};

/** Rax factors (rating -> base Rax). `k` = Real's current official factors (docs.realapp.link, Oct 2026). `kSeasons` = what
 *  Rateboard's stored values actually used in older seasons (only used with factors:'rateboard'). */
const K = (reg) => ({ reg, post: reg * 2 });
const KFAC = {
  nba: { all: K(1) },
  wnba: { all: K(2) },
  ncaam: { all: K(2.5) },
  nfl: { QB: K(5), SKILL: K(5), K: K(5), P: K(7), DEF: K(7) },
  ncaaf: { QB: K(5), SKILL: K(5), K: K(5), P: K(8), DEF: K(8) },
  nhl: { S: K(1.2), G: K(3) },
  mlb: { H: K(2), P: K(3) },
};
const KSEASONS = {
  nfl: { P: [{ from: 0, ...K(5) }, { from: 2025, ...K(7) }], DEF: [{ from: 0, ...K(5) }, { from: 2025, ...K(7) }] },
  mlb: { H: [{ from: 2025, ...K(1.5) }], P: [{ from: 2025, ...K(2) }] },
};
const KROLE = { mlb: { P: { SP: K(3), RP: K(5) } } };
const KROLE_SEASONS = { mlb: { P: [{ from: 2025, SP: K(2), RP: K(4) }] } };
const ROLE_RULE = { mlb: { P: { key: 'outs', min: 12, hi: 'SP', lo: 'RP' } } };

/* ======================================================================================================
 * Model templates (what the regression may use). `w` is filled in by the fit.
 * ==================================================================================================== */

const T = (n, e, extra = {}) => ({ n, e: e ?? [[n, 1]], ...extra });
const H = (key, t) => ({ n: `${key}>${t}`, e: [[key, 1]], f: 'hinge', t });
const BB_BASE = [
  T('pts'), T('reb'), T('ast'), T('stl'), T('blk'), T('tov'), T('pf'),
  T('fgm'), T('fgmiss', [['fga', 1], ['fgm', -1]]), T('tpm'), T('tpmiss', [['tpa', 1], ['tpm', -1]]), T('ftmiss', [['fta', 1], ['ftm', -1]]), T('ftm'), T('win'),
];
const BB_HINGE = [H('pts', 20), H('pts', 30), H('pts', 40), H('pts', 50), H('reb', 10), H('reb', 15), H('reb', 20), H('ast', 8), H('ast', 12), H('ast', 16), H('stl', 3), H('stl', 5), H('blk', 3), H('blk', 5), H('tov', 4), H('tov', 6)];

const SPEC = {
  nba: { groups: [{ id: 'all', label: 'All players', base: BB_BASE, hinges: BB_HINGE, intercept: false, zeroIf: ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fga', 'fta'] }] },
  wnba: { groups: [{ id: 'all', label: 'All players', base: BB_BASE, hinges: BB_HINGE, intercept: false, zeroIf: ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fga', 'fta'] }] },
  ncaam: { groups: [{ id: 'all', label: 'All players', base: BB_BASE, hinges: BB_HINGE, intercept: false, zeroIf: ['pts', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'fga', 'fta'] }] },
  nfl: footballSpec(),
  ncaaf: footballSpec(),
  nhl: {
    groups: [
      { id: 'G', label: 'Goalie', when: [[['g', '>=', 1]]], base: [T('ga'), T('sv'), T('win'), T('toi')], hinges: [H('ga', 3), H('sv', 30), H('sv', 40)], intercept: true },
      { id: 'S', label: 'Skater', base: [T('goals'), T('ast'), T('sog'), T('blk'), T('hit'), T('tk'), T('gv'), T('pm'), T('pim'), T('win'), T('toi'), T('fow'), T('fol')], hinges: [H('goals', 1), H('goals', 2), H('sog', 4), H('ast', 2), H('blk', 3), H('hit', 5)], intercept: true },
    ],
  },
  mlb: {
    groups: [
      { id: 'P', label: 'Pitcher', when: [[['p', '>=', 1]]], base: [T('outs'), T('h'), T('r'), T('er'), T('bb'), T('k'), T('hr'), T('pit'), T('win')], hinges: [H('outs', 18), H('k', 8), H('er', 3), H('er', 5)], intercept: true },
      { id: 'H', label: 'Hitter', base: [T('abOut', [['ab', 1], ['h', -1]]), T('h'), T('r'), T('rbi'), T('hr'), T('bb'), T('k'), T('win')], hinges: [H('h', 2), H('h', 3), H('hr', 1), H('hr', 2), H('rbi', 3), H('rbi', 5)], intercept: true },
    ],
  },
};

function footballSpec() {
  return {
    groups: [
      { id: 'QB', label: 'Quarterback', when: [[['patt', '>=', 3]]], base: [T('pcmp'), T('pinc', [['patt', 1], ['pcmp', -1]]), T('pyds'), T('ptd'), T('pint'), T('sacked'), T('ratt'), T('ryds'), T('rtd'), T('fuml'), T('win')], hinges: [H('pyds', 250), H('pyds', 350), H('ptd', 3), H('ryds', 50)], intercept: true },
      { id: 'K', label: 'Kicker', when: [[['fga', '>=', 1]], [['xpa', '>=', 1]]], base: [T('fgm'), T('fgmiss', [['fga', 1], ['fgm', -1]]), T('xpm'), T('xpmiss', [['xpa', 1], ['xpm', -1]]), T('fglong'), T('win')], hinges: [], intercept: true },
      { id: 'P', label: 'Punter', when: [[['punts', '>=', 1]]], base: [T('punts'), T('puntyds'), T('win')], hinges: [], intercept: true },
      { id: 'SKILL', label: 'Rusher / receiver', when: [[['ratt', '>=', 1]], [['rec', '>=', 1]], [['tgt', '>=', 1]]], base: [T('ratt'), T('ryds'), T('rtd'), T('rec'), T('recyds'), T('rectd'), T('tgtmiss', [['tgt', 1], ['rec', -1]]), T('fuml'), T('win')], hinges: [H('ryds', 100), H('ryds', 150), H('recyds', 100), H('recyds', 150), H('rtd', 2), H('rectd', 2)], intercept: true },
      { id: 'DEF', label: 'Defender / other', base: [T('solo'), T('ast', [['tkl', 1], ['solo', -1]]), T('sacks'), T('tfl'), T('pd'), T('qbh'), T('int'), T('intyds'), T('inttd'), T('dtd'), T('fumrec'), T('win')], hinges: [H('tkl', 10), H('sacks', 1), H('sacks', 2), H('tfl', 2), H('pd', 2)], intercept: true },
    ],
  };
}

/* ======================================================================================================
 * Data collection
 * ==================================================================================================== */

const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const TRAIN_DIR = path.join(CACHE_DIR, '..', 'rating-model-training');
fs.mkdirSync(TRAIN_DIR, { recursive: true });
const cachedJson = async (name, make) => {
  const f = path.join(TRAIN_DIR, name);
  if (fs.existsSync(f)) return J(f);
  const v = await make();
  fs.writeFileSync(f, JSON.stringify(v));
  return v;
};
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);
const made = (s) => (s ? Number(String(s).split('/')[0]) || 0 : 0);
const att = (s) => (s ? Number(String(s).split('/')[1]) || 0 : 0);

/** Rateboard basketball row -> training row (its stat line is the box score). */
function basketballRow(sport, season, r) {
  return {
    sport, season, day: r.day, name: r.player, team: r.team, rbId: r.playerId, seasonType: r.seasonType, result: r.result, rating: r.rating, rax: r.rax,
    s: { min: r.min, pts: r.pts, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov, pf: r.pf, fgm: made(r.fg), fga: att(r.fg), tpm: made(r.fg3), tpa: att(r.fg3), ftm: made(r.ft), fta: att(r.ft), pm: r.plusMinus },
  };
}

async function pickDays(sport, season, D, seed = 1) {
  const [a, b] = WIN[sport][season];
  const span = dayDiff(a, b);
  const r = rng(seed + season);
  const days = [];
  for (let i = 0; i < D; i++) {
    const target = Math.floor(((i + 0.2 + 0.6 * r()) / D) * span);
    for (let tries = 0; tries < 8; tries++) {
      const day = addDays(a, Math.min(span, target + tries));
      if (days.includes(day)) continue;
      const ev = await espnEvents(sport, day);
      if (ev.filter((e) => e.status === 'STATUS_FINAL').length >= (sport === 'nfl' ? 4 : 2)) {
        days.push(day);
        break;
      }
    }
  }
  return days;
}

/** Join one day: every Rateboard game row of that day <-> ESPN box score line (name match within the day's games). */
async function collectDay(sport, day) {
  const season = seasonLabel(sport, day);
  const [evs, rb] = await Promise.all([espnEvents(sport, day), rbDay(sport, season, day)]);
  if (!rb.length) return [];
  const rbTeams = new Set(rb.map((r) => r.team));
  let use = evs.filter((e) => e.status === 'STATUS_FINAL');
  if (['ncaam', 'ncaaf'].includes(sport)) use = use.filter((e) => rbTeams.has(e.home.abbr) || rbTeams.has(e.away.abbr));
  const sums = await pmap(use, (e) => espnSummary(sport, e.id));
  const byName = new Map();
  use.forEach((e, i) => {
    if (!sums[i]) return;
    for (const p of boxPlayers(sport, sums[i])) {
      const k = norm(p.name);
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push({ p, e });
    }
  });
  const rows = [];
  for (const r of rb) {
    const c = byName.get(norm(r.player));
    if (!c) continue;
    let m = c;
    if (c.length > 1) {
      const f = c.filter((x) => x.p.team === r.team || x.e.home.abbr === r.team || x.e.away.abbr === r.team);
      m = f.length ? f : c;
    }
    if (m.length > 1) continue;
    const { p, e } = m[0];
    rows.push({ sport, season, day, name: r.player, team: r.team, rbId: r.playerId, seasonType: r.seasonType, result: r.result, rating: r.rating, rax: r.rax, espnId: p.id, eventId: e.id, pos: p.pos, s: p.s });
  }
  return rows;
}

async function loadRows(sport, season) {
  const c = CFG[sport];
  if (SPORTS[sport].kind === 'basketball') {
    return cachedJson(`${sport}-${season}-p${c.pages}.json`, async () => (await rbSeasonPages(sport, season, c.pages)).map((r) => basketballRow(sport, season, r)));
  }
  const D = c.days[season];
  return cachedJson(`${sport}-${season}-d${D}.json`, async () => {
    const days = await pickDays(sport, season, D);
    const out = [];
    for (const day of days) out.push(...(await collectDay(sport, day)));
    return out;
  });
}

/* ======================================================================================================
 * Fitting
 * ==================================================================================================== */

const withCtx = (row) => ({ ...row.s, win: row.result === 'W' ? 1 : 0, post: row.seasonType === 'postseason' ? 1 : 0 });
const termVal = (t, st) => {
  let v = 0;
  for (const [k, c] of t.e) v += c * statNum(st, k);
  return t.f === 'hinge' ? Math.max(0, v - t.t) : v;
};
const usable = (r) => (r.seasonType === 'regularseason' || r.seasonType === 'postseason') && Number.isFinite(r.rating);

function assignGroup(spec, st) {
  for (const g of spec.groups) {
    if (!g.when) return g;
    if (g.when.some((cl) => cl.every((c) => (c[1] === '>=' ? statNum(st, c[0]) >= c[2] : c[1] === '>' ? statNum(st, c[0]) > c[2] : false)))) return g;
  }
  return spec.groups[spec.groups.length - 1];
}

/** Greedy forward selection of hinge terms on top of the base terms, judged on a held-out split of the TRAINING days. */
function fitGroup(g, rows) {
  const st = rows.map(withCtx);
  const y = rows.map((r) => r.rating);
  const days = [...new Set(rows.map((r) => r.day))].sort();
  const valDays = new Set(days.filter((_, i) => i % 4 === 3));
  const tr = rows.map((_, i) => i).filter((i) => !valDays.has(rows[i].day));
  const va = rows.map((_, i) => i).filter((i) => valDays.has(rows[i].day));
  const fitSub = (terms, idx) => fitOLS(idx.map((i) => terms.map((t) => termVal(t, st[i]))), idx.map((i) => y[i]), { ridge: 1e-5, intercept: g.intercept });
  const valErr = (terms, m) => va.reduce((s, i) => s + Math.abs(y[i] - (m.intercept + dot(m.b, terms.map((t) => termVal(t, st[i]))))), 0) / Math.max(1, va.length);
  let terms = [...g.base];
  let best = valErr(terms, fitSub(terms, tr));
  const log = [];
  if (rows.length >= 400) {
    for (let step = 0; step < 8; step++) {
      let cand = null;
      for (const h of g.hinges) {
        if (terms.some((t) => t.n === h.n)) continue;
        if (rows.filter((r, i) => termVal(h, st[i]) > 0).length < 12) continue;
        const e = valErr([...terms, h], fitSub([...terms, h], tr));
        if (!cand || e < cand.e) cand = { h, e };
      }
      if (!cand || cand.e > best * 0.995) break;
      terms.push(cand.h);
      log.push(`${cand.h.n}: ${best.toFixed(4)} -> ${cand.e.toFixed(4)}`);
      best = cand.e;
    }
  }
  const all = rows.map((_, i) => i);
  const m = fitSub(terms, all);
  const lo = Math.min(...y), hi = Math.max(...y);
  return {
    id: g.id, label: g.label, when: g.when, zeroIf: g.zeroIf, intercept: +m.intercept.toFixed(5),
    terms: terms.map((t, i) => ({ n: t.n, e: t.e, ...(t.f ? { f: t.f, t: t.t } : {}), w: +m.b[i].toFixed(5) })),
    min: +Math.max(-6, lo).toFixed(2), max: +Math.min(30, hi * 1.25).toFixed(2), n: rows.length, hingeLog: log,
  };
}

function groupModelPredict(g, row) {
  return evalGroupRating(g, withCtx(row));
}

function attachFactors(sport, g) {
  const f = KFAC[sport][g.id] ?? KFAC[sport].all;
  g.k = f;
  if (KSEASONS[sport]?.[g.id]) g.kSeasons = KSEASONS[sport][g.id];
  if (KROLE[sport]?.[g.id]) g.kRole = KROLE[sport][g.id];
  if (KROLE_SEASONS[sport]?.[g.id]) g.kRoleSeasons = KROLE_SEASONS[sport][g.id];
  if (ROLE_RULE[sport]?.[g.id]) g.roleRule = ROLE_RULE[sport][g.id];
}

function evaluate(sport, model, rows, tag) {
  const out = { tag, byGroup: {}, all: null };
  const per = [];
  for (const row of rows) {
    const st = withCtx(row);
    const g = pickGroup(model, st);
    if (!g) continue;
    const pr = groupModelPredict(g, row);
    const k = groupK(g, { postseason: row.seasonType === 'postseason', season: row.season, role: groupRole(g, st), factors: 'rateboard' });
    per.push({ g: g.id, rating: row.rating, pred: pr, rax: row.rax, predRax: raxFromRating(pr, k), modelOnlyRax: raxFromRating(row.rating, k), row });
  }
  // rows that are pure noise (rating 0, no stats) inflate R^2; keep them, they are real card-days, but also report the "played" subset
  const stat = (arr) => ({
    n: arr.length,
    rating: metrics(arr.map((x) => x.rating), arr.map((x) => x.pred)),
    rax: { mae: metrics(arr.map((x) => x.rax), arr.map((x) => x.predRax)).mae, maeVsRatingOnly: metrics(arr.map((x) => x.modelOnlyRax), arr.map((x) => x.predRax)).mae, exact: arr.filter((x) => x.predRax === x.rax).length / Math.max(1, arr.length), within1: arr.filter((x) => Math.abs(x.predRax - x.rax) <= 1).length / Math.max(1, arr.length) },
  });
  const played = per.filter((x) => x.rating !== 0 || x.pred > 0.05);
  out.all = stat(played);
  for (const id of new Set(played.map((x) => x.g))) out.byGroup[id] = stat(played.filter((x) => x.g === id));
  out.rows = per;
  return out;
}

/* ======================================================================================================
 * Stage 1: fit + held-out evaluation
 * ==================================================================================================== */

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '  n/a');

async function fitSport(sport) {
  const c = CFG[sport];
  const trainRows = [];
  for (const s of c.train) trainRows.push(...(await loadRows(sport, s)));
  const testRows = await loadRows(sport, c.test);
  const spec = SPEC[sport];
  const tr = trainRows.filter(usable);
  const te = testRows.filter(usable);
  const model = { sport: SPORTS[sport].otd, key: sport, trainSeasons: c.train, testSeason: c.test, groups: [] };
  for (const g of spec.groups) {
    const rows = tr.filter((r) => assignGroup(spec, withCtx(r)).id === g.id).filter((r) => !(g.zeroIf && g.zeroIf.every((k) => statNum(r.s, k) === 0)));
    if (rows.length < 30) {
      console.log(`  ! ${sport}/${g.id}: only ${rows.length} training rows, skipped`);
      continue;
    }
    const fg = fitGroup(g, rows);
    attachFactors(sport, fg);
    model.groups.push(fg);
  }
  // keep spec order (first match wins) but make sure the catch-all stays last
  model.groups.sort((a, b) => spec.groups.findIndex((x) => x.id === a.id) - spec.groups.findIndex((x) => x.id === b.id));
  const ev = evaluate(sport, model, te, 'test');
  const evTrain = evaluate(sport, model, tr, 'train');
  // pre-Dec-2025 slice of the test season: before Rateboard's low-owner Rax uplift shows up (see docs)
  const clean = evaluate(sport, model, te.filter((r) => r.day < '2025-12-01'), 'test-pre-dec-2025');
  return { model, ev, evTrain, clean, counts: { train: tr.length, test: te.length } };
}

function printFit(sport, r) {
  console.log(`\n=== ${sport.toUpperCase()}  train ${r.model.trainSeasons.join('+')} (${r.counts.train} rows)  test ${r.model.testSeason} (${r.counts.test} rows)`);
  for (const g of r.model.groups) {
    const e = r.ev.byGroup[g.id];
    const t = r.evTrain.byGroup[g.id];
    console.log(`  ${g.id.padEnd(6)} trainN=${String(g.n).padStart(6)} | test n=${String(e?.n ?? 0).padStart(5)} R2=${fmt(e?.rating.r2)} MAE=${fmt(e?.rating.mae)} bias=${fmt(e?.rating.bias)} | raxMAE=${fmt(e?.rax.mae)} (vs rating-only ${fmt(e?.rax.maeVsRatingOnly)}) exact=${fmt(e?.rax.exact, 2)} +-1=${fmt(e?.rax.within1, 2)} | train R2=${fmt(t?.rating.r2)}`);
    if (g.hingeLog.length) console.log(`         hinges: ${g.hingeLog.join('; ')}`);
  }
  const a = r.ev.all, c = r.clean.all;
  console.log(`  ALL    test n=${a.n} R2=${fmt(a.rating.r2)} MAE=${fmt(a.rating.mae)} raxMAE=${fmt(a.rax.mae)} (rating-only ${fmt(a.rax.maeVsRatingOnly)})  | pre-Dec-2025 slice n=${c.n} R2=${fmt(c.rating.r2)} raxMAE=${fmt(c.rax.mae)}`);
}

/* ======================================================================================================
 * Stage 2: ESPN pipeline validation — rebuild real player-seasons from ESPN data ONLY and compare with Rateboard
 * ==================================================================================================== */

const topK = (arr, k, key) => [...arr].sort((a, b) => key(b) - key(a)).slice(0, k);
/** First game day of the "low-owner uplift" regime seen in Rateboard's stored Rax, per sport (see docs/RATING-MODEL.md). */
const UPLIFT_ONSET = { nfl: '2025-12-01', ncaaf: '2025-09-01', nhl: '2025-12-01', mlb: '2025-09-01', ncaam: '2025-12-01', nba: '2025-12-01', wnba: '2025-05-01' };
const sumRaxOwn = (games, model, sport, pct) => {
  let tot = 0;
  for (const g of games) {
    const r = modelGame(model, g.s, { won: g.won, post: g.post, season: g.season, factors: 'rateboard' });
    if (!r) continue;
    const u = g.day >= UPLIFT_ONSET[sport] ? upliftForPct(pct) : 1;
    tot += Math.max(0, Math.floor(r.k * r.rating * u + 0.5));
  }
  return tot;
};
const sumRax = (games, model, factors) => {
  let tot = 0;
  for (const g of games) {
    const r = modelGame(model, g.s, { won: g.won, post: g.post, season: g.season, factors });
    if (r) tot += r.rax;
  }
  return tot;
};

function annualMetrics(pairs, kList = [50, 150]) {
  // pairs: [{name, actual, pred, predOff}]
  const out = {};
  const rowsAll = pairs.filter((p) => p.actual > 0);
  out.matched = rowsAll.length;
  if (rowsAll.length > 5) {
    out.spearmanAll = spearman(rowsAll.map((p) => p.actual), rowsAll.map((p) => p.pred));
    out.spearmanAllWithOwners = spearman(rowsAll.map((p) => p.actual), rowsAll.map((p) => p.predOwn));
  }
  for (const k of kList) {
    const top = topK(rowsAll, k, (p) => p.actual);
    if (top.length < 5) continue;
    const sa = top.reduce((s, p) => s + p.actual, 0);
    const sp = top.reduce((s, p) => s + p.pred, 0);
    const spo = top.reduce((s, p) => s + p.predOff, 0);
    const topPred = new Set(topK(rowsAll, k, (p) => p.pred).map((p) => p.name));
    out[`top${k}`] = {
      n: top.length,
      spearman: spearman(top.map((p) => p.actual), top.map((p) => p.pred)),
      mape: top.reduce((s, p) => s + Math.abs(p.pred - p.actual) / p.actual, 0) / top.length,
      mae: top.reduce((s, p) => s + Math.abs(p.pred - p.actual), 0) / top.length,
      biasPct: sp / sa - 1,
      biasPctOfficial: spo / sa - 1,
      overlap: top.filter((p) => topPred.has(p.name)).length / top.length,
      // oracle: same model, but told each player's owner percentile (what the UI could do with Rateboard's owners column)
      withOwners: {
        spearman: spearman(top.map((p) => p.actual), top.map((p) => p.predOwn)),
        mape: top.reduce((s, p) => s + Math.abs(p.predOwn - p.actual) / p.actual, 0) / top.length,
        biasPct: top.reduce((s, p) => s + p.predOwn, 0) / sa - 1,
        overlap: top.filter((p) => new Set(topK(rowsAll, k, (q) => q.predOwn).map((q) => q.name)).has(p.name)).length / top.length,
      },
    };
  }
  return out;
}

async function validateBox(sport, model) {
  const season = CFG[sport].test;
  console.log(`  [${sport} ${season}] whole-league box-score pass (cached after first run) ...`);
  const { players, events } = await collectSeasonBox(sport, season, { onProgress: (m) => console.log('   ', m), topTeams: CFG[sport].topTeams });
  const rbp = await rbPlayers(sport, season);
  const byName = new Map();
  for (const p of players.values()) {
    const k = norm(p.name);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(p);
  }
  const ownersSorted = rbp.map((r) => r.owners ?? 0).sort((a, b) => a - b);
  const pctOf = (o) => {
    let lo = 0, hi = ownersSorted.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ownersSorted[mid] < o) lo = mid + 1; else hi = mid; }
    return lo / Math.max(1, ownersSorted.length);
  };
  const pairs = [];
  let unmatched = 0, ambiguous = 0;
  const top150 = new Set(topK(rbp, 150, (r) => r.rax).map((r) => r.playerId));
  const missing = [];
  for (const r of rbp) {
    const c = byName.get(norm(r.player));
    if (!c) { unmatched++; if (top150.has(r.playerId)) missing.push(r.player); continue; }
    if (c.length > 1) { ambiguous++; continue; }
    const games = c[0].games.map((g) => ({ ...g, season }));
    pairs.push({ name: r.player, rbId: r.playerId, owners: r.owners, actual: r.rax, pred: sumRax(games, model, 'rateboard'), predOff: sumRax(games, model, 'official'), predOwn: sumRaxOwn(games, model, sport, pctOf(r.owners ?? 0)), games: games.length, rbGames: r.games });
  }
  const m = annualMetrics(pairs);
  const matchedIds = new Set(pairs.map((p) => p.rbId));
  m.coverageTop150 = [...top150].filter((id) => matchedIds.has(id)).length / Math.max(1, top150.size);
  return { route: 'box', season, events, espnAthletes: players.size, rbPlayers: rbp.length, matched: pairs.length, unmatched, ambiguous, top150Unmatched: missing.slice(0, 15), top150UnmatchedN: missing.length, annual: m, pairs };
}

async function validateGamelog(sport, model) {
  const season = CFG[sport].test;
  const league = { nba: 'nba', wnba: 'wnba', ncaam: 'mens-college-basketball' }[sport];
  const rbp = (await rbPlayers(sport, season)).sort((a, b) => b.rax - a.rax);
  const r = rng(7);
  const sample = [...rbp.slice(0, 30)];
  const pool = rbp.slice(30, 300);
  while (sample.length < 50 && pool.length) sample.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  console.log(`  [${sport} ${season}] gamelog route for ${sample.length} sampled players ...`);
  const allP = rbp.map((r) => r.owners ?? 0).sort((a, b) => a - b);
  const pctOf = (o) => {
    let lo = 0, hi = allP.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (allP[mid] < o) lo = mid + 1; else hi = mid; }
    return lo / Math.max(1, allP.length);
  };
  const out = await pmap(sample, async (rb) => {
    const found = await espnSearch(rb.player, `sport=basketball&league=${league}`);
    const hit = (found?.items ?? []).find((i) => norm(i.displayName) === norm(rb.player) && (i.league === league || !i.league));
    if (!hit) return { rb, miss: 'search' };
    const gl = await espnGamelog(sport, hit.id, season);
    const games = parseBasketballGamelog(sport, gl).map((g) => ({ ...g, season }));
    if (!games.length) return { rb, miss: 'gamelog', id: hit.id };
    const rbGames = await rbPlayerGames(sport, season, rb.player, rb.playerId);
    const rbByDay = new Map(rbGames.filter((x) => x.seasonType === 'regularseason' || x.seasonType === 'postseason').map((x) => [x.day, x]));
    let cmp = 0, exact = 0, within1 = 0, absErr = 0, ratingAbs = 0;
    for (const g of games) {
      const act = rbByDay.get(g.day);
      if (!act) continue;
      const mg = modelGame(model, g.s, { won: g.won, post: g.post, season, factors: 'rateboard' });
      cmp++;
      if (mg.rax === act.rax) exact++;
      if (Math.abs(mg.rax - act.rax) <= 1) within1++;
      absErr += Math.abs(mg.rax - act.rax);
      ratingAbs += Math.abs(mg.rating - act.rating);
    }
    return { rb, id: hit.id, games: games.length, cmp, exact, within1, absErr, ratingAbs, pred: sumRax(games, model, 'rateboard'), predOff: sumRax(games, model, 'official'), predOwn: sumRaxOwn(games, model, sport, pctOf(rb.owners ?? 0)) };
  });
  const ok = out.filter((o) => o.games);
  const pairs = ok.map((o) => ({ name: o.rb.player, actual: o.rb.rax, pred: o.pred, predOff: o.predOff, predOwn: o.predOwn, owners: o.rb.owners }));
  const cmp = ok.reduce((s, o) => s + o.cmp, 0);
  return {
    route: 'gamelog', season, sampled: sample.length, found: ok.length, notFound: out.filter((o) => o.miss).map((o) => `${o.rb.player} (${o.miss})`),
    perGame: { n: cmp, exact: ok.reduce((s, o) => s + o.exact, 0) / cmp, within1: ok.reduce((s, o) => s + o.within1, 0) / cmp, maeRax: ok.reduce((s, o) => s + o.absErr, 0) / cmp, maeRating: ok.reduce((s, o) => s + o.ratingAbs, 0) / cmp },
    annual: annualMetrics(pairs, [30]), pairs,
  };
}

function sampleGames(sport, model, rows, n = 20) {
  const r = rng(11);
  const pool = rows.filter((x) => usable(x) && (x.rating !== 0 || x.rax > 0));
  const picks = [];
  while (picks.length < n && pool.length) picks.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return picks.map((row) => {
    const st = withCtx(row);
    const mg = modelGame(model, row.s, { won: row.result === 'W', post: row.seasonType === 'postseason', season: row.season, factors: 'rateboard' });
    return { player: row.name, day: row.day, team: row.team, group: mg?.group, rating: +row.rating.toFixed(2), predRating: +(mg?.rating ?? NaN).toFixed(2), rax: row.rax, predRax: mg?.rax, stats: Object.fromEntries(Object.entries(row.s).filter(([, v]) => v).slice(0, 8)), win: st.win };
  });
}

/* ======================================================================================================
 * Output: GENERATED blocks in shared/ratingModel.ts + docs/rating-model-fit.json
 * ==================================================================================================== */

function round(x, d = 4) {
  return Number.isFinite(x) ? +x.toFixed(d) : null;
}

const wo = (w) => w && { spearman: round(w.spearman, 3), mape: round(w.mape, 3), biasPct: round(w.biasPct, 3), overlap: round(w.overlap, 3) };

function accuracyEntry(sport, r, val) {
  const a = r.ev.all, c = r.clean.all;
  const e = {
    sport: SPORTS[sport].otd,
    trainSeasons: r.model.trainSeasons,
    testSeason: r.model.testSeason,
    nTrain: r.counts.train,
    n: a.n,
    r2Rating: round(a.rating.r2),
    maeRating: round(a.rating.mae),
    maeRax: round(a.rax.mae, 3),
    maeRaxRatingOnly: round(a.rax.maeVsRatingOnly, 3),
    exactRax: round(a.rax.exact, 3),
    within1Rax: round(a.rax.within1, 3),
    r2RatingPreDec2025: round(c.rating.r2),
    maeRaxPreDec2025: round(c.rax.mae, 3),
    byGroup: Object.fromEntries(Object.entries(r.ev.byGroup).map(([id, x]) => [id, { n: x.n, r2: round(x.rating.r2), maeRating: round(x.rating.mae), maeRax: round(x.rax.mae, 3), exact: round(x.rax.exact, 3) }])),
  };
  if (val) {
    const an = val.annual;
    e.annual = {
      route: val.route,
      matched: an.matched,
      coverageTop150: round(an.coverageTop150, 3),
      spearmanAll: round(an.spearmanAll, 3),
      spearmanAllWithOwners: round(an.spearmanAllWithOwners, 3),
      top50: an.top50 && { n: an.top50.n, spearman: round(an.top50.spearman, 3), mape: round(an.top50.mape, 3), biasPct: round(an.top50.biasPct, 3), biasPctOfficialFactors: round(an.top50.biasPctOfficial, 3), overlap: round(an.top50.overlap, 3), withOwners: wo(an.top50.withOwners) },
      top150: an.top150 && { n: an.top150.n, spearman: round(an.top150.spearman, 3), mape: round(an.top150.mape, 3), biasPct: round(an.top150.biasPct, 3), biasPctOfficialFactors: round(an.top150.biasPctOfficial, 3), overlap: round(an.top150.overlap, 3), withOwners: wo(an.top150.withOwners) },
      top30: an.top30 && { n: an.top30.n, spearman: round(an.top30.spearman, 3), mape: round(an.top30.mape, 3), biasPct: round(an.top30.biasPct, 3), overlap: round(an.top30.overlap, 3), withOwners: wo(an.top30.withOwners) },
    };
    e.spearmanSeasonTotal = (e.annual.top150 ?? e.annual.top30)?.spearman ?? null;
    if (val.perGame) e.pipelinePerGame = { n: val.perGame.n, exact: round(val.perGame.exact, 3), within1: round(val.perGame.within1, 3), maeRax: round(val.perGame.maeRax, 3), maeRating: round(val.perGame.maeRating, 3) };
  }
  return e;
}

function writeGenerated(models, accuracy) {
  let ts = fs.readFileSync(MODEL_TS, 'utf8');
  const put = (name, body) => {
    const re = new RegExp(`(// BEGIN GENERATED ${name}[^\\n]*\\n)[\\s\\S]*?(// END GENERATED ${name})`);
    if (!re.test(ts)) throw new Error(`marker ${name} missing in ratingModel.ts`);
    ts = ts.replace(re, (_, a, b) => `${a}${body}\n${b}`);
  };
  if (models) put('MODEL_DATA', `export const MODEL_DATA: Record<string, SportModel> = ${JSON.stringify(models, null, 1)};`);
  if (accuracy) put('MODEL_ACCURACY', `export const MODEL_ACCURACY: Record<string, ModelAccuracy> = ${JSON.stringify(accuracy, null, 1)};`);
  fs.writeFileSync(MODEL_TS, ts);
}

function readGenerated(name) {
  const ts = fs.readFileSync(MODEL_TS, 'utf8');
  const m = ts.match(new RegExp(`// BEGIN GENERATED ${name}[^\\n]*\\n[^=]*=\\s*([\\s\\S]*?);\\n// END GENERATED ${name}`));
  return m ? JSON.parse(m[1]) : null;
}

async function main() {
  const sports = Object.keys(CFG).filter((s) => !ONLY.length || ONLY.includes(s));
  const fitted = {};
  const stored = fs.existsSync(MODEL_TS) ? readGenerated('MODEL_DATA') : null;
  if (STAGE === 'fit' || STAGE === 'all') {
    for (const sport of sports) {
      console.log(`\nfitting ${sport} ...`);
      fitted[sport] = await fitSport(sport);
      printFit(sport, fitted[sport]);
    }
  }
  const validation = {};
  if (STAGE === 'validate' || STAGE === 'all') {
    for (const sport of sports) {
      const model = fitted[sport]?.model ?? stored?.[SPORTS[sport].otd];
      if (!model) { console.log(`no model for ${sport}; run --stage fit --write first`); continue; }
      validation[sport] = (CFG[sport].route ?? (SPORTS[sport].kind === 'basketball' ? 'gamelog' : 'box')) === 'gamelog' ? await validateGamelog(sport, model) : await validateBox(sport, model);
      const v = validation[sport];
      console.log(`\n=== ${sport.toUpperCase()} validation (${v.route} route, season ${v.season})`);
      console.log(JSON.stringify(v.annual, (k, x) => (typeof x === 'number' ? +x.toFixed(3) : x)));
      if (v.perGame) console.log('  per-game', JSON.stringify(v.perGame, (k, x) => (typeof x === 'number' ? +x.toFixed(3) : x)), 'notFound', v.notFound.slice(0, 5));
      else console.log(`  matched ${v.matched}/${v.rbPlayers} (unmatched ${v.unmatched}, ambiguous ${v.ambiguous}); top150 not found: ${v.top150UnmatchedN} e.g. ${v.top150Unmatched.slice(0, 6).join(', ')}`);
    }
  }
  if (WRITE) {
    const models = stored ? { ...stored } : {};
    for (const [sport, r] of Object.entries(fitted)) models[SPORTS[sport].otd] = { ...r.model, groups: r.model.groups.map(({ hingeLog, ...g }) => g) };
    const accOld = fs.existsSync(MODEL_TS) ? readGenerated('MODEL_ACCURACY') ?? {} : {};
    const acc = { ...accOld };
    const report = fs.existsSync(REPORT_JSON) ? J(REPORT_JSON) : {};
    for (const sport of sports) {
      const f = fitted[sport];
      if (f) {
        acc[SPORTS[sport].otd] = accuracyEntry(sport, f, validation[sport]);
        report[sport] = { ...(report[sport] ?? {}), fit: acc[SPORTS[sport].otd], hingeLog: Object.fromEntries(f.model.groups.map((g) => [g.id, g.hingeLog])), samples: sampleGames(sport, f.model, f.ev.rows.map((x) => x.row)) };
      } else if (validation[sport] && acc[SPORTS[sport].otd]) {
        const v = validation[sport];
        const cur = acc[SPORTS[sport].otd];
        cur.annual = accuracyEntry(sport, { ev: { all: { n: cur.n, rating: { r2: cur.r2Rating, mae: cur.maeRating }, rax: {} }, byGroup: {} }, clean: { all: { rating: {}, rax: {} } }, model: { trainSeasons: cur.trainSeasons, testSeason: cur.testSeason }, counts: { train: cur.nTrain } }, v).annual;
        if (v.perGame) cur.pipelinePerGame = accuracyEntry(sport, { ev: { all: { rating: {}, rax: {} }, byGroup: {} }, clean: { all: { rating: {}, rax: {} } }, model: { trainSeasons: [], testSeason: 0 }, counts: { train: 0 } }, v).pipelinePerGame;
        cur.spearmanSeasonTotal = (cur.annual.top150 ?? cur.annual.top30)?.spearman ?? null;
        report[sport] = { ...(report[sport] ?? {}), annual: cur.annual, validation: { ...v, pairs: v.pairs?.slice(0, 400) } };
      }
      if (validation[sport] && f) report[sport].validation = { ...validation[sport], pairs: validation[sport].pairs?.slice(0, 400) };
    }
    for (const k of Object.keys(models)) delete models[k].key;
    writeGenerated(Object.keys(fitted).length ? models : null, acc);
    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 1));
    console.log(`\nwrote ${path.relative(ROOT, MODEL_TS)} and ${path.relative(ROOT, REPORT_JSON)}`);
  }
}

await main();
