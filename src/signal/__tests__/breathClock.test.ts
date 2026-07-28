import { DEFAULT_BREATH_TIMINGS, getBreathState } from '../breathClock';

test('starts in inhale at minimum moon scale', () => {
  const s = getBreathState(0);
  expect(s.phaseName).toBe('inhale');
  expect(s.phaseProgress).toBe(0);
  expect(s.moonScale).toBeCloseTo(0.62, 10);
});

test('default phase boundaries are correct', () => {
  expect(getBreathState(3999).phaseName).toBe('inhale');
  expect(getBreathState(4000).phaseName).toBe('hold');
  expect(getBreathState(5999).phaseName).toBe('hold');
  expect(getBreathState(6000).phaseName).toBe('exhale');
});

test('wraps at cycle length', () => {
  const cycle = (DEFAULT_BREATH_TIMINGS.inhaleS + DEFAULT_BREATH_TIMINGS.holdS + DEFAULT_BREATH_TIMINGS.exhaleS) * 1000;
  const a = getBreathState(0);
  const b = getBreathState(cycle);
  expect(b.phaseName).toBe(a.phaseName);
  expect(b.phaseProgress).toBeCloseTo(a.phaseProgress, 10);
  expect(b.moonScale).toBeCloseTo(a.moonScale, 10);
});

test('supports custom breath timings', () => {
  const timings = { inhaleS: 5, holdS: 1, exhaleS: 6 };
  expect(getBreathState(4500, timings).phaseName).toBe('inhale');
  expect(getBreathState(5000, timings).phaseName).toBe('hold');
  expect(getBreathState(6000, timings).phaseName).toBe('exhale');
});
