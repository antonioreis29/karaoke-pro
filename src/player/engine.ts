// Motor de reprodução da tela do operador. Separado da fila: recebe um pedido (ou uma música) e cuida de
// carregar, tocar, detectar o término e manter a tela do público sincronizada.
import { api, cdgUrl, mediaUrl } from '../api';
import { fail, getState, IDLE_PLAYBACK, orderedWaiting, setPlayback, setState, subscribe, toast, upsertSong } from '../store';
import { VIDEO_FORMATS, type AudienceState, type PlayMode, type Song, type SyncMessage } from '../types';
import { CdgPlayer, loadCdg } from './cdg';
import { YT_ENDED, YT_PAUSED, YT_PLAYING, YtPlayer, ytErrorText } from './youtube';

const video = document.createElement('video');
video.playsInline = true;
video.preload = 'auto';
const canvas = document.createElement('canvas');
const ytHost = document.createElement('div');
ytHost.className = 'yt-host';

/** Elementos montados pelo painel central (pré-visualização). */
export const surfaces = { video, canvas, ytHost };

let cdg: CdgPlayer | null = null;
let ytp: YtPlayer | null = null;
let ytPoll: number | undefined;
let raf = 0;
let countdownTimer: number | undefined;
let loadToken = 0;
let lastAlive = 0;

const channel = new BroadcastChannel('karaoke-pro');
const post = (m: SyncMessage) => channel.postMessage(m);

const currentSong = (): Song | undefined => {
  const id = getState().playback.songId;
  return id == null ? undefined : getState().songMap.get(id);
};

function modeOf(song: Song): PlayMode {
  if (song.source === 'youtube') return 'youtube';
  if (song.format === 'cdg' || song.format === 'zip') return 'cdg';
  return VIDEO_FORMATS.has(song.format) ? 'video' : 'audio';
}

export function applyVolume() {
  const v = Math.min(1, Math.max(0, getState().settings.masterVolume * (currentSong()?.volume ?? 1)));
  video.volume = v;
  ytp?.setVolume(v);
}

