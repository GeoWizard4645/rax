/**
 * Shared data layer for the rating-model scripts (fit-rating-model.mjs, build-modeled-snapshot.mjs).
 * Plain Node >= 20, no dependencies.
 *
 *  - polite, cached HTTP: <= 3 requests in flight, >= 150 ms between request starts, every raw response is stored
 *    gzip-compressed under CACHE_DIR (env RAX_MODEL_CACHE, default $TMPDIR/rax-rating-model-cache) so re-runs never re-fetch
 *  - Rateboard `/api/rax` readers (the ground truth: Real's own game rating + per-game Rax; used with the owner's permission)
 *  - ESPN public JSON readers (scoreboard, summary/box score, athlete gamelog, search) + stat normalisers that produce the
 *    exact stat keys `shared/ratingModel.ts` consumes
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export const CACHE_DIR = path.resolve(process.env.RAX_MODEL_CACHE || path.join(os.tmpdir(), 'rax-rating-model-cache'));
const RB_UA = 'rax-super-suite/0.1 (+https://rax.vivaanshahani.com)';
const MAX_INFLIGHT = 3;
const MIN_GAP_MS = 150;

/* ------------------------------ polite cached fetch ------------------------------ */

let lastStart = 0;
let inflight = 0;
async function gate() {
  for (;;) {
    const now = Date.now();
    if (inflight < MAX_INFLIGHT && now - lastStart >= MIN_GAP_MS) {
      lastStart = now;
      inflight++;
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** GET a URL as JSON through the disk cache. Returns null for 400/404 (cached), undefined if it failed after retries. */
export async function cachedGet(url, { rateboard = false, retries = 3 } = {}) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  const dir = path.join(CACHE_DIR, h.slice(0, 2));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${h}.gz`);
  if (fs.existsSync(file)) {
    const t = zlib.gunzipSync(fs.readFileSync(file)).toString();
    return t === '__404__' ? null : JSON.parse(t);
  }
  for (let a = 0; a < retries; a++) {
    await gate();
    try {
      const res = await fetch(url, { headers: rateboard ? { 'User-Agent': RB_UA } : {} });
      inflight--;
      if (res.status === 404 || res.status === 400) {
        fs.writeFileSync(file, zlib.gzipSync('__404__'));
        return null;
      }
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
        continue;
      }
      const text = await res.text();
      const j = JSON.parse(text);
      fs.writeFileSync(file, zlib.gzipSync(text));
      return j;
    } catch {
      inflight = Math.max(0, inflight - 1);
      await new Promise((r) => setTimeout(r, 1000 * (a + 1)));
    }
  }
  return undefined;
}

/** Ordered map with at most `conc` workers (the global gate above still enforces the 3-in-flight / 150 ms limits). */
export async function pmap(items, fn, conc = 3) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

/* ------------------------------ sports ------------------------------ */

/** key = Rateboard sport key. */
export const SPORTS = {
  nba: { otd: 'NBA', league: 'basketball/nba', kind: 'basketball' },
  wnba: { otd: 'WNBA', league: 'basketball/wnba', kind: 'basketball' },
  ncaam: { otd: 'CBB', league: 'basketball/mens-college-basketball', kind: 'basketball', scoreboardExtra: '&groups=50&limit=400' },
  nfl: { otd: 'NFL', league: 'football/nfl', kind: 'football' },
  ncaaf: { otd: 'CFB', league: 'football/college-football', kind: 'football', scoreboardExtra: '&groups=80&limit=300' },
  nhl: { otd: 'NHL', league: 'hockey/nhl', kind: 'hockey' },
  mlb: { otd: 'MLB', league: 'baseball/mlb', kind: 'baseball' },
};

/** Rax's season label for a game day (YYYY-MM-DD) — same convention as shared/rax.ts `seasonLabel`. */
export function seasonLabel(sport, day) {
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  if (['nfl', 'nhl', 'ncaaf'].includes(sport)) return m >= 7 ? y : y - 1;
  if (['nba', 'ncaam'].includes(sport)) return m >= 8 ? y + 1 : y;
  return y;
}

export const addDays = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const dayDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
export const ymd = (d) => d.replaceAll('-', '');

/** America/New_York calendar date of an ISO timestamp (how Rateboard dates US games). */
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
export const etDay = (iso) => ET.format(new Date(iso));

/** Small seeded RNG (LCG) so sampled days are reproducible. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------ Rateboard ------------------------------ */

export const RB_BASE = 'https://rateboard-cgi.pages.dev/api/rax';

export function rbUrl(sport, season, o = {}) {
  const p = new URLSearchParams({
    gamelog: 'query',
    mode: o.mode ?? 'games',
    sport,
    season: String(season),
    seasons: `${sport}:${season}`,
    sort: o.sort ?? 'rax',
    dir: o.dir ?? 'desc',
    limit: String(o.limit ?? 500),
    offset: String(o.offset ?? 0),
  });
  for (const k of ['q', 'from', 'to', 'fromMD', 'toMD']) if (o[k]) p.set(k, o[k]);
  return `${RB_BASE}?${p}`;
}
export const rbGet = (sport, season, o) => cachedGet(rbUrl(sport, season, o), { rateboard: true });

/** All game rows of one calendar day. */
export async function rbDay(sport, season, day) {
  const out = [];
  for (let off = 0; ; off += 500) {
    const j = await rbGet(sport, season, { sort: 'rax', offset: off, from: day, to: day });
    if (!j) break;
    out.push(...j.rows);
    if (off + 500 >= j.total) break;
  }
  return out;
}

/** `pages` evenly spaced 500-row pages of a sport-season sorted by day (all of them if pages >= total pages). */
export async function rbSeasonPages(sport, season, pages) {
  const first = await rbGet(sport, season, { sort: 'day', offset: 0 });
  if (!first) return [];
  const nPages = Math.ceil(first.total / 500);
  const idx = new Set([0]);
  if (pages >= nPages) for (let i = 1; i < nPages; i++) idx.add(i);
  else for (let i = 1; i < pages; i++) idx.add(Math.floor((i * (nPages - 1)) / (pages - 1)));
  const rest = [...idx].filter((i) => i > 0).sort((a, b) => a - b);
  const got = await pmap(rest, (i) => rbGet(sport, season, { sort: 'day', offset: i * 500 }));
  return [first, ...got].flatMap((p) => p?.rows ?? []);
}

/** Every player-season row (mode=players): season totals + owners. */
export async function rbPlayers(sport, season) {
  const first = await rbGet(sport, season, { mode: 'players', sort: 'rax', offset: 0 });
  if (!first) return [];
  const offs = [];
  for (let o = 500; o < first.total; o += 500) offs.push(o);
  const rest = await pmap(offs, (o) => rbGet(sport, season, { mode: 'players', sort: 'rax', offset: o }));
  return [first, ...rest].flatMap((p) => p?.rows ?? []);
}

/** All games of one player-season (Rateboard name search; filter by playerId afterwards). */
export async function rbPlayerGames(sport, season, name, playerId) {
  const j = await rbGet(sport, season, { sort: 'day', q: name, limit: 500 });
  const rows = j?.rows ?? [];
  return playerId == null ? rows : rows.filter((r) => String(r.playerId) === String(playerId));
}

/* ------------------------------ names ------------------------------ */

export const norm = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* ------------------------------ ESPN: scoreboard / summary ------------------------------ */

const num = (v) => {
  if (v == null || v === '--' || v === '') return 0;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const pair = (v) => {
  const m = String(v).match(/(\d+)\s*[-/]\s*(\d+)/);
  return m ? [+m[1], +m[2]] : [0, 0];
};
const clock = (v) => {
  const m = String(v).match(/^(\d+):(\d+)$/);
  return m ? +m[1] + +m[2] / 60 : num(v);
};

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_WEB = 'https://site.web.api.espn.com/apis/common/v3/sports';

export async function espnEvents(sport, day) {
  const s = SPORTS[sport];
  const j = await cachedGet(`${ESPN}/${s.league}/scoreboard?dates=${ymd(day)}${s.scoreboardExtra ?? ''}`);
  return (j?.events ?? []).map((e) => {
    const c = e.competitions[0];
    const h = c.competitors.find((x) => x.homeAway === 'home');
    const a = c.competitors.find((x) => x.homeAway === 'away');
    return {
      id: e.id,
      date: e.date,
      status: e.status?.type?.name,
      seasonType: e.season?.type,
      home: { abbr: h.team.abbreviation, score: +h.score, id: h.team.id },
      away: { abbr: a.team.abbreviation, score: +a.score, id: a.team.id },
    };
  });
}
export const espnSummary = (sport, id) => cachedGet(`${ESPN}/${SPORTS[sport].league}/summary?event=${id}`);

/**
 * Box score → [{id, name, team, teamId, homeAway, pos, s}] where `s` holds the normalised stat keys used by the model:
 *   basketball: min pts fgm fga tpm tpa ftm fta reb ast tov stl blk pf pm
 *   football:   pcmp patt pyds ptd pint sacked ratt ryds rtd rec tgt recyds rectd fum fuml fumrec tkl solo sacks tfl pd qbh dtd
 *               int intyds inttd kr kryds krtd pr pryds prtd fgm fga xpm xpa fglong punts puntyds
 *   hockey:     skater g=0 goals ast sog blk hit tk gv pm toi pim fow fol shift ppt sht | goalie g=1 ga sa sv toi
 *   baseball:   hitter p=0 ab r h rbi hr bb k | pitcher p=1 outs h r er bb k hr pit str
 */
export function boxPlayers(sport, sum) {
  const out = [];
  if (!sum?.boxscore?.players) return out;
  const hdr = sum.header?.competitions?.[0]?.competitors ?? [];
  const ha = Object.fromEntries(hdr.map((c) => [c.team.id, c.homeAway]));
  for (const t of sum.boxscore.players) {
    const byId = new Map();
    for (const cat of t.statistics ?? []) {
      for (const a of cat.athletes ?? []) {
        const id = a.athlete.id;
        let p = byId.get(id);
        if (!p) {
          p = { id, name: a.athlete.displayName, team: t.team.abbreviation, teamId: t.team.id, homeAway: ha[t.team.id], pos: a.athlete.position?.abbreviation ?? null, raw: {}, cat: [], dnp: !!a.didNotPlay };
          byId.set(id, p);
          out.push(p);
        }
        if (!p.pos && a.athlete.position?.abbreviation) p.pos = a.athlete.position.abbreviation;
        (cat.keys ?? []).forEach((k, i) => {
          p.raw[`${cat.name}:${k}`] = (a.stats ?? [])[i];
        });
        p.cat.push(cat.name);
      }
    }
  }
  return out.map((p) => ({ id: p.id, name: p.name, team: p.team, teamId: p.teamId, homeAway: p.homeAway, pos: p.pos, dnp: p.dnp, cat: p.cat, s: normStats(sport, p) }));
}

function normStats(sport, p) {
  const kind = SPORTS[sport].kind;
  const G = (k) => {
    for (const kk of Object.keys(p.raw)) if (kk.endsWith(':' + k)) return p.raw[kk];
    return undefined;
  };
  if (kind === 'basketball') {
    const [fgm, fga] = pair(G('fieldGoalsMade-fieldGoalsAttempted'));
    const [tpm, tpa] = pair(G('threePointFieldGoalsMade-threePointFieldGoalsAttempted'));
    const [ftm, fta] = pair(G('freeThrowsMade-freeThrowsAttempted'));
    return { min: num(G('minutes')), pts: num(G('points')), fgm, fga, tpm, tpa, ftm, fta, reb: num(G('rebounds')), ast: num(G('assists')), tov: num(G('turnovers')), stl: num(G('steals')), blk: num(G('blocks')), pf: num(G('fouls')), pm: num(G('plusMinus')) };
  }
  if (kind === 'football') {
    const o = {};
    for (const [k, v] of Object.entries(p.raw)) {
      const [c, key] = k.split(':');
      if (key === 'completions/passingAttempts') [o.pcmp, o.patt] = pair(v);
      else if (key === 'sacks-sackYardsLost') o.sacked = pair(v)[0];
      else if (c === 'passing' && key === 'passingYards') o.pyds = num(v);
      else if (c === 'passing' && key === 'passingTouchdowns') o.ptd = num(v);
      else if (c === 'passing' && key === 'interceptions') o.pint = num(v);
      else if (c === 'rushing' && key === 'rushingAttempts') o.ratt = num(v);
      else if (c === 'rushing' && key === 'rushingYards') o.ryds = num(v);
      else if (c === 'rushing' && key === 'rushingTouchdowns') o.rtd = num(v);
      else if (c === 'receiving' && key === 'receptions') o.rec = num(v);
      else if (c === 'receiving' && key === 'receivingYards') o.recyds = num(v);
      else if (c === 'receiving' && key === 'receivingTouchdowns') o.rectd = num(v);
      else if (c === 'receiving' && key === 'receivingTargets') o.tgt = num(v);
      else if (c === 'fumbles' && key === 'fumbles') o.fum = num(v);
      else if (c === 'fumbles' && key === 'fumblesLost') o.fuml = num(v);
      else if (c === 'fumbles' && key === 'fumblesRecovered') o.fumrec = num(v);
      else if (c === 'defensive' && key === 'totalTackles') o.tkl = num(v);
      else if (c === 'defensive' && key === 'soloTackles') o.solo = num(v);
      else if (c === 'defensive' && key === 'sacks') o.sacks = num(v);
      else if (c === 'defensive' && key === 'tacklesForLoss') o.tfl = num(v);
      else if (c === 'defensive' && key === 'passesDefended') o.pd = num(v);
      else if (c === 'defensive' && (key === 'QBHits' || key === 'hurries')) o.qbh = num(v);
      else if (c === 'defensive' && key === 'defensiveTouchdowns') o.dtd = num(v);
      else if (c === 'interceptions' && key === 'interceptions') o.int = num(v);
      else if (c === 'interceptions' && key === 'interceptionYards') o.intyds = num(v);
      else if (c === 'interceptions' && key === 'interceptionTouchdowns') o.inttd = num(v);
      else if (c === 'kickReturns' && key === 'kickReturns') o.kr = num(v);
      else if (c === 'kickReturns' && key === 'kickReturnYards') o.kryds = num(v);
      else if (c === 'kickReturns' && key === 'kickReturnTouchdowns') o.krtd = num(v);
      else if (c === 'puntReturns' && key === 'puntReturns') o.pr = num(v);
      else if (c === 'puntReturns' && key === 'puntReturnYards') o.pryds = num(v);
      else if (c === 'puntReturns' && key === 'puntReturnTouchdowns') o.prtd = num(v);
      else if (c === 'kicking' && key === 'fieldGoalsMade/fieldGoalAttempts') [o.fgm, o.fga] = pair(v);
      else if (c === 'kicking' && key === 'extraPointsMade/extraPointAttempts') [o.xpm, o.xpa] = pair(v);
      else if (c === 'kicking' && key === 'longFieldGoalMade') o.fglong = num(v);
      else if (c === 'punting' && key === 'punts') o.punts = num(v);
      else if (c === 'punting' && key === 'puntYards') o.puntyds = num(v);
    }
    return o;
  }
  if (kind === 'hockey') {
    if (p.cat.includes('goalies')) return { g: 1, ga: num(G('goalsAgainst')), sa: num(G('shotsAgainst')), sv: num(G('saves')), toi: clock(G('timeOnIce')) };
    return { g: 0, goals: num(G('goals')), ast: num(G('assists')), sog: num(G('shotsTotal')), blk: num(G('blockedShots')), hit: num(G('hits')), tk: num(G('takeaways')), gv: num(G('giveaways')), pm: num(G('plusMinus')), toi: clock(G('timeOnIce')), pim: num(G('penaltyMinutes')), fow: num(G('faceoffsWon')), fol: num(G('faceoffsLost')), shift: num(G('shifts')), ppt: clock(G('powerPlayTimeOnIce')), sht: clock(G('shortHandedTimeOnIce')) };
  }
  if (kind === 'baseball') {
    if (G('earnedRuns') !== undefined && G('fullInnings.partInnings') !== undefined) {
      const ip = String(G('fullInnings.partInnings')).split('.');
      const outs = +ip[0] * 3 + +(ip[1] || 0);
      const [pit, str] = pair(G('pitches-strikes'));
      return { p: 1, outs, h: num(G('hits')), r: num(G('runs')), er: num(G('earnedRuns')), bb: num(G('walks')), k: num(G('strikeouts')), hr: num(G('homeRuns')), pit, str };
    }
    return { p: 0, ab: num(G('atBats')), r: num(G('runs')), h: num(G('hits')), rbi: num(G('RBIs')), hr: num(G('homeRuns')), bb: num(G('walks')), k: num(G('strikeouts')) };
  }
  return {};
}

/* ------------------------------ ESPN: athlete gamelog (basketball) ------------------------------ */

export const espnGamelog = (sport, athleteId, season) => cachedGet(`${ESPN_WEB}/${SPORTS[sport].league}/athletes/${athleteId}/gamelog?season=${season}`);
export const espnSearch = (query, sportPath) => cachedGet(`https://site.web.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(query)}&limit=8&type=player${sportPath ? `&${sportPath}` : ''}`);
/** ESPN season leaders table (one page). sort e.g. `offensive.avgPoints:desc`. */
export const espnByAthlete = (sport, season, sort, page = 1, limit = 100, seasonType = 2) =>
  cachedGet(`${ESPN_WEB}/${SPORTS[sport].league}/statistics/byathlete?region=us&lang=en&contentorigin=espn&isqualified=${sport === 'ncaam' ? 'true' : 'false'}&page=${page}&limit=${limit}&sort=${encodeURIComponent(sort)}&season=${season}&seasontype=${seasonType}`);
export const espnAthlete = (sport, id) => cachedGet(`${ESPN_WEB}/${SPORTS[sport].league}/athletes/${id}`);

/** Basketball gamelog → [{eventId, day (ET), seasonType, home, won, teamScore, oppScore, opp, s}] (preseason skipped). */
export function parseBasketballGamelog(sport, g) {
  const out = [];
  if (!g?.names || !g.seasonTypes) return out;
  const idx = (n) => g.names.indexOf(n);
  const col = {
    min: idx('minutes'), fg: idx('fieldGoalsMade-fieldGoalsAttempted'), tp: idx('threePointFieldGoalsMade-threePointFieldGoalsAttempted'), ft: idx('freeThrowsMade-freeThrowsAttempted'),
    reb: idx('totalRebounds') >= 0 ? idx('totalRebounds') : idx('rebounds'), ast: idx('assists'), blk: idx('blocks'), stl: idx('steals'), pf: idx('fouls'), tov: idx('turnovers'), pts: idx('points'),
  };
  for (const st of g.seasonTypes) {
    const name = String(st.displayName || '');
    if (/pre-?season/i.test(name)) continue;
    const post = /post/i.test(name);
    for (const cat of st.categories ?? []) {
      for (const ev of cat.events ?? []) {
        const meta = g.events?.[ev.eventId];
        if (!meta) continue;
        const v = ev.stats ?? [];
        const [fgm, fga] = pair(v[col.fg]);
        const [tpm, tpa] = pair(v[col.tp]);
        const [ftm, fta] = pair(v[col.ft]);
        const home = meta.atVs === 'vs';
        const teamScore = num(home ? meta.homeTeamScore : meta.awayTeamScore);
        const oppScore = num(home ? meta.awayTeamScore : meta.homeTeamScore);
        out.push({
          eventId: ev.eventId, day: etDay(meta.gameDate), seasonType: post ? 'postseason' : 'regularseason', post, home, won: meta.gameResult === 'W', teamScore, oppScore, opp: meta.opponent?.abbreviation,
          s: { min: num(v[col.min]), pts: num(v[col.pts]), fgm, fga, tpm, tpa, ftm, fta, reb: num(v[col.reb]), ast: num(v[col.ast]), tov: num(v[col.tov]), stl: num(v[col.stl]), blk: num(v[col.blk]), pf: num(v[col.pf]) },
        });
      }
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/* ------------------------------ season enumeration (box-score route) ------------------------------ */

/** Approximate first/last day to scan for each Rateboard season label (empty days just cost one scoreboard request). */
export const SEASON_WINDOW = {
  nfl: { 2023: ['2023-09-07', '2024-02-12'], 2024: ['2024-09-05', '2025-02-10'], 2025: ['2025-09-04', '2026-02-09'] },
  ncaaf: { 2023: ['2023-08-26', '2024-01-09'], 2024: ['2024-08-24', '2025-01-21'], 2025: ['2025-08-23', '2026-01-21'] },
  nhl: { 2023: ['2023-10-10', '2024-06-25'], 2024: ['2024-10-04', '2025-06-25'], 2025: ['2025-10-07', '2026-06-21'] },
  mlb: { 2023: ['2023-03-30', '2023-11-02'], 2024: ['2024-03-20', '2024-10-31'], 2025: ['2025-03-18', '2025-11-02'] },
  nba: { 2024: ['2023-10-24', '2024-06-18'], 2025: ['2024-10-22', '2025-06-23'], 2026: ['2025-10-21', '2026-06-21'] },
  wnba: { 2024: ['2024-05-14', '2024-10-21'], 2025: ['2025-05-16', '2025-10-21'] },
  ncaam: { 2025: ['2024-11-04', '2025-04-09'], 2026: ['2025-11-03', '2026-04-09'] },
};

/**
 * Whole-league box-score pass for one completed season: every final regular-season / postseason game's box score ->
 * Map(espnAthleteId -> {id, name, team, games:[{eventId, day, team, opp, home, won, post, teamScore, oppScore, pos, s}]}).
 * ~1 scoreboard request per calendar day + 1 summary request per game (all cached).
 */
export async function collectSeasonBox(sport, season, { onProgress, topTeams } = {}) {
  const [a, b] = SEASON_WINDOW[sport][season];
  const days = [];
  for (let d = a; d <= b; d = addDays(d, 1)) days.push(d);
  const dayEvents = await pmap(days, (d) => espnEvents(sport, d));
  const seen = new Set();
  const evs = [];
  dayEvents.forEach((list) => {
    for (const e of list) {
      if (e.status !== 'STATUS_FINAL' || seen.has(e.id)) continue;
      if (e.seasonType !== 2 && e.seasonType !== 3) continue; // skip pre-season / exhibitions / all-star
      seen.add(e.id);
      evs.push(e);
    }
  });
  // Optional subset (college basketball: too many games): keep only events involving the `topTeams` teams with most wins.
  let use = evs;
  let teamSet = null;
  if (topTeams) {
    const wins = new Map();
    for (const e of evs) {
      if (e.seasonType !== 2) continue;
      const w = e.home.score > e.away.score ? e.home.abbr : e.away.abbr;
      wins.set(w, (wins.get(w) ?? 0) + 1);
    }
    teamSet = new Set([...wins.entries()].sort((a, b) => b[1] - a[1]).slice(0, topTeams).map(([t]) => t));
    use = evs.filter((e) => teamSet.has(e.home.abbr) || teamSet.has(e.away.abbr));
  }
  const players = new Map();
  let done = 0;
  await pmap(use, async (e) => {
    const sum = await espnSummary(sport, e.id);
    if (++done % 200 === 0) onProgress?.(`${sport} ${season}: ${done}/${use.length} box scores`);
    if (!sum) return;
    const day = etDay(e.date);
    for (const p of boxPlayers(sport, sum)) {
      const home = p.homeAway === 'home';
      const ts = home ? e.home.score : e.away.score;
      const os = home ? e.away.score : e.home.score;
      let rec = players.get(p.id);
      if (!rec) players.set(p.id, (rec = { id: p.id, name: p.name, team: p.team, games: [] }));
      rec.team = p.team;
      rec.games.push({ eventId: e.id, day, team: p.team, opp: home ? e.away.abbr : e.home.abbr, home, won: ts > os, post: e.seasonType === 3, teamScore: ts, oppScore: os, pos: p.pos, s: p.s });
    }
  });
  // In a team subset keep only players of the chosen teams (opponents' players would have partial seasons).
  if (teamSet) for (const [id, p] of players) if (!teamSet.has(p.team)) players.delete(id);
  return { players, events: use.length, teams: teamSet ? [...teamSet] : null };
}
