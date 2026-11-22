/* СГЕНЕРИРОВАНО build_casino_activity.py — НЕ ПРАВИТЬ РУКАМИ.
   Оффлайн-рофл: крутки за реальную активность в промптах.
   Источник цифр: prompts-3days.json (окно 19.11–22.11), пересчёт по 2026-11-22T08:14:18Z.
   Ничего не отправляется в сеть, баланс виртуальный. */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var KEY = 'pairdev_casino_activity_v1';
  var DATA = {"counts":{"1869196044":729,"435824119":84},"users":{"1869196044":"Аскольд","435824119":"Иван"},"samples":{"1869196044":["lree-META-NO-STOP-c1","autopilot-evo3","Подключение скилов Anthropic","lree-META-NO-STOP-c1","Метанализ вариантов за $20","Проверить атлас по новой фазе","Проверить атлас по новой фазе","Управление агентами на 20 часов","lree-META-NO-STOP-c2","Сравнение моделей с веб-DeepSeek","verify-evo2","verifier-v4"],"435824119":["Шаг 2. В edit_status замени голый except: pass на:","Шаг 2. В edit_status замени голый except: pass на:","что такое ротация и почему не включена компакция делай то что пр","Как прогресс когда будет оверлей рабочий","Опять нет ответа спустя 662с зависло Можешь презентацию одним фа","Выполни ровно файл ~/docs/cleanup-2026-11-20/tasks/T0b.md. [памя","Выполни ровно файл ~/docs/cleanup-2026-11-20/tasks/T0a.md. [памя","Расскажи кратко по каждому пункту что проделал параноик","Зависло на 68с росло три почему мы же сегодня это чинили","Сценарии открываются но там пусто. Плюс сам бар кнопок не листае","Ну и","ses_e01b393c5ffe1shfp3pj5HgJ2l статус"]},"rate":10,"window":"19.11–22.11","total":814,"unknown":1,"built":"2026-11-22T08:14:18Z","fingerprint":"8dbe003da559"};
  var RATE = DATA.rate;
  var ID = { OWNER: '1869196044', GUEST: '435824119' };

  /* ---------- чистая логика (тестируется в Node без DOM) ---------- */
  var core = {
    fmt: function (n) {
      return String(Math.floor(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    },
    spinsFor: function (prompts, rate) {
      return Math.max(0, Math.floor((Number(prompts) || 0) / (Number(rate) || 1)));
    },
    recalc: function (counts, rate) {
      var out = [], totalPrompts = 0, totalSpins = 0;
      Object.keys(counts).forEach(function (id) {
        var n = Math.max(0, Number(counts[id]) || 0);
        var s = core.spinsFor(n, rate);
        out.push({ id: id, name: DATA.users[id] || 'Кто-то', prompts: n, spins: s });
        totalPrompts += n;
        totalSpins += s;
      });
      out.sort(function (a, b) { return b.prompts - a.prompts; });
      return { per: out, totalPrompts: totalPrompts, totalSpins: totalSpins };
    },
    whoFromId: function (id) {
      return DATA.users[String(id)] ? String(id) : ID.OWNER;
    },
    welcome: function (id, rec, granted, used) {
      var my = rec.per.filter(function (p) { return p.id === id; })[0] || rec.per[0];
      var lines = [
        '🔄 ПЕРЕРАСЧЁТ ПО АКТИВНОСТИ · ' + DATA.window,
        'Ты — ' + (DATA.users[id] || 'Гость') + ': ' + core.fmt(my.prompts) +
          ' промптов → ' + core.fmt(granted) + ' круток 🌀 (курс ' + RATE + ':1, не обсуждается)'
      ];
      rec.per.forEach(function (p) {
        if (p.id !== id) lines.push(p.name + ': ' + core.fmt(p.prompts) + ' промптов → ' + core.fmt(p.spins) + ' круток');
      });
      lines.push('Заудомачено ' + core.fmt(used) + ' из ' + core.fmt(my.prompts) +
                 '. Промпт → крутка → рофл. Жалобы в /dev/null 🐢💨');
      return lines.join('\n');
    },
    joke: function (i, title) {
      var jokes = [
        'Заудоманил «' + title + '» — крутка зачислена, совесть осталась дома 🏠',
        'Промпт конвертирован. Курс ' + RATE + ':1, брокер — кот 🐈',
        '+' + RATE + ' очков кармы, -1 промпт. Баланс крутится быстрее языка 💫',
        'Заудомачивание завершено. Аскольд одобрил бы 👀',
        'Иван бы завидовал, но у него ' + core.fmt(DATA.counts[ID.GUEST] || 0) + ' промптов — тоже не голодный 😉'
      ];
      return jokes[i % jokes.length];
    }
  };

  /* ---------- состояние ---------- */
  var S = { current: ID.OWNER, grants: {}, used: {}, fp: '' };
  function load() {
    try {
      var p = JSON.parse(root.localStorage && root.localStorage.getItem(KEY) || 'null');
      if (p && typeof p === 'object') {
        S.current = DATA.users[p.current] ? p.current : ID.OWNER;
        S.grants = p.grants && typeof p.grants === 'object' ? p.grants : {};
        S.used = p.used && typeof p.used === 'object' ? p.used : {};
        S.fp = p.fp || '';
      }
    } catch (e) { /* приватный режим */ }
    if (S.fp !== DATA.fingerprint) {
      /* новая выгрузка промптов = честный перерасчёт, старые бонусы сгорают */
      var r0 = core.recalc(DATA.counts, RATE);
      S.grants = {}; S.used = {};
      r0.per.forEach(function (p) { S.grants[p.id] = p.spins; S.used[p.id] = 0; });
      S.fp = DATA.fingerprint;
      save();
    }
    try {
      var uid = String((((root.Telegram && root.Telegram.WebApp &&
        root.Telegram.WebApp.initDataUnsafe) || {}).user || {}).id || root.tg &&
        ((root.tg.initDataUnsafe || {}).user || {}).id || '');
      if (uid) S.current = core.whoFromId(uid);
    } catch (e) { /* без Telegram — владелец по умолчанию */ }
  }
  function save() {
    try { root.localStorage && root.localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {}
  }

  /* ---------- внедрение в уже смонтированную вкладку ---------- */
  var CSS = [
    '#csn-activity-style',
    '.csn-welcome{background:linear-gradient(135deg,rgba(249,226,175,.14),rgba(137,180,250,.12));',
    'border:1px solid var(--yellow);border-radius:16px;padding:12px 14px;',
    'font:700 12px/1.5 var(--ff);color:var(--text);white-space:pre-line}',
    '.csn-welcome b{color:var(--yellow)}',
    '.csn-welcome .csn-who{display:flex;gap:6px;margin-top:9px}',
    '.csn-welcome .csn-who button{flex:1;min-height:36px;border-radius:10px;border:1px solid var(--surface2);',
    'background:var(--mantle);color:var(--subtext1);font:700 11px/1 var(--ff);cursor:pointer}',
    '.csn-welcome .csn-who button.on{border-color:var(--yellow);color:var(--yellow);background:rgba(249,226,175,.1)}',
    '.csn-activity-btn{min-height:46px;border:1px solid var(--sapphire);border-radius:12px;',
    'background:rgba(116,199,236,.1);color:var(--sapphire);font:800 12px/1 var(--ff);cursor:pointer}'
  ];
  function injectCSS() {
    if (!root.document || root.document.getElementById('csn-activity-style')) return;
    var st = root.document.createElement('style');
    st.id = 'csn-activity-style';
    st.textContent = CSS.slice(1).join('');
    (root.document.head || root.document.documentElement).appendChild(st);
  }
  function el(tag, cls, text) {
    var n = root.document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function findCsn() {
    var host = root.document && root.document.querySelector('#screen-casino .csn');
    return host || null;
  }
  function say(text) {
    var r = root.document && root.document.getElementById('csnResult');
    if (r) { r.className = 'csn-result win'; r.textContent = text; }
  }
  function refreshBank(delta) {
    if (!delta) return;
    var casino = root.Casino;
    if (casino && casino.state) {
      casino.state.coins = Math.max(0, (Number(casino.state.coins) || 0) + delta);
    }
    var b = root.document && root.document.getElementById('csnBank');
    if (b) b.textContent = core.fmt(casino && casino.state ? casino.state.coins : delta);
  }

  var tries = 0, timer = null;
  function boot() {
    if (!root.document) return;
    var host = findCsn();
    if (!host || host.querySelector('.csn-welcome')) {
      if (!host && tries++ < 40) { timer = root.setTimeout(boot, 150); }
      return;
    }
    if (timer) { root.clearTimeout(timer); timer = null; }
    injectCSS();
    load();
    var rec = core.recalc(DATA.counts, RATE);
    var banner = el('div', 'csn-welcome');
    banner.id = 'csnWelcome';
    var msg = el('div', 'csn-msg');
    banner.appendChild(msg);
    host.insertBefore(banner, host.firstChild);

    var choose = el('div', 'csn-who');
    rec.per.slice(0, 2).forEach(function (p) {
      var b = el('button', p.id === S.current ? 'on' : '', p.name + ' · ' + core.fmt(p.prompts) + ' промптов');
      b.addEventListener('click', function () {
        S.current = p.id; save(); render();
        say('Теперь ты ' + p.name + '. Крутки ' + p.name + ' — тоже его, не жадничай 😏');
      });
      choose.appendChild(b);
    });
    banner.appendChild(choose);

    var act = el('div', 'csn-actions');
    var mine = el('button', 'csn-activity-btn', '🧠 Заудоманить промпт → +1 крутка');
    act.appendChild(mine);
    banner.parentNode.insertBefore(act, banner.nextSibling);

    function render() {
      var used = Number(S.used[S.current]) || 0;
      var granted = Number(S.grants[S.current]) || 0;
      msg.textContent = core.welcome(S.current, rec, granted, used);
      Array.prototype.forEach.call(choose.children, function (b, i) {
        b.classList.toggle('on', rec.per[i] && rec.per[i].id === S.current);
      });
      mine.disabled = used >= (DATA.counts[S.current] || 0);
      mine.textContent = mine.disabled
        ? '✅ Все промпты заудомачены. Иди пиши новые'
        : '🧠 Заудоманить промпт → +1 крутка (' + core.fmt(used + 1) + '/' +
          core.fmt(DATA.counts[S.current] || 0) + ')';
    }
    mine.addEventListener('click', function () {
      var pool = DATA.samples[S.current] || [];
      var used = Number(S.used[S.current]) || 0;
      var max = DATA.counts[S.current] || 0;
      if (used >= max) { render(); return; }
      S.used[S.current] = used + 1;
      S.grants[S.current] = (Number(S.grants[S.current]) || 0) + 1;
      save(); render();
      refreshBank(25);
      say(core.joke(used, pool[used % (pool.length || 1)] || 'очередной промпт'));
    });
    render();
    /* первое сообщение при открытии — перерасчёт, а не «Выбери игру» */
    say(core.welcome(S.current, rec, Number(S.grants[S.current]) || 0,
                     Number(S.used[S.current]) || 0));
  }

  var api = { core: core, data: DATA, boot: boot, state: S };
  root.CasinoActivity = api;

  /* @owner:casino-vibes @region:vibes-loader — подключение трек-контейнера и цитатника.
     Идемпотентно: повторный вызов не создаст второй тег. */
  try {
    if (root.document && !root.document.getElementById('csn-vibes-loader')) {
      var vs = root.document.createElement('script');
      vs.id = 'csn-vibes-loader';
      vs.src = 'casino-vibes.js?v=20261122-vibes1';
      (root.document.head || root.document.documentElement).appendChild(vs);
    }
  } catch (e) { /* без вайбов казино остаётся рабочим */ }

  if (typeof module !== 'undefined' && module.exports) module.exports = core;
  if (root.document) {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', boot);
    } else { boot(); }
  }
})();
