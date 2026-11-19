import type { ImportStatus, PhoneInfo, Settings, SingerRequest, Song } from './types';

const token = window.__KP__?.token ?? '';

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${url}`, {
    method,
    headers: { 'x-kp-token': token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Erro ${res.status}`);
  return data as T;
}

export const mediaUrl = (songId: number) => `/media/${songId}?t=${token}`;
export const cdgUrl = (songId: number) => `/media/${songId}/cdg?t=${token}`;

export interface Bootstrap {
  songs: Song[];
  requests: SingerRequest[];
  settings: Partial<Settings>;
  importStatus: ImportStatus;
}

export const api = {
  bootstrap: () => call<Bootstrap>('GET', '/bootstrap'),
  requests: () => call<SingerRequest[]>('GET', '/requests'),
  songs: () => call<Song[]>('GET', '/songs'),
  importPaths: (paths: string[]) => call<ImportStatus>('POST', '/import', { paths }),
  importStatus: () => call<ImportStatus>('GET', '/import/status'),
  reindex: () => call<ImportStatus>('POST', '/reindex'),
  patchSong: (id: number, patch: Partial<Pick<Song, 'title' | 'artist' | 'genre' | 'volume' | 'duration'>> & { favorite?: boolean; blocked?: boolean; checkedAt?: number }) =>
    call<Song>('PATCH', `/songs/${id}`, patch),
  deleteSong: (id: number) => call<{ songs: Song[]; requests: SingerRequest[] }>('DELETE', `/songs/${id}`),
  saveYoutube: (v: { ytId: string; title: string; songTitle?: string; artist?: string; channel?: string; thumb?: string; duration?: number | null; license?: string }) =>
    call<Song>('POST', '/songs/youtube', v),
  oembed: (id: string) => call<{ title: string; channel: string; thumb: string }>('GET', `/youtube/oembed?id=${id}`),
  addRequest: (singer: string, songId: number) => call<SingerRequest[]>('POST', '/requests', { singer, songId }),
  patchRequest: (id: number, patch: { singer?: string; songId?: number; status?: string; score?: number | null }) =>
    call<SingerRequest[]>('PATCH', `/requests/${id}`, patch),
  reorder: (ids: number[]) => call<SingerRequest[]>('POST', '/requests/reorder', { ids }),
  deleteRequest: (id: number) => call<SingerRequest[]>('DELETE', `/requests/${id}`),
  clearHistory: () => call<SingerRequest[]>('POST', '/requests/clear-history'),
  saveSettings: (s: Partial<Settings>) => call<Partial<Settings>>('PUT', '/settings', s),
  requestsVersion: () => call<{ version: number }>('GET', '/requests/version'),
  phone: () => call<PhoneInfo>('GET', '/phone'),
  alternatives: (songId: number, exclude: string[]) =>
    call<{ ytId: string; title: string; channel: string; thumb: string; duration: number | null; license: string }[]>('GET', `/youtube/alternatives?songId=${songId}&exclude=${encodeURIComponent(exclude.join(','))}`),
  setPhone: (patch: { enabled?: boolean; approval?: boolean; youtube?: boolean; address?: string; regenerate?: boolean }) => call<PhoneInfo>('PUT', '/phone', patch),
};
