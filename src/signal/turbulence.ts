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
  update(env: number, dt: number, _breathCycleProgress: number): number {
    'worklet';
    const target = turbulenceTarget(env, this.sens);
    this.t += alphaForDt(TAU_MIRROR, dt) * (target - this.t);
    return this.t;
  }
}

const TAU_SOFT = 60; // seconds — user sees direction, never jitter

export class SoftMirrorSource implements TurbulenceSource {
  private t: number | null = null; // seeded from first target: start truthful
  constructor(private sens: number) {}
  update(env: number, dt: number, _breathCycleProgress: number): number {
    'worklet';
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
    'worklet';
    this.level = Math.max(COMPANION_FLOOR, this.level - COMPANION_DECAY_PER_S * dt);
    return this.level + Math.sin(breathCycleProgress * 2 * Math.PI) * 0.04;
  }
}
