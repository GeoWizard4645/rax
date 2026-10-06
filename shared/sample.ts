/**
 * Deterministic SAMPLE data.
 *
 * The spec's upstream feeds (Real's auction/market/game endpoints) can't be verified from
 * here, so wherever a live feed isn't configured the app falls back to this generator and
 * labels the panel SAMPLE. Prices, bids and bidder handles are synthetic; player names are
 * only used so that matching against a real collection can be demonstrated.
 *
 * Everything is seeded: same hour => same data, so reloads are stable and tests are exact.
 */
import type { HistoricalGame, Rarity, Sport } from '../src/types/real';
import type {
  AuctionBid,
  CatalystTag,
  ContenderActivity,
  PlayerSeries,
  SeriesPoint,
} from '../src/types/market';
import { median, perRatingPrice, playerKey, RARITY_MULT } from './formulas';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* ------------------------------ rng ------------------------------ */

function xfnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 seeded from a string. */
export function rng(seed: string): () => number {
  let a = xfnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const gauss = (r: () => number) => {
  const u = Math.max(r(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
};
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const hourFloor = (now: number) => Math.floor(now / HOUR) * HOUR;

/* ------------------------------ players ------------------------------ */

export const SAMPLE_POOL: Record<Sport, string[]> = {
  NFL: ['Josh Allen', 'Patrick Mahomes', 'Lamar Jackson', 'Jalen Hurts', 'Justin Jefferson', "Ja'Marr Chase", 'CeeDee Lamb', 'Christian McCaffrey', 'Joe Burrow', 'Saquon Barkley', 'Jaxon Smith-Njigba', 'Micah Parsons', 'Puka Nacua', 'Amon-Ra St. Brown'],
  NBA: ['Nikola Jokic', 'Luka Doncic', 'Shai Gilgeous-Alexander', 'Giannis Antetokounmpo', 'Jayson Tatum', 'Victor Wembanyama', 'Anthony Edwards', 'Stephen Curry', 'LeBron James', 'Kevin Durant', 'Devin Booker', 'Jalen Brunson', 'Tyrese Haliburton', 'Cade Cunningham'],
  MLB: ['Shohei Ohtani', 'Aaron Judge', 'Mookie Betts', 'Juan Soto', 'Bobby Witt Jr.', 'Paul Skenes', 'Corbin Carroll', 'Julio Rodriguez', 'Gunnar Henderson', 'Freddie Freeman', 'Yordan Alvarez', 'Elly De La Cruz', 'Jackson Chourio', 'Tarik Skubal'],
  NHL: ['Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews', 'Leon Draisaitl', 'Cale Makar', 'Nikita Kucherov', 'David Pastrnak', 'Sidney Crosby', 'Alex Ovechkin', 'Jack Hughes', 'Matthew Tkachuk', 'Quinn Hughes', 'Connor Bedard', 'Macklin Celebrini'],
  CBB: ['Cooper Flagg', 'AJ Dybantsa', 'Dylan Harper', 'VJ Edgecombe', 'Ace Bailey', 'Kon Knueppel', 'Johni Broome', 'Walter Clayton Jr.', 'Hunter Dickinson', 'Mark Sears', 'Braden Smith', 'Caleb Love', 'Zach Edey', 'Reed Sheppard'],
  CFB: ['Julian Sayin', 'Jeremiah Smith', 'Arch Manning', 'Ryan Williams', 'Dante Moore', 'Fernando Mendoza', 'Carnell Tate', 'Jeremiyah Love', 'Cade Klubnik', 'Garrett Nussmeier', 'Luther Burden III', 'Travis Hunter', 'Shedeur Sanders', 'Ashton Jeanty'],
  PGA: ['Scottie Scheffler', 'Rory McIlroy', 'Xander Schauffele', 'Jon Rahm', 'Collin Morikawa', 'Ludvig Aberg', 'Bryson DeChambeau', 'Tommy Fleetwood', 'Viktor Hovland', 'Wyndham Clark', 'Hideki Matsuyama', 'Justin Thomas', 'Patrick Cantlay', 'Brooks Koepka'],
  UFC: ['Jon Jones', 'Islam Makhachev', 'Ilia Topuria', 'Alex Pereira', "Sean O'Malley", 'Dricus du Plessis', 'Tom Aspinall', 'Max Holloway', 'Leon Edwards', 'Merab Dvalishvili', 'Charles Oliveira', 'Khamzat Chimaev', 'Belal Muhammad', 'Alexandre Pantoja'],
};

/** Base Rax per rating point, by rarity — synthetic but monotone in tier. */
const BASE_PRP: Record<Rarity, number> = {
  Common: 1.4, Uncommon: 2.2, Rare: 3.6, Epic: 6.5, Legendary: 11, Mystic: 19, Iconic: 38,
};

const RARITY_BY_RATING = (rating: number, r: () => number): Rarity => {
  const x = (rating - 70) / 29 + (r() - 0.5) * 0.45; // 0..1 with noise
  if (x > 0.9) return 'Iconic';
  if (x > 0.72) return 'Mystic';
  if (x > 0.55) return 'Legendary';
  if (x > 0.4) return 'Epic';
  if (x > 0.25) return 'Rare';
  if (x > 0.1) return 'Uncommon';
  return 'Common';
};

export interface SamplePlayer {
  key: string;
  name: string;
  sport: Sport;
  rating: number;
  rarity: Rarity;
  /** Fair per-rating price for this player's tracked card. */
  basePrp: number;
  hot: boolean;
  cheap: boolean;
}

let _players: SamplePlayer[] | null = null;
export function samplePlayers(): SamplePlayer[] {
  if (_players) return _players;
  const out: SamplePlayer[] = [];
  for (const sport of Object.keys(SAMPLE_POOL) as Sport[]) {
    for (const name of SAMPLE_POOL[sport]) {
      const r = rng(`player:${sport}:${name}`);
      const rating = Math.round(70 + r() * 29);
      const rarity = RARITY_BY_RATING(rating, r);
      const hot = r() < 0.14;
      const cheap = !hot && r() < 0.1;
      out.push({
        key: playerKey(sport, name),
        name,
        sport,
        rating,
        rarity,
        basePrp: BASE_PRP[rarity] * (0.9 + r() * 0.25) * (cheap ? 0.6 : 1),
        hot,
        cheap,
      });
    }
  }
  _players = out;
  return out;
}

/* ------------------------------ series ------------------------------ */

const diurnal = (t: number) => 0.55 + 0.45 * Math.sin(((new Date(t).getUTCHours() - 14) / 24) * 2 * Math.PI);

/** Hourly points for the last 7 days, daily points for days 8–30. */
export function sampleSeries(now: number): PlayerSeries[] {
  const end = hourFloor(now);
  return samplePlayers().map((p) => {
    const r = rng(`series:${p.key}:${Math.floor(end / HOUR)}`);
    const rr = rng(`walk:${p.key}`); // price walk independent of "now" shifts
    const P0 = p.basePrp * p.rating;
    const hours = 30 * 24;
    const hourly: SeriesPoint[] = [];
    let price = P0 * (0.97 + rr() * 0.06);
    const lambda = 1.5 + rr() * 5 + (RARITY_MULT[p.rarity] > 2.5 ? 0 : 1.5);
    for (let h = hours - 1; h >= 0; h--) {
      const t = end - h * HOUR;
      const inSpike = p.hot && h < 20;
      const drift = inSpike ? 0.012 + r() * 0.01 : 0;
      const open = price;
      price = price * (1 + gauss(r) * 0.006 + drift + (P0 - price) / P0 * 0.02);
      const close = price;
      const wick = Math.abs(gauss(r)) * 0.004;
      const high = Math.max(open, close) * (1 + wick);
      const low = Math.min(open, close) * (1 - wick);
      const base = lambda * (0.4 + diurnal(t));
      const mult = inSpike ? 2.4 + r() * 2.2 : 1;
      const volume = Math.max(0, Math.round(base * mult + gauss(r) * Math.sqrt(base)));
      hourly.push({
        t,
        volume,
        avgBid: close * (0.97 + r() * 0.06),
        medPrp: close / p.rating,
        open,
        high,
        low,
        close,
      });
    }
    // Days 8–30 collapse into daily buckets (mirrors what the KV rollup stores).
    const points: SeriesPoint[] = [];
    const cut = end - 7 * DAY;
    const old = hourly.filter((x) => x.t <= cut);
    for (let d = 0; d < old.length; d += 24) {
      const g = old.slice(d, d + 24);
      const vol = g.reduce((a, b) => a + b.volume, 0);
      points.push({
        t: g[g.length - 1].t,
        volume: vol,
        avgBid: vol > 0 ? g.reduce((a, b) => a + b.avgBid * b.volume, 0) / vol : g[g.length - 1].avgBid,
        medPrp: median(g.map((x) => x.medPrp)),
        open: g[0].open,
        high: Math.max(...g.map((x) => x.high)),
        low: Math.min(...g.map((x) => x.low)),
        close: g[g.length - 1].close,
      });
    }
    points.push(...hourly.filter((x) => x.t > cut));
    return { key: p.key, playerName: p.name, sport: p.sport, rating: p.rating, rarity: p.rarity, points };
  });
}

/** Catalyst tags (sample): schedule/injury/streak feeds aren't connected, so these are synthetic. */
export function sampleCatalysts(now: number): Record<string, CatalystTag[]> {
  const day = Math.floor(now / DAY);
  const out: Record<string, CatalystTag[]> = {};
  for (const p of samplePlayers()) {
    const r = rng(`cat:${p.key}:${day}`);
    const tags: CatalystTag[] = [];
    if (p.hot || r() < 0.2) tags.push('Game Tonight');
    if (r() < 0.1) tags.push('OTD Anniversary');
    if (r() < 0.07) tags.push('Injury Replacement');
    if (p.hot ? r() < 0.5 : r() < 0.1) tags.push('Streak Multiplier');
    out[p.key] = tags;
  }
  return out;
}

/* ------------------------------ auctions ------------------------------ */

export interface SampleAuctionData {
  bids: AuctionBid[];
  baselines: Record<string, number>;
  contenders: ContenderActivity[];
}

const HANDLES = ['sample_hawk', 'sample_dune', 'sample_fox', 'sample_orbit', 'sample_nova', 'sample_rook', 'sample_ember', 'sample_quill', 'sample_atlas', 'sample_zephyr', 'sample_ridge', 'sample_cobalt', 'sample_lynx', 'sample_vega', 'sample_onyx', 'sample_mesa', 'sample_flint', 'sample_juno', 'sample_pike', 'sample_kite'];

export function sampleAuctions(now: number, series: PlayerSeries[] = sampleSeries(now)): SampleAuctionData {
  const end = hourFloor(now);
  const bySeries = new Map(series.map((s) => [s.key, s]));
  const baselines: Record<string, number> = {};
  for (const s of series) {
    const w = s.points.filter((x) => x.t > end - 7 * DAY && x.t <= end - 1 * HOUR);
    baselines[s.key] = median(w.map((x) => x.medPrp));
  }

  const bids: AuctionBid[] = [];
  for (const p of samplePlayers()) {
    const r = rng(`auc:${p.key}:${Math.floor(end / HOUR)}`);
    const s = bySeries.get(p.key)!;
    const n = p.hot ? 2 + Math.floor(r() * 3) : Math.floor(r() * 2.4);
    for (let i = 0; i < n; i++) {
      const handle = HANDLES[Math.floor(r() * HANDLES.length)];
      const rating = p.rating;
      const premium = p.hot ? 0.35 + r() * 0.9 : gauss(r) * 0.09 + 0.02;
      const fair = baselines[p.key] * rating;
      const bid = Math.max(10, Math.round((fair * (1 + premium)) / 5) * 5);
      const closed = r() < 0.35;
      const ts = end - Math.floor(r() * (closed ? 70 : 20) * HOUR);
      bids.push({
        auctionId: `smp-${p.key}-${i}-${Math.floor(end / HOUR)}`,
        cardId: `${p.key}:${s.rarity}`,
        playerName: p.name,
        sport: p.sport,
        rarity: s.rarity,
        cardRating: rating,
        highestBidRax: bid,
        perRatingPrice: perRatingPrice(bid, rating),
        bidderUsername: handle,
        bidderUserId: `u_${xfnv1a(handle).toString(16)}`,
        timestamp: new Date(ts).toISOString(),
        expiresAt: new Date(closed ? ts : end + Math.floor(1 + r() * 20) * HOUR).toISOString(),
        status: closed ? 'closed' : 'active',
      });
    }
  }

  // Repeat contenders: Mystic/Legendary holders hammering one card.
  const contenders: ContenderActivity[] = [];
  const elite = samplePlayers().filter((p) => p.rarity === 'Mystic' || p.rarity === 'Legendary');
  const rc = rng(`cont:${Math.floor(end / DAY)}`);
  for (let i = 0; i < Math.min(34, elite.length * 2); i++) {
    const p = elite[Math.floor(rc() * elite.length)];
    const handle = HANDLES[Math.floor(rc() * HANDLES.length)];
    const bids7d = 2 + Math.floor(rc() * 14);
    const buys7d = Math.floor(rc() * 7);
    contenders.push({
      bidderUsername: handle,
      bidderUserId: `u_${xfnv1a(handle).toString(16)}`,
      playerName: p.name,
      sport: p.sport,
      rarity: p.rarity,
      copiesOwned: 1 + Math.floor(rc() * 5),
      bids7d,
      buys7d,
      avgPerRating7d: baselines[p.key] * (1 + rc() * 0.45),
      lastActivityAt: new Date(end - Math.floor(rc() * 40) * HOUR).toISOString(),
    });
  }
  return { bids, baselines, contenders };
}

/* ------------------------------ OTD ------------------------------ */

const SEASON_WINDOW: Record<Sport, [number, number]> = {
  // [start month, length in months] — month is 1-based
  NFL: [9, 5], NBA: [10, 7], MLB: [4, 7], NHL: [10, 7], CBB: [11, 5], CFB: [9, 4], PGA: [1, 9], UFC: [1, 12],
};
const TEAMS = ['Aces', 'Bears', 'Comets', 'Drifters', 'Eagles', 'Foxes', 'Giants', 'Hornets', 'Jets', 'Kings', 'Lions', 'Mavs'];

/** ~12k synthetic historical games across 8 sports, 2016–2025. */
export function sampleOtdGames(): HistoricalGame[] {
  const out: HistoricalGame[] = [];
  const seasons = Array.from({ length: 10 }, (_, i) => 2016 + i);
  for (const p of samplePlayers()) {
    const r0 = rng(`otd:${p.key}`);
    const chosen = seasons.filter(() => r0() < 0.7);
    for (const season of chosen) {
      const r = rng(`otd:${p.key}:${season}`);
      const n = 8 + Math.floor(r() * 9);
      const [m0, len] = SEASON_WINDOW[p.sport];
      const team = `${TEAMS[Math.floor(r() * TEAMS.length)]}`;
      const used = new Set<string>();
      for (let g = 0; g < n; g++) {
        const offsetDays = Math.floor(r() * len * 30);
        const d = new Date(Date.UTC(season, m0 - 1, 1) + offsetDays * DAY);
        const iso = d.toISOString().slice(0, 10);
        if (used.has(iso) || iso.slice(5) === '02-29') continue;
        used.add(iso);
        const rating = Math.round(clamp(6.2 + gauss(r) * 1.7 + (p.rating - 85) / 20, 2, 10) * 10) / 10;
        out.push({
          id: `smp-${p.key}-${season}-${iso}`,
          playerId: p.key,
          playerName: p.name,
          sport: p.sport,
          team,
          season: String(season),
          date: iso,
          rating,
          baseRax: Math.round(rating * rating * 3),
        });
      }
    }
  }
  return out;
}

/* ------------------------------ Quads ------------------------------ */

export interface QuadGame {
  id: string;
  sport: Sport;
  title: string;
  broadcast: string;
  home: string;
  away: string;
  startsAt: string;
  /** Pace index, 1.0 = league average possessions/plays per minute. */
  pace: number;
  /** Expected polls per game. */
  pollsPerGame: number;
  marquee: boolean;
}

export interface PollOption {
  label: string;
  pct: number;
}
export interface Poll {
  id: string;
  gameId: string;
  question: string;
  options: PollOption[];
  votes: number;
}

export function sampleQuads(now: number): { games: QuadGame[]; polls: Poll[] } {
  const day0 = Math.floor(now / DAY) * DAY;
  const specs: Array<{ sport: Sport; title: string; broadcast: string; home: string; away: string; hour: number; dayOff: number; pace: number; polls: number; marquee: boolean }> = [
    { sport: 'NFL', title: 'Thursday Night Football', broadcast: 'Prime Video', home: 'Chiefs', away: 'Bills', hour: 0, dayOff: 1, pace: 1.0, polls: 16, marquee: true },
    { sport: 'NFL', title: 'Sunday Night Football', broadcast: 'NBC', home: 'Eagles', away: 'Cowboys', hour: 0, dayOff: 4, pace: 1.05, polls: 18, marquee: true },
    { sport: 'NFL', title: 'Monday Night Football', broadcast: 'ESPN', home: 'Ravens', away: 'Bengals', hour: 0, dayOff: 5, pace: 1.1, polls: 17, marquee: true },
    { sport: 'NBA', title: 'Marquee Tuesday', broadcast: 'ESPN', home: 'Nuggets', away: 'Thunder', hour: 1, dayOff: 2, pace: 1.18, polls: 22, marquee: true },
    { sport: 'NBA', title: 'Saturday Primetime', broadcast: 'ABC', home: 'Celtics', away: 'Knicks', hour: 1, dayOff: 3, pace: 1.12, polls: 21, marquee: true },
    { sport: 'NHL', title: 'Wednesday Night Hockey', broadcast: 'TNT', home: 'Oilers', away: 'Avalanche', hour: 1, dayOff: 2, pace: 0.9, polls: 12, marquee: true },
    { sport: 'MLB', title: 'Sunday Night Baseball', broadcast: 'NBC', home: 'Dodgers', away: 'Yankees', hour: 1, dayOff: 4, pace: 0.7, polls: 11, marquee: false },
    { sport: 'CFB', title: 'Saturday Primetime', broadcast: 'ABC', home: 'Ohio State', away: 'Michigan', hour: 0, dayOff: 3, pace: 1.15, polls: 19, marquee: true },
  ];
  const games: QuadGame[] = specs.map((s, i) => ({
    id: `qg-${i}`,
    sport: s.sport,
    title: s.title,
    broadcast: s.broadcast,
    home: s.home,
    away: s.away,
    startsAt: new Date(day0 + s.dayOff * DAY + (s.hour ? 23.5 : 0.5) * HOUR).toISOString(),
    pace: s.pace,
    pollsPerGame: s.polls,
    marquee: s.marquee,
  }));

  const polls: Poll[] = [];
  const QUESTIONS = ['Will the favorite cover the spread?', 'Does the first scoring play come in the first quarter?', 'Will the game go to overtime?', 'Which team scores last?', 'Will there be a lead change in the 2nd half?', 'Does the top scorer exceed their season average?'];
  games.forEach((g) => {
    const r = rng(`poll:${g.id}:${Math.floor(now / DAY)}`);
    for (let i = 0; i < 4; i++) {
      const two = r() < 0.6;
      const a = Math.round(clamp(50 + gauss(r) * 24, 6, 94));
      const options: PollOption[] = two
        ? [{ label: 'Yes', pct: a }, { label: 'No', pct: 100 - a }]
        : (() => {
            const x = Math.round(clamp(40 + gauss(r) * 18, 15, 70));
            const y = Math.round((100 - x) * (0.3 + r() * 0.4));
            return [{ label: g.home, pct: x }, { label: g.away, pct: y }, { label: 'Draw / Other', pct: 100 - x - y }];
          })();
      polls.push({ id: `${g.id}-p${i}`, gameId: g.id, question: QUESTIONS[(i + Math.floor(r() * 3)) % QUESTIONS.length], options, votes: Math.round(800 + r() * 14000) });
    }
  });
  return { games, polls };
}
