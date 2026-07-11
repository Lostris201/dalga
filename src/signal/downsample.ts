export interface EnvelopeSample {
  /** ms since session start */
  t: number;
  /** envelope, m/s² */
  v: number;
}

export interface DownsampleResult {
  series: number[];
  /** time span the series covers; per-bucket dt = sampleSpanMs / series.length */
  sampleSpanMs: number;
}

export function downsample(samples: EnvelopeSample[], maxBuckets = 120): DownsampleResult {
  const n = samples.length;
  if (n === 0) return { series: [], sampleSpanMs: 0 };
  const sampleSpanMs = samples[n - 1].t;
  if (n <= maxBuckets) return { series: samples.map((s) => s.v), sampleSpanMs };
  const series: number[] = [];
  for (let b = 0; b < maxBuckets; b++) {
    const lo = Math.floor((b / maxBuckets) * n);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) / maxBuckets) * n));
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += samples[i].v;
    series.push(sum / (hi - lo));
  }
  return { series, sampleSpanMs };
}
