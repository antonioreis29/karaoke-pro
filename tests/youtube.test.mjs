import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

let serial = 0;
async function fixture() {
  const elements = [], timers = new Map();
  globalThis.window = { setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; } };
  globalThis.clearTimeout = (id) => timers.delete(id);
  globalThis.location = { origin: 'http://localhost:47800' };
  globalThis.document = {
    createElement(tag) { const el = { tag, remove() {} }; elements.push(el); return el; },
    head: { appendChild() {} },
  };
  const source = stripTypeScriptTypes(fs.readFileSync(new URL('../src/player/youtube.ts', import.meta.url), 'utf8'), { mode: 'transform' });
  const module = await import(`data:text/javascript;base64,${Buffer.from(source + `\n// ${serial++}`).toString('base64')}`);
  return { module, elements, timers };
}
test('erro 153 é identificação; 101/150 continuam sendo recusa de incorporação', async () => {
  const { module } = await fixture();
  assert.match(module.ytErrorText(153), /identificação.*153/);
  assert.doesNotMatch(module.ytErrorText(153), /dono/);
  assert.match(module.ytErrorText(150), /150/); assert.match(module.ytErrorText(101), /101/);
});
test('iframe envia origem e Referrer-Policy antes da navegação; eventos tardios são ignorados', async () => {
  const { module, elements } = await fixture();
  let events, destroyed = 0, errors = 0, states = 0, plays = 0;
  window.YT = { Player: class {
    constructor(_mount, opts) { events = opts.events; }
    playVideo() { plays++; } destroy() { destroyed++; }
  } };
  const p = new module.YtPlayer({ replaceChildren() {} }, '6M8ReyFNFhM', 3, true, { onState() { states++; }, onError() { errors++; } });
  await Promise.resolve(); await Promise.resolve();
  const iframe = elements[0];
  assert.equal(iframe.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.match(iframe.allow, /autoplay/);
  assert.equal(new URL(iframe.src).searchParams.get('origin'), location.origin);
  assert.equal(new URL(iframe.src).searchParams.get('autoplay'), '0');
  events.onReady(); assert.equal(plays, 1);
  p.destroy(); events.onError({ data: 150 }); events.onStateChange({ data: 0 }); p.play();
  assert.equal(destroyed, 1); assert.equal(errors, 0); assert.equal(states, 0); assert.equal(plays, 1);
});
test('API que não carrega expira e permite tentar novamente', async () => {
  const { module, timers } = await fixture();
  const p = module.loadYouTubeApi(); const check = assert.rejects(p, /demorou/);
  [...timers.values()][0](); await check;
  const retry = module.loadYouTubeApi();
  window.YT = { Player() {} }; window.onYouTubeIframeAPIReady();
  assert.equal(await retry, window.YT);
});
