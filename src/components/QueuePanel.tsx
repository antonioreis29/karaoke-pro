import { useMemo, useRef, useState } from 'react';
import { requestNext, requestStart } from '../actions';
import { api } from '../api';
import { stop } from '../player/engine';
import { verifyQueue } from '../player/ytcheck';
import { confirmDialog, fail, fmtTime, orderedWaiting, setState, toast, updateSettings, useApp } from '../store';
import { Icon } from './icons';

const clock = (ts: number | null) => (ts ? new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');

export function QueuePanel() {
  const requests = useApp((s) => s.requests);
  const songMap = useApp((s) => s.songMap);
  const fair = useApp((s) => s.settings.fairRotation);
  const ytCheck = useApp((s) => s.ytCheck);
  const ytNetwork = useApp((s) => s.ytNetwork);
  const playing = useApp((s) => s.playback.mode !== 'idle');
  const [tab, setTab] = useState<'queue' | 'history'>('queue');
  const [drag, setDrag] = useState<{ id: number; dy: number; index: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const waiting = useMemo(() => orderedWaiting(requests, fair), [requests, fair]);
  const current = requests.find((r) => r.status === 'singing');
  const history = useMemo(
    () => requests.filter((r) => r.status === 'done' || r.status === 'skipped').sort((a, b) => (b.ended_at ?? 0) - (a.ended_at ?? 0)),
    [requests]
  );
  const currentSong = current ? songMap.get(current.song_id) : undefined;
  const pending = useMemo(() => requests.filter((r) => r.status === 'pending').sort((a, b) => a.created_at - b.created_at), [requests]);
  const approveAll = async () => {
    try {
      let list = requests;
      for (const r of pending) list = await api.patchRequest(r.id, { status: 'waiting' });
      setState({ requests: list });
    } catch (e) {
      fail(e);
    }
  };
  const set = (p: Promise<typeof requests>) => p.then((r) => setState({ requests: r })).catch(fail);

  /** Aplica a nova ordem. Com a rotação justa ligada, a ordem manual passa a valer e a rotação é desligada. */
  const applyOrder = (ids: number[]) => {
    if (fair) {
      updateSettings({ fairRotation: false });
      toast('Rotação justa desligada para manter a ordem que você definiu');
    }
    // atualização imediata na tela; o servidor confirma em seguida
    const pos = new Map(ids.map((id, i) => [id, i + 1]));
    setState({ requests: requests.map((r) => (pos.has(r.id) ? { ...r, position: pos.get(r.id)! } : r)) });
    set(api.reorder(ids));
  };

  /** Arrastar com o mouse (ou toque) em qualquer ponto da linha. */
  const onRowDown = (e: React.PointerEvent, id: number) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const startY = e.clientY;
    const list = listRef.current!;
    const order = waiting.map((w) => w.req.id);
    const from = order.indexOf(id);
    let active = false;
    let index = from;
    const indexAt = (y: number) => {
      const rows = [...list.querySelectorAll<HTMLElement>('[data-req]')];
      let i = 0;
      for (const row of rows) {
        if (Number(row.dataset.req) === id) continue;
        const r = row.getBoundingClientRect();
        if (y > r.top + r.height / 2) i++;
      }
      return i;
    };
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!active && Math.abs(dy) < 6) return;
      active = true;
      index = indexAt(ev.clientY);
      const box = list.getBoundingClientRect();
      if (ev.clientY < box.top + 30) list.scrollTop -= 12;
      if (ev.clientY > box.bottom - 30) list.scrollTop += 12;
      setDrag({ id, dy, index });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.body.classList.remove('dragging');
      setDrag(null);
      if (!active || index === from) return;
      const ids = order.filter((x) => x !== id);
      ids.splice(index, 0, id);
      applyOrder(ids);
    };
    document.body.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
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

  // onde a linha arrastada vai cair: marca a linha que ficará logo abaixo (ou a última, se for para o fim)
  const others = drag ? waiting.filter((w) => w.req.id !== drag.id) : [];
  const gapBefore = (id: number, _i: number) => {
    if (!drag || id === drag.id) return '';
    const k = others.findIndex((w) => w.req.id === id);
    if (k === drag.index) return 'drop-before';
    if (drag.index >= others.length && k === others.length - 1) return 'drop-after';
    return '';
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

          {pending.length > 0 && (
            <div className="pending">
              <div className="pending-head">
                <span className="eyebrow"><Icon name="phone" size={12} /> Pedidos pelo celular · {pending.length}</span>
                <button className="btn sm" onClick={approveAll}>Aceitar todos</button>
              </div>
              {pending.map((r) => {
                const song = songMap.get(r.song_id);
                return (
                  <div key={r.id} className="pending-row">
                    <div className="song-main">
                      <div className="t">{r.singer}</div>
                      <div className="a">{song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''}` : 'Música removida'}</div>
                    </div>
                    <button className="ghost" onClick={() => set(api.deleteRequest(r.id))} title="Recusar este pedido"><Icon name="x" size={15} /></button>
                    <button className="add" onClick={() => set(api.patchRequest(r.id, { status: 'waiting' }))} title="Aceitar: entra no fim da fila"><Icon name="check" size={15} /></button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="queue-actions">
            <button className="btn primary grow" onClick={requestNext} disabled={!waiting.length}>
              <Icon name="next" /> {playing ? 'Próximo cantor' : 'Iniciar próximo'}
            </button>
            <button className="btn" onClick={() => setState({ dialog: { type: 'request' } })} title="Cadastrar cantor e música"><Icon name="plus" /> Cantor</button>
          </div>
          <label className="check rotation" title="Prioriza quem ainda não cantou na rodada. Você ainda pode iniciar qualquer pedido manualmente.">
            <input type="checkbox" checked={fair} onChange={(e) => updateSettings({ fairRotation: e.target.checked })} /> Rotação justa
            {fair && <span className="hint">arrastar um pedido volta para a ordem manual</span>}
          </label>
          {waiting.some(({ req }) => songMap.get(req.song_id)?.source === 'youtube') && (
            <div className="yt-verify">
              {ytNetwork && (
                <div className="yt-warn">
                  <strong>O YouTube está recusando os vídeos nesta conexão</strong>
                  <p>Ele está pedindo "confirme que você não é um robô" para esta internet. Não é problema das músicas nem do app, e trocar de vídeo não resolve. Costuma passar sozinho em algumas horas; outra rede (por exemplo, o 4G do celular) também resolve. Arquivos locais tocam normalmente.</p>
                </div>
              )}
              <button className="btn sm" onClick={() => verifyQueue(true)} disabled={!!ytCheck} title="Testa na prévia, sem som, se cada vídeo do YouTube da fila toca, e troca os bloqueados por outra versão">
                {ytCheck ? 'Verificando…' : ytNetwork ? 'Testar o YouTube de novo' : 'Verificar vídeos do YouTube'}
              </button>
            </div>
          )}

          <div className="vlist" ref={listRef}>
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
                  data-req={req.id}
                  className={`row q ${drag?.id === req.id ? 'dragging' : ''} ${i === 0 ? 'next' : ''} ${gapBefore(req.id, i)}`}
                  style={drag?.id === req.id ? { transform: `translateY(${drag.dy}px)` } : undefined}
                  onPointerDown={(e) => onRowDown(e, req.id)}
                >
                  <span className="grip" title="Arraste para reordenar"><Icon name="grip" size={14} /></span>
                  <span className="pos">{i + 1}</span>
                  <div className="song-main">
                    <div className="t">{req.singer}{fair && <span className="badge round">R{round}</span>}{req.source === 'phone' && <span className="badge" title="Pedido feito pelo celular">celular</span>}{song?.blocked ? <span className="badge danger" title="Vídeo bloqueado pelo YouTube: troque a música deste pedido">vídeo bloqueado</span> : null}{song?.source === 'youtube' && !song.blocked && song.checked_at ? <span className="badge ok" title="Este vídeo tocou na verificação">verificado</span> : null}</div>
                    <div className="a">
                      {song ? `${song.title}${song.artist ? ` — ${song.artist}` : ''} · ${fmtTime(song.duration)}` : 'Música removida'}
                      {song?.missing ? <span className="badge danger">ausente</span> : null}
                    </div>
                  </div>
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
