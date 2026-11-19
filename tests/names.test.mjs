import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFileName } from '../server/library.mjs';
import { splitVideoTitle } from '../server/youtube.mjs';

test('nome de arquivo vira artista e música', () => {
  assert.deepEqual(parseFileName('C:/Karaoke/Queen - Bohemian Rhapsody.mp4'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
  // código de disco de karaokê no começo é descartado
  assert.deepEqual(parseFileName('SF045-03 - Roberto Carlos - Emocoes.mp3'), { artist: 'Roberto Carlos', title: 'Emocoes' });
  // marcações de karaokê saem do título
  assert.deepEqual(parseFileName('ABBA - Dancing Queen (Karaoke Version).webm'), { artist: 'ABBA', title: 'Dancing Queen' });
  assert.deepEqual(parseFileName('Legiao_Urbana_-_Tempo_Perdido.mp3'), { artist: 'Legiao Urbana', title: 'Tempo Perdido' });
  // sem separador: tudo é título
  assert.deepEqual(parseFileName('Musica Sem Artista.mp3'), { artist: '', title: 'Musica Sem Artista' });
});

test('título do vídeo do YouTube vira artista e música', () => {
  assert.deepEqual(splitVideoTitle('Queen - Bohemian Rhapsody (Karaoke Version)'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
  assert.deepEqual(splitVideoTitle('Amy Winehouse - Back To Black | Karaokê com letra'), { artist: 'Amy Winehouse', title: 'Back To Black' });
  assert.deepEqual(splitVideoTitle('Evidências KARAOKÊ'), { artist: '', title: 'Evidências' });
});
