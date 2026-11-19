// Mixer de microfones: detecta as entradas de áudio do computador e as envia para a saída de som
// com volume por canal, grave/agudo e eco. O processamento usa a Web Audio API.
import { useSyncExternalStore } from 'react';
import { getState, updateSettings } from '../store';
import type { MicChannel, MicSettings } from '../types';

export interface MicDevice {
  id: string;
  label: string;
}

export interface MicState {
  status: 'off' | 'starting' | 'ready' | 'denied' | 'unsupported' | 'error';
  error: string;
  devices: MicDevice[];
  active: string[]; // dispositivos com áudio passando
  failed: Record<string, string>;
  levels: Record<string, number>; // pico 0..1 por canal
  latencyMs: number;
}

let state: MicState = { status: 'off', error: '', devices: [], active: [], failed: {}, levels: {}, latencyMs: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<MicState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
export const useMics = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );

interface Channel {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  buf: Float32Array<ArrayBuffer>;
}

let ctx: AudioContext | null = null;
let bus: GainNode;
let bass: BiquadFilterNode;
let treble: BiquadFilterNode;
let wet: GainNode;
let master: GainNode;
const channels = new Map<string, Channel>();
let meter: number | undefined;

const cfg = (): MicSettings => getState().settings.mics;
export const channelCfg = (id: string): MicChannel => cfg().channels[id] ?? { on: false, gain: 0.8, muted: false };

function graph(): AudioContext {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  bus = ctx.createGain();
  bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 220;
  treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 3500;
  // eco: atraso curto realimentado, típico de karaokê
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.17;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.36;
  wet = ctx.createGain();
  master = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor(); // segura picos e ajuda contra estouros
  limiter.threshold.value = -6;
  limiter.ratio.value = 12;
  bus.connect(bass).connect(treble);
  treble.connect(master);
  treble.connect(delay);
  delay.connect(feedback).connect(delay);
  delay.connect(wet).connect(master);
  master.connect(limiter).connect(ctx.destination);
  applyFx();
  return ctx;
}

function applyFx() {
  if (!ctx) return;
  const c = cfg();
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(c.volume, t, 0.02);
  wet.gain.setTargetAtTime(c.echo, t, 0.02);
  bass.gain.setTargetAtTime(c.bass, t, 0.02);
  treble.gain.setTargetAtTime(c.treble, t, 0.02);
  for (const [id, ch] of channels) {
    const cc = channelCfg(id);
    ch.gain.gain.setTargetAtTime(cc.muted ? 0 : cc.gain, t, 0.02);
  }
}

function tickMeter() {
  const levels: Record<string, number> = {};
  for (const [id, ch] of channels) {
    ch.analyser.getFloatTimeDomainData(ch.buf);
    let peak = 0;
    for (let i = 0; i < ch.buf.length; i++) peak = Math.max(peak, Math.abs(ch.buf[i]));
    // decaimento suave para o medidor não piscar
    levels[id] = Math.max(Math.min(1, peak), (state.levels[id] ?? 0) * 0.82);
  }
  set({ levels });
}

function closeChannel(id: string) {
  const ch = channels.get(id);
  if (!ch) return;
  channels.delete(id);
  ch.stream.getTracks().forEach((t) => t.stop());
  ch.source.disconnect();
  ch.gain.disconnect();
  if (!channels.size) {
    clearInterval(meter);
    meter = undefined;
  }
  set({ active: [...channels.keys()], levels: Object.fromEntries(Object.entries(state.levels).filter(([k]) => k !== id)) });
}

async function openChannel(id: string) {
  if (channels.has(id)) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      // sem os filtros de chamada de voz: eles distorcem o canto e aumentam o atraso
      audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const c = graph();
    await c.resume().catch(() => undefined);
    const source = c.createMediaStreamSource(stream);
    const gain = c.createGain();
    const analyser = c.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(gain).connect(analyser);
    gain.connect(bus);
    channels.set(id, { stream, source, gain, analyser, buf: new Float32Array(analyser.fftSize) });
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      closeChannel(id); // microfone desconectado: volta sozinho quando reaparecer
      refreshDevices().catch(() => undefined);
    });
    applyFx();
    if (!meter) meter = window.setInterval(tickMeter, 70);
    const { [id]: _gone, ...failed } = state.failed;
    set({ active: [...channels.keys()], failed, latencyMs: Math.round(((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000) });
  } catch (e) {
    const name = (e as DOMException).name;
    const msg = name === 'NotReadableError' ? 'em uso por outro programa' : name === 'NotAllowedError' ? 'acesso negado' : 'não foi possível abrir';
    set({ failed: { ...state.failed, [id]: msg } });
  }
}

