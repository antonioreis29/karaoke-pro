// Proteção contra vídeos do YouTube que não tocam fora do site.
//
// O erro 150 não dá informação suficiente para diagnosticar checagens da conexão:
//  - o vídeo é que não pode ser incorporado (bloqueio do dono ou da gravadora): trocar de versão resolve;
//  - o YouTube está pedindo "confirme que você não é um robô" para a conexão inteira: nenhum vídeo toca,
//    e trocar de versão só gasta cota. Essa hipótese não pode ser confirmada só pelo erro.
// Regra usada aqui: um vídeo só é marcado como bloqueado quando algum outro vídeo do YouTube tocou na mesma
// verificação. Se nenhum toca, o app interrompe as tentativas e avisa que a causa não foi confirmada.
//
// 1. Verificação antecipada: com o palco livre, cada vídeo da fila é testado na prévia do operador —
//    player visível, sem nada na frente e sem som (mute pela própria API), como as regras do YouTube exigem.
// 2. Troca automática: vídeo bloqueado passa para outra versão da mesma música que tocou no teste.
// 3. Na hora: se um vídeo falhar ao começar, uma outra versão entra sozinha (uma tentativa).
import { api } from '../api';
import { getState, setState, subscribe, toast, upsertSong } from '../store';
import type { SingerRequest, Song } from '../types';
import { playReplacement, setYoutubeFailureHandler, surfaces } from './engine';
import { YT_PLAYING, YtPlayer } from './youtube';

/** 100 = removido/privado; 101 e 150 = não pode tocar aqui (bloqueio do vídeo ou checagem anti-robô da conexão). */
const BLOCKED_CODES = new Set([100, 101, 150]);
const RECHECK_MS = 6 * 3600_000;
const MAX_ALTERNATIVES = 3;
const lastAttempt = new Map<number, number>();

type ProbeResult = 'ok' | 'blocked' | 'unknown';

const isIdle = () => {
  const pb = getState().playback;
  return pb.mode === 'idle' && pb.countdown == null;
};

// ---------------------------------------------------------------- problema na conexão

function setNetworkProblem(on: boolean) {
  if (!!getState().ytNetwork === on) return;
  setState({ ytNetwork: on ? { since: Date.now() } : null });
  if (on) {
    toast('Os vídeos testados falharam. A causa ainda não foi confirmada: pode ser restrição dos vídeos, identificação do player ou conexão.', 'error');
  } else toast('O YouTube voltou a tocar vídeos nesta conexão', 'ok');
}

// qualquer vídeo do YouTube tocando de verdade prova que a conexão está boa
subscribe(() => {
  const pb = getState().playback;
  if (pb.mode === 'youtube' && pb.status === 'playing' && pb.time > 0.5) {
    failsInARow = 0;
    if (getState().ytNetwork) setNetworkProblem(false);
  }
});

// ---------------------------------------------------------------- teste de um vídeo

/** Testa um vídeo na prévia do operador. Interrompe na hora se o operador começar uma música. */
function probe(ytId: string): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let done = false;
    let player: YtPlayer | null = null;
    const finish = (r: ProbeResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      player?.destroy();
      surfaces.checkHost.replaceChildren();
      resolve(r);
    };
    const unsub = subscribe(() => {
      if (!isIdle()) finish('unknown');
    });
    const timer = window.setTimeout(() => finish('unknown'), 15_000);
    // espera a prévia aparecer: o YouTube só permite tocar com o player visível
    window.setTimeout(() => {
      if (done) return;
      player = new YtPlayer(surfaces.checkHost, ytId, 0, false, {
        onState: (st) => {
          if (st === YT_PLAYING) finish('ok');
        },
        onError: (code) => finish(BLOCKED_CODES.has(code) ? 'blocked' : 'unknown'),
      });
      player.setVolume(0); // aplicado antes de tocar
    }, 120);
  });
}

function label(text: string | null) {
  setState({ ytCheck: text ? { active: true, label: text } : null });
}

