# Dalga

A React Native (Expo) companion app for people with essential tremor. The phone's
motion sensor measures tremor in real time and drives a night-sea scene; guided
extended-exhale breathing (4s in / 2s hold / 7.5s out) visibly calms the sea. Every
session is logged as a longitudinal dataset a neurologist can read.

It is **not a medical device or treatment**. All copy says "companion", never "treats", "reduces tremor" or "therapy".

## Read before working
1. `docs/superpowers/specs/2026-07-11-dalga-design.md`: the approved design. Source of truth for every constant, schema and screen.
2. `docs/superpowers/NEXT_SESSION.md`: where the build stands and what's pending.
3. The current milestone's plan in `docs/superpowers/plans/`.
4. `reference/dalga-prototype.jsx`: where every tuned constant came from.

## Stack
Expo SDK 57 (managed + `expo-dev-client`), TypeScript, Expo Router (`app/`), Skia + Reanimated
for the scene, `react-native-audio-api` for sound, `expo-sensors` DeviceMotion, `expo-sqlite`
for sessions and doses, Jest (`jest-expo`) for pure-TS signal modules in `src/signal/`.
Skia and audio aren't in Expo Go: test on a dev build (`npx expo run:android` over USB).

Expo changes every SDK. Before touching an Expo API, read the versioned docs for the SDK in
`package.json` (`https://docs.expo.dev/versions/v57.0.0/`). Install with `npx expo install`.

## Rules that protect the data (never break these)
- **DeviceMotion, never Accelerometer.** Units are m/s² everywhere. Accelerometer reports g's and silently invalidates every tuned constant.
- **Tuned constants are sacred.** Gravity EMA α=0.02, envelope rise 0.25 / fall 0.06, turbulence `min(1,(env/sens)^0.8)`, breath 4/2/7.5. All per-frame-at-60Hz values use the time-constant form `α = 1 − exp(−dt/τ)`. Changing one needs Cihan's sign-off and a line in spec §15.
- **Recording is unconditional.** Whenever sensors work, the session is recorded in every mode. Mode changes only what's shown. `mode` is stored as chosen, never overwritten.
- **No caps, ever.** No row limits, no pruning, no "keep last N". The log grows for years.
- **SQLite schema = spec §4.2.** Changes go through a numbered migration (`PRAGMA user_version`), never an edit to an existing one. The dose table and hours-since-dose chart are the clinical core; don't simplify them away.
- **Calibration is bounded.** `sens` clamped to [0.8, 6.0] after preset scaling; implausible phases rejected and the previous profile kept.
- **Shake threshold is calibration-relative:** `max(1.5, naturalHoldAvg × 1.8)`. Never a fixed number.
- Signal modules stay pure TS with tests. TDD: failing test first.
- en + tr for every user-facing string.

## Commands
```bash
npm test               # Jest, signal modules
npx tsc --noEmit       # must stay clean
npx expo run:android   # dev build on the phone over USB
```

## Workflow
Per milestone: `superpowers:brainstorming` (only if the spec has a gap) → `superpowers:writing-plans`
→ `superpowers:subagent-driven-development` (the `dalga-engineer` agent per task, `dalga-reviewer`
after each task and on the whole branch) → `superpowers:finishing-a-development-branch`.
Branch `m<N>-<slug>`. Pushing and merging to master is Cihan's call. `/milestone` runs this loop.

## Ship board
**Shipped means:** Google Play closed test, Android first.

Decisions (Cihan's):
- [ ] **SDK 57 → 58 now?** Talestra already hit SDK drift. M1 is small pure TS, so this is the cheapest moment to upgrade. After M2 adds Skia worklets and audio it gets more expensive.
- [ ] **Closed-test cut.** All six milestones, or test after M5 (scene, modes, calibration, audio, logging, export) with a lean M6 (TR strings and a one-screen onboarding)?

Next:
- [ ] M1 acceptance: the device check in NEXT_SESSION.md, on Android over USB (`npx expo run:android`). Never run yet. Don't start M2 on an unverified pipeline.
- [ ] M2 plan, with the worklet-safety task first (NEXT_SESSION.md "Known forward-looking item").
- [ ] M2: Skia scene, breath clock, session start/end, reduced motion.
- [ ] M3: modes, calibration flow, in-app shake-to-launch.
- [ ] M4: audio engine.
- [ ] M5: SQLite, recorder, charts (incl. amplitude vs hours-since-dose), tags, dose log, CSV/PDF export.
- [ ] M6: onboarding, settings, full TR, quick actions, polish.
- [ ] Release: `eas.json`, real icon and splash on the night palette, Play listing, data safety form (all data on device), closed test track.
