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
  /** Vídeo do YouTube que falhou por bloqueio de incorporação (1) e última verificação que tocou. */
  blocked: number;
  checked_at: number | null;
  added_at: number;
}

/** 'pending': pedido feito pelo celular aguardando a aprovação do operador. */
export type RequestStatus = 'pending' | 'waiting' | 'singing' | 'done' | 'skipped';

export interface SingerRequest {
  id: number;
  singer: string;
  song_id: number;
  position: number;
  status: RequestStatus;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  source: 'operator' | 'phone';
}

/** Situação dos pedidos pelo celular (servidor da rede local). */
export interface PhoneInfo {
  enabled: boolean;
  running: boolean;
  approval: boolean;
  addresses: { name: string; address: string }[];
  address: string | null;
  url: string | null;
  error: string;
  youtube: boolean;
  hasKey: boolean;
  ytSearchesToday: number;
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
  vinheta: boolean;
  vinhetaSeconds: number;
  vinhetaVolume: number;
  themeVersion: number;
  mics: MicSettings;
  phoneOnAudience: boolean;
}

export interface MicChannel {
  on: boolean;
  gain: number;
  muted: boolean;
}

/** Configuração do mixer de microfones (por dispositivo de entrada). */
export interface MicSettings {
  channels: Record<string, MicChannel>;
  volume: number;
  echo: number;
  bass: number;
  treble: number;
}

export const DEFAULT_MICS: MicSettings = { channels: {}, volume: 1, echo: 0.2, bass: 0, treble: 0 };
export const DEFAULT_ACCENT = '#d9e88a';

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.9,
  fairRotation: false,
  autoAdvance: false,
  autoDelay: 10,
  accent: DEFAULT_ACCENT,
  compact: false,
  waitTitle: 'Karaoke Pro',
  waitMessage: 'Escolha sua música e fale com o DJ',
  showNextSinger: true,
  ytApiKey: '',
  ytLanguage: 'pt',
  ytRecent: [],
  leftWidth: 430,
  rightWidth: 350,
  vinheta: true,
  vinhetaSeconds: 12,
  vinhetaVolume: 0.7,
  themeVersion: 0,
  mics: DEFAULT_MICS,
  phoneOnAudience: true,
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

/** 'intro' é a vinheta exibida antes de cada apresentação. */
export type PlayMode = 'idle' | 'intro' | 'video' | 'audio' | 'cdg' | 'youtube';
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
  /** Durante a vinheta: a música já está carregada e pronta para começar. */
  ready: boolean;
  /** A música em reprodução é um arquivo local (não um vídeo do YouTube). */
  localMedia: boolean;
}

/** Estado enviado da tela do operador para a tela do público. */
export interface AudienceState {
  mode: PlayMode;
  status: PlayStatus;
  songId: number | null;
  ytId: string | null;
  ytHere: boolean;
  /** Vinheta em andamento: a tela do público pré-carrega a mídia sem tocar. */
  preparing: boolean;
  title: string;
  artist: string;
  singer: string;
  time: number;
  duration: number;
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
  /** QR code dos pedidos pelo celular (imagem PNG em data URL) e o endereço curto mostrado abaixo. */
  phoneQr: string | null;
  phoneHost: string | null;
}

export type SyncMessage =
  | { type: 'state'; s: AudienceState }
  | { type: 'seek'; time: number }
  | { type: 'hello' }
  | { type: 'alive' }
  | { type: 'bye' }
  | { type: 'yt'; ytId: string; time: number; duration: number; state: number }
  | { type: 'yt-error'; ytId: string; code: number }
  | { type: 'yt-ready'; ytId: string };

export const VIDEO_FORMATS = new Set(['mp4', 'm4v', 'webm', 'mkv', 'avi', 'mov']);

declare global {
  interface Window {
    __KP__?: { token: string; desktop: boolean };
    kpDesktop?: { pickFolder(): Promise<string[]>; pickFiles(): Promise<string[]>; toggleFullscreen(): Promise<boolean>; setFullscreen(on: boolean): Promise<void>; youtubeStatus(): Promise<boolean>; youtubeLogin(): Promise<boolean>; youtubeLogout(): Promise<boolean> };
  }
}
