// Estado global da tela do operador (store mínimo sobre useSyncExternalStore).
import { useSyncExternalStore } from 'react';
import { api } from './api';
import { DEFAULT_ACCENT, DEFAULT_MICS, DEFAULT_SETTINGS, type ImportStatus, type Playback, type Settings, type SingerRequest, type Song } from './types';

export interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'error';
  text: string;
}

export interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface AppState {
  ready: boolean;
  songs: Song[];
  songMap: Map<number, Song>;
  requests: SingerRequest[];
  settings: Settings;
  importStatus: ImportStatus | null;
  playback: Playback;
  audienceOpen: boolean;
  toasts: Toast[];
  confirm: ConfirmState | null;
  dialog: Dialog;
}

export type Dialog =
  | null
  | { type: 'request'; songId?: number; reqId?: number }
  | { type: 'song'; songId: number }
  | { type: 'settings' }
  | { type: 'importPath' };

export const IDLE_PLAYBACK: Playback = {
  mode: 'idle', status: 'idle', reqId: null, songId: null, singer: '', time: 0, duration: 0, rate: 1, ytHost: 'local', countdown: null,
};

let state: AppState = {
  ready: false,
  songs: [],
  songMap: new Map(),
  requests: [],
  settings: DEFAULT_SETTINGS,
  importStatus: null,
  playback: IDLE_PLAYBACK,
  audienceOpen: false,
  toasts: [],
  confirm: null,
  dialog: null,
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** O seletor deve devolver uma referência estável (um campo do estado). */
export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}

export function setSongs(songs: Song[]) {
  setState({ songs, songMap: new Map(songs.map((s) => [s.id, s])) });
}

export function upsertSong(song: Song) {
  const exists = state.songMap.has(song.id);
  setSongs(exists ? state.songs.map((s) => (s.id === song.id ? song : s)) : [...state.songs, song]);
}

export function setPlayback(patch: Partial<Playback>) {
  setState({ playback: { ...state.playback, ...patch } });
}

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const id = toastId++;
  setState({ toasts: [...state.toasts.slice(-3), { id, kind, text }] });
  setTimeout(() => setState({ toasts: state.toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3500);
}

export const fail = (e: unknown) => toast(e instanceof Error ? e.message : String(e), 'error');

export function confirmDialog(opts: Omit<ConfirmState, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    setState({
      confirm: {
        ...opts,
        resolve: (ok) => {
          setState({ confirm: null });
          resolve(ok);
        },
      },
    });
  });
}

let saveTimer: number | undefined;
let pendingSave: Partial<Settings> = {};
export function updateSettings(patch: Partial<Settings>) {
  setState({ settings: { ...state.settings, ...patch } });
  pendingSave = { ...pendingSave, ...patch };
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const body = pendingSave;
    pendingSave = {};
    api.saveSettings(body).catch(fail);
  }, 400);
}

export async function loadAll() {
  const b = await api.bootstrap();
  setSongs(b.songs);
  const settings = { ...DEFAULT_SETTINGS, ...b.settings, mics: { ...DEFAULT_MICS, ...(b.settings.mics ?? {}) } };
  setState({ ready: true, requests: b.requests, settings, importStatus: b.importStatus });
  // identidade visual nova: troca uma única vez a cor antiga padrão pela atual
  if (settings.themeVersion < 2) updateSettings({ accent: DEFAULT_ACCENT, themeVersion: 2 });
}

// ---- regras da fila

/**
 * Ordem efetiva de quem está aguardando.
 * Rotação justa: cada pedido recebe uma "rodada" = apresentações já feitas pelo cantor + pedidos anteriores dele
 * ainda na fila. Quem ainda não cantou na rodada passa na frente; empates seguem a ordem manual.
 */
export function orderedWaiting(requests: SingerRequest[], fair: boolean): { req: SingerRequest; round: number }[] {
  const waiting = requests.filter((r) => r.status === 'waiting').sort((a, b) => a.position - b.position);
  if (!fair) return waiting.map((req) => ({ req, round: 0 }));
  const key = (n: string) => n.trim().toLowerCase();
  const sung = new Map<string, number>();
  for (const r of requests) {
    if (r.status === 'done' || r.status === 'singing') sung.set(key(r.singer), (sung.get(key(r.singer)) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const out = waiting.map((req) => {
    const k = key(req.singer);
    const ahead = seen.get(k) ?? 0;
    seen.set(k, ahead + 1);
    return { req, round: (sung.get(k) ?? 0) + ahead };
  });
  const min = out.length ? Math.min(...out.map((o) => o.round)) : 0;
  return out
    .map((o) => ({ ...o, round: o.round - min + 1 }))
    .sort((a, b) => a.round - b.round || a.req.position - b.req.position);
}

export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Cor de texto legível sobre a cor de destaque escolhida. */
export function onAccent(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#111111';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}
