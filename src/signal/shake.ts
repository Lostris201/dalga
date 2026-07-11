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
