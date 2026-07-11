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
