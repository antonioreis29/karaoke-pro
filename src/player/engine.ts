// Motor de reprodução da tela do operador. Separado da fila: recebe um pedido (ou uma música) e cuida de
// carregar, tocar, detectar o término e manter a tela do público sincronizada.
import { api, cdgUrl, mediaUrl } from '../api';
import { fail, getState, IDLE_PLAYBACK, orderedWaiting, setPlayback, setState, subscribe, toast, upsertSong } from '../store';
import { VIDEO_FORMATS, type AudienceState, type PlayMode, type Song, type SyncMessage } from '../types';
import { CdgPlayer, loadCdg } from './cdg';
import { jingle } from './jingle';
import { warmYouTube, YT_ENDED, YT_PAUSED, YT_PLAYING, YtPlayer, ytErrorText } from './youtube';

const video = document.createElement('video');
video.playsInline = true;
video.preload = 'auto';
const canvas = document.createElement('canvas');
const ytHost = document.createElement('div');
ytHost.className = 'yt-host';
const checkHost = document.createElement('div'); // player de verificação (visível, sem som) quando o palco está livre
checkHost.className = 'yt-check';

/** Elementos montados pelo painel central (pré-visualização). */
export const surfaces = { video, canvas, ytHost, checkHost };

/** Chamado quando um vídeo do YouTube falha; devolve true se resolveu (por exemplo, trocando de versão). */
type YoutubeFailureHandler = (code: number) => Promise<boolean>;
let youtubeFailureHandler: YoutubeFailureHandler | null = null;
export function setYoutubeFailureHandler(fn: YoutubeFailureHandler) {
  youtubeFailureHandler = fn;
}
let failing = false;
async function youtubeFailed(code: number) {
  if (failing) return;
  const failedToken = loadToken;
  failing = true;
  try {
    if (youtubeFailureHandler && (await youtubeFailureHandler(code).catch(() => false))) return;
    if (failedToken !== loadToken) return; // o operador já parou ou iniciou outra apresentação
    await handleError(code === -1 ? 'Sem conexão com o YouTube' : ytErrorText(code));
  } finally {
    failing = false;
  }
}

let cdg: CdgPlayer | null = null;
let ytp: YtPlayer | null = null;
let ytPoll: number | undefined;
let raf = 0;
let countdownTimer: number | undefined;
let introTimer: number | undefined;
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
  jingle.setVolume(getState().settings.masterVolume * getState().settings.vinhetaVolume);
}