const cleanLabel = (label: string, n: number) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim() || `Microfone ${n}`;

/** Atualiza a lista de entradas e (re)conecta os canais marcados como ligados. */
export async function refreshDevices() {
  const all = await navigator.mediaDevices.enumerateDevices();
  const devices = all
    // "default" e "communications" são apelidos do Windows para dispositivos que já aparecem na lista
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: cleanLabel(d.label, i + 1) }));
  set({ devices });
  const present = new Set(devices.map((d) => d.id));
  for (const id of [...channels.keys()]) if (!present.has(id)) closeChannel(id);
  await Promise.all(devices.filter((d) => channelCfg(d.id).on).map((d) => openChannel(d.id)));
}

/** Pede acesso aos microfones (necessário para o sistema revelar os dispositivos) e monta o mixer. */
export async function startMics() {
  if (!navigator.mediaDevices?.getUserMedia) return set({ status: 'unsupported' });
  if (state.status === 'starting') return;
  set({ status: 'starting', error: '' });
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
    probe.getTracks().forEach((t) => t.stop());
    await refreshDevices();
    set({ status: 'ready' });
  } catch (e) {
    const name = (e as DOMException).name;
    if (name === 'NotAllowedError') set({ status: 'denied' });
    else if (name === 'NotFoundError') {
      set({ status: 'ready', devices: [] }); // nenhum microfone conectado no momento
    } else set({ status: 'error', error: (e as Error).message });
  }
}

if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    if (state.status === 'ready') refreshDevices().catch(() => undefined);
  });
}

function save(patch: Partial<MicSettings>) {
  updateSettings({ mics: { ...cfg(), ...patch } });
  applyFx();
}

export function setChannel(id: string, patch: Partial<MicChannel>) {
  const next = { ...channelCfg(id), ...patch };
  save({ channels: { ...cfg().channels, [id]: next } });
  if (patch.on === true) openChannel(id);
  if (patch.on === false) closeChannel(id);
}

export const setFx = (patch: Partial<Pick<MicSettings, 'volume' | 'echo' | 'bass' | 'treble'>>) => save(patch);

// ---------------------------------------------------------------- som para a nota do cantor

let tap: AnalyserNode | null = null;
let solo: { id: string; stream: MediaStream; source: MediaStreamAudioSourceNode } | null = null;

function closeSolo() {
  if (!solo) return;
  solo.stream.getTracks().forEach((t) => t.stop());
  solo.source.disconnect();
  solo = null;
}

/**
 * Som que a nota do cantor analisa, antes do eco e do equalizador. Com microfones ligados no mixer, é a soma
 * deles; sem mixer (microfones numa mesa de som externa), `deviceId` escolhe uma entrada só para análise,
 * que não vai para o som.
 */
export async function scoreInput(deviceId: string, frameSize: number): Promise<AnalyserNode | null> {
  const c = graph();
  if (!tap) {
    tap = c.createAnalyser();
    tap.fftSize = frameSize;
    bus.connect(tap);
  }
  await c.resume().catch(() => undefined);
  if (channels.size) {
    closeSolo();
    return tap;
  }
  if (!deviceId || !navigator.mediaDevices?.getUserMedia) return null;
  if (solo?.id !== deviceId) {
    closeSolo();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const source = c.createMediaStreamSource(stream);
      source.connect(tap);
      solo = { id: deviceId, stream, source };
    } catch {
      return null;
    }
  }
  return tap;
}

/** Ao abrir o app: se já havia microfones ligados, o mixer volta como estava. */
export function restoreMics() {
  if (Object.values(cfg().channels).some((c) => c.on)) startMics().catch(() => undefined);
}
