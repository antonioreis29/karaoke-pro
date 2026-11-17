// Conta do YouTube na sessão do app: quando o player pede "faça login para confirmar que você não é um robô",
// o operador entra pela página oficial do Google. O app nunca vê nem guarda a senha.
import { useEffect, useState } from 'react';
import { verifyQueue } from '../player/ytcheck';
import { confirmDialog, getState, toast } from '../store';

export function YouTubeAccount({ compact = false }: { compact?: boolean }) {
  const desktop = window.kpDesktop;
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    desktop?.youtubeStatus().then(setSignedIn).catch(() => setSignedIn(false));
  }, [desktop]);

  if (!desktop) {
    return <p className="hint">No modo web, o player usa a conta do YouTube do próprio navegador: entre no YouTube no Chrome ou no Edge.</p>;
  }

  const login = async () => {
    setBusy(true);
    try {
      const ok = await desktop.youtubeLogin();
      setSignedIn(ok);
      if (ok) {
        toast('Conta do YouTube conectada ao app', 'ok');
        if (getState().ytNetwork) verifyQueue(true); // testa de novo os vídeos da fila
      } else toast('O login no YouTube não foi concluído');
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const ok = await confirmDialog({
      title: 'Sair da conta do YouTube?',
      message: 'O app deixa de usar a sua conta no player do YouTube. Isso não afeta o YouTube no seu navegador.',
      confirmLabel: 'Sair',
    });
    if (!ok) return;
    setBusy(true);
    try {
      setSignedIn(await desktop.youtubeLogout());
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`yt-account ${compact ? 'compact' : ''}`}>
      {!compact && (
        <span className="hint">
          {signedIn == null ? 'Verificando a conta do YouTube…' : signedIn ? 'Conta do YouTube conectada ao app.' : 'Nenhuma conta do YouTube conectada ao app.'}
          {' '}Entrar ajuda quando o player pede “confirme que você não é um robô”. O login é feito na página oficial do Google; o app não vê a sua senha.
        </span>
      )}
      {signedIn ? (
        !compact && <button type="button" className="btn sm" onClick={logout} disabled={busy}>Sair da conta</button>
      ) : (
        <button type="button" className="btn sm primary" onClick={login} disabled={busy || signedIn == null}>
          {busy ? 'Aguardando o login…' : 'Entrar no YouTube'}
        </button>
      )}
    </div>
  );
}
