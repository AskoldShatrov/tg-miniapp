/* Вкладка «Библиотека» мини-апа PairDevBot. Без зависимостей, работает статикой.
   Статьи — не секреты, поэтому хранятся в localStorage этого мини-апа.
   Сид-статья вшита в код: она есть на любом устройстве и после деплоя.
   Публичный API: window.LibraryTab = { refresh, add, remove, list, seed } */
(function (global) {
  'use strict';

  var KEY = 'pairdev.library.articles.v1';
  var KEY_HIDDEN = 'pairdev.library.hidden.v1';
  var BASE_URL = 'https://askoldshatrov.github.io/tg-miniapp/';

  var SEED = [{
    id: 'arxiv-2610.01471',
    title: 'When Does a Second Model Help? Cross-Model Review in LLM Verification',
    authors: 'Tae-Eun Song',
    source: 'arXiv',
    folder: 'Статьи',
    date: '2026-10-01',
    url: 'https://arxiv.org/abs/2610.01471',
    tags: ['LLM', 'review', 'verification', 'cross-model', 'cs.CL'],
    abstract: 'Large language models now generate code, documentation, and analyses, and are increasingly used to review such output. We ask when a second review by a different model helps. Building on the author\'s earlier preprints, which varied context, repetition, and role structure within one model, we test model independence in a controlled experiment: 30 artifacts with 150 planted errors, 10 review conditions, and 900 review sessions with three reviewer models from two developers. In this experiment, (1) a top-tier cross-model reviewer is not significantly different in F1 from same-model review in a fresh session (CCR), which does not establish equivalence; (2) the two find partly different errors (Jaccard 41.2%); and (3) at two review calls, one CCR plus one cross-model review matches more planted errors than two CCR reviews (56.7% vs. 42.7%; Holm-adjusted p=.006), but not significantly more than two reviews by the top-tier cross-model reviewer, so model difference and reviewer capability are not separated. A lightweight cross-model reviewer scores no higher than same-model review. Withholding requirements from the reviewer raises F1 for the two lower tiers but not the top tier, in untested point estimates whose pattern depends on how failed sessions are scored. Before analysis we audited all session records, excluding one baseline run of uncertain provenance and 14 failed calls; results with all sessions are also reported. A partial check on public detector outputs from another benchmark neither replicates nor contradicts the main comparison.'
  }, {
    id: 'study-nir-final-20261123',
    title: 'НИР · актуальная версия (37 стр)',
    authors: 'Шатров А. И. · группа 4291 · СПбГТИ(ТУ)',
    source: 'Учёба · PDF',
    folder: 'Учёба · PDF',
    date: '2026-11-27',
    url: BASE_URL + 'pdfs/nir-final.pdf?v=20261127-0840',
    tags: ['НИР', 'компьютерное моделирование', 'практика', '37 стр', 'постоянная ссылка'],
    abstract: 'Отчёт по научно-исследовательской работе, 37 страниц. Постоянная ссылка: файл обновляется на месте, адрес не меняется. 27.11 титульник приведён к эталону, добавлен концептуальный разбор TLS и Apache перед математической моделью, убраны жирные стрелки.'
  }, {
    id: 'study-kp-kmvkh-final-20261123',
    title: 'Курсовой проект · КМвХиХТ · актуальная версия (28 стр)',
    authors: 'Шатров А. И. · группа 4291 · Полосин А. Н., Козлов А. В.',
    source: 'Учёба · PDF',
    folder: 'Учёба · PDF',
    date: '2026-11-27',
    url: BASE_URL + 'pdfs/kp-kmvkh-final.pdf?v=20261127-0840',
    tags: ['курсовой', 'КМвХиХТ', 'компьютерное моделирование', 'TLS', '28 стр', 'постоянная ссылка'],
    abstract: 'Пояснительная записка курсового проекта по компьютерному моделированию в химии и химической технологии, 28 страниц. Постоянная ссылка: файл обновляется на месте. 27.11 выровнен титульник.'
  }, {
    id: 'study-kr3-modelirovanie-20261127',
    title: 'КР3 · Моделирование систем · исправленная редакция (7 стр)',
    authors: 'Шатров А. И. · группа 4291 · вариант 8',
    source: 'Учёба · PDF',
    folder: 'Учёба · PDF',
    date: '2026-11-27',
    url: BASE_URL + 'pdfs/kr3-modelirovanie.pdf?v=20261127-0840',
    tags: ['контрольная работа', 'моделирование систем', 'КР3', '7 стр', 'постоянная ссылка'],
    abstract: 'Контрольная работа №3 по моделированию систем, вариант 8. Постоянная ссылка: файл обновляется на месте. 27.11 выровнен титульник и перевёрстан график — кривая подходит к заданию 1,50 снизу, без пересечения.'
  }, {
    id: 'study-control-works-1-3-20261126',
    title: 'Контрольные работы № 1–3 · комплект',
    authors: 'Голубкова Ю. А. · примеры оформления',
    source: 'Учёба · Word',
    folder: 'Word · документы',
    date: '2026-11-27',
    url: BASE_URL + 'pdfs/kontrolnye-raboty-1-3.docx',
    tags: ['контрольные работы', 'Word', 'компьютерное моделирование', 'постоянная ссылка'],
    abstract: 'Постоянная ссылка на комплект контрольных работ № 1–3 в формате Word. Файл обновляется на месте: дата в ссылке не меняется. Опубликовано 27.11.2026.'
  }, {
    id: 'word-01-kontrolnye-20261127',
    title: 'Контрольные работы № 1–3 · Word',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/01-kontrolnye-raboty-1-3.docx?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['контрольные работы', 'Word', 'компьютерное моделирование'],
    abstract: 'Комплект контрольных работ № 1–3 в исходном формате Word, опубликован без перекодирования.'
  }, {
    id: 'word-02-kr-shatrov-20261127',
    title: 'Контрольные работы 1, 2, 3 · Шатров А. И.',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/02-kr1-2-3-shatrov.docx?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['контрольные работы', 'Word', 'Шатров'],
    abstract: 'Контрольные работы 1, 2 и 3 Шатрова А. И. в исходном формате Word.'
  }, {
    id: 'word-03-zadanie-kp-kmvkh-20261127',
    title: 'Задание на курсовой проект · КМвХиХТ · 2025',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/03-zadanie-kp-kmvkh.doc?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['курсовой проект', 'КМвХиХТ', 'задание', 'Word'],
    abstract: 'Шаблон задания на курсовой проект по компьютерному моделированию в химии и химической технологии, формат Word.'
  }, {
    id: 'word-04-titul-sheremetev-20261127',
    title: 'Титул и задание курсовой работы · Шереметьев',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/04-titul-sheremetev.docx?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['титульный лист', 'курсовая работа', 'Word', 'Шереметьев'],
    abstract: 'Пример титульного листа и задания курсовой работы, формат Word.'
  }, {
    id: 'word-05-zadanie-belyaev-20261127',
    title: 'Задание на курсовой проект · КМвХиХТ · Беляев',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/05-zadanie-belyaev.doc?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['курсовой проект', 'КМвХиХТ', 'задание', 'Word'],
    abstract: 'Пример задания на курсовой проект по компьютерному моделированию в химии и химической технологии, формат Word.'
  }, {
    id: 'word-06-zadanie-rumyantsev-20261127',
    title: 'Задание на курсовой проект · КМвХиХТ · Румянцев',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/06-zadanie-rumyantsev.doc?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['курсовой проект', 'КМвХиХТ', 'задание', 'Word'],
    abstract: 'Пример задания на курсовой проект по компьютерному моделированию в химии и химической технологии, формат Word.'
  }, {
    id: 'word-07-otchet-nir-20261127',
    title: 'Отчёт по НИР · Ковинев Д. С.',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/07-otchet-nir.docx?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['НИР', 'отчёт', 'Word', 'Ковинев'],
    abstract: 'Отчёт по научно-исследовательской работе в исходном формате Word.'
  }, {
    id: 'word-08-tz-nir-20261127',
    title: 'Техническое задание на НИР',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/08-tz-nir.docx?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['НИР', 'техническое задание', 'Word'],
    abstract: 'Техническое задание на научно-исследовательскую работу в исходном формате Word.'
  }, {
    id: 'word-09-kp-primer-20261127',
    title: 'Курсовой проект · ОРАИС · пример Кабинова Е. В.',
    authors: 'Учёба · Word',
    source: 'Учёба · Word',
    date: '2026-11-27',
    url: BASE_URL + 'word/09-kp-primer.docx?v=20261127-1000',
    folder: 'Word · документы',
    tags: ['курсовой проект', 'ОРАИС', 'пример', 'Word'],
    abstract: 'Пример курсового проекта по ОРАИС в исходном формате Word.'
  }];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function copySeed() {
    return JSON.parse(JSON.stringify(SEED));
  }

  function normalList(raw) {
    if (!Array.isArray(raw)) return copySeed();
    var out = raw.filter(function (a) { return a && typeof a === 'object' && a.url; });
    out.forEach(function (a) {
      a.id = a.id || ('lib-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
      a.tags = Array.isArray(a.tags) ? a.tags.filter(Boolean) : [];
    });
    return out.length ? out : copySeed();
  }

  function hiddenIds() {
    try {
      var raw = global.localStorage.getItem(KEY_HIDDEN);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveHidden(ids) {
    try { global.localStorage.setItem(KEY_HIDDEN, JSON.stringify(ids)); } catch (e) {}
  }

  function load() {
    var hidden = hiddenIds();
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var items = normalList(JSON.parse(raw));
        var added = false;
        // Сид-записи обновляются на месте: постоянные ссылки должны доехать
        // до устройств, где старая версия уже лежит в localStorage.
        // Удалённые пользователем сид-статьи не воскресают — их id в KEY_HIDDEN.
        SEED.forEach(function (s) {
          if (hidden.indexOf(s.id) !== -1) return;
          var idx = -1;
          for (var i = 0; i < items.length; i++) {
            if (items[i] && items[i].id === s.id) { idx = i; break; }
          }
          if (idx >= 0) {
            items[idx] = JSON.parse(JSON.stringify(s));
            added = true;
          } else {
            items.push(JSON.parse(JSON.stringify(s)));
            added = true;
          }
        });
        if (added) save(items);
        return items;
      }
    } catch (e) { /* приватный режим / Pages в песочнице — работаем в памяти */ }
    var seeded = copySeed();
    save(seeded);
    return seeded;
  }

  function save(list) {
    try { global.localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
  }

  function normalizeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u;
  }

  function deriveTitle(url) {
    var m = url.match(/arxiv\.org\/(?:abs|pdf)\/([\d.]+)/i);
    if (m) return 'arXiv:' + m[1];
    try {
      var host = new URL(url).hostname.replace(/^www\./, '');
      var last = new URL(url).pathname.split('/').filter(Boolean).pop();
      return last && last.length < 60 ? decodeURIComponent(last).replace(/[-_]/g, ' ') : host;
    } catch (e) {
      return url.slice(0, 60);
    }
  }

  function badge(a) {
    var src = a.source || (function () {
      try { return new URL(a.url).hostname.replace(/^www\./, ''); } catch (e) { return 'ссылка'; }
    })();
    return '<span class="lb-src">' + esc(src) + '</span>';
  }

  function render() {
    var host = document.getElementById('library-tab');
    if (!host) return;

    var list = load();
    var q = (host.querySelector('#lbSearch') ? host.querySelector('#lbSearch').value : '').toLowerCase();
    var shown = list.filter(function (a) {
      if (!q) return true;
      return [a.title, a.authors, a.source, a.abstract, (a.tags || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });

    var byDate = shown.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });

    var html = '<div class="lb-head">' +
      '<div class="lb-title"><span>▤</span> Библиотека <small id="lbCount">' + list.length + '</small></div>' +
      '<div class="lb-sub">Статьи и ссылки, собранные в одном месте. Добавьте свою — она сохранится на этом устройстве.</div>' +
      '</div>' +
      '<input id="lbSearch" class="lb-search" type="search" placeholder="Найти по названию, автору, тегу…" value="' + esc(host.querySelector('#lbSearch') ? host.querySelector('#lbSearch').value : '') + '">' +
      '<form id="lbAdd" class="lb-add">' +
      '<input id="lbUrl" type="url" placeholder="https://arxiv.org/abs/…" aria-label="Ссылка на статью">' +
      '<input id="lbName" type="text" placeholder="Название (необязательно)" aria-label="Название">' +
      '<button type="submit">＋ Добавить</button>' +
      '</form>';

    var FOLDER_ORDER = ['Word · документы', 'Учёба · PDF', 'Статьи'];
    var groups = {};
    byDate.forEach(function (a) {
      var f = String(a.folder || 'Прочее');
      if (!groups[f]) groups[f] = [];
      groups[f].push(a);
    });
    var folderNames = Object.keys(groups);
    folderNames.sort(function (x, y) {
      var ix = FOLDER_ORDER.indexOf(x);
      var iy = FOLDER_ORDER.indexOf(y);
      if (ix !== -1 && iy !== -1) return ix - iy;
      if (ix !== -1) return -1;
      if (iy !== -1) return 1;
      return x.localeCompare(y, 'ru');
    });

    if (!byDate.length) {
      html += '<div class="lb-empty">' + (list.length ? 'Ничего не найдено.' : 'Пока пусто. Вставьте ссылку выше.') + '</div>';
    } else {
      html += folderNames.map(function (folder) {
        return '<h3 class="lb-folder">' + esc(folder) + '</h3>' +
          '<div class="lb-list">' + groups[folder].map(function (a) {
            var tags = (a.tags || []).map(function (t) { return '<span class="lb-tag">#' + esc(t) + '</span>'; }).join('');
            return '<article class="lb-card">' +
              '<div class="lb-meta">' + badge(a) +
                (a.date ? '<span class="lb-date">' + esc(a.date) + '</span>' : '') +
                '<button class="lb-del" data-del="' + esc(a.id) + '" title="Убрать из библиотеки" aria-label="Удалить">✕</button>' +
              '</div>' +
              '<a class="lb-link" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + esc(a.title || deriveTitle(a.url)) + '</a>' +
              (a.authors ? '<div class="lb-authors">' + esc(a.authors) + '</div>' : '') +
              (tags ? '<div class="lb-tags">' + tags + '</div>' : '') +
              (a.abstract ? '<details class="lb-abs"><summary>Аннотация</summary><p>' + esc(a.abstract) + '</p></details>' : '') +
              '</article>';
          }).join('') + '</div>';
      }).join('');
    }

    host.innerHTML = html;
    wire();
  }

  function wire() {
    var host = document.getElementById('library-tab');
    if (!host) return;

    var search = host.querySelector('#lbSearch');
    if (search) {
      var t;
      search.addEventListener('input', function () {
        clearTimeout(t);
        var v = search.value;
        t = setTimeout(function () { render(); var s = document.getElementById('lbSearch'); if (s) { s.focus(); s.setSelectionRange(v.length, v.length); } }, 150);
      });
    }

    var form = host.querySelector('#lbAdd');
    if (form) form.addEventListener('submit', function (e) {
      e.preventDefault();
      var url = normalizeUrl(host.querySelector('#lbUrl').value);
      if (!url) { host.querySelector('#lbUrl').focus(); return; }
      var name = host.querySelector('#lbName').value.trim();
      add({ url: url, title: name || deriveTitle(url), source: (function () {
        try { return new URL(url).hostname.replace(/^www\./, ''); } catch (err) { return 'ссылка'; }
      })(), date: new Date().toISOString().slice(0, 10), tags: [] });
      render();
    });

    host.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { remove(b.getAttribute('data-del')); render(); });
    });
  }

  function add(article) {
    if (!article || !article.url) return false;
    var list = load();
    if (list.some(function (a) { return a.url === article.url; })) return false;
    article.id = article.id || ('lib-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7));
    article.tags = Array.isArray(article.tags) ? article.tags : [];
    list.push(article);
    save(list);
    return true;
  }

  function remove(id) {
    save(load().filter(function (a) { return a.id !== id; }));
    if (SEED.some(function (s) { return s.id === id; })) {
      var h = hiddenIds();
      if (h.indexOf(id) === -1) { h.push(id); saveHidden(h); }
    }
  }

  function list() { return load(); }

  global.LibraryTab = { refresh: render, add: add, remove: remove, list: list, seed: copySeed };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
})(window);
