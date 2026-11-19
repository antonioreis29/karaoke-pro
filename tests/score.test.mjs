import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, FRAME, HOP_SECONDS, ScoreAccumulator } from '../src/player/score-core.ts';

const SR = 48000;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// gerador de números pseudoaleatórios fixo: o teste dá sempre o mesmo resultado
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Uma "voz": fundamental com harmônicos, como o canto (o YIN precisa achar a fundamental, não o harmônico). */
function frame(freq, amp, t, rand) {
  const buf = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const ph = 2 * Math.PI * freq * (t + i / SR);
    const v = freq ? amp * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph)) : 0;
    buf[i] = v + (rand() - 0.5) * 0.001; // ruído de fundo da sala
  }
  return buf;
}

/**
 * Simula uma apresentação de `seconds` segundos. `voice(t)` devolve { midi, amp } ou null (silêncio).
 */
function perform(seconds, voice, seed = 1) {
  const rand = rng(seed);
  const acc = new ScoreAccumulator();
  for (let t = 0; t < seconds; t += HOP_SECONDS) {
    const v = voice(t, rand);
    acc.push(frame(v ? hz(v.midi) : 0, v ? v.amp : 0, t, rand), SR, t / seconds);
  }
  return acc.finish();
}

// melodia de 8 notas (uma oitava e pouco), frases de 4 s com 2 s de respiro, notas de 0,5 s
const MELODY = [60, 62, 64, 65, 67, 69, 67, 64];
const melodyAt = (t) => {
  const inPhrase = t % 6;
  if (inPhrase > 4) return null;
  return MELODY[Math.floor(inPhrase / 0.5) % MELODY.length];
};

const goodSinger = (t) => {
  const m = melodyAt(t);
  if (m == null) return null;
  // vibrato leve e intensidade que varia ao longo da frase
  return { midi: m + 0.12 * Math.sin(2 * Math.PI * 5.5 * t), amp: 0.08 + 0.06 * Math.sin(t * 0.9) ** 2 };
};

test('detecta a altura de uma voz', () => {
  for (const f of [110, 220, 330, 523.25]) {
    const got = detectPitch(frame(f, 0.2, 0, rng(3)), SR);
    assert.ok(Math.abs(got - f) / f < 0.01, `${f} Hz -> ${got}`);
  }
  assert.equal(detectPitch(frame(0, 0, 0, rng(3)), SR), 0); // só ruído: sem altura
});

test('cantor afinado tira nota alta', () => {
  const r = perform(90, goodSinger);
  assert.ok(r, 'deveria ter nota');
  assert.ok(r.score >= 88, `nota ${r.score} ${JSON.stringify(r)}`);
});

test('música gravada um pouco fora do lá 440 não prejudica quem canta junto com ela', () => {
  const r = perform(90, (t) => {
    const v = goodSinger(t);
    return v && { ...v, midi: v.midi + 0.18 };
  });
  assert.ok(r.score >= 88, `nota ${r.score}`);
});

test('cantor desafinado tira nota menor que o afinado', () => {
  const good = perform(90, goodSinger);
  // cada nota sai fora do lugar por 20 a 50 centésimos, para cima ou para baixo ao acaso, e a voz oscila
  const offRand = rng(42);
  const offsets = Array.from({ length: 400 }, () => (offRand() < 0.5 ? 1 : -1) * (0.2 + 0.3 * offRand()));
  const bad = perform(90, (t, rand) => {
    const m = melodyAt(t);
    if (m == null) return null;
    const off = offsets[Math.floor(t / 0.5) % offsets.length];
    return { midi: m + off + 0.3 * Math.sin(2 * Math.PI * 2.3 * t) + (rand() - 0.5) * 0.1, amp: 0.1 };
  });
  assert.ok(bad, 'deveria ter nota');
  assert.ok(bad.tuning < good.tuning - 0.3, `afinação ${bad.tuning} vs ${good.tuning}`);
  assert.ok(bad.score <= good.score - 10, `nota ${bad.score} vs ${good.score}`);
  assert.ok(bad.score >= 60, 'nunca abaixo de 60');
});

test('quem canta só o começo perde em presença', () => {
  const full = perform(90, goodSinger);
  const part = perform(90, (t) => (t < 25 ? goodSinger(t) : null));
  assert.ok(part.presence < full.presence - 0.3, `presença ${part.presence} vs ${full.presence}`);
  assert.ok(part.score < full.score, `nota ${part.score} vs ${full.score}`);
});

test('fala monótona tira expressão baixa', () => {
  const talk = perform(90, (t) => {
    if (t % 6 > 4) return null;
    return { midi: 57 + 0.8 * Math.sin(t * 3), amp: 0.1 };
  });
  const sung = perform(90, goodSinger);
  assert.ok(talk.expression < sung.expression - 0.3, `expressão ${talk.expression} vs ${sung.expression}`);
});

test('sem voz no microfone não há nota', () => {
  assert.equal(perform(60, () => null), null);
  // música curta demais (teste do arquivo, música interrompida)
  assert.equal(perform(20, goodSinger), null);
});
