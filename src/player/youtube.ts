// Player oficial incorporado (YouTube IFrame Player API) e pesquisa (YouTube Data API v3).
// Nada é baixado, e o player não é modificado: anúncios e restrições do YouTube são mantidos.

/* eslint-disable @typescript-eslint/no-explicit-any */
let apiPromise: Promise<any> | null = null;

export function loadYouTubeApi(): Promise<any> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.YT?.Player) return resolve(w.YT);
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(w.YT);
    };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => {
      apiPromise = null;
      reject(new Error('Sem conexão com o YouTube'));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export const YT_ENDED = 0;
export const YT_PLAYING = 1;
export const YT_PAUSED = 2;
export const YT_BUFFERING = 3;

export function ytErrorText(code: number): string {
  if (code === 101 || code === 150 || code === 153) return 'O dono do vídeo não permite a reprodução incorporada';
  if (code === 100) return 'Vídeo removido ou privado';
  if (code === 2) return 'ID de vídeo inválido';
  return `O YouTube não conseguiu reproduzir este vídeo (erro ${code})`;
}

export interface YtHandlers {
  onState(state: number): void;
  onError(code: number): void;
}

/** Envolve um YT.Player criado dentro de `host`. */
export class YtPlayer {
  private player: any = null;
  private ready = false;
  private destroyed = false;
  private queue: (() => void)[] = [];

  constructor(host: HTMLElement, videoId: string, start: number, controls: boolean, private handlers: YtHandlers) {
    const mount = document.createElement('div');
    host.replaceChildren(mount);
    loadYouTubeApi()
      .then((YT) => {
        if (this.destroyed) return;
        this.player = new YT.Player(mount, {
          width: '100%',
          height: '100%',
          videoId,
          playerVars: { autoplay: 1, controls: controls ? 1 : 0, rel: 0, playsinline: 1, start: Math.floor(start), origin: location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              this.queue.splice(0).forEach((f) => f());
              this.player.playVideo();
            },
            onStateChange: (e: any) => this.handlers.onState(e.data),
            onError: (e: any) => this.handlers.onError(e.data),
          },
        });
      })
      .catch(() => this.handlers.onError(-1));
  }

  private run(f: () => void) {
    if (this.ready) f();
    else this.queue.push(f);
  }

  play = () => this.run(() => this.player.playVideo());
  pause = () => this.run(() => this.player.pauseVideo());
  seek = (t: number) => this.run(() => this.player.seekTo(t, true));
  setVolume = (v: number) => this.run(() => this.player.setVolume(Math.round(v * 100)));
  setRate = (r: number) => this.run(() => this.player.setPlaybackRate(r));
  time = (): number => (this.ready ? this.player.getCurrentTime() || 0 : 0);
  duration = (): number => (this.ready ? this.player.getDuration() || 0 : 0);
  state = (): number => (this.ready ? this.player.getPlayerState() : -1);

  destroy() {
    this.destroyed = true;
    try {
      this.player?.destroy();
    } catch {
      /* já removido */
    }
  }
}

// ---------------------------------------------------------------- pesquisa

export interface YtResult {
  ytId: string;
  title: string;
  channel: string;
  thumb: string;
  duration: number | null;
  license: string;
  score: number;
}

const LANG: Record<string, { words: string; code: string }> = {
  pt: { words: 'karaokê com letra', code: 'pt' },
  en: { words: 'karaoke with lyrics', code: 'en' },
  es: { words: 'karaoke con letra', code: 'es' },
  any: { words: 'karaoke', code: '' },
};

function isoDuration(iso: string): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

const decode = (s: string) => {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
};

/** Dá preferência a versões instrumentais com letra. */
function score(title: string): number {
  const t = title.toLowerCase();
  let s = 0;
  if (/karaok[eê]/.test(t)) s += 5;
  if (/instrumental|playback|backing track|sem voz/.test(t)) s += 3;
  if (/com letra|with lyrics|con letra|lyrics/.test(t)) s += 2;
  if (/\bcover\b|ao vivo|\blive\b|react|tutorial|aula|como cantar|making of/.test(t)) s -= 4;
  return s;
}

async function yt(path: string, params: Record<string, string>) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams(params)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.errors?.[0]?.reason;
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new Error('Cota diária gratuita da API do YouTube esgotada. Tente novamente amanhã.');
    if (res.status === 400 || res.status === 403) throw new Error(`Chave de API recusada pelo YouTube: ${data?.error?.message || reason || res.status}`);
    throw new Error(data?.error?.message || `Erro ${res.status} na API do YouTube`);
  }
  return data;
}

const cache = new Map<string, YtResult[]>();

export async function searchKaraoke(apiKey: string, query: string, lang: string, ccOnly: boolean): Promise<YtResult[]> {
  const key = `${lang}|${ccOnly}|${query.trim().toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return hit; // economiza cota: cada pesquisa custa 100 unidades das 10.000 diárias
  const l = LANG[lang] ?? LANG.any;
  const params: Record<string, string> = {
    key: apiKey, part: 'snippet', type: 'video', maxResults: '25', videoEmbeddable: 'true', videoSyndicated: 'true',
    q: `${query.trim()} ${l.words}`,
  };
  if (l.code) params.relevanceLanguage = l.code;
  if (ccOnly) params.videoLicense = 'creativeCommon';
  const search = await yt('search', params);
  const ids: string[] = (search.items || []).map((i: any) => i.id?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const details = await yt('videos', { key: apiKey, part: 'contentDetails,status', id: ids.join(',') });
  const info = new Map<string, any>((details.items || []).map((v: any) => [v.id, v]));
  const results: YtResult[] = (search.items || [])
    .filter((i: any) => i.id?.videoId && info.get(i.id.videoId)?.status?.embeddable !== false)
    .map((i: any, idx: number) => {
      const v = info.get(i.id.videoId);
      const title = decode(i.snippet.title);
      return {
        ytId: i.id.videoId,
        title,
        channel: decode(i.snippet.channelTitle || ''),
        thumb: i.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
        duration: v ? isoDuration(v.contentDetails?.duration) : null,
        license: v?.status?.license || 'youtube',
        score: score(title) - idx * 0.01,
      };
    })
    .sort((a: YtResult, b: YtResult) => b.score - a.score);
  cache.set(key, results);
  return results;
}

export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(s);
  return m ? m[1] : null;
}

/** "Queen - Bohemian Rhapsody (Karaoke Version)" -> artista e música sugeridos. */
export function splitVideoTitle(title: string): { artist: string; title: string } {
  const clean = title
    .replace(/[\(\[][^\)\]]*(karaok[eê]|instrumental|playback|lyrics|letra|vers[aã]o|version|hd|4k)[^\)\]]*[\)\]]/gi, ' ')
    .replace(/\b(karaok[eê]( version)?|com letra|with lyrics|instrumental|playback)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–|]+|[\s\-–|]+$/g, '');
  const parts = clean.split(/\s+[-–|]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: '', title: clean || title };
}
