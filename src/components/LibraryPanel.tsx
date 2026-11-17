import { useMemo, useRef, useState } from 'react';
import { importFiles, importFolder, reindex } from '../actions';
import { api } from '../api';
import { fail, fmtTime, setState, upsertSong, useApp } from '../store';
import type { Song } from '../types';
import { Icon } from './icons';
import { OnlinePanel } from './OnlinePanel';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const searchKey = new WeakMap<Song, string>();
const keyOf = (s: Song) => {
  let k = searchKey.get(s);
  if (!k) searchKey.set(s, (k = norm(`${s.title} ${s.artist} ${s.genre}`)));
  return k;
};

export const FORMAT_LABEL: Record<string, string> = { cdg: 'MP3+G', zip: 'ZIP', youtube: 'YouTube' };
export const fmtLabel = (f: string) => FORMAT_LABEL[f] ?? f.toUpperCase();

type SortKey = 'artist' | 'title' | 'duration';

/** Lista virtualizada: só as linhas visíveis existem no DOM, mesmo com dezenas de milhares de músicas. */
function VirtualList<T>({ items, rowHeight, render }: { items: T[]; rowHeight: number; render: (item: T) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const height = ref.current?.clientHeight ?? 800;
  const first = Math.max(0, Math.floor(top / rowHeight) - 6);
  const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + 6);
  return (
    <div className="vlist" ref={ref} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        <div style={{ position: 'absolute', top: first * rowHeight, left: 0, right: 0 }}>
          {items.slice(first, last).map(render)}
        </div>
      </div>
    </div>
  );
}

