// Cálculo da nota do cantor a partir do som do microfone (sem depender do navegador, para poder ser testado).
//
// O app não conhece a melodia original das músicas, então a nota mede o que dá para medir só pela voz:
//  - Afinação: as notas sustentadas caem em cima de uma nota musical (e não "entre" duas) e ficam firmes.
//  - Presença: o cantor cantou ao longo da música, e não só um trecho.
//  - Expressão: a voz varia de altura e de intensidade como num canto, e não como fala monótona.
// A nota final é generosa, de 60 a 100, como nas máquinas de karaokê.

export interface ScoreParts {
  tuning: number; // 0..1
  presence: number;
  expression: number;
}

export interface ScoreResult extends ScoreParts {
  score: number; // 60..100
}

/** Tamanho da janela de análise (amostras) e intervalo entre análises (segundos). */
export const FRAME = 2048;
export const HOP_SECONDS = 0.05;

const MIN_HZ = 75;
const MAX_HZ = 1100;

/** Frequência fundamental pelo método YIN; devolve 0 quando o som não tem altura definida (ruído, consoantes). */
export function detectPitch(buf: Float32Array, sampleRate: number): number {
  const w = Math.floor(buf.length / 2);
  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const tauMax = Math.min(w - 1, Math.ceil(sampleRate / MIN_HZ));
  const d = new Float32Array(tauMax + 2);
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    let sum = 0;
    for (let j = 0; j < w; j++) {
      const diff = buf[j] - buf[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  // diferença normalizada acumulada
  let running = 0;
  const cmnd = new Float32Array(tauMax + 2);
  cmnd[0] = 1;
  for (let tau = 1; tau <= tauMax + 1; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  const THRESHOLD = 0.15;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < THRESHOLD) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      // interpolação parabólica para precisão abaixo de uma amostra
      const a = cmnd[tau - 1];
      const b = cmnd[tau];
      const c = cmnd[tau + 1];
      const den = a + c - 2 * b;
      const shift = den !== 0 ? (a - c) / (2 * den) : 0;
      return sampleRate / (tau + Math.max(-1, Math.min(1, shift)));
    }
  }
  return 0;
}

const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** Diferença em centésimos de semitom, entre -50 e +50. */
const wrapCents = (c: number) => ((((c + 50) % 100) + 100) % 100) - 50;

interface Note {
  midi: number; // mediana
  frames: number;
  wobble: number; // desvio padrão em centésimos dentro da nota
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
}

/** Acumula as análises de uma apresentação e calcula a nota no fim. */
export class ScoreAccumulator {
  private floor = -70; // ruído de fundo estimado (dBFS)
  private played = 0; // análises com a música tocando
  private active = 0; // ... com voz
  private sections: { played: number; active: number }[] = [];
  private levels: number[] = []; // dB das análises com voz
  private pitches: number[] = []; // midi das análises com altura definida
  private notes: Note[] = [];
  private current: number[] = [];
  private gap = 0;

  constructor() {
    for (let i = 0; i < 8; i++) this.sections.push({ played: 0, active: 0 });
  }

  /** Uma análise: trecho de som do microfone; `progress` é a posição na música (0 a 1, NaN se desconhecida). */
  push(buf: Float32Array, sampleRate: number, progress: number) {
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const db = 10 * Math.log10(sum / buf.length + 1e-12);
    // o ruído de fundo desce rápido e sobe devagar (cerca de 0,4 dB por segundo)
    this.floor = db < this.floor ? this.floor + (db - this.floor) * 0.3 : this.floor + 0.02;
    this.played++;
    const sec = this.sections[Number.isFinite(progress) ? Math.max(0, Math.min(7, Math.floor(progress * 8))) : 0];
    sec.played++;
    const voice = db > Math.max(this.floor + 10, -55);
    if (!voice) return this.breakNote();
    this.active++;
    sec.active++;
    this.levels.push(db);
    const hz = detectPitch(buf, sampleRate);
    if (!hz) return this.breakNote();
    const midi = midiOf(hz);
    this.pitches.push(midi);
    const prev = this.current[this.current.length - 1];
    if (prev !== undefined && Math.abs(midi - prev) > 0.7) this.closeNote();
    this.current.push(midi);
    this.gap = 0;
  }

