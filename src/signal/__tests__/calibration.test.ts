import { computeCalibration, applyPreset, DEFAULT_SENS } from '../calibration';

const rest = (v: number, n = 600) => Array(n).fill(v);
const hold = (v: number, n = 900) => Array(n).fill(v);

test('DEFAULT_SENS is the prototype value', () => {
  expect(DEFAULT_SENS).toBe(2.2);
});

test('sens maps natural hold to ~0.6 turbulence (standard preset)', () => {
  const r = computeCalibration(rest(0.1), hold(1.0), 'standard');
  if (!r.ok) throw new Error('expected ok');
  expect(r.profile.sens).toBeCloseTo(1.0 / Math.pow(0.6, 1.25), 4); // ≈ 1.8937
  expect(r.profile.restAvg).toBeCloseTo(0.1, 10);
  expect(r.profile.naturalHoldAvg).toBeCloseTo(1.0, 10);
});

test('preset scales sens ±30% and clamp applies AFTER scaling', () => {
  const g = computeCalibration(rest(0.1), hold(1.0), 'gentle');
  const s = computeCalibration(rest(0.1), hold(1.0), 'sensitive');
  if (!g.ok || !s.ok) throw new Error('expected ok');
  expect(g.profile.sens).toBeCloseTo(1.8937 * 1.3, 3);
  expect(s.profile.sens).toBeCloseTo(1.8937 * 0.7, 3);
  // huge tremor: raw 7.57 × gentle 1.3 would be 9.8 — must clamp to 6.0
  const big = computeCalibration(rest(0.5), hold(4.0), 'gentle');
  if (!big.ok) throw new Error('expected ok');
  expect(big.profile.sens).toBe(6.0);
});

test('sens clamps to lower bound 0.8', () => {
  const r = computeCalibration(rest(0.05), hold(0.2), 'sensitive'); // raw 0.379 × 0.7
  if (!r.ok) throw new Error('expected ok');
  expect(r.profile.sens).toBe(0.8);
});

test('shakeThreshold = max(1.5, naturalHoldAvg × 1.8)', () => {
  const low = computeCalibration(rest(0.05), hold(0.5), 'standard');
  const high = computeCalibration(rest(0.3), hold(2.5), 'standard');
  if (!low.ok || !high.ok) throw new Error('expected ok');
  expect(low.profile.shakeThreshold).toBe(1.5);   // 0.9 < 1.5 floor
  expect(high.profile.shakeThreshold).toBeCloseTo(4.5, 10);
});

test('rejects when hold is not distinguishable from rest', () => {
  expect(computeCalibration(rest(1.0), hold(1.1), 'standard'))
    .toEqual({ ok: false, reason: 'implausible' });
  expect(computeCalibration(rest(1.0), hold(1.2), 'standard'))
    .toEqual({ ok: false, reason: 'implausible' }); // boundary: <= restAvg × 1.2
});

test('rejects corrupted data', () => {
  expect(computeCalibration(rest(NaN), hold(1.0), 'standard'))
    .toEqual({ ok: false, reason: 'implausible' });
  expect(computeCalibration(rest(0.1), [...hold(1.0, 899), -5], 'standard'))
    .toEqual({ ok: false, reason: 'implausible' });
});

test('rejects near-zero sample counts', () => {
  expect(computeCalibration(rest(0.1, 10), hold(1.0), 'standard'))
    .toEqual({ ok: false, reason: 'insufficient_data' });
  expect(computeCalibration(rest(0.1), hold(1.0, 3), 'standard'))
    .toEqual({ ok: false, reason: 'insufficient_data' });
});

test('applyPreset rescales from the stored measurement and re-clamps', () => {
  const r = computeCalibration(rest(0.1), hold(1.0), 'standard');
  if (!r.ok) throw new Error('expected ok');
  const gentle = applyPreset(r.profile, 'gentle');
  expect(gentle.sens).toBeCloseTo(1.8937 * 1.3, 3);
  expect(gentle.preset).toBe('gentle');
  expect(gentle.naturalHoldAvg).toBe(r.profile.naturalHoldAvg); // measurement untouched
});