function LocalLibrary() {
  const songs = useApp((s) => s.songs);
  const compact = useApp((s) => s.settings.compact);
  const [query, setQuery] = useState('');
  const [format, setFormat] = useState('');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [flag, setFlag] = useState<'' | 'fav' | 'dup' | 'missing'>('');
  const [sort, setSort] = useState<SortKey>('artist');
  const [desc, setDesc] = useState(false);

  const facets = useMemo(() => {
    const formats = new Set<string>();
    const artists = new Set<string>();
    const genres = new Set<string>();
    const dup = new Map<string, number>();
    for (const s of songs) {
      formats.add(s.format);
      if (s.artist) artists.add(s.artist);
      if (s.genre) genres.add(s.genre);
      dup.set(s.dup_key, (dup.get(s.dup_key) ?? 0) + 1);
    }
    const cmp = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
    return { formats: [...formats].sort(), artists: [...artists].sort(cmp), genres: [...genres].sort(cmp), dup };
  }, [songs]);

  const list = useMemo(() => {
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const out = songs.filter((s) => {
      if (format && s.format !== format) return false;
      if (artist && s.artist !== artist) return false;
      if (genre && s.genre !== genre) return false;
      if (flag === 'fav' && !s.favorite) return false;
      if (flag === 'missing' && !s.missing) return false;
      if (flag === 'dup' && (facets.dup.get(s.dup_key) ?? 0) < 2) return false;
      if (tokens.length) {
        const k = keyOf(s);
        for (const t of tokens) if (!k.includes(t)) return false;
      }
      return true;
    });
    const col = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
    const dir = desc ? -1 : 1;
    out.sort((a, b) => {
      if (sort === 'duration') return ((a.duration ?? 0) - (b.duration ?? 0)) * dir;
      const primary = sort === 'artist' ? col.compare(a.artist, b.artist) : col.compare(a.title, b.title);
      return (primary || col.compare(a.title, b.title)) * dir;
    });
    return out;
  }, [songs, query, format, artist, genre, flag, sort, desc, facets]);

  const sortBy = (k: SortKey) => {
    if (sort === k) setDesc(!desc);
    else {
      setSort(k);
      setDesc(false);
    }
  };
  const toggleFav = (s: Song) => api.patchSong(s.id, { favorite: !s.favorite }).then(upsertSong).catch(fail);
  const addToQueue = (s: Song) => setState({ dialog: { type: 'request', songId: s.id } });
  const arrow = (k: SortKey) => (sort === k ? (desc ? ' ↓' : ' ↑') : '');

  return (
    <>
      <div className="panel-tools">
        <div className="search">
          <Icon name="search" />
          <input id="lib-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por título, artista ou gênero (Ctrl+F)" spellCheck={false} />
          {query && <button className="ghost" onClick={() => setQuery('')} title="Limpar busca"><Icon name="x" size={14} /></button>}
        </div>
        <div className="filters">
          <select value={format} onChange={(e) => setFormat(e.target.value)} title="Filtrar por formato">
            <option value="">Formato</option>
            {facets.formats.map((f) => <option key={f} value={f}>{fmtLabel(f)}</option>)}
          </select>
          <select value={artist} onChange={(e) => setArtist(e.target.value)} title="Filtrar por artista">
            <option value="">Artista</option>
            {facets.artists.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={genre} onChange={(e) => setGenre(e.target.value)} title="Filtrar por gênero">
            <option value="">Gênero</option>
            {facets.genres.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={flag} onChange={(e) => setFlag(e.target.value as typeof flag)} title="Outros filtros">
            <option value="">Todas</option>
            <option value="fav">Favoritas</option>
            <option value="dup">Duplicadas</option>
            <option value="missing">Ausentes</option>
          </select>
        </div>
      </div>

      <div className="list-head">
        <button onClick={() => sortBy('title')}>Título{arrow('title')}</button>
        <button onClick={() => sortBy('artist')}>Artista{arrow('artist')}</button>
        <span className="grow" />
        <button onClick={() => sortBy('duration')}>Duração{arrow('duration')}</button>
      </div>

      {songs.length === 0 ? (
        <div className="empty">
          <Icon name="folder" size={30} />
          <strong>Sua biblioteca está vazia</strong>
          <p>Importe uma pasta com seus arquivos de karaokê (MP4, MP3, MP3+CDG, ZIP) ou use a aba Online.</p>
          <button className="btn primary" onClick={importFolder}><Icon name="folder" /> Importar pasta</button>
        </div>
      ) : list.length === 0 ? (
        <div className="empty"><strong>Nenhuma música encontrada</strong><p>Ajuste a busca ou os filtros.</p></div>
      ) : (
        <VirtualList
          items={list}
          rowHeight={compact ? 38 : 46}
          render={(s) => (
            <div key={s.id} className={`row song ${s.missing ? 'missing' : ''}`} onDoubleClick={() => addToQueue(s)} title={s.source === 'local' ? s.path : `YouTube · ${s.channel ?? ''}`}>
              <button className={`ghost fav ${s.favorite ? 'on' : ''}`} onClick={() => toggleFav(s)} title={s.favorite ? 'Remover dos favoritos' : 'Favoritar'}>
                <Icon name={s.favorite ? 'starOn' : 'star'} size={15} />
              </button>
              <div className="song-main">
                <div className="t">{s.title}</div>
                <div className="a">{s.artist || 'Artista desconhecido'}{s.genre ? ` · ${s.genre}` : ''}</div>
              </div>
              {s.missing ? <span className="badge danger">ausente</span> : null}
              {s.blocked ? <span className="badge danger" title="O YouTube não deixou incorporar este vídeo na última verificação">bloqueado</span> : null}
              <span className={`badge f-${s.format}`}>{fmtLabel(s.format)}</span>
              <span className="dur">{fmtTime(s.duration)}</span>
              <button className="ghost" onClick={() => setState({ dialog: { type: 'song', songId: s.id } })} title="Editar dados da música"><Icon name="edit" size={15} /></button>
              <button className="add" onClick={() => addToQueue(s)} title="Adicionar à fila de um cantor"><Icon name="plus" size={15} /></button>
            </div>
          )}
        />
      )}

      <div className="panel-foot">
        <span>{list.length.toLocaleString('pt-BR')} de {songs.length.toLocaleString('pt-BR')} músicas</span>
        <span className="grow" />
        <button className="btn sm" onClick={importFolder} title="Importar uma pasta inteira (inclui subpastas)"><Icon name="folder" size={14} /> Pasta</button>
        <button className="btn sm" onClick={importFiles} title="Importar arquivos avulsos"><Icon name="file" size={14} /> Arquivos</button>
        <button className="btn sm" onClick={reindex} title="Reindexar: localizar arquivos movidos, ausentes e novos"><Icon name="refresh" size={14} /></button>
      </div>
    </>
  );
}

export function LibraryPanel() {
  const [tab, setTab] = useState<'local' | 'online'>('local');
  return (
    <section className="panel">
      <div className="tabs">
        <button className={tab === 'local' ? 'on' : ''} onClick={() => setTab('local')}><Icon name="folder" size={15} /> Biblioteca</button>
        <button className={tab === 'online' ? 'on' : ''} onClick={() => setTab('online')}><Icon name="globe" size={15} /> Online</button>
      </div>
      {tab === 'local' ? <LocalLibrary /> : <OnlinePanel />}
    </section>
  );
}
