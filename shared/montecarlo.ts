/**
 * Monte Carlo price & rating projections — plain stochastic simulation, no machine learning.
 *
 * Latent model (daily steps), per simulated path:
 *
 *   ln P_t = f_t + h_t                              P = per-rating price (Rax per rating point)
 *   f_{t+1} = f_t + s(t) + b + κ·(ln A + S_t − f_t) + σ·m·ε_t + J_t + β·ΔR_t/R
 *   h_{t+1} = h_t · 2^(−1/halfLife)                 hype decays exponentially
 *   R_{t+1} = R_t + κ_r·(R_0 − R_t) + σ_r(t)·ζ_t    rating: bounded, mean-reverting, weekly in-season shocks
 *
 *   s(t)   seasonal drift: pre-season ramp → in-season → playoffs → post-season decay → off-season (shared/season.ts)
 *   A      anchor ("fair" per-rating level): own 30-day median shrunk toward similar cards (credibility weights)
 *   S_t    cumulative seasonal drift, so the anchor itself rises/decays with the season
 *   σ      daily vol: own realised vol shrunk toward peers' (Bühlmann-style, weight n/(n+10)), inflated for thin markets
 *   m      per-path vol multiplier ~ LogNormal(0, 0.25)  → parameter uncertainty (widens the fan)
 *   b      per-path drift offset ~ N(0, τ²)               → parameter uncertainty
 *   ε      Student-t (4 dof) shocks, unit variance → fat tails;  J  Poisson jumps with Laplace sizes
 *   (ε, ζ) correlated (ρ = 0.35): good performance lifts price
 *
 *   observed P*_t = P_t · exp(η_t), η ~ t4·σ_obs   where σ_obs grows as trading volume shrinks: on Real a single
 *   bidder can move a thin market, so any one sale price is a noisy read of "true" value.
 *
 * Priors (season drift sizes, jump intensity, hype half-life, ρ…) are assumptions, not fitted to Real data.
 * Everything is seeded, so a given (player, day, scenario, seed) always gives the same answer.
 */
import type { ForecastInputs } from '../src/types/market';
import type { Sport } from '../src/types/real';
import { median, stdev } from './formulas';
import { laplace, normal, rng, studentT4Unit, xfnv1a } from './rng';
import { DEFAULT_SEASON_PROFILE, isSeasonStartDay, seasonPhase, seasonalDrift, type SeasonProfile } from './season';

const DAY = 86_400_000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export interface Scenario {
  horizonDays: number;
  paths: number;
  /** Fraction (0–0.9) of today's premium/discount to anchor treated as decaying hype. null = estimate. */
  hypeShare: number | null;
  /** Extra drift, in log-points per day (e.g. +0.001 ≈ +3%/month). */
  driftBias: number;
  /** Multiplies volatility (1 = model estimate). */
  volMult: number;
  /** Change the seed to re-roll the same scenario. */
  salt: number;
  season?: Partial<SeasonProfile>;
}

export const DEFAULT_SCENARIO: Scenario = { horizonDays: 30, paths: 4000, hypeShare: null, driftBias: 0, volMult: 1, salt: 0 };

export interface ModelParams {
  lnP0: number;
  lnAnchor: number;
  f0: number;
  h0: number;
  hypeShare: number;
  hypeHalfLifeDays: number;
  sigma: number;
  sigmaEff: number;
  kappaF: number;
  lambdaJump: number;
  jumpScale: number;
  driftBias: number;
  driftTau: number;
  volUncertainty: number;
  obsSd: number;
  rating0: number;
  sigmaRatingIn: number;
  sigmaRatingOff: number;
  sigmaRatingRefresh: number;
  kappaR: number;
  rho: number;
  betaR: number;
  profile: SeasonProfile;
  diagnostics: {
    ownSd: number | null;
    peerSd: number | null;
    wOwn: number;
    thinInflation: number;
    volPerDay: number;
    ownMedianPpr: number;
    peerMedianPpr: number | null;
    anchorPpr: number;
    returnsUsed: number;
  };
}

/** Winsorised standard deviation of daily log returns. */
function robustSd(returns: number[]): number {
  if (returns.length < 2) return 0;
  const clipped = returns.map((r) => clamp(r, -0.5, 0.5));
  return stdev(clipped);
}

