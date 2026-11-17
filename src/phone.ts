// Lado do operador dos pedidos pelo celular: estado do servidor da rede local, QR code e aviso de novos pedidos.
import QRCode from 'qrcode';
import { useEffect } from 'react';
import { api } from './api';
import { fail, getState, setSongs, setState, toast, useApp } from './store';
import type { PhoneInfo } from './types';

let qrFor: string | null = null;

async function applyInfo(info: PhoneInfo) {
  setState({ phone: info });
  if (!info.url) {
    qrFor = null;
    return setState({ phoneQr: null });
  }
  if (info.url === qrFor) return;
  qrFor = info.url;
  const qr = await QRCode.toDataURL(info.url, {
    margin: 1,
    width: 480,
    errorCorrectionLevel: 'M',
    color: { dark: '#111110ff', light: '#f4f0e1ff' },
  });
  if (qrFor === info.url) setState({ phoneQr: qr });
}

export async function refreshPhone() {
  try {
    await applyInfo(await api.phone());
  } catch (e) {
    fail(e);
  }
}

export async function setPhone(patch: Parameters<typeof api.setPhone>[0]) {
  try {
    const info = await api.setPhone(patch);
    await applyInfo(info);
    if (info.error) toast(info.error, 'error');
    return info;
  } catch (e) {
    fail(e);
  }
}

/** Enquanto os pedidos estão ligados, busca pedidos novos e avisa o operador. */
export function usePhoneWatcher() {
  const running = useApp((s) => !!s.phone?.running);
  useEffect(() => {
    refreshPhone();
  }, []);
  useEffect(() => {
    if (!running) return;
    let version = -1;
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const v = (await api.requestsVersion()).version;
        if (version !== -1 && v !== version) {
          const before = new Set(getState().requests.map((r) => r.id));
          const list = await api.requests();
          // pedido de um vídeo do YouTube que ainda não estava no catálogo: recarrega o catálogo antes de mostrar
          if (list.some((r) => !getState().songMap.has(r.song_id))) setSongs(await api.songs());
          setState({ requests: list });
          for (const r of list) {
            if (before.has(r.id) || r.source !== 'phone') continue;
            const song = getState().songMap.get(r.song_id);
            const what = `${r.singer} — ${song?.title ?? 'música'}`;
            toast(r.status === 'pending' ? `Novo pedido pelo celular: ${what}` : `Entrou na fila pelo celular: ${what}`, 'ok');
          }
        }
        version = v;
      } catch {
        /* o serviço local volta a responder no próximo ciclo */
      } finally {
        busy = false;
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, [running]);
}
