// Servidor local (somente 127.0.0.1): API JSON, streaming de mídia com suporte a Range e interface estática.
// A interface é servida por HTTP para que o player incorporado do YouTube receba uma origem válida.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.mjs';
import { createLibrary, readZipPair } from './library.mjs';
import { createPhoneServer, lanAddresses, newPhoneKey, refreshPrimaryAddress } from './phone.mjs';
import { createYouTubeSearch, QuotaError, splitVideoTitle } from './youtube.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'dist');

const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml',
  png: 'image/png', ico: 'image/x-icon', json: 'application/json', woff2: 'font/woff2',
  mp3: 'audio/mpeg', mp4: 'video/mp4', m4v: 'video/mp4', m4a: 'audio/mp4', webm: 'video/webm',
  ogg: 'audio/ogg', wav: 'audio/wav', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime',
  cdg: 'application/octet-stream',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 2_000_000) {
        reject(new HttpError(413, 'Requisição muito grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header || '');
  if (!m) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) end = size - 1;
  if (start > end || start >= size) return 'invalid';
  return { start, end };
}

function serveBytes(req, res, { size, type, open }) {
  const range = parseRange(req.headers.range, size);
  if (range === 'invalid') {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    return res.end();
  }
  const head = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  const start = range ? range.start : 0;
  const end = range ? range.end : size - 1;
  head['Content-Length'] = size === 0 ? 0 : end - start + 1;
  if (range) head['Content-Range'] = `bytes ${start}-${end}/${size}`;
  res.writeHead(range ? 206 : 200, head);
  if (req.method === 'HEAD' || size === 0) return res.end();
  open(start, end, res);
}

const serveFile = (req, res, file, type) => {
  const st = fs.statSync(file);
  serveBytes(req, res, {
    size: st.size,
    type,
    open: (start, end, out) => {
      const stream = fs.createReadStream(file, { start, end });
      stream.on('error', () => out.destroy());
      out.on('close', () => stream.destroy());
      stream.pipe(out);
    },
  });
};

const serveBuffer = (req, res, buf, type) =>
  serveBytes(req, res, { size: buf.length, type, open: (start, end, out) => out.end(buf.subarray(start, end + 1)) });

/**
 * @param {{ dataDir: string, port?: number, desktop?: boolean }} opts
 */
export async function startServer(opts) {
  const db = openDb(opts.dataDir);
  const library = createLibrary(db);
  library.resumeMetadata();

  let port = 0;
  // pesquisa do YouTube feita pelo serviço local (celulares e alternativas para vídeos bloqueados)
  const yt = createYouTubeSearch({
    get referer() {
      return `http://localhost:${port}/`;
    },
  });
  /** Cria (ou reaproveita) a referência de um vídeo do YouTube no catálogo. */
  const upsertYouTubeSong = (b) => {
    const key = `yt:${b.ytId}`;
    let song = db.getSongByPath(key);
    if (!song) {
      const title = String(b.title || 'Vídeo do YouTube').slice(0, 300);
      const guess = b.songTitle ? { title: b.songTitle, artist: b.artist || '' } : splitVideoTitle(title);
      db.insertSong({
        source: 'youtube', path: key, format: 'youtube', yt_id: b.ytId,
        title: String(guess.title || title).slice(0, 300), artist: String(guess.artist || '').slice(0, 200),
        thumb: typeof b.thumb === 'string' ? b.thumb : `https://i.ytimg.com/vi/${b.ytId}/mqdefault.jpg`,
        channel: String(b.channel || '').slice(0, 200), license: b.license === 'creativeCommon' ? 'creativeCommon' : 'youtube',
        duration: Number.isFinite(b.duration) ? b.duration : null,
      });
      song = db.getSongByPath(key);
    }
    return song;
  };

  // ---- pedidos pelo celular (servidor separado na rede local, desligado por padrão)
  let requestsVersion = 0; // muda quando chega um pedido pelo celular; a tela do operador consulta
  let phoneError = '';
  const phone = createPhoneServer({ db, yt, upsertYouTubeSong, onChange: () => requestsVersion++ });
  const phoneInfo = async () => {
    await refreshPrimaryAddress();
    const st = db.getSettings();
    const addresses = lanAddresses();
    const address = addresses.find((a) => a.address === st.phoneAddress)?.address ?? addresses[0]?.address ?? null;
    return {
      enabled: !!st.phoneEnabled,
      running: phone.running,
      approval: st.phoneApproval !== false,
      youtube: st.phoneYouTube !== false,
      hasKey: !!st.ytApiKey,
      ytSearchesToday: yt.searchesToday,
      addresses,
      address,
      // o código vai depois do "#": não aparece em registros nem é enviado ao servidor pela URL
      url: phone.running && address ? `http://${address}:${phone.port}/#k=${st.phoneKey}` : null,
      error: phoneError,
    };
  };
  const startPhone = async () => {
    let st = db.getSettings();
    if (!st.phoneKey) {
      db.setSettings({ phoneKey: newPhoneKey() });
      st = db.getSettings();
    }
    try {
      await phone.start(st.phoneKey);
      phoneError = '';
    } catch (e) {
      phoneError = `Não foi possível abrir os pedidos na rede: ${e.message}`;
    }
  };
  if (db.getSettings().phoneEnabled) await startPhone();
  const token = crypto.randomBytes(24).toString('hex');
  let zipCache = null; // { id, mp3, cdg }

  const zipPair = (song) => {
    if (!zipCache || zipCache.id !== song.id) zipCache = { id: song.id, ...readZipPair(song.path) };
    return zipCache;
  };

  const snapshot = () => ({ songs: db.allSongs(), requests: db.allRequests() });
  const intId = (s) => {
    const n = Number(s);
    if (!Number.isInteger(n)) throw new HttpError(400, 'Identificador inválido');
    return n;
  };

  async function api(req, res, url) {
    const p = url.pathname.slice(4); // remove "/api"
    const m = req.method;
    let mt;

    if (m === 'GET' && p === '/bootstrap') {
      return sendJson(res, 200, { ...snapshot(), settings: db.getSettings(), importStatus: library.status });
    }
    if (m === 'GET' && p === '/songs') return sendJson(res, 200, db.allSongs());
    if (m === 'GET' && p === '/requests') return sendJson(res, 200, db.allRequests());
    if (m === 'GET' && p === '/requests/version') return sendJson(res, 200, { version: requestsVersion });
    if (m === 'GET' && p === '/phone') return sendJson(res, 200, await phoneInfo());
    if (m === 'PUT' && p === '/phone') {
      const b = await readBody(req);
      if (typeof b.approval === 'boolean') db.setSettings({ phoneApproval: b.approval });
      if (typeof b.youtube === 'boolean') db.setSettings({ phoneYouTube: b.youtube });
      if (typeof b.address === 'string' && lanAddresses().some((a) => a.address === b.address)) db.setSettings({ phoneAddress: b.address });
      if (b.regenerate === true) {
        const k = newPhoneKey();
        db.setSettings({ phoneKey: k });
        phone.setKey(k); // QR codes antigos param de funcionar
      }
      if (typeof b.enabled === 'boolean') {
        db.setSettings({ phoneEnabled: b.enabled });
        if (b.enabled) await startPhone();
        else {
          phone.stop();
          phoneError = '';
        }
      }
      return sendJson(res, 200, await phoneInfo());
    }
    if (m === 'GET' && p === '/import/status') return sendJson(res, 200, library.status);

    if (m === 'POST' && p === '/import') {
      const { paths } = await readBody(req);
      if (!Array.isArray(paths) || !paths.length || paths.some((x) => typeof x !== 'string' || !path.isAbsolute(x))) {
        throw new HttpError(400, 'Informe caminhos absolutos de arquivos ou pastas');
      }
      await library.importPaths(paths);
      return sendJson(res, 202, library.status);
    }
    if (m === 'POST' && p === '/reindex') {
      await library.reindex();
      return sendJson(res, 202, library.status);
    }

    if (m === 'POST' && p === '/songs/youtube') {
      const b = await readBody(req);
      if (typeof b.ytId !== 'string' || !/^[\w-]{11}$/.test(b.ytId)) throw new HttpError(400, 'ID de vídeo inválido');
      return sendJson(res, 200, upsertYouTubeSong(b));
    }
    if (m === 'GET' && p === '/youtube/alternatives') {
      const song = db.getSong(Number(url.searchParams.get('songId')));
      if (!song || song.source !== 'youtube') throw new HttpError(400, 'Música do YouTube inválida');
      const st = db.getSettings();
      if (!st.ytApiKey) throw new HttpError(400, 'Sem chave da YouTube Data API: não dá para procurar outra versão');
      const exclude = new Set([song.yt_id, ...String(url.searchParams.get('exclude') || '').split(',').filter(Boolean)]);
      const blocked = db.blockedYtIds();
      const query = `${song.artist} ${song.title}`.trim();
      try {
        const results = await yt.search({ apiKey: st.ytApiKey, query, lang: st.ytLanguage || 'pt' });
        return sendJson(res, 200, results.filter((r) => !exclude.has(r.ytId) && !blocked.has(r.ytId)).slice(0, 6));
      } catch (e) {
        throw new HttpError(e instanceof QuotaError ? 429 : 502, e.message);
      }
    }
    if (m === 'GET' && p === '/youtube/oembed') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w-]{11}$/.test(id)) throw new HttpError(400, 'ID de vídeo inválido');
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`);
      if (!r.ok) throw new HttpError(404, 'Vídeo não encontrado ou sem permissão de incorporação');
      const j = await r.json();
      return sendJson(res, 200, { title: j.title, channel: j.author_name, thumb: j.thumbnail_url });
    }

    if ((mt = /^\/songs\/(\d+)$/.exec(p))) {
      const id = intId(mt[1]);
      if (!db.getSong(id)) throw new HttpError(404, 'Música não encontrada');
      if (m === 'PATCH') {
        const b = await readBody(req);
        const patch = {};
        for (const k of ['title', 'artist', 'genre']) if (typeof b[k] === 'string') patch[k] = b[k].trim().slice(0, 300);
        if (patch.title === '') delete patch.title;
        if (typeof b.favorite === 'boolean') patch.favorite = b.favorite;
        if (Number.isFinite(b.volume)) patch.volume = Math.min(1, Math.max(0, b.volume));
        if (Number.isFinite(b.duration) && b.duration > 0) patch.duration = b.duration;
        if (typeof b.blocked === 'boolean') patch.blocked = b.blocked;
        if (Number.isFinite(b.checkedAt)) patch.checked_at = b.checkedAt;
        db.updateSong(id, patch);
        return sendJson(res, 200, db.getSong(id));
      }
      if (m === 'DELETE') {
        db.deleteSong(id); // remove só do catálogo; o arquivo permanece no disco
        return sendJson(res, 200, snapshot());
      }
    }

    if (m === 'POST' && p === '/requests') {
      const b = await readBody(req);
      const singer = String(b.singer || '').trim().slice(0, 80);
      if (!singer) throw new HttpError(400, 'Informe o nome do cantor');
      if (!Number.isInteger(b.songId) || !db.getSong(b.songId)) throw new HttpError(400, 'Música inválida');
      db.addRequest(singer, b.songId);
      return sendJson(res, 200, db.allRequests());
    }
    if (m === 'POST' && p === '/requests/reorder') {
      const { ids } = await readBody(req);
      if (!Array.isArray(ids) || ids.some((x) => !Number.isInteger(x))) throw new HttpError(400, 'Lista inválida');
      db.reorderRequests(ids);
      return sendJson(res, 200, db.allRequests());
    }
    if (m === 'POST' && p === '/requests/clear-history') {
      db.clearHistory();
      return sendJson(res, 200, db.allRequests());
    }
    if ((mt = /^\/requests\/(\d+)$/.exec(p))) {
      const id = intId(mt[1]);
      if (m === 'PATCH') {
        const b = await readBody(req);
        if (b.songId !== undefined && (!Number.isInteger(b.songId) || !db.getSong(b.songId))) throw new HttpError(400, 'Música inválida');
        if (!db.updateRequest(id, b)) throw new HttpError(404, 'Solicitação não encontrada');
        return sendJson(res, 200, db.allRequests());
      }
      if (m === 'DELETE') {
        db.deleteRequest(id);
        return sendJson(res, 200, db.allRequests());
      }
    }

    if (m === 'PUT' && p === '/settings') {
      const b = await readBody(req);
      delete b.roots;
      for (const k of ['phoneEnabled', 'phoneKey', 'phoneApproval', 'phoneAddress', 'phoneYouTube']) delete b[k]; // geridos por /phone
      db.setSettings(b);
      return sendJson(res, 200, db.getSettings());
    }
    throw new HttpError(404, 'Rota não encontrada');
  }

  function media(req, res, url) {
    const mt = /^\/media\/(\d+)(\/cdg)?$/.exec(url.pathname);
    if (!mt) throw new HttpError(404, 'Não encontrado');
    const song = db.getSong(Number(mt[1]));
    if (!song || song.source !== 'local') throw new HttpError(404, 'Música não encontrada');
    if (!fs.existsSync(song.path)) {
      db.setMissing(song.id, true);
      throw new HttpError(404, 'Arquivo não encontrado no disco');
    }
    if (song.format === 'zip') {
      const pair = zipPair(song);
      return mt[2] ? serveBuffer(req, res, pair.cdg, MIME.cdg) : serveBuffer(req, res, pair.mp3, MIME.mp3);
    }
    if (mt[2]) {
      if (!song.cdg_path || !fs.existsSync(song.cdg_path)) throw new HttpError(404, 'Arquivo CDG não encontrado');
      return serveFile(req, res, song.cdg_path, MIME.cdg);
    }
    const ext = path.extname(song.path).slice(1).toLowerCase();
    serveFile(req, res, song.path, MIME[ext] || 'application/octet-stream');
  }

  function statics(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw new HttpError(404, 'Não encontrado');
    }
    if (rel === '/index.html') {
      // O token é entregue apenas dentro da página (mesma origem); outros sites não conseguem lê-lo.
      const boot = `<script>window.__KP__=${JSON.stringify({ token, desktop: !!opts.desktop })}</script>`;
      const html = fs.readFileSync(file, 'utf8').replace('</head>', `${boot}</head>`);
      res.writeHead(200, { 'Content-Type': MIME.html, 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    serveFile(req, res, file, MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream');
  }

  const server = http.createServer(async (req, res) => {
    try {
      // Bloqueia DNS rebinding: só atende pelo endereço local.
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) {
        throw new HttpError(403, 'Host não permitido');
      }
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers['x-kp-token'] !== token) throw new HttpError(401, 'Não autorizado');
        return await api(req, res, url);
      }
      if (url.pathname.startsWith('/media/')) {
        if (url.searchParams.get('t') !== token) throw new HttpError(401, 'Não autorizado');
        return media(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido');
      return statics(req, res, url);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('[karaoke-pro]', e);
      sendJson(res, status, { error: e.message || 'Erro interno' });
    }
  });

  const listen = (p) =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(p, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  try {
    await listen(opts.port ?? 47800);
  } catch (e) {
    if (e.code !== 'EADDRINUSE') throw e;
    await listen(0); // porta ocupada: usa uma porta livre
  }
  port = server.address().port;

  return {
    port,
    // "localhost" (e não o IP): o YouTube recusa a incorporação de vídeos de música em origens por IP (erro 150)
    url: `http://localhost:${port}/`,
    close: () => {
      phone.stop();
      server.close();
      server.closeAllConnections?.();
      db.close();
    },
  };
}
