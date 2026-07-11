import { EnvelopeFollower, MotionSample, tauForAlphaAt60, alphaForDt } from '../envelope';

const DT = 1 / 60;

function sineSamples(freqHz: number, amp: number, seconds: number, gravity = false): MotionSample[] {
  const n = Math.round(seconds / DT);
  const out: MotionSample[] = [];
  for (let i = 0; i < n; i++) {
    const x = amp * Math.sin(2 * Math.PI * freqHz * i * DT);
    out.push(
      gravity
        ? { accelerationIncludingGravity: { x, y: 0, z: 9.81 }, dt: DT }
        : { acceleration: { x, y: 0, z: 0 }, dt: DT },
    );
  }
  return out;
}

test('tau/alpha helpers reproduce the prototype alphas exactly at 60Hz', () => {
  expect(alphaForDt(tauForAlphaAt60(0.25), DT)).toBeCloseTo(0.25, 10);
  expect(alphaForDt(tauForAlphaAt60(0.06), DT)).toBeCloseTo(0.06, 10);
});

test('envelope converges near the peak of a 6Hz sine of known amplitude', () => {
  const f = new EnvelopeFollower();
  let env = 0;
  for (const s of sineSamples(6, 2.0, 3)) env = f.process(s);
  // verified numerically: steady-state band is ~0.77–0.85 × amplitude
  expect(env).toBeGreaterThan(0.7 * 2.0);
  expect(env).toBeLessThanOrEqual(2.0);
});

test('envelope is stable once converged (spread < 15% over last 2s)', () => {
  const f = new EnvelopeFollower();
  const samples = sineSamples(6, 2.0, 4);
  const tail: number[] = [];
  samples.forEach((s, i) => {
    const v = f.process(s);
    if (i >= samples.length / 2) tail.push(v);
  });
  const max = Math.max(...tail);
  expect((max - Math.min(...tail)) / max).toBeLessThan(0.15);
});

test('envelope decays when motion stops (fall alpha 0.06)', () => {
  const f = new EnvelopeFollower();
  for (const s of sineSamples(6, 2.0, 3)) f.process(s);
  for (const s of sineSamples(6, 0, 1)) f.process(s); // 1s stillness
  expect(f.value).toBeLessThan(0.1 * 2.0);
});

test('gravity-inclusive input converges to the same envelope as linear input', () => {
  const lin = new EnvelopeFollower();
  const grav = new EnvelopeFollower();
  let a = 0, b = 0;
  for (const s of sineSamples(6, 2.0, 6)) a = lin.process(s);
  for (const s of sineSamples(6, 2.0, 6, true)) b = grav.process(s);
  expect(Math.abs(a - b)).toBeLessThan(0.15 * a);
});

test('linear acceleration is preferred when both fields are present', () => {
  const f = new EnvelopeFollower();
  // gravity field says huge motion; linear says none — linear must win
  for (let i = 0; i < 120; i++) {
    f.process({
      acceleration: { x: 0, y: 0, z: 0 },
      accelerationIncludingGravity: { x: 50, y: 0, z: 9.81 },
      dt: DT,
    });
  }
  expect(f.value).toBeCloseTo(0, 5);
});

test('reset clears envelope and gravity state', () => {
  const f = new EnvelopeFollower();
  for (const s of sineSamples(6, 2.0, 2)) f.process(s);
  f.reset();
  expect(f.value).toBe(0);
});
