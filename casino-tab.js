/* Вкладка «Казино» для мини-апа PairDevBot — оффлайн-рофл, без сети и реальных денег.
   Подключение: <script src="casino-tab.js"></script> (до основного инлайн-скрипта).
   Все деньги виртуальные. Ввод «цифр карты» в джекпот-шутке никуда не отправляется
   и не сохраняется — это чисто клиентский ролл с reverses. */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  var KEY = 'pairdev_casino_v1';
  // Временно скрыто по запросу; для возврата вкладки выставить true.
  var TAB_VISIBLE = false;

  /* ---------- чистая логика (тестируется без DOM) ---------- */
  var core = {
    SYMBOLS: [
      { s: '🍒', name: 'вишня', mult: 2 },
      { s: '🍋', name: 'лимон', mult: 3 },
      { s: '🔔', name: 'колокол', mult: 4 },
      { s: '⭐', name: 'звезда', mult: 6 },
      { s: '💎', name: 'алмаз', mult: 10 },
      { s: '7️⃣', name: 'семёрка', mult: 15 }
    ],
    // Слоты: три одинаковых = xN, два одинаковых = x1.5, иначе 0.
    slotsPayout: function (a, b, c, bet) {
      var x = String(a), y = String(b), z = String(c);
      if (x === y && y === z) {
        var sym = null;
        for (var i = 0; i < core.SYMBOLS.length; i++) {
          if (core.SYMBOLS[i].s === x) { sym = core.SYMBOLS[i]; break; }
        }
        return sym ? sym.mult * bet : 0;
      }
      if (x === y || y === z || x === z) return Math.floor(bet * 1.5);
      return 0;
    },
    // Упрощённая рулетка: нечёт = красное, чёт = чёрное, ноль = зелёное.
    rouletteColor: function (n) {
      n = Number(n);
      if (n === 0) return 'green';
      return n % 2 === 1 ? 'red' : 'black';
    },
    roulettePayout: function (number, choice, bet) {
      var color = core.rouletteColor(number);
      if (choice === 'green') return number === 0 ? 14 * bet : 0;
      return color === choice ? 2 * bet : 0;
    },
    // Кости: выплата по сумме двух d6 (приближено к вероятности, с лёгким «красным» краем).
    dicePayout: function (sum, bet) {
      sum = Number(sum);
      if (sum === 2 || sum === 12) return 8 * bet;
      if (sum === 3 || sum === 11) return 4 * bet;
      if (sum === 4 || sum === 10) return 3 * bet;
      if (sum === 5 || sum === 9) return 2 * bet;
      if (sum === 6 || sum === 8) return Math.floor(1.5 * bet);
      if (sum === 7) return bet;
      return 0;
    },
    reverseDigits: function (s) {
      return String(s == null ? '' : s).replace(/\D/g, '').split('').reverse().join('');
    },
    fmt: function (n) {
      return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    },
    rand: function (max) { return Math.floor(Math.random() * max); },
    // Бонус выдаётся один раз: повторные клики не должны печать монеты.
    claimBonus: function (state) {
      if (!state || state.bonusClaimed) return { ok: false, delta: 0, reason: 'already' };
      state.bonusClaimed = true;
      state.coins = (Number(state.coins) || 0) + 500;
      return { ok: true, delta: 500, reason: 'granted' };
    }
  };

  /* ---------- состояние ---------- */
  var S = { coins: 1000, spins: 0, wins: 0, biggest: 0, history: [], game: 'slots', bet: 25, bonusClaimed: false };
  var spinning = false; // защита от гонок: одна анимация в момент времени
  function load() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          S.coins = Math.max(0, Number(p.coins) || 0);
          S.spins = Math.max(0, Number(p.spins) || 0);
          S.wins = Math.max(0, Number(p.wins) || 0);
          S.biggest = Math.max(0, Number(p.biggest) || 0);
          S.history = Array.isArray(p.history) ? p.history.slice(0, 8) : [];
          S.bonusClaimed = p.bonusClaimed === true;
          if (['slots', 'roulette', 'dice'].indexOf(p.game) >= 0) S.game = p.game;
          if ([10, 25, 50, 100].indexOf(Number(p.bet)) >= 0) S.bet = Number(p.bet);
        }
      }
    } catch (e) { /* приватный режим — работаем в памяти */ }
  }
  function save() {
    try {
      if (root.localStorage) root.localStorage.setItem(KEY, JSON.stringify(S));
    } catch (e) { /* игнорируем */ }
  }

  /* ---------- стили (скоуп .csn, не трогают остальной апп) ---------- */
  var CSS = [
    '.csn{padding:12px 14px 26px;display:flex;flex-direction:column;gap:12px}',
    '.csn *{box-sizing:border-box}',
    '.csn .csn-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.csn .csn-title{font:800 20px/1.1 var(--ff);letter-spacing:-.02em}',
    '.csn .csn-title small{display:block;font:600 11px/1.3 var(--ff);color:var(--overlay2);margin-top:4px;letter-spacing:0}',
    '.csn .csn-bank{margin-left:auto;text-align:right;background:var(--surface0);border:1px solid var(--surface1);border-radius:14px;padding:8px 12px}',
    '.csn .csn-bank b{font:800 20px/1 var(--fm);color:var(--yellow)}',
    '.csn .csn-bank span{display:block;font:600 10px/1 var(--ff);color:var(--overlay2);margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em}',
    '.csn .csn-stats{display:flex;gap:8px;flex-wrap:wrap}',
    '.csn .csn-stat{flex:1;min-width:70px;background:var(--mantle);border:1px solid var(--surface0);border-radius:12px;padding:8px 10px;text-align:center}',
    '.csn .csn-stat b{display:block;font:800 15px/1.2 var(--fm);color:var(--text)}',
    '.csn .csn-stat span{font:600 10px/1 var(--ff);color:var(--overlay2)}',
    '.csn .csn-seg{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;padding:4px;background:var(--surface0);border-radius:14px}',
    '.csn .csn-seg button{min-height:44px;border:0;border-radius:10px;background:transparent;color:var(--subtext0);font:700 12px/1 var(--ff);cursor:pointer;transition:.15s}',
    '.csn .csn-seg button.on{background:var(--blue);color:#11111b;box-shadow:0 4px 14px rgba(137,180,250,.3)}',
    '.csn .csn-panel{background:var(--surface0);border:1px solid var(--surface1);border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:12px;min-height:210px}',
    '.csn .csn-bets{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
    '.csn .csn-bets>span{font:700 11px/1 var(--ff);color:var(--overlay2);text-transform:uppercase;letter-spacing:.06em;margin-right:2px}',
    '.csn .csn-bet{min-width:52px;min-height:44px;border-radius:10px;border:1px solid var(--surface2);background:var(--mantle);color:var(--subtext1);font:800 13px/1 var(--fm);cursor:pointer}',
    '.csn .csn-bet.on{border-color:var(--yellow);color:var(--yellow);background:rgba(249,226,175,.1)}',
    '.csn .csn-stage{display:flex;align-items:center;justify-content:center;gap:10px;min-height:96px;flex-wrap:wrap}',
    '.csn .csn-reel{width:74px;height:74px;border-radius:16px;background:var(--mantle);border:1px solid var(--surface1);display:flex;align-items:center;justify-content:center;font-size:38px;box-shadow:inset 0 2px 10px rgba(0,0,0,.25);transition:transform .08s}',
    '.csn .csn-reel.spin{animation:csnBlur .09s linear infinite}',
    '@keyframes csnBlur{0%{transform:translateY(-3px) scale(.96);filter:blur(1px)}50%{transform:translateY(3px) scale(1.04)}100%{transform:translateY(-3px) scale(.96)}}',
    '.csn .csn-ball{width:96px;height:96px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 30px/1 var(--fm);color:#11111b;background:conic-gradient(#e74c3c 0 49%,#2c3e50 49% 97%,#f1c40f 97% 100%);box-shadow:0 0 0 6px var(--mantle),0 8px 24px rgba(0,0,0,.4);position:relative}',
    '.csn .csn-ball::after{content:"";position:absolute;width:34px;height:34px;border-radius:50%;background:var(--text);box-shadow:inset 0 0 0 4px var(--mantle)}',
    '.csn .csn-ball b{position:relative;z-index:2;font-size:20px;color:var(--text);text-shadow:0 1px 3px #000}',
    '.csn .csn-ball.spin b{filter:blur(2px)}',
    '.csn .csn-die{width:68px;height:68px;border-radius:16px;background:var(--text);color:#11111b;display:flex;align-items:center;justify-content:center;font:800 34px/1 var(--ff);box-shadow:0 6px 18px rgba(0,0,0,.3)}',
    '.csn .csn-die.spin{animation:csnBlur .09s linear infinite}',
    '.csn .csn-colors{display:flex;gap:8px}',
    '.csn .csn-color{min-width:78px;min-height:44px;border-radius:12px;border:2px solid var(--surface2);background:var(--mantle);color:var(--text);font:700 13px/1 var(--ff);cursor:pointer}',
    '.csn .csn-color.on[data-c="red"]{border-color:#e74c3c;color:#ff9a8b;background:rgba(231,76,60,.12)}',
    '.csn .csn-color.on[data-c="black"]{border-color:var(--overlay1);color:var(--subtext1);background:rgba(147,153,178,.14)}',
    '.csn .csn-color.on[data-c="green"]{border-color:#2ecc71;color:#6be7af;background:rgba(46,204,113,.12)}',
    '.csn .csn-guess{display:flex;gap:5px;flex-wrap:wrap;justify-content:center}',
    '.csn .csn-guess button{min-width:44px;min-height:44px;border-radius:10px;border:1px solid var(--surface2);background:var(--mantle);color:var(--subtext1);font:800 13px/1 var(--fm);cursor:pointer}',
    '.csn .csn-guess button.on{border-color:var(--sapphire);color:var(--sapphire);background:rgba(116,199,236,.12)}',
    '.csn .csn-result{min-height:44px;padding:10px 12px;border-radius:12px;background:var(--mantle);border:1px solid var(--surface1);text-align:center;font:700 13px/1.4 var(--ff);color:var(--subtext1)}',
    '.csn .csn-result.win{color:var(--green);border-color:rgba(166,227,161,.5);background:rgba(166,227,161,.08)}',
    '.csn .csn-result.lose{color:var(--maroon);border-color:rgba(243,139,168,.45)}',
    '.csn .csn-actions{display:flex;gap:8px}',
    '.csn .csn-go{flex:1;min-height:52px;border:0;border-radius:14px;background:linear-gradient(180deg,var(--blue),#74a8fa);color:#11111b;font:800 16px/1 var(--ff);cursor:pointer;box-shadow:0 6px 18px rgba(137,180,250,.28)}',
    '.csn .csn-go:disabled{opacity:.5;cursor:default}',
    '.csn .csn-bonus{min-height:52px;padding:0 14px;border-radius:14px;border:1px solid var(--surface2);background:var(--mantle);color:var(--yellow);font:700 13px/1 var(--ff);cursor:pointer}',
    '.csn .csn-jackpot{width:100%;min-height:56px;border:0;border-radius:16px;background:linear-gradient(135deg,#f9e2af,#fab387 45%,#f38ba8);color:#11111b;font:800 15px/1.2 var(--ff);cursor:pointer;box-shadow:0 8px 26px rgba(249,226,175,.22);animation:csnPulse 2.4s ease-in-out infinite}',
    '@keyframes csnPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.015)}}',
    '.csn .csn-hist{display:flex;flex-wrap:wrap;gap:6px}',
    '.csn .csn-hist span{font:700 11px/1 var(--fm);padding:5px 8px;border-radius:8px;background:var(--mantle);border:1px solid var(--surface0);color:var(--overlay2)}',
    '.csn .csn-hist span.w{color:var(--green);border-color:rgba(166,227,161,.4)}',
    '.csn .csn-hist span.l{color:var(--maroon)}',
    '.csn .csn-note{font:600 11px/1.45 var(--ff);color:var(--overlay0);text-align:center}',
    '.csn-modal{position:fixed;inset:0;z-index:9999;background:rgba(17,17,27,.86);display:flex;align-items:center;justify-content:center;padding:18px;backdrop-filter:blur(6px)}',
    '.csn-modal[hidden]{display:none}',
    '.csn-card{width:100%;max-width:380px;background:linear-gradient(180deg,var(--base),var(--mantle));border:1px solid var(--yellow);border-radius:22px;padding:20px;box-shadow:var(--shadow);text-align:center;display:flex;flex-direction:column;gap:12px}',
    '.csn-card h2{margin:0;font:800 20px/1.2 var(--ff);color:var(--yellow)}',
    '.csn-card .csn-win{font:800 30px/1 var(--fm);color:var(--green);word-break:break-all}',
    '.csn-card p{margin:0;font:600 13px/1.5 var(--ff);color:var(--subtext1)}',
    '.csn-card input{width:100%;min-height:46px;padding:0 12px;border-radius:12px;border:1px solid var(--surface2);background:var(--crust);color:var(--text);font:800 16px/1 var(--fm);text-align:center}',
    '.csn-card button{min-height:46px;border:0;border-radius:12px;background:var(--blue);color:#11111b;font:800 14px/1 var(--ff);cursor:pointer}',
    '.csn-card button.ghost{background:var(--surface0);color:var(--subtext1)}',
    '.csn-card .csn-disclaimer{font:600 11px/1.45 var(--ff);color:var(--overlay0)}'
  ].join('');

  function injectCSS() {
    if (root.document && !root.document.getElementById('csn-style')) {
      var st = root.document.createElement('style');
      st.id = 'csn-style';
      st.textContent = CSS;
      (root.document.head || root.document.documentElement).appendChild(st);
    }
  }

  /* ---------- разметка ---------- */
  function panelHTML() {
    return '' +
      '<div class="csn-top">' +
        '<div class="csn-title">🎰 Казино<small>оффлайн-рофл · виртуальные монеты</small></div>' +
        '<div class="csn-bank"><span>баланс</span><b id="csnBank">—</b></div>' +
      '</div>' +
      '<div class="csn-stats">' +
        '<div class="csn-stat"><b id="csnSpins">0</b><span>кручений</span></div>' +
        '<div class="csn-stat"><b id="csnWins">0</b><span>побед</span></div>' +
        '<div class="csn-stat"><b id="csnBig">0</b><span>макс. выигрыш</span></div>' +
      '</div>' +
      '<div class="csn-seg" id="csnSeg">' +
        '<button data-g="slots" class="on">🎰 Слоты</button>' +
        '<button data-g="roulette">🎡 Рулетка</button>' +
        '<button data-g="dice">🎲 Кости</button>' +
      '</div>' +
      '<div class="csn-panel">' +
        '<div class="csn-bets" id="csnBets"><span>ставка</span>' +
          [10, 25, 50, 100].map(function (b) {
            return '<button class="csn-bet' + (b === S.bet ? ' on' : '') + '" data-b="' + b + '">' + b + '</button>';
          }).join('') +
        '</div>' +
        '<div class="csn-stage" id="csnStage"></div>' +
        '<div class="csn-extra" id="csnExtra"></div>' +
        '<div class="csn-result" id="csnResult">Выбери игру и крути. Удачи! 🍀</div>' +
        '<div class="csn-actions">' +
          '<button class="csn-go" id="csnGo">Крутить · ' + S.bet + '</button>' +
          '<button class="csn-bonus" id="csnBonus">+500 бонус</button>' +
        '</div>' +
      '</div>' +
      '<button class="csn-jackpot" id="csnJackpot">💰 СОРВАТЬ ДЖЕКПОТ · 1 000 000 000 ₽</button>' +
      '<div class="csn-hist" id="csnHist"></div>' +
      '<div class="csn-note">Всё оффлайн. Данные никуда не уходят. Не вводите реальные данные карты в шуточном окне.</div>' +
      '<div class="csn-modal" id="csnModal" hidden>' +
        '<div class="csn-card">' +
          '<h2>🎉 ПОЗДРАВЛЯЮ! 🎉</h2>' +
          '<div class="csn-win" id="csnWinSum">1 000 000 000 ₽</div>' +
          '<p>Вы выиграли миллиард! Напишите цифры вашей карты и три обратные — перевод уже в пути 🐢💨</p>' +
          '<input id="csnCard" inputmode="numeric" maxlength="16" placeholder="цифры, например 1234" autocomplete="off">' +
          '<button id="csnSend">Отправить перевод</button>' +
          '<div id="csnReverse" style="font:800 13px/1.3 var(--fm);color:var(--sky);word-break:break-all"></div>' +
          '<button class="ghost" id="csnClose">Закрыть</button>' +
          '<div class="csn-disclaimer">Шутка. цифры не сохраняются и никуда не отправляются — мини-ап работает оффлайн.</div>' +
        '</div>' +
      '</div>';
  }

  /* Экран сохраняется для совместимости, но кнопка и hotkey скрыты по запросу. */
  function ensureHost() {
    var doc = root.document;
    if (!doc) return null;
    var host = doc.getElementById('screen-casino');
    if (!host) {
      host = doc.createElement('section');
      host.className = 'screen';
      host.id = 'screen-casino';
      var main = doc.getElementById('main');
      if (!main) return null;
      main.appendChild(host);
    }
    if (TAB_VISIBLE) {
      var nav = doc.getElementById('tabs');
      if (nav && !nav.querySelector('[data-tab="casino"]')) {
        var btn = doc.createElement('button');
        btn.className = 'tab';
        btn.setAttribute('data-tab', 'casino');
        btn.innerHTML = '<span>🎰</span> Казино <span class="key">6</span>';
        btn.addEventListener('click', function () {
          if (typeof root.setTab === 'function') root.setTab('casino');
        });
        nav.appendChild(btn);
      }
      var hb = doc.querySelector('.hotbar');
      if (hb && !doc.getElementById('csnHotkey')) {
        var sep = doc.createElement('span'); sep.className = 'sep';
        var hk = doc.createElement('span'); hk.className = 'hk'; hk.id = 'csnHotkey';
        hk.innerHTML = '<kbd>6</kbd> Казино';
        var hks = hb.querySelectorAll('.hk');
        var last = hks[hks.length - 1];
        if (last) { hb.insertBefore(sep, last); hb.insertBefore(hk, last); }
        else { hb.appendChild(sep); hb.appendChild(hk); }
      }
    }
    return host;
  }

  /* Оригинальный setTab проверяет жёсткий список TAB_IDS — оборачиваем его. */
  function patchSetTab() {
    if (root.__csnTabPatched || typeof root.setTab !== 'function') {
      if (typeof root.setTab !== 'function') root.setTimeout(patchSetTab, 120);
      return;
    }
    var orig = root.setTab;
    root.__csnTabPatched = true;
    root.setTab = function (name) {
      if (name !== 'casino') {
        closeJackpot(); // уход с вкладки закрывает модалку (в т.ч. по Esc)
        return orig.apply(this, arguments);
      }
      var doc = root.document;
      Array.prototype.forEach.call(doc.querySelectorAll('.tab[data-tab]'), function (b) {
        b.classList.toggle('active', b.getAttribute('data-tab') === 'casino');
      });
      Array.prototype.forEach.call(doc.querySelectorAll('.screen'), function (s) {
        s.classList.toggle('active', s.id === 'screen-casino');
      });
      var tn = doc.getElementById('taskSubNav'); if (tn) tn.hidden = true;
      var m = doc.getElementById('main'); if (m) m.scrollTop = 0;
    };
  }

  function bindKeys() {
    root.document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var m = root.document.getElementById('csnModal');
        if (m && !m.hidden) { e.preventDefault(); closeJackpot(); }
      }
    });
  }

  function mount() {
    injectCSS();
    var host = ensureHost();
    if (!host || host.dataset.csnMounted === '1') return;
    host.dataset.csnMounted = '1';
    host.innerHTML = '<div class="csn">' + panelHTML() + '</div>';
    bind();
    patchSetTab();
    bindKeys();
    renderAll();
  }

  function $(s, r) { return (r || root.document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || root.document).querySelectorAll(s)); }

  function bind() {
    $$('#csnSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.game = b.dataset.g; save();
        $$('#csnSeg button').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderStage();
      });
    });
    $$('#csnBets .csn-bet').forEach(function (b) {
      b.addEventListener('click', function () {
        S.bet = Number(b.dataset.b); save();
        $$('#csnBets .csn-bet').forEach(function (x) { x.classList.toggle('on', x === b); });
        var go = $('#csnGo'); if (go) go.textContent = 'Крутить · ' + S.bet;
      });
    });
    var go = $('#csnGo'); if (go) go.addEventListener('click', spin);
    var bonus = $('#csnBonus'); if (bonus) bonus.addEventListener('click', function () {
      var res = core.claimBonus(S);
      if (!res.ok) { say('Бонус уже выдан — больше монет не начислим 😉', ''); return; }
      save(); renderAll(); say('Бонус +500 монет. Казино тебя подстраховало 😉', '');
    });
    var jp = $('#csnJackpot'); if (jp) jp.addEventListener('click', openJackpot);
    var close = $('#csnClose'); if (close) close.addEventListener('click', closeJackpot);
    var send = $('#csnSend'); if (send) send.addEventListener('click', sendJackpot);
    var card = $('#csnCard'); if (card) card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); sendJackpot(); }
    });
    var modal = $('#csnModal'); if (modal) modal.addEventListener('click', function (e) {
      if (e.target === modal) closeJackpot();
    });
  }

  function renderAll() {
    var bonusBtn = $('#csnBonus'); if (bonusBtn) bonusBtn.disabled = !!S.bonusClaimed;
    var bank = $('#csnBank'); if (bank) bank.textContent = core.fmt(S.coins);
    var sp = $('#csnSpins'); if (sp) sp.textContent = core.fmt(S.spins);
    var w = $('#csnWins'); if (w) w.textContent = core.fmt(S.wins);
    var big = $('#csnBig'); if (big) big.textContent = core.fmt(S.biggest);
    var hist = $('#csnHist');
    if (hist) hist.innerHTML = S.history.length
      ? S.history.map(function (h) {
          return '<span class="' + (h > 0 ? 'w' : 'l') + '">' + (h > 0 ? '+' : '') + core.fmt(h) + '</span>';
        }).join('')
      : '<span>пока пусто</span>';
    $$('#csnSeg button').forEach(function (x) { x.classList.toggle('on', x.dataset.g === S.game); });
    renderStage();
  }

  function renderStage() {
    if (spinning) return; // во время анимации не пересобираем DOM — иначе колбэки потеряют узлы
    var stage = $('#csnStage'), extra = $('#csnExtra');
    if (!stage || !extra) return;
    if (S.game === 'slots') {
      stage.innerHTML = [0, 1, 2].map(function (i) {
        return '<div class="csn-reel" id="csnR' + i + '">🎰</div>';
      }).join('');
      extra.innerHTML = '<div class="csn-note">3 одинаковых — крупный выигрыш · 2 одинаковых — x1.5</div>';
    } else if (S.game === 'roulette') {
      stage.innerHTML = '<div class="csn-ball" id="csnBall"><b>0</b></div>';
      extra.innerHTML = '<div class="csn-colors" id="csnColors">' +
        '<button class="csn-color on" data-c="red">🔴 Красное ×2</button>' +
        '<button class="csn-color" data-c="black">⚫ Чёрное ×2</button>' +
        '<button class="csn-color" data-c="green">🟢 Ноль ×14</button>' +
        '</div>';
      $$('#csnColors .csn-color').forEach(function (b) {
        b.addEventListener('click', function () {
          S.rouletteChoice = b.dataset.c;
          $$('#csnColors .csn-color').forEach(function (x) { x.classList.toggle('on', x === b); });
        });
      });
    } else {
      stage.innerHTML = '<div class="csn-die" id="csnD0">🎲</div><div class="csn-die" id="csnD1">🎲</div>';
      extra.innerHTML = '<div class="csn-guess" id="csnGuess">' +
        [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (n) {
          return '<button data-n="' + n + '"' + (n === 7 ? ' class="on"' : '') + '>' + n + '</button>';
        }).join('') + '</div>' + '<div class="csn-note">Угадай сумму двух кубиков. Чем реже сумма — тем больше выплата.</div>';
      S.diceGuess = 7;
      $$('#csnGuess button').forEach(function (b) {
        b.addEventListener('click', function () {
          S.diceGuess = Number(b.dataset.n);
          $$('#csnGuess button').forEach(function (x) { x.classList.toggle('on', x === b); });
        });
      });
    }
  }

  function say(text, cls) {
    var el = $('#csnResult'); if (!el) return;
    el.className = 'csn-result' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }

  /* Короткий звук: только после пользовательского жеста, без внешних файлов. */
  var actx = null;
  function beep(win) {
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
      var notes = win ? [523, 659, 784] : [300, 220];
      notes.forEach(function (f, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = win ? 'triangle' : 'sine';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, actx.currentTime + i * 0.09);
        g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + i * 0.09 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + i * 0.09 + 0.16);
        o.connect(g); g.connect(actx.destination);
        o.start(actx.currentTime + i * 0.09);
        o.stop(actx.currentTime + i * 0.09 + 0.18);
      });
    } catch (e) { /* звук — необязателен */ }
  }

  function finish(delta, text) {
    spinning = false;
    var go = $('#csnGo'); if (go) go.disabled = false;
    S.spins += 1;
    if (delta > 0) { S.wins += 1; if (delta > S.biggest) S.biggest = delta; }
    S.history.unshift(delta);
    S.history = S.history.slice(0, 8);
    save(); renderAll();
    say(text, delta > 0 ? 'win' : 'lose');
    beep(delta > 0);
  }

  function tick(node, values, final, done) {
    var i = 0;
    var iv = root.setInterval(function () {
      if (node) node.textContent = values[core.rand(values.length)];
      i += 1;
      if (i >= 9) {
        root.clearInterval(iv);
        if (node) { node.textContent = final; node.classList.remove('spin'); }
        done();
      }
    }, 85);
  }

  function spin() {
    if (spinning) return; // двойной клик во время анимации не списывает ставку повторно
    if (S.coins < S.bet) { say('Не хватает монет — жми «+500 бонус»', 'lose'); return; }
    spinning = true;
    var bet = S.bet; // фиксируем ставку на момент клика — смена ставки в анимации не влияет на расчёт
    var go = $('#csnGo'); if (go) go.disabled = true;
    S.coins -= bet; save();

    if (S.game === 'slots') {
      var syms = core.SYMBOLS.map(function (s) { return s.s; });
      var n0 = $('#csnR0'), n1 = $('#csnR1'), n2 = $('#csnR2');
      [n0, n1, n2].forEach(function (n) {
        if (n) { n.textContent = syms[core.rand(syms.length)]; n.classList.add('spin'); }
      });
      var a = syms[core.rand(syms.length)], b = syms[core.rand(syms.length)], c = syms[core.rand(syms.length)];
      root.setTimeout(function () {
        if (n0) n0.textContent = a; if (n1) n1.textContent = b; if (n2) n2.textContent = c;
        [n0, n1, n2].forEach(function (n) { if (n) n.classList.remove('spin'); });
        var pay = core.slotsPayout(a, b, c, bet);
        S.coins += pay;
        finish(pay - bet, pay > 0 ? '🎰 ВЫИГРЫШ ' + core.fmt(pay) + ' монет! ' + a + b + c : 'Мимо. ' + a + b + c + ' — попробуй ещё раз');
      }, 820);
    } else if (S.game === 'roulette') {
      var ball = $('#csnBall'); if (ball) ball.classList.add('spin');
      var number = core.rand(37);
      var choice = S.rouletteChoice || 'red';
      tick(ball ? $('b', ball) : null, ['0', '7', '13', '22', '31', '36'], String(number), function () {
        if (ball) ball.style.background = number === 0
          ? 'conic-gradient(#2ecc71 0 100%)'
          : core.rouletteColor(number) === 'red'
            ? 'conic-gradient(#e74c3c 0 97%,#f1c40f 97% 100%)'
            : 'conic-gradient(#2c3e50 0 97%,#f1c40f 97% 100%)';
        var pay = core.roulettePayout(number, choice, bet);
        S.coins += pay;
        finish(pay - bet, pay > 0
          ? '🎡 Выпало ' + number + ' — ' + (pay === bet * 14 ? 'ДЖЕКПОТ! ×14' : 'победа ×2') + ' +' + core.fmt(pay)
          : '🎡 Выпало ' + number + ' (' + core.rouletteColor(number) + ') — не твоё');
        setTimeout(function () { if (ball) ball.style.background = ''; }, 1400);
      });
    } else {
      var d0 = $('#csnD0'), d1 = $('#csnD1');
      if (d0) d0.classList.add('spin'); if (d1) d1.classList.add('spin');
      var faces = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
      var x = 1 + core.rand(6), y = 1 + core.rand(6), sum = x + y;
      tick(d0, faces, faces[x - 1], function () {});
      root.setTimeout(function () {
        if (d0) d0.classList.remove('spin'); if (d1) d1.classList.remove('spin');
        if (d1) d1.textContent = faces[y - 1];
        var pay = core.dicePayout(sum, bet);
        S.coins += pay;
        finish(pay - bet, pay > 0
          ? '🎲 Сумма ' + sum + ' — выигрыш +' + core.fmt(pay)
          : '🎲 Сумма ' + sum + ' — не угадал');
      }, 820);
    }
  }

  /* ---------- джекпот-рофл: ничего не отправляется и не сохраняется ---------- */
  function openJackpot() {
    var m = $('#csnModal'); if (!m) return;
    m.hidden = false;
    var out = $('#csnReverse'); if (out) out.textContent = '';
    var inp = $('#csnCard'); if (inp) { inp.value = ''; root.setTimeout(function () { inp.focus(); }, 50); }
  }
  function closeJackpot() {
    var m = $('#csnModal'); if (m) m.hidden = true;
    var inp = $('#csnCard'); if (inp) inp.value = '';
  }
  function sendJackpot() {
    var inp = $('#csnCard'), out = $('#csnReverse');
    var val = inp ? inp.value : '';
    var rev = core.reverseDigits(val);
    if (out) out.textContent = rev ? 'Обратные цифры: ' + rev + ' 🐢💨' : 'Введи хоть какую-нибудь цифру 😉';
    if (inp) inp.value = '';
  }

  var api = { core: core, mount: mount, state: S };
  root.Casino = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;

  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', mount);
    } else { mount(); }
  }
})();