async function setBlocked(song: Song, blocked: boolean) {
  try {
    upsertSong(await api.patchSong(song.id, blocked ? { blocked: true } : { blocked: false, checkedAt: Date.now() }));
  } catch {
    /* não impede o resto */
  }
}

async function alternatives(song: Song, tried: Set<string>) {
  try {
    return (await api.alternatives(song.id, [...tried])).slice(0, MAX_ALTERNATIVES);
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return null;
  }
}

async function moveRequest(req: SingerRequest, to: Song) {
  setState({ requests: await api.patchRequest(req.id, { songId: to.id }) });
}

// ---------------------------------------------------------------- 1 e 2: verificação da fila

let running = false;

const needsCheck = (s: Song | undefined) =>
  !!s && s.source === 'youtube' && !s.blocked && Date.now() - (lastAttempt.get(s.id) ?? 0) > 300000 && (!s.checked_at || Date.now() - s.checked_at > RECHECK_MS);

function queuedYoutube(): { req: SingerRequest; song: Song }[] {
  const { requests, songMap } = getState();
  return requests
    .filter((r) => r.status === 'waiting' || r.status === 'pending')
    .sort((a, b) => a.position - b.position)
    .map((req) => ({ req, song: songMap.get(req.song_id)! }))
    .filter((x) => x.song && x.song.source === 'youtube');
}

/** Procura e testa outras versões; devolve a primeira que tocou. 'none' = nenhuma tocou; null = interrompido/sem busca. */
async function testedReplacement(song: Song, tried: Set<string>): Promise<Song | 'none' | null> {
  const list = await alternatives(song, tried);
  if (!list) return null;
  for (const c of list) {
    tried.add(c.ytId);
    if (!isIdle()) return null;
    const r = await probe(c.ytId);
    if (r === 'unknown') return null;
    if (r === 'ok') {
      const saved = await api.saveYoutube({ ...c });
      upsertSong(await api.patchSong(saved.id, { checkedAt: Date.now() }));
      return saved;
    }
  }
  return 'none';
}

export async function verifyQueue(manual = false) {
  if (running) return;
  if (!isIdle()) {
    if (manual) toast('A verificação roda com o palco livre. Ela continua quando a música acabar.');
    return;
  }
  // a verificação manual também testa de novo os vídeos marcados como bloqueados (podem ter voltado)
  const todo = queuedYoutube().filter((x) => (manual ? true : needsCheck(x.song)));
  if (!todo.length) {
    if (manual) toast('Não há vídeos do YouTube na fila para verificar', 'ok');
    return;
  }
  running = true;
  try {
    // fase 1: testa todos, sem marcar nada ainda
    const ok: Song[] = [];
    let unknown = 0;
    const failed: { req: SingerRequest; song: Song }[] = [];
    for (let i = 0; i < todo.length; i++) {
      if (!isIdle()) return;
      const { req, song } = todo[i];
      label(`Verificando vídeos do YouTube ${i + 1}/${todo.length}: ${song.title}`);
      lastAttempt.set(song.id, Date.now());
      const r = await probe(song.yt_id!);
      if (r === 'ok') {
        ok.push(song);
        if (song.blocked) await setBlocked(song, false);
        else upsertSong(await api.patchSong(song.id, { checkedAt: Date.now() }));
      } else if (r === 'blocked') failed.push({ req, song });
      else if (!isIdle()) return; // interrompido pelo operador: continua depois
      else unknown++;
    }
    if (!failed.length) {
      if (unknown) {
        if (!ok.length) setNetworkProblem(true);
        if (manual) toast(`${unknown} vídeo(s) sem resultado conclusivo. Confira o player e tente novamente.`, 'error');
        return;
      }
      setNetworkProblem(false);
      if (manual) toast(`Vídeos da fila verificados: ${ok.length} tocam`, 'ok');
      return;
    }

    // fase 2: testa versões alternativas, sem afirmar uma causa para falhas gerais
    let connectionOk = ok.length > 0;
    for (const { req, song } of failed) {
      if (!isIdle()) return;
      const current = getState().requests.find((x) => x.id === req.id);
      if (!current || current.song_id !== song.id || !(current.status === 'waiting' || current.status === 'pending')) continue;
      label(`"${song.title}" não tocou. Procurando outra versão…`);
      const alt = await testedReplacement(song, new Set([song.yt_id!]));
      if (alt === null) return; // interrompido ou sem chave da API
      if (alt === 'none') {
        if (!connectionOk) {
          // Nada tocou: interrompe as tentativas. A causa continua inconclusiva.
          setNetworkProblem(true);
          return;
        }
        await setBlocked(song, true);
        toast(`${req.singer}: "${song.title}" não pode tocar aqui e não achei outra versão que toque. Troque a música desse pedido.`, 'error');
        continue;
      }
      connectionOk = true;
      setNetworkProblem(false);
      await setBlocked(song, true);
      await moveRequest(current, alt);
      toast(`${req.singer}: o vídeo de "${song.title}" estava bloqueado. Troquei por outra versão que toca.`, 'ok');
    }
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
  } finally {
    running = false;
    label(null);
  }
}

