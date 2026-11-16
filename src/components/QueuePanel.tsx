import { useMemo, useState } from 'react';
import { requestNext, requestStart } from '../actions';
import { api } from '../api';
import { stop } from '../player/engine';
import { confirmDialog, fail, fmtTime, orderedWaiting, setState, toast, updateSettings, useApp } from '../store';
import { Icon } from './icons';

const clock = (ts: number | null) => (ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

export function QueuePanel() {
  const requests = useApp((s) => s.requests);
  const songMap = useApp((s) => s.songMap);
  const fair = useApp((s) => s.settings.fairRotation);
  const playing = useApp((s) => s.playback.mode !== 'idle');
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  const waiting = useMemo(() => orderedWaiting(requests, fair), [requests, fair]);
  const current = requests.find((r) => r.status === 'singing');
  const history = useMemo(
    () => requests.filter((r) => r.status === 'done' || r.status === 'skipped').sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0)),
    [requests]
  );
  const currentSong = current ? songMap.get(current.song_id) : undefined;
  const set = (p: Promise<typeof requests>) => p.then((r) => setState({ requests: r })).catch(fail);

  const drop = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const ids = waiting.map((w) => w.req.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    set(api.reorder(ids));
  };
  const move = (id: number, delta: number) => {
    const ids = waiting.map((w) => w.req.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    set(api.reorder(ids));
  };
  const remove = async (id: number, singer: string) => {
    if (await confirmDialog({ title: 'Remover da fila?', message: `O pedido de ${singer} será removido.`, confirmLabel: 'Remover', danger: true })) {
      set(api.deleteRequest(id));
    }
  };
  const clearHistory = async () => {
    if (await confirmDialog({ title: 'Limpar o histórico?', message: 'Todas as apresentações concluídas deste evento serão apagadas. A rotação justa também recomeça.', confirmLabel: 'Limpar histórico', danger: true })) {
      set(api.clearHistory());
    }
  };

  return (
    <section className="panel">
      <div className="tabs">
        <button className={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}><Icon name="mic" size={15} /> Fila <i>{waiting.length}</i></button>
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>Histórico <i>{history.length}</i></button>
      </div>

      {tab === 'queue' ? (
        <>
          <div className={`current ${current ? 'live' : ''}`}>
            <span className="eyebrow">{current ? 'Cantando agora' : 'Palco livre'}</span>
            {current ? (
              <>
                <strong>{current.singer}</strong>
                <span className="sub">{currentSong?.title}{currentSong?.artist ? ` — ${currentSong.artist}` : ''}</span>
                <div className="current-actions">
                  <button className="btn sm" onClick={() => stop('done').catch(fail)} title="Encerrar e registrar no histórico"><Icon name="check" size={14} /> Concluir</button>
                  <button className="btn sm" onClick={() => stop('waiting').catch(fail)} title="Interromper e devolver o cantor à fila"><Icon name="undo" size={14} /> Devolver à fila</button>
                </div>
              </>
            ) : (
              <span className="sub">{waiting[0] ? `Próximo: ${waiting[0].req.singer}` : 'Nenhum cantor aguardando'}</span>
            )}
          </div>

          <div className="queue-actions">
            <button className="btn primary grow" onClick={requestNext} disabled={!waiting.length}>
              <Icon name="next" /> {playing ? 'Próximo cantor' : 'Iniciar próximo'}
            </button>
            <button className="btn" onClick={() => setState({ dialog: { type: 'request' } })} title="Cadastrar cantor e música"><Icon name="plus" /> Cantor</button>
          </div>
          <label className="check rotation" title="Prioriza quem ainda não cantou na rodada. Você ainda pode iniciar qualquer pedido manualmente.">
            <input type="checkbox" checked={fair} onChange={(e) => updateSettings({ fairRotation: e.target.checked })} /> Rotação justa
            {fair && <span className="hint">ordem calculada por rodada</span>}
          </label>

          <div className="vlist">
            {waiting.length === 0 && (
              <div className="empty">
                <strong>Fila vazia</strong>
                <p>Clique em + ao lado de uma música da biblioteca para adicioná-la à fila de um cantor.</p>
              </div>
            )}
            {waiting.map(({ req, round }, i) => {
              const song = songMap.get(req.song_id);
              return (
                <div
                  key={req.id}
                  className={`row q ${dragId === req.id ? 'dragging' : ''} ${overId === req.id && dragId !== req.id ? 'over' : ''} ${i === 0 ? 'next' : ''}`}
                  draggable={!fair}
                  onDragStart={(e) => { setDragId(req.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { if (dragId != null) { e.preventDefault(); setOverId(req.id); } }}
                  onDrop={(e) => { e.preventDefault(); drop(req.id); }}
                  onDragEnd={() => { setDragId(null); setOverId(null); }}
                >
                  <span className={`grip ${fair ? 'off' : ''}`} title={fair ? 'Desative a rotação justa para reordenar manualmente' : 'Arraste para reordenar'}><Icon name="grip" size={14} /></span>
                  <span className="pos">{i + 1}</span>
                  <div className="song-main">
                    <div className="t">{req.singer}{fair && <span className="badge round">R{round}</span>}</div>
                    <div className="a">
                      {song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''} · ${fmtTime(song.duration)}` : 'Música removida'}
                      {song?.missing ? <span className="badge danger">ausente</span> : null}
                    </div>
                  </div>
                  {!fair && (
                    <span className="updown">
                      <button className="ghost" onClick={() => move(req.id, -1)} disabled={i === 0} title="Subir">▲</button>
                      <button className="ghost" onClick={() => move(req.id, 1)} disabled={i === waiting.length - 1} title="Descer">▼</button>
                    </span>
                  )}
                  <button className="ghost" onClick={() => setState({ dialog: { type: 'request', reqId: req.id } })} title="Editar pedido"><Icon name="edit" size={15} /></button>
                  <button className="ghost" onClick={() => remove(req.id, req.singer)} title="Remover da fila"><Icon name="x" size={15} /></button>
                  <button className="add" onClick={() => requestStart(req.id)} title="Iniciar este cantor (pede confirmação)"><Icon name="play" size={14} /></button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div className="vlist">
            {history.length === 0 && <div className="empty"><strong>Nenhuma apresentação ainda</strong><p>As músicas executadas neste evento aparecem aqui.</p></div>}
            {history.map((r) => {
              const song = songMap.get(r.song_id);
              return (
                <div key={r.id} className="row q done">
                  <span className="pos time">{clock(r.ended_at)}</span>
                  <div className="song-main">
                    <div className="t">{r.singer}{r.status === 'skipped' && <span className="badge">pulado</span>}</div>
                    <div className="a">{song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''}` : 'Música removida'}</div>
                  </div>
                  {song && (
                    <button className="ghost" title="Colocar de novo na fila" onClick={() => set(api.addRequest(r.singer, r.song_id)).then(() => toast(`${r.singer} voltou para a fila`, 'ok'))}>
                      <Icon name="undo" size={15} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="panel-foot">
            <span>{history.length} apresentação(ões)</span>
            <span className="grow" />
            <button className="btn sm" onClick={clearHistory} disabled={!history.length}><Icon name="trash" size={14} /> Limpar</button>
          </div>
        </>
      )}
    </section>
  );
}
