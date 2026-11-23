// Tela do público: sem controles administrativos. Recebe o estado do operador por BroadcastChannel
// e mantém vídeo/letras alinhados ao relógio do operador.
import { useEffect, useRef, useState } from 'react';
import { CdgPlayer, loadCdg } from '../player/cdg';
import { warmYouTube, YT_PLAYING, YtPlayer } from '../player/youtube';
import type { AudienceState, ShownScore, SyncMessage } from '../types';
import { Icon } from '../components/icons';

/** Cor de texto legível sobre a cor de destaque. */
function onAccent(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#111111';
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#111111' : '#ffffff';
}

/** Nota da apresentação que acabou: o número sobe até a nota, com as três partes da avaliação. */
function ScoreCard({ score, next }: { score: ShownScore; next: AudienceState | null }) {
  const [shown, setShown] = useState(60);
  useEffect(() => {
    // "reduzir movimento" do Windows: a nota aparece pronta, sem contagem
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return void setShown(score.value);
    // temporizador (e não requestAnimationFrame): continua mesmo com a janela coberta por outra,
    // e calcula pelo tempo decorrido, então sempre termina no valor da nota
    const start = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - start) / 1800);
      setShown(Math.round(60 + (score.value - 60) * (1 - (1 - k) ** 3)));
      if (k >= 1) clearInterval(timer);
    };
    const timer = window.setInterval(step, 40);
    return () => clearInterval(timer);
  }, [score.value, score.until]);
  const done = shown === score.value;
  const parts: [string, number][] = [['Afinação', score.tuning], ['Presença', score.presence], ['Expressão', score.expression]];
  return (
    <div className="aud-score" key={score.until}>
      <div className="burst b1" />
      <div className="burst b2" />
      <span className="vin-label">Nota de</span>
      <strong className="score-singer">{score.singer}</strong>
      <div className={`score-value ${done ? 'done' : ''}`}>{shown}</div>
      <div className={`score-phrase ${done ? 'done' : ''}`}>{score.phrase}</div>
      <div className="score-parts">
        {parts.map(([label, v]) => (
          <div key={label}>
            <span>{label}</span>
            <i><b style={{ width: `${Math.round(v * 100)}%` }} /></i>
          </div>
        ))}
      </div>
      {next && (
        <div className="score-next">
          {next.countdown != null ? `Próximo em ${next.countdown}s: ` : 'A seguir: '}
          <strong>{next.nextSinger}</strong>
        </div>
      )}
    </div>
  );
}

const expectedTime = (s: AudienceState) => s.time + (s.status === 'playing' ? ((Date.now() - s.sentAt) / 1000) * s.rate : 0);

