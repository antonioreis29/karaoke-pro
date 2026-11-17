// Persistência local em SQLite (módulo nativo node:sqlite — sem dependências externas).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'local',      -- 'local' | 'youtube'
  path TEXT NOT NULL UNIQUE,                 -- caminho do arquivo ou 'yt:<id>'
  cdg_path TEXT,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL,                      -- mp3, mp4, cdg, zip, mkv, avi, youtube...
  duration REAL,
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  volume REAL NOT NULL DEFAULT 1,
  yt_id TEXT,
  thumb TEXT,
  channel TEXT,
  license TEXT,
  dup_key TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_songs_dup ON songs(dup_key);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  singer TEXT NOT NULL,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  position REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',    -- pending | waiting | singing | done | skipped
  source TEXT NOT NULL DEFAULT 'operator',   -- operator | phone
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function normKey(artist, title) {
  const n = (s) =>
    String(s || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  return `${n(artist)}|${n(title)}`;
}

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'karaoke-pro.sqlite'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // bancos criados antes dos pedidos pelo celular
  // vídeos do YouTube que o dono não deixa incorporar (marcados quando falham) e última verificação bem-sucedida
  const songCols0 = db.prepare('PRAGMA table_info(songs)').all().map((c) => c.name);
  if (!songCols0.includes('blocked')) db.exec('ALTER TABLE songs ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
  if (!songCols0.includes('checked_at')) db.exec('ALTER TABLE songs ADD COLUMN checked_at INTEGER');
  if (!db.prepare('PRAGMA table_info(requests)').all().some((c) => c.name === 'source')) {
    db.exec("ALTER TABLE requests ADD COLUMN source TEXT NOT NULL DEFAULT 'operator'");
  }
  // Se o app foi fechado no meio de uma apresentação, ela volta para a fila.
  db.exec("UPDATE requests SET status='waiting', started_at=NULL WHERE status='singing'");

  const q = (sql) => db.prepare(sql);
  const tx = (fn) => {
    db.exec('BEGIN');
    try {
      const r = fn();
      db.exec('COMMIT');
      return r;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };

  const songCols = ['title', 'artist', 'genre', 'favorite', 'volume', 'duration', 'blocked', 'checked_at'];

  return {
    raw: db,
    tx,
    close: () => db.close(),

    // ---- músicas
    allSongs: () => q('SELECT * FROM songs ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE').all(),
    getSong: (id) => q('SELECT * FROM songs WHERE id=?').get(id),
    getSongByPath: (p) => q('SELECT * FROM songs WHERE path=?').get(p),
    blockedYtIds: () => new Set(q("SELECT yt_id FROM songs WHERE source='youtube' AND blocked=1").all().map((r) => r.yt_id)),
    insertSong(s) {
      const r = q(
        `INSERT OR IGNORE INTO songs (source,path,cdg_path,title,artist,genre,format,duration,size,mtime,yt_id,thumb,channel,license,dup_key,added_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        s.source || 'local', s.path, s.cdg_path ?? null, s.title, s.artist || '', s.genre || '', s.format,
        s.duration ?? null, s.size || 0, s.mtime || 0, s.yt_id ?? null, s.thumb ?? null, s.channel ?? null,
        s.license ?? null, normKey(s.artist, s.title), Date.now()
      );
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    updateSong(id, patch) {
      const keys = Object.keys(patch).filter((k) => songCols.includes(k));
      if (!keys.length) return;
      const vals = keys.map((k) => (k === 'favorite' || k === 'blocked' ? (patch[k] ? 1 : 0) : patch[k]));
      q(`UPDATE songs SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...vals, id);
      if (keys.includes('title') || keys.includes('artist')) {
        const s = q('SELECT artist,title FROM songs WHERE id=?').get(id);
        if (s) q('UPDATE songs SET dup_key=? WHERE id=?').run(normKey(s.artist, s.title), id);
      }
    },
    setSongMeta: (id, duration, genre, artist, title) => {
      q('UPDATE songs SET duration=COALESCE(?,duration), genre=CASE WHEN genre=\'\' THEN ? ELSE genre END WHERE id=?').run(
        duration ?? null, genre || '', id
      );
      if (artist && title) {
        q('UPDATE songs SET artist=?, title=?, dup_key=? WHERE id=?').run(artist, title, normKey(artist, title), id);
      }
    },
    setMissing: (id, missing) => q('UPDATE songs SET missing=? WHERE id=?').run(missing ? 1 : 0, id),
    relocateSong: (id, p, cdg, mtime) =>
      q('UPDATE songs SET path=?, cdg_path=?, mtime=?, missing=0 WHERE id=?').run(p, cdg ?? null, mtime, id),
    deleteSong: (id) => q('DELETE FROM songs WHERE id=?').run(id),
    localSongs: () => q("SELECT * FROM songs WHERE source='local'").all(),
    songsWithoutDuration: () => q("SELECT * FROM songs WHERE source='local' AND duration IS NULL AND missing=0").all(),

    // ---- fila / histórico
    allRequests: () => q('SELECT * FROM requests ORDER BY position').all(),
    getRequest: (id) => q('SELECT * FROM requests WHERE id=?').get(id),
    addRequest(singer, songId, { source = 'operator', pending = false } = {}) {
      const max = q('SELECT COALESCE(MAX(position),0) AS m FROM requests').get().m;
      const r = q('INSERT INTO requests (singer,song_id,position,status,source,created_at) VALUES (?,?,?,?,?,?)').run(
        singer, songId, max + 1, pending ? 'pending' : 'waiting', source, Date.now()
      );
      return Number(r.lastInsertRowid);
    },
    updateRequest(id, patch) {
      const cur = q('SELECT * FROM requests WHERE id=?').get(id);
      if (!cur) return false;
      const next = { ...cur };
      if (typeof patch.singer === 'string' && patch.singer.trim()) next.singer = patch.singer.trim();
      if (Number.isInteger(patch.songId)) next.song_id = patch.songId;
      if (['waiting', 'singing', 'done', 'skipped'].includes(patch.status) && patch.status !== cur.status) {
        next.status = patch.status;
        // pedido do celular aprovado: entra no fim da fila, na ordem da aprovação
        if (cur.status === 'pending' && patch.status === 'waiting') {
          q('UPDATE requests SET position=(SELECT COALESCE(MAX(position),0)+1 FROM requests) WHERE id=?').run(id);
          next.position = q('SELECT position FROM requests WHERE id=?').get(id).position;
        }
        if (patch.status === 'singing') {
          next.started_at = Date.now();
          // só um cantor por vez
          q("UPDATE requests SET status='done', ended_at=? WHERE status='singing' AND id<>?").run(Date.now(), id);
        }
        if (patch.status === 'done' || patch.status === 'skipped') next.ended_at = Date.now();
        if (patch.status === 'waiting') {
          next.started_at = null;
          next.ended_at = null;
        }
      }
      q('UPDATE requests SET singer=?, song_id=?, status=?, started_at=?, ended_at=? WHERE id=?').run(
        next.singer, next.song_id, next.status, next.started_at, next.ended_at, id
      );
      return true;
    },
    reorderRequests(ids) {
      tx(() => {
        const st = q('UPDATE requests SET position=? WHERE id=?');
        ids.forEach((id, i) => st.run(i + 1, id));
      });
    },
    deleteRequest: (id) => q('DELETE FROM requests WHERE id=?').run(id),
    clearHistory: () => q("DELETE FROM requests WHERE status IN ('done','skipped')").run(),
    // ---- pedidos pelo celular
    pendingCount: () => q("SELECT COUNT(*) AS n FROM requests WHERE status='pending'").get().n,
    requestsByIds: (ids) => (ids.length ? q(`SELECT * FROM requests WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []),

    // ---- configurações
    getSettings() {
      const out = {};
      for (const r of q('SELECT key,value FROM settings').all()) {
        try {
          out[r.key] = JSON.parse(r.value);
        } catch {
          /* valor corrompido: ignora */
        }
      }
      return out;
    },
    setSettings(obj) {
      const st = q('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      for (const [k, v] of Object.entries(obj)) st.run(k, JSON.stringify(v));
    },
  };
}
