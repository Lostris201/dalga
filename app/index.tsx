import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, Group, LinearGradient, Path, RadialGradient, Rect, Skia, vec } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import { runOnJS, useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import type { EnvelopeSample } from '../src/signal/downsample';
import { downsample } from '../src/signal/downsample';
import { EnvelopeFollower, alphaForDt, tauForAlphaAt60 } from '../src/signal/envelope';
import { DEFAULT_BREATH_TIMINGS, getBreathState } from '../src/signal/breathClock';
import { DEFAULT_SENS } from '../src/signal/calibration';
import { startMotionSource } from '../src/sensors/motionSource';
import type { SensorState } from '../src/types';

type ScreenPhase = 'idle' | 'session' | 'done';

interface SessionSummary {
  mins: number;
  dropPct: number;
}

const TAU_MIRROR = tauForAlphaAt60(0.03);

const PHASE_LABEL: Record<'inhale' | 'hold' | 'exhale', string> = {
  inhale: 'Breathe in',
  hold: 'Hold',
  exhale: 'Long breath out',
};

const clamp01 = (v: number): number => {
  'worklet';
  return Math.max(0, Math.min(1, v));
};

const makeStars = (count: number): { x: number; y: number; r: number; tw: number }[] => {
  let seed = 94723;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  return Array.from({ length: count }, () => ({
    x: rnd(),
    y: rnd() * 0.5,
    r: 0.4 + rnd() * 1.4,
    tw: rnd() * Math.PI * 2,
  }));
};

const buildWavePath = (
  width: number,
  height: number,
  base: number,
  amp: number,
  k: number,
  speed: number,
  jig: number,
  tMs: number,
  turbulence: number,
  motionScale: number,
) => {
  const path = Skia.Path.Make();
  path.moveTo(0, height);
  for (let x = 0; x <= width; x += 4) {
    const swellA = Math.sin(x * k + tMs * speed) * amp * (0.35 + turbulence * 1.1);
    const swellB = Math.sin(x * k * 2.7 - tMs * speed * 1.9) * amp * 0.5 * turbulence;
    const chop = Math.sin(x * 0.09 + tMs * 0.011) * jig * turbulence * turbulence;
    const y = base + (swellA + swellB + chop) * motionScale;
    path.lineTo(x, y);
  }
  path.lineTo(width, height);
  path.close();
  return path;
};

export default function HomeScreen() {
  const followerRef = useRef<EnvelopeFollower | null>(null);
  const sessionStartRef = useRef(0);
  const samplesRef = useRef<EnvelopeSample[]>([]);
  const phaseRef = useRef<ScreenPhase>('idle');
  if (!followerRef.current) followerRef.current = new EnvelopeFollower();

  const [sensorState, setSensorState] = useState<SensorState | 'starting'>('starting');
  const [phase, setPhase] = useState<ScreenPhase>('idle');
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [breathLabel, setBreathLabel] = useState('');

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const envelopeSV = useSharedValue(0);
  const turbulenceSV = useSharedValue(0);
  const calmSV = useSharedValue(1);
  const moonScaleSV = useSharedValue(0.78);
  const clockMsSV = useSharedValue(0);
  const sessionElapsedMsSV = useSharedValue(0);
  const sessionRunningSV = useSharedValue(0);
  const phaseIndexSV = useSharedValue(-1);
  const reduceMotionSV = useSharedValue(0);

  const stars = useMemo(() => makeStars(90), []);

  const onPhaseChange = useCallback((name: 'inhale' | 'hold' | 'exhale') => {
    setBreathLabel(PHASE_LABEL[name]);
    Haptics.selectionAsync().catch(() => {});
  }, []);

  useFrameCallback((frame) => {
    'worklet';
    const dt = Math.min(0.1, Math.max(0.001, (frame.timeSincePreviousFrame ?? 16.6667) / 1000));
    clockMsSV.value += dt * 1000;

    const target = Math.min(1, Math.pow(Math.max(0, envelopeSV.value) / DEFAULT_SENS, 0.8));
    turbulenceSV.value += alphaForDt(TAU_MIRROR, dt) * (target - turbulenceSV.value);
    calmSV.value = 1 - turbulenceSV.value;

    if (sessionRunningSV.value !== 1) return;

    sessionElapsedMsSV.value += dt * 1000;
    const b = getBreathState(sessionElapsedMsSV.value, DEFAULT_BREATH_TIMINGS);
    moonScaleSV.value = b.moonScale;
    const phaseIndex = b.phaseName === 'inhale' ? 0 : b.phaseName === 'hold' ? 1 : 2;
    if (phaseIndexSV.value !== phaseIndex) {
      phaseIndexSV.value = phaseIndex;
      runOnJS(onPhaseChange)(b.phaseName);
    }
  });

  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    (async () => {
      const src = await startMotionSource((s) => {
        const env = followerRef.current!.process(s);
        envelopeSV.value = env;
        if (phaseRef.current === 'session') {
          samplesRef.current.push({ t: Date.now() - sessionStartRef.current, v: env });
        }
      }, 16);
      if (cancelled) {
        src.stop();
        return;
      }
      setSensorState(src.state);
      stop = src.stop;
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [envelopeSV]);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((isOn) => {
      if (mounted) reduceMotionSV.value = isOn ? 1 : 0;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (isOn) => {
      reduceMotionSV.value = isOn ? 1 : 0;
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [reduceMotionSV]);

  const beginSession = useCallback(() => {
    samplesRef.current = [];
    sessionStartRef.current = Date.now();
    sessionElapsedMsSV.value = 0;
    sessionRunningSV.value = 1;
    phaseIndexSV.value = -1;
    moonScaleSV.value = 0.62;
    setSummary(null);
    setPhase('session');
  }, [moonScaleSV, phaseIndexSV, sessionElapsedMsSV, sessionRunningSV]);

  const endSession = useCallback(() => {
    sessionRunningSV.value = 0;
    const s = samplesRef.current;
    if (s.length > 1) {
      const n = s.length;
      const avg = (arr: EnvelopeSample[]) => arr.reduce((a, b) => a + b.v, 0) / arr.length;
      const startAvg = avg(s.slice(0, Math.max(1, Math.floor(n * 0.2))));
      const endAvg = avg(s.slice(Math.max(0, Math.floor(n * 0.8))));
      const dropPct = startAvg > 0.001 ? Math.max(0, (1 - endAvg / startAvg) * 100) : 0;
      downsample(s);
      setSummary({ mins: s[n - 1].t / 60000, dropPct });
    } else {
      setSummary({ mins: 0, dropPct: 0 });
    }
    setBreathLabel('');
    moonScaleSV.value = 0.78;
    setPhase('done');
  }, [moonScaleSV, sessionRunningSV]);

  const wave1 = useDerivedValue(() => {
    const motionScale = reduceMotionSV.value === 1 ? 0.4 : 1;
    const horizon = size.height * 0.58;
    return buildWavePath(size.width, size.height, horizon + 6, 10, 0.012, 0.0011, 3.2, clockMsSV.value, turbulenceSV.value, motionScale);
  }, [size.width, size.height]);
  const wave2 = useDerivedValue(() => {
    const motionScale = reduceMotionSV.value === 1 ? 0.4 : 1;
    const horizon = size.height * 0.58;
    return buildWavePath(size.width, size.height, horizon + size.height * 0.1, 16, 0.009, 0.0008, 5.0, clockMsSV.value, turbulenceSV.value, motionScale);
  }, [size.width, size.height]);
  const wave3 = useDerivedValue(() => {
    const motionScale = reduceMotionSV.value === 1 ? 0.4 : 1;
    const horizon = size.height * 0.58;
    return buildWavePath(size.width, size.height, horizon + size.height * 0.22, 24, 0.006, 0.0006, 7.5, clockMsSV.value, turbulenceSV.value, motionScale);
  }, [size.width, size.height]);

  const starsOpacity = useDerivedValue(() => {
    const twinkle = reduceMotionSV.value === 1 ? 1 : 0.75 + 0.25 * Math.sin(clockMsSV.value / 900);
    return clamp01(Math.max(0, calmSV.value - 0.25) * 1.2 * twinkle);
  });

  const moonRadius = useDerivedValue(() => Math.min(size.width, size.height) * 0.11 * moonScaleSV.value, [size.width, size.height]);
  const moonGlowRadius = useDerivedValue(() => moonRadius.value * (2.6 + calmSV.value * 1.4));
  const moonGlowOpacity = useDerivedValue(() => clamp01(0.28 + calmSV.value * 0.25));
  const shimmerOpacity = useDerivedValue(() => clamp01(0.1 + calmSV.value * 0.12));
  const shimmerWidth = useDerivedValue(() => moonRadius.value * (1.1 + turbulenceSV.value * 2.2));
  const shimmerX = useDerivedValue(() => size.width * 0.5 - shimmerWidth.value / 2, [size.width]);

  return (
    <View style={styles.root} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Rect x={0} y={0} width={size.width} height={size.height}>
          <LinearGradient start={vec(0, 0)} end={vec(0, size.height * 0.62)} colors={['#0A1120', '#101B30']} />
        </Rect>

        <Group opacity={starsOpacity}>
          {stars.map((s, i) => (
            <Circle key={i} cx={s.x * size.width} cy={s.y * size.height} r={s.r} color="#EDE6D0" />
          ))}
        </Group>

        <Group opacity={moonGlowOpacity}>
          <Circle cx={size.width * 0.5} cy={size.height * 0.3} r={moonGlowRadius}>
            <RadialGradient
              c={vec(size.width * 0.5, size.height * 0.3)}
              r={moonGlowRadius}
              colors={['rgba(237,230,208,0.7)', 'rgba(237,230,208,0)']}
            />
          </Circle>
        </Group>
        <Circle cx={size.width * 0.5} cy={size.height * 0.3} r={moonRadius} color="#EDE6D0" />

        <Path path={wave1} color="#16303B" />
        <Path path={wave2} color="#0F2530" />
        <Path path={wave3} color="#0B1B26" />

        <Group opacity={shimmerOpacity}>
          <Rect
            x={shimmerX}
            y={size.height * 0.58}
            width={shimmerWidth}
            height={size.height - size.height * 0.58}
          >
            <LinearGradient
              start={vec(0, size.height * 0.58)}
              end={vec(0, size.height)}
              colors={['rgba(237,230,208,0.65)', 'rgba(237,230,208,0)']}
            />
          </Rect>
        </Group>
      </Canvas>

      <View style={styles.topRow}>
        <Text style={styles.sensor}>sensor: {sensorState}</Text>
      </View>

      <View style={styles.bottomPanel}>
        {phase === 'idle' && (
          <>
            <Text style={styles.title}>dalga</Text>
            <Text style={styles.subtitle}>Hold your phone naturally. Begin when ready.</Text>
            <Pressable style={styles.primaryBtn} onPress={beginSession}>
              <Text style={styles.primaryBtnText}>Begin</Text>
            </Pressable>
          </>
        )}

        {phase === 'session' && (
          <>
            <Text style={styles.breathWord}>{breathLabel}</Text>
            <Pressable style={styles.primaryBtn} onPress={endSession}>
              <Text style={styles.primaryBtnText}>End</Text>
            </Pressable>
          </>
        )}

        {phase === 'done' && (
          <>
            <Text style={styles.title}>Session complete</Text>
            <Text style={styles.subtitle}>
              {summary && summary.dropPct > 4
                ? `The sea calmed by ${summary.dropPct.toFixed(0)}% over ${summary.mins.toFixed(1)} min.`
                : `You stayed with it for ${summary?.mins.toFixed(1) ?? '0.0'} min. That counts.`}
            </Text>
            <Pressable style={styles.primaryBtn} onPress={beginSession}>
              <Text style={styles.primaryBtnText}>Again</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0A1120' },
  topRow: { position: 'absolute', top: 54, left: 18, right: 18, alignItems: 'flex-start' },
  sensor: { color: '#8FB6AE', fontSize: 14 },
  bottomPanel: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: 'rgba(10,17,32,0.45)',
    borderColor: 'rgba(143,182,174,0.3)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  title: {
    color: '#EDE6D0',
    fontSize: 28,
    textAlign: 'center',
  },
  subtitle: {
    color: '#EDE6D0',
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
  breathWord: {
    color: '#EDE6D0',
    fontSize: 34,
    textAlign: 'center',
  },
  primaryBtn: {
    backgroundColor: '#8FB6AE',
    minHeight: 88,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#0A1120',
    fontSize: 26,
    fontWeight: '600',
  },
});
