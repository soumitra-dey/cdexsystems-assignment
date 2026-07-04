/**
 * Robust statistics for outlier detection. We use the Tukey IQR fence with
 * k=3 ("extreme" outlier fence) rather than k=1.5 ("mild") because the task
 * targets EXTREME numeric outliers. IQR/median are resistant to a single
 * extreme value, so the outlier can be included in the sample without moving
 * the fence — this generalizes to the held-out seed's different magnitudes.
 * See DECISIONS.md for justification + the false-positive analysis.
 */

export function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

/** Linear-interpolation quantile (matches common numpy 'linear' / Type 7). */
export function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

export interface Fence {
  q1: number;
  q3: number;
  iqr: number;
  low: number;
  high: number;
  median: number;
  k: number;
}

/** Build a Tukey fence (k*IQR) from a sample. NaNs/nulls are ignored. */
export function buildFence(values: number[], k = 3): Fence {
  const clean = values
    .filter((v) => typeof v === "number" && Number.isFinite(v))
    .sort((a, b) => a - b);
  const q1 = quantile(clean, 0.25);
  const q3 = quantile(clean, 0.75);
  const iqr = q3 - q1;
  return {
    q1,
    q3,
    iqr,
    low: q1 - k * iqr,
    high: q3 + k * iqr,
    median: median(clean),
    k,
  };
}

/** True if value falls outside the Tukey extreme fence. */
export function isOutlier(
  value: number | null | undefined,
  fence: Fence,
): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  return value < fence.low || value > fence.high;
}
