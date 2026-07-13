# Dalga — Next Session Handoff

**Written:** 2026-07-13. Read this first in a fresh session before doing anything else — it's the state a new Claude Code session (e.g. on macOS) needs, since the working ledger (`.superpowers/sdd/`) is local scratch and does not travel with `git clone`.

## Where things stand

- **Repo:** https://github.com/Lostris201/dalga (private)
- **Branch:** `master`, up to date, no other branches
- **Milestone 1 is done and merged:** Expo scaffold + the complete pure-TS signal pipeline (envelope follower, downsampler, three turbulence sources, calibration math, shake detector) + a DeviceMotion sensor bridge feeding a temporary debug screen (`app/index.tsx`).
- 33/33 unit tests passing (`npm test`), `npx tsc --noEmit` clean, whole-branch review approved (no Critical/Important findings against the implementation).
- Dev-client config from an Android build is committed: `app.json` has `android.package: "com.lostris.dalga"` and foreground-service audio permissions.

## Read these two files before anything else

1. `docs/superpowers/specs/2026-07-11-dalga-design.md` — the full approved design (data model, signal pipeline, Skia scene, audio engine, screens, i18n, export, all 6 milestones). This is the source of truth for every constant and architectural decision.
2. `docs/superpowers/plans/2026-07-11-milestone-1-signal-core.md` — the Milestone 1 implementation plan that was just executed. Its Global Constraints section and the actual `src/signal/` code show the established coding conventions (pure TS modules, time-constant-form smoothing, byte-for-byte constant fidelity to `reference/dalga-prototype.jsx`).

## First thing to do on macOS: the pending manual device check

Milestone 1's Task 7 Step 5 (in the plan above) was never run — it requires a physical device and was explicitly left for the human. **Do this before starting Milestone 2**, since it's the actual acceptance test for everything built so far:

```bash
npm install
npx expo run:ios   # builds and installs a custom dev client (NOT Expo Go — see below)
```

On the device, check the debug screen (`app/index.tsx`):
- Phone flat on a table → envelope ≈ 0.00–0.05, turbulence drifts toward 0.
- Natural hold → envelope small but nonzero, turbulence low.
- Deliberate shake → envelope > 1.5, turbulence climbs toward 1, falls back more slowly than it rose (the asymmetric envelope follower — rise α=0.25, fall α=0.06 — should be visible).
- The `sensor:` line reads `ok`.

**Why a custom dev client and not Expo Go:** `react-native-audio-api` and full Skia usage aren't bundled in plain Expo Go. `expo-dev-client` is already installed; `npx expo run:ios` builds a custom client (needs Xcode). If numbers look dead on-device, confirm it's actually the dev-client build running, not Expo Go, and that motion permission was granted (`NSMotionUsageDescription` is already set in `app.json`).

## Known forward-looking item for Milestone 2 (not a bug, but design for it explicitly)

The final whole-branch review for Milestone 1 flagged: **`MirrorSource`, `SoftMirrorSource`, `CompanionSource` in `src/signal/turbulence.ts` (and `alphaForDt` in `src/signal/envelope.ts`) are plain TS methods/functions with no `'worklet'` directive.** Milestone 2's design (spec §7) calls for a Reanimated `useFrameCallback` worklet on the UI thread to compute turbulence every frame. Reanimated's babel plugin auto-workletizes the top-level callback passed to `useFrameCallback`, but does **not** auto-workletize arbitrary imported class methods called from inside it — calling `.update()` on these classes from within the worklet will likely throw ("Tried to synchronously call a non-worklet function") unless addressed.

Two options to resolve when writing the Milestone 2 plan:
- (a) Add `'worklet';` as the first statement in each `update()` method body (and in `alphaForDt`), and re-verify the existing Milestone 1 unit tests still pass (worklet directives are no-ops off the UI thread, so this should be safe) — cheap, minimal diff.
- (b) Design a worklet-safe reimplementation/wrapper if (a) proves insufficient once Reanimated is actually wired up.

Make this an explicit early task in the Milestone 2 plan rather than discovering it mid-implementation.

## Deferred cleanup items (low priority, safe to batch whenever convenient — not blocking)

- `app.json` still has off-palette template colors: splash `backgroundColor #208AEF`, adaptiveIcon `backgroundColor #E6F4FE` (plan palette is night `#0A1120`). Fine to fix alongside real branding/icon work later.
- Unused template assets still committed: `assets/images/react-logo*.png`, `tutorial-web.png`, `tabIcons/*`, `expo-badge*.png`, `logo-glow.png`. None are referenced by `app.json` or source.
- `tsconfig.json` has `"types": ["jest"]` project-wide (jest globals type-check as valid inside app runtime code, not just tests). Low risk at current size; revisit if it ever causes a real problem.
- `src/signal/__tests__/downsample.test.ts` has no test for the `n === maxBuckets` exact boundary or a custom `maxBuckets` argument. Add if a later task calls `downsample()` with a non-default value.
- `app/index.tsx` (the throwaway debug screen — fully replaced in Milestone 2) does `useRef(new EnvelopeFollower()).current` — the `new ...()` call re-runs on every render even though `useRef` discards all but the first result. Harmless here since the file is temporary, but don't copy this pattern into the real Home screen in Milestone 2; use `const ref = useRef<T | null>(null); if (!ref.current) ref.current = new T();` instead.
- `src/sensors/motionSource.ts` imports `DeviceMotionMeasurement` as a value import where it's only used as a type; `import type` would be more correct.
- `src/signal/envelope.ts`'s linear-acceleration branch only checks `Number.isFinite(lin.x)`, not `y`/`z`. Inert in practice (DeviceMotion always supplies all three or none), but a small hardening gap.

## How to continue

1. Run the device check above. If it fails or looks wrong, treat that as a bug to fix before proceeding — don't start Milestone 2 on an unverified pipeline.
2. Once verified, invoke the `writing-plans` skill against `docs/superpowers/specs/2026-07-11-dalga-design.md` to write the Milestone 2 plan (Skia scene: sky/stars/moon/sea/shimmer, breath clock, session start/end, reduced motion — spec §7 and milestone 2 of §14). Fold in the worklet-safety item above as an early task.
3. Then continue with subagent-driven-development as was done for Milestone 1: fresh implementer subagent per task, task review after each, whole-branch review at the end, then `finishing-a-development-branch` to merge.

This project has been using: `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development` → `superpowers:finishing-a-development-branch`, in that order, once per milestone. Milestone 1 is the completed example of this cycle end to end.
