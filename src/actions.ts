// Ações do operador que combinam API, confirmações e motor de reprodução.
import { api } from './api';
import { playNext, playRequest } from './player/engine';
import { splitVideoTitle, type YtResult } from './player/youtube';
import { confirmDialog, fail, getState, setState, toast, upsertSong } from './store';
import type { Song } from './types';

/** "Próximo cantor" com proteção contra acionamento acidental durante uma apresentação. */
export async function requestNext() {
  const s = getState();
  if (s.playback.mode !== 'idle') {
    const ok = await confirmDialog({
      title: 'Encerrar a apresentação atual?',
      message: 'A música em reprodução será encerrada e o próximo cantor da fila começará.',
      confirmLabel: 'Encerrar e iniciar o próximo',
    });
    if (!ok) return;
  }
  playNext().catch(fail);
}

/** Iniciar um pedido específico sempre pede confirmação. */
export async function requestStart(reqId: number) {
  const s = getState();
  const req = s.requests.find((r) => r.id === reqId);
  const song = req && s.songMap.get(req.song_id);
  if (!req || !song) return;
  const playing = s.playback.mode !== 'idle';
  const ok = await confirmDialog({
    title: `Iniciar ${req.singer}?`,
    message: `${song.title}${song.artist ? ` — ${song.artist}` : ''}${playing ? '\n\nA apresentação atual será encerrada.' : ''}`,
    confirmLabel: 'Iniciar agora',
  });
  if (ok) playRequest(reqId).catch(fail);
}

export async function runImport(paths: string[]) {
  if (!paths.length) return;
  try {
    setState({ importStatus: await api.importPaths(paths) });
  } catch (e) {
    fail(e);
  }
}

export async function importFolder() {
  if (window.kpDesktop) return runImport(await window.kpDesktop.pickFolder());
  setState({ dialog: { type: 'importPath' } }); // modo web: o navegador não expõe caminhos de pastas
}

export async function importFiles() {
  if (window.kpDesktop) return runImport(await window.kpDesktop.pickFiles());
  setState({ dialog: { type: 'importPath' } });
}

export async function reindex() {
  try {
    setState({ importStatus: await api.reindex() });
    toast('Reindexando a biblioteca…');
  } catch (e) {
    fail(e);
  }
}

/** Salva a referência (apenas ID e dados públicos) de um vídeo do YouTube no catálogo. */
export async function saveYoutubeResult(r: Pick<YtResult, 'ytId' | 'title' | 'channel' | 'thumb' | 'duration' | 'license'>): Promise<Song> {
  const guess = splitVideoTitle(r.title);
  const song = await api.saveYoutube({ ...r, songTitle: guess.title, artist: guess.artist });
  upsertSong(song);
  return song;
}
