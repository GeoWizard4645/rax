/** Seeded randomness (reproducible simulations and sample data). */
export function xfnv1a(str: string): number {
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

/** Standard normal (Box–Muller). */
export function normal(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** Student-t with 4 degrees of freedom, rescaled to unit variance (fat tails, finite variance). */
export function studentT4Unit(r: () => number): number {
  const chi2 = -2 * Math.log(Math.max(r() * r(), 1e-24)); // chi-square(4) = 2·Gamma(2)
  return normal(r) / Math.sqrt(chi2 / 4) / Math.SQRT2;
}

/** Laplace(0, b). */
export function laplace(r: () => number, b: number): number {
  const u = r() - 0.5;
  return -b * Math.sign(u) * Math.log(1 - 2 * Math.abs(u) + 1e-12);
}