function teardown() {
  loadToken++;
  cancelAnimationFrame(raf);
  clearInterval(ytPoll);
  ytp?.destroy();
  ytp = null;
  ytHost.replaceChildren();
  cdg = null;
  if (video.getAttribute('src')) {
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}

function cancelCountdown() {
  clearInterval(countdownTimer);
  if (getState().playback.countdown != null) setPlayback({ countdown: null });
}

function saveDuration(song: Song, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return;
  if (song.duration != null && Math.abs(song.duration - duration) < 1) return;
  api.patchSong(song.id, { duration }).then(upsertSong).catch(() => undefined);
}

async function handleError(message: string) {
  const { reqId } = getState().playback;
  teardown();
  setPlayback(IDLE_PLAYBACK);
  toast(message, 'error');
  if (reqId != null) {
    // a apresentação não aconteceu: o cantor volta para a fila
    try {
      setState({ requests: await api.patchRequest(reqId, { status: 'waiting' }) });
    } catch (e) {
      fail(e);
    }
  }
}

async function finishCurrent(as: 'done' | 'waiting' | 'skipped') {
  const { reqId, mode } = getState().playback;
  if (mode === 'idle') return;
  teardown();
  setPlayback(IDLE_PLAYBACK);
  if (reqId != null) setState({ requests: await api.patchRequest(reqId, { status: as }) });
}

async function onEnded() {
  try {
    await finishCurrent('done');
  } catch (e) {
    fail(e);
  }
  const s = getState();
  const next = orderedWaiting(s.requests, s.settings.fairRotation)[0];
  if (!s.settings.autoAdvance || !next) return;
  let left = Math.max(1, Math.round(s.settings.autoDelay));
  setPlayback({ countdown: left });
  countdownTimer = window.setInterval(() => {
    left--;
    if (left > 0) return setPlayback({ countdown: left });
    cancelCountdown();
    playNext().catch(fail);
  }, 1000);
}

// ---------------------------------------------------------------- mídia local

video.addEventListener('loadedmetadata', () => {
  const song = currentSong();
  if (!song || !Number.isFinite(video.duration)) return;
  setPlayback({ duration: video.duration });
  saveDuration(song, video.duration);
});
video.addEventListener('playing', () => setPlayback({ status: 'playing' }));
video.addEventListener('pause', () => {
  if (!video.ended && getState().playback.mode !== 'idle' && video.getAttribute('src')) setPlayback({ status: 'paused' });
});
video.addEventListener('timeupdate', () => {
  if (getState().playback.mode !== 'idle') setPlayback({ time: video.currentTime });
});
video.addEventListener('ended', () => void onEnded());
video.addEventListener('error', () => {
  if (!video.getAttribute('src') || getState().playback.mode === 'idle') return;
  const code = video.error?.code;
  const song = currentSong();
  const what = song ? `"${song.title}"` : 'o arquivo';
  if (code === 4) handleError(`Não foi possível reproduzir ${what}: arquivo ausente ou formato/codec não suportado (${song?.format.toUpperCase()})`);
  else if (code === 3) handleError(`Erro ao decodificar ${what}: arquivo corrompido ou codec não suportado`);
  else handleError(`Erro ao ler ${what}`);
});

function cdgLoop() {
  cdg?.render(video.currentTime);
  raf = requestAnimationFrame(cdgLoop);
}

// ---------------------------------------------------------------- YouTube

function startYoutubeLocal(song: Song, start: number) {
  clearInterval(ytPoll);
  ytp?.destroy();
  ytp = new YtPlayer(ytHost, song.yt_id!, start, true, {
    onState: (st) => {
      if (st === YT_PLAYING) setPlayback({ status: 'playing' });
      else if (st === YT_PAUSED) setPlayback({ status: 'paused' });
      else if (st === YT_ENDED) void onEnded();
    },
    onError: (code) => void handleError(code === -1 ? 'Sem conexão com o YouTube' : ytErrorText(code)),
  });
  applyVolume();
  ytPoll = window.setInterval(() => {
    if (!ytp) return;
    const duration = ytp.duration();
    setPlayback({ time: ytp.time(), ...(duration ? { duration } : {}) });
    if (duration) saveDuration(song, duration);
  }, 250);
}

function audienceJoined() {
  lastAlive = Date.now();
  if (!getState().audienceOpen) setState({ audienceOpen: true });
  const pb = getState().playback;
  if (pb.mode === 'youtube' && pb.ytHost === 'local') {
    // o vídeo do YouTube toca em um único player: passa para a tela do público
    const time = ytp?.time() ?? pb.time;
    clearInterval(ytPoll);
    ytp?.destroy();
    ytp = null;
    ytHost.replaceChildren();
    setPlayback({ ytHost: 'audience', time });
  }
  publish();
}

function audienceLost() {
  if (!getState().audienceOpen) return;
  setState({ audienceOpen: false });
  const pb = getState().playback;
  const song = currentSong();
  if (pb.mode === 'youtube' && pb.ytHost === 'audience' && song) {
    setPlayback({ ytHost: 'local' });
    startYoutubeLocal(song, pb.time);
  }
}

channel.onmessage = (ev: MessageEvent<SyncMessage>) => {
  const m = ev.data;
  if (m.type === 'hello' || m.type === 'alive') audienceJoined();
  else if (m.type === 'bye') audienceLost();
  else if (m.type === 'yt') {
    const pb = getState().playback;
    if (pb.mode !== 'youtube' || pb.ytHost !== 'audience') return;
    if (m.state === YT_ENDED) return void onEnded();
    setPlayback({
      time: m.time,
      ...(m.duration ? { duration: m.duration } : {}),
      ...(pb.status === 'loading' && m.state === YT_PLAYING ? { status: 'playing' as const } : {}),
    });
    const song = currentSong();
    if (song && m.duration) saveDuration(song, m.duration);
  } else if (m.type === 'yt-error') {
    const pb = getState().playback;
    if (pb.mode === 'youtube' && pb.ytHost === 'audience') void handleError(ytErrorText(m.code));
  }
};

setInterval(() => {
  if (getState().audienceOpen && Date.now() - lastAlive > 4500) audienceLost();
}, 1000);

// ---------------------------------------------------------------- sincronização com a tela do público

function buildAudienceState(): AudienceState {
  const s = getState();
  const pb = s.playback;
  const song = currentSong();
  const next = orderedWaiting(s.requests, s.settings.fairRotation)[0]?.req;
  const nextSong = next ? s.songMap.get(next.song_id) : undefined;
  const local = song && song.source === 'local';
  return {
    mode: pb.mode,
    status: pb.status,
    songId: pb.songId,
    ytId: song?.yt_id ?? null,
    ytHere: pb.mode === 'youtube' && pb.ytHost === 'audience',
    title: song?.title ?? '',
    artist: song?.artist ?? '',
    singer: pb.singer,
    time: pb.mode === 'youtube' ? pb.time : video.currentTime || pb.time,
    sentAt: Date.now(),
    rate: pb.rate,
    volume: Math.min(1, s.settings.masterVolume * (song?.volume ?? 1)),
    mediaUrl: local && pb.mode === 'video' ? mediaUrl(song.id) : null,
    cdgUrl: local && pb.mode === 'cdg' ? cdgUrl(song.id) : null,
    nextSinger: next?.singer ?? '',
    nextTitle: nextSong?.title ?? '',
    countdown: pb.countdown,
    waitTitle: s.settings.waitTitle,
    waitMessage: s.settings.waitMessage,
    showNext: s.settings.showNextSinger,
    accent: s.settings.accent,
  };
}

let publishQueued = false;
function publish() {
  if (publishQueued) return;
  publishQueued = true;
  queueMicrotask(() => {
    publishQueued = false;
    post({ type: 'state', s: buildAudienceState() });
  });
}
subscribe(publish);
// desligar o avanço automático cancela uma contagem em andamento
subscribe(() => {
  const s = getState();
  if (s.playback.countdown != null && !s.settings.autoAdvance) cancelCountdown();
});
setInterval(publish, 500);

// ---------------------------------------------------------------- comandos

async function load(song: Song, reqId: number | null, singer: string) {
  cancelCountdown();
  teardown();
  const my = loadToken;
  const mode = modeOf(song);
  const ytOnAudience = mode === 'youtube' && getState().audienceOpen;
  setPlayback({
    ...IDLE_PLAYBACK, mode, status: 'loading', reqId, songId: song.id, singer,
    duration: song.duration ?? 0, ytHost: ytOnAudience ? 'audience' : 'local',
  });
  if (mode === 'youtube') {
    if (!ytOnAudience) startYoutubeLocal(song, 0);
    return;
  }
  try {
    if (mode === 'cdg') {
      const player = await loadCdg(cdgUrl(song.id), canvas);
      if (my !== loadToken) return;
      cdg = player;
      cdgLoop();
    }
    video.src = mediaUrl(song.id);
    video.playbackRate = 1;
    applyVolume();
    await video.play();
  } catch (e) {
    if (my !== loadToken) return;
    // erros de mídia chegam pelo evento "error"; aqui tratamos o restante (CDG ausente, bloqueio de autoplay)
    if (!video.error) await handleError(e instanceof Error ? e.message : String(e));
  }
}

export async function playRequest(reqId: number) {
  const s = getState();
  const req = s.requests.find((r) => r.id === reqId);
  const song = req && s.songMap.get(req.song_id);
  if (!req || !song) return toast('Solicitação não encontrada', 'error');
  await finishCurrent('done');
  setState({ requests: await api.patchRequest(reqId, { status: 'singing' }) });
  await load(song, reqId, req.singer);
}

/** Toca uma música sem cantor associado (teste do arquivo pelo operador). */
export async function playSong(songId: number) {
  const song = getState().songMap.get(songId);
  if (!song) return;
  await finishCurrent('done');
  await load(song, null, '');
}

export async function playNext() {
  const s = getState();
  const next = orderedWaiting(s.requests, s.settings.fairRotation)[0];
  if (!next) {
    await finishCurrent('done');
    return toast('Não há cantores aguardando na fila');
  }
  await playRequest(next.req.id);
}

export async function stop(as: 'done' | 'waiting' | 'skipped' = 'done') {
  cancelCountdown();
  await finishCurrent(as);
}

export { cancelCountdown };

export function toggle() {
  const pb = getState().playback;
  if (pb.mode === 'idle') return;
  if (pb.mode === 'youtube') {
    if (pb.ytHost === 'audience') setPlayback({ status: pb.status === 'paused' ? 'playing' : 'paused' });
    else if (ytp?.state() === YT_PLAYING) ytp.pause();
    else ytp?.play();
    return;
  }
  if (video.paused) video.play().catch(fail);
  else video.pause();
}

export function seek(time: number) {
  const pb = getState().playback;
  if (pb.mode === 'idle') return;
  const t = Math.max(0, Math.min(time, (pb.duration || time) - 0.25));
  if (pb.mode === 'youtube') {
    if (pb.ytHost === 'audience') post({ type: 'seek', time: t });
    else ytp?.seek(t);
  } else video.currentTime = t;
  setPlayback({ time: t });
}

export const seekBy = (delta: number) => seek(getState().playback.time + delta);

/** Velocidade com preservação do tom (mídia local). */
export function setRate(rate: number) {
  const pb = getState().playback;
  if (pb.mode === 'idle' || pb.mode === 'youtube') return;
  video.preservesPitch = true;
  video.playbackRate = rate;
  setPlayback({ rate });
}

export function openAudience() {
  const w = window.open('/?view=audience', 'kp-audience', 'popup,width=1280,height=720');
  if (!w) toast('O navegador bloqueou a nova janela. Permita pop-ups para este endereço.', 'error');
}
