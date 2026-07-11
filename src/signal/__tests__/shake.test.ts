import { ShakeDetector } from '../shake';
import { computeCalibration } from '../calibration';

// Shake thresholds come from real calibration profiles (spec §6, §13)
const profileFor = (restAvg: number, holdAvg: number) => {
  const r = computeCalibration(Array(600).fill(restAvg), Array(900).fill(holdAvg), 'standard');
  if (!r.ok) throw new Error('test setup: expected a valid profile');
  return r.profile;
};

test('fires after 600ms sustained above threshold (low-baseline profile)', () => {
  const p = profileFor(0.05, 0.4); // shakeThreshold = max(1.5, 0.72) = 1.5
  const d = new ShakeDetector(p.shakeThreshold);
  let fired = 0;
  for (let t = 0; t <= 700; t += 16) if (d.update(2.0, t)) fired++;
  expect(fired).toBe(1);
});

test('severe-tremor idle hold above 1.5 m/s² does NOT fire when baseline is proportionally high', () => {
  const p = profileFor(0.3, 2.5); // shakeThreshold = 4.5
  expect(p.shakeThreshold).toBeCloseTo(4.5, 10);
  const d = new ShakeDetector(p.shakeThreshold);
  let fired = false;
  for (let t = 0; t <= 10_000; t += 16) fired = d.update(2.5, t) || fired;
  expect(fired).toBe(false);
});

test('a dip below threshold resets the sustain window', () => {
  const d = new ShakeDetector(1.5);
  let fired = false;
  for (let t = 0; t <= 500; t += 16) fired = d.update(2.0, t) || fired;
  d.update(0.2, 516); // dip
  for (let t = 532; t <= 1000; t += 16) fired = d.update(2.0, t) || fired; // only ~470ms more
  expect(fired).toBe(false);
});

test('cooldown after firing suppresses immediate re-fire', () => {
  const d = new ShakeDetector(1.5);
  let fires = 0;
  for (let t = 0; t <= 4000; t += 16) if (d.update(2.0, t)) fires++;
  expect(fires).toBe(1); // second sustained window falls inside the 4s cooldown
});

test('notifySessionEnded starts a 4s cooldown', () => {
  const d = new ShakeDetector(1.5);
  d.notifySessionEnded(0);
  let fired = false;
  for (let t = 16; t <= 3900; t += 16) fired = d.update(2.0, t) || fired;
  expect(fired).toBe(false);
  for (let t = 4000; t <= 4700; t += 16) fired = d.update(2.0, t) || fired;
  expect(fired).toBe(true); // fires once the cooldown has passed
});
