/**
 * Pure helpers shared by fit-rating-model.mjs and build-modeled-snapshot.mjs:
 *  - tiny ridge-OLS / metrics / rank-correlation toolbox (no dependencies)
 *  - the JSON model evaluator — a line-for-line mirror of `shared/ratingModel.ts` (tests/lib/rating-model.test.ts guards parity)
 */

/* ------------------------------ linear algebra / stats ------------------------------ */

/** Ridge least squares via Gauss-Jordan. X rows are plain arrays; returns {intercept, b}. `intercept:false` forces 0. */
export function fitOLS(X, y, { ridge = 1e-6, intercept = true } = {}) {
  const n = X.length;
  const p = X[0].length + (intercept ? 1 : 0);
  const A = Array.from({ length: p }, () => new Float64Array(p));
  const B = new Float64Array(p);
  for (let i = 0; i < n; i++) {
    const row = intercept ? [1, ...X[i]] : X[i];
    for (let a = 0; a < p; a++) {
      const ra = row[a];
      if (ra === 0) continue;
      B[a] += ra * y[i];
      for (let c = a; c < p; c++) A[a][c] += ra * row[c];
    }
  }
  for (let a = 0; a < p; a++) for (let c = 0; c < a; c++) A[a][c] = A[c][a];
  for (let a = intercept ? 1 : 0; a < p; a++) A[a][a] += ridge * n;
  const M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (f) for (let k = c; k <= p; k++) M[r][k] -= f * M[c][k];
    }
  }
  const sol = M.map((r, i) => r[p] / (r[i] || 1e-12));
  return intercept ? { intercept: sol[0], b: sol.slice(1) } : { intercept: 0, b: sol };
}

export const dot = (b, x) => b.reduce((s, bi, i) => s + bi * x[i], 0);

export function metrics(yt, yp) {
  const n = yt.length;
  if (!n) return { n: 0, r2: NaN, mae: NaN, rmse: NaN, bias: NaN };
  const m = yt.reduce((a, b) => a + b, 0) / n;
  let sse = 0, sst = 0, sae = 0, sb = 0;
  for (let i = 0; i < n; i++) {
    const e = yp[i] - yt[i];
    sse += e * e;
    sst += (yt[i] - m) ** 2;
    sae += Math.abs(e);
    sb += e;
  }
  return { n, r2: 1 - sse / sst, mae: sae / n, rmse: Math.sqrt(sse / n), bias: sb / n };
}

export function rank(a) {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
export function pearson(a, b) {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}
export const spearman = (a, b) => pearson(rank(a), rank(b));

/* ------------------------------ model evaluator (mirror of shared/ratingModel.ts) ------------------------------ */

const cmp = {
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};
export const statNum = (stats, k) => {
  const v = stats[k];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const condHolds = (stats, c) => cmp[c[1]](statNum(stats, c[0]), c[2]);
/** A group matches when ANY of its `when` clauses (each an AND of conditions) holds; no `when` = catch-all. */
export function groupMatches(g, stats) {
  if (!g.when || !g.when.length) return true;
  return g.when.some((clause) => clause.every((c) => condHolds(stats, c)));
}
export function pickGroup(model, stats, groupId) {
  if (groupId) return model.groups.find((g) => g.id === groupId) ?? null;
  return model.groups.find((g) => groupMatches(g, stats)) ?? null;
}
export function termValue(t, stats) {
  let v = 0;
  for (const [k, c] of t.e) v += c * statNum(stats, k);
  if (t.f === 'hinge') return Math.max(0, v - t.t);
  return v;
}
export function evalGroupRating(g, stats) {
  if (g.zeroIf && g.zeroIf.every((k) => statNum(stats, k) === 0)) return 0;
  let r = g.intercept;
  for (const t of g.terms) r += t.w * termValue(t, stats);
  if (g.min != null && r < g.min) r = g.min;
  if (g.max != null && r > g.max) r = g.max;
  return r;
}

/** Pitcher-style role split (MLB): `roleRule` = {key, min, hi, lo}; e.g. 12+ outs -> 'SP', else 'RP'. */
export function groupRole(g, stats) {
  if (!g.roleRule) return undefined;
  return statNum(stats, g.roleRule.key) >= g.roleRule.min ? g.roleRule.hi : g.roleRule.lo;
}

/**
 * Rax factor of a group for one game. `factors`: 'official' = Real's current published factors (default);
 * 'rateboard' = what Rateboard's stored values actually used in older seasons (`kSeasons` / `kRoleSeasons` overrides).
 */
export function groupK(g, { postseason = false, season, role, factors = 'official' } = {}) {
  let k = g.k;
  if (role && g.kRole && g.kRole[role]) k = g.kRole[role];
  if (factors === 'rateboard' && season != null) {
    const pick = (list) => [...list].filter((o) => o.from <= season).sort((a, b) => b.from - a.from)[0];
    if (g.kSeasons) {
      const ov = pick(g.kSeasons);
      if (ov) k = ov;
    }
    if (role && g.kRoleSeasons) {
      const ov = pick(g.kRoleSeasons);
      if (ov && ov[role]) k = ov[role];
    }
  }
  return postseason ? k.post : k.reg;
}
export const roundHalfUp = (x) => Math.floor(x + 0.5);
export const raxFromRating = (rating, k) => Math.max(0, roundHalfUp(k * rating));

/**
 * Model one game from a normalised stat line. ctx = {won, post, season, factors}. Returns {group, rating, k, rax}.
 */
export function modelGame(model, stats, ctx = {}) {
  const st = { ...stats, win: ctx.won ? 1 : 0, post: ctx.post ? 1 : 0 };
  const g = pickGroup(model, st);
  if (!g) return null;
  const rating = evalGroupRating(g, st);
  const k = groupK(g, { postseason: !!ctx.post, season: ctx.season, role: groupRole(g, st), factors: ctx.factors });
  return { group: g.id, rating, k, rax: raxFromRating(rating, k) };
}

/**
 * Empirical low-owner uplift (see docs/RATING-MODEL.md): multiplier on the base Rax of games inside the "uplift regime",
 * as a function of the player's owner-count PERCENTILE within his sport-season (0 = fewest owners). Mirrors shared/ratingModel.ts.
 */
export const UPLIFT_PCT = [[0.5, 1.48], [0.75, 1.37], [0.9, 1.2], [Infinity, 1]];
export const upliftForPct = (p) => {
  for (const [max, m] of UPLIFT_PCT) if (p < max) return m;
  return 1;
};
