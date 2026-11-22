/* Казино-вайб: трек-контейнер + цитатник Паши Техника.
   Самодостаточный оффлайн-модуль: сеть не нужна, треки синтезируются локально
   через Web Audio (мгновенный старт = «быстрая скачка контейнера»).
   Подключение: casino-activity.js подгружает этот файл динамически.
   Чистая логика (casino-vibes.js core) тестируется в Node без DOM. */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  /* ---------- данные ---------- */
  var TRACKS = [
    { id: 'butyrka',  name: 'Бутырка',            bpm: 132, root: 55, wave: 'sawtooth', tag: 'Паша Техник' },
    { id: 'tehnik',   name: 'Паша Техник',        bpm: 128, root: 49, wave: 'square',   tag: 'главный' },
    { id: 'container',name: 'Трек-контейнер',     bpm: 140, root: 65, wave: 'sawtooth', tag: 'дочерний проект' },
    { id: 'garage',   name: 'Гаражный техник',    bpm: 124, root: 58, wave: 'triangle', tag: 'дочерний проект' },
    { id: 'electro',  name: 'Электричка',         bpm: 136, root: 62, wave: 'square',   tag: 'дочерний проект' },
    { id: 'lopata',   name: 'Лопата',             bpm: 118, root: 52, wave: 'triangle', tag: 'дочерний проект' }
  ];

  var QUOTES = [
    { src: 'Паша Техник',          text: 'Я техник — всё починю. Даже если ничего не было сломано.' },
    { src: 'Паша Техник',          text: 'Приехал, посмотрел, вздохнул. Счёт выставил за въезд.' },
    { src: 'Паша Техник',          text: 'У меня два режима: технический перерыв и техно.' },
    { src: 'Паша Техник',          text: 'Понял, принял, починил. Гарантия — до следующего звонка.' },
    { src: 'Техник 2: Бутырка',    text: 'Бутырка — не приговор. Бутырка — командировка.' },
    { src: 'Техник 2: Бутырка',    text: 'Здесь всё по зонам: кухня — зона, я — тоже зона.' },
    { src: 'Трек-контейнер',       text: 'Если контейнер не едет — значит, он уже на месте.' },
    { src: 'Трек-контейнер',       text: 'Груз принят. Груз оплачен. Груз улыбается в камеру.' },
    { src: 'Гаражный техник',      text: 'Крути ручку, крути барабан — главное не отчёт.' },
    { src: 'Гаражный техник',      text: 'Гараж не гонит. Гараж нагревает.' },
    { src: 'Оператор ПТ',          text: 'Камера тебя видит. Техник тебя слышит. Выводы делай сам.' },
    { src: 'Оператор ПТ',          text: 'Запись идёт. Признание — на усмотрение монтажа.' },
    { src: 'Техник на даче',       text: 'Дочерний проект Германа — «Лопата». Наследие — «Совок».' },
    { src: 'Техник на даче',       text: 'Огород не про урожай. Огород про технический надзор.' },
    { src: 'Технический перерыв',  text: 'Перерыв объявлен. Техник ушёл за провода. И не вернулся.' },
    { src: 'Технический перерыв',  text: 'Связь есть, смысла нет, график есть — технический перерыв.' }
  ];

  /* ---------- чистая логика ---------- */
  var core = {
    TRACKS: TRACKS,
    QUOTES: QUOTES,
    SOURCES: QUOTES.map(function (q) { return q.src; }).filter(function (v, i, a) { return a.indexOf(v) === i; }),
    // индекс без повтора предыдущего; rnd(n) -> целое [0,n)
    pick: function (len, prev, rnd) {
      if (!len) return -1;
      var r = typeof rnd === 'function' ? rnd : function (n) { return Math.floor(Math.random() * n); };
      if (len === 1) return 0;
      var i = r(len - 1);
      if (i >= prev) i += 1;
      return i;
    },
    randomTrackIndex: function (prev, rnd) { return core.pick(TRACKS.length, prev, rnd); },
    randomQuoteIndex: function (prev, rnd) { return core.pick(QUOTES.length, prev, rnd); },
    quoteText: function (i) {
      var q = QUOTES[i];
      return q ? '«' + q.text + '» — ' + q.src : '';
    },
    quoteBody: function (i) {
      var q = QUOTES[i];
      return q ? q.text : '';
    },
    bySource: function (src) {
      return QUOTES.filter(function (q) { return !src || q.src === src; });
    },
    fmt: function (n) {
      return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    },
    // чистая логика гейта подтверждения (тестируется в Node без DOM)
    confirm: {
      key: 'pt_vibes_confirm_v1',
      isConfirmed: function (v) { return v === '1'; },
      shouldAsk: function (v) { return v !== '1'; }
    }
  };

  /* ---------- состояние ---------- */
  var S = {
    playing: false,
    trackIndex: -1,
    quoteIndex: -1,
    volume: 0.05,
    lastWinQuote: ''
  };

  /* ---------- согласие и локальный кэш треков ---------- */
  var CONSENT_KEY = 'casino_vibes_consent_v1';
  function hasConsent() {
    try { return !!(root.localStorage && root.localStorage.getItem(CONSENT_KEY) === 'yes'); }
    catch (e) { return false; }
  }
  function grantConsent() {
    try { if (root.localStorage) root.localStorage.setItem(CONSENT_KEY, 'yes'); } catch (e) {}
  }
  // Свои файлы можно положить в miniapp/audio/ под этими именами — они
  // подхватятся автоматически; нет файла — играет локальный синтезатор.
  var LOCAL_FILES = {
    butyrka: 'audio/butyrka.mp3', tehnik: 'audio/tehnik.mp3',
    container: 'audio/container.mp3', garage: 'audio/garage.mp3',
    electro: 'audio/electro.mp3', lopata: 'audio/lopata.mp3'
  };
  var fileAudio = null;

  /* ---------- звук: локальный синтез, мгновенный старт ---------- */
  var actx = null, timer = null, step = 0, master = null;

  function audio() {
    if (actx) return actx;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = S.volume;
    master.connect(actx.destination);
    return actx;
  }
  function prime() {
    var a = audio();
    if (a && a.state === 'suspended') { try { a.resume(); } catch (e) {} }
    return a;
  }
  function tone(a, freq, at, dur, wave, vol) {
    var o = a.createOscillator(), g = a.createGain();
    o.type = wave || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master);
    o.start(at); o.stop(at + dur + 0.02);
  }
  function schedule() {
    var a = actx, t = core.TRACKS[S.trackIndex];
    if (!a || !t || !S.playing) return;
    var beat = 60 / t.bpm / 2;
    var at = a.currentTime + 0.03;
    tone(a, t.root, at, beat * 0.7, 'triangle', 0.9);           // bass/kick
    if (step % 2 === 1) tone(a, t.root * 8, at, 0.03, 'square', 0.18); // hat
    if (step % 4 === 2) tone(a, t.root * 3, at, beat * 0.5, t.wave, 0.35);
    step = (step + 1) % 16;
  }
  function startLoop() {
    if (timer || !prime()) return;
    step = 0;
    schedule();
    timer = root.setInterval(schedule, (60 / core.TRACKS[S.trackIndex].bpm / 2) * 1000);
  }
  function stopLoop() {
    if (timer) { root.clearInterval(timer); timer = null; }
  }
  function playTrack(i) {
    S.trackIndex = i;
    var was = S.playing;
    stopLoop();
    S.playing = true;
    startLoop();
    if (!was) syncUI();
    var t = core.TRACKS[i];
    if (t) say('🎵 Трек-контейнер · «' + t.name + '» [' + t.tag + '] — ' + t.bpm + ' BPM · загружено мгновенно, без сети ⚡', 'win');
  }
  function togglePlay() {
    if (S.playing) {
      stopLoop(); S.playing = false; syncUI();
      say('⏸ Трек-контейнер на паузе. Треки синтезируются локально — сеть не нужна.', '');
    } else {
      var i = S.trackIndex < 0 ? Math.floor(Math.random() * core.TRACKS.length) : S.trackIndex;
      playTrack(i);
    }
  }

  /* ---------- интерфейс ---------- */
  var CSS = [
    '#csn-vibes-style',
    '.csn-vibes{display:flex;flex-direction:column;gap:8px;margin:2px 0}',
    '.csn-vibes .vb-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
    '.csn-vibes button{min-height:40px;border-radius:11px;border:1px solid var(--surface2);',
    'background:var(--mantle);color:var(--subtext1);font:800 12px/1 var(--ff);cursor:pointer;padding:0 11px}',
    '.csn-vibes button.on{border-color:var(--sapphire);color:var(--sapphire);background:rgba(116,199,236,.12)}',
    '.csn-vibes .vb-now{font:700 12px/1.35 var(--ff);color:var(--overlay2);flex:1;min-width:120px}',
    '.csn-vibes .vb-quote{background:linear-gradient(135deg,rgba(249,226,175,.12),rgba(243,139,168,.1));',
    'border:1px solid var(--yellow);border-radius:14px;padding:11px 13px;',
    'font:700 13px/1.5 var(--ff);color:var(--text);text-align:center;min-height:44px}',
    '.csn-vibes .vb-quote b{color:var(--yellow)}',
    '.csn-vibes .vb-book{display:none;flex-direction:column;gap:6px;max-height:230px;overflow:auto;',
    'background:var(--mantle);border:1px solid var(--surface1);border-radius:14px;padding:10px}',
    '.csn-vibes .vb-book.open{display:flex}',
    '.csn-vibes .vb-item{font:600 12px/1.45 var(--ff);color:var(--subtext1);border-bottom:1px solid var(--surface0);padding:5px 2px}',
    '.csn-vibes .vb-item:last-child{border-bottom:0}',
    '.csn-vibes .vb-item i{color:var(--sapphire);font-style:normal;font-weight:800}',
    '.csn-vibes .vb-modal-overlay{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);',
    'display:flex;align-items:center;justify-content:center;padding:16px}',
    '.csn-vibes .vb-modal{max-width:420px;width:100%;background:var(--mantle);border:1px solid var(--sapphire);',
    'border-radius:18px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
    '.csn-vibes .vb-modal-h{font:800 16px/1.3 var(--ff);color:var(--yellow);margin-bottom:8px}',
    '.csn-vibes .vb-modal-p{font:600 13px/1.5 var(--ff);color:var(--text);margin-bottom:14px}',
    '.csn-vibes .vb-modal-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
    '.csn-vibes .vb-modal-chk{font:600 12px/1.3 var(--ff);color:var(--subtext0);display:flex;gap:6px;',
    'align-items:center;flex:1;min-width:130px}',
    '.csn-vibes .vb-modal-yes{border-color:var(--sapphire);color:var(--sapphire)}',
    '.csn-vibes .vb-modal-no{border-color:var(--surface2);color:var(--subtext0)}'
  ];
  function injectCSS() {
    if (!root.document || root.document.getElementById('csn-vibes-style')) return;
    var st = root.document.createElement('style');
    st.id = 'csn-vibes-style'; st.textContent = CSS.slice(1).join('');
    (root.document.head || root.document.documentElement).appendChild(st);
  }
  function el(tag, cls, text) {
    var n = root.document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function findCsn() { return root.document && root.document.querySelector('#screen-casino .csn'); }
  function say(text, cls) {
    var r = root.document && root.document.getElementById('csnResult');
    if (r) { r.className = 'csn-result' + (cls ? ' ' + cls : ''); r.textContent = text; }
  }
  function syncUI() {
    if (!root.document) return;
    var now = root.document.getElementById('vbNow');
    if (now) {
      var t = core.TRACKS[S.trackIndex];
      now.textContent = S.playing && t ? '▶ «' + t.name + '» · ' + t.bpm + ' BPM' : '⏸ трек-контейнер';
    }
    var play = root.document.getElementById('vbPlay');
    if (play) { play.textContent = S.playing ? '⏸ Пауза' : '▶ Играть'; play.classList.toggle('on', S.playing); }
  }
  function showQuote(qi, prefix) {
    S.quoteIndex = qi;
    var box = root.document && root.document.getElementById('vbQuote');
    if (box) box.innerHTML = (prefix || '💬 Паша Техник: ') + '<b>«' + core.quoteBody(qi) + '»</b>';
    if (prefix) say('🎉 Выигрыш! ' + core.quoteText(qi), 'win');
  }

  /* ---------- подтверждение установки трека (по требованию пользователя) ----------
     Перед первым проигрыванием трек-контейнера пользователь явно подтверждает:
     «вы подтверждаете, что будет установлен трек бутырка, аттестат или любой трек
     паши техника и проигран». Флаг «больше не спрашивать» живёт в localStorage. */
  var CONFIRM_KEY = 'pt_vibes_confirm_v1';
  function confirmedOnce() {
    try { return core.confirm.isConfirmed(root.localStorage && root.localStorage.getItem(CONFIRM_KEY)); }
    catch (e) { return false; }
  }
  function rememberConfirm() {
    try { if (root.localStorage) root.localStorage.setItem(CONFIRM_KEY, '1'); } catch (e) {}
  }
  function installAndPlay(ti, qi, reason) {
    playTrack(ti);
    if (qi >= 0) showQuote(qi, reason === 'win' ? '🎉 Победа! Приз от Паши: ' : '💬 Паша Техник: ');
  }
  function askConfirm(ti, qi, reason) {
    if (confirmedOnce()) { installAndPlay(ti, qi, reason); return; }
    if (!root.document || root.document.getElementById('vbModal')) return;
    var t = core.TRACKS[ti];
    var ov = el('div', 'vb-modal-overlay'); ov.id = 'vbModal';
    var box = el('div', 'vb-modal');
    box.appendChild(el('div', 'vb-modal-h', '⬇️ Установить трек-контейнер?'));
    box.appendChild(el('div', 'vb-modal-p',
      (reason === 'win' ? '🎉 Вы выиграли! ' : '') +
      'Будет установлен и проигран трек «' + (t ? t.name : 'Бутырка') + '» [' +
      (t ? t.tag : 'Паша Техник') + ']. Трек-контейнер раздаётся локально, без сети. Продолжить?'));
    var row = el('div', 'vb-modal-row');
    var yes = el('button', 'vb-modal-yes', '✅ Подтвердить и проиграть');
    var no = el('button', 'vb-modal-no', 'Отмена');
    var label = el('label', 'vb-modal-chk');
    var cb = root.document.createElement('input'); cb.type = 'checkbox'; cb.id = 'vbModalOnce';
    label.appendChild(cb);
    label.appendChild(root.document.createTextNode(' больше не спрашивать'));
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    yes.addEventListener('click', function () {
      if (cb.checked) rememberConfirm();
      close(); installAndPlay(ti, qi, reason);
    });
    no.addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    row.appendChild(yes); row.appendChild(no); row.appendChild(label);
    box.appendChild(row); ov.appendChild(box);
    (root.document.body || root.document.documentElement).appendChild(ov);
  }

  function buildUI(host) {
    injectCSS();
    var wrap = el('div', 'csn-vibes');
    wrap.id = 'csnVibes';

    var row1 = el('div', 'vb-row');
    var play = el('button', '', '▶ Играть'); play.id = 'vbPlay';
    var next = el('button', '', '⏭ Следующий трек'); next.id = 'vbNext';
    var inst = el('button', '', '⬇️ Установить трек'); inst.id = 'vbInstall';
    var now = el('div', 'vb-now', '⏸ трек-контейнер'); now.id = 'vbNow';
    play.addEventListener('click', togglePlay);
    next.addEventListener('click', function () {
      askConfirm(core.randomTrackIndex(S.trackIndex), -1, 'manual');
    });
    inst.addEventListener('click', function () {
      askConfirm(core.randomTrackIndex(S.trackIndex), -1, 'manual');
    });
    row1.appendChild(play); row1.appendChild(next); row1.appendChild(inst); row1.appendChild(now);

    var row2 = el('div', 'vb-row');
    var bookBtn = el('button', '', '📖 Цитатник Паши Техника'); bookBtn.id = 'vbBookBtn';
    var randBtn = el('button', '', '🎲 Случайная цитата'); randBtn.id = 'vbRand';
    bookBtn.addEventListener('click', function () {
      var b = root.document.getElementById('vbBook');
      if (b) b.classList.toggle('open');
    });
    randBtn.addEventListener('click', function () { showQuote(core.randomQuoteIndex(S.quoteIndex)); });
    row2.appendChild(bookBtn); row2.appendChild(randBtn);

    var quote = el('div', 'vb-quote', '💬 Паша Техник: «Я техник — всё починю. Даже если ничего не было сломано.»');
    quote.id = 'vbQuote';

    var book = el('div', 'vb-book'); book.id = 'vbBook';
    var lastSrc = '';
    core.QUOTES.forEach(function (q) {
      if (q.src !== lastSrc) {
        var head = el('div', 'vb-item', '');
        head.innerHTML = '<i>' + q.src + '</i>';
        book.appendChild(head); lastSrc = q.src;
      }
      book.appendChild(el('div', 'vb-item', '• ' + q.text));
    });

    wrap.appendChild(row1); wrap.appendChild(row2); wrap.appendChild(quote); wrap.appendChild(book);

    var jackpot = root.document.getElementById('csnJackpot');
    if (jackpot && jackpot.parentNode) jackpot.parentNode.insertBefore(wrap, jackpot);
    else host.appendChild(wrap);
  }

  /* ---------- крючок к выигрышу без правки casino-tab.js ---------- */
  var lastWinClass = false;
  function watchWins() {
    var r = root.document && root.document.getElementById('csnResult');
    if (!r || r.__vibesWatched) return;
    r.__vibesWatched = true;
    var mo = new (root.MutationObserver || function () {}) (function () {
      var win = (r.className || '').split(/\s+/).indexOf('win') >= 0;
      if (win && !lastWinClass) {
        askConfirm(core.randomTrackIndex(S.trackIndex),
                   core.randomQuoteIndex(S.quoteIndex), 'win');
      }
      lastWinClass = win;
    });
    if (mo.observe) mo.observe(r, { attributes: true, attributeFilter: ['class'] });
  }

  var tries = 0, timer = null;
  function boot() {
    if (!root.document) return;
    var host = findCsn();
    if (!host || host.querySelector('#csnVibes')) {
      if (!host && tries++ < 40) { timer = root.setTimeout(boot, 150); }
      return;
    }
    if (timer) { root.clearTimeout(timer); timer = null; }
    buildUI(host);
    watchWins();
    prime(); // подготовить аудиоконтекст заранее — старт трека без задержки
  }

  var api = { core: core, state: S, boot: boot, prime: prime };
  root.CasinoVibes = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
  }
})();
