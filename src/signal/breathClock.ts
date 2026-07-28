export type BreathPhaseName = 'inhale' | 'hold' | 'exhale';

export interface BreathTimings {
  inhaleS: number;
  holdS: number;
  exhaleS: number;
}

export interface BreathState {
  phaseName: BreathPhaseName;
  phaseProgress: number;
  moonScale: number;
  cycleProgress: number;
}

export const DEFAULT_BREATH_TIMINGS: BreathTimings = {
  inhaleS: 4,
  holdS: 2,
  exhaleS: 7.5,
};

const MIN_MOON_SCALE = 0.62;
const MAX_MOON_SCALE = 1.0;

const clampMs = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

export const easeInOut = (t: number): number => {
  'worklet';
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

export function getBreathState(
  elapsedMs: number,
  timings: BreathTimings = DEFAULT_BREATH_TIMINGS,
): BreathState {
  'worklet';
  const inhaleMs = clampMs(timings.inhaleS * 1000);
  const holdMs = clampMs(timings.holdS * 1000);
  const exhaleMs = clampMs(timings.exhaleS * 1000);
  const totalMs = inhaleMs + holdMs + exhaleMs;
  if (totalMs <= 0) {
    return { phaseName: 'inhale', phaseProgress: 0, moonScale: MIN_MOON_SCALE, cycleProgress: 0 };
  }

  const t = ((elapsedMs % totalMs) + totalMs) % totalMs;
  const cycleProgress = t / totalMs;

  if (t < inhaleMs) {
    const p = inhaleMs > 0 ? t / inhaleMs : 0;
    return {
      phaseName: 'inhale',
      phaseProgress: p,
      moonScale: MIN_MOON_SCALE + (MAX_MOON_SCALE - MIN_MOON_SCALE) * easeInOut(p),
      cycleProgress,
    };
  }

  if (t < inhaleMs + holdMs) {
    const local = t - inhaleMs;
    const p = holdMs > 0 ? local / holdMs : 0;
    return { phaseName: 'hold', phaseProgress: p, moonScale: MAX_MOON_SCALE, cycleProgress };
  }

  const local = t - inhaleMs - holdMs;
  const p = exhaleMs > 0 ? local / exhaleMs : 0;
  return {
    phaseName: 'exhale',
    phaseProgress: p,
    moonScale: MAX_MOON_SCALE + (MIN_MOON_SCALE - MAX_MOON_SCALE) * easeInOut(p),
    cycleProgress,
  };
}
