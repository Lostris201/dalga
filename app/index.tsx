import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EnvelopeFollower } from '../src/signal/envelope';
import { MirrorSource } from '../src/signal/turbulence';
import { DEFAULT_SENS } from '../src/signal/calibration';
import { startMotionSource } from '../src/sensors/motionSource';
import type { SensorState } from '../src/types';

// Temporary Milestone-1 debug readout; replaced by the real Home in Milestone 2.
export default function DebugScreen() {
  const followerRef = useRef<EnvelopeFollower | null>(null);
  const mirrorRef = useRef<MirrorSource | null>(null);
  if (!followerRef.current) followerRef.current = new EnvelopeFollower();
  if (!mirrorRef.current) mirrorRef.current = new MirrorSource(DEFAULT_SENS);
  const follower = followerRef.current;
  const mirror = mirrorRef.current;
  const [state, setState] = useState<SensorState | 'starting'>('starting');
  const [env, setEnv] = useState(0);
  const [turb, setTurb] = useState(0);

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    const latest = { env: 0, turb: 0 };
    (async () => {
      const src = await startMotionSource((s) => {
        latest.env = follower.process(s);
        latest.turb = mirror.update(latest.env, s.dt, 0);
      });
      if (cancelled) { src.stop(); return; }
      setState(src.state);
      stop = src.stop;
    })();
    const ui = setInterval(() => {
      setEnv(latest.env);
      setTurb(latest.turb);
    }, 100);
    return () => {
      cancelled = true;
      stop();
      clearInterval(ui);
    };
  }, []);

  return (
    <View style={styles.root}>
      <Text style={styles.label}>dalga · signal debug</Text>
      <Text style={styles.value}>sensor: {state}</Text>
      <Text style={styles.value}>envelope: {env.toFixed(3)} m/s²</Text>
      <Text style={styles.value}>turbulence: {turb.toFixed(3)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A1120',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  label: {
    color: '#8FB6AE',
    fontSize: 14,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  value: { color: '#EDE6D0', fontSize: 22, fontVariant: ['tabular-nums'] },
});
