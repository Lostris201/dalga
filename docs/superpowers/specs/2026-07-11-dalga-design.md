# Dalga — Design Document

**Date:** 2026-07-11
**Status:** Approved section-by-section in brainstorming; pending full-spec review
**Reference implementation:** `reference/dalga-prototype.jsx` (validated web prototype; all tuned constants originate there)

## 1. Product summary

Dalga is a React Native (Expo) app for people with essential tremor. The phone's motion sensor measures tremor in real time and drives a living night-sea scene; guided extended-exhale breathing visibly calms the sea. It is explicitly **not a medical device or treatment** — it is a companion tool for relaxation during episodes, and all copy reflects that.

Core loop: user starts a session (button, shake, or quick action) → sea mirrors (or gently accompanies) their tremor → moon guides 4s-inhale / 2s-hold / 7.5s-exhale breathing → session ends with a supportive summary → everything is logged for trend review and neurologist export.

## 2. Tech stack (all dependencies signed off)

| Concern | Choice |
|---|---|
| Framework | Expo (managed + `expo-dev-client`), TypeScript, npm |
| Navigation | Expo Router (file-based; native deep-link handling) |
| State | React Context + hooks (no external store) |
| Scene | `@shopify/react-native-skia` + `react-native-reanimated` (shared values, `useFrameCallback` worklet) |
| Audio | `react-native-audio-api` (Web Audio-compatible) |
| Sensors | `expo-sensors` → **DeviceMotion** (m/s², mirrors the web API; NOT Accelerometer, which reports g's and would invalidate the tuned constants) |
| Haptics | `expo-haptics` |
| Storage | `expo-sqlite` for sessions + doses (uncapped, grows for years); AsyncStorage for settings + active calibration profile only |
| Fonts | `@expo-google-fonts/cormorant-garamond` + `expo-font`; system sans for data/settings |
| i18n | Hand-rolled context, `en.json`/`tr.json`, `expo-localization` for device locale |
| Export | `expo-file-system` + `expo-sharing` (CSV), `expo-print` (PDF) |
| Quick actions | `expo-quick-actions` (community, config-plugin based) |
| Tests | Jest (`jest-expo`), pure-TS signal modules tested directly |

Development requires a custom dev client (`npx expo run:ios` / `run:android` or EAS dev build) — react-native-audio-api and Skia are not in Expo Go.

## 3. Project structure

```
dalga/
  app/                          # Expo Router routes (thin; compose contexts + components)
    _layout.tsx                 # providers, font loading, splash, route guards
    index.tsx                   # Home
    onboarding/[step].tsx       # 4 cards
    calibration.tsx
    session.tsx
    session-end.tsx
    log/index.tsx
    log/[sessionId].tsx
    settings/index.tsx
    settings/reading.tsx
  src/
    signal/                     # PURE TS — no RN imports; unit-testable
      envelope.ts               # gravity EMA, magnitude, envelope follower
      turbulence.ts             # mode-specific turbulence sources
      shake.ts                  # shake-to-launch detector
      downsample.ts             # ≤120-bucket mean downsampler
      __tests__/
    scene/
      SeaScene.tsx              # Canvas + frame worklet
      sea.ts / moon.ts / stars.ts
      breathClock.ts            # pure, tested
    audio/
      SoundEngine.ts            # interface
      DroneEngine.ts            # ported synth graph
    state/
      SettingsContext.tsx
      CalibrationContext.tsx
      SessionContext.tsx
    storage/
      db.ts                     # sqlite open + migration runner (PRAGMA user_version)
      sessions.ts / doses.ts    # typed CRUD
      settingsStore.ts          # AsyncStorage
    i18n/
      en.json / tr.json / index.tsx
    export/
      csv.ts / pdf.ts
    theme/
      colors.ts / typography.ts
    components/
      EpisodeButton.tsx / EpisodeChip.tsx   # attack-mode-compliant controls
    reducedMotion.ts
  reference/
    dalga-prototype.jsx
```

## 4. Data model & persistence

### 4.1 Types

```ts
type SensitivityPreset = 'gentle' | 'standard' | 'sensitive';
type TriggerTag = 'coffee' | 'poor_sleep' | 'stress' | 'alcohol' | 'fatigue';
type FeedbackMode = 'mirror' | 'soft_mirror' | 'companion';
type SensorState = 'ok' | 'denied' | 'unavailable';

interface CalibrationProfile {
  sens: number;             // turbulence threshold; clamped to [0.8, 6.0]
  preset: SensitivityPreset;
  restAvg: number;          // mean envelope (m/s²), 10s rest-on-table phase
  naturalHoldAvg: number;   // mean envelope (m/s²), 15s natural-hold phase
  shakeThreshold: number;   // max(1.5, naturalHoldAvg * 1.8); recomputed each recalibration
  calibratedAt: string;     // ISO 8601
}

interface SessionEntry {
  id: string;
  at: string;                        // ISO 8601, session start
  durationMins: number;
  sensorState: SensorState;          // recording vs display are independent axes

  series: number[];                  // envelope m/s², downsampled ≤120 pts;
                                     // empty ⇔ sensorState !== 'ok', never otherwise
  sampleSpanMs: number;              // per-bucket dt = sampleSpanMs / series.length

  startAvg: number | null;           // mean of first 20% of RAW samples (m/s²)
  endAvg: number | null;             // mean of last 20%
  dropPct: number | null;            // max(0, (1 − endAvg/startAvg) × 100); null when no data

  mode: FeedbackMode;                // ALWAYS the user's chosen mode, never overwritten
  breathTimings: { inhale: number; hold: number; exhale: number };
  soundOn: boolean;
  hapticsOn: boolean;
  calibration: CalibrationProfile;   // snapshot active during this session

  tags: TriggerTag[];                // post-session only; empty by default
}

interface DoseEntry {
  id: string;
  at: string;
  medicationName: string;   // free text; last value remembered as suggestion
  doseAmount?: string;      // optional free text, e.g. "100mg"
  status: 'taken' | 'skipped';
}

interface AppSettings {
  mode: FeedbackMode;
  breathTimings: { inhale: number; hold: number; exhale: number }; // clamps: 3–6 / 0–4 / 6–10 s
  soundOn: boolean;          // persisted last state of session sound toggle
  hapticsOn: boolean;        // default true
  showSeaNumber: boolean;    // default false; NEVER applies in Companion
  language: 'system' | 'en' | 'tr';
}
```

### 4.2 SQLite schema (v1)

```sql
CREATE TABLE sessions (
  id                     TEXT PRIMARY KEY,
  at                     TEXT NOT NULL,
  duration_mins          REAL NOT NULL,
  sensor_state           TEXT NOT NULL CHECK (sensor_state IN ('ok','denied','unavailable')),
  sample_span_ms         INTEGER NOT NULL,
  series                 TEXT NOT NULL,      -- JSON number[], ≤120 pts, m/s²
  start_avg              REAL,               -- NULL ⇔ sensor_state != 'ok'
  end_avg                REAL,
  drop_pct               REAL,
  mode                   TEXT NOT NULL CHECK (mode IN ('mirror','soft_mirror','companion')),
  breath_inhale          REAL NOT NULL,
  breath_hold            REAL NOT NULL,
  breath_exhale          REAL NOT NULL,
  sound_on               INTEGER NOT NULL,
  haptics_on             INTEGER NOT NULL,
  calib_sens             REAL NOT NULL,
  calib_preset           TEXT NOT NULL CHECK (calib_preset IN ('gentle','standard','sensitive')),
  calib_rest_avg         REAL NOT NULL,
  calib_natural_hold_avg REAL NOT NULL,
  calib_shake_threshold  REAL NOT NULL,
  calib_at               TEXT NOT NULL
);
CREATE INDEX idx_sessions_at ON sessions(at);

CREATE TABLE session_tags (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tag        TEXT NOT NULL CHECK (tag IN ('coffee','poor_sleep','stress','alcohol','fatigue')),
  PRIMARY KEY (session_id, tag)
);

CREATE TABLE doses (
  id              TEXT PRIMARY KEY,
  at              TEXT NOT NULL,
  medication_name TEXT NOT NULL,
  dose_amount     TEXT,
  status          TEXT NOT NULL CHECK (status IN ('taken','skipped'))
);
CREATE INDEX idx_doses_at ON doses(at);
```

Schema versioned via `PRAGMA user_version` with a migration runner from day one. No row caps anywhere. AsyncStorage keys: `dalga.settings`, `dalga.calibration`, `dalga.lastMedicationName`, `dalga.onboarded`.

## 5. Signal pipeline & feedback modes

One pipeline, pure TS, driven by DeviceMotion callbacks (16ms interval in session, ~30Hz on Home for battery):

```
DeviceMotion event (m/s²)
  ├─ prefer e.acceleration; else e.accelerationIncludingGravity − gravity EMA (α = 0.02)
  ├─ magnitude = √(x²+y²+z²)
  ├─ envelope follower: α = 0.25 rising / 0.06 falling          ← ported verbatim
  │
  ├──► RECORDER — runs in ALL modes whenever sensorState = 'ok', including
  │    Companion. Modes never affect recording. Pushes raw {t, envelope};
  │    downsampled to ≤120 bucket-means on save.
  │
  └──► TURBULENCE SOURCE (mode selects what drives scene + audio):
       Mirror:      target = min(1, (env / sens)^0.8), smoothed toward target
                    (prototype 0.03/frame @60fps)                ← ported verbatim
       Soft Mirror: same target through a ~60s time-constant smoother
                    (α ≈ dt/60s), INITIALIZED to the first computed target at
                    session start — starts truthful, never shows false calm
       Companion:   breath engine only — starts ~0.75, ported decay
                    (0.00022/frame @60fps) + soft swell synced to the breath
                    cycle. Envelope is NEVER an input. No fake adherence
                    scoring; elapsed time following the guide is the proxy.
```

- `EnvelopeFollower` and `TurbulenceSource` are separate classes; one follower per session feeds both the recorder and the active source. Mode switches swap the source without restarting anything.
- **Frame-rate independence:** all per-frame constants (0.03, 0.00022, follower αs) are converted to time-constant form `α = 1 − exp(−dt/τ)`, with τ chosen to match the prototype exactly at 60 Hz — identical behavior on 60Hz displays, correct on 120Hz.
- The prototype's "demo mode" is dropped as a concept; its turbulence generator survives as the Companion breath engine.

### 5.1 Sensor availability

- iOS `NSMotionUsageDescription` via `app.json → ios.infoPlist`. On session start: `DeviceMotion.isAvailableAsync()` + `requestPermissionsAsync()`.
- Denied/unavailable → session still runs on the breath engine; pre-session notice: "Motion access is off — the sea will follow your breath instead" (+ link to OS settings). `sensor_state` records `denied`/`unavailable`; `mode` keeps the user's choice; `series` empty; stats NULL.

## 6. Calibration

Two timed phases with the live sea as feedback:

1. **Rest** (10s): phone hand rests on a table → `restAvg`.
2. **Natural hold** (15s): user holds phone naturally → `naturalHoldAvg`.

Derived values:

- `rawSens = naturalHoldAvg / 0.6^1.25` — maps the natural hold to ~0.6 turbulence (inverting `T = (env/sens)^0.8`). Default before first calibration: 2.2 (prototype value).
- Preset scaling: gentle = ×1.3 (sea reacts less), standard = ×1.0, sensitive = ×0.7.
- `sens = clamp(rawSens × presetFactor, 0.8, 6.0)` — clamp applied **after** preset scaling so the stored value can never leave bounds. Changing preset in Settings rescales from the stored raw measurement and re-clamps.
- `shakeThreshold = max(1.5, naturalHoldAvg × 1.8)`, recomputed on every recalibration.

**Validation — never write an implausible profile:**
- Reject if `naturalHoldAvg <= restAvg × 1.2` (phases indistinguishable → hand probably wasn't held / rested as instructed).
- Reject if either phase looks corrupted (non-finite values, near-zero sample count, or negative averages).
- On rejection: keep the previous profile (or default sens = 2.2 with shake-to-launch disabled on first run), show a friendly redo prompt — neutral framing, no failure language.

Re-runnable from Settings anytime.

## 7. Skia scene & breath clock

**Architecture:** one full-screen `<Canvas>` (Home, Session; dimmed backdrop on Session-end). A Reanimated `useFrameCallback` worklet runs per display frame: reads the envelope shared value (pushed from the JS sensor listener), computes turbulence via the active mode source (time-constant form, real dt), advances the breath clock, writes `turbulence`/`calm`/`moonScale`/`breathPhase` shared values. Skia elements bind via derived values — zero React re-renders per frame; React state changes only on phase transitions.

**Elements (constants ported verbatim):**

- **Sky:** vertical gradient `#0A1120 → #101B30` over top 62%.
- **Stars (required, not decoration — the primary progress cue for Soft Mirror):** 90 stars in the top half, r 0.4–1.8; opacity `max(0, calm − 0.25) × 1.2 × twinkle`; twinkle `0.75 + 0.25·sin(t/900 + phase)`, frozen to 1 under reduced motion.
- **Moon:** center (0.5w, 0.30h), r `min(w,h) × 0.11 × moonScale`; radial glow `mr×0.4 → mr×(2.6 + calm×1.4)`, inner alpha `0.28 + calm×0.25`. moonScale 0.62–1.0 driven by the breath clock with the ported easeInOut.
- **Sea:** three wave layers below horizon (0.58h) with ported params (amp 10/16/24; colors #16303B/#0F2530/#0B1B26; k, speed, jig per layer); vertex = `swellA·(0.35 + T·1.1) + swellB·0.5T + chop·T²`, sampled every 4px, rebuilt per frame as Skia Paths in the worklet.
- **Moonpath shimmer:** band under the moon, width `mr × (1.1 + T×2.2)`, alpha `0.10 + calm×0.12`.

**Breath clock** (`breathClock.ts`, pure + tested): builds phases from user `breathTimings` (defaults 4.0/2.0/7.5s), returns `{ phaseName, phaseProgress, moonScale }` from elapsed time. Consumers: moon, audio engine (`setBreathPhase`), haptics (one `selectionAsync` tick per phase change when enabled). Breath word rendered as RN `<Text>` (Cormorant Garamond), updated only on phase change: "Breathe in / Hold / Long breath out"; TR: "Nefes al / Tut / Uzun nefes ver".

**Reduced motion:** `AccessibilityInfo.isReduceMotionEnabled` + change listener → shared value; waves ×0.4, twinkle off.

**Performance:** wave paths ≈ 3 × (w/4) points/frame — verify 60fps on device in milestone 2; raise x-step adaptively if needed. Session screen mounts only canvas + word + two buttons.

### 7.1 Sea-number readout

Top-corner numeric readout renders only when `settings.showSeaNumber && mode !== 'companion'`. In Companion it is hidden unconditionally — encoded as a single derived `canShowSeaNumber` selector so no screen can bypass it. **Companion shows no tremor-derived numbers anywhere, including the end screen** (duration + supportive line only; dropPct is still computed, stored, and visible later in the Log).

## 8. Audio

**Two-layer design** so synthesized voices can be replaced by sample stems later:

```ts
interface SoundEngine {
  init(): void; dispose(): void;
  setEnabled(on: boolean): void;                      // master fade 0 ↔ 0.5 over 0.6s
  setCalmness(calm: number): void;                    // 0..1, 1 = still sea
  setBreathPhase(phase: 'inhale'|'hold'|'exhale', progress: number): void;
}
```

`DroneEngine implements SoundEngine` — the ported graph:

- master Gain(0) → destination; lowpass BiquadFilter(600Hz, Q 0.7) → master.
- Chord into the filter: A2 110Hz sine g 0.10 · E3 164.8Hz sine g 0.07 · A3 220Hz **triangle** g 0.045. Tension voice 116.5Hz sine g 0.
- Wind: 2s looped white-noise buffer → bandpass 500Hz Q 0.5 → gain 0 → master (bypasses lowpass, as in prototype).

Mapping (all `setTargetAtTime`, tc 0.15; detunes tc 0.05; T = 1 − calm):
- cutoff = `280 + calm×1400 + breathSwell×180` (breathSwell = the 0.62–1.0 ramp derived internally from setBreathPhase)
- tension gain = `T²×0.06`; wind gain = `T×0.05`; octave gain = `0.02 + calm×0.05`
- detune: root `sin(t/90)×T×14`¢, fifth `sin(t/130+2)×T×10`¢

**Cadence:** 30Hz JS-thread tick reads the same shared values as the scene (audio-api calls are JS-side; fastest target has ~570ms period; setTargetAtTime smooths between ticks).

**Platform:**
- iOS session: **playback category with `mixWithOthers`** — plays despite the silent switch (audio only ever starts from an explicit tap, so surprise audio is impossible; many users keep phones permanently silent and a silent-switch-respecting toggle would appear broken mid-attack), and layers over the user's own audio instead of killing it.
- **Interruptions** (call, Siri): pause gracefully; on interruption end, resume only if the session is still running AND soundOn is still true.
- Toggle persists to `settings.soundOn`. Engine lazily constructed on first enable. Session end: master → 0 over ~2s, then suspend context.

## 9. Screens & flow

**Route guards (root layout):** not onboarded → `/onboarding/1`; onboarded but never calibrated → `/calibration`. All entry points including deep links pass through these guards.

1. **Onboarding** (first launch): 4 cards — what ET is (plain language) · why relaxation reduces amplitude during episodes (stress/adrenaline amplify it) · "Dalga is a companion, not a treatment — it does not replace your medication or doctor" · mode picker with one-line explanations. → Calibration.
2. **Calibration:** as §6, live sea as feedback, then Gentle/Standard/Sensitive choice.
3. **Home:** idle sea, full-width Begin (≥88pt), shake hint, modest Log + Settings links, current mode name. Shake-to-launch armed (disabled before first calibration).
4. **Session:** scene, moon, breath word, big sound toggle, End. Nothing else.
5. **Session-end:** Skia amplitude curve; "The sea calmed by N%" when dropPct > 4, else "You stayed with it for X min. That counts." (Companion: duration + supportive line always); trigger-tag chips (big, post-session only); Again.
6. **Log:** session list (paged from SQLite); Skia charts — amplitude by time-of-day, by day, and **amplitude vs hours-since-dose** (sessions bucketed by time since last `taken` dose — the primary clinical payoff of the doses table; sessions with no prior dose form a separate "no dose logged" bucket); dose section with "Log a dose" (name remembered, optional amount, taken/skipped; normal controls — not episode flow); Export.
7. **Settings:** mode, breath timings (3–6 / 0–4 / 6–10s), sensitivity preset + recalibrate, sound default, haptics, show-sea-number (noting it never applies in Companion), language, Reading section (education + disclaimer + short evidence-grounded note on breathing and stress; companion framing, no medical claims).

**Attack-mode UX rules** (pre-session/session/session-end): enforced via shared `EpisodeButton`/`EpisodeChip` components — ≥80×80pt targets, full-width primaries ≥88pt, no sliders/text inputs/small icons. Settings/Log may use normal controls. High-contrast dark palette from prototype (§7 colors + bone #EDE6D0, foam #8FB6AE).

## 10. i18n

Hand-rolled ~40-line context: `en.json` / `tr.json`, `t('key')` hook, device locale via expo-localization, `system | en | tr` override. All copy in dictionaries from milestone 2 onward — nothing hard-coded.

**Copy rules:** calm, plain; never clinical-cold, never wellness-fluffy. No streaks, gamification, or guilt. Stats framed as the sea; failures framed neutrally. Disclaimer in onboarding and Settings → Reading: not a medical device, does not diagnose or treat, keep taking prescribed medication, consult a neurologist about changes.

## 11. Export

- **CSV:** `sessions.csv` — one row per session: datetime, duration, mode, sensor_state, start/end avg, drop %, tags, calibration snapshot, **computed `hours_since_last_dose`** (time since most recent `taken` dose before session start; blank if none), series as JSON column. Plus `doses.csv`.
- **PDF** (expo-print): one-page clinic report — date-range summary, sessions/week, amplitude trend + time-of-day + hours-since-dose charts as inline SVG in the print HTML (same query data as the Skia charts), dose log table.
- Both via share sheet (expo-sharing). `hours_since_last_dose` is computed at export/chart time, never stored.

## 12. Launch paths

- **In-app shake:** on Home, envelope > `shakeThreshold` sustained 600ms → session; 4s cooldown after session end; disabled before first calibration.
- **Quick actions:** iOS Home Screen quick action + Android app shortcut "Start session" → `dalga://session` deep link (expo-quick-actions).
- **Cold start < 2s to functional session:** session route imports only scene + pipeline + i18n; audio, charts, export, log lazy-loaded. Measured in milestone 6.

## 13. Testing

Jest + pure-TS signal modules, no RN mocking needed:

- Synthetic 6Hz sine of known amplitude at 60Hz sampling → envelope converges to expected value ±tolerance; turbulence mapping at sens 2.2 hits known outputs.
- Soft Mirror: step response ≈ 63% at 60s; **first frame output equals first target exactly (never 0)**.
- Downsampler: ≤120 buckets, correct bucket means, sampleSpanMs correct.
- Shake detector (calibration-profile-driven): fires after 600ms sustained above threshold with a low-baseline profile; **a synthetic severe-tremor idle hold (e.g. 2.5 m/s²) does NOT fire when naturalHoldAvg is proportionally high** (threshold 4.5); respects 4s cooldown.
- Calibration: sens clamped to [0.8, 6.0]; implausible phases (naturalHoldAvg ≤ restAvg × 1.2, corrupted data) rejected, previous profile kept.
- Breath clock: phase boundaries and moonScale at known times for default and custom timings.
- Frame-rate independence: smoothing at dt = 1/120 twice ≈ dt = 1/60 once.

## 14. Milestones (working app at each step)

1. Expo scaffold (TS, dev client, Router skeleton) · DeviceMotion pipeline · debug envelope/turbulence readout · all signal unit tests.
2. Skia scene (sea/moon/stars/shimmer) · breath clock + word + haptics · session start/end · reduced motion.
3. Modes (Mirror/Soft/Companion + Companion display rules) · calibration flow (incl. validation) · in-app shake-to-launch (threshold is calibration-derived, so it lands here).
4. Audio engine + interruption handling + sound toggle.
5. SQLite (schema + migration runner) · recorder → sessions · end-screen chart · Log screen + all three charts · tags · dose log · CSV/PDF export.
6. Onboarding · Settings · full TR translation · quick actions · cold-start optimization · polish pass.

## 15. Decisions & deviations log

- **DeviceMotion over Accelerometer** — unit fidelity (m/s²) with the prototype's tuned constants.
- **Demo mode dropped** — impossible-on-device browser fallback; its generator survives as the Companion breath engine.
- **Recording/display separated** — `sensor_state` column; recorder unconditional in all modes when sensors work; `mode` never overwritten.
- **Shake threshold calibration-relative** — fixed 1.5 m/s² would auto-launch constantly for strong-tremor users.
- **Playback audio category with mixWithOthers** — plays despite silent switch (explicit-tap-only start makes this safe); mixes rather than interrupts.
- **Medication as dose log, not trigger tag** — tags stay situational (coffee, poor_sleep, stress, alcohol, fatigue); doses get their own table and the hours-since-dose chart.
- **Reanimated added** — idiomatic 60fps Skia driving. **expo-quick-actions added** — no built-in equivalent. Both signed off.
