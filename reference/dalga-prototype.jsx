import React, { useRef, useState, useEffect, useCallback } from "react";

// ─────────────────────────────────────────────────────────────
// DALGA v2 — tremor biofeedback prototype
// New in v2:
//  · shake-to-begin (once motion permission is granted)
//  · sonification: ambient drone that resolves as the sea calms
//  · session log: amplitude curve chart + in-memory history
// (RN build will persist history; artifacts can't use storage.)
// ─────────────────────────────────────────────────────────────

const BREATH = [
  { name: "Breathe in", dur: 4000, from: 0.62, to: 1.0 },
  { name: "Hold", dur: 2000, from: 1.0, to: 1.0 },
  { name: "Long breath out", dur: 7500, from: 1.0, to: 0.62 },
];
const CYCLE = BREATH.reduce((s, p) => s + p.dur, 0);

const C = {
  night: "#0A1120",
  nightHi: "#101B30",
  water1: "#16303B",
  water2: "#0F2530",
  water3: "#0B1B26",
  bone: "#EDE6D0",
  foam: "#8FB6AE",
  dim: "rgba(237,230,208,0.55)",
};

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function Dalga() {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  // signal refs
  const gravEMA = useRef({ x: 0, y: 0, z: 0, init: false });
  const envelope = useRef(0);
  const turbulence = useRef(0.65);
  const demoRef = useRef({ active: false, level: 0.75 });
  const sessionRef = useRef({ running: false, t0: 0, samples: [] });
  const starsRef = useRef(null);
  const shakeRef = useRef({ since: 0, cooldownUntil: 0 });
  const sensorsReadyRef = useRef(false);
  const phaseRef = useRef("idle");
  const moonScaleRef = useRef(0.78);

  // audio refs
  const audioRef = useRef(null);
  const soundOnRef = useRef(false);

  const [phase, setPhaseState] = useState("idle"); // idle | session | done
  const setPhase = (p) => { phaseRef.current = p; setPhaseState(p); };
  const [sensorMode, setSensorMode] = useState("unknown"); // motion | demo | unknown
  const [readout, setReadout] = useState(0);
  const [breathLabel, setBreathLabel] = useState("");
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]); // in-memory session log
  const [soundOn, setSoundOn] = useState(false);

  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── sensor pipeline ────────────────────────────────────────
  const onMotion = useCallback((e) => {
    let ax, ay, az;
    if (e.acceleration && e.acceleration.x !== null) {
      ax = e.acceleration.x; ay = e.acceleration.y; az = e.acceleration.z;
    } else if (e.accelerationIncludingGravity) {
      const g = gravEMA.current;
      const a = e.accelerationIncludingGravity;
      if (!g.init) { g.x = a.x; g.y = a.y; g.z = a.z; g.init = true; }
      const gAlpha = 0.02;
      g.x += gAlpha * (a.x - g.x);
      g.y += gAlpha * (a.y - g.y);
      g.z += gAlpha * (a.z - g.z);
      ax = a.x - g.x; ay = a.y - g.y; az = a.z - g.z;
    } else return;

    const mag = Math.sqrt(ax * ax + ay * ay + az * az);
    const env = envelope.current;
    const alpha = mag > env ? 0.25 : 0.06;
    envelope.current = env + alpha * (mag - env);

    if (sessionRef.current.running) {
      sessionRef.current.samples.push({
        t: performance.now() - sessionRef.current.t0,
        v: envelope.current,
      });
    }
  }, []);

  const startSensors = useCallback(async () => {
    if (sensorsReadyRef.current) return "motion";
    try {
      if (
        typeof DeviceMotionEvent !== "undefined" &&
        typeof DeviceMotionEvent.requestPermission === "function"
      ) {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted") throw new Error("denied");
      }
      if (typeof DeviceMotionEvent === "undefined") throw new Error("none");
      window.addEventListener("devicemotion", onMotion);
      const before = envelope.current;
      await new Promise((r) => setTimeout(r, 900));
      if (envelope.current === before && !gravEMA.current.init) {
        window.removeEventListener("devicemotion", onMotion);
        throw new Error("silent");
      }
      sensorsReadyRef.current = true;
      setSensorMode("motion");
      return "motion";
    } catch {
      demoRef.current.active = true;
      demoRef.current.level = 0.8;
      setSensorMode("demo");
      return "demo";
    }
  }, [onMotion]);

  // ── audio: drone that resolves with calm ──────────────────
  const buildAudio = useCallback(() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 600;
    filter.Q.value = 0.7;
    filter.connect(master);

    const mkVoice = (freq, gain, type = "sine") => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g); g.connect(filter);
      o.start();
      return { o, g };
    };

    // calm chord: root, fifth, octave (A2, E3, A3)
    const root = mkVoice(110, 0.10);
    const fifth = mkVoice(164.8, 0.07);
    const oct = mkVoice(220, 0.045, "triangle");
    // tension voice: minor second above root — only audible under tremor
    const tension = mkVoice(116.5, 0.0);

    // wind noise — only audible under tremor
    const nBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = nBuf; noise.loop = true;
    const gNoise = ctx.createGain(); gNoise.gain.value = 0;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = "bandpass"; nFilter.frequency.value = 500; nFilter.Q.value = 0.5;
    noise.connect(nFilter); nFilter.connect(gNoise); gNoise.connect(master);
    noise.start();

    return { ctx, master, filter, root, fifth, oct, tension, gNoise };
  }, []);

  const toggleSound = useCallback(async () => {
    if (!audioRef.current) audioRef.current = buildAudio();
    const a = audioRef.current;
    if (!a) return;
    if (a.ctx.state === "suspended") await a.ctx.resume();
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    a.master.gain.setTargetAtTime(next ? 0.5 : 0, a.ctx.currentTime, 0.6);
  }, [buildAudio]);

  // ── session control ────────────────────────────────────────
  const beginSession = useCallback(async () => {
    setSummary(null);
    setPhase("session");
    sessionRef.current = { running: true, t0: performance.now(), samples: [] };
    await startSensors();
  }, [startSensors]);

  const endSession = useCallback(() => {
    sessionRef.current.running = false;
    shakeRef.current.cooldownUntil = performance.now() + 4000;
    const s = sessionRef.current.samples;
    let entry = null;
    if (s.length > 40) {
      const n = s.length;
      const avg = (arr) => arr.reduce((a, b) => a + b.v, 0) / arr.length;
      const start = avg(s.slice(0, Math.floor(n * 0.2)));
      const end = avg(s.slice(Math.floor(n * 0.8)));
      const drop = start > 0.001 ? Math.max(0, (1 - end / start) * 100) : 0;
      // downsample to ≤120 points for the chart / log
      const buckets = 120;
      const series = [];
      for (let b = 0; b < buckets; b++) {
        const lo = Math.floor((b / buckets) * n);
        const hi = Math.max(lo + 1, Math.floor(((b + 1) / buckets) * n));
        series.push(avg(s.slice(lo, hi)));
      }
      entry = {
        at: new Date(), mins: s[n - 1].t / 60000,
        drop, series, demo: demoRef.current.active,
      };
      setHistory((h) => [entry, ...h].slice(0, 12));
      setSummary(entry);
    } else if (demoRef.current.active) {
      setSummary({ demo: true, empty: true });
    } else {
      setSummary(null);
    }
    demoRef.current.active = false;
    setPhase("done");
  }, []);

  // draw session chart when summary arrives
  useEffect(() => {
    if (!summary || !summary.series || !chartRef.current) return;
    const cv = chartRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const s = summary.series;
    const max = Math.max(...s, 0.001);
    ctx.clearRect(0, 0, w, h);
    // amplitude area
    ctx.beginPath();
    ctx.moveTo(0, h);
    s.forEach((v, i) => {
      ctx.lineTo((i / (s.length - 1)) * w, h - (v / max) * (h - 8) - 4);
    });
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = "rgba(143,182,174,0.22)";
    ctx.fill();
    ctx.beginPath();
    s.forEach((v, i) => {
      const x = (i / (s.length - 1)) * w;
      const y = h - (v / max) * (h - 8) - 4;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = C.foam;
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [summary]);

  // ── render + control loop ──────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let raf, running = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const stars = [];
      for (let i = 0; i < 90; i++) {
        stars.push({
          x: Math.random(), y: Math.random() * 0.5,
          r: Math.random() * 1.4 + 0.4, tw: Math.random() * Math.PI * 2,
        });
      }
      starsRef.current = stars;
    };
    resize();
    window.addEventListener("resize", resize);

    let lastReadout = 0;
    let lastLabel = "";
    const setBreathLabelSafe = (l) => {
      if (l !== lastLabel) { lastLabel = l; setBreathLabel(l); }
    };

    const frame = (now) => {
      if (!running) return;
      const w = canvas.clientWidth, h = canvas.clientHeight;

      // — turbulence target —
      let target;
      if (demoRef.current.active) {
        const d = demoRef.current;
        d.level = Math.max(0.08, d.level - 0.00022);
        target = d.level + Math.sin(now / 700) * 0.04;
      } else if (sensorsReadyRef.current) {
        target = Math.min(1, Math.pow(envelope.current / 2.2, 0.8));
      } else {
        target = 0.55 + Math.sin(now / 1400) * 0.08;
      }
      turbulence.current += 0.03 * (target - turbulence.current);
      const T = turbulence.current;
      const calm = 1 - T;

      // — shake-to-begin —
      if (
        sensorsReadyRef.current &&
        !sessionRef.current.running &&
        now > shakeRef.current.cooldownUntil
      ) {
        if (envelope.current > 1.5) {
          if (!shakeRef.current.since) shakeRef.current.since = now;
          if (now - shakeRef.current.since > 600) {
            shakeRef.current.since = 0;
            beginSession();
          }
        } else {
          shakeRef.current.since = 0;
        }
      }

      if (now - lastReadout > 250) { setReadout(T); lastReadout = now; }

      // — breathing moon scale —
      const inSession = sessionRef.current.running;
      let moonScale = 0.78, label = "";
      if (inSession) {
        const t = (now - sessionRef.current.t0) % CYCLE;
        let acc = 0;
        for (const p of BREATH) {
          if (t < acc + p.dur) {
            const k = easeInOut((t - acc) / p.dur);
            moonScale = p.from + (p.to - p.from) * k;
            label = p.name;
            break;
          }
          acc += p.dur;
        }
      }
      moonScaleRef.current = moonScale;
      setBreathLabelSafe(label);

      // — audio follows the sea —
      const a = audioRef.current;
      if (a && soundOnRef.current) {
        const tc = 0.15, at = a.ctx.currentTime;
        // brightness rises with calm; breath adds a gentle swell
        a.filter.frequency.setTargetAtTime(280 + calm * 1400 + moonScale * 180, at, tc);
        // dissonance & wind exist only under tremor
        a.tension.g.gain.setTargetAtTime(T * T * 0.06, at, tc);
        a.gNoise.gain.setTargetAtTime(T * 0.05, at, tc);
        // slow beating detune when shaking; pure when calm
        a.root.o.detune.setTargetAtTime(Math.sin(now / 90) * T * 14, at, 0.05);
        a.fifth.o.detune.setTargetAtTime(Math.sin(now / 130 + 2) * T * 10, at, 0.05);
        a.oct.g.gain.setTargetAtTime(0.02 + calm * 0.05, at, tc);
      }

      // — sky —
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.62);
      sky.addColorStop(0, C.night);
      sky.addColorStop(1, C.nightHi);
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // — stars emerge with calm —
      const stars = starsRef.current || [];
      for (const s of stars) {
        const twinkle = reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(now / 900 + s.tw);
        ctx.globalAlpha = Math.max(0, calm - 0.25) * 1.2 * twinkle;
        ctx.fillStyle = C.bone;
        ctx.beginPath();
        ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // — moon —
      const mx = w * 0.5, my = h * 0.30;
      const mr = Math.min(w, h) * 0.11 * moonScale;
      const glow = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * (2.6 + calm * 1.4));
      glow.addColorStop(0, `rgba(237,230,208,${0.28 + calm * 0.25})`);
      glow.addColorStop(1, "rgba(237,230,208,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h * 0.7);
      ctx.fillStyle = C.bone;
      ctx.beginPath();
      ctx.arc(mx, my, mr, 0, Math.PI * 2);
      ctx.fill();

      // — sea —
      const horizon = h * 0.58;
      const layers = [
        { base: horizon + 6, col: C.water1, amp: 10, k: 0.012, sp: 0.0011, jig: 3.2 },
        { base: horizon + h * 0.10, col: C.water2, amp: 16, k: 0.009, sp: 0.0008, jig: 5.0 },
        { base: horizon + h * 0.22, col: C.water3, amp: 24, k: 0.006, sp: 0.0006, jig: 7.5 },
      ];
      const motionScale = reducedMotion ? 0.4 : 1;
      for (const L of layers) {
        ctx.fillStyle = L.col;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 4) {
          const swellA = Math.sin(x * L.k + now * L.sp) * L.amp * (0.35 + T * 1.1);
          const swellB = Math.sin(x * L.k * 2.7 - now * L.sp * 1.9) * L.amp * 0.5 * T;
          const chop = Math.sin(x * 0.09 + now * 0.011) * L.jig * T * T;
          const y = L.base + (swellA + swellB + chop) * motionScale;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }

      // moonpath coheres with calm
      const shimmer = ctx.createLinearGradient(0, horizon, 0, h);
      shimmer.addColorStop(0, `rgba(237,230,208,${0.10 + calm * 0.12})`);
      shimmer.addColorStop(1, "rgba(237,230,208,0)");
      ctx.fillStyle = shimmer;
      const pw = mr * (1.1 + T * 2.2);
      ctx.fillRect(mx - pw / 2, horizon, pw, h - horizon);

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("devicemotion", onMotion);
      if (audioRef.current) audioRef.current.ctx.close();
    };
  }, [onMotion, reducedMotion, beginSession]);

  // ── UI ─────────────────────────────────────────────────────
  const btn = {
    width: "100%",
    minHeight: 88,
    border: "none",
    borderRadius: 22,
    fontSize: 24,
    fontWeight: 600,
    letterSpacing: "0.02em",
    cursor: "pointer",
    fontFamily: "'Cormorant Garamond', Georgia, serif",
  };
  const ghostBtn = {
    ...btn,
    minHeight: 64,
    fontSize: 19,
    background: "rgba(237,230,208,0.10)",
    color: C.bone,
    border: "1px solid rgba(237,230,208,0.3)",
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: C.night, overflow: "hidden" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&display=swap');`}</style>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />

      {/* top bar: status + sound toggle (still a big target) */}
      <div style={{
        position: "absolute", top: 14, left: 16, right: 16,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <div style={{
          color: C.dim, fontFamily: "system-ui, sans-serif", fontSize: 13,
          letterSpacing: "0.14em", textTransform: "uppercase", pointerEvents: "none",
        }}>
          {phase === "session"
            ? (sensorMode === "motion" ? `sea · ${(readout * 100) | 0}` : "demo sea")
            : "dalga"}
        </div>
        <button
          onClick={toggleSound}
          style={{
            minWidth: 76, minHeight: 48, borderRadius: 14,
            background: soundOn ? "rgba(143,182,174,0.25)" : "rgba(237,230,208,0.08)",
            border: "1px solid rgba(237,230,208,0.25)",
            color: soundOn ? C.foam : C.dim,
            fontFamily: "system-ui, sans-serif", fontSize: 14, letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          {soundOn ? "SOUND ON" : "SOUND"}
        </button>
      </div>

      {/* breathing word */}
      {phase === "session" && (
        <div style={{
          position: "absolute", top: "46%", left: 0, right: 0,
          textAlign: "center", pointerEvents: "none",
          color: C.bone, fontFamily: "'Cormorant Garamond', Georgia, serif",
          fontSize: 34, fontWeight: 500, letterSpacing: "0.04em",
          textShadow: "0 2px 24px rgba(10,17,32,0.8)",
        }}>
          {breathLabel}
        </div>
      )}

      {/* bottom control zone */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        padding: "20px 20px calc(24px + env(safe-area-inset-bottom))",
        background: "linear-gradient(rgba(10,17,32,0), rgba(10,17,32,0.88) 55%)",
        maxHeight: "62%", overflowY: "auto",
      }}>
        {phase === "idle" && (
          <>
            <div style={{
              color: C.dim, textAlign: "center", marginBottom: 14,
              fontFamily: "system-ui, sans-serif", fontSize: 15, lineHeight: 1.5,
            }}>
              Hold your phone naturally. The sea will mirror your hand —
              your breath will still it.
              {sensorsReadyRef.current && " Or just shake to begin."}
            </div>
            <button style={{ ...btn, background: C.bone, color: C.night }} onClick={beginSession}>
              Begin
            </button>
          </>
        )}

        {phase === "session" && (
          <button style={ghostBtn} onClick={endSession}>
            End session
          </button>
        )}

        {phase === "done" && (
          <>
            <div style={{
              color: C.bone, textAlign: "center", marginBottom: 12,
              fontFamily: "'Cormorant Garamond', Georgia, serif",
              fontSize: 24, lineHeight: 1.45,
            }}>
              {summary && summary.series && !summary.demo && summary.drop > 4 &&
                `The sea calmed by ${summary.drop | 0}% over ${summary.mins.toFixed(1)} min.`}
              {summary && summary.series && !summary.demo && summary.drop <= 4 &&
                `You stayed with it for ${summary.mins.toFixed(1)} min. That counts.`}
              {summary && summary.demo && !summary.empty &&
                "Demo session — on a phone browser, your real hand drives this."}
              {summary && summary.empty &&
                "Demo complete — on a phone, real sensor data drives the sea."}
              {!summary && "Session ended."}
            </div>

            {summary && summary.series && (
              <div style={{ marginBottom: 14 }}>
                <canvas
                  ref={chartRef}
                  style={{ width: "100%", height: 84, display: "block" }}
                />
                <div style={{
                  display: "flex", justifyContent: "space-between",
                  color: C.dim, fontFamily: "system-ui, sans-serif", fontSize: 12,
                  marginTop: 4, letterSpacing: "0.06em",
                }}>
                  <span>start</span><span>tremor amplitude</span><span>end</span>
                </div>
              </div>
            )}

            {history.length > 1 && (
              <div style={{
                color: C.dim, fontFamily: "system-ui, sans-serif",
                fontSize: 13, lineHeight: 1.7, marginBottom: 14, textAlign: "center",
              }}>
                {history.slice(0, 5).map((s2, i) => (
                  <div key={i}>
                    {s2.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    {" · "}{s2.mins.toFixed(1)} min · calmed {s2.drop | 0}%
                    {s2.demo ? " · demo" : ""}
                  </div>
                ))}
                <div style={{ opacity: 0.6, marginTop: 4 }}>
                  (log is in-memory here — the real app will keep it)
                </div>
              </div>
            )}

            <button style={{ ...btn, background: C.bone, color: C.night }} onClick={beginSession}>
              Again
            </button>
          </>
        )}
      </div>
    </div>
  );
}
