// Pedidos pelo celular: um segundo servidor, aberto na rede local, que só faz duas coisas —
// buscar no catálogo e criar pedidos. Não serve mídia, não controla a reprodução e não lê a fila
// inteira. Fica desligado até o operador ligar, e toda chamada exige o código de acesso do QR code.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import dgram from 'node:dgram';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { normKey } from './db.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PAGE_DIR = path.join(__dirname, 'phone');
const FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/phone.js': ['phone.js', 'text/javascript; charset=utf-8'], '/phone.css': ['phone.css', 'text/css; charset=utf-8'] };

const SEND_EVERY_MS = 15_000; // um pedido a cada 15 s por aparelho
const MAX_OPEN_PER_DEVICE = 3; // pedidos ainda não cantados por aparelho
const MAX_PENDING = 300;
const FORMAT_LABEL = { cdg: 'MP3+G', zip: 'MP3+G', youtube: 'YouTube' };
// Pesquisa no YouTube custa ~101 unidades da cota diária gratuita (10.000). Resultados repetidos vêm do cache e não contam.
const YT_EVERY_MS = 20_000; // uma pesquisa nova a cada 20 s por aparelho
const YT_PER_DEVICE_DAY = 15;
const YT_PHONES_DAY = 60; // teto para todos os celulares: sobra cota para o operador

export const newPhoneKey = () => crypto.randomBytes(6).toString('base64url');

/**
 * Endereço da interface que o computador usa de fato para sair (normalmente o Wi-Fi).
 * "Conectar" um socket UDP só consulta a tabela de rotas: nenhum pacote é enviado.
 */
let primary = { address: null, at: 0 };
export function refreshPrimaryAddress() {
  if (Date.now() - primary.at < 15_000) return Promise.resolve(primary.address);
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const done = (address) => {
      primary = { address, at: Date.now() };
      try {
        sock.close();
      } catch {
        /* já fechado */
      }
      resolve(address);
    };
    sock.on('error', () => done(null));
    sock.connect(53, '8.8.8.8', (err) => done(err ? null : sock.address().address));
  });
}

/** Endereços IPv4 desta máquina na rede local, os mais prováveis primeiro: a rota principal, depois Wi-Fi/Ethernet, por último adaptadores virtuais. */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      // 192.168.56.x é a rede padrão dos adaptadores "Host-Only" do VirtualBox, que costumam ter nomes genéricos ("Ethernet 3")
      const virtual = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|docker|tailscale|zerotier/i.test(name) || a.address.startsWith('192.168.56.');
      const privateNet = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address);
      const main = a.address === primary.address;
      out.push({ name, address: a.address, score: (main ? 8 : 0) + (privateNet ? 2 : 0) + (virtual ? 0 : 1) });
    }
  }
  return out.sort((x, y) => y.score - x.score).map(({ name, address }) => ({ name, address }));
}

