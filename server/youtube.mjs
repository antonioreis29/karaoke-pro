// Pesquisa na YouTube Data API v3 feita pelo serviço local (a chave nunca vai para os celulares).
// Mesmos critérios da pesquisa do operador: só vídeos incorporáveis, preferência por karaokê com letra.

const LANG = {
  pt: { words: 'karaokê com letra', code: 'pt' },
  en: { words: 'karaoke with lyrics', code: 'en' },
  es: { words: 'karaoke con letra', code: 'es' },
  any: { words: 'karaoke', code: '' },
};

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
const decode = (s) => String(s || '').replace(/&(amp|quot|#39|lt|gt);/g, (m) => ENTITIES[m]);

function isoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

/** Dá preferência a versões instrumentais com letra. */
function score(title) {
  const t = title.toLowerCase();
  let s = 0;
  if (/karaok[eê]/.test(t)) s += 5;
  if (/instrumental|playback|backing track|sem voz/.test(t)) s += 3;
  if (/com letra|with lyrics|con letra|lyrics/.test(t)) s += 2;
  if (/\bcover\b|ao vivo|\blive\b|react|tutorial|aula|como cantar|making of/.test(t)) s -= 4;
  return s;
}

/** "Queen - Bohemian Rhapsody (Karaoke Version)" -> artista e música sugeridos. */
export function splitVideoTitle(title) {
  const clean = String(title)
    .replace(/[([][^)\]]*(karaok[eê]|instrumental|playback|lyrics|letra|vers[aã]o|version|hd|4k)[^)\]]*[)\]]/gi, ' ')
    // limites de palavra que entendem acentos (o \b do JavaScript só conhece a-z: "Karaokê" escapava)
    .replace(/(?<![\p{L}\d])(karaok[eê]( version)?|com letra|with lyrics|instrumental|playback)(?![\p{L}\d])/giu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–|]+|[\s\-–|]+$/g, '');
  const parts = clean.split(/\s+[-–|]\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { artist: parts[0], title: parts.slice(1).join(' - ') };
  return { artist: '', title: clean || String(title) };
}

export class QuotaError extends Error {}

// KP_YT_API_BASE só é usado nos testes automatizados (API falsa local, sem gastar a cota real)
const API_BASE = process.env.KP_YT_API_BASE || 'https://www.googleapis.com/youtube/v3';

/**
 * @param {{ referer: string }} opts  Referer enviado à API (lido a cada chamada): o endereço do app, para chaves restritas por site.
 */
export function createYouTubeSearch(opts) {
  const cache = new Map(); // consulta -> { at, results }
  const TTL = 6 * 3600_000;
  let searchesToday = 0;
  let day = new Date().toDateString();

  async function call(path, params) {
    const res = await fetch(`${API_BASE}/${path}?${new URLSearchParams(params)}`, { headers: { Referer: opts.referer }, signal: AbortSignal.timeout(15000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const reason = data?.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new QuotaError('Cota diária gratuita da API do YouTube esgotada.');
      throw new Error(data?.error?.message || `Erro ${res.status} na API do YouTube`);
    }
    return data;
  }

  return {
    get searchesToday() {
      if (new Date().toDateString() !== day) {
        day = new Date().toDateString();
        searchesToday = 0;
      }
      return searchesToday;
    },

    /** Resultado em cache (sem gastar cota), ou null. */
    cached(query, lang) {
      const hit = cache.get(`${lang}|${query.trim().toLowerCase()}`);
      return hit && Date.now() - hit.at < TTL ? hit.results : null;
    },

    async search({ apiKey, query, lang = 'pt', max = 20 }) {
      const key = `${lang}|${query.trim().toLowerCase()}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < TTL) return hit.results;
      const l = LANG[lang] ?? LANG.any;
      const params = {
        key: apiKey, part: 'snippet', type: 'video', maxResults: String(max), videoEmbeddable: 'true', videoSyndicated: 'true',
        q: `${query.trim()} ${l.words}`,
      };
      if (l.code) params.relevanceLanguage = l.code;
      const found = await call('search', params);
      const ids = (found.items || []).map((i) => i.id?.videoId).filter(Boolean);
      let results = [];
      if (ids.length) {
        const details = await call('videos', { key: apiKey, part: 'contentDetails,status', id: ids.join(',') });
        const info = new Map((details.items || []).map((v) => [v.id, v]));
        results = (found.items || [])
          .filter((i) => i.id?.videoId && info.get(i.id.videoId)?.status?.embeddable !== false)
          .map((i, idx) => {
            const v = info.get(i.id.videoId);
            const title = decode(i.snippet.title);
            return {
              ytId: i.id.videoId,
              title,
              channel: decode(i.snippet.channelTitle),
              thumb: i.snippet.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
              duration: v ? isoDuration(v.contentDetails?.duration) : null,
              license: v?.status?.license || 'youtube',
              score: score(title) - idx * 0.01,
            };
          })
          .sort((a, b) => b.score - a.score);
      }
      this.searchesToday; // vira o dia, se for o caso
      searchesToday++;
      cache.set(key, { at: Date.now(), results });
      if (cache.size > 500) cache.delete(cache.keys().next().value);
      return results;
    },
  };
}
