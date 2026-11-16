import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { requestNext } from './actions';
import { Dialogs } from './components/Dialogs';
import { Icon, Logo } from './components/icons';
import { LibraryPanel } from './components/LibraryPanel';
import { PlayerPanel } from './components/PlayerPanel';
import { QueuePanel } from './components/QueuePanel';
import { applyVolume, openAudience, seekBy, stop, toggle } from './player/engine';
import { restoreMics } from './player/mics';
import { fail, getState, loadAll, onAccent, setSongs, setState, toast, updateSettings, useApp } from './store';

/** Tela cheia do aplicativo: janela nativa no desktop, API do navegador no modo web. */
function toggleAppFullscreen() {
  if (window.kpDesktop) return void window.kpDesktop.toggleFullscreen();
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => undefined);
}

function useImportWatcher() {
  const status = useApp((s) => s.importStatus);
  const running = !!status?.running;
  useEffect(() => {
    if (!running) return;
    let seen = getState().importStatus?.version ?? 0;
    const t = setInterval(async () => {
      try {
        const st = await api.importStatus();
        setState({ importStatus: st });
        if (st.version !== seen) {
          seen = st.version;
          setSongs(await api.songs());
        }
        if (!st.running) {
          const parts = [`${st.added} adicionada(s)`];
          if (st.skipped) parts.push(`${st.skipped} já no catálogo`);
          if (st.duplicates) parts.push(`${st.duplicates} possível(is) duplicata(s)`);
          if (st.relocated) parts.push(`${st.relocated} realocada(s)`);
          if (st.missing) parts.push(`${st.missing} ausente(s)`);
          toast(`Biblioteca atualizada: ${parts.join(', ')}`, 'ok');
          if (st.errors.length) toast(`${st.errors.length} item(ns) ignorado(s). Ex.: ${st.errors[0].file} — ${st.errors[0].error}`, 'error');
        }
      } catch (e) {
        fail(e);
      }
    }, 600);
    return () => clearInterval(t);
  }, [running]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
      if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('#lib-search')?.focus();
        return;
      }
      if (e.key === 'F11' && window.kpDesktop) {
        e.preventDefault();
        toggleAppFullscreen();
        return;
      }
      if (typing || e.ctrlKey || e.altKey || e.metaKey || getState().dialog || getState().confirm) return;
      const s = getState();
      switch (e.key) {
        case ' ':
          e.preventDefault();
          toggle();
          break;
        case 'ArrowLeft':
          seekBy(-5);
          break;
        case 'ArrowRight':
          seekBy(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          updateSettings({ masterVolume: Math.min(1, s.settings.masterVolume + 0.05) });
          break;
        case 'ArrowDown':
          e.preventDefault();
          updateSettings({ masterVolume: Math.max(0, s.settings.masterVolume - 0.05) });
          break;
        case 's':
        case 'S':
          if (s.playback.mode !== 'idle') stop().catch(fail);
          break;
        case 'n':
        case 'N':
          requestNext();
          break;
        case 'p':
        case 'P':
          openAudience();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Splitter({ side }: { side: 'left' | 'right' }) {
  const onDown = (e: React.PointerEvent) => {
    const startX = e.clientX;
    const key = side === 'left' ? 'leftWidth' : 'rightWidth';
    const start = getState().settings[key];
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) * (side === 'left' ? 1 : -1);
      updateSettings({ [key]: Math.round(Math.min(720, Math.max(280, start + delta))) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
    };
    document.body.classList.add('resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className="splitter" onPointerDown={onDown} role="separator" aria-orientation="vertical" />;
}

export function App() {
  const ready = useApp((s) => s.ready);
  const settings = useApp((s) => s.settings);
  const audienceOpen = useApp((s) => s.audienceOpen);
  const importStatus = useApp((s) => s.importStatus);
  const toasts = useApp((s) => s.toasts);
  const [error, setError] = useState('');
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    loadAll()
      .then(restoreMics)
      .catch((e) => setError(e.message));
  }, []);
  useImportWatcher();
  useShortcuts();
  useEffect(() => applyVolume(), [settings.masterVolume]);

  if (error) return <div className="boot">Não foi possível conectar ao serviço local: {error}</div>;
  if (!ready) return <div className="boot">Carregando…</div>;

  const imp = importStatus?.running ? importStatus : null;
  return (
    <div className={`app ${settings.compact ? 'compact' : ''}`} style={{ ['--accent' as string]: settings.accent, ['--on-accent' as string]: onAccent(settings.accent) }}>
      <header className="topbar">
        <Logo />
        <div className="topbar-status">
          {imp && (
            <span className="pill busy">
              <i className="spin" />
              {imp.phase === 'metadata'
                ? `Lendo metadados ${imp.metaDone}/${imp.metaTotal}`
                : `Varrendo arquivos… ${imp.scanned}`}
            </span>
          )}
        </div>
        <button className={`btn ${audienceOpen ? 'on' : ''}`} onClick={openAudience} title="Abrir a tela do público (P)">
          <Icon name="screen" /> Tela do público
          <i className={`dot ${audienceOpen ? 'live' : ''}`} />
        </button>
        <button className="btn icon" onClick={toggleAppFullscreen} title="Tela cheia do aplicativo (F11)">
          <Icon name="expand" />
        </button>
        <button className="btn icon" onClick={() => setState({ dialog: { type: 'settings' } })} title="Configurações">
          <Icon name="gear" />
        </button>
      </header>

      <main className="panels" style={{ gridTemplateColumns: `${settings.leftWidth}px 6px minmax(360px, 1fr) 6px ${settings.rightWidth}px` }}>
        <LibraryPanel />
        <Splitter side="left" />
        <PlayerPanel />
        <Splitter side="right" />
        <QueuePanel />
      </main>

      <Dialogs />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </div>
  );
}
