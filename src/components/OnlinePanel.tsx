// Repertório online: pesquisa na YouTube Data API v3 e catálogo pessoal de referências.
import { useState } from 'react';
import { saveYoutubeResult } from '../actions';
import { api } from '../api';
import { parseVideoId, searchKaraoke, type YtResult } from '../player/youtube';
import { fail, fmtTime, getState, setState, toast, updateSettings, useApp } from '../store';
import { Icon } from './icons';

// Persistem enquanto o app está aberto, mesmo ao trocar de aba
let lastResults: YtResult[] = [];
let lastQuery = '';

export function OnlinePanel() {
  const settings = useApp((s) => s.settings);
  const songs = useApp((s) => s.songs);
  const [query, setQuery] = useState(lastQuery);
  const [results, setResults] = useState(lastResults);
  const [ccOnly, setCcOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const saved = new Set(songs.filter((s) => s.yt_id).map((s) => s.yt_id));

  const search = async (q = query) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    try {
      const r = await searchKaraoke(settings.ytApiKey, q, settings.ytLanguage, ccOnly);
      lastResults = r;
      lastQuery = q;
      setResults(r);
      setQuery(q);
      if (!r.length) toast('Nenhum vídeo incorporável encontrado para essa busca');
      const recent = [q.trim(), ...getState().settings.ytRecent.filter((x) => x.toLowerCase() !== q.trim().toLowerCase())].slice(0, 8);
      updateSettings({ ytRecent: recent });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const queue = async (r: YtResult) => {
    try {
      const song = await saveYoutubeResult(r);
      setState({ dialog: { type: 'request', songId: song.id } });
    } catch (e) {
      fail(e);
    }
  };
  const save = async (r: YtResult) => {
    try {
      await saveYoutubeResult(r);
      toast('Referência salva no catálogo', 'ok');
    } catch (e) {
      fail(e);
    }
  };

  const addLink = async () => {
    const id = parseVideoId(link);
    if (!id) return toast('Cole um link ou ID de vídeo do YouTube válido', 'error');
    setBusy(true);
    try {
      const info = await api.oembed(id);
      const song = await saveYoutubeResult({ ytId: id, title: info.title, channel: info.channel, thumb: info.thumb, duration: null, license: 'youtube' });
      setLink('');
      setState({ dialog: { type: 'request', songId: song.id } });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="panel-tools">
        {settings.ytApiKey ? (
          <>
            <form className="search" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <Icon name="search" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Música ou artista — Enter para pesquisar" spellCheck={false} />
              <button className="btn sm primary" disabled={busy || !query.trim()}>{busy ? '…' : 'Buscar'}</button>
            </form>
            <div className="filters">
              <select value={settings.ytLanguage} onChange={(e) => updateSettings({ ytLanguage: e.target.value })} title="Idioma preferido">
                <option value="pt">Português</option>
                <option value="en">Inglês</option>
                <option value="es">Espanhol</option>
                <option value="any">Qualquer idioma</option>
              </select>
              <label className="check" title="Mostra apenas vídeos publicados sob licença Creative Commons (CC BY), conforme informado pelo YouTube">
                <input type="checkbox" checked={ccOnly} onChange={(e) => setCcOnly(e.target.checked)} /> Só Creative Commons
              </label>
            </div>
            {settings.ytRecent.length > 0 && (
              <div className="chips">
                {settings.ytRecent.map((q) => <button key={q} onClick={() => search(q)}>{q}</button>)}
              </div>
            )}
          </>
        ) : (
          <div className="notice">
            <strong>Pesquisa do YouTube desativada</strong>
            <p>Informe sua chave gratuita da YouTube Data API v3 nas configurações. Sem a chave, você ainda pode adicionar vídeos colando o link abaixo.</p>
            <button className="btn sm primary" onClick={() => setState({ dialog: { type: 'settings' } })}><Icon name="gear" size={14} /> Configurar chave</button>
          </div>
        )}
        <form className="search" onSubmit={(e) => { e.preventDefault(); addLink(); }}>
          <Icon name="link" />
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Colar link do YouTube" spellCheck={false} />
          <button className="btn sm" disabled={busy || !link.trim()}>Adicionar</button>
        </form>
      </div>

      <div className="vlist">
        {results.length === 0 && (
          <div className="empty">
            <Icon name="globe" size={30} />
            <strong>Repertório online</strong>
            <p>Os vídeos tocam pelo player oficial do YouTube, com os anúncios e as restrições da plataforma. Nada é baixado: o catálogo guarda apenas a referência do vídeo.</p>
          </div>
        )}
        {results.map((r) => (
          <div key={r.ytId} className="row yt" onDoubleClick={() => queue(r)}>
            <img src={r.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
            <div className="song-main">
              <div className="t" title={r.title}>{r.title}</div>
              <div className="a">
                {r.channel} · {fmtTime(r.duration)}
                {r.license === 'creativeCommon' && <span className="badge ok">CC BY</span>}
              </div>
            </div>
            <button className={`ghost fav ${saved.has(r.ytId) ? 'on' : ''}`} onClick={() => save(r)} title="Salvar no catálogo pessoal" disabled={saved.has(r.ytId)}>
              <Icon name={saved.has(r.ytId) ? 'check' : 'star'} size={15} />
            </button>
            <button className="add" onClick={() => queue(r)} title="Adicionar à fila de um cantor"><Icon name="plus" size={15} /></button>
          </div>
        ))}
      </div>
      <div className="panel-foot">
        <span>Vídeos salvos aparecem na Biblioteca com o formato YouTube.</span>
      </div>
    </>
  );
}