export function estimateParams(inp: ForecastInputs, sc: Scenario): ModelParams {
  const profile: SeasonProfile = { ...DEFAULT_SEASON_PROFILE, ...(sc.season || {}) };
  const pts = inp.daily.filter((d) => d.ppr > 0);
  const returns: number[] = [];
  for (let i = 1; i < pts.length; i++) returns.push(Math.log(pts[i].ppr / pts[i - 1].ppr));
  const n = returns.length;

  const ownSd = n >= 3 ? robustSd(returns) : null;
  const peerSd = inp.peers.n > 0 && inp.peers.sdLogRet > 0 ? inp.peers.sdLogRet : null;
  const wOwn = ownSd == null ? 0 : n / (n + 10);
  let sigma: number;
  if (ownSd != null && peerSd != null) sigma = Math.sqrt(wOwn * ownSd ** 2 + (1 - wOwn) * peerSd ** 2);
  else sigma = ownSd ?? peerSd ?? 0.05; // no information at all → a deliberately wide default
  sigma = clamp(sigma, 0.008, 0.25);

  const volPerDay = pts.length ? median(pts.slice(-14).map((d) => d.volume)) : 0;
  const thinInflation = 1 + 1.0 / Math.sqrt(1 + volPerDay);
  const sigmaEff = sigma * thinInflation * sc.volMult;

  const ownMedian = pts.length ? median(pts.map((d) => d.ppr)) : inp.currentPpr;
  const peerMedian = inp.peers.n > 0 && inp.peers.medianPpr > 0 ? inp.peers.medianPpr : null;
  const wA = peerMedian == null ? 1 : pts.length / (pts.length + 10);
  const lnAnchor = peerMedian == null ? Math.log(ownMedian) : wA * Math.log(ownMedian) + (1 - wA) * Math.log(peerMedian);

  const lnP0 = Math.log(Math.max(inp.currentPpr, 1e-6));
  const premium = lnP0 - lnAnchor;
  const autoShare = clamp(0.4 + 0.08 * Math.min(inp.catalysts.length, 3) + 0.05 * clamp(inp.spikeZ, 0, 6), 0, 0.9);
  const hypeShare = sc.hypeShare ?? autoShare;
  const h0 = hypeShare * premium;

  return {
    lnP0,
    lnAnchor,
    f0: lnP0 - h0,
    h0,
    hypeShare,
    hypeHalfLifeDays: 6,
    sigma,
    sigmaEff,
    kappaF: 0.01,
    // jumps: ~1 in 50 days, more often with catalysts and in thin markets; sizes scale with typical volatility
    lambdaJump: clamp(0.02 + 0.01 * inp.catalysts.length + 0.02 / Math.sqrt(1 + volPerDay), 0.01, 0.12),
    jumpScale: Math.max(0.08, 1.5 * sigma),
    driftBias: sc.driftBias,
    driftTau: 0.0012 * (1 + 4 / Math.sqrt(1 + n)),
    volUncertainty: 0.25,
    obsSd: 0.04 + 0.35 / Math.sqrt(1 + volPerDay),
    rating0: inp.rating,
    sigmaRatingIn: 0.25,
    sigmaRatingOff: 0.03,
    sigmaRatingRefresh: 1.5,
    kappaR: 0.01,
    rho: 0.35,
    betaR: 1.5,
    profile,
    diagnostics: {
      ownSd,
      peerSd,
      wOwn,
      thinInflation,
      volPerDay,
      ownMedianPpr: ownMedian,
      peerMedianPpr: peerMedian,
      anchorPpr: Math.exp(lnAnchor),
      returnsUsed: n,
    },
  };
}

