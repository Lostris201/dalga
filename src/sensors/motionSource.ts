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
