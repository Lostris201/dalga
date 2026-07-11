# Dalga Milestone 1 — Scaffold & Signal Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo scaffold with the complete, fully unit-tested pure-TS signal pipeline (envelope, turbulence sources, downsampler, shake detector, calibration math) and a live debug readout screen driven by real DeviceMotion data.

**Architecture:** All signal processing lives in `src/signal/` as pure TypeScript with zero React Native imports — testable with plain Jest. A thin sensor bridge (`src/sensors/motionSource.ts`) adapts expo-sensors DeviceMotion events into pipeline samples. A temporary debug screen replaces Home until Milestone 2.

**Tech Stack:** Expo (TS, dev client), Expo Router, expo-sensors (DeviceMotion), Jest via jest-expo.

**Spec:** `docs/superpowers/specs/2026-07-11-dalga-design.md` — this plan implements §5 (pipeline), §6 (calibration math only, no UI), parts of §13 (tests), milestone 1 of §14.

## Global Constraints

- Units are **m/s²** everywhere in the pipeline (DeviceMotion, NOT Accelerometer which reports g's).
- Tuned constants are sacred (from `reference/dalga-prototype.jsx`): gravity EMA α=0.02, envelope rise α=0.25 / fall α=0.06, turbulence `min(1,(env/sens)^0.8)`, mirror smoothing 0.03/frame, companion decay 0.00022/frame + floor 0.08 + start 0.75 + swell ±0.04 — all "per frame at 60Hz", converted to time-constant form `α = 1 − exp(−dt/τ)` with τ = `−(1/60)/ln(1−α₆₀)`.
- Calibration: `sens = clamp(rawSens × presetFactor, 0.8, 6.0)` clamped AFTER preset scaling; presets gentle ×1.3 / standard ×1.0 / sensitive ×0.7; `shakeThreshold = max(1.5, naturalHoldAvg × 1.8)`; default sens 2.2.
- Recording/display are independent axes; nothing in this milestone may couple them.
- Palette (debug screen too): night `#0A1120`, bone `#EDE6D0`, foam `#8FB6AE`.
- TDD: every signal module gets its failing test written and run first.
- Commands below are Git Bash syntax (Windows machine; the Bash tool runs Git Bash). Working directory is repo root `C:\proje\dalga`.

---

### Task 1: Expo scaffold + Jest harness

**Files:**
- Create: entire Expo app skeleton at repo root (app/, package.json, tsconfig.json, app.json, …)
- Create: `src/signal/__tests__/harness.test.ts` (temporary; deleted in Task 2)
- Modify: `package.json` (jest config + test script)

**Interfaces:**
- Consumes: nothing.
- Produces: a repo where `npm test` runs Jest with the jest-expo preset and `npx expo start` boots; all later tasks assume `src/` exists at root and tests live in `src/**/__tests__/*.test.ts`.

- [ ] **Step 1: Scaffold Expo app into the repo root**

create-expo-app refuses non-empty dirs, so scaffold to a temp dir and move:

```bash
cd /c/proje/dalga
npx create-expo-app@latest tmp-scaffold --template default --no-install
rm -rf tmp-scaffold/.git   # in case the generator initialized one
shopt -s dotglob
for f in tmp-scaffold/*; do mv "$f" .; done
rmdir tmp-scaffold
npm install
# drop the template's demo screens/components (do NOT use the interactive reset-project script);
# keep assets/ — app.json references the icons
rm -rf app components constants hooks scripts
mkdir app
```

Then create the two files below.

- [ ] **Step 2: Minimal app/_layout.tsx and app/index.tsx**

`app/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`app/index.tsx` (placeholder; replaced in Task 7):
```tsx
import { Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={{ flex: 1, backgroundColor: '#0A1120', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#EDE6D0' }}>dalga</Text>
    </View>
  );
}
```

- [ ] **Step 3: Install all native dependencies now (one dev-client build serves all milestones)**

```bash
npx expo install expo-sensors expo-haptics expo-sqlite @react-native-async-storage/async-storage \
  expo-font @expo-google-fonts/cormorant-garamond expo-localization expo-print expo-sharing \
  expo-file-system expo-dev-client @shopify/react-native-skia react-native-reanimated \
  react-native-audio-api expo-quick-actions
```

Note: with SDK 50+, `babel-preset-expo` includes the Reanimated plugin automatically — do NOT add `react-native-reanimated/plugin` manually unless the Milestone 2 build complains.

- [ ] **Step 4: Add Jest**

```bash
npm install -D jest jest-expo @types/jest
```

Add to `package.json`:
```json
"scripts": { "test": "jest" },
"jest": {
  "preset": "jest-expo",
  "transformIgnorePatterns": [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@shopify/react-native-skia|react-native-reanimated|react-native-svg)"
  ]
}
```

- [ ] **Step 5: Harness sanity test**

`src/signal/__tests__/harness.test.ts`:
```ts
test('jest harness runs TypeScript under src/', () => {
  const add = (a: number, b: number): number => a + b;
  expect(add(2, 3)).toBe(5);
});
```

- [ ] **Step 6: Run it**

Run: `npm test`
Expected: 1 suite, 1 test, PASS.

- [ ] **Step 7: Verify the app boots**

Run: `npx expo start` — Metro starts without errors (Ctrl-C after it's up; device run happens in Task 7).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: Expo scaffold with router skeleton, all deps, jest harness"
```

---

### Task 2: EnvelopeFollower

**Files:**
- Create: `src/signal/envelope.ts`
- Create: `src/signal/__tests__/envelope.test.ts`
- Delete: `src/signal/__tests__/harness.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface Vec3 { x: number; y: number; z: number }`
  - `interface MotionSample { acceleration?: Vec3 | null; accelerationIncludingGravity?: Vec3 | null; dt: number /* seconds */ }`
  - `class EnvelopeFollower { process(s: MotionSample): number; get value(): number; reset(): void }` — returns envelope in m/s²
  - `const tauForAlphaAt60: (alphaAt60: number) => number`
  - `const alphaForDt: (tauS: number, dt: number) => number`

- [ ] **Step 1: Write the failing tests**

`src/signal/__tests__/envelope.test.ts`:
```ts
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
```

Also delete the harness test:
```bash
rm src/signal/__tests__/harness.test.ts
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- envelope`
Expected: FAIL — cannot find module '../envelope'.

- [ ] **Step 3: Implement**

`src/signal/envelope.ts`:
```ts
// Ported from reference/dalga-prototype.jsx — constants tuned against a real tremor.
// Per-frame alphas converted to time-constant form: identical behavior at 60Hz,
// correct at any other sensor/display rate.

export interface Vec3 { x: number; y: number; z: number; }

export interface MotionSample {
  /** linear acceleration (gravity removed by the OS), m/s² — preferred */
  acceleration?: Vec3 | null;
  /** acceleration including gravity, m/s² — fallback, gravity removed via slow EMA */
  accelerationIncludingGravity?: Vec3 | null;
  /** seconds since previous sample */
  dt: number;
}

const REF_DT = 1 / 60;

/** τ such that α = 1 − exp(−REF_DT/τ) equals the prototype's per-frame alpha at 60Hz. */
export const tauForAlphaAt60 = (alphaAt60: number): number => -REF_DT / Math.log(1 - alphaAt60);

export const alphaForDt = (tauS: number, dt: number): number => 1 - Math.exp(-dt / tauS);

const TAU_GRAVITY = tauForAlphaAt60(0.02); // ≈ 0.825s
const TAU_RISE = tauForAlphaAt60(0.25);    // ≈ 0.058s
const TAU_FALL = tauForAlphaAt60(0.06);    // ≈ 0.269s

export class EnvelopeFollower {
  private gravity: Vec3 = { x: 0, y: 0, z: 0 };
  private gravityInit = false;
  private env = 0;

  get value(): number { return this.env; }

  reset(): void {
    this.env = 0;
    this.gravityInit = false;
  }

  /** Process one motion sample; returns the updated envelope (m/s²). */
  process(s: MotionSample): number {
    let ax: number, ay: number, az: number;
    const lin = s.acceleration;
    const incl = s.accelerationIncludingGravity;
    if (lin && Number.isFinite(lin.x)) {
      ax = lin.x; ay = lin.y; az = lin.z;
    } else if (incl && Number.isFinite(incl.x)) {
      const g = this.gravity;
      if (!this.gravityInit) {
        g.x = incl.x; g.y = incl.y; g.z = incl.z;
        this.gravityInit = true;
      }
      const a = alphaForDt(TAU_GRAVITY, s.dt);
      g.x += a * (incl.x - g.x);
      g.y += a * (incl.y - g.y);
      g.z += a * (incl.z - g.z);
      ax = incl.x - g.x; ay = incl.y - g.y; az = incl.z - g.z;
    } else {
      return this.env;
    }
    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    const a = alphaForDt(mag > this.env ? TAU_RISE : TAU_FALL, s.dt);
    this.env += a * (mag - this.env);
    return this.env;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- envelope`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/signal/envelope.ts src/signal/__tests__/envelope.test.ts
git rm --cached src/signal/__tests__/harness.test.ts 2>/dev/null; true
git add -A src/signal/__tests__
git commit -m "feat: envelope follower with gravity EMA fallback, time-constant form"
```

---

### Task 3: Downsampler

**Files:**
- Create: `src/signal/downsample.ts`
- Create: `src/signal/__tests__/downsample.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface EnvelopeSample { t: number /* ms since session start */; v: number /* m/s² */ }`
  - `function downsample(samples: EnvelopeSample[], maxBuckets?: number): { series: number[]; sampleSpanMs: number }` — default maxBuckets 120; `series` empty ⇔ input empty; `sampleSpanMs` = t of last sample.

- [ ] **Step 1: Write the failing tests**

`src/signal/__tests__/downsample.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- downsample`
Expected: FAIL — cannot find module '../downsample'.

- [ ] **Step 3: Implement**

`src/signal/downsample.ts`:
```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- downsample`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/signal/downsample.ts src/signal/__tests__/downsample.test.ts
git commit -m "feat: envelope series downsampler (bucket means, <=120 pts)"
```

---

### Task 4: Turbulence sources (Mirror / Soft Mirror / Companion)

**Files:**
- Create: `src/signal/turbulence.ts`
- Create: `src/signal/__tests__/turbulence.test.ts`

**Interfaces:**
- Consumes: `tauForAlphaAt60`, `alphaForDt` from `src/signal/envelope.ts`.
- Produces:
  - `function turbulenceTarget(env: number, sens: number): number`
  - `interface TurbulenceSource { update(env: number, dt: number, breathCycleProgress: number): number }` — returns turbulence 0..1; `breathCycleProgress` is 0..1 position within the breath cycle (only Companion uses it)
  - `class MirrorSource implements TurbulenceSource` (constructor: `sens: number`)
  - `class SoftMirrorSource implements TurbulenceSource` (constructor: `sens: number`)
  - `class CompanionSource implements TurbulenceSource` (no constructor args)
  - `const COMPANION_FLOOR = 0.08`

- [ ] **Step 1: Write the failing tests**

`src/signal/__tests__/turbulence.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- turbulence`
Expected: FAIL — cannot find module '../turbulence'.

- [ ] **Step 3: Implement**

`src/signal/turbulence.ts`:
```ts
// Turbulence sources: what drives the sea. Mode selects a source; the recorder
// is independent and unconditional (spec §5) — nothing here touches recording.
import { alphaForDt, tauForAlphaAt60 } from './envelope';

export const turbulenceTarget = (env: number, sens: number): number =>
  Math.min(1, Math.pow(Math.max(0, env) / sens, 0.8));

export interface TurbulenceSource {
  /** breathCycleProgress: 0..1 position within the breath cycle (Companion only) */
  update(env: number, dt: number, breathCycleProgress: number): number;
}

const TAU_MIRROR = tauForAlphaAt60(0.03); // ≈ 0.547s — prototype's global smoother

export class MirrorSource implements TurbulenceSource {
  private t = 0;
  constructor(private sens: number) {}
  update(env: number, dt: number): number {
    const target = turbulenceTarget(env, this.sens);
    this.t += alphaForDt(TAU_MIRROR, dt) * (target - this.t);
    return this.t;
  }
}

const TAU_SOFT = 60; // seconds — user sees direction, never jitter

export class SoftMirrorSource implements TurbulenceSource {
  private t: number | null = null; // seeded from first target: start truthful
  constructor(private sens: number) {}
  update(env: number, dt: number): number {
    const target = turbulenceTarget(env, this.sens);
    if (this.t === null) {
      this.t = target;
      return this.t;
    }
    this.t += alphaForDt(TAU_SOFT, dt) * (target - this.t);
    return this.t;
  }
}

// Companion: breath engine only — the envelope is NEVER an input (spec §5, §7.1).
// Ported from the prototype's generator (level −0.00022/frame @60fps, floor 0.08),
// swell retimed from wall-clock to the breath cycle.
const COMPANION_START = 0.75;
export const COMPANION_FLOOR = 0.08;
const COMPANION_DECAY_PER_S = 0.00022 * 60;

export class CompanionSource implements TurbulenceSource {
  private level = COMPANION_START;
  update(_env: number, dt: number, breathCycleProgress: number): number {
    this.level = Math.max(COMPANION_FLOOR, this.level - COMPANION_DECAY_PER_S * dt);
    return this.level + Math.sin(breathCycleProgress * 2 * Math.PI) * 0.04;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- turbulence`
Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/signal/turbulence.ts src/signal/__tests__/turbulence.test.ts
git commit -m "feat: Mirror/SoftMirror/Companion turbulence sources"
```

---

### Task 5: Types + calibration math

**Files:**
- Create: `src/types.ts`
- Create: `src/signal/calibration.ts`
- Create: `src/signal/__tests__/calibration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/types.ts`: `type SensitivityPreset = 'gentle' | 'standard' | 'sensitive'`, `type FeedbackMode = 'mirror' | 'soft_mirror' | 'companion'`, `type SensorState = 'ok' | 'denied' | 'unavailable'`, `type TriggerTag = 'coffee' | 'poor_sleep' | 'stress' | 'alcohol' | 'fatigue'`, `interface CalibrationProfile { sens: number; preset: SensitivityPreset; restAvg: number; naturalHoldAvg: number; shakeThreshold: number; calibratedAt: string }`
  - `src/signal/calibration.ts`: `const DEFAULT_SENS = 2.2`, `type CalibrationResult = { ok: true; profile: CalibrationProfile } | { ok: false; reason: 'insufficient_data' | 'implausible' }`, `function computeCalibration(restSamples: number[], holdSamples: number[], preset: SensitivityPreset, now?: Date): CalibrationResult`, `function applyPreset(profile: CalibrationProfile, preset: SensitivityPreset): CalibrationProfile`

- [ ] **Step 1: Write the failing tests**

`src/signal/__tests__/calibration.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- calibration`
Expected: FAIL — cannot find module '../calibration'.

- [ ] **Step 3: Implement**

`src/types.ts`:
```ts
export type SensitivityPreset = 'gentle' | 'standard' | 'sensitive';
export type FeedbackMode = 'mirror' | 'soft_mirror' | 'companion';
export type SensorState = 'ok' | 'denied' | 'unavailable';
export type TriggerTag = 'coffee' | 'poor_sleep' | 'stress' | 'alcohol' | 'fatigue';

export interface CalibrationProfile {
  /** turbulence threshold, m/s²; clamped to [0.8, 6.0] */
  sens: number;
  preset: SensitivityPreset;
  /** mean envelope during 10s rest-on-table phase, m/s² */
  restAvg: number;
  /** mean envelope during 15s natural-hold phase, m/s² */
  naturalHoldAvg: number;
  /** shake-to-launch trigger: max(1.5, naturalHoldAvg × 1.8) */
  shakeThreshold: number;
  calibratedAt: string; // ISO 8601
}
```

`src/signal/calibration.ts`:
```ts
import type { CalibrationProfile, SensitivityPreset } from '../types';

export const DEFAULT_SENS = 2.2; // prototype value, used before first calibration

const SENS_MIN = 0.8;
const SENS_MAX = 6.0;
const MIN_PHASE_SAMPLES = 60; // ≥ ~1s of data at 60Hz per phase
const HOLD_OVER_REST_MIN = 1.2;

const PRESET_FACTOR: Record<SensitivityPreset, number> = {
  gentle: 1.3,    // sea reacts less
  standard: 1.0,
  sensitive: 0.7, // sea reacts more
};

export type CalibrationResult =
  | { ok: true; profile: CalibrationProfile }
  | { ok: false; reason: 'insufficient_data' | 'implausible' };

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const clean = (xs: number[]) => xs.every((v) => Number.isFinite(v) && v >= 0);

const clampSens = (raw: number, preset: SensitivityPreset) =>
  Math.min(SENS_MAX, Math.max(SENS_MIN, raw * PRESET_FACTOR[preset]));

/** naturalHoldAvg → sens such that the hold maps to 0.6 turbulence: inverts T = (env/sens)^0.8 */
const rawSensFor = (naturalHoldAvg: number) => naturalHoldAvg / Math.pow(0.6, 1.25);

export function computeCalibration(
  restSamples: number[],
  holdSamples: number[],
  preset: SensitivityPreset,
  now: Date = new Date(),
): CalibrationResult {
  if (restSamples.length < MIN_PHASE_SAMPLES || holdSamples.length < MIN_PHASE_SAMPLES) {
    return { ok: false, reason: 'insufficient_data' };
  }
  if (!clean(restSamples) || !clean(holdSamples)) {
    return { ok: false, reason: 'implausible' };
  }
  const restAvg = mean(restSamples);
  const naturalHoldAvg = mean(holdSamples);
  // tiny relative tolerance so float accumulation in mean() can't sneak a
  // hold past an inclusive boundary (e.g. mean of 900×1.2 = 1.20000000000002)
  if (naturalHoldAvg <= restAvg * HOLD_OVER_REST_MIN * (1 + 1e-9)) {
    return { ok: false, reason: 'implausible' };
  }
  return {
    ok: true,
    profile: {
      sens: clampSens(rawSensFor(naturalHoldAvg), preset),
      preset,
      restAvg,
      naturalHoldAvg,
      shakeThreshold: Math.max(1.5, naturalHoldAvg * 1.8),
      calibratedAt: now.toISOString(),
    },
  };
}

/** Re-derive sens for a new preset from the stored measurement, re-clamped. */
export function applyPreset(
  profile: CalibrationProfile,
  preset: SensitivityPreset,
): CalibrationProfile {
  return { ...profile, preset, sens: clampSens(rawSensFor(profile.naturalHoldAvg), preset) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- calibration`
Expected: 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/signal/calibration.ts src/signal/__tests__/calibration.test.ts
git commit -m "feat: calibration math with validation, clamped sens, shake threshold"
```

---

### Task 6: Shake detector

**Files:**
- Create: `src/signal/shake.ts`
- Create: `src/signal/__tests__/shake.test.ts`

**Interfaces:**
- Consumes: `computeCalibration` from `src/signal/calibration.ts` (in tests, per spec §13 — shake tests are calibration-profile-driven).
- Produces: `class ShakeDetector { constructor(threshold: number, sustainMs?: number /* 600 */, cooldownMs?: number /* 4000 */); update(env: number, nowMs: number): boolean; notifySessionEnded(nowMs: number): void }` — `update` returns true exactly once per launch.

- [ ] **Step 1: Write the failing tests**

`src/signal/__tests__/shake.test.ts`:
```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- shake`
Expected: FAIL — cannot find module '../shake'.

- [ ] **Step 3: Implement**

`src/signal/shake.ts`:
```ts
// Shake-to-launch (spec §12): envelope > calibration-relative threshold sustained
// 600ms fires a session start; 4s cooldown after firing and after session end.
export class ShakeDetector {
  private sinceMs: number | null = null;
  private cooldownUntilMs = 0;

  constructor(
    private threshold: number, // CalibrationProfile.shakeThreshold, m/s²
    private sustainMs = 600,
    private cooldownMs = 4000,
  ) {}

  /** Feed the current envelope; returns true exactly once when a launch should fire. */
  update(env: number, nowMs: number): boolean {
    if (nowMs < this.cooldownUntilMs) {
      this.sinceMs = null;
      return false;
    }
    if (env > this.threshold) {
      if (this.sinceMs === null) this.sinceMs = nowMs;
      if (nowMs - this.sinceMs > this.sustainMs) {
        this.sinceMs = null;
        this.cooldownUntilMs = nowMs + this.cooldownMs;
        return true;
      }
    } else {
      this.sinceMs = null;
    }
    return false;
  }

  notifySessionEnded(nowMs: number): void {
    this.cooldownUntilMs = nowMs + this.cooldownMs;
    this.sinceMs = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- shake`
Expected: 5 tests PASS.

- [ ] **Step 5: Run the FULL suite**

Run: `npm test`
Expected: all suites (envelope, downsample, turbulence, calibration, shake) PASS.

- [ ] **Step 6: Commit**

```bash
git add src/signal/shake.ts src/signal/__tests__/shake.test.ts
git commit -m "feat: calibration-relative shake detector with sustain and cooldown"
```

---

### Task 7: DeviceMotion bridge + live debug screen

**Files:**
- Create: `src/sensors/motionSource.ts`
- Modify: `app/index.tsx` (replace placeholder with debug screen)
- Modify: `app.json` (iOS motion permission string)

**Interfaces:**
- Consumes: `EnvelopeFollower`, `MotionSample` from `src/signal/envelope.ts`; `MirrorSource` from `src/signal/turbulence.ts`; `DEFAULT_SENS` from `src/signal/calibration.ts`; `SensorState` from `src/types.ts`.
- Produces: `async function startMotionSource(onSample: (s: MotionSample) => void, intervalMs?: number /* 16 */): Promise<{ state: SensorState; stop: () => void }>` — Milestones 2–3 reuse this exact bridge for sessions and Home-screen shake detection.

- [ ] **Step 1: iOS permission string in app.json**

Add inside the existing `expo.ios` object (create `infoPlist` if absent):
```json
"ios": {
  "infoPlist": {
    "NSMotionUsageDescription": "Dalga uses the motion sensor to reflect your hand's movement in the sea scene during sessions."
  }
}
```

- [ ] **Step 2: Implement the sensor bridge**

`src/sensors/motionSource.ts`:
```ts
import { DeviceMotion, DeviceMotionMeasurement } from 'expo-sensors';
import type { MotionSample } from '../signal/envelope';
import type { SensorState } from '../types';

export interface MotionSource {
  state: SensorState;
  stop: () => void;
}

/**
 * Starts DeviceMotion (m/s², matching the prototype's units) and adapts events
 * into pipeline MotionSamples. intervalMs 16 in sessions; pass ~33 on Home
 * to save battery (spec §5).
 */
export async function startMotionSource(
  onSample: (s: MotionSample) => void,
  intervalMs = 16,
): Promise<MotionSource> {
  if (!(await DeviceMotion.isAvailableAsync())) {
    return { state: 'unavailable', stop: () => {} };
  }
  const perm = await DeviceMotion.requestPermissionsAsync();
  if (!perm.granted) {
    return { state: 'denied', stop: () => {} };
  }
  DeviceMotion.setUpdateInterval(intervalMs);
  let lastT: number | null = null;
  const sub = DeviceMotion.addListener((m: DeviceMotionMeasurement) => {
    const now = Date.now();
    // clamp dt so a backgrounded app doesn't produce one giant smoothing step
    const dt = lastT === null ? intervalMs / 1000 : Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    onSample({
      acceleration: m.acceleration ?? null,
      accelerationIncludingGravity: m.accelerationIncludingGravity ?? null,
      dt,
    });
  });
  return { state: 'ok', stop: () => sub.remove() };
}
```

- [ ] **Step 3: Debug screen**

Replace `app/index.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EnvelopeFollower } from '../src/signal/envelope';
import { MirrorSource } from '../src/signal/turbulence';
import { DEFAULT_SENS } from '../src/signal/calibration';
import { startMotionSource } from '../src/sensors/motionSource';
import type { SensorState } from '../src/types';

// Temporary Milestone-1 debug readout; replaced by the real Home in Milestone 2.
export default function DebugScreen() {
  const follower = useRef(new EnvelopeFollower()).current;
  const mirror = useRef(new MirrorSource(DEFAULT_SENS)).current;
  const [state, setState] = useState<SensorState | 'starting'>('starting');
  const [env, setEnv] = useState(0);
  const [turb, setTurb] = useState(0);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const latest = { env: 0, turb: 0 };
    (async () => {
      const src = await startMotionSource((s) => {
        latest.env = follower.process(s);
        latest.turb = mirror.update(latest.env, s.dt, 0);
      });
      if (cancelled) { src.stop(); return; }
      setState(src.state);
      stop = src.stop;
    })();
    const ui = setInterval(() => {
      setEnv(latest.env);
      setTurb(latest.turb);
    }, 100);
    return () => {
      cancelled = true;
      stop();
      clearInterval(ui);
    };
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.label}>dalga · signal debug</Text>
      <Text style={styles.value}>sensor: {state}</Text>
      <Text style={styles.value}>envelope: {env.toFixed(3)} m/s²</Text>
      <Text style={styles.value}>turbulence: {turb.toFixed(3)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A1120',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    color: '#8FB6AE',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  value: { color: '#EDE6D0', fontSize: 22, fontVariant: ['tabular-nums'] },
});
```

- [ ] **Step 4: Full test suite still green**

Run: `npm test`
Expected: all suites PASS (this task adds no unit tests — the bridge is a thin RN adapter; it is verified on-device).

- [ ] **Step 5: Build the dev client and verify on a real device (MANUAL — requires the user)**

Run: `npx expo run:android` (or `npx expo run:ios` on a Mac).
On the device:
- Phone flat on a table → envelope ≈ 0.00–0.05, turbulence drifts to ≈ 0.
- Natural hold → envelope small but nonzero, turbulence low.
- Deliberate shake → envelope > 1.5, turbulence climbs toward 1, falls back smoothly (slower than it rose — asymmetric follower visible).
- sensor line reads `ok`.

This step is the milestone's acceptance test. If numbers look dead, check that the app is a dev-client build (not Expo Go) and that motion permission was granted.

- [ ] **Step 6: Commit**

```bash
git add src/sensors/motionSource.ts app/index.tsx app.json
git commit -m "feat: DeviceMotion bridge and live signal debug screen"
```

---

## Self-review checklist (run after Task 7)

- All five signal test suites pass with `npm test`.
- No file in `src/signal/` imports anything from `react-native`, `expo-*`, or `react` (verify: `grep -rE "from 'react|from 'expo" src/signal/` returns nothing).
- Constants audit against `reference/dalga-prototype.jsx`: 0.02 / 0.25 / 0.06 / 2.2 / ^0.8 / 0.03 / 0.00022 / 0.08 / 0.75 / 600ms / 4000ms all present in time-constant or direct form.