  private breakNote() {
    // uma análise falha no meio de uma nota (ruído, respiração curta) não a interrompe
    if (++this.gap > 2) this.closeNote();
  }

  private closeNote() {
    const c = this.current;
    this.current = [];
    if (c.length < 4) return; // menos de 0,2 s: passagem, não nota sustentada
    const m = median(c);
    const cents = c.map((x) => (x - m) * 100);
    const wobble = Math.sqrt(cents.reduce((a, x) => a + x * x, 0) / cents.length);
    this.notes.push({ midi: m, frames: c.length, wobble });
  }

  get seconds() {
    return { played: this.played * HOP_SECONDS, voice: this.active * HOP_SECONDS };
  }

  /** Nota final, ou null quando o microfone não captou voz suficiente para avaliar. */
  finish(): ScoreResult | null {
    this.closeNote();
    const { played, voice } = this.seconds;
    if (played < 30 || voice < 8 || this.notes.length < 5) return null;

    // Afinação. A referência (lá = 440 Hz) é ajustada em até 25 centésimos: músicas gravadas um pouco fora do
    // padrão não prejudicam quem canta afinado com elas. Mais que isso deixaria passar quem canta entre as notas.
    let best = 0;
    let bestCost = Infinity;
    for (let r = -25; r <= 25; r += 1) {
      let cost = 0;
      for (const n of this.notes) cost += Math.abs(wrapCents(n.midi * 100 - r)) * n.frames;
      if (cost < bestCost) {
        bestCost = cost;
        best = r;
      }
    }
    let weight = 0;
    let onPitch = 0;
    let steady = 0;
    for (const n of this.notes) {
      const dev = Math.abs(wrapCents(n.midi * 100 - best));
      onPitch += clamp01(1 - (dev - 10) / 20) * n.frames; // até 10 centésimos: perfeito; 30 ou mais: fora
      steady += clamp01(1 - (n.wobble - 18) / 45) * n.frames; // vibrato natural (até ~18) não perde ponto
      weight += n.frames;
    }
    const tuning = clamp01((0.6 * onPitch + 0.4 * steady) / weight);

    // Presença: quanto da música teve voz (numa música típica, a voz ocupa cerca de metade do tempo)
    // e em quantos trechos dela o cantor apareceu.
    const used = this.sections.filter((s) => s.played > 0);
    const covered = used.filter((s) => s.active / s.played > 0.12).length;
    const presence = clamp01(0.6 * clamp01(voice / played / 0.45) + 0.4 * clamp01(covered / Math.max(1, used.length * 0.75)));

    // Expressão: extensão da melodia (fala fica em 2 a 3 semitons) e variação de intensidade.
    const range = percentile(this.pitches, 0.9) - percentile(this.pitches, 0.1);
    const mean = this.levels.reduce((a, x) => a + x, 0) / this.levels.length;
    const spread = Math.sqrt(this.levels.reduce((a, x) => a + (x - mean) ** 2, 0) / this.levels.length);
    const expression = clamp01(0.6 * clamp01((range - 2) / 6) + 0.4 * clamp01((spread - 1.5) / 4.5));

    // a afinação pesa mais; a curva abre distância entre quem canta bem e quem só cantou a música toda
    const raw = 0.6 * tuning + 0.25 * presence + 0.15 * expression;
    const score = Math.min(100, Math.round(60 + 40 * Math.pow(raw, 1.5)));
    return { score, tuning, presence, expression };
  }
}

/** Frase mostrada junto com a nota. */
export function scorePhrase(score: number): string {
  if (score >= 95) return 'Show de bola!';
  if (score >= 90) return 'Arrasou!';
  if (score >= 82) return 'Mandou muito bem!';
  if (score >= 72) return 'Boa apresentação!';
  return 'Valeu pela coragem!';
}
