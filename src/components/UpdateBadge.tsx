// Atualização automática: aviso de versão nova na barra de cima e a seção "Sobre" das configurações.
// O download acontece sozinho; a instalação espera o operador (ou o fechamento do app), para nunca
// interromper uma apresentação.
import { useEffect, useState } from 'react';
import { confirmDialog, getState } from '../store';
import type { UpdateInfo } from '../types';

declare const __APP_VERSION__: string;
export const APP_VERSION = __APP_VERSION__;
const RELEASES_URL = 'https://github.com/antonioreis29/karaoke-pro/releases';

/** Estado da atualização, ou null fora do app desktop (modo web). */
export function useUpdate(): UpdateInfo | null {
  const [u, setU] = useState<UpdateInfo | null>(null);
  const desktop = window.kpDesktop;
  useEffect(() => {
    if (!desktop?.onUpdate) return;
    desktop.updateStatus().then(setU).catch(() => undefined);
    return desktop.onUpdate(setU);
  }, [desktop]);
  return u;
}

async function installUpdate(version: string) {
  const live = getState().playback.mode !== 'idle';
  const ok = await confirmDialog({
    title: `Atualizar para a versão ${version}?`,
    message: `${live ? 'Há uma música tocando agora. ' : ''}O app vai fechar, instalar a versão nova e abrir de novo em alguns segundos. A fila, o catálogo e as configurações são mantidos.`,
    confirmLabel: 'Reiniciar e atualizar',
  });
  if (ok) await window.kpDesktop?.installUpdate();
}

export function UpdateBadge() {
  const u = useUpdate();
  if (u?.state === 'downloading') {
    return (
      <span className="pill busy" title="A versão nova é baixada em segundo plano">
        <i className="spin" /> Baixando versão {u.version}… {u.percent}%
      </span>
    );
  }
  if (u?.state !== 'ready') return null;
  return (
    <button className="pill update" onClick={() => installUpdate(u.version)} title="Se preferir, a atualização também é instalada quando você fechar o app">
      Versão {u.version} pronta · reiniciar e atualizar
    </button>
  );
}

const clock = (t: number) => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

function statusText(u: UpdateInfo): string {
  if (u.state === 'checking') return 'Procurando atualizações…';
  if (u.state === 'downloading') return `Baixando a versão ${u.version}… ${u.percent}%`;
  if (u.state === 'ready') return `A versão ${u.version} já foi baixada e está pronta para instalar.`;
  if (u.error) return 'Não foi possível consultar o GitHub agora. Verifique a internet e tente de novo.';
  if (u.upToDate) return `Você está com a versão mais recente (verificado às ${clock(u.checkedAt)}).`;
  return 'O app procura versões novas ao abrir e a cada 4 horas.';
}

/** Seção "Sobre" das configurações: versão em uso e verificação manual de atualizações. */
export function AboutSection() {
  const u = useUpdate();
  const busy = u?.state === 'checking' || u?.state === 'downloading';
  return (
    <div className="about">
      <div className="about-version">
        Karaoke Pro <b>versão {u?.current || APP_VERSION}</b>
      </div>
      {u?.enabled ? (
        <>
          <p className={`about-status ${u.error && u.state === 'idle' ? 'warn' : ''}`} aria-live="polite">{statusText(u)}</p>
          <div className="about-actions">
            {u.state === 'ready' ? (
              <button type="button" className="btn primary sm" onClick={() => installUpdate(u.version)}>Reiniciar e atualizar</button>
            ) : (
              <button type="button" className="btn sm" disabled={busy} onClick={() => window.kpDesktop?.checkUpdate()}>
                {busy ? 'Procurando…' : 'Procurar atualizações agora'}
              </button>
            )}
            <button type="button" className="btn sm" onClick={() => window.open(RELEASES_URL)}>Ver novidades de cada versão</button>
          </div>
        </>
      ) : (
        <p className="hint">A atualização automática funciona no app instalado pelo instalador do GitHub.</p>
      )}
    </div>
  );
}