export function AudienceView() {
  const [s, setS] = useState<AudienceState | null>(null);
  const [needClick, setNeedClick] = useState(false);
  const [ui, setUi] = useState(false); // controles aparecem só enquanto o mouse se move
  const uiTimer = useRef<number | undefined>(undefined);
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
    let warmedFor: string | null = null; // vídeo cuja vinheta já adiantou o código do player
    let playAskedAt = 0; // quando o player foi criado para tocar

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
      if (st.mediaUrl && st.preparing) {
        if (video.getAttribute('src') !== st.mediaUrl) {
          video.preload = 'auto';
          video.src = st.mediaUrl;
          video.muted = true;
          video.load();
        }
        if (!video.paused) video.pause();
      } else if (st.mode === 'video' && st.mediaUrl) {
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
      if (st.cdgUrl) {
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

      // YouTube: único player ativo (com som) fica nesta janela.
      // Durante a vinheta não existe player: as regras do YouTube proíbem qualquer elemento na frente dele.
      // Só o código do player e a conexão são adiantados; o player é criado, visível, quando a vinheta acaba.
      if (st.ytHere && st.ytId && st.preparing) {
        if (ytFor) dropYt();
        if (warmedFor !== st.ytId) {
          const id = (warmedFor = st.ytId);
          warmYouTube()
            .then(() => post({ type: 'yt-ready', ytId: id }))
            .catch(() => post({ type: 'yt-error', ytId: id, code: -1 }));
        }
      } else if (st.ytHere && st.ytId && ytRef.current) {
        if (ytFor !== st.ytId) {
          dropYt();
          ytFor = st.ytId;
          playAskedAt = Date.now();
          ytRef.current.style.display = 'block'; // visível antes de criar o player
          const id = st.ytId;
          ytp = new YtPlayer(ytRef.current, id, st.time, true, {
            onState: (state) => {
              if (state === YT_PLAYING) setNeedClick(false);
              post({ type: 'yt', ytId: id, time: ytp?.time() ?? 0, duration: ytp?.duration() ?? 0, state });
            },
            onError: (code) => post({ type: 'yt-error', ytId: id, code }),
            onAutoplayBlocked: () => setNeedClick(true),
          });
        }
        ytp?.setVolume(st.volume);
        const state = ytp?.state() ?? -1;
        if (st.status === 'paused' && state === YT_PLAYING) ytp?.pause();
        if (st.status === 'playing' && state === 2) ytp?.play();
        // navegadores podem bloquear som automático em janelas novas
        if ((state === -1 || state === 5) && Date.now() - playAskedAt > 4000) setNeedClick(true);
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
      if (cdg && st && st.mode === 'cdg') cdg.render(expectedTime(st));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const tick = setInterval(() => {
      apply();
      if (ytp && ytFor) post({ type: 'yt', ytId: ytFor, time: ytp.time(), duration: ytp.duration(), state: ytp.state() === 0 ? -1 : ytp.state() });
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
    if (window.kpDesktop) return void window.kpDesktop.toggleFullscreen(); // janela nativa em tela cheia
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'F11' && window.kpDesktop) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape') window.kpDesktop?.setFullscreen(false); // no navegador o Esc já sai sozinho
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const wake = () => {
    setUi(true);
    clearTimeout(uiTimer.current);
    uiTimer.current = window.setTimeout(() => setUi(false), 2500);
  };

  const mode = s?.mode ?? 'idle';
  const yt = mode === 'youtube' && !!s?.ytHere;
  const intro = mode === 'intro';
  const idle = mode === 'idle' || (mode === 'youtube' && !s?.ytHere);
  const playing = !idle && !intro;
  const accent = s?.accent ?? '#d9e88a';
  const introPct = s && intro && s.duration > 0 ? Math.min(100, (expectedTime(s) / s.duration) * 100) : 0;

  return (
    <div
      className={`aud ${ui ? 'show-ui' : ''}`}
      style={{ ['--accent' as string]: accent, ['--on-accent' as string]: onAccent(accent) }}
      onDoubleClick={toggleFullscreen}
      onMouseMove={wake}
    >
      <div className="aud-stage">
        <video ref={videoRef} className="aud-media" style={{ display: mode === 'video' ? 'block' : 'none' }} playsInline muted />
        <canvas ref={canvasRef} className="aud-media aud-cdg" style={{ display: mode === 'cdg' ? 'block' : 'none' }} />
        <div ref={ytRef} className="aud-media yt-host" style={{ display: s?.ytHere && !s.preparing ? 'block' : 'none' }} />

        {mode === 'audio' && s && (
          <div className="aud-card">
            <div className="eq big"><i /><i /><i /><i /><i /><i /><i /></div>
            {s.singer && <div className="aud-singer">{s.singer}</div>}
          </div>
        )}

        {idle && s?.score && s.score.until > Date.now() && <ScoreCard score={s.score} next={s.showNext && s.nextSinger ? s : null} />}

        {idle && !(s?.score && s.score.until > Date.now()) && (
          <div className={`aud-wait ${s?.phoneQr && s.phoneOnWait ? 'with-qr' : ''}`}>
            <div className="burst b1" />
            <div className="burst b2" />
            {/* com o QR code ligado a tela vira duas colunas (título à esquerda, QR à direita): nada se sobrepõe */}
            <div className="aud-main">
              <div className="aud-wait-label">Prepare-se para o show</div>
              <div className="aud-wait-title">{s?.waitTitle || 'Karaoke Pro'}</div>
              {s && s.showNext && s.nextSinger && (
                <div className="aud-next">
                  <span>{s.countdown != null ? `Começa em ${s.countdown}s` : 'A seguir'}</span>
                  <strong>{s.nextSinger}</strong>
                  {s.nextTitle && <em>{s.nextTitle}</em>}
                </div>
              )}
            </div>
            {s?.phoneQr && s.phoneOnWait && (
              <div className="aud-qr">
                <img src={s.phoneQr} alt="QR code para pedir músicas pelo celular" />
                <strong>Peça sua música pelo celular</strong>
                <span>Aponte a câmera para o código{s.phoneHost ? ` ou abra ${s.phoneHost}` : ''} no Wi-Fi do local</span>
              </div>
            )}
            <div className="aud-wait-msg">{s ? s.waitMessage : 'Aguardando a tela do operador…'}</div>
          </div>
        )}

        {intro && s && (
          <div className="aud-vinheta" key={`${s.songId}-${s.singer}`}>
            <div className="burst b1" />
            <div className="burst b2" />
            <span className="vin-label">Agora no palco</span>
            <strong className="vin-singer">{s.singer}</strong>
            <div className="vin-song">
              <b>{s.title}</b>
              {s.artist && <em>{s.artist}</em>}
            </div>
            <div className="eq big dots"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
            <div className="vin-progress"><i style={{ transform: `scaleX(${introPct / 100})` }} /></div>
          </div>
        )}
      </div>

      {/* Faixa própria, abaixo do vídeo: nada é sobreposto ao player (regra do YouTube). */}
      {playing && s && (
        <div className={`aud-bar ${s.phoneQr && s.phoneOnSong ? 'with-qr' : ''}`}>
          <span>{s.title}</span>
          {yt && needClick && <b>Clique no vídeo para iniciar</b>}
          {s.phoneQr && s.phoneOnSong && (
            <div className="bar-qr">
              <div>
                <strong>Peça a próxima!</strong>
                <em>Aponte a câmera{s.phoneHost ? ` ou abra ${s.phoneHost}` : ''}</em>
              </div>
              <img src={s.phoneQr} alt="QR code para pedir músicas pelo celular" />
            </div>
          )}
        </div>
      )}

      <button className="aud-fs" onClick={toggleFullscreen} title="Tela cheia (F ou duplo clique)">
        <Icon name="expand" size={18} /> Tela cheia
      </button>
    </div>
  );
}
