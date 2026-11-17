// Página de pedidos pelo celular (sem bibliotecas). Todo texto vindo do servidor entra por textContent.
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* modo privado */ } },
  };

  // o código de acesso vem depois do "#" do QR code
  var m = /(?:^|[#&])k=([\w-]+)/.exec(location.hash);
  var key = m ? m[1] : store.get('kp-key');
  if (m) {
    store.set('kp-key', key);
    history.replaceState(null, '', location.pathname); // tira o código da barra de endereço
  }
  if (!key) {
    $('nokey').hidden = false;
    return;
  }
  $('app').hidden = false;

  function api(path, body) {
    return fetch('/p/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'x-kp-key': key, 'Content-Type': 'application/json' } : { 'x-kp-key': key },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || 'Sem conexão com o karaokê');
        return data;
      });
    }, function () {
      throw new Error('Sem conexão com o karaokê. Confira se está no Wi-Fi do local.');
    });
  }

  var toastTimer;
  function toast(text) {
    var t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function fmt(sec) {
    if (sec == null || !isFinite(sec)) return '';
    var s = Math.round(sec);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  // ---- nome
  var singer = $('singer');
  singer.value = store.get('kp-singer') || '';
  singer.addEventListener('input', function () { store.set('kp-singer', singer.value.trim()); });

  // ---- busca
  var q = $('q');
  var results = $('results');
  var hint = $('hint');
  var searchTimer;
  var lastQuery = null;
  var ytOn = false;
  var ytBox = $('yt-box');
  var ytResults = $('yt-results');
  var ytHint = $('yt-hint');
  var ytBtn = $('yt-btn');

  function songRow(s, sub, tag) {
    var li = el('li');
    var b = el('button');
    b.type = 'button';
    var meta = el('span', 'meta');
    var a = el('span', 'a');
    if (tag) a.append(el('span', 'tag', tag));
    a.append(document.createTextNode(sub));
    meta.append(el('span', 't', s.title), a);
    b.append(meta, el('span', 'plus', '+'));
    b.addEventListener('click', function () { pick(s); });
    li.append(b);
    return li;
  }

  function resetYouTube(text) {
    ytResults.replaceChildren();
    ytHint.textContent = '';
    ytBtn.disabled = false;
    ytBox.hidden = !(ytOn && text.length >= 2);
  }

  ytBtn.addEventListener('click', function () {
    var text = q.value.trim();
    if (text.length < 2) return;
    ytBtn.disabled = true;
    ytHint.textContent = 'Buscando no YouTube…';
    api('ytsearch?q=' + encodeURIComponent(text)).then(function (list) {
      if (q.value.trim() !== text) return;
      ytResults.replaceChildren();
      list.forEach(function (v) {
        var s = { ytId: v.ytId, title: v.title, artist: v.channel };
        ytResults.append(songRow(s, [v.channel, fmt(v.duration)].filter(Boolean).join(' · '), 'YouTube'));
      });
      ytHint.textContent = list.length ? 'Vídeos do YouTube: dependem da internet do local.' : 'Nada encontrado no YouTube.';
    }).catch(function (e) {
      ytHint.textContent = e.message;
      ytBtn.disabled = false;
    });
  });

  function search() {
    var text = q.value.trim();
    if (text === lastQuery) return;
    lastQuery = text;
    hint.textContent = 'Buscando…';
    api('search?q=' + encodeURIComponent(text)).then(function (list) {
      if (q.value.trim() !== text) return;
      results.replaceChildren();
      resetYouTube(text);
      list.forEach(function (s) {
        results.append(songRow(s, [s.artist || 'Artista desconhecido', s.format, fmt(s.duration)].filter(Boolean).join(' · ')));
      });
      hint.textContent = list.length
        ? (text ? list.length + (list.length === 60 ? '+ músicas encontradas' : ' música(s) encontrada(s)') : 'Sugestões do DJ')
        : text ? (ytOn ? 'Nenhuma música do DJ com esse nome. Busque no YouTube abaixo.' : 'Nenhuma música encontrada. Tente outra palavra.') : 'Digite o nome da música ou do artista.';
    }).catch(function (e) { hint.textContent = e.message; lastQuery = null; });
  }
  q.addEventListener('input', function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(search, 250);
  });

  // ---- confirmar pedido
  var picked = null;
  var sheet = $('sheet');
  function pick(s) {
    picked = s;
    $('pick-title').textContent = s.title;
    $('pick-artist').textContent = s.artist || '';
    $('sheet-error').hidden = true;
    $('send').disabled = false;
    sheet.hidden = false;
  }
  $('cancel').addEventListener('click', function () { sheet.hidden = true; });
  sheet.addEventListener('click', function (e) { if (e.target === sheet) sheet.hidden = true; });
  $('send').addEventListener('click', function () {
    var name = singer.value.trim();
    var err = $('sheet-error');
    if (!name) {
      err.textContent = 'Digite o seu nome antes de pedir.';
      err.hidden = false;
      return;
    }
    $('send').disabled = true;
    var body = picked.ytId ? { singer: name, ytId: picked.ytId } : { singer: name, songId: picked.id };
    api('request', body).then(function (r) {
      sheet.hidden = true;
      toast(r.pending ? 'Pedido enviado! O DJ vai aprovar.' : 'Pronto! Você está na fila.');
      renderMine(r.mine);
    }).catch(function (e) {
      err.textContent = e.message;
      err.hidden = false;
      $('send').disabled = false;
    });
  });

  // ---- meus pedidos
  var known = {};
  function statusOf(r) {
    if (r.status === 'pending') return ['Aguardando o DJ', ''];
    if (r.status === 'waiting') return [r.position === 1 ? 'Você é o próximo!' : r.position + 'º na fila', 'queue'];
    if (r.status === 'singing') return ['Cantando agora', 'live'];
    if (r.status === 'done') return ['Já cantou', ''];
    return ['Pulado', 'gone'];
  }
  function renderMine(list) {
    var ul = $('mine');
    ul.replaceChildren();
    var seen = {};
    list.forEach(function (r) {
      seen[r.id] = true;
      known[r.id] = r;
      var st = statusOf(r);
      var li = el('li');
      var meta = el('span', 'meta');
      meta.append(el('span', 't', r.title), el('span', 'a', r.singer));
      li.append(meta, el('span', 'status ' + st[1], st[0]));
      ul.append(li);
    });
    // pedidos que sumiram foram recusados ou removidos pelo DJ
    Object.keys(known).forEach(function (id) {
      if (seen[id]) return;
      var li = el('li');
      var meta = el('span', 'meta');
      meta.append(el('span', 't', known[id].title), el('span', 'a', known[id].singer));
      li.append(meta, el('span', 'status gone', 'Removido pelo DJ'));
      ul.append(li);
    });
    $('mine-box').hidden = !ul.children.length;
  }
  function refreshMine() {
    api('mine').then(renderMine).catch(function () { /* tenta de novo no próximo ciclo */ });
  }

  api('info').then(function (info) {
    ytOn = !!info.youtube;
    $('title').textContent = info.title || 'Peça sua música';
    document.title = 'Peça sua música — ' + (info.title || 'Karaokê');
    search();
    refreshMine();
  }).catch(function (e) {
    hint.textContent = e.message;
  });
  setInterval(function () { if (!document.hidden) refreshMine(); }, 5000);
})();
