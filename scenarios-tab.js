/* Вкладка «Сценарии» для мини-апа PairDevBot. Без зависимостей, любой стек.
   Подключение: <script src="scenarios-tab.js"></script>
   QrunScenarios.mount(element, {
     url: '/api/scenarios',          // откуда брать scenarios.json (или data: {...} — сразу данные)
     fallbackUrl: '/scenarios.json', // статика Pages: /api/scenarios там нет, берём свежий файл
     addUrl: '/api/qrun/add',        // POST {queue, text} → шаг в очередь qrun (при 404 — копирование команды)
     headers: {...},                 // заголовки авторизации для url/addUrl (например initData Telegram)
     queue: 'changes'                // очередь, куда падают правки сценариев
   }) */
(function () {
  'use strict';
  var CSS = [
    '.qs{--bg:#0B0F1A;--card:#141A2B;--raised:#1B2236;--line:#283049;--tx:#F1F3F9;--mut:#A6AEC6;--sub:#C9CFDF;',
    '--dim:#8E97B2;--blue:#5AA2FF;--btn:#2563EB;--link:#8DBEFF;--amb:#FFB547;--amb2:#FFC56B;--red:#FF7A7A;--red2:#FF9A9A;',
    '--grn:#4ADE9B;--grn2:#6BE7AF;background:var(--bg);color:var(--tx);font:15px/1.4 Inter,system-ui,-apple-system,sans-serif;',
    'max-width:520px;margin:0 auto;padding:0 0 24px;-webkit-font-smoothing:antialiased}',
    '.qs *{box-sizing:border-box}.qs button{font:inherit;color:inherit;cursor:pointer}',
    '.qs h1,.qs h2{font-family:Manrope,Inter,system-ui,sans-serif;font-weight:800;margin:0}',
    '.qs-head{display:flex;align-items:center;gap:12px;padding:20px 20px 8px}',
    '.qs-logo{flex:none;width:44px;height:44px;border-radius:14px;background:var(--raised);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--blue)}',
    '.qs-kick{font-size:13px;color:var(--mut);font-weight:500}.qs-head h1{font-size:21px;line-height:1.2}',
    '.qs-snap{margin:0 16px;display:flex;align-items:center;gap:8px;padding:4px 4px 4px 12px;border-radius:14px;background:var(--card);border:1px solid var(--line)}',
    '.qs-snap span{flex:1;font-size:13px;color:var(--sub);line-height:1.35;padding:8px 0}',
    '.qs-ghost{flex:none;min-height:44px;padding:0 12px;border-radius:10px;border:0;background:var(--raised);color:var(--link);font-weight:600;font-size:14px}',
    '.qs-tiles{padding:14px 16px 0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}',
    '.qs-tile{min-height:92px;padding:10px;border-radius:16px;display:flex;flex-direction:column;justify-content:space-between;align-items:flex-start;gap:4px;text-align:left}',
    '.qs-tile b{font-family:Manrope,Inter,sans-serif;font-size:22px;font-weight:800;line-height:1}.qs-tile b small{font-size:14px;color:var(--sub)}',
    '.qs-tile span{font-size:12.5px;line-height:1.3;color:var(--sub)}',
    '.qs-seg{margin:16px 16px 0;padding:4px;border-radius:14px;background:var(--card);border:1px solid var(--line);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}',
    '.qs-seg button{min-height:44px;border-radius:10px;border:0;background:transparent;color:var(--sub);font-weight:700}',
    '.qs-seg button[aria-selected=true]{background:var(--btn);color:#fff}',
    '.qs-hint{margin:10px 20px 0;font-size:14px;line-height:1.45;color:var(--mut)}',
    '.qs-list{padding:12px 16px 0;display:flex;flex-direction:column;gap:10px}',
    '.qs-card{border-radius:20px;background:var(--card);border:1px solid var(--line);overflow:hidden}',
    '.qs-card.warn{border-color:rgba(255,181,71,.45)}.qs-card.bad{border-color:rgba(255,122,122,.55)}.qs-card.open{border-color:#3A4466}',
    '.qs-ch{width:100%;padding:14px 12px 14px 14px;border:0;background:transparent;display:flex;align-items:flex-start;gap:12px;text-align:left}',
    '.qs-ic{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center}',
    '.qs-ok{background:rgba(74,222,155,.14);color:var(--grn)}.qs-warn{background:rgba(255,181,71,.14);color:var(--amb)}',
    '.qs-bad{background:rgba(255,122,122,.14);color:var(--red)}.qs-idle{background:rgba(139,147,173,.16);color:#AEB5CC}',
    '.qs-tt{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.qs-tt>b{font-size:17px;line-height:1.25}',
    '.qs-tt>i{font-style:normal;font-size:14px;color:var(--mut)}.qs-chips{display:flex;flex-wrap:wrap;gap:6px;padding-top:2px}',
    '.qs-chip{padding:3px 8px;border-radius:8px;background:var(--raised);color:var(--sub);font-size:12.5px;font-weight:600}',
    '.qs-chip.ok{background:rgba(74,222,155,.14);color:var(--grn2)}.qs-chip.warn{background:rgba(255,181,71,.14);color:var(--amb2)}',
    '.qs-chip.bad{background:rgba(255,122,122,.14);color:var(--red2)}.qs-chip.idle{background:rgba(139,147,173,.16);color:#C3C9DB}',
    '.qs-chev{flex:none;margin-top:11px;color:var(--dim);transition:transform .2s}.open .qs-chev{transform:rotate(180deg)}',
    '.qs-body{padding:0 14px 16px;display:flex;flex-direction:column;gap:12px}',
    '.qs-tog{padding:3px;border-radius:12px;background:var(--bg);display:grid;grid-template-columns:1fr 1fr;gap:3px}',
    '.qs-tog button{min-height:44px;border-radius:9px;border:0;background:transparent;color:var(--mut);font-weight:700;font-size:14px}',
    '.qs-tog button[aria-selected=true]{background:var(--raised);color:var(--tx)}',
    '.qs-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}',
    '.qs-st{display:flex;gap:8px;align-items:flex-start}.qs-st.d1{margin-left:10px;padding-left:10px;border-left:2px solid #2E3654}',
    '.qs-st.d2{margin-left:28px;padding-left:10px;border-left:2px solid #2E3654}',
    '.qs-mk{flex:none;width:22px;height:22px;margin-top:9px;border-radius:50%;font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center}',
    '.qs-sb{flex:1;min-width:0;padding:8px 10px;border-radius:12px;background:#0F1422;border:1px solid #232B44;display:flex;flex-direction:column;gap:3px}',
    '.qs-sb.unused{border-style:dashed;border-color:#4A5578}.qs-sb.loop{border-color:rgba(255,122,122,.55)}',
    '.qs-sl{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.qs-k{padding:2px 6px;border-radius:6px;font-size:11.5px;font-weight:700}',
    '.qs-sl b{font-size:15px;line-height:1.3;word-break:break-word}.qs-f{padding:1px 6px;border-radius:6px;border:1px solid rgba(255,181,71,.55);color:var(--amb2);font-size:11.5px;font-weight:700}',
    '.qs-n{font-size:13px;color:var(--mut)}.qs-u{font-size:12.5px;font-weight:600;color:var(--red2)}.qs-m{font-size:12.5px;font-weight:600;color:var(--amb2)}',
    '.qs-empty{margin:0;padding:12px;border-radius:12px;background:var(--bg);font-size:14px;color:var(--sub)}',
    '.qs-h3{margin:0;font-size:12.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--mut)}',
    '.qs-is{display:flex;gap:8px;align-items:flex-start;font-size:14px;color:#E1E5F0}.qs-is.fixed{color:var(--grn2)}',
    '.qs-is em{flex:none;font-style:normal;padding:1px 6px;border-radius:6px;background:rgba(255,181,71,.14);color:var(--amb2);font-size:12px;font-weight:700}',
    '.qs-is.fixed em{background:rgba(74,222,155,.14);color:var(--grn2)}',
    '.qs-primary{min-height:52px;width:100%;border-radius:14px;border:0;background:var(--btn);color:#fff!important;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:8px}',
    '.qs-primary[disabled]{background:#33405F;cursor:default}',
    '.qs-second{min-height:52px;width:100%;border-radius:14px;border:1px solid var(--line);background:var(--raised);font-size:16px;font-weight:600}',
    '.qs-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--dim)}',
    '.qs-svc{padding:12px 14px;border-radius:18px;background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;gap:6px}',
    '.qs-svc.warn{border-color:rgba(255,181,71,.4)}.qs-svc.bad{border-color:rgba(255,122,122,.55)}',
    '.qs-svc>div{display:flex;align-items:center;gap:8px}.qs-svc>div b{flex:1;font-size:16px}',
    '.qs-dot{flex:none;width:10px;height:10px;border-radius:50%}',
    '.qs-dups{padding:28px 16px 0;display:flex;flex-direction:column;gap:10px}.qs-dups h2{font-size:19px}',
    '.qs-dup{padding:12px 14px;border-radius:18px;background:var(--card);border:1px solid var(--line);display:flex;flex-direction:column;gap:8px}',
    '.qs-dup>div:first-child{display:flex;align-items:baseline;gap:8px}.qs-dup>div:first-child b{flex:1;font-size:16px}',
    '.qs-cnt{flex:none;font-family:Manrope,Inter,sans-serif;font-weight:800;color:var(--grn2)}',
    '.qs-tags{display:flex;flex-wrap:wrap;gap:6px}.qs-tag{padding:3px 8px;border-radius:8px;background:var(--raised);color:#E1E5F0;font-size:12.5px;font-weight:600}',
    '.qs-tag.unused{background:rgba(139,147,173,.10);color:var(--dim);text-decoration:line-through}',
    '.qs-tag.merged{background:rgba(74,222,155,.10);color:var(--grn2);text-decoration:line-through}',
    '.qs-ed{padding:4px 16px 0;display:flex;flex-direction:column;gap:18px}',
    '.qs-back{min-height:44px;margin:12px 0 0 8px;padding:0 10px 0 4px;border:0;background:transparent;color:var(--link)!important;font-weight:600;font-size:16px;display:flex;align-items:center;gap:4px}',
    '.qs-picks{display:flex;flex-wrap:wrap;gap:6px}.qs-pick{min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--sub);font-size:14.5px;font-weight:600}',
    '.qs-pick[aria-pressed=true]{border-color:var(--blue);background:rgba(90,162,255,.16);color:var(--tx)}',
    '.qs-es{padding:12px;border-radius:16px;border:1px solid var(--line);background:var(--card);display:flex;align-items:flex-start;gap:10px;text-align:left;width:100%}',
    '.qs-es.remove{border-color:rgba(255,122,122,.55)}.qs-es.replace{border-color:rgba(255,181,71,.55)}',
    '.qs-es>span:first-child{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px}.qs-es b{font-size:15.5px}',
    '.qs-es.remove b{text-decoration:line-through}.qs-alt{font-size:14px;color:var(--amb2)}.qs-can{font-size:13px;color:var(--dim)}',
    '.qs-tag2{flex:none;min-width:84px;height:32px;padding:0 10px;border-radius:10px;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;background:var(--raised);color:var(--sub)}',
    '.remove .qs-tag2{background:rgba(255,122,122,.16);color:var(--red2)}.replace .qs-tag2{background:rgba(255,181,71,.16);color:var(--amb2)}',
    '.qs-opt{min-height:48px;padding:10px 12px;border-radius:14px;border:1px solid var(--line);background:var(--card);display:flex;align-items:center;gap:10px;text-align:left;width:100%;font-size:14.5px}',
    '.qs-opt[aria-pressed=true],.qs-opt[aria-checked=true]{border-color:var(--blue);background:rgba(90,162,255,.10)}',
    '.qs-box{flex:none;width:22px;height:22px;border-radius:7px;border:2px solid #4A5578;display:flex;align-items:center;justify-content:center;color:#06142B}',
    '[aria-pressed=true] .qs-box{border-color:var(--blue);background:var(--blue)}',
    '.qs-rad{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid #4A5578;display:flex;align-items:center;justify-content:center}',
    '[aria-checked=true] .qs-rad{border-color:var(--blue)}[aria-checked=true] .qs-rad:after{content:"";width:10px;height:10px;border-radius:50%;background:var(--blue)}',
    '.qs-ta{width:100%;resize:vertical;min-height:84px;border-radius:14px;border:1px solid var(--line);background:var(--card);color:var(--tx);padding:12px;font:16px/1.4 inherit}',
    '.qs-ta::placeholder{color:var(--dim)}',
    '.qs-sw{min-height:60px;padding:10px 12px;border-radius:16px;border:1px solid var(--line);background:var(--card);display:flex;align-items:center;gap:12px;text-align:left;width:100%}',
    '.qs-sw>span:first-child{flex:1;display:flex;flex-direction:column;gap:2px}.qs-sw small{font-size:13px;color:var(--mut)}',
    '.qs-trk{flex:none;width:50px;height:30px;border-radius:15px;background:#3A4466;display:flex;align-items:center;padding:0 3px}',
    '.qs-trk:after{content:"";width:24px;height:24px;border-radius:50%;background:#fff}[aria-checked=true] .qs-trk{background:var(--btn);justify-content:flex-end}',
    '.qs-pre{margin:0;padding:12px;border-radius:14px;background:#0F1422;border:1px solid #232B44;color:#DCE1EE;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}',
    '.qs-foot{position:sticky;bottom:0;margin-top:18px;background:var(--bg);border-top:1px solid #1E2540;padding:12px 16px 16px;display:flex;flex-direction:column;gap:8px}',
    '.qs-row2{display:grid;grid-template-columns:2fr 1fr;gap:8px}.qs-msg{padding:12px;border-radius:14px;font-size:14.5px;line-height:1.4;white-space:pre-wrap}',
    '.qs-msg.ok{background:rgba(74,222,155,.12)}.qs-msg.err{background:rgba(255,122,122,.12)}',
    '.qs label.qs-h3{display:block;margin-bottom:8px}.qs-sec{display:flex;flex-direction:column;gap:8px}'
  ].join('');
  var KIND = {
    ctx: ['контекст', 'rgba(174,181,204,.16)', '#C3C9DB'], agent: ['агент', 'rgba(90,162,255,.16)', '#8DBEFF'],
    sub: ['подагент', 'rgba(90,162,255,.16)', '#8DBEFF'], skill: ['скил', 'rgba(182,156,255,.16)', '#CDBBFF'],
    tool: ['инструменты', 'rgba(174,181,204,.10)', '#B4BBD0'], script: ['скрипт', 'rgba(79,209,197,.14)', '#7DE3D8'],
    rule: ['гардрейл', 'rgba(255,181,71,.14)', '#FFC56B'], loop: ['петля', 'rgba(255,122,122,.16)', '#FF9A9A'],
    out: ['результат', 'rgba(74,222,155,.14)', '#6BE7AF']
  };
  var LVL = { ok: '#4ADE9B', warn: '#FFB547', bad: '#FF7A7A', idle: '#AEB5CC' };
  var ICON = {
    ok: '<path d="m5 12.5 4.5 4.5L19 7.5"/>', warn: '<path d="M4 7h11"/><path d="m12 4 3 3-3 3"/><path d="M20 17H9"/><path d="m12 14-3 3 3 3"/>',
    bad: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', idle: '<path d="M9 6v12"/><path d="M15 6v12"/>'
  };
  function svg(p, s) {
    return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }
  var TREE = svg('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7"/><path d="M8.5 6H14a4 4 0 0 1 4 4v5.5"/>', 22);
  var CHEV = svg('<path d="m6 9 6 6 6-6"/>', 18);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function dur(s) { return s == null ? '' : s < 90 ? s + ' с' : '≈' + Math.round(s / 60) + ' мин'; }
  function plural(n, a, b, c) { var x = n % 10, y = n % 100; return x === 1 && y !== 11 ? a : x >= 2 && x <= 4 && (y < 12 || y > 14) ? b : c; }

  function mount(el, opts) {
    opts = opts || {};
    if (!document.getElementById('qs-css')) {
      var st = document.createElement('style'); st.id = 'qs-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    var S = { seg: 'typ', open: null, view: 'actual', screen: 'list', data: opts.data || null, err: '', loading: false,
      ed: { id: null, ch: {}, ad: {}, wh: {}, note: '', dry: true, msg: '', msgKind: '' } };
    var queue = opts.queue || 'changes';

    function load() {
      S.loading = true; render();
      var urls = [opts.url, opts.fallbackUrl || '/scenarios.json', './scenarios.json', '/tg-miniapp/scenarios.json']
        .filter(function (v, i, a) { return v && a.indexOf(v) === i; });
      var i = 0, lastErr = '';
      function step() {
        if (i >= urls.length) { S.err = 'Не загрузилось: ' + lastErr; S.loading = false; render(); return; }
        var url = urls[i++];
        fetch(url, { headers: opts.headers || {}, cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' (' + url + ')'); return r.json();
        }).then(function (d) {
          if (!d || !Array.isArray(d.scenarios) || !d.scenarios.length) throw new Error('пустой scenarios в ' + url);
          S.data = d; S.source = url; S.err = ''; S.loading = false; render();
        }).catch(function (e) { lastErr = e.message; step(); });
      }
      step();
    }
    function scen() { return (S.data && S.data.scenarios) || []; }
    function find(id) { return scen().filter(function (x) { return x.id === id; })[0]; }
    function dupsScenario() {
      var d = (S.data && S.data.dups) || [];
      return { id: 'dups', title: 'Чистка дублей', actual: [], edit: {
        steps: d.filter(function (x) { return !x.done; }).map(function (x) {
          return { n: x.title + ': ' + x.items.map(function (i) { return i.n; }).join(', '), alt: x.plan, f: x.c, 'default': 'replace' };
        }), adds: [], when: ['Одной задачей по фазам'] } };
    }

    function stepsHtml(arr) {
      var n = 0;
      return '<ol class="qs-steps">' + arr.map(function (x) {
        var k = KIND[x.k] || KIND.tool, d = x.d || 0; if (!d) n++;
        return '<li class="qs-st' + (d ? ' d' + Math.min(d, 2) : '') + '"><span class="qs-mk" style="background:' + k[1] + ';color:' + k[2] + '">' + (d ? '•' : n) + '</span>' +
          '<div class="qs-sb' + (x.u ? ' unused' : '') + (x.k === 'loop' ? ' loop' : '') + '"><span class="qs-sl"><span class="qs-k" style="background:' + k[1] + ';color:' + k[2] + '">' + k[0] + '</span>' +
          '<b>' + esc(x.n) + '</b>' + (x.f ? '<span class="qs-f">' + esc(x.f) + '</span>' : '') + '</span>' +
          (x.t ? '<span class="qs-n">' + esc(x.t) + '</span>' : '') +
          (x.u ? '<span class="qs-u">0 вызовов за окно</span>' : '') + (x.missing ? '<span class="qs-m">нет в конфиге</span>' : '') + '</div></li>';
      }).join('') + '</ol>';
    }

    function card(c) {
      var open = S.open === c.id, steps = S.view === 'actual' ? c.actual : c.declared;
      var time = c.median_s != null ? dur(c.median_s) + (c.max_s && c.max_s > c.median_s * 1.5 ? ', макс ' + dur(c.max_s) : '') : '';
      return '<article class="qs-card ' + c.status + (open ? ' open' : '') + '">' +
        '<button class="qs-ch" data-a="toggle" data-id="' + esc(c.id) + '" aria-expanded="' + open + '">' +
        '<span class="qs-ic qs-' + c.status + '">' + svg(ICON[c.status] || ICON.idle) + '</span>' +
        '<span class="qs-tt"><b>' + esc(c.title) + '</b><i>' + esc(c.when) + '</i><span class="qs-chips">' +
        '<span class="qs-chip ' + c.status + '">' + esc(c.status_text) + '</span>' +
        '<span class="qs-chip">' + c.runs + ' ' + plural(c.runs, 'запуск', 'запуска', 'запусков') + '</span>' +
        (time ? '<span class="qs-chip">' + time + '</span>' : '') + '</span></span><span class="qs-chev">' + CHEV + '</span></button>' +
        (open ? '<div class="qs-body"><div class="qs-tog" role="tablist">' +
          '<button role="tab" data-a="view" data-v="actual" aria-selected="' + (S.view === 'actual') + '">Как было · трассы</button>' +
          '<button role="tab" data-a="view" data-v="declared" aria-selected="' + (S.view === 'declared') + '">Как задумано · конфиг</button></div>' +
          (steps.length ? stepsHtml(steps) : '<p class="qs-empty">' + esc(c.empty) + '</p>') +
          (c.issues.length ? '<div class="qs-sec"><h3 class="qs-h3">Что не так</h3>' + c.issues.map(function (i) {
            return '<div class="qs-is' + (i.fixed ? ' fixed' : '') + '"><em>' + esc(i.id) + '</em><span>' + (i.fixed ? '✓ исправлено: ' : '') + esc(i.text) + '</span></div>';
          }).join('') + '</div>' : '') +
          '<div class="qs-sec"><button class="qs-primary" data-a="edit" data-id="' + esc(c.id) + '">' + svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>', 18) + 'Изменить сценарий</button>' +
          (c.example.length ? '<span class="qs-mono">пример: ' + c.example.map(esc).join(', ') + '</span>' : '') + '</div></div>' : '') +
        '</article>';
    }

    function listHtml() {
      var d = S.data, sm = d.summary, w = d.window;
      var segs = [['typ', 'Типовые'], ['big', 'Большие'], ['svc', 'Фон']];
      var hint = { typ: 'Цепочки, которые повторяются. Нажмите на сценарий — откроется дерево: кто кого зовёт и в каком порядке.',
        big: 'Открытые большие задачи: как они идут сейчас и как должны идти по конфигу.',
        svc: 'Хаускиперы и фоновые процессы: когда срабатывают и в каком они состоянии.' }[S.seg];
      var h = '<div class="qs-snap"><span>Окно трасс ' + esc((w.start || '').replace('T', ' ')) + ' — ' + esc((w.end || '').slice(11)) + ' · ' + w.sessions + ' сессий · собрано ' + esc(d.generated) +
        (S.source ? ' · источник ' + esc(S.source) : '') + '</span>' +
        (opts.url ? '<button class="qs-ghost" data-a="reload">' + (S.loading ? '…' : 'Обновить') + '</button>' : '') + '</div>';
      h += '<section class="qs-tiles" aria-label="Коротко">' +
        '<button class="qs-tile" data-a="dups" style="background:rgba(182,156,255,.12);border:1px solid rgba(182,156,255,.35)"><b>' + sm.skills_used + '<small> из ' + sm.skills + '</small></b><span>скилов вызывались. Дубли →</span></button>' +
        '<button class="qs-tile" data-a="keepers" style="background:rgba(255,181,71,.12);border:1px solid rgba(255,181,71,.4)"><b>' + sm.agents_used + '<small> из ' + sm.agents + '</small></b><span>своих агентов звали. Хаускиперы →</span></button>' +
        '<button class="qs-tile" data-a="seg" data-v="svc" style="background:rgba(255,122,122,.12);border:1px solid rgba(255,122,122,.45)"><b>' + sm.autofeed + '<small> из ' + sm.roots + '</small></b><span>задач — автофид гипотез. Фон →</span></button></section>';
      h += '<div class="qs-seg" role="tablist">' + segs.map(function (x) {
        return '<button role="tab" data-a="seg" data-v="' + x[0] + '" aria-selected="' + (S.seg === x[0]) + '">' + x[1] + '</button>';
      }).join('') + '</div><p class="qs-hint">' + hint + '</p>';
      if (S.seg === 'svc') {
        h += '<section class="qs-list">' + d.services.map(function (s) {
          return '<article class="qs-svc ' + s.level + '"><div><span class="qs-dot" style="background:' + (LVL[s.level] || LVL.ok) + '"></span><b>' + esc(s.name) + '</b>' +
            (s.f ? '<span class="qs-f">' + esc(s.f) + '</span>' : '') + '</div><span class="qs-n" style="color:#C9CFDF">⏱ ' + esc(s.when) + '</span>' +
            '<span class="qs-n">' + esc(s.what) + '</span>' + (s.state ? '<span style="font-size:13.5px;font-weight:600;color:' + (LVL[s.level] || LVL.ok) + '">' + esc(s.state) + '</span>' : '') + '</article>';
        }).join('') + '</section>';
      } else {
        h += '<section class="qs-list">' + scen().filter(function (c) { return c.group === S.seg; }).map(card).join('') + '</section>';
      }
      h += '<section class="qs-dups" id="qs-dups"><h2>Что лишнее</h2><p class="qs-hint" style="margin:0">Группы скилов, которые делают одно и то же. Перечёркнуто серым — не вызывалось, зелёным — уже склеено.</p>' +
        d.dups.map(function (g) {
          return '<article class="qs-dup"><div><b>' + esc(g.title) + '</b><span class="qs-cnt">' + (g.done ? '✓ ' + g.now : g.frm + ' → ' + g.to) + '</span></div><div class="qs-tags">' +
            g.items.map(function (i) { return '<span class="qs-tag' + (i.merged ? ' merged' : i.used ? '' : ' unused') + '">' + esc(i.n) + '</span>'; }).join('') +
            '</div><span class="qs-n" style="color:#C9CFDF">' + esc(g.plan) + ' <span style="color:#FFC56B;font-weight:700">' + esc(g.c) + '</span></span></article>';
        }).join('') + '<button class="qs-second" data-a="edit" data-id="dups">Собрать промт на чистку</button></section>';
      return h;
    }

    function edScenario() { return S.ed.id === 'dups' ? dupsScenario() : find(S.ed.id); }
    function edState(sc) {
      var ch = S.ed.ch[sc.id] || {}, ad = S.ed.ad[sc.id] || {}, wi = S.ed.wh[sc.id] || 0;
      var states = sc.edit.steps.map(function (x, i) { return ch[i] || x['default'] || 'keep'; });
      return { ch: ch, ad: ad, wi: wi, states: states };
    }
    function prompt(sc) {
      var e = edState(sc), L = [];
      sc.edit.steps.forEach(function (x, i) {
        var tag = x.f ? ' (' + x.f + ')' : '';
        if (e.states[i] === 'remove') L.push('- убрать: ' + x.n + tag);
        if (e.states[i] === 'replace') L.push('- заменить: ' + x.n + ' → ' + x.alt + tag);
      });
      sc.edit.adds.forEach(function (n, i) { if (e.ad[i]) L.push('- добавить: ' + n); });
      if (e.wi > 0) L.push('- когда запускать: ' + sc.edit.when[e.wi]);
      if (S.ed.note.trim()) L.push('- ещё: ' + S.ed.note.trim());
      var chain = (sc.actual || []).filter(function (x) { return !x.d || x.d < 2; }).map(function (x) { return x.n; }).slice(0, 6).join(' → ');
      var text = [sc.id === 'dups' ? 'ЧИСТКА ДУБЛЕЙ в ~/.config/opencode' : 'ИЗМЕНИТЬ СЦЕНАРИЙ «' + sc.title + '»',
        chain ? 'Сейчас (по трассам): ' + chain : '', '', 'Изменения:', L.length ? L.join('\n') : '- (пока ничего не выбрано)', '',
        S.ed.dry ? 'Режим: сначала план. Запиши правки «файл:строка — было → стало» в ~/docs/changes/' + sc.id + '-план.md и пришли его суть до 3000 знаков. Ничего не применяй.'
          : 'Режим: применяй по одной правке; после каждой — python3 ~/docs/cleanup-2026-11-20/scripts/verify.py и строка с откатом в ~/docs/cleanup-2026-11-20/log.md.',
        'Правила: [память чата] не относится. Ничего не удаляй — старое через ~/docs/cleanup-2026-11-20/scripts/archive_file.sh в ~/archive/opencode-cleanup-2026-11-20/. Запрещено: kill, systemctl, restart, /r, rm, правка кода бота и плагинов. Секреты не печатать.'
      ].filter(function (x, i) { return x !== '' || i > 1; }).join('\n');
      return { text: text, n: L.length };
    }
    function shq(s) { return "'" + s.replace(/'/g, "'\"'\"'") + "'"; }

    function editHtml() {
      var sc = edScenario();
      if (!sc) { S.screen = 'list'; return listHtml(); }
      var e = edState(sc), p = prompt(sc);
      var picks = scen().map(function (x) { return [x.id, x.title]; }).concat([['dups', 'Чистка дублей']]);
      var h = '<button class="qs-back" data-a="back">' + svg('<path d="m15 6-6 6 6 6"/>', 22) + 'Сценарии</button><div class="qs-ed">' +
        '<div><h1 style="font-size:25px">Изменить сценарий</h1><p class="qs-hint" style="margin:6px 0 0">Отметьте, что поменять. Внизу сразу собирается задача для бота.</p></div>' +
        '<div class="qs-sec"><span class="qs-h3">Какой сценарий</span><div class="qs-picks">' + picks.map(function (x) {
          return '<button class="qs-pick" data-a="pick" data-id="' + esc(x[0]) + '" aria-pressed="' + (x[0] === sc.id) + '">' + esc(x[1]) + '</button>';
        }).join('') + '</div></div>';
      h += '<div class="qs-sec"><span class="qs-h3">Шаги — нажмите, чтобы сменить действие</span>' + (sc.edit.steps.length ? sc.edit.steps.map(function (x, i) {
        var v = e.states[i];
        return '<button class="qs-es ' + v + '" data-a="cycle" data-i="' + i + '"><span><span class="qs-sl"><b>' + esc(x.n) + '</b>' + (x.f ? '<span class="qs-f">' + esc(x.f) + '</span>' : '') + '</span>' +
          (v === 'replace' ? '<span class="qs-alt">→ ' + esc(x.alt) + '</span>' : v === 'keep' && x.alt ? '<span class="qs-can">можно заменить: ' + esc(x.alt) + '</span>' : '') +
          '</span><span class="qs-tag2">' + { keep: 'Оставить', remove: 'Убрать', replace: 'Заменить' }[v] + '</span></button>';
      }).join('') : '<p class="qs-empty">Всё уже склеено — чистить нечего.</p>') + '</div>';
      if (sc.edit.adds.length) h += '<div class="qs-sec"><span class="qs-h3">Добавить шаг</span>' + sc.edit.adds.map(function (n, i) {
        return '<button class="qs-opt" data-a="add" data-i="' + i + '" aria-pressed="' + !!e.ad[i] + '"><span class="qs-box">' + (e.ad[i] ? svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 14) : '') + '</span><span>' + esc(n) + '</span></button>';
      }).join('') + '</div>';
      if (sc.edit.when.length > 1) h += '<div class="qs-sec" role="radiogroup"><span class="qs-h3">Когда запускать</span>' + sc.edit.when.map(function (n, i) {
        return '<button class="qs-opt" role="radio" data-a="when" data-i="' + i + '" aria-checked="' + (e.wi === i) + '"><span class="qs-rad"></span><span>' + esc(n) + '</span></button>';
      }).join('') + '</div>';
      h += '<div><label class="qs-h3" for="qs-note">Что ещё поменять</label><textarea id="qs-note" class="qs-ta" data-a="note" placeholder="Своими словами">' + esc(S.ed.note) + '</textarea></div>' +
        '<button class="qs-sw" role="switch" data-a="dry" aria-checked="' + S.ed.dry + '"><span><b>Сначала показать план</b><small>' +
        (S.ed.dry ? 'Бот пришлёт правки, применит после вашего ответа' : 'Бот применит сразу и проверит себя сам') + '</small></span><span class="qs-trk"></span></button>' +
        '<div class="qs-sec"><span class="qs-h3">Задача для бота · ' + (p.n ? p.n + ' ' + plural(p.n, 'изменение', 'изменения', 'изменений') : 'нет изменений') + '</span><pre class="qs-pre">' + esc(p.text) + '</pre></div></div>';
      h += '<div class="qs-foot">' + (S.ed.msg ? '<div class="qs-msg ' + S.ed.msgKind + '">' + esc(S.ed.msg) + '</div>' : '') +
        '<div class="qs-row2"><button class="qs-primary" data-a="send"' + (p.n ? '' : ' disabled') + '>' + (opts.addUrl ? 'В очередь боту' : 'Копировать команду') + '</button>' +
        '<button class="qs-second" data-a="copy">Копировать промт</button></div></div>';
      return h;
    }

    function render() {
      var head = '<header class="qs-head"><span class="qs-logo">' + TREE + '</span><div><div class="qs-kick">Как обычно идёт работа</div><h1>Сценарии</h1></div></header>';
      var body = S.err && !S.data ? '<p class="qs-hint">' + esc(S.err) + '</p>' : !S.data ? '<p class="qs-hint">Загружаю…</p>' :
        S.screen === 'edit' ? editHtml() : listHtml();
      el.innerHTML = '<div class="qs">' + (S.screen === 'edit' ? '' : head) + body + '</div>';
    }
    function copy(t) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
      var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); } catch (e) { /* ничего */ } a.remove(); return Promise.resolve();
    }
    function say(m, k) { S.ed.msg = m; S.ed.msgKind = k || 'ok'; render(); }

    el.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-a]'); if (!b || !el.contains(b)) return;
      var a = b.getAttribute('data-a'), id = b.getAttribute('data-id'), v = b.getAttribute('data-v'), i = +b.getAttribute('data-i');
      var sc = S.screen === 'edit' ? edScenario() : null;
      if (a === 'note') return;
      if (a === 'toggle') { S.open = S.open === id ? null : id; }
      else if (a === 'view') { S.view = v; }
      else if (a === 'seg') { S.seg = v; S.open = null; }
      else if (a === 'keepers') { S.seg = 'big'; S.open = 'keepers'; }
      else if (a === 'dups') { var t = el.querySelector('#qs-dups'); if (t) t.scrollIntoView({ behavior: 'smooth' }); return; }
      else if (a === 'reload') { load(); return; }
      else if (a === 'edit') { S.screen = 'edit'; S.ed.id = id; S.ed.msg = ''; window.scrollTo(0, 0); }
      else if (a === 'back') { S.screen = 'list'; }
      else if (a === 'pick') { S.ed.id = id; S.ed.msg = ''; }
      else if (a === 'cycle' && sc) {
        var x = sc.edit.steps[i], cur = edState(sc).states[i];
        var nxt = cur === 'keep' ? 'remove' : cur === 'remove' ? (x.alt ? 'replace' : 'keep') : 'keep';
        (S.ed.ch[sc.id] = S.ed.ch[sc.id] || {})[i] = nxt; S.ed.msg = '';
      } else if (a === 'add' && sc) { var m = (S.ed.ad[sc.id] = S.ed.ad[sc.id] || {}); m[i] = !m[i]; S.ed.msg = ''; }
      else if (a === 'when' && sc) { S.ed.wh[sc.id] = i; S.ed.msg = ''; }
      else if (a === 'dry') { S.ed.dry = !S.ed.dry; S.ed.msg = ''; }
      else if (a === 'copy' && sc) { copy(prompt(sc).text).then(function () { say('Промт скопирован.'); }); return; }
      else if (a === 'send' && sc) {
        var p = prompt(sc); if (!p.n) return;
        if (!opts.addUrl) {
          copy('Выполни: ~/qrun/q add ' + queue + ' ' + shq(p.text)).then(function () { say('Команда скопирована — отправьте её боту одним сообщением.'); });
          return;
        }
        say('Отправляю…');
        fetch(opts.addUrl, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}), body: JSON.stringify({ queue: queue, text: p.text }) })
          .then(function (r) { return r.text().then(function (t) { if (!r.ok) throw new Error(t || 'HTTP ' + r.status); return t; }); })
          .then(function (t) { say('Добавлено в очередь «' + queue + '». ' + (S.ed.dry ? 'План и вопросы придут в Telegram.' : 'Ход — в «Сейчас».') + (t ? '\n' + t.slice(0, 300) : '')); })
          .catch(function (e) {
            // Статика GitHub Pages не умеет /api/qrun/add: не оставляем мёртвую кнопку,
            // а выдаём ту же команду, что и без API — пользователь отправляет её боту.
            copy('Выполни: ~/qrun/q add ' + queue + ' ' + shq(p.text)).then(function () {
              say('API недоступен (' + e.message.slice(0, 120) + ') — команда скопирована, отправьте её боту одним сообщением.', 'err');
            });
          });
        return;
      }
      render();
    });
    el.addEventListener('input', function (ev) {
      if (ev.target.getAttribute('data-a') === 'note') {
        S.ed.note = ev.target.value;
        var sc = edScenario(), pre = el.querySelector('.qs-pre');
        if (sc && pre) { var pp = prompt(sc); pre.textContent = pp.text; var sb = el.querySelector('[data-a=send]'); if (sb) sb.disabled = !pp.n; }
      }
    });
    render();
    if (!S.data) load();
    return { reload: load };
  }
  window.QrunScenarios = { mount: mount };
})();

/* Казино — отдельный оффлайн-модуль вкладки. Подключаем динамически, чтобы не
   править index.html (файл может быть занят другим агентом). Модуль сам
   регистрирует кнопку и секцию, деградирует молча, если файла нет. */
(function () {
  try {
    if (document.getElementById('csn-boot')) return;
    var s = document.createElement('script');
    s.id = 'csn-boot';
    s.src = 'casino-tab.js?v=20261122-1';
    (document.head || document.body).appendChild(s);
  } catch (e) { /* без казино апп продолжает работать */ }
})();