const clean = (s, max) =>
  String(s ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

/**
 * @param {{ db: ReturnType<import('./db.mjs').openDb>, onChange: () => void, yt: ReturnType<import('./youtube.mjs').createYouTubeSearch>, upsertYouTubeSong: (r: object) => object }} deps
 */
export function createPhoneServer({ db, onChange, yt, upsertYouTubeSong }) {
  let server = null;
  let port = 0;
  let key = '';
  const devices = new Map(); // ip -> { lastAt, ids: number[], ytAt, ytDay, ytCount }
  const offered = new Map(); // vídeos do YouTube mostrados a algum celular: só esses podem ser pedidos
  let phoneSearches = { day: '', count: 0 };

  const searchable = () =>
    db
      .allSongs()
      .filter((s) => !s.missing && !s.blocked)
      .map((s) => ({ s, k: normKey(s.artist, s.title).replace('|', ' ') + ' ' + normKey('', s.genre).replace('|', ' ') }));

  function search(qRaw) {
    const tokens = normKey('', qRaw).replace('|', '').split(' ').filter(Boolean);
    const all = searchable();
    const hits = tokens.length ? all.filter(({ k }) => tokens.every((t) => k.includes(t))) : all.filter(({ s }) => s.favorite);
    return hits.slice(0, 60).map(({ s }) => ({
      id: s.id,
      title: s.title,
      artist: s.artist,
      format: FORMAT_LABEL[s.format] ?? s.format.toUpperCase(),
      duration: s.duration,
    }));
  }

  /** Situação dos pedidos deste aparelho (posição na fila, sem expor os outros cantores). */
  function mine(ids) {
    const all = db.allRequests();
    const waiting = all.filter((r) => r.status === 'waiting').sort((a, b) => a.position - b.position);
    return db.requestsByIds(ids).map((r) => {
      const song = db.getSong(r.song_id);
      return {
        id: r.id,
        singer: r.singer,
        title: song?.title ?? '',
        status: r.status,
        position: r.status === 'waiting' ? waiting.findIndex((w) => w.id === r.id) + 1 : null,
      };
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://phone.local');
    const file = FILES[url.pathname];
    if (req.method === 'GET' && file) {
      res.writeHead(200, {
        'Content-Type': file[1],
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      });
      return res.end(fs.readFileSync(path.join(PAGE_DIR, file[0])));
    }
    if (!url.pathname.startsWith('/p/api/')) return json(res, 404, { error: 'Não encontrado' });
    // código de acesso do QR code (comparação em tempo constante)
    const given = Buffer.from(String(req.headers['x-kp-key'] || ''));
    const want = Buffer.from(key);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      return json(res, 401, { error: 'Código de acesso inválido. Leia o QR code de novo.' });
    }
    const ip = req.socket.remoteAddress || '?';
    const dev = devices.get(ip) ?? { lastAt: 0, ids: [] };

    const st = db.getSettings();
    const ytAllowed = st.phoneYouTube !== false && !!st.ytApiKey;
    if (req.method === 'GET' && url.pathname === '/p/api/info') {
      return json(res, 200, { title: st.waitTitle || 'Karaoke Pro', songs: searchable().length, youtube: ytAllowed });
    }
    if (req.method === 'GET' && url.pathname === '/p/api/ytsearch') {
      if (!ytAllowed) return json(res, 403, { error: 'A busca no YouTube está desligada pelo DJ.' });
      const q = clean(url.searchParams.get('q'), 80);
      if (q.length < 2) return json(res, 400, { error: 'Digite o nome da música ou do artista.' });
      const lang = st.ytLanguage || 'pt';
      let results = yt.cached(q, lang);
      if (!results) {
        const today = new Date().toDateString();
        if (dev.ytDay !== today) Object.assign(dev, { ytDay: today, ytCount: 0 });
        if (phoneSearches.day !== today) phoneSearches = { day: today, count: 0 };
        const wait = YT_EVERY_MS - (Date.now() - (dev.ytAt || 0));
        if (wait > 0) return json(res, 429, { error: `Aguarde ${Math.ceil(wait / 1000)} s para buscar de novo no YouTube` });
        if (dev.ytCount >= YT_PER_DEVICE_DAY || phoneSearches.count >= YT_PHONES_DAY) {
          return json(res, 429, { error: 'Limite de buscas no YouTube atingido. Escolha entre as músicas do DJ ou peça ajuda a ele.' });
        }
        dev.ytAt = Date.now();
        dev.ytCount++;
        phoneSearches.count++;
        devices.set(ip, dev);
        try {
          results = await yt.search({ apiKey: st.ytApiKey, query: q, lang });
        } catch (e) {
          return json(res, 502, { error: /cota/i.test(e.message) ? 'As buscas no YouTube acabaram por hoje. Escolha entre as músicas do DJ.' : 'O YouTube não respondeu. Tente de novo.' });
        }
      }
      const blocked = db.blockedYtIds();
      const list = results.filter((r) => !blocked.has(r.ytId)).slice(0, 12);
      for (const r of list) {
        offered.delete(r.ytId);
        offered.set(r.ytId, r);
        if (offered.size > 3000) offered.delete(offered.keys().next().value);
      }
      return json(res, 200, list.map((r) => ({ ytId: r.ytId, title: r.title, channel: r.channel, duration: r.duration })));
    }
    if (req.method === 'GET' && url.pathname === '/p/api/search') {
      return json(res, 200, search(clean(url.searchParams.get('q'), 80)));
    }
    if (req.method === 'GET' && url.pathname === '/p/api/mine') {
      return json(res, 200, mine(dev.ids));
    }
    if (req.method === 'POST' && url.pathname === '/p/api/request') {
      const body = await new Promise((resolve) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
          size += c.length;
          if (size <= 4096) chunks.push(c);
        });
        req.on('end', () => {
          try {
            resolve(size > 4096 ? null : JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch {
            resolve(null);
          }
        });
        req.on('error', () => resolve(null));
      });
      if (!body) return json(res, 400, { error: 'Pedido inválido' });
      const singer = clean(body.singer, 40);
      if (!singer) return json(res, 400, { error: 'Digite o seu nome' });
      let song = Number.isInteger(body.songId) ? db.getSong(body.songId) : null;
      const ytPick = typeof body.ytId === 'string' && !song ? offered.get(body.ytId) : null;
      if (typeof body.ytId === 'string' && !song && (!ytPick || !ytAllowed)) return json(res, 400, { error: 'Música indisponível. Busque de novo.' });
      if (!song && !ytPick) return json(res, 400, { error: 'Música indisponível' });
      if (song && (song.missing || song.blocked)) return json(res, 400, { error: 'Música indisponível' });
      const wait = SEND_EVERY_MS - (Date.now() - dev.lastAt);
      if (wait > 0) return json(res, 429, { error: `Aguarde ${Math.ceil(wait / 1000)} s para pedir de novo` });
      const open = db.requestsByIds(dev.ids).filter((r) => r.status === 'pending' || r.status === 'waiting');
      if (open.length >= MAX_OPEN_PER_DEVICE) {
        return json(res, 429, { error: `Você já tem ${MAX_OPEN_PER_DEVICE} pedidos na fila. Espere cantar um deles.` });
      }
      if (db.pendingCount() >= MAX_PENDING) return json(res, 503, { error: 'Muitos pedidos aguardando. Tente daqui a pouco.' });
      if (ytPick) song = upsertYouTubeSong(ytPick); // o vídeo só entra no catálogo quando alguém pede
      if (song.blocked) return json(res, 400, { error: 'Este vídeo não pode ser tocado aqui. Escolha outra versão.' });
      const approval = st.phoneApproval !== false;
      const id = db.addRequest(singer, song.id, { source: 'phone', pending: approval });
      dev.lastAt = Date.now();
      dev.ids = [...dev.ids.filter((x) => open.some((o) => o.id === x)), id].slice(-20);
      devices.set(ip, dev);
      onChange();
      return json(res, 200, { ok: true, pending: approval, mine: mine(dev.ids) });
    }
    return json(res, 404, { error: 'Não encontrado' });
  }

  const listen = (host, p) =>
    new Promise((resolve, reject) => {
      const s = http.createServer((req, res) => {
        handle(req, res).catch(() => {
          if (!res.headersSent) json(res, 500, { error: 'Erro interno' });
          else res.destroy();
        });
      });
      s.requestTimeout = 15_000;
      s.headersTimeout = 10_000;
      s.once('error', reject);
      s.listen(p, host, () => {
        s.removeListener('error', reject);
        resolve(s);
      });
    });

  return {
    get running() {
      return !!server;
    },
    get port() {
      return port;
    },
    /** Liga o servidor de pedidos. `host` padrão: todas as interfaces (necessário para os celulares alcançarem). */
    async start(accessKey, host = process.env.KP_PHONE_HOST || '0.0.0.0') {
      key = accessKey;
      if (server) return;
      try {
        server = await listen(host, 47900);
      } catch (e) {
        if (e.code !== 'EADDRINUSE') throw e;
        server = await listen(host, 0);
      }
      port = server.address().port;
    },
    setKey(k) {
      key = k;
      devices.clear();
    },
    stop() {
      server?.close();
      server?.closeAllConnections?.();
      server = null;
      port = 0;
      devices.clear();
    },
  };
}
