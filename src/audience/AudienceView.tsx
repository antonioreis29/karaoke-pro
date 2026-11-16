// Tela do público: sem controles administrativos. Recebe o estado do operador por BroadcastChannel
// e mantém vídeo/letras alinhados ao relógio do operador.
import { useEffect, useRef, useState } from 'react';
import { CdgPlayer, loadCdg } from '../player/cdg';
import { YT_PLAYING, YtPlayer } from '../player/youtube';
import type { AudienceState, SyncMessage } from '../types';

const expectedTime = (s: AudienceState) => s.time + (s.status === 'playing' ? ((Date.now() - s.sentAt) / 1000) * s.rate : 0);

export function AudienceView() {
  const [s, setS] = useState<AudienceState | null>(null);
  const [needClick, setNeedClick] = useState(false);
  const latest = useRef<AudienceState | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ytRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Karaoke Pro — Tela do público';
    const channel = new BroadcastChannel('karaoke-pro');
    const post = (m: SyncMessage) => channel.postMessage(m);
    let cdg: CdgPlayer | null = null;
    let cdgFor: string | null = null;
    let ytp: YtPlayer | null = null;
    let ytFor: string | null = null;
    let ytStartedAt = 0;

    const dropYt = () => {
      ytp?.destroy();
      ytp = null;
      ytFor = null;
      ytRef.current?.replaceChildren();
      setNeedClick(false);
    };

    const apply = () => {
      const st = latest.current;
      const video = videoRef.current;
      if (!st || !video) return;

      // vídeo local: cópia muda, alinhada ao áudio do operador
      if (st.mode === 'video' && st.mediaUrl) {
        if (video.getAttribute('src') !== st.mediaUrl) {
          video.src = st.mediaUrl;
          video.muted = true;
        }
        const want = expectedTime(st);
        if (video.readyState >= 1 && Math.abs(video.currentTime - want) > 0.3) video.currentTime = want;
        if (video.playbackRate !== st.rate) video.playbackRate = st.rate;
        if (st.status === 'playing' && video.paused) video.play().catch(() => undefined);
        if (st.status !== 'playing' && !video.paused) video.pause();
      } else if (video.getAttribute('src')) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }

      // CDG: desenhado a partir do relógio do operador
      if (st.mode === 'cdg' && st.cdgUrl) {
        if (cdgFor !== st.cdgUrl && canvasRef.current) {
          const url = (cdgFor = st.cdgUrl);
          cdg = null;
          loadCdg(url, canvasRef.current)
            .then((p) => {
              if (cdgFor === url) cdg = p;
            })
            .catch(() => undefined);
        }
      } else {
        cdg = null;
        cdgFor = null;
      }

      // YouTube: único player ativo (com som) fica nesta janela
      if (st.mode === 'youtube' && st.ytHere && st.ytId && ytRef.current) {
        if (ytFor !== st.ytId) {
          dropYt();
          ytFor = st.ytId;
          ytStartedAt = Date.now();
          ytp = new YtPlayer(ytRef.current, st.ytId, st.time, false, {
            onState: (state) => {
              if (state === YT_PLAYING) setNeedClick(false);
              post({ type: 'yt', time: ytp?.time() ?? 0, duration: ytp?.duration() ?? 0, state });
            },
            onError: (code) => post({ type: 'yt-error', code }),
          });
        }
        ytp?.setVolume(st.volume);
        const state = ytp?.state() ?? -1;
        if (st.status === 'paused' && state === YT_PLAYING) ytp?.pause();
        if (st.status === 'playing' && state === 2) ytp?.play();
        // navegadores podem bloquear som automático em janelas novas
        if ((state === -1 || state === 5) && Date.now() - ytStartedAt > 4000) setNeedClick(true);
      } else if (ytFor) dropYt();
    };

    channel.onmessage = (ev: MessageEvent<SyncMessage>) => {
      const m = ev.data;
      if (m.type === 'state') {
        latest.current = m.s;
        setS(m.s);
        apply();
      } else if (m.type === 'seek') ytp?.seek(m.time);
    };

    let raf = 0;
    const frame = () => {
      const st = latest.current;
      if (cdg && st) cdg.render(expectedTime(st));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const tick = setInterval(() => {
      apply();
      if (ytp) post({ type: 'yt', time: ytp.time(), duration: ytp.duration(), state: ytp.state() === 0 ? -1 : ytp.state() });
    }, 250);
    const alive = setInterval(() => post({ type: 'alive' }), 1500);
    const bye = () => post({ type: 'bye' });
    window.addEventListener('pagehide', bye);
    post({ type: 'hello' });

    return () => {
      bye();
      window.removeEventListener('pagehide', bye);
      clearInterval(tick);
      clearInterval(alive);
      cancelAnimationFrame(raf);
      dropYt();
      channel.close();
    };
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };

  const mode = s?.mode ?? 'idle';
  const yt = mode === 'youtube' && !!s?.ytHere;
  const idle = mode === 'idle' || (mode === 'youtube' && !s?.ytHere);
  const intro = !!s && !idle && !yt && s.singer && s.time < 8;

  return (
    <div className="aud" style={{ ['--accent' as string]: s?.accent ?? '#3b82f6' }} onDoubleClick={toggleFullscreen}>
      <div className={`aud-stage ${yt ? 'with-bar' : ''}`}>
        <video ref={videoRef} className="aud-media" style={{ display: mode === 'video' ? 'block' : 'none' }} playsInline muted />
        <canvas ref={canvasRef} className="aud-media aud-cdg" style={{ display: mode === 'cdg' ? 'block' : 'none' }} />
        <div ref={ytRef} className="aud-media yt-host" style={{ display: yt ? 'block' : 'none' }} />

        {mode === 'audio' && s && (
          <div className="aud-card">
            <div className="eq big"><i /><i /><i /><i /><i /></div>
            {s.singer && <div className="aud-singer">{s.singer}</div>}
            <div className="aud-song">{s.title}</div>
            {s.artist && <div className="aud-artist">{s.artist}</div>}
          </div>
        )}

        {idle && (
          <div className="aud-wait">
            <div className="aud-glow" />
            <div className="aud-wait-title">{s?.waitTitle || 'Karaoke Pro'}</div>
            <div className="aud-wait-msg">{s ? s.waitMessage : 'Aguardando a tela do operador…'}</div>
            {s && s.showNext && s.nextSinger && (
              <div className="aud-next">
                <span>{s.countdown != null ? `Começa em ${s.countdown}s` : 'A seguir'}</span>
                <strong>{s.nextSinger}</strong>
                {s.nextTitle && <em>{s.nextTitle}</em>}
              </div>
            )}
          </div>
        )}

        {intro && s && (
          <div className="aud-intro">
            <span>Cantando agora</span>
            <strong>{s.singer}</strong>
            <em>{s.title}{s.artist ? ` — ${s.artist}` : ''}</em>
          </div>
        )}
      </div>

      {/* No YouTube nada é sobreposto ao player: as informações ficam em uma faixa separada. */}
      {yt && s && (
        <div className="aud-bar">
          {s.singer && <strong>{s.singer}</strong>}
          <span>{s.title}{s.artist ? ` — ${s.artist}` : ''}</span>
          {needClick && <b>Clique no vídeo para iniciar</b>}
          {s.showNext && s.nextSinger && <em>A seguir: {s.nextSinger}</em>}
        </div>
      )}
    </div>
  );
}
