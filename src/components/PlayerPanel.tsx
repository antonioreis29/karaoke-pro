import { useEffect, useRef } from 'react';
import { requestNext } from '../actions';
import { api } from '../api';
import { applyVolume, cancelCountdown, seek, seekBy, setRate, stop, surfaces, toggle } from '../player/engine';
import { fail, fmtTime, orderedWaiting, updateSettings, upsertSong, useApp } from '../store';
import { fmtLabel } from './LibraryPanel';
import { Icon } from './icons';

function Progress({ time, duration, disabled }: { time: number; duration: number; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
  };
  const onDown = (e: React.PointerEvent) => {
    if (disabled || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(at(e.clientX));
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.buttons === 1 && !disabled && duration && e.currentTarget.hasPointerCapture(e.pointerId)) seek(at(e.clientX));
  };
  return (
    <div className="progress-row">
      <span className="time">{fmtTime(disabled ? null : time)}</span>
      <div
        ref={ref}
        className={`progress ${disabled ? 'disabled' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        role="slider"
        aria-label="Posição da música"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(time)}
      >
        <div className="fill" style={{ width: `${pct}%` }} />
        <div className="knob" style={{ left: `${pct}%` }} />
      </div>
      <span className="time right">{disabled || !duration ? '--:--' : `-${fmtTime(Math.max(0, duration - time))}`}</span>
    </div>
  );
}

let volTimer: number | undefined;

export function PlayerPanel() {
  const pb = useApp((s) => s.playback);
  const songMap = useApp((s) => s.songMap);
  const settings = useApp((s) => s.settings);
  const requests = useApp((s) => s.requests);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = stage.current!;
    el.prepend(surfaces.video, surfaces.canvas, surfaces.ytHost);
    return () => {
      surfaces.video.remove();
      surfaces.canvas.remove();
      surfaces.ytHost.remove();
    };
  }, []);

  const song = pb.songId != null ? songMap.get(pb.songId) : undefined;
  const idle = pb.mode === 'idle';
  const next = orderedWaiting(requests, settings.fairRotation)[0]?.req;
  const nextSong = next ? songMap.get(next.song_id) : undefined;
  const ytRemote = pb.mode === 'youtube' && pb.ytHost === 'audience';
  const rateOk = !idle && pb.mode !== 'youtube';

  const setSongVolume = (v: number) => {
    if (!song) return;
    upsertSong({ ...song, volume: v });
    applyVolume();
    clearTimeout(volTimer);
    volTimer = window.setTimeout(() => api.patchSong(song.id, { volume: v }).catch(fail), 400);
  };

  const statusLabel = idle ? 'Parado' : pb.status === 'loading' ? 'Carregando' : pb.status === 'paused' ? 'Pausado' : 'No ar';

  return (
    <section className="panel center">
      <div ref={stage} className={`stage mode-${pb.mode} ${ytRemote ? 'yt-remote' : ''}`}>
        {idle && (
          <div className="stage-overlay">
            {pb.countdown != null && next ? (
              <>
                <span className="eyebrow">Avanço automático</span>
                <strong>{next.singer} em {pb.countdown}s</strong>
                <button className="btn sm" onClick={cancelCountdown}>Cancelar</button>
              </>
            ) : (
              <>
                <Icon name="mic" size={34} />
                <strong>Nenhuma música em reprodução</strong>
                <span>{next ? `Próximo: ${next.singer} — ${nextSong?.title ?? ''}` : 'Adicione cantores à fila para começar'}</span>
              </>
            )}
          </div>
        )}
        {pb.mode === 'audio' && (
          <div className="stage-overlay">
            <div className={`eq ${pb.status === 'playing' ? '' : 'still'}`}><i /><i /><i /><i /><i /></div>
            <span>Somente áudio — sem vídeo ou letra neste arquivo</span>
          </div>
        )}
        {ytRemote && (
          <div className="stage-overlay" style={song?.thumb ? { backgroundImage: `linear-gradient(#000c,#000c),url(${song.thumb})` } : undefined}>
            <Icon name="screen" size={30} />
            <strong>Reproduzindo na tela do público</strong>
            <span>O vídeo do YouTube toca em um único player oficial.</span>
          </div>
        )}
        <span className={`live-tag s-${idle ? 'idle' : pb.status}`}>{statusLabel}</span>
      </div>

      <div className="now">
        <div className="now-main">
          <div className="now-title">{song?.title ?? '—'}</div>
          <div className="now-artist">{song ? song.artist || 'Artista desconhecido' : 'Selecione um cantor na fila'}</div>
        </div>
        {song && <span className={`badge f-${song.format}`}>{fmtLabel(song.format)}</span>}
        {pb.singer && <span className="singer-chip"><Icon name="mic" size={14} /> {pb.singer}</span>}
      </div>

      <Progress time={pb.time} duration={pb.duration} disabled={idle} />

      <div className="transport">
        <button className="tbtn" onClick={() => seekBy(-10)} disabled={idle} title="Voltar 10 s (← volta 5 s)"><Icon name="back" size={18} /><small>10</small></button>
        <button className="tbtn" onClick={() => stop().catch(fail)} disabled={idle} title="Parar e concluir a apresentação (S)"><Icon name="stop" size={18} /></button>
        <button className="tbtn main" onClick={toggle} disabled={idle} title="Play / Pause (Espaço)">
          <Icon name={pb.status === 'playing' || pb.status === 'loading' ? 'pause' : 'play'} size={24} />
        </button>
        <button className="tbtn" onClick={() => seekBy(10)} disabled={idle} title="Avançar 10 s (→ avança 5 s)"><small>10</small><Icon name="fwd" size={18} /></button>
        <button className="tbtn wide" onClick={requestNext} disabled={!next && idle} title="Próximo cantor (N)"><Icon name="next" size={18} /> Próxima</button>
      </div>

      <div className="mixer">
        <label>
          <span><Icon name="vol" size={14} /> Volume geral</span>
          <input type="range" min={0} max={1} step={0.01} value={settings.masterVolume} onChange={(e) => updateSettings({ masterVolume: +e.target.value })} />
          <b>{Math.round(settings.masterVolume * 100)}%</b>
        </label>
        <label className={song ? '' : 'off'}>
          <span>Volume desta música</span>
          <input type="range" min={0} max={1} step={0.01} value={song?.volume ?? 1} disabled={!song} onChange={(e) => setSongVolume(+e.target.value)} />
          <b>{Math.round((song?.volume ?? 1) * 100)}%</b>
        </label>
        <label className={rateOk ? '' : 'off'} title={pb.mode === 'youtube' ? 'Indisponível para vídeos do YouTube' : 'Altera o andamento preservando o tom'}>
          <span>Velocidade</span>
          <input type="range" min={0.75} max={1.25} step={0.01} value={pb.rate} disabled={!rateOk} onChange={(e) => setRate(+e.target.value)} onDoubleClick={() => setRate(1)} />
          <b>{Math.round(pb.rate * 100)}%</b>
        </label>
        <div className="mixer-toggles">
          <label className="check" title="Ao terminar uma música, inicia o próximo cantor após a contagem">
            <input type="checkbox" checked={settings.autoAdvance} onChange={(e) => updateSettings({ autoAdvance: e.target.checked })} /> Avanço automático
          </label>
          <span className="hint">Espaço · ←/→ · ↑/↓ · S · N · P</span>
        </div>
      </div>
    </section>
  );
}
