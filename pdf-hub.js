/*
 * pdf-hub.js — универсальный рендер карточек работ + экспорт в PDF.
 *
 * Без внешних библиотек. Публичный API:
 *   const hub = window.PDFHub.render(container, works, opts);
 *
 * container — Element или CSS-селектор.
 * works     — массив объектов {id, title, date, status, path, source, kind, provenance}.
 * opts:
 *   title            заголовок блока (по умолчанию «Работы»)
 *   groupBy          null | 'source' | 'kind' | 'status' | 'date'  (по умолчанию 'source')
 *   selectedIds      массив id предварительно выбранных работ
 *   selectable       разрешить выбор карточек (по умолчанию true)
 *   showExport       показать кнопку «Экспорт PDF» (по умолчанию true)
 *   showGrouping     показать селектор группировки (по умолчанию true)
 *   fields           какие поля показывать в карточке
 *                    (по умолчанию ['date','status','kind','source','path'])
 *   theme            'mocha' | 'latte' (по умолчанию 'mocha', Catppuccin)
 *   emptyText        текст при пустом списке
 *   onSelectionChange(ids)  колбэк при изменении выбора
 *
 * Методы контроллера:
 *   getElement(), setWorks(works), setSelection(ids), getSelection(),
 *   toggle(id), setGroupBy(field), setTitle(text), print(), refresh(), destroy()
 *
 * Экспорт: кнопка и Ctrl+P идут через window.print(). В @media print
 * остаётся только блок .pdfhub; невыбранные карточки скрываются, если есть выбор.
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'pdfhub-styles';
  var STATUS_LABELS = {
    done: 'Готово',
    'in-progress': 'В работе',
    draft: 'Черновик',
    missing: 'Файл исчез'
  };
  var GROUP_LABELS = {
    source: 'Источник',
    kind: 'Тип',
    status: 'Статус',
    date: 'Дата (месяц)'
  };
  var DEFAULT_FIELDS = ['date', 'status', 'kind', 'source', 'path'];

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function resolveContainer(target) {
    if (target && target.nodeType === 1) return target;
    if (typeof target === 'string') {
      var found = document.querySelector(target);
      if (!found) throw new Error('PDFHub: контейнер не найден: ' + target);
      return found;
    }
    throw new Error('PDFHub: нужен Element или CSS-селектор');
  }

  function normalizeWorks(works) {
    if (!Array.isArray(works)) return [];
    return works.filter(function (w) { return w && typeof w === 'object'; })
      .map(function (w, i) {
        return {
          id: w.id != null ? String(w.id) : 'auto-' + i,
          title: w.title || 'Без названия',
          date: w.date || '',
          status: w.status || 'draft',
          path: w.path || '',
          source: w.source || '',
          kind: w.kind || '',
          provenance: w.provenance || null
        };
      });
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function groupValue(work, by) {
    switch (by) {
      case 'source': return work.source || '—';
      case 'kind': return work.kind || '—';
      case 'status': return STATUS_LABELS[work.status] || work.status || '—';
      case 'date': return (work.date || '').slice(0, 7) || 'без даты';
      default: return 'Все работы';
    }
  }

  var CSS = [
    '.pdfhub{',
    '  --ctp-base:#1e1e2e;--ctp-surface:#181825;--ctp-mantle:#11111b;',
    '  --ctp-overlay:#313244;--ctp-text:#cdd6f4;--ctp-sub:#a6adc8;',
    '  --ctp-blue:#89b4fa;--ctp-green:#a6e3a1;--ctp-yellow:#f9e2af;',
    '  --ctp-red:#f38ba8;--ctp-mauve:#cba6f7;--ctp-teal:#94e2d5;',
    '  box-sizing:border-box;background:var(--ctp-base);color:var(--ctp-text);',
    '  border:1px solid var(--ctp-overlay);border-radius:14px;padding:18px;',
    '  font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;',
    '  font-size:14px;line-height:1.45;max-width:100%;',
    '}',
    '.pdfhub[data-theme="latte"]{',
    '  --ctp-base:#eff1f5;--ctp-surface:#e6e9ef;--ctp-mantle:#dce0e8;',
    '  --ctp-overlay:#ccd0da;--ctp-text:#4c4f69;--ctp-sub:#6c6f85;',
    '  --ctp-blue:#1e66f5;--ctp-green:#40a02b;--ctp-yellow:#df8e1d;',
    '  --ctp-red:#d20f39;--ctp-mauve:#8839ef;--ctp-teal:#179299;',
    '}',
    '.pdfhub *{box-sizing:border-box}',
    '.pdfhub__header{display:flex;flex-wrap:wrap;gap:10px;align-items:center;',
    '  justify-content:space-between;border-bottom:1px solid var(--ctp-overlay);',
    '  padding-bottom:12px;margin-bottom:14px}',
    '.pdfhub__heading{margin:0;font-size:18px;font-weight:700}',
    '.pdfhub__heading small{display:block;font-weight:400;font-size:12px;color:var(--ctp-sub)}',
    '.pdfhub__controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
    '.pdfhub__select,.pdfhub__btn{font:inherit;color:var(--ctp-text);',
    '  background:var(--ctp-surface);border:1px solid var(--ctp-overlay);',
    '  border-radius:8px;padding:6px 10px;cursor:pointer}',
    '.pdfhub__btn{border-color:var(--ctp-blue);color:var(--ctp-blue);font-weight:600}',
    '.pdfhub__btn:hover{background:var(--ctp-overlay)}',
    '.pdfhub__count{font-size:12px;color:var(--ctp-sub)}',
    '.pdfhub__group{margin:0 0 18px}',
    '.pdfhub__group-title{margin:0 0 8px;font-size:13px;text-transform:uppercase;',
    '  letter-spacing:.06em;color:var(--ctp-mauve)}',
    '.pdfhub__cards{display:grid;gap:10px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr))}',
    '.pdfhub-card{background:var(--ctp-surface);border:1px solid var(--ctp-overlay);',
    '  border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;',
    '  transition:border-color .15s,transform .15s}',
    '.pdfhub-card:hover{border-color:var(--ctp-blue);transform:translateY(-1px)}',
    '.pdfhub-card.is-selected{border-color:var(--ctp-green);background:var(--ctp-overlay)}',
    '.pdfhub-card__top{display:flex;gap:8px;align-items:flex-start}',
    '.pdfhub__checkbox{margin:3px 0 0;accent-color:var(--ctp-green);cursor:pointer;flex:0 0 auto}',
    '.pdfhub-card__title{margin:0;font-size:15px;font-weight:600;color:var(--ctp-text);flex:1 1 auto}',
    '.pdfhub-card__meta{display:flex;flex-wrap:wrap;gap:6px}',
    '.pdfhub-badge{display:inline-block;padding:2px 8px;border-radius:999px;',
    '  font-size:11px;border:1px solid var(--ctp-overlay);color:var(--ctp-sub)}',
    '.pdfhub-badge--status-done{color:var(--ctp-green);border-color:var(--ctp-green)}',
    '.pdfhub-badge--status-in-progress{color:var(--ctp-yellow);border-color:var(--ctp-yellow)}',
    '.pdfhub-badge--status-missing{color:var(--ctp-red);border-color:var(--ctp-red)}',
    '.pdfhub-badge--kind{color:var(--ctp-teal);border-color:var(--ctp-teal)}',
    '.pdfhub-badge--source{color:var(--ctp-blue);border-color:var(--ctp-blue)}',
    '.pdfhub-card__path{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
    '  font-size:11px;color:var(--ctp-sub);white-space:nowrap;overflow:hidden;',
    '  text-overflow:ellipsis;direction:rtl;text-align:left}',
    '.pdfhub-card__prov{font-size:11px;color:var(--ctp-sub);opacity:.8}',
    '.pdfhub__empty{color:var(--ctp-sub);font-style:italic;padding:24px;text-align:center}',

    '@media print{',
    '  @page{size:A4;margin:14mm}',
    '  html,body{background:#fff!important}',
    '  body *{visibility:hidden!important}',
    '  .pdfhub,.pdfhub *{visibility:visible!important}',
    '  .pdfhub{position:absolute;left:0;top:0;width:100%;max-width:none;',
    '    background:#fff!important;color:#1e1e2e!important;border:0!important;',
    '    box-shadow:none!important;padding:0!important;margin:0!important;',
    '    font-size:11px}',
    '  .pdfhub__header{border-bottom:1px solid #999!important;margin-bottom:10px!important;',
    '    padding-bottom:6px!important}',
    '  .pdfhub__heading{font-size:16px!important;color:#1e1e2e!important}',
    '  .pdfhub__heading small,.pdfhub__count{color:#555!important}',
    '  .pdfhub__controls,.pdfhub__checkbox,.pdfhub__group-select{display:none!important}',
    '  .pdfhub__group{margin-bottom:12px!important;break-inside:avoid}',
    '  .pdfhub__group-title{color:#333!important;font-size:12px!important}',
    '  .pdfhub__cards{display:block!important}',
    '  .pdfhub-card{background:#fff!important;color:#1e1e2e!important;',
    '    border:1px solid #bbb!important;border-radius:6px!important;',
    '    padding:8px 10px!important;margin-bottom:8px!important;',
    '    break-inside:avoid;page-break-inside:avoid;transform:none!important}',
    '  .pdfhub-card__title,.pdfhub-card__path,.pdfhub-card__prov,',
    '  .pdfhub-badge{color:#222!important;border-color:#999!important;opacity:1!important}',
    '  .pdfhub-card__path{white-space:normal!important;word-break:break-all;direction:ltr!important}',
    '  .pdfhub--print-selection .pdfhub-card:not(.is-selected){display:none!important}',
    '  .pdfhub--print-selection .pdfhub__group:not(.has-selected){display:none!important}',
    '}'
  ].join('\n');

  function render(container, works, opts) {
    opts = opts || {};
    var host = resolveContainer(container);
    injectStyles();

    var state = {
      works: normalizeWorks(works),
      selected: {},
      groupBy: opts.groupBy === undefined ? 'source' : opts.groupBy,
      fields: Array.isArray(opts.fields) ? opts.fields : DEFAULT_FIELDS,
      selectable: opts.selectable !== false,
      showExport: opts.showExport !== false,
      showGrouping: opts.showGrouping !== false,
      title: opts.title || 'Работы',
      emptyText: opts.emptyText || 'Нет работ',
      theme: opts.theme === 'latte' ? 'latte' : 'mocha',
      onSelectionChange: typeof opts.onSelectionChange === 'function' ? opts.onSelectionChange : null
    };
    (opts.selectedIds || []).forEach(function (id) { state.selected[String(id)] = true; });

    var root = el('div', 'pdfhub');
    root.setAttribute('data-theme', state.theme);
    var header = el('div', 'pdfhub__header');
    var heading = el('h2', 'pdfhub__heading');
    var count = el('span', 'pdfhub__count');
    var controls = el('div', 'pdfhub__controls');
    var groupSelect = null;
    var body = el('div', 'pdfhub__body');
    host.appendChild(root);
    root.appendChild(header);
    root.appendChild(body);

    function selectedIds() {
      return Object.keys(state.selected).filter(function (id) { return state.selected[id]; });
    }

    function emitSelection() {
      if (state.onSelectionChange) state.onSelectionChange(selectedIds());
    }

    function buildHeading() {
      heading.textContent = state.title;
      var small = el('small', null, state.works.length + ' работ · ' + selectedIds().length + ' выбрано');
      heading.appendChild(small);
    }

    function buildControls() {
      controls.textContent = '';
      if (state.showGrouping) {
        groupSelect = el('select', 'pdfhub__select');
        [[null, 'Без группировки'], ['source', GROUP_LABELS.source],
         ['kind', GROUP_LABELS.kind], ['status', GROUP_LABELS.status],
         ['date', GROUP_LABELS.date]].forEach(function (pair) {
          var o = el('option', null, pair[1]);
          o.value = pair[0] === null ? '' : pair[0];
          if (state.groupBy === pair[0]) o.selected = true;
          groupSelect.appendChild(o);
        });
        groupSelect.addEventListener('change', function () {
          state.groupBy = groupSelect.value || null;
          renderAll();
        });
        controls.appendChild(groupSelect);
      }
      if (state.showExport) {
        var btn = el('button', 'pdfhub__btn', 'Экспорт PDF');
        btn.type = 'button';
        btn.addEventListener('click', function () { controller.print(); });
        controls.appendChild(btn);
      }
    }

    function makeBadge(text, modifier) {
      return el('span', 'pdfhub-badge' + (modifier ? ' pdfhub-badge--' + modifier : ''), text);
    }

    function makeCard(work) {
      var card = el('article', 'pdfhub-card' + (state.selected[work.id] ? ' is-selected' : ''));
      card.setAttribute('data-id', work.id);

      var top = el('div', 'pdfhub-card__top');
      if (state.selectable) {
        var cb = el('input', 'pdfhub__checkbox');
        cb.type = 'checkbox';
        cb.checked = !!state.selected[work.id];
        cb.setAttribute('aria-label', 'Выбрать: ' + work.title);
        cb.addEventListener('change', function () {
          if (cb.checked) state.selected[work.id] = true;
          else delete state.selected[work.id];
          card.classList.toggle('is-selected', cb.checked);
          updateGroupFlags();
          buildHeading();
          emitSelection();
        });
        top.appendChild(cb);
      }
      top.appendChild(el('h3', 'pdfhub-card__title', work.title));
      card.appendChild(top);

      var meta = el('div', 'pdfhub-card__meta');
      state.fields.forEach(function (field) {
        if (field === 'date' && work.date) meta.appendChild(makeBadge(work.date));
        else if (field === 'status') {
          meta.appendChild(makeBadge(
            STATUS_LABELS[work.status] || work.status || 'draft',
            'status-' + (work.status || 'draft')
          ));
        } else if (field === 'kind' && work.kind) meta.appendChild(makeBadge(work.kind, 'kind'));
        else if (field === 'source' && work.source) meta.appendChild(makeBadge(work.source, 'source'));
      });
      if (meta.childNodes.length) card.appendChild(meta);

      if (state.fields.indexOf('path') !== -1 && work.path) {
        var pathNode = el('div', 'pdfhub-card__path', work.path);
        pathNode.title = work.path;
        card.appendChild(pathNode);
      }
      if (work.provenance && work.provenance.relpath) {
        card.appendChild(el('div', 'pdfhub-card__prov',
          ' provenance: ' + work.provenance.relpath +
          (work.provenance.extracted_at ? ' · ' + work.provenance.extracted_at : '')));
      }
      return card;
    }

    function updateGroupFlags() {
      var groups = body.querySelectorAll('.pdfhub__group');
      for (var i = 0; i < groups.length; i++) {
        groups[i].classList.toggle('has-selected', !!groups[i].querySelector('.pdfhub-card.is-selected'));
      }
    }

    function renderAll() {
      body.textContent = '';
      if (!state.works.length) {
        body.appendChild(el('div', 'pdfhub__empty', state.emptyText));
      } else {
        var groups = {};
        state.works.forEach(function (w) {
          var key = groupValue(w, state.groupBy);
          (groups[key] = groups[key] || []).push(w);
        });
        Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, 'ru'); })
          .forEach(function (key) {
            var section = el('section', 'pdfhub__group');
            section.appendChild(el('h4', 'pdfhub__group-title', key));
            var cards = el('div', 'pdfhub__cards');
            groups[key].sort(function (a, b) {
              return String(b.date).localeCompare(String(a.date)) || a.title.localeCompare(b.title, 'ru');
            }).forEach(function (w) { cards.appendChild(makeCard(w)); });
            section.appendChild(cards);
            body.appendChild(section);
          });
        updateGroupFlags();
      }
      header.textContent = '';
      header.appendChild(heading);
      buildHeading();
      buildControls();
      header.appendChild(controls);
      header.appendChild(count);
      count.textContent = '';
    }

    function applyPrintSelection() {
      if (state.selectable && selectedIds().length) root.classList.add('pdfhub--print-selection');
      else root.classList.remove('pdfhub--print-selection');
    }
    function clearPrintSelection() { root.classList.remove('pdfhub--print-selection'); }

    global.addEventListener('beforeprint', applyPrintSelection);
    global.addEventListener('afterprint', clearPrintSelection);

    var controller = {
      element: root,
      getElement: function () { return root; },
      setWorks: function (next) {
        var valid = {};
        normalizeWorks(next).forEach(function (w) { valid[w.id] = true; });
        Object.keys(state.selected).forEach(function (id) { if (!valid[id]) delete state.selected[id]; });
        state.works = normalizeWorks(next);
        renderAll();
        emitSelection();
        return controller;
      },
      setSelection: function (ids) {
        state.selected = {};
        (ids || []).forEach(function (id) { state.selected[String(id)] = true; });
        renderAll();
        emitSelection();
        return controller;
      },
      getSelection: function () { return selectedIds(); },
      toggle: function (id) {
        id = String(id);
        if (state.selected[id]) delete state.selected[id];
        else state.selected[id] = true;
        renderAll();
        emitSelection();
        return controller;
      },
      setGroupBy: function (field) {
        state.groupBy = field || null;
        renderAll();
        return controller;
      },
      setTitle: function (text) {
        state.title = text || '';
        renderAll();
        return controller;
      },
      print: function () {
        applyPrintSelection();
        global.print();
        return controller;
      },
      refresh: function () { renderAll(); return controller; },
      destroy: function () {
        global.removeEventListener('beforeprint', applyPrintSelection);
        global.removeEventListener('afterprint', clearPrintSelection);
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };

    renderAll();
    return controller;
  }

  global.PDFHub = { version: '1.0.0', render: render };
})(window);
