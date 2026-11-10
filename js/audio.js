// Tiny synthesised sound set — no audio files.
let ctx = null, noise = null, master = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(type, f1, f2, dur, gain) {
  if (!ctx) return;
  const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}
function hiss(dur, gain, freq, type = 'highpass') {
  if (!ctx) return;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime;
  s.buffer = noise;
  f.type = type; f.frequency.value = freq;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 0.5, dur + 0.02);
}

export const sfx = {
  ratchet() { hiss(0.025, 0.25, 3500); tone('square', 1900, 1500, 0.02, 0.03); },
  tight() { tone('square', 220, 80, 0.14, 0.12); hiss(0.06, 0.3, 900, 'lowpass'); },
  loose() { tone('triangle', 300, 500, 0.08, 0.1); },
  wrong() { tone('triangle', 1300, 900, 0.07, 0.12); hiss(0.03, 0.15, 5000); },
  place() { tone('sine', 140, 45, 0.2, 0.4); hiss(0.08, 0.3, 500, 'lowpass'); },
  remove() { tone('sine', 90, 160, 0.12, 0.25); hiss(0.05, 0.15, 800, 'lowpass'); },
  ui() { tone('sine', 660, 660, 0.04, 0.05); },
  bang() { tone('square', 120, 30, 0.5, 0.5); hiss(0.5, 0.7, 700, 'lowpass'); },
  win() { [392, 494, 587, 784].forEach((f, i) => setTimeout(() => tone('triangle', f, f, 0.25, 0.15), i * 130)); },
};

// Continuous engine / starter-motor voice.
let voice = null;
export const motor = {
  start() {
    if (!ctx || voice) return;
    const a = ctx.createOscillator(), b = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    const n = ctx.createBufferSource(), ng = ctx.createGain(), nf = ctx.createBiquadFilter();
    a.type = 'sawtooth'; b.type = 'square';
    lp.type = 'lowpass'; lp.frequency.value = 300;
    g.gain.value = 0;
    n.buffer = noise; n.loop = true; nf.type = 'bandpass'; nf.frequency.value = 900; ng.gain.value = 0;
    a.connect(lp); b.connect(lp); lp.connect(g).connect(master);
    n.connect(nf).connect(ng).connect(master);
    a.start(); b.start(); n.start();
    voice = { a, b, lp, g, ng };
  },
  set(rpm, { loud = false, starter = false } = {}) {
    if (!voice) return;
    const t = ctx.currentTime, f = Math.max(8, rpm / 30);
    voice.a.frequency.setTargetAtTime(starter ? 95 : f, t, 0.05);
    voice.b.frequency.setTargetAtTime(starter ? 190 : f / 2, t, 0.05);
    voice.lp.frequency.setTargetAtTime(starter ? 1200 : (loud ? 900 : 260) + rpm / 5, t, 0.05);
    voice.g.gain.setTargetAtTime(starter ? 0.07 : loud ? 0.4 : 0.2, t, 0.08);
    voice.ng.gain.setTargetAtTime(starter ? 0.05 : loud ? 0.12 : 0.03, t, 0.08);
  },
  stop() {
    if (!voice) return;
    const v = voice, t = ctx.currentTime;
    voice = null;
    v.g.gain.setTargetAtTime(0, t, 0.08);
    v.ng.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => { try { v.a.stop(); v.b.stop(); } catch {} }, 600);
  },
};

sfx.drink = () => { [0, 140, 280].forEach((d) => setTimeout(() => tone('sine', 300, 180, 0.09, 0.18), d)); };
sfx.eat = () => { [0, 170, 340].forEach((d) => setTimeout(() => hiss(0.07, 0.25, 1200, 'lowpass'), d)); };
sfx.pick = () => { tone('sine', 200, 320, 0.07, 0.15); };
