import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.mjs';
import { openDb } from '../server/db.mjs';

test('API preserva autenticação, origem canônica e streaming Range de arquivo local', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kp-http-test-'));
  const file = path.join(root, 'Artista - Musica.mp4');
  fs.writeFileSync(file, '0123456789');
  const seed = openDb(root);
  const id = seed.insertSong({ source: 'local', path: file, title: 'Musica', artist: 'Artista', format: 'mp4', size: 10 });
  const yt = seed.insertSong({ source: 'youtube', yt_id: '6M8ReyFNFhM', path: 'yt:6M8ReyFNFhM', title: 'Teste', format: 'youtube' });
  seed.close();
  const srv = await startServer({ dataDir: root, port: 0 });
  t.after(() => { srv.close(); assert.equal(path.dirname(root), os.tmpdir()); fs.rmSync(root, { recursive: true, force: true }); });
  const base = srv.url.slice(0, -1);
  const page = await fetch(base);
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  const html = await page.text();
  const token = JSON.parse(/window\.__KP__=(\{.*?\})<\/script>/.exec(html)[1]).token;
  assert.equal((await fetch(base + '/api/songs')).status, 401);
  const headers = { 'x-kp-token': token };
  const songs = await (await fetch(base + '/api/songs', { headers })).json();
  assert.equal(songs.length, 2);
  const range = await fetch(base + `/media/${id}?t=${token}`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(range.status, 206); assert.equal(range.headers.get('content-range'), 'bytes 2-5/10'); assert.equal(await range.text(), '2345');
  assert.equal((await fetch(base + `/media/${id}`)).status, 401);
  const suffix = await fetch(base + `/media/${id}?t=${token}`, { headers: { Range: 'bytes=-3' } }); assert.equal(await suffix.text(), '789');
  assert.equal((await fetch(base + `/media/${id}?t=${token}`, { headers: { Range: 'bytes=15-' } })).status, 416);
  // vídeos do YouTube nunca são servidos pelo app: tocam só pelo player oficial
  assert.equal((await fetch(base + `/media/${yt}?t=${token}`)).status, 404);
  const ip = await fetch(`http://127.0.0.1:${srv.port}/?view=audience`, { redirect: 'manual' });
  assert.equal(ip.status, 307); assert.equal(ip.headers.get('location'), base + '/?view=audience');
});
