// Aviso de versão nova na barra de cima. O download acontece sozinho; a instalação espera o operador
// (ou o fechamento do app), para nunca interromper uma apresentação.
import { useEffect, useState } from 'react';
import { confirmDialog, getState } from '../store';
import type { UpdateInfo } from '../types';

export function UpdateBadge() {
  const [u, setU] = useState<UpdateInfo | null>(null);
  const desktop = window.kpDesktop;

  useEffect(() => {
    if (!desktop?.onUpdate) return;
    desktop.updateStatus().then(setU).catch(() => undefined);
    return desktop.onUpdate(setU);
  }, [desktop]);

  if (!desktop || !u || u.state === 'idle') return null;
  if (u.state === 'downloading') {
    return (
      <span className="pill busy" title="A versão nova é baixada em segundo plano">
        <i className="spin" /> Baixando versão {u.version}… {u.percent}%
      </span>
    );
  }
  const install = async () => {
    const live = getState().playback.mode !== 'idle';
    const ok = await confirmDialog({
      title: `Atualizar para a versão ${u.version}?`,
      message: `${live ? 'Há uma música tocando agora. ' : ''}O app vai fechar, instalar a versão nova e abrir de novo em alguns segundos. A fila, o catálogo e as configurações são mantidos.`,
      confirmLabel: 'Reiniciar e atualizar',
    });
    if (ok) await desktop.installUpdate();
  };
  return (
    <button className="pill update" onClick={install} title="Se preferir, a atualização também é instalada quando você fechar o app">
      Versão {u.version} pronta · reiniciar e atualizar
    </button>
  );
}
