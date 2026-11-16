// Trilha da vinheta: música genérica sintetizada na hora (Web Audio), sem arquivos nem direitos de terceiros.
// Progressão I–V–vi–IV com bumbo, palmas, chimbal, baixo, base e um arpejo simples.

const BPM = 116;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

// tríades em Dó maior (frequências em Hz) e o baixo de cada compasso
const CHORDS = [
  { bass: 65.41, notes: [261.63, 329.63, 392.0] }, // C
  { bass: 98.0, notes: [246.94, 293.66, 392.0] }, // G
  { bass: 110.0, notes: [261.63, 329.63, 440.0] }, // Am
  { bass: 87.31, notes: [261.63, 349.23, 440.0] }, // F
];
const ARP = [0, 1, 2, 1, 2, 1, 0, 2];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;
let timer: number | undefined;
let nextBar = 0;
let bar = 0;

function tone(type: OscillatorType, freq: number, at: number, len: number, peak: number, dest: AudioNode, slideTo?: number) {
  const c = ctx!;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + len);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  osc.connect(g).connect(dest);
  osc.start(at);
  osc.stop(at + len + 0.02);
}

function hit(at: number, len: number, peak: number, highpass: number, dest: AudioNode) {
  const c = ctx!;
  const src = c.createBufferSource();
  src.buffer = noise;
  const f = c.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = highpass;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  src.connect(f).connect(g).connect(dest);
  src.start(at);
  src.stop(at + len + 0.02);
}

function scheduleBar(at: number, index: number) {
  const c = ctx!;
  const out = master!;
  const chord = CHORDS[index % CHORDS.length];
  // base (acorde sustentado, filtrado)
  const pad = c.createBiquadFilter();
  pad.type = 'lowpass';
  pad.frequency.value = 1400;
  pad.connect(out);
  for (const n of chord.notes) tone('sawtooth', n, at, BAR * 0.98, 0.045, pad);
  for (let beat = 0; beat < 4; beat++) {
    const t = at + beat * BEAT;
    tone('sine', 150, t, 0.22, 0.9, out, 45); // bumbo
    if (beat % 2 === 1) hit(t, 0.16, 0.32, 1200, out); // palmas
    tone('triangle', chord.bass * (beat === 3 ? 1.5 : 1), t, BEAT * 0.8, 0.3, out); // baixo
    hit(t, 0.04, 0.1, 7000, out); // chimbal
    hit(t + BEAT / 2, 0.04, 0.16, 7000, out);
  }
  // arpejo em colcheias, uma oitava acima
  ARP.forEach((n, i) => tone('square', chord.notes[n] * 2, at + (i * BEAT) / 2, BEAT * 0.4, 0.05, out));
}

function pump() {
  if (!ctx) return;
  while (nextBar < ctx.currentTime + 0.6) {
    scheduleBar(nextBar, bar++);
    nextBar += BAR;
  }
}

export const jingle = {
  start(volume: number) {
    this.stop(0);
    const c = (ctx = new AudioContext());
    const len = c.sampleRate;
    noise = c.createBuffer(1, len, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const limiter = c.createDynamicsCompressor();
    limiter.connect(c.destination);
    master = c.createGain();
    master.gain.setValueAtTime(0.0001, c.currentTime);
    master.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.5), c.currentTime + 0.4);
    master.connect(limiter);
    bar = 0;
    nextBar = c.currentTime + 0.05;
    pump();
    timer = window.setInterval(pump, 200);
    c.resume().catch(() => undefined);
  },

  setVolume(volume: number) {
    if (ctx && master) master.gain.setTargetAtTime(Math.max(0.001, volume * 0.5), ctx.currentTime, 0.05);
  },

  /** Encerra com um fade curto para não cortar seco na entrada da música. */
  stop(fade = 0.5) {
    clearInterval(timer);
    const c = ctx;
    const m = master;
    ctx = null;
    master = null;
    if (!c) return;
    if (m && fade > 0) m.gain.setTargetAtTime(0.0001, c.currentTime, fade / 4);
    window.setTimeout(() => c.close().catch(() => undefined), fade * 1000 + 50);
  },

  get playing() {
    return ctx != null;
  },
};
