export interface Song {
  id: number;
  source: 'local' | 'youtube';
  path: string;
  cdg_path: string | null;
  title: string;
  artist: string;
  genre: string;
  format: string;
  duration: number | null;
  size: number;
  missing: number;
  favorite: number;
  volume: number;
  yt_id: string | null;
  thumb: string | null;
  channel: string | null;
  license: string | null;
  dup_key: string;
  added_at: number;
}

export type RequestStatus = 'waiting' | 'singing' | 'done' | 'skipped';

export interface SingerRequest {
  id: number;
  singer: string;
  song_id: number;
  position: number;
  status: RequestStatus;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
}

export interface Settings {
  masterVolume: number;
  fairRotation: boolean;
  autoAdvance: boolean;
  autoDelay: number;
  accent: string;
  compact: boolean;
  waitTitle: string;
  waitMessage: string;
  showNextSinger: boolean;
  ytApiKey: string;
  ytLanguage: string;
  ytRecent: string[];
  leftWidth: number;
  rightWidth: number;
}

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.9,
  fairRotation: false,
  autoAdvance: false,
  autoDelay: 10,
  accent: '#3b82f6',
  compact: false,
  waitTitle: 'Karaoke Pro',
  waitMessage: 'Escolha sua música e fale com o DJ',
  showNextSinger: true,
  ytApiKey: '',
  ytLanguage: 'pt',
  ytRecent: [],
  leftWidth: 430,
  rightWidth: 350,
};

export interface ImportStatus {
  running: boolean;
  phase: 'idle' | 'scan' | 'metadata';
  scanned: number;
  added: number;
  skipped: number;
  duplicates: number;
  relocated: number;
  missing: number;
  metaDone: number;
  metaTotal: number;
  errors: { file: string; error: string }[];
  finishedAt: number;
  version: number;
}

export type PlayMode = 'idle' | 'video' | 'audio' | 'cdg' | 'youtube';
export type PlayStatus = 'idle' | 'loading' | 'playing' | 'paused';

export interface Playback {
  mode: PlayMode;
  status: PlayStatus;
  reqId: number | null;
  songId: number | null;
  singer: string;
  time: number;
  duration: number;
  rate: number;
  ytHost: 'local' | 'audience';
  countdown: number | null;
}

/** Estado enviado da tela do operador para a tela do público. */
export interface AudienceState {
  mode: PlayMode;
  status: PlayStatus;
  songId: number | null;
  ytId: string | null;
  ytHere: boolean;
  title: string;
  artist: string;
  singer: string;
  time: number;
  sentAt: number;
  rate: number;
  volume: number;
  mediaUrl: string | null;
  cdgUrl: string | null;
  nextSinger: string;
  nextTitle: string;
  countdown: number | null;
  waitTitle: string;
  waitMessage: string;
  showNext: boolean;
  accent: string;
}

export type SyncMessage =
  | { type: 'state'; s: AudienceState }
  | { type: 'seek'; time: number }
  | { type: 'hello' }
  | { type: 'alive' }
  | { type: 'bye' }
  | { type: 'yt'; time: number; duration: number; state: number }
  | { type: 'yt-error'; code: number };

export const VIDEO_FORMATS = new Set(['mp4', 'm4v', 'webm', 'mkv', 'avi', 'mov']);

declare global {
  interface Window {
    __KP__?: { token: string; desktop: boolean };
    kpDesktop?: { pickFolder(): Promise<string[]>; pickFiles(): Promise<string[]> };
  }
}