function teardown() {
  loadToken++;
  clearInterval(introTimer);
  jingle.stop();
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
  if (mode === 'intro' && as === 'done') as = 'waiting'; // interrompido na vinheta: ainda não cantou
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
  if (s.settings.vinheta) return void playNext().catch(fail); // a vinheta já faz a transição
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
  if (getState().playback.mode !== 'intro') setPlayback({ duration: video.duration });
  saveDuration(song, video.duration);
});
video.addEventListener('playing', () => setPlayback({ status: 'playing' }));
video.addEventListener('pause', () => {
  const mode = getState().playback.mode;
  if (!video.ended && mode !== 'idle' && mode !== 'intro' && video.getAttribute('src')) setPlayback({ status: 'paused' });
});
video.addEventListener('timeupdate', () => {
  const mode = getState().playback.mode;
  if (mode !== 'idle' && mode !== 'intro') setPlayback({ time: video.currentTime });
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
  const my = loadToken;
  clearInterval(ytPoll);
  ytp?.destroy();
  ytp = new YtPlayer(ytHost, song.yt_id!, start, true, {
    onState: (st) => {
      if (my !== loadToken) return;
      if (st === YT_PLAYING) setPlayback({ status: 'playing' });
      else if (st === YT_PAUSED) setPlayback({ status: 'paused' });
      else if (st === YT_ENDED) void onEnded();
    },
    onError: (code) => void youtubeFailed(code),
    onAutoplayBlocked: () => {
      if (my !== loadToken) return;
      setPlayback({ status: 'paused' });
      toast('O navegador bloqueou o início automático. Clique em Play no vídeo do YouTube.');
    },
  });
  applyVolume();
  ytPoll = window.setInterval(() => {
    if (!ytp || getState().playback.mode === 'intro') return;
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
  } else if (pb.mode === 'intro' && pb.ytHost === 'local' && !pb.localMedia && currentSong()?.source === 'youtube') {
    setPlayback({ ytHost: 'audience', ready: false }); // a tela do público adianta o código do player
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
  } else if (pb.mode === 'intro' && pb.ytHost === 'audience' && !pb.localMedia && song?.source === 'youtube') {
    const my = loadToken;
    setPlayback({ ytHost: 'local', ready: false });
    warmYouTube().then(() => markReady(my)).catch(() => markReady(my));
  }
}

channel.onmessage = (ev: MessageEvent<SyncMessage>) => {
  const m = ev.data;
  if (m.type === 'hello' || m.type === 'alive') audienceJoined();
  else if (m.type === 'bye') audienceLost();
  else if (m.type === 'yt-ready') {
    const pb = getState().playback;
    if (pb.mode === 'intro' && pb.ytHost === 'audience' && currentSong()?.yt_id === m.ytId) setPlayback({ ready: true });
  } else if (m.type === 'yt') {
    const pb = getState().playback;
    if (pb.mode !== 'youtube' || pb.ytHost !== 'audience') return;
    if (currentSong()?.yt_id !== m.ytId) return;
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
    if ((pb.mode === 'youtube' || pb.mode === 'intro') && pb.ytHost === 'audience' && currentSong()?.yt_id === m.ytId) void youtubeFailed(m.code);
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
  const local = song && pb.localMedia;
  const target = pb.mode === 'intro' && song ? (song.source === 'youtube' ? (pb.localMedia ? 'video' : 'youtube') : modeOf(song)) : pb.mode;
  return {
    mode: pb.mode,
    preparing: pb.mode === 'intro',
    status: pb.status,
    songId: pb.songId,
    ytId: song?.yt_id ?? null,
    ytHere: target === 'youtube' && pb.ytHost === 'audience',
    title: song?.title ?? '',
    artist: song?.artist ?? '',
    singer: pb.singer,
    time: pb.mode === 'youtube' || pb.mode === 'intro' ? pb.time : video.currentTime || pb.time,
    duration: pb.duration,
    sentAt: Date.now(),
    rate: pb.rate,
    volume: Math.min(1, s.settings.masterVolume * (song?.volume ?? 1)),
    mediaUrl: local && target === 'video' ? mediaUrl(song.id) : null,
    cdgUrl: local && target === 'cdg' ? cdgUrl(song.id) : null,
    nextSinger: next?.singer ?? '',
    nextTitle: nextSong?.title ?? '',
    countdown: pb.countdown,
    waitTitle: s.settings.waitTitle,
    waitMessage: s.settings.waitMessage,
    showNext: s.settings.showNextSinger,
    phoneQr: s.phone?.running ? s.phoneQr : null,
    phoneOnWait: s.settings.phoneOnAudience,
    phoneOnSong: s.settings.phoneQrDuringSong,
    phoneHost: s.phone?.running && s.phone.url ? new URL(s.phone.url).host : null,
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

/** Tempo máximo que a vinheta espera, além da duração configurada, por uma música lenta para carregar. */
const PREP_GRACE = 20;

function markReady(my: number) {
  if (my === loadToken && getState().playback.mode === 'intro') setPlayback({ ready: true });
}

/** Espera o navegador ter dados suficientes para tocar o arquivo do início ao fim sem pausas. */
function waitCanPlay(my: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('canplaythrough', done);
      clearInterval(check);
      resolve();
    };
    const check = window.setInterval(() => {
      if (my !== loadToken || video.readyState >= 4 || video.error) done();
    }, 150);
    video.addEventListener('canplaythrough', done);
  });
}

/** Carrega a música durante a vinheta, sem tocar. */
async function prepare(song: Song, my: number) {
  const mode = song.source === 'youtube' ? (getState().playback.localMedia ? 'video' : 'youtube') : modeOf(song);
  if (mode === 'youtube') {
    // Sem player escondido atrás da vinheta (regra do YouTube): só o código do player e a conexão.
    // Na tela do público isso é feito lá, que avisa com "yt-ready".
    if (getState().playback.ytHost === 'local') await warmYouTube().then(() => markReady(my));
    return;
  }
  if (mode === 'cdg') {
    const player = await loadCdg(cdgUrl(song.id), canvas);
    if (my !== loadToken) return;
    cdg = player;
    cdgLoop();
  }
  video.preload = 'auto';
  video.src = mediaUrl(song.id);
  video.playbackRate = 1;
  applyVolume();
  video.load();
  await waitCanPlay(my);
  if (!video.error) markReady(my);
}

/** Fim da vinheta: a música (já carregada) começa na hora. */
function begin(my: number) {
  if (my !== loadToken) return;
  const pb = getState().playback;
  const song = currentSong();
  if (pb.mode !== 'intro' || !song) return;
  clearInterval(introTimer);
  jingle.stop(0.6);
  const mode = song.source === 'youtube' ? (pb.localMedia ? 'video' : 'youtube') : modeOf(song);
  if (mode !== 'youtube' && !video.getAttribute('src')) {
    // pulou a vinheta antes de o arquivo começar a carregar: carrega do jeito normal
    return void load(song, pb.reqId, pb.singer).catch(fail);
  }
  const duration = mode !== 'youtube' && Number.isFinite(video.duration) ? video.duration : song.duration ?? 0;
  setPlayback({ mode, status: 'loading', time: 0, duration, ready: false });
  if (mode === 'youtube') {
    if (pb.ytHost === 'local') startYoutubeLocal(song, 0);
    return; // na tela do público, o novo estado faz a tela criar o player
  }
  video.play().catch((e) => {
    if (my === loadToken && !video.error) void handleError(e instanceof Error ? e.message : String(e));
  });
}

/** Vinheta: apresenta o cantor e a música com a trilha de fundo enquanto a música carrega. */
function startIntro(song: Song, reqId: number, singer: string) {
  cancelCountdown();
  teardown();
  const my = loadToken;
  const s = getState().settings;
  const total = Math.min(30, Math.max(3, s.vinhetaSeconds));
  const ytOnAudience = modeOf(song) === 'youtube' && getState().audienceOpen;
  setPlayback({
    ...IDLE_PLAYBACK, mode: 'intro', status: 'playing', reqId, songId: song.id, singer, duration: total,
    ytHost: ytOnAudience ? 'audience' : 'local', ready: false,
    localMedia: modeOf(song) !== 'youtube',
  });
  jingle.start(s.masterVolume * s.vinhetaVolume);
  prepare(song, my).catch((e) => {
    if (my === loadToken && !video.error) void handleError(e instanceof Error ? e.message : String(e));
  });
  const started = performance.now();
  introTimer = window.setInterval(() => {
    const elapsed = (performance.now() - started) / 1000;
    if (elapsed < total) return setPlayback({ time: elapsed });
    // a vinheta só termina com a música pronta (ou depois de uma espera máxima)
    if (getState().playback.ready || elapsed >= total + PREP_GRACE) return begin(my);
    setPlayback({ time: total });
  }, 100);
}

/** Pula a vinheta e começa a música imediatamente. */
export function skipIntro() {
  if (getState().playback.mode === 'intro') begin(loadToken);
}

async function load(song: Song, reqId: number | null, singer: string) {
  cancelCountdown();
  teardown();
  const my = loadToken;
  const mode = modeOf(song);
  const ytOnAudience = mode === 'youtube' && getState().audienceOpen;
  setPlayback({
    ...IDLE_PLAYBACK, mode, status: 'loading', reqId, songId: song.id, singer,
    duration: song.duration ?? 0, ytHost: ytOnAudience ? 'audience' : 'local',
    localMedia: mode !== 'youtube',
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
  if (getState().settings.vinheta) startIntro(song, reqId, req.singer);
  else await load(song, reqId, req.singer);
}

/** Toca uma música sem cantor associado (teste do arquivo pelo operador). */
/** Troca de versão no meio da apresentação: a nova música começa direto, sem vinheta. */
export async function playReplacement(song: Song, reqId: number, singer: string) {
  await load(song, reqId, singer);
}

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
  if (pb.mode === 'intro') return skipIntro();
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
  if (pb.mode === 'idle' || pb.mode === 'intro') return;
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
  if (pb.mode === 'idle' || pb.mode === 'intro' || pb.mode === 'youtube') return;
  video.preservesPitch = true;
  video.playbackRate = rate;
  setPlayback({ rate });
}

export function openAudience() {
  const w = window.open('/?view=audience', 'kp-audience', 'popup,width=1280,height=720');
  if (!w) toast('O navegador bloqueou a nova janela. Permita pop-ups para este endereço.', 'error');
}
