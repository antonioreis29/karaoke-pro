// Biblioteca: varredura de pastas, identificação por nome de arquivo, metadados e reindexação.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';

export const MEDIA_EXTS = new Set(['mp3', 'mp4', 'm4v', 'm4a', 'webm', 'ogg', 'wav', 'mkv', 'avi', 'mov', 'zip']);
const CDG_BYTES_PER_SECOND = 7200; // 300 pacotes de 24 bytes por segundo

const KARAOKE_TAG = /\s*[\(\[][^\)\]]*(karaok[eê]|instrumental|playback|lyrics|com letra|vers[aã]o)[^\)\]]*[\)\]]\s*/gi;

/** "Queen - Bohemian Rhapsody.mp4" -> { artist: 'Queen', title: 'Bohemian Rhapsody' } */
export function parseFileName(file) {
  let name = path.basename(file, path.extname(file));
  name = name.replace(/_/g, ' ').replace(KARAOKE_TAG, ' ').replace(/\s+/g, ' ').trim();
  let parts = name.split(/\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
  // Padrão comum em discos de karaokê: "SF123-04 - Artista - Música"
  if (parts.length >= 3 && /\d/.test(parts[0]) && /^[A-Za-z]{0,6}[\d-]+[A-Za-z0-9-]*$/.test(parts[0])) {
    parts = parts.slice(1);
  }
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: '', title: name || path.basename(file) };
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

function zipHasKaraoke(file) {
  try {
    const names = new AdmZip(file).getEntries().map((e) => e.entryName.toLowerCase());
    return names.some((n) => n.endsWith('.cdg')) && names.some((n) => n.endsWith('.mp3'));
  } catch {
    return false;
  }
}

/** Lê do ZIP o par MP3 + CDG (em memória). */
export function readZipPair(file) {
  const zip = new AdmZip(file);
  const entries = zip.getEntries();
  const mp3 = entries.find((e) => e.entryName.toLowerCase().endsWith('.mp3'));
  const cdg = entries.find((e) => e.entryName.toLowerCase().endsWith('.cdg'));
  if (!mp3 || !cdg) throw new Error('O ZIP não contém o par MP3 + CDG');
  return { mp3: mp3.getData(), cdg: cdg.getData() };
}

/** Transforma uma lista de arquivos em candidatos a música (pareando MP3 + CDG). */
async function buildCandidates(files, errors) {
  const lower = new Map(files.map((f) => [f.toLowerCase(), f]));
  const out = [];
  for (const file of files) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!MEDIA_EXTS.has(ext)) continue;
    let st;
    try {
      st = await fsp.stat(file);
    } catch (e) {
      errors.push({ file, error: e.message });
      continue;
    }
    let format = ext;
    let cdg = null;
    if (ext === 'mp3') {
      const guess = file.slice(0, -4) + '.cdg';
      cdg = lower.get(guess.toLowerCase()) || (fs.existsSync(guess) ? guess : null);
      if (cdg) format = 'cdg';
    } else if (ext === 'zip') {
      if (!zipHasKaraoke(file)) {
        errors.push({ file, error: 'ZIP sem par MP3 + CDG' });
        continue;
      }
    }
    out.push({ path: file, cdg_path: cdg, format, size: st.size, mtime: Math.floor(st.mtimeMs), ...parseFileName(file) });
  }
  return out;
}

