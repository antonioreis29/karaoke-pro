import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { runImport } from '../actions';
import { api } from '../api';
import { playSong } from '../player/engine';
import { confirmDialog, fail, fmtTime, getState, setSongs, setState, toast, updateSettings, upsertSong, useApp } from '../store';
import { fmtLabel } from './LibraryPanel';
import { Icon } from './icons';

const close = () => setState({ dialog: null });
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function Modal({ title, children, onClose, wide }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} title="Fechar (Esc)"><Icon name="x" /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

function RequestDialog({ songId: initialSong, reqId }: { songId?: number; reqId?: number }) {
  const songs = useApp((s) => s.songs);
  const songMap = useApp((s) => s.songMap);
  const requests = useApp((s) => s.requests);
  const editing = reqId != null ? requests.find((r) => r.id === reqId) : undefined;
  const [singer, setSinger] = useState(editing?.singer ?? '');
  const [songId, setSongId] = useState<number | undefined>(editing?.song_id ?? initialSong);
  const [query, setQuery] = useState('');
  const song = songId != null ? songMap.get(songId) : undefined;
  const names = useMemo(() => [...new Set(requests.map((r) => r.singer))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [requests]);
  const matches = useMemo(() => {
    if (song) return [];
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const out = [];
    for (const s of songs) {
      const k = norm(`${s.title} ${s.artist}`);
      if (tokens.every((t) => k.includes(t))) out.push(s);
      if (out.length >= 40) break;
    }
    return out;
  }, [songs, query, song]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!singer.trim() || songId == null) return;
    try {
      const list = editing
        ? await api.patchRequest(editing.id, { singer: singer.trim(), songId })
        : await api.addRequest(singer.trim(), songId);
      setState({ requests: list, dialog: null });
      toast(editing ? 'Pedido atualizado' : `${singer.trim()} entrou na fila`, 'ok');
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Modal title={editing ? 'Editar pedido' : 'Adicionar à fila'} onClose={close}>
      <form onSubmit={submit} className="form">
        <label>
          Nome do cantor
          <input autoFocus value={singer} onChange={(e) => setSinger(e.target.value)} list="kp-singers" maxLength={80} placeholder="Ex.: Mariana" />
          <datalist id="kp-singers">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label>Música</label>
        {song ? (
          <div className="picked">
            <div className="song-main">
              <div className="t">{song.title}</div>
              <div className="a">{song.artist || 'Artista desconhecido'} · {fmtLabel(song.format)} · {fmtTime(song.duration)}</div>
            </div>
            <button type="button" className="btn sm" onClick={() => setSongId(undefined)}>Trocar</button>
          </div>
        ) : (
          <>
            <div className="search">
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar na biblioteca" spellCheck={false} />
            </div>
            <div className="pick-list">
              {matches.map((s) => (
                <button type="button" key={s.id} onClick={() => setSongId(s.id)}>
                  <span className="t">{s.title}</span>
                  <span className="a">{s.artist}</span>
                  <span className={`badge f-${s.format}`}>{fmtLabel(s.format)}</span>
                </button>
              ))}
              {!matches.length && <p className="hint">{songs.length ? 'Nenhuma música encontrada.' : 'Importe músicas para a biblioteca primeiro.'}</p>}
            </div>
          </>
        )}
        <footer>
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn primary" disabled={!singer.trim() || songId == null}>{editing ? 'Salvar' : 'Adicionar à fila'}</button>
        </footer>
      </form>
    </Modal>
  );
}

function SongDialog({ songId }: { songId: number }) {
  const song = useApp((s) => s.songMap.get(songId));
  const [title, setTitle] = useState(song?.title ?? '');
  const [artist, setArtist] = useState(song?.artist ?? '');
  const [genre, setGenre] = useState(song?.genre ?? '');
  if (!song) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      upsertSong(await api.patchSong(song.id, { title, artist, genre }));
      close();
      toast('Dados atualizados', 'ok');
    } catch (err) {
      fail(err);
    }
  };
  const test = async () => {
    if (getState().playback.mode !== 'idle') {
      const ok = await confirmDialog({ title: 'Interromper a apresentação atual?', message: 'A música em reprodução será encerrada para testar este arquivo.', confirmLabel: 'Interromper e testar' });
      if (!ok) return;
    }
    close();
    playSong(song.id).catch(fail);
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Remover do catálogo?',
      message: `"${song.title}" sai da biblioteca e dos pedidos da fila.${song.source === 'local' ? ' O arquivo no disco não é apagado.' : ''}`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      const r = await api.deleteSong(song.id);
      setSongs(r.songs);
      setState({ requests: r.requests, dialog: null });
    } catch (err) {
      fail(err);
    }
  };

  return (
    <Modal title="Dados da música" onClose={close}>
      <form onSubmit={save} className="form">
        <label>Título<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
        <label>Artista<input value={artist} onChange={(e) => setArtist(e.target.value)} /></label>
        <label>Gênero<input value={genre} onChange={(e) => setGenre(e.target.value)} /></label>
        <p className="path">
          {song.source === 'local' ? song.path : `YouTube · ${song.channel ?? ''} · ${song.license === 'creativeCommon' ? 'Creative Commons (CC BY)' : 'Licença padrão do YouTube'}`}
          {song.missing ? ' — arquivo ausente' : ''}
        </p>
        <footer>
          <button type="button" className="btn danger" onClick={remove}><Icon name="trash" size={14} /> Remover</button>
          <button type="button" className="btn" onClick={test} title="Reproduz sem cantor associado"><Icon name="play" size={14} /> Testar</button>
          <span className="grow" />
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn primary">Salvar</button>
        </footer>
      </form>
    </Modal>
  );
}

