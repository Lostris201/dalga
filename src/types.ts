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
