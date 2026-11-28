/* casino-gacha.js — «Гача: Колесо Судьбы». Вертикальный срез по studioigor.
   Один владелец факта: localStorage-ключ casino.gacha.v1.
   Логика чистая и тестируется в Node; DOM-часть работает только в браузере.
   Правила из скилла: игра, а не техно-демо; анимация от прогресса, а не от таймера;
   цифра выигрыша крупнее эффектов; честное состояние звука; контент — данные. */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CasinoGacha = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var KEY = 'casino.gacha.v1';
  // Временно скрыто по запросу; для возврата вкладки выставить true.
  var TAB_VISIBLE = false;
  var PITY_EPIC = 20; // гарантия эпика+ на 20-м кручении без эпика

  /* контент как данные: редкость × предмет × ценность */
  var RARITIES = [
    { id: 'common',    name: 'Обычный',   icon: '⚪', weight: 55, mult: 0,  color: '#a6adc8' },
    { id: 'rare',      name: 'Редкий',    icon: '🔵', weight: 28, mult: 1,  color: '#89b4fa' },
    { id: 'epic',      name: 'Эпический', icon: '🟣', weight: 12, mult: 3,  color: '#cba6f7' },
    { id: 'legendary', name: 'Легендарный', icon: '🟡', weight: 4, mult: 10, color: '#f9e2af' },
    { id: 'mythic',    name: 'Мифический', icon: '🔴', weight: 1, mult: 50, color: '#f38ba8' }
  ];

  var ITEMS = [
    { id: 'coin',     r: 0, icon: '🪙', name: 'Монетка удачи' },
    { id: 'bandage',  r: 0, icon: '🩹', name: 'Бинт после тильта' },
    { id: 'smoke',    r: 0, icon: '💨', name: 'Дым на парите' },
    { id: 'awp',      r: 1, icon: '🎯', name: 'AWP на акции' },
    { id: 'kevlar',   r: 1, icon: '🛡️', name: 'Кевлар скидки' },
    { id: 'case',     r: 2, icon: '📦', name: 'Кейс без ключа' },
    { id: 'dragon',   r: 3, icon: '🐉', name: 'Dragon Lore' },
    { id: 'diamond',  r: 4, icon: '💎', name: 'Алмазный купон' }
  ];

  function store() {
    if (typeof localStorage !== 'undefined') return localStorage;
    var mem = store._mem || (store._mem = {});
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); }
    };
  }

  function fresh() {
    return { coins: 1000, bet: 25, pity: 0, pulls: 0, collection: {}, last: null };
  }

  function load() {
    try {
      var raw = store().getItem(KEY);
      if (!raw) return fresh();
      var p = JSON.parse(raw);
      var s = fresh();
      if (!p || typeof p !== 'object') return s;
      s.coins = Math.max(0, Math.floor(Number(p.coins) || 0));
      if ([10, 25, 50, 100].indexOf(Number(p.bet)) >= 0) s.bet = Number(p.bet);
      s.pity = Math.max(0, Math.floor(Number(p.pity) || 0));
      s.pulls = Math.max(0, Math.floor(Number(p.pulls) || 0));
      if (p.collection && typeof p.collection === 'object') s.collection = p.collection;
      s.last = p.last || null;
      return s;
    } catch (e) { return fresh(); }
  }

  function save(s) {
    try { store().setItem(KEY, JSON.stringify(s)); } catch (e) { /* приватный режим */ }
    return s;
  }

  /* чистая функция: бросок с учётом pity. rnd — [0,1) */
  function roll(rnd, pity) {
    var forced = pity >= PITY_EPIC - 1;
    var total = 0, i;
    for (i = 0; i < RARITIES.length; i++) {
      if (forced && i < 3) continue; // эпик+ guarantee
      total += RARITIES[i].weight;
    }
    var x = (rnd >= 0 && rnd < 1 ? rnd : 0) * total;
    for (i = 0; i < RARITIES.length; i++) {
      if (forced && i < 3) continue;
      x -= RARITIES[i].weight;
      if (x < 0) return i;
    }
    return forced ? 3 : 0;
  }

  function itemFor(r) {
    var pool = ITEMS.filter(function (it) { return it.r === r; });
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : ITEMS[0];
  }

  /* чистая функция применения кручения к состоянию */
  function applyPull(state, rnd, itemIndex) {
    var s = {
      coins: state.coins, bet: state.bet, pity: state.pity, pulls: state.pulls,
      collection: {}, last: null
    };
    for (var k in state.collection) if (Object.prototype.hasOwnProperty.call(state.collection, k)) s.collection[k] = state.collection[k];
    if (s.coins < s.bet) return { ok: false, reason: 'Не хватает монет', state: state };

    var r = roll(rnd, s.pity);
    var pool = ITEMS.filter(function (it) { return it.r === r; });
    var item = pool[(itemIndex || 0) % pool.length];
    var dup = !!s.collection[item.id];
    var win = Math.floor(s.bet * RARITIES[r].mult * (dup ? 0.5 : 1));

    s.coins = s.coins - s.bet + win;
    s.pulls += 1;
    s.pity = r >= 3 ? 0 : s.pity + 1;
    s.collection[item.id] = (s.collection[item.id] || 0) + 1;
    s.last = {
      rarity: r, item: item.id, name: item.name, icon: item.icon,
      win: win, dup: dup, at: Date.now()
    };
    return { ok: true, rarity: r, item: item, win: win, dup: dup, forced: state.pity >= PITY_EPIC - 1, state: s };
  }

  /* ---------- браузерная часть ---------- */
  var CSS = [
    '.gch{padding:14px 16px 30px;display:flex;flex-direction:column;gap:14px}',
    '.gch *{box-sizing:border-box}',
    '.gch-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    '.gch-title{font:800 22px/1.1 var(--ff);letter-spacing:-.02em;background:linear-gradient(90deg,var(--yellow),var(--pink));-webkit-background-clip:text;background-clip:text;color:transparent}',
    '.gch-title small{display:block;font:600 11px/1.3 var(--ff);color:var(--overlay2);margin-top:4px;letter-spacing:0;-webkit-text-fill-color:var(--overlay2)}',
    '.gch-bank{margin-left:auto;text-align:right;background:var(--surface0);border:1px solid var(--surface1);border-radius:14px;padding:8px 14px}',
    '.gch-bank b{font:800 22px/1 var(--fm);color:var(--yellow)}',
    '.gch-bank span{display:block;font:600 10px/1 var(--ff);color:var(--overlay2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em}',
    '.gch-pity{display:flex;align-items:center;gap:8px;font:700 11px/1 var(--ff);color:var(--subtext1)}',
    '.gch-pity-bar{width:120px;height:6px;border-radius:6px;background:var(--surface0);overflow:hidden}',
    '.gch-pity-bar i{display:block;height:100%;background:linear-gradient(90deg,var(--pink),var(--yellow));transition:width .35s}',
    '.gch-machine{position:relative;min-height:280px;border-radius:24px;overflow:hidden;background:radial-gradient(circle at 50% 40%,#1b1b2f,var(--mantle) 70%);border:1px solid var(--surface1);display:flex;align-items:center;justify-content:center;isolation:isolate}',
    '.gch-machine::before{content:"";position:absolute;inset:-40%;background:conic-gradient(from 0deg,transparent 0 18%,rgba(137,180,250,.12) 20% 22%,transparent 24% 45%,rgba(249,226,175,.12) 47% 49%,transparent 51% 72%,rgba(243,139,168,.12) 74% 76%,transparent 78%);animation:gchRing 18s linear infinite;z-index:0}',
    '@keyframes gchRing{to{transform:rotate(360deg)}}',
    '.gch-ring{position:absolute;width:236px;height:236px;border-radius:50%;border:2px dashed var(--surface2);z-index:1;opacity:.7}',
    '.gch-capsule{position:relative;z-index:3;width:112px;height:112px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:52px;background:radial-gradient(circle at 35% 30%,#fff2,transparent 55%),linear-gradient(145deg,#313244,#181825);border:3px solid var(--yellow);box-shadow:0 0 0 8px #f9e2af18,0 18px 44px #0008,inset 0 -8px 20px #0006;will-change:transform}',
    '.gch-glow{position:absolute;z-index:2;width:180px;height:180px;border-radius:50%;filter:blur(36px);opacity:.22;background:var(--yellow);transition:background .3s,opacity .3s}',
    '.gch-particles{position:absolute;inset:0;z-index:4;pointer-events:none}',
    '.gch-particles i{position:absolute;left:50%;top:50%;width:7px;height:7px;border-radius:50%;background:var(--yellow);opacity:0}',
    '@keyframes gchBurst{0%{opacity:1;transform:translate(0,0) scale(1)}100%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.2)}}',
    '.gch-reveal{position:absolute;z-index:5;left:0;right:0;bottom:14px;display:flex;flex-direction:column;align-items:center;gap:4px;opacity:0;transform:translateY(14px);transition:.3s;pointer-events:none}',
    '.gch-reveal.show{opacity:1;transform:translateY(0)}',
    '.gch-reveal .gch-item{font:800 13px/1.2 var(--ff);color:var(--text);text-shadow:0 2px 8px #000}',
    '.gch-reveal .gch-win{font:900 46px/1 var(--fm);color:var(--yellow);text-shadow:0 3px 0 #11111b,0 0 24px currentColor}',
    '.gch-bets{display:flex;gap:7px;flex-wrap:wrap;align-items:center}',
    '.gch-bets>span{font:700 11px/1 var(--ff);color:var(--overlay2);text-transform:uppercase;letter-spacing:.06em;margin-right:2px}',
    '.gch-bet{min-width:56px;min-height:46px;border-radius:12px;border:1px solid var(--surface2);background:var(--mantle);color:var(--subtext1);font:800 14px/1 var(--fm);cursor:pointer}',
    '.gch-bet.on{border-color:var(--yellow);color:var(--yellow);background:#f9e2af18}',
    '.gch-go{flex:1;min-height:58px;border:0;border-radius:16px;background:linear-gradient(135deg,var(--pink),var(--mauve) 45%,var(--blue));color:#11111b;font:900 18px/1 var(--ff);cursor:pointer;box-shadow:0 10px 30px #f38ba844;letter-spacing:.02em}',
    '.gch-go:disabled{opacity:.5;cursor:default;box-shadow:none}',
    '.gch-actions{display:flex;gap:8px}',
    '.gch-note{font:600 11px/1.5 var(--ff);color:var(--overlay0);text-align:center}',
    '.gch-sect{font:800 12px/1 var(--ff);color:var(--overlay2);text-transform:uppercase;letter-spacing:.08em;margin-top:4px}',
    '.gch-coll{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}',
    '.gch-cell{position:relative;aspect-ratio:1;border-radius:14px;background:var(--mantle);border:1px solid var(--surface1);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:26px}',
    '.gch-cell.locked{filter:grayscale(1);opacity:.35}',
    '.gch-cell b{font:800 10px/1 var(--fm);color:var(--overlay2)}',
    '.gch-cell .gch-r{position:absolute;top:5px;right:6px;width:8px;height:8px;border-radius:50%}'
  ].join('');

  function injectCSS() {
    if (root.document && !root.document.getElementById('gch-style')) {
      var st = root.document.createElement('style');
      st.id = 'gch-style'; st.textContent = CSS;
      (root.document.head || root.document.documentElement).appendChild(st);
    }
  }

  function $(s, r) { return (r || root.document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || root.document).querySelectorAll(s)); }

  var S = null, busy = false, audioOK = false, audioCtx = null;

  function beep(win) {
    try {
      if (!audioOK) return;
      if (!audioCtx) audioCtx = new (root.AudioContext || root.webkitAudioContext)();
      var seq = win ? [523, 659, 784, 1047] : [196, 165];
      seq.forEach(function (f, i) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = win ? 'triangle' : 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, audioCtx.currentTime + i * .08);
        g.gain.exponentialRampToValueAtTime(.12, audioCtx.currentTime + i * .08 + .02);
        g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + i * .08 + .22);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(audioCtx.currentTime + i * .08); o.stop(audioCtx.currentTime + i * .08 + .24);
      });
    } catch (e) { audioOK = false; }
  }

  function panelHTML() {
    return '' +
      '<div class="gch-top">' +
        '<div class="gch-title">✨ Гача: Колесо Судьбы<small>вертикальный срез · студия игр</small></div>' +
        '<div class="gch-bank"><span>баланс</span><b id="gchBank">—</b></div>' +
      '</div>' +
      '<div class="gch-pity">До гарантированного эпика: <b id="gchPityN">—</b>' +
        '<div class="gch-pity-bar"><i id="gchPityBar" style="width:0%"></i></div></div>' +
      '<div class="gch-machine" id="gchMachine">' +
        '<div class="gch-ring" id="gchRing"></div>' +
        '<div class="gch-glow" id="gchGlow"></div>' +
        '<div class="gch-particles" id="gchParticles"></div>' +
        '<div class="gch-capsule" id="gchCapsule">🎲</div>' +
        '<div class="gch-reveal" id="gchReveal"><div class="gch-item" id="gchItem"></div><div class="gch-win" id="gchWin"></div></div>' +
      '</div>' +
      '<div class="gch-bets"><span>ставка</span>' +
        [10, 25, 50, 100].map(function (b) { return '<button class="gch-bet" data-b="' + b + '">' + b + '</button>'; }).join('') +
      '</div>' +
      '<div class="gch-actions"><button class="gch-go" id="gchGo">✦ Крутить</button></div>' +
      '<div class="gch-note" id="gchNote"></div>' +
      '<div class="gch-sect">Коллекция <span id="gchCount"></span></div>' +
      '<div class="gch-coll" id="gchColl"></div>';
  }

  function render() {
    $('#gchBank').textContent = S.coins.toLocaleString('ru-RU');
    var left = Math.max(0, PITY_EPIC - S.pity);
    $('#gchPityN').textContent = left;
    $('#gchPityBar').style.width = Math.round(S.pity / PITY_EPIC * 100) + '%';
    $$('.gch-bet').forEach(function (b) { b.classList.toggle('on', Number(b.dataset.b) === S.bet); });
    var go = $('#gchGo'); if (go) go.disabled = busy || S.coins < S.bet;
    var total = 0; for (var k in S.collection) if (S.collection[k]) total += S.collection[k];
    $('#gchCount').textContent = total ? '(' + total + ')' : '';
    $('#gchColl').innerHTML = ITEMS.map(function (it) {
      var n = S.collection[it.id] || 0;
      var col = RARITIES[it.r].color;
      return '<div class="gch-cell' + (n ? '' : ' locked') + '" title="' + it.name + '">' +
        '<span class="gch-r" style="background:' + col + '"></span>' +
        (n ? it.icon : '❔') + '<b>' + (n ? '×' + n : '—') + '</b></div>';
    }).join('');
    $('#gchNote').textContent = audioOK
      ? 'Звук: синтезируется в браузере (файлы не нужны).'
      : 'Звук недоступен в этом окружении — играем без него, без фейковых уведомлений.';
  }

  function burst(color) {
    var box = $('#gchParticles'); if (!box) return;
    box.innerHTML = '';
    for (var i = 0; i < 22; i++) {
      var p = root.document.createElement('i');
      var a = (i / 22) * Math.PI * 2, d = 90 + Math.random() * 70;
      p.style.background = color;
      p.style.setProperty('--dx', Math.cos(a) * d + 'px');
      p.style.setProperty('--dy', Math.sin(a) * d + 'px');
      p.style.animation = 'gchBurst .8s ease-out ' + (Math.random() * .12) + 's forwards';
      box.appendChild(p);
    }
  }

  /* анимация от прогресса: фаза = f(eased t), а не « ждём N мс и показываем» */
  function animate(onDone) {
    var capsule = $('#gchCapsule'), ring = $('#gchRing'), glow = $('#gchGlow');
    var dur = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 1150;
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      var e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      capsule.style.transform = 'rotate(' + (e * 900) + 'deg) scale(' + (1 + Math.sin(t * Math.PI) * .35) + ')';
      ring.style.transform = 'rotate(' + (e * 520) + 'deg)';
      glow.style.opacity = String(.2 + Math.sin(t * Math.PI) * .55);
      if (t < 1) root.requestAnimationFrame(frame);
      else { capsule.style.transform = ''; ring.style.transform = ''; onDone(); }
    }
    root.requestAnimationFrame(frame);
  }

  function spin() {
    if (busy || !S || S.coins < S.bet) return;
    busy = true;
    var res = applyPull(S, Math.random(), Math.floor(Math.random() * 3));
    if (!res.ok) { busy = false; return; }
    S = save(res.state);
    render();
    var rar = RARITIES[res.rarity];
    var reveal = $('#gchReveal');
    reveal.classList.remove('show');
    $('#gchGlow').style.background = rar.color;
    beep(res.win > 0);
    animate(function () {
      $('#gchItem').textContent = rar.icon + ' ' + res.item.name + (res.dup ? ' · дубль' : '');
      $('#gchWin').textContent = res.win > 0 ? '+' + res.win.toLocaleString('ru-RU') : '0';
      $('#gchWin').style.color = rar.color;
      reveal.classList.add('show');
      if (res.win > 0) burst(rar.color);
      render();
      busy = false;
    });
  }

  function bind() {
    $$('.gch-bet').forEach(function (b) {
      b.addEventListener('click', function () {
        if (busy) return;
        S.bet = Number(b.dataset.b); save(S); render();
      });
    });
    var go = $('#gchGo'); if (go) go.addEventListener('click', spin);
  }

  function ensureHost() {
    var doc = root.document;
    if (!doc) return null;
    var host = doc.getElementById('screen-gacha');
    if (!host) {
      host = doc.createElement('section');
      host.className = 'screen'; host.id = 'screen-gacha';
      var main = doc.getElementById('main');
      if (!main) return null;
      main.appendChild(host);
    }
    if (TAB_VISIBLE) {
      var nav = doc.getElementById('tabs');
      if (nav && !nav.querySelector('[data-tab="gacha"]')) {
        var btn = doc.createElement('button');
        btn.className = 'tab'; btn.setAttribute('data-tab', 'gacha');
        btn.innerHTML = '<span>✨</span> Гача <span class="key">7</span>';
        btn.addEventListener('click', function () { if (typeof root.setTab === 'function') root.setTab('gacha'); });
        nav.appendChild(btn);
      }
    }
    return host;
  }

  function patchSetTab() {
    if (root.__gchTabPatched || typeof root.setTab !== 'function') {
      if (typeof root.setTab !== 'function') return root.setTimeout(patchSetTab, 120);
      return;
    }
    var orig = root.setTab;
    root.__gchTabPatched = true;
    root.setTab = function (name) {
      var doc = root.document;
      if (name === 'gacha') {
        $$('.tab[data-tab]', doc).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-tab') === 'gacha'); });
        $$('.screen', doc).forEach(function (s) { s.classList.toggle('active', s.id === 'screen-gacha'); });
        var tn = doc.getElementById('taskSubNav'); if (tn) tn.hidden = true;
        var m = doc.getElementById('main'); if (m) m.scrollTop = 0;
        return;
      }
      return orig.apply(this, arguments);
    };
  }

  function mount() {
    injectCSS();
    S = load();
    var host = ensureHost();
    if (!host || host.dataset.gchMounted === '1') return;
    host.dataset.gchMounted = '1';
    host.innerHTML = '<div class="gch">' + panelHTML() + '</div>';
    try { audioOK = !!(root.AudioContext || root.webkitAudioContext); } catch (e) { audioOK = false; }
    bind(); patchSetTab(); render();
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }

  return {
    KEY: KEY, PITY_EPIC: PITY_EPIC, RARITIES: RARITIES, ITEMS: ITEMS,
    roll: roll, applyPull: applyPull, load: load, save: save, fresh: fresh,
    mount: mount
  };
});