function ImportPathDialog() {
  const [text, setText] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const paths = text.split(/\r?\n/).map((l) => l.trim().replace(/^"|"$/g, '')).filter(Boolean);
    close();
    runImport(paths);
  };
  return (
    <Modal title="Importar músicas" onClose={close}>
      <form onSubmit={submit} className="form">
        <label>
          Caminhos de pastas ou arquivos (um por linha)
          <textarea autoFocus rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={'C:\\Karaoke\\Nacionais\nD:\\Musicas\\Queen - Bohemian Rhapsody.mp4'} spellCheck={false} />
        </label>
        <p className="hint">No modo web o navegador não informa caminhos de pastas, por isso eles são digitados. No aplicativo desktop é usado o seletor do Windows.</p>
        <footer>
          <button type="button" className="btn" onClick={close}>Cancelar</button>
          <button className="btn primary" disabled={!text.trim()}>Importar</button>
        </footer>
      </form>
    </Modal>
  );
}

const ACCENTS = ['#d9e88a', '#f4f0e1', '#ff8a5b', '#f472b6', '#7dd3fc', '#a78bfa'];

function SettingsDialog() {
  const s = useApp((st) => st.settings);
  return (
    <Modal title="Configurações" onClose={close} wide>
      <div className="form settings">
        <h3>Repertório online (YouTube)</h3>
        <label>
          Chave da YouTube Data API v3
          <input type="password" value={s.ytApiKey} onChange={(e) => updateSettings({ ytApiKey: e.target.value.trim() })} placeholder="AIza…" autoComplete="off" spellCheck={false} />
        </label>
        <p className="hint">
          Gratuita: crie um projeto no Google Cloud Console, ative a “YouTube Data API v3” e gere uma chave de API. A cota padrão é de 10.000 unidades por dia e
          cada pesquisa consome cerca de 101 (aproximadamente 99 pesquisas diárias). A chave fica salva apenas neste computador.
        </p>

        <h3>Reprodução</h3>
        <label className="check"><input type="checkbox" checked={s.autoAdvance} onChange={(e) => updateSettings({ autoAdvance: e.target.checked })} /> Iniciar o próximo cantor automaticamente ao fim da música</label>
        <label className="inline">
          Contagem antes do próximo cantor (sem vinheta)
          <input type="number" min={3} max={120} value={s.autoDelay} onChange={(e) => updateSettings({ autoDelay: Math.min(120, Math.max(3, +e.target.value || 10)) })} /> segundos
        </label>
        <label className="check"><input type="checkbox" checked={s.vinheta} onChange={(e) => updateSettings({ vinheta: e.target.checked })} /> Vinheta antes de cada cantor (nome do cantor, música e trilha de fundo)</label>
        <label className="inline">
          Duração da vinheta
          <input type="number" min={3} max={30} value={s.vinhetaSeconds} disabled={!s.vinheta} onChange={(e) => updateSettings({ vinhetaSeconds: Math.min(30, Math.max(3, +e.target.value || 8)) })} /> segundos
        </label>
        <label className="inline">
          Volume da trilha
          <input type="range" min={0} max={1} step={0.05} value={s.vinhetaVolume} disabled={!s.vinheta} onChange={(e) => updateSettings({ vinhetaVolume: +e.target.value })} /> {Math.round(s.vinhetaVolume * 100)}%
        </label>
        <label className="check"><input type="checkbox" checked={s.fairRotation} onChange={(e) => updateSettings({ fairRotation: e.target.checked })} /> Rotação justa da fila</label>

        <h3>Tela do público</h3>
        <label>Título da tela de espera<input value={s.waitTitle} maxLength={60} onChange={(e) => updateSettings({ waitTitle: e.target.value })} /></label>
        <label>Mensagem<input value={s.waitMessage} maxLength={140} onChange={(e) => updateSettings({ waitMessage: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={s.showNextSinger} onChange={(e) => updateSettings({ showNextSinger: e.target.checked })} /> Mostrar o nome do próximo cantor</label>

        <h3>Aparência</h3>
        <div className="swatches">
          {ACCENTS.map((c) => (
            <button key={c} className={s.accent === c ? 'on' : ''} style={{ background: c }} onClick={() => updateSettings({ accent: c })} title={c} aria-label={`Cor de destaque ${c}`} />
          ))}
          <input type="color" value={s.accent} onChange={(e) => updateSettings({ accent: e.target.value })} title="Cor personalizada" />
        </div>
        <label className="check"><input type="checkbox" checked={s.compact} onChange={(e) => updateSettings({ compact: e.target.checked })} /> Listas compactas</label>

        <h3>Atalhos de teclado</h3>
        <div className="keys">
          <span><kbd>Espaço</kbd> Play / Pause</span><span><kbd>S</kbd> Parar</span><span><kbd>N</kbd> Próximo cantor</span>
          <span><kbd>←</kbd><kbd>→</kbd> Voltar / avançar 5 s</span><span><kbd>↑</kbd><kbd>↓</kbd> Volume geral</span>
          <span><kbd>P</kbd> Tela do público</span><span><kbd>F11</kbd> Tela cheia</span><span><kbd>Ctrl</kbd><kbd>F</kbd> Buscar</span>
        </div>
        <footer><button className="btn primary" onClick={close}>Concluir</button></footer>
      </div>
    </Modal>
  );
}

export function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  const confirm = useApp((s) => s.confirm);
  return (
    <>
      {dialog?.type === 'request' && <RequestDialog key={`${dialog.reqId}-${dialog.songId}`} songId={dialog.songId} reqId={dialog.reqId} />}
      {dialog?.type === 'song' && <SongDialog key={dialog.songId} songId={dialog.songId} />}
      {dialog?.type === 'settings' && <SettingsDialog />}
      {dialog?.type === 'importPath' && <ImportPathDialog />}
      {confirm && (
        <Modal title={confirm.title} onClose={() => confirm.resolve(false)}>
          <div className="form">
            <p className="confirm-text">{confirm.message}</p>
            <footer>
              <button className="btn" onClick={() => confirm.resolve(false)}>Cancelar</button>
              <button autoFocus className={`btn ${confirm.danger ? 'danger solid' : 'primary'}`} onClick={() => confirm.resolve(true)}>{confirm.confirmLabel}</button>
            </footer>
          </div>
        </Modal>
      )}
    </>
  );
}