export interface BandPoint {
  /** Day offset from now (0 = today). */
  d: number;
  t: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface ForecastStats {
  horizonDays: number;
  /** Probability the observed value at the horizon is above today's. */
  pUp: number;
  pUp20: number;
  pDown20: number;
  /** Mean of the worst 5% of outcomes at the horizon. */
  expectedShortfall5: number;
  p1: number;
  p99: number;
  mean: number;
}

export interface Forecast {
  paths: number;
  ppr: BandPoint[];
  price: BandPoint[];
  rating: BandPoint[];
  pprStats: ForecastStats;
  priceStats: ForecastStats;
  params: ModelParams;
  phaseNow: ReturnType<typeof seasonPhase>;
}

function quantile(sorted: Float64Array, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function bandsAndStats(data: Float64Array, N: number, H: number, now: number, start: number) {
  const bands: BandPoint[] = [];
  const col = new Float64Array(N);
  let last: Float64Array = col;
  for (let d = 0; d <= H; d++) {
    for (let i = 0; i < N; i++) col[i] = data[i * (H + 1) + d];
    col.sort();
    bands.push({ d, t: now + d * DAY, p5: quantile(col, 0.05), p25: quantile(col, 0.25), p50: quantile(col, 0.5), p75: quantile(col, 0.75), p95: quantile(col, 0.95) });
    if (d === H) last = Float64Array.from(col);
  }
  let sum = 0;
  let up = 0, up20 = 0, dn20 = 0;
  for (let i = 0; i < N; i++) {
    const v = data[i * (H + 1) + H];
    sum += v;
    if (v > start) up++;
    if (v > start * 1.2) up20++;
    if (v < start * 0.8) dn20++;
  }
  const k = Math.max(1, Math.floor(N * 0.05));
  let tail = 0;
  for (let i = 0; i < k; i++) tail += last[i];
  const stats: ForecastStats = {
    horizonDays: H,
    pUp: up / N,
    pUp20: up20 / N,
    pDown20: dn20 / N,
    expectedShortfall5: tail / k,
    p1: quantile(last, 0.01),
    p99: quantile(last, 0.99),
    mean: sum / N,
  };
  return { bands, stats };
}

/** Run the simulation. `now` is the start time (ms). */
export function simulate(inp: ForecastInputs, sc: Scenario, now: number): Forecast {
  const params = estimateParams(inp, sc);
  return simulateWith(params, inp.sport, inp.key, sc, now, inp.currentPpr);
}

export function simulateWith(p: ModelParams, sport: Sport, key: string, sc: Scenario, now: number, currentPpr: number): Forecast {
  const H = Math.max(1, Math.min(180, Math.round(sc.horizonDays)));
  const N = Math.max(200, Math.min(20000, Math.round(sc.paths)));
  const r = rng(`mc:${key}:${Math.floor(now / DAY)}:${sc.salt}:${xfnv1a(JSON.stringify([sc.hypeShare, sc.driftBias, sc.volMult, H]))}`);
  const decay = Math.pow(2, -1 / p.hypeHalfLifeDays);
  const rhoC = Math.sqrt(1 - p.rho * p.rho);
  const pprData = new Float64Array(N * (H + 1));
  const priceData = new Float64Array(N * (H + 1));
  const ratingData = new Float64Array(N * (H + 1));

  // seasonal drift per day is path-independent
  const drift = new Float64Array(H + 1);
  const inSeason = new Uint8Array(H + 1);
  const refresh = new Uint8Array(H + 1);
  for (let d = 1; d <= H; d++) {
    const t = now + d * DAY;
    drift[d] = seasonalDrift(sport, t, p.profile);
    const ph = seasonPhase(sport, t).phase;
    inSeason[d] = ph === 'early' || ph === 'mid' || ph === 'stretch' || ph === 'playoffs' || ph === 'year-round' ? 1 : 0;
    refresh[d] = isSeasonStartDay(sport, t) ? 1 : 0;
  }

  for (let i = 0; i < N; i++) {
    const m = Math.exp(p.volUncertainty * normal(r) - 0.5 * p.volUncertainty ** 2);
    const b = p.driftBias + p.driftTau * normal(r);
    let f = p.f0;
    let h = p.h0;
    let R = p.rating0;
    let cumS = 0;
    const base = i * (H + 1);
    pprData[base] = currentPpr;
    priceData[base] = currentPpr * R;
    ratingData[base] = R;
    for (let d = 1; d <= H; d++) {
      const z1 = studentT4Unit(r);
      const z2 = normal(r);
      const zr = p.rho * z1 + rhoC * z2;

      const s = drift[d];
      cumS += s;
      let dR = p.kappaR * (p.rating0 - R) + (inSeason[d] ? p.sigmaRatingIn : p.sigmaRatingOff) * zr;
      if (refresh[d]) dR += p.sigmaRatingRefresh * normal(r);
      const Rn = clamp(R + dR, 40, 99);
      const dRel = (Rn - R) / R;
      R = Rn;

      f += s + b + p.kappaF * (p.lnAnchor + cumS - f) + p.sigmaEff * m * z1 + p.betaR * dRel;
      if (r() < p.lambdaJump) f += laplace(r, p.jumpScale);
      h *= decay;

      const lnP = f + h;
      const obs = Math.exp(lnP + p.obsSd * studentT4Unit(r));
      pprData[base + d] = obs;
      priceData[base + d] = obs * R;
      ratingData[base + d] = R;
    }
  }

  const ppr = bandsAndStats(pprData, N, H, now, currentPpr);
  const price = bandsAndStats(priceData, N, H, now, currentPpr * p.rating0);
  const rating = bandsAndStats(ratingData, N, H, now, p.rating0);
  return { paths: N, ppr: ppr.bands, price: price.bands, rating: rating.bands, pprStats: ppr.stats, priceStats: price.stats, params: p, phaseNow: seasonPhase(sport, now) };
}
