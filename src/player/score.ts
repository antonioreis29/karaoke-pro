// Nota do cantor durante a apresentação: ouve o microfone enquanto a música toca e calcula a nota no fim.
// Só lê o som do microfone; não mexe no áudio das músicas (nem no do player do YouTube).
import { getState } from '../store';
import { scoreInput } from './mics';
import { FRAME, HOP_SECONDS, ScoreAccumulator, type ScoreResult } from './score-core';

let acc: ScoreAccumulator | null = null;
let timer: number | undefined;
let token = 0;

/** Começa a ouvir uma apresentação nova (descarta a anterior). */
export async function startScore() {
  stopScore();
  const s = getState().settings;
  if (!s.score) return;
  const my = token;
  const input = await scoreInput(s.scoreMic, FRAME).catch(() => null);
  if (my !== token || !input) return;
  const a = new ScoreAccumulator();
  const buf = new Float32Array(FRAME);
  acc = a;
  timer = window.setInterval(() => {
    const pb = getState().playback;
    // só conta com a música tocando: vinheta, pausa e carregamento ficam de fora
    if (pb.status !== 'playing' || pb.mode === 'intro' || pb.mode === 'idle') return;
    input.getFloatTimeDomainData(buf);
    a.push(buf, input.context.sampleRate, pb.duration > 20 ? pb.time / pb.duration : NaN);
  }, HOP_SECONDS * 1000);
}

/** Encerra a apresentação e devolve a nota (null se o microfone não captou voz suficiente). */
export function finishScore(): ScoreResult | null {
  const result = acc?.finish() ?? null;
  stopScore();
  return result;
}

export function stopScore() {
  token++;
  clearInterval(timer);
  timer = undefined;
  acc = null;
}
