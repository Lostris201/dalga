import { downsample, EnvelopeSample } from '../downsample';

const mk = (vs: number[]): EnvelopeSample[] => vs.map((v, i) => ({ t: i * 16, v }));

test('empty input yields empty series and zero span', () => {
  expect(downsample([])).toEqual({ series: [], sampleSpanMs: 0 });
});

test('input at or under maxBuckets passes through unchanged', () => {
  const s = mk([1, 2, 3]);
  const r = downsample(s);
  expect(r.series).toEqual([1, 2, 3]);
  expect(r.sampleSpanMs).toBe(2 * 16);
});

test('input exactly at maxBuckets passes through unchanged', () => {
  const values = Array.from({ length: 120 }, (_, i) => i / 10);
  const r = downsample(mk(values));
  expect(r.series).toEqual(values);
  expect(r.sampleSpanMs).toBe((values.length - 1) * 16);
});

test('large input reduces to exactly maxBuckets bucket-means', () => {
  const r = downsample(mk(Array(1200).fill(0.5)));
  expect(r.series).toHaveLength(120);
  for (const v of r.series) expect(v).toBeCloseTo(0.5, 10);
  expect(r.sampleSpanMs).toBe(1199 * 16);
});

test('bucket means are correct on a linear ramp', () => {
  // 1200 samples 0..1199; bucket b covers indices [b*10, (b+1)*10) → mean = b*10 + 4.5
  const r = downsample(mk(Array.from({ length: 1200 }, (_, i) => i)));
  expect(r.series[0]).toBeCloseTo(4.5, 10);
  expect(r.series[60]).toBeCloseTo(604.5, 10);
  expect(r.series[119]).toBeCloseTo(1194.5, 10);
});

test('supports custom maxBuckets argument', () => {
  const r = downsample(mk(Array.from({ length: 20 }, (_, i) => i + 1)), 5);
  expect(r.series).toEqual([2.5, 6.5, 10.5, 14.5, 18.5]);
  expect(r.sampleSpanMs).toBe(19 * 16);
});