export function createLibrary(db) {
  const status = {
    running: false, phase: 'idle', scanned: 0, added: 0, skipped: 0, duplicates: 0,
    relocated: 0, missing: 0, metaDone: 0, metaTotal: 0, errors: [], finishedAt: 0, version: 0,
  };
  const bump = () => status.version++;

  async function collect(paths, errors) {
    const files = [];
    for (const p of paths) {
      let st;
      try {
        st = await fsp.stat(p);
      } catch {
        errors.push({ file: p, error: 'Caminho não encontrado' });
        continue;
      }
      if (st.isDirectory()) {
        for await (const f of walk(p)) {
          files.push(f);
          if (files.length % 500 === 0) {
            status.scanned = files.length;
            await new Promise((r) => setImmediate(r));
          }
        }
      } else files.push(p);
    }
    status.scanned = files.length;
    return files;
  }

  function insertCandidates(cands) {
    const known = new Set(db.allSongs().map((s) => s.dup_key));
    db.tx(() => {
      for (const c of cands) {
        const id = db.insertSong({ ...c, source: 'local' });
        if (id == null) {
          status.skipped++;
          continue;
        }
        status.added++;
        const key = db.getSong(id).dup_key;
        if (known.has(key)) status.duplicates++;
        known.add(key);
      }
    });
  }

  async function readMetadata() {
    const pending = db.songsWithoutDuration();
    status.phase = 'metadata';
    status.metaTotal = pending.length;
    status.metaDone = 0;
    bump();
    let mm = null;
    try {
      mm = await import('music-metadata');
    } catch (e) {
      status.errors.push({ file: 'music-metadata', error: e.message });
    }
    const one = async (s) => {
      let duration = null, genre = '', artist = '', title = '';
      try {
        if (s.format === 'zip') {
          const cdg = new AdmZip(s.path).getEntries().find((e) => e.entryName.toLowerCase().endsWith('.cdg'));
          if (cdg) duration = cdg.header.size / CDG_BYTES_PER_SECOND;
        } else if (mm && s.format !== 'avi') {
          const meta = await mm.parseFile(s.path, { duration: true, skipCovers: true });
          duration = meta.format.duration ?? null;
          genre = meta.common.genre?.[0] || '';
          // Tags só substituem o nome quando o arquivo não segue "Artista - Música"
          if (!s.artist && meta.common.artist && meta.common.title) {
            artist = meta.common.artist;
            title = meta.common.title;
          }
        }
      } catch {
        /* sem metadados legíveis: a duração é preenchida na primeira reprodução */
      }
      if (duration == null && s.cdg_path) {
        try {
          duration = (await fsp.stat(s.cdg_path)).size / CDG_BYTES_PER_SECOND;
        } catch { /* ignora */ }
      }
      if (duration != null || genre || artist) db.setSongMeta(s.id, duration, genre, artist, title);
      status.metaDone++;
    };
    // quatro leituras simultâneas; o progresso é consultado pelo status, sem recarregar o catálogo
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (next < pending.length) await one(pending[next++]);
      })
    );
  }

  async function run(job) {
    if (status.running) throw new Error('Já existe uma importação em andamento');
    Object.assign(status, {
      running: true, phase: 'scan', scanned: 0, added: 0, skipped: 0, duplicates: 0,
      relocated: 0, missing: 0, metaDone: 0, metaTotal: 0, errors: [],
    });
    bump();
    (async () => {
      try {
        await job();
        await readMetadata();
      } catch (e) {
        status.errors.push({ file: '', error: e.message });
      } finally {
        status.running = false;
        status.phase = 'idle';
        status.finishedAt = Date.now();
        status.errors = status.errors.slice(0, 200);
        bump();
      }
    })();
  }

  return {
    status,

    /** Retoma a leitura de metadados interrompida (ex.: app fechado durante uma importação). */
    resumeMetadata() {
      if (db.songsWithoutDuration().length) run(async () => {}).catch(() => undefined);
    },

    importPaths(paths) {
      return run(async () => {
        const files = await collect(paths, status.errors);
        const cands = await buildCandidates(files, status.errors);
        insertCandidates(cands);
        // Guarda as pastas importadas para a reindexação
        const roots = new Set(db.getSettings().roots || []);
        for (const p of paths) {
          try {
            if (fs.statSync(p).isDirectory()) roots.add(path.resolve(p));
          } catch { /* ignora */ }
        }
        db.setSettings({ roots: [...roots] });
        bump();
      });
    },

    /** Verifica arquivos ausentes, localiza arquivos movidos e adiciona arquivos novos das pastas conhecidas. */
    reindex() {
      return run(async () => {
        const songs = db.localSongs();
        const missing = [];
        for (const s of songs) {
          const gone = !fs.existsSync(s.path);
          if (gone) missing.push(s);
          if (!!s.missing !== gone) db.setMissing(s.id, gone);
        }
        const roots = db.getSettings().roots || [];
        const files = await collect(roots.filter((r) => fs.existsSync(r)), status.errors);
        const knownPaths = new Set(songs.map((s) => s.path));
        const cands = (await buildCandidates(files, status.errors)).filter((c) => !knownPaths.has(c.path));
        // Arquivo movido = mesmo nome e mesmo tamanho em outro local
        const byKey = new Map(cands.map((c) => [`${path.basename(c.path).toLowerCase()}|${c.size}`, c]));
        const used = new Set();
        for (const s of missing) {
          const c = byKey.get(`${path.basename(s.path).toLowerCase()}|${s.size}`);
          if (c && !used.has(c.path)) {
            db.relocateSong(s.id, c.path, c.cdg_path, c.mtime);
            used.add(c.path);
            status.relocated++;
          } else status.missing++;
        }
        insertCandidates(cands.filter((c) => !used.has(c.path)));
        bump();
      });
    },
  };
}
