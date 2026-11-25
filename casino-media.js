/* Трек-контейнер + цитатник для казино PairDevBot.
   Подключение: <script src="casino-media.js"></script> до инлайн-скрипта мини-апа.
   Ничего не отправляется в сеть: треки берутся из media/tracks/, цитаты — из quotes.json.
   Пользователь ОБЯЗАН подтвердить всплывающим окном установку и проигрывание трека. */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  // Резервные данные на случай, если JSON не загрузился (например, file://).
  var FALLBACK_QUOTES = [
    'Поговорим?',
    'Давай по новой, всё херня.',
    'Бутырка — это не место, это состояние.',
    'Аттестат получил, а ума не прибавилось.',
    'Это не трек, это состояние души.',
    'Казино — это как зона: главное выйти с прибылью.'
  ];
  var FALLBACK_TRACKS = [
    {id: 'pt-01', artist: 'Паша Техника', title: 'Поговорим', file: 'pt-01.mp3', available: false},
    {id: 'but-01', artist: 'Бутырка', title: 'Не забывай', file: 'but-01.mp3', available: false},
    {id: 'at-01', artist: 'Аттестат', title: 'Аттестат', file: 'at-01.mp3', available: false}
  ];

  var state = {
    quotes: FALLBACK_QUOTES.slice(),
    tracks: FALLBACK_TRACKS.slice(),
    audio: null,
    pending: null
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c];
    });
  }

  function rand(arr) {
    if (!arr || !arr.length) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Загрузка JSON, если мини-ап открыт по http(s). При ошибке остаются резервные данные.
  function load(name, onDone) {
    if (typeof fetch !== 'function') { onDone(); return; }
    var opts={cache:'no-store'};
    if(typeof AbortController === 'function'){
      var ctl=new AbortController();
      opts.signal=ctl.signal;
      setTimeout(function(){ctl.abort();},5000);
    }
    fetch(name, opts).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (data) { onDone(data); }).catch(function () { onDone(); });
  }

  function init() {
    load('quotes.json', function (data) {
      if (data && Array.isArray(data.quotes)) {
        state.quotes = data.quotes.map(function (q) { return q && q.text ? q.text : ''; })
          .filter(Boolean);
      }
    });
    load('tracks.json', function (data) {
      if (data && Array.isArray(data.tracks)) {
        var base = (data.meta && data.meta.base) || 'media/tracks/';
        state.tracks = data.tracks.map(function (t) {
          return {
            id: t.id, artist: t.artist, title: t.title,
            file: base + (t.file || ''), available: !!t.available, url: t.url || ''
          };
        });
      }
    });
  }

  function randomTrack() { return rand(state.tracks); }

  function stop() {
    if (state.audio) {
      try { state.audio.pause(); state.audio.currentTime = 0; } catch (e) {}
      state.audio = null;
    }
  }

  function play(track) {
    stop();
    if (!track || !track.file) return false;
    var a;
    try { a = new Audio(track.file); } catch (e) { return false; }
    state.audio = a;
    a.play().catch(function () {});
    return true;
  }

  // Всплывающее окно подтверждения: показывает трек и требует явного «Согласен».
  function confirmPopup(track, onConfirm) {
    if (root.document && root.document.body) {
      var old = root.document.getElementById('casino-media-confirm');
      if (old && old.parentNode) old.parentNode.removeChild(old);

      var wrap = root.document.createElement('div');
      wrap.id = 'casino-media-confirm';
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);' +
        'display:flex;align-items:center;justify-content:center;padding:16px;';
      var label = esc((track && track.artist ? track.artist + ' — ' : '') +
        (track && track.title ? track.title : 'неизвестный трек'));
      wrap.innerHTML = '<div style="background:#1e1e2e;color:#cdd6f4;border:2px solid #a6e3a1;' +
        'border-radius:14px;max-width:420px;width:100%;padding:20px;box-shadow:0 8px 32px rgba(0,0,0,.5)">' +
        '<div style="font-size:18px;font-weight:700;margin-bottom:10px">🎵 Установить трек?</div>' +
        '<div style="margin-bottom:8px">' + label + '</div>' +
        '<div style="font-size:13px;opacity:.8;margin-bottom:16px">' +
        'Нажимая «Согласен», вы подтверждаете, что трек будет установлен и проигран.</div>' +
        '<div style="display:flex;gap:10px">' +
        '<button id="cms-yes" style="flex:1;padding:10px;border:0;border-radius:8px;background:#a6e3a1;color:#11111b;font-weight:700">Согласен</button>' +
        '<button id="cms-no" style="flex:1;padding:10px;border:0;border-radius:8px;background:#45475a;color:#cdd6f4">Отмена</button>' +
        '</div></div>';
      root.document.body.appendChild(wrap);

      root.document.getElementById('cms-no').onclick = function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      };
      root.document.getElementById('cms-yes').onclick = function () {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        if (track) {
          track.available = true; // пользователь подтвердил установку
          play(track);
        }
        if (typeof onConfirm === 'function') onConfirm(track);
      };
    } else {
      // Нет DOM — в Node/тесте просто считаем подтверждение данным.
      if (track) track.available = true;
      if (typeof onConfirm === 'function') onConfirm(track);
    }
  }

  function requestRandom(onConfirm) {
    var t = randomTrack();
    if (!t) { if (typeof onConfirm === 'function') onConfirm(null); return; }
    confirmPopup(t, onConfirm);
    return t;
  }

  // Рандомная цитата при выигрыше: событие 'casino:win' или data-атрибут на кнопке.
  function showWinQuote(text) {
    var q = text || rand(state.quotes);
    if (!q) return q;
    if (root.document && root.document.body) {
      var box = root.document.getElementById('casino-win-quote');
      if (!box) {
        box = root.document.createElement('div');
        box.id = 'casino-win-quote';
        box.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);' +
          'z-index:99998;background:#313244;color:#f9e2af;border:1px solid #f9e2af;' +
          'border-radius:10px;padding:12px 18px;max-width:90vw;font-size:15px;text-align:center';
        root.document.body.appendChild(box);
      }
      box.textContent = '💬 ' + q;
      if (box._timer) clearTimeout(box._timer);
      box._timer = setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 5000);
    }
    return q;
  }

  function hookWins() {
    if (!root.document) return;
    root.document.addEventListener('casino:win', function (e) {
      showWinQuote(e && e.detail ? e.detail.quote : null);
      requestRandom(function () {});
    });
  }

  var api = {
    init: init,
    randomTrack: randomTrack,
    requestRandom: requestRandom,
    confirmPopup: confirmPopup,
    play: play,
    stop: stop,
    showWinQuote: showWinQuote,
    hookWins: hookWins,
    _state: state
  };
  root.CasinoMedia = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