// verificação automática: palco livre e vídeo novo na fila (com uma pequena espera para não atrapalhar o operador).
// Com problema de conexão detectado, não roda sozinha: o operador usa o botão quando quiser testar de novo.
let autoTimer: number | undefined;
subscribe(() => {
  if (running || !isIdle() || getState().ytNetwork) return;
  if (!queuedYoutube().some((x) => needsCheck(x.song))) return;
  clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => {
    if (!running && isIdle() && !getState().ytNetwork) verifyQueue().catch(() => undefined);
  }, 4000);
});

// ---------------------------------------------------------------- 3: falha durante a apresentação

let failsInARow = 0; // vídeos diferentes que falharam seguidos, sem nenhum tocar no meio
const tried = new Map<number, Set<string>>(); // pedido -> vídeos já tentados
const pendingMarks = new Map<number, Song>(); // marcado só se a outra versão tocar

subscribe(() => {
  // a versão de troca tocou: agora sim o vídeo original é marcado como bloqueado
  const pb = getState().playback;
  if (pb.mode !== 'youtube' || pb.status !== 'playing' || pb.reqId == null) return;
  const original = pendingMarks.get(pb.reqId);
  if (original) {
    pendingMarks.delete(pb.reqId);
    setBlocked(original, true);
  }
});

setYoutubeFailureHandler(async (code) => {
  const pb = getState().playback;
  const song = pb.songId != null ? getState().songMap.get(pb.songId) : undefined;
  if (!BLOCKED_CODES.has(code) || pb.reqId == null || !song || song.source !== 'youtube') return false;
  failsInARow++;
  if (getState().ytNetwork || failsInARow >= 2) {
    // A troca também falhou: interrompe, sem afirmar que a causa é a conexão.
    pendingMarks.delete(pb.reqId);
    setNetworkProblem(true);
    return false;
  }
  const reqId = pb.reqId;
  const singer = pb.singer;
  const seen = tried.get(reqId) ?? new Set<string>();
  seen.add(song.yt_id!);
  tried.set(reqId, seen);
  toast(`O vídeo de "${song.title}" não tocou. Tentando outra versão…`);
  const list = await alternatives(song, seen);
  const c = list?.[0];
  const stillCurrent = () => getState().playback.mode === 'youtube' && getState().playback.reqId === reqId && getState().playback.songId === song.id;
  if (!c || !stillCurrent()) return false;
  seen.add(c.ytId);
  const alt = await api.saveYoutube({ ...c });
  upsertSong(alt);
  if (!stillCurrent()) return false;
  pendingMarks.set(reqId, song);
  const req = getState().requests.find((r) => r.id === reqId);
  if (req) await moveRequest(req, alt);
  if (!stillCurrent()) return false;
  await playReplacement(alt, reqId, singer);
  return true;
});
