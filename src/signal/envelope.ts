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
