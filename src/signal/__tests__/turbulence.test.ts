import {
  turbulenceTarget, MirrorSource, SoftMirrorSource, CompanionSource, COMPANION_FLOOR,
} from '../turbulence';

const DT = 1 / 60;

test('turbulenceTarget known points at sens 2.2', () => {
  expect(turbulenceTarget(0, 2.2)).toBe(0);
  expect(turbulenceTarget(2.2, 2.2)).toBe(1);
  // env = 0.6^1.25 × sens maps to exactly 0.6 turbulence (calibration invariant)
  expect(turbulenceTarget(Math.pow(0.6, 1.25) * 2.2, 2.2)).toBeCloseTo(0.6, 8);
  expect(turbulenceTarget(50, 2.2)).toBe(1); // clamped
});

test('Mirror smooths toward target with the prototype rate (~0.03/frame at 60fps)', () => {
  const m = new MirrorSource(2.2);
  const first = m.update(2.2, DT, 0); // target 1, from 0
  expect(first).toBeGreaterThan(0.025);
  expect(first).toBeLessThan(0.035);
});

test('Mirror smoothing is frame-rate independent (120fps ≈ 60fps)', () => {
  const a = new MirrorSource(2.2);
  const b = new MirrorSource(2.2);
  let va = 0, vb = 0;
  for (let i = 0; i < 60; i++) va = a.update(2.2, 1 / 60, 0);
  for (let i = 0; i < 120; i++) vb = b.update(2.2, 1 / 120, 0);
  expect(Math.abs(va - vb)).toBeLessThan(0.005);
});

test('SoftMirror first output equals first target exactly — never false calm', () => {
  const s = new SoftMirrorSource(2.2);
  expect(s.update(1.5, DT, 0)).toBeCloseTo(turbulenceTarget(1.5, 2.2), 10);
});

test('SoftMirror step response reaches ~63% at 60s', () => {
  const s = new SoftMirrorSource(2.2);
  s.update(0, DT, 0); // initialize at target 0
  let v = 0;
  for (let i = 0; i < 3600; i++) v = s.update(2.2, DT, 0); // 60s toward target 1
  expect(v).toBeGreaterThan(0.60);
  expect(v).toBeLessThan(0.66);
});

test('Companion ignores the envelope entirely', () => {
  const a = new CompanionSource();
  const b = new CompanionSource();
  let va = 0, vb = 0;
  for (let i = 0; i < 600; i++) {
    const p = (i % 60) / 60;
    va = a.update(0, DT, p);
    vb = b.update(99, DT, p);
  }
  expect(va).toBe(vb);
});

test('Companion starts near 0.75 and decays to its floor', () => {
  const c = new CompanionSource();
  const first = c.update(0, DT, 0); // progress 0 → swell term 0
  expect(first).toBeCloseTo(0.75, 2);
  let v = 0;
  for (let i = 0; i < 60 * 120; i++) v = c.update(0, DT, 0); // 2 min
  expect(v).toBeCloseTo(COMPANION_FLOOR, 5);
});

test('Companion swell follows the breath cycle (±0.04)', () => {
  const atQuarter = new CompanionSource().update(0, DT, 0.25);
  const atZero = new CompanionSource().update(0, DT, 0);
  expect(atQuarter - atZero).toBeCloseTo(0.04, 3);
});
