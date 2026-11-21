#!/usr/bin/env python3
"""Генератор views.json — framework-описание представлений Студии мини-апа.

Идея: Студия не перекомпилируется под каждый новый вид. Описания (views.json)
задают ТИП отображения и привязку к реальному источнику; рендер читает этот файл
и сам решает, как показать tree / checklist / cards / table.

Правила контракта:
  * только реальные источники — нет ни одного захардкоженного id/count;
  * если файла-источника нет, вид не выдумывается: он получает status="missing",
    count=0, publish=false (реальные данные не подменяются заглушками);
  * CONFIDENTIAL_REVIEW.md — приватный sources: publish=false и в views.json
    попадают только агрегаты (id вида, метки, короткая подпись-намек), НИ одного
    текста записи, voice-ссылки или пользовательской оценки;
  * пишем только views.json (tmp + os.replace). index.html, task-tree.js и
    остальные файлы не читаем на запись и не трогаем.

Схема согласована с агентом рендера: version, built_at, views[] с полями
id, title, type, source, built_at, count, publish, group_by, sort_by, filters,
label_field, value_field, meta_fields, actions. Дополнительно (по ТЗ): status и
provenance на каждый вид, hint — только для приватного вида.

Запуск: python3 ~/shared-repo/bots/miniapp/build_views.py
"""
import collections
import datetime
import hashlib
import json
import os
import pathlib
import re
import sys

ROOT = pathlib.Path('/home/nyaka')
OUT = pathlib.Path(__file__).resolve().parent / 'views.json'

# Все пути — относительно ROOT. Один реестр источников: добавить новый вид =
# одна строка здесь + функция-сборщик. Никаких выдуманных источников.
SOURCES = {
    'atlas': 'shared-repo/bots/miniapp/atlas.json',
    'prompts': 'shared-repo/bots/miniapp/prompts.json',
    'cs2': 'local-llm/work/cs2_voice_ideas.json',
    'confidential': 'local-llm/work/voice_ideas/CONFIDENTIAL_REVIEW.md',
    'skills': '~/.config/opencode/skills/*/SKILL.md',
    'elements': 'shared-repo/bots/miniapp/elements.json',
    'yesno': 'shared-repo/bots/miniapp/yesno-questions.json',
    'works': 'shared-repo/bots/miniapp/works.json',
}
SKILLS_DIR = pathlib.Path.home() / '.config/opencode/skills'
SKILLS_SOURCE = '~/.config/opencode/skills/*/SKILL.md'
# Приватный текст не едет в публичный views.json: вид ссылается на
# авторизованный HTTPS-эндпоинт process_api (проверка initData на сервере).
PRIVATE_API_SOURCE = '/private/review'

# Static GitHub Pages не имеет filesystem: в publish=true вид нельзя положить
# локальный путь в source — иначе views.js делает fetch и получает HTTP 404.
# Локальные пути выше остаются только для чтения билдером; в views.json уходят
# либо голое имя файла из корня miniapp, либо inline-массив (source=items).
PUB = {
    'atlas': 'atlas.json',
    'prompts': 'prompts.json',
    'cs2': None,            # inline: local-llm/work/cs2_voice_ideas.json
    'confidential': 'local',  # приватный слой: только локально, через process_api
    'skills': None,         # inline: ~/.config/opencode/skills/*/SKILL.md
    'elements': 'elements.json',
    'yesno': 'yesno-questions.json',
    'works': 'works.json',
}
PUB_BY_REL = {SOURCES[k]: v for k, v in PUB.items()}

INLINE_LIMIT = 2000   # байт (или число элементов) — порог урезания inline
INLINE_HEAD = 300     # сколько элементов оставляем при превышении порога
BARE_FILE_RE = re.compile(r'^[^/\\]+\.(?:json|js)(?:\?[^/\\]*)?$')

# Паттерны, похожие на секреты. Проверяем и вырезаем их из шапок скиллов и из
# готового документа: в публичный views.json не должен попасть ни один токен.
SECRET_RE = re.compile(
    r'(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{8,}|'
    r'(?:api[_-]?key|token|secret|password)\s*[:=]\s*[A-Za-z0-9_\-]{8,})', re.I)


def scrub(text):
    """Вырезать похожее на секрет из строки шапки."""
    return SECRET_RE.sub('[redacted]', str(text or ''))


def inline_items(items):
    """Inline-данные для publish=true вида.

    views.js берёт данные из v.source, если это массив/объект (inlineSource),
    поэтому source заменяется тем же массивом; поле items дублируется для
    контракта сборщика. При превышении лимита остаются первые INLINE_HEAD
    элементов и честная подпись «показано N из M».
    """
    total = len(items)
    raw = json.dumps(items, ensure_ascii=False).encode('utf-8')
    truncated = (total > INLINE_LIMIT) or (len(raw) > INLINE_LIMIT)
    shown = items[:INLINE_HEAD] if truncated else list(items)
    return {
        'source': shown,
        'items': shown,
        'items_total': total,
        'truncated': truncated,
        'items_note': f'показано {len(shown)} из {total}' if truncated else None,
    }


def skill_files():
    """Реальные файлы по глобу источника; пусто = источника нет."""
    return sorted(SKILLS_DIR.glob('*/SKILL.md'))


def source_files(key, rel):
    """Проверка существования источника: обычный файл или glob скиллов."""
    if key == 'skills':
        return skill_files()
    p = ROOT / rel
    return [p] if p.is_file() else []

WORK_ACTION = [{'label': 'В работу', 'source': 'miniapp_selection'}]
REQUIRED = ('id', 'title', 'type', 'source', 'built_at', 'count', 'publish',
            'group_by', 'sort_by', 'filters', 'label_field', 'value_field',
            'meta_fields', 'actions')
TYPES = {'cards', 'checklist', 'tree', 'table', 'decision'}

# Кнопки ответа для сужающих вопросов да/нет/не знаю — из ТЗ, не из данных.
YESNO_ACTIONS = [
    {'label': 'Да', 'source': 'miniapp_yesno', 'answer': 'yes', 'hotkey': 'y'},
    {'label': 'Нет', 'source': 'miniapp_yesno', 'answer': 'no', 'hotkey': 'n'},
    {'label': 'Не знаю', 'source': 'miniapp_yesno', 'answer': 'unknown', 'hotkey': 'u'},
]

# Маркеры внутренней структуры приватного файла. Если хоть один попал в вывод —
# это утечка текста/ссылок в публичный views.json, сборщик обязан упасть.
PRIVATE_MARKERS = ('voice_messages/', 'audio_', '*Текст:*', '*Оценка:*',
                   '*Почему:*', '*Фраза:*', '*Контекст:*')


def iso():
    """Один штамп времени на весь документ (UTC, секунды)."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def read_json(rel):
    return json.loads((ROOT / rel).read_text(encoding='utf-8'))


def provenance(rel, read_at, redact=False):
    """Откуда вид получил данные: путь, существование, размер, mtime, sha256.

    Для приватного источника sha256 намеренно не считаем: в публичный файл не
    должен попадать даже отпечаток приватного содержимого.
    """
    p = ROOT / rel
    prov = {
        'file': rel,
        'abs': str(p),
        'exists': p.is_file(),
        'size_bytes': None,
        'mtime_utc': None,
        'sha256': None,
        'read_at': read_at,
    }
    if prov['exists']:
        st = p.stat()
        prov['size_bytes'] = st.st_size
        prov['mtime_utc'] = datetime.datetime.fromtimestamp(
            st.st_mtime, datetime.timezone.utc).isoformat(timespec='seconds')
        if not redact:
            prov['sha256'] = hashlib.sha256(p.read_bytes()).hexdigest()
        else:
            prov['note'] = 'redacted: только агрегаты, без текста записей'
    return prov


def view(spec, rel, read_at, count, filters, status='ok', extra=None, redact=False):
    """Собрать описание вида по согласованной схеме + status/provenance."""
    v = {
        'id': spec['id'],
        'title': spec['title'],
        'type': spec['type'],
        # Pages: publish=true видим только имя файла из корня miniapp (или inline)
        'source': (PUB_BY_REL.get(rel) if PUB_BY_REL.get(rel) is not None else rel),
        'built_at': read_at,
        'count': int(count),
        'publish': bool(spec['publish']) and status == 'ok',
        'group_by': spec['group_by'],
        'sort_by': spec['sort_by'],
        'filters': filters,
        'label_field': spec['label_field'],
        'value_field': spec['value_field'],
        'meta_fields': spec['meta_fields'],
        'actions': spec['actions'] if status == 'ok' else [],
        'status': status,
        'provenance': provenance(rel, read_at, redact=redact),
    }
    if extra:
        v.update(extra)
    return v


# --- сборщики: каждый считает реальные поля из реального файла -------------

def build_atlas_tree(rel, read_at):
    d = read_json(rel)
    nodes = d.get('nodes') or []
    kinds = sorted({n.get('kind') for n in nodes if n.get('kind')})
    statuses = sorted({n.get('status') for n in nodes if n.get('status')})
    return view(
        {'id': 'atlas-tree', 'title': 'Атлас: дерево сущностей по видам',
         'type': 'tree', 'publish': True, 'group_by': 'kind', 'sort_by': 'id',
         'label_field': 'text', 'value_field': 'id',
         'meta_fields': ['kind', 'status', 'confidence'],
         'actions': WORK_ACTION},
        rel, read_at, len(nodes),
        [{'field': 'kind', 'values': kinds}, {'field': 'status', 'values': statuses}])


def build_atlas_grids(rel, read_at):
    d = read_json(rel)
    grids = d.get('grids') or []
    groupers = sorted({g.get('group_by') for g in grids if g.get('group_by')})
    return view(
        {'id': 'atlas-grids', 'title': 'Атлас: сетки (group_by)',
         'type': 'cards', 'publish': True, 'group_by': 'group_by', 'sort_by': 'id',
         'label_field': 'title', 'value_field': 'id',
         'meta_fields': ['group_by', 'filter'], 'actions': WORK_ACTION},
        rel, read_at, len(grids),
        [{'field': 'group_by', 'values': groupers}])


def build_atlas_goals(rel, read_at):
    d = read_json(rel)
    goals = [n for n in (d.get('nodes') or []) if n.get('kind') == 'goal']
    statuses = sorted({n.get('status') for n in goals if n.get('status')})
    return view(
        {'id': 'atlas-goals', 'title': 'Цели атласа: чек-лист по статусам',
         'type': 'checklist', 'publish': True, 'group_by': 'status', 'sort_by': 'id',
         'label_field': 'text', 'value_field': 'id',
         'meta_fields': ['status', 'kind', 'confidence'], 'actions': WORK_ACTION},
        rel, read_at, len(goals),
        [{'field': 'status', 'values': statuses}])


def build_prompts(rel, read_at):
    d = read_json(rel)
    prompts = [p for g in (d.get('groups') or []) for p in (g.get('prompts') or [])]
    sources = sorted({p.get('source') for p in prompts if p.get('source')})
    stale = sorted({bool(p.get('is_stale')) for p in prompts}, key=str)
    return view(
        {'id': 'prompts-cards', 'title': 'Промпты: карточки с сортировкой по времени',
         'type': 'cards', 'publish': True, 'group_by': 'source', 'sort_by': 'ts',
         'label_field': 'text', 'value_field': 'id',
         'meta_fields': ['user', 'source_label', 'as_of', 'is_stale'],
         'actions': WORK_ACTION},
        rel, read_at, len(prompts),
        [{'field': 'source', 'values': sources},
         {'field': 'is_stale', 'values': stale}])


def build_cs2(rel, read_at):
    d = read_json(rel)
    themes = d.get('themes') or {}
    rows = [(t, item) for t, items in themes.items() for item in (items or [])]
    items = []
    for t, it in rows:
        row = dict(it or {})
        # Локальный путь к ogg не публикуем: на Pages файла нет, а маркеры
        # voice_messages/audio_ запрещены проверкой приватного слоя в validate().
        voice = str(row.get('voice') or '')
        row['voice'] = voice.rsplit('/', 1)[-1].replace('audio_', '') or '—'
        row['theme'] = t
        items.append(row)
    extra = inline_items(items)
    extra['provenance_note'] = {
        'declared_total': d.get('total'),
        'themed_rows': len(rows),
        'unique_voices': len({it.get('voice') for _, it in rows if it.get('voice')}),
        'note': ('count = строк в таблице (запись может входить в несколько тем); '
                 'declared_total — общее число классифицированных голосовых из файла'),
    }
    return view(
        {'id': 'cs2-ideas', 'title': 'CS2: голосовые идеи по темам',
         'type': 'table', 'publish': True, 'group_by': 'theme', 'sort_by': 'voice',
         'label_field': 'text', 'value_field': 'voice',
         'meta_fields': ['theme', 'voice'], 'actions': WORK_ACTION},
        rel, read_at, len(rows),
        [{'field': 'theme', 'values': sorted(themes)}],
        extra=extra)


REC_RE = re.compile(r'^\*\*(\d+)\s*[·•\-]\s*(PERSONAL|SENSITIVE|UNCERTAIN|PUBLIC)\b', re.M)
SECTION_RE = re.compile(r'^##\s*\d+\.', re.M)
COUNT_RE = re.compile(r'\((\d+)\)')


def build_confidential(rel, read_at):
    """Приватный источник: только id/метки/короткая подпись-намек, без текста.

    Ни voice-ссылки, ни фразы, ни оценки пользователя не попадают в результат —
    сборщик работает с агрегатами и никогда не передаёт строки файла дальше.
    """
    txt = (ROOT / rel).read_text(encoding='utf-8')
    # Границы по заголовкам разделов: 1 — приватный слой, 2 — пограничные, 3 — итог.
    # Заголовок 3-го раздела числа не содержит, поэтому границы и счётчики считаем
    # независимо: сначала режем по `## N.`, потом ищем `(N)` в первых двух заголовках.
    heads = list(SECTION_RE.finditer(txt))
    def section_body(i):
        if len(heads) <= i:
            return ''
        line_end = txt.find('\n', heads[i].end())
        line_end = len(txt) if line_end == -1 else line_end
        next_start = heads[i + 1].start() if len(heads) > i + 1 else len(txt)
        return txt[line_end:next_start]
    sec1, sec2 = section_body(0), section_body(1)
    priv = REC_RE.findall(sec1)
    border = REC_RE.findall(sec2)
    labels = collections.Counter(lbl for _, lbl in priv + border)
    private_labels = collections.Counter(lbl for _, lbl in priv)
    def declared_count(i):
        m = COUNT_RE.search(txt[heads[i].start():txt.find('\n', heads[i].end())]) if len(heads) > i else None
        return int(m.group(1)) if m else None
    declared = [declared_count(0), declared_count(1)]
    parsed = [len(priv), len(border)]
    status = 'ok' if parsed == declared and parsed != [0, 0] else 'parse_error'
    hint = (
        f'приватный слой {len(priv)} '
        f'(PERSONAL {private_labels["PERSONAL"]} / '
        f'SENSITIVE {private_labels["SENSITIVE"]} / '
        f'UNCERTAIN {private_labels["UNCERTAIN"]}); '
        f'пограничные PUBLIC {len(border)}; '
        f'метки: PERSONAL {labels["PERSONAL"]} / SENSITIVE {labels["SENSITIVE"]} / '
        f'UNCERTAIN {labels["UNCERTAIN"]} / PUBLIC {labels["PUBLIC"]}. '
        f'Тексты, voice-ссылки и оценки не включены.'
    )
    # В публичный views.json не попадает ни одна запись: вид указывает на
    # приватный эндпоинт и требует авторизованный запрос (initData).
    v = view(
        {'id': 'confidential-review',
         'title': 'CONFIDENTIAL: приватный слой и пограничные (текст скрыт)',
         'type': 'checklist', 'publish': False, 'group_by': 'section', 'sort_by': 'id',
         'label_field': 'label', 'value_field': 'id',
         'meta_fields': ['label'], 'actions': []},
        rel, read_at, 0,
        [{'field': 'label', 'values': ['PERSONAL', 'SENSITIVE', 'UNCERTAIN', 'PUBLIC']}],
        status='requires_initdata',
        extra={
            'hint': ('приватный слой доступен только локально через process_api. '
                     + hint + ' Нужен авторизованный запрос (initData).'),
            'notice': 'Нужен авторизованный запрос: GET/POST /private/review',
            'provenance_note': {
                'declared_private': declared[0] if declared else None,
                'declared_borderline': declared[1] if len(declared) > 1 else None,
                'parsed_private': len(priv),
                'parsed_borderline': len(border),
                'available_total': len(priv) + len(border),
                'parse_ok': status == 'ok',
            },
        },
        redact=True)
    # source указывает на авторизованный эндпоинт; publish=false не даёт
    # views.js делать fetch с Pages и уводит рендер в плашку «нужен запрос».
    v['source'] = PRIVATE_API_SOURCE
    v['publish'] = False
    v.pop('items', None)  # в публичном документе приватных записей нет
    return v


SKILL_FIELD_RE = re.compile(r'^(name|description)\s*:\s*(.*)$')
DESC_LIMIT = 140


def build_skills(rel, read_at):
    """Обзор скиллов: только шапки (первые 10 строк) реальных SKILL.md.

    Из frontmatter берём name/description, описание обрезаем до 140 символов.
    Никаких токенов: строки проходят через scrub(), плюс финальная проверка
    готового документа в validate().
    """
    files = skill_files()
    items = []
    for p in files:
        fields = {}
        # только первые 10 строк — остальное содержимое скилла не читаем вообще
        for line in p.read_text(encoding='utf-8').split('\n')[:10]:
            m = SKILL_FIELD_RE.match(line.strip())
            if m:
                fields[m.group(1)] = m.group(2).strip().strip('"\'').strip()
        name = scrub(fields.get('name') or p.parent.name)
        desc = scrub(fields.get('description') or '')
        if len(desc) > DESC_LIMIT:
            desc = desc[:DESC_LIMIT - 1].rstrip() + '…'
        items.append({
            'id': p.parent.name,
            'name': name,
            'title': name,  # sort_by="title": та же метка, что и name
            'description': desc,
            'path': str(p.relative_to(pathlib.Path.home())),
        })
    items.sort(key=lambda it: it['title'].lower())
    newest = max((p.stat().st_mtime for p in files), default=None)
    prov = {
        'file': rel,
        'abs': str(SKILLS_DIR / '*/SKILL.md'),
        'exists': bool(files),
        'size_bytes': sum(p.stat().st_size for p in files),
        'mtime_utc': (datetime.datetime.fromtimestamp(newest, datetime.timezone.utc)
                      .isoformat(timespec='seconds') if newest else None),
        'sha256': None,
        'read_at': read_at,
        'built_at': read_at,
        'count': len(items),
        'note': 'только шапки SKILL.md (первые 10 строк): name/description; '
                'описание обрезано до 140 символов; токены вырезаны',
        'files': [str(p.relative_to(pathlib.Path.home())) for p in files],
    }
    return view(
        {'id': 'skills', 'title': 'Обзор скиллов', 'type': 'cards', 'publish': True,
         'group_by': None, 'sort_by': 'title', 'label_field': 'name',
         'value_field': 'id', 'meta_fields': ['description', 'path'],
         'actions': WORK_ACTION},
        rel, read_at, len(items), [],
        extra={**inline_items(items), 'provenance': prov})


def build_elements(rel, read_at):
    """Единая таблица элементов: реальный массив items (его и берёт normalizeData)."""
    d = read_json(rel)
    items = d.get('items') or []
    statuses = sorted({i.get('status') for i in items if i.get('status')})
    groups = sorted({i.get('group') for i in items if i.get('group')})
    return view(
        {'id': 'elements-table', 'title': 'Единая таблица элементов', 'type': 'table',
         'publish': True, 'group_by': 'group', 'sort_by': 'status',
         'label_field': 'label', 'value_field': 'id',
         'meta_fields': ['source', 'displayed', 'actual', 'age_sec', 'status'],
         'actions': WORK_ACTION},
        rel, read_at, len(items),
        [{'field': 'status', 'values': statuses}, {'field': 'group', 'values': groups}],
        extra={'provenance_note': {
            'groups': len(d.get('groups') or []),
            'subtables': len(d.get('subtables') or []),
            'declared_total': (d.get('summary') or {}).get('total'),
            'note': 'count = len(items); normalizeData в views.js тоже берёт массив items',
        }})


def build_yesno(rel, read_at):
    """Сужающие вопросы: spec вида готов заранее, данные остаются в source."""
    d = read_json(rel)
    questions = d.get('questions') or []
    declared = d.get('count')
    max_questions = declared if isinstance(declared, int) else len(questions)
    statuses = sorted({q.get('status') for q in questions if q.get('status')})
    consistent = (declared is None or declared == len(questions)) and len(questions) <= max_questions
    return view(
        {'id': 'yesno-decisions', 'title': 'Сужающие вопросы (да/нет)', 'type': 'decision',
         'publish': True, 'group_by': 'status', 'sort_by': 'priority',
         'label_field': 'text', 'value_field': 'id',
         'meta_fields': ['priority', 'status'], 'actions': YESNO_ACTIONS},
        rel, read_at, len(questions),
        [{'field': 'status', 'values': statuses}],
        status='ok' if consistent else 'parse_error',
        extra={
            'max_questions': max_questions,
            'provenance_note': {
                'declared_count': declared,
                'questions': len(questions),
                'max_questions': max_questions,
                'answer_policy': (d.get('answer_policy') or {}).get('values'),
            },
        })


def build_pdf_hub(rel, read_at):
    """Хаб университетских работ: реальный массив из works.json (список).

    Карточки рендерятся pdf-hub.js (window.PDFHub.render), grouping по source
    совпадает с настройкой рендера по умолчанию. Данные не выдумываются:
    count = реальная длина массива, фильтры — реальные значения полей.
    """
    d = read_json(rel)
    works = d if isinstance(d, list) else (d.get('works') or d.get('items') or [])
    sources = sorted({w.get('source') for w in works if w.get('source')})
    kinds = sorted({w.get('kind') for w in works if w.get('kind')})
    statuses = sorted({w.get('status') for w in works if w.get('status')})
    return view(
        {'id': 'pdf-hub', 'title': 'Хаб университетских работ', 'type': 'cards',
         'publish': True, 'group_by': 'source', 'sort_by': 'date',
         'label_field': 'title', 'value_field': 'id',
         'meta_fields': ['date', 'status', 'kind', 'source', 'path'],
         'actions': WORK_ACTION},
        rel, read_at, len(works),
        [{'field': 'source', 'values': sources},
         {'field': 'kind', 'values': kinds},
         {'field': 'status', 'values': statuses}])


SPECS = [
    ('atlas-tree', 'atlas', build_atlas_tree),
    ('atlas-grids', 'atlas', build_atlas_grids),
    ('atlas-goals', 'atlas', build_atlas_goals),
    ('prompts-cards', 'prompts', build_prompts),
    ('cs2-ideas', 'cs2', build_cs2),
    ('confidential-review', 'confidential', build_confidential),
    ('skills', 'skills', build_skills),
    ('elements-table', 'elements', build_elements),
    ('yesno-decisions', 'yesno', build_yesno),
    ('pdf-hub', 'works', build_pdf_hub),
]

MISSING_META = {
    'atlas-tree': ('Атлас: дерево сущностей по видам', 'tree', 'kind', 'id', ['kind', 'status']),
    'atlas-grids': ('Атлас: сетки (group_by)', 'cards', 'group_by', 'id', ['group_by']),
    'atlas-goals': ('Цели атласа: чек-лист по статусам', 'checklist', 'status', 'id', ['status']),
    'prompts-cards': ('Промпты: карточки с сортировкой по времени', 'cards', 'source', 'ts', ['user']),
    'cs2-ideas': ('CS2: голосовые идеи по темам', 'table', 'theme', 'voice', ['theme']),
    'confidential-review': ('CONFIDENTIAL: приватный слой и пограничные (текст скрыт)',
                            'checklist', 'section', 'id', ['label']),
    'skills': ('Обзор скиллов', 'cards', None, 'title', ['description', 'path']),
    'elements-table': ('Единая таблица элементов', 'table', 'group', 'status',
                       ['source', 'displayed', 'actual', 'age_sec', 'status']),
    'yesno-decisions': ('Сужающие вопросы (да/нет)', 'decision', 'status', 'priority',
                        ['priority', 'status']),
    'pdf-hub': ('Хаб университетских работ', 'cards', 'source', 'date',
                ['date', 'status', 'kind', 'source', 'path']),
}


def missing_view(vid, rel, read_at):
    """Источника нет — оставляем пустой слот с честным статусом, без данных."""
    title, typ, gb, sb, meta = MISSING_META[vid]
    extra = {}
    if vid == 'confidential-review':
        extra['hint'] = 'источник отсутствует; приватные данные не включены'
    # Статическая часть spec сохраняется даже без источника: рендер должен знать,
    # как показать вид, когда данные появятся.
    if vid == 'elements-table':
        extra.update({'label_field': 'label', 'value_field': 'id', 'actions': WORK_ACTION})
    if vid == 'yesno-decisions':
        extra.update({'label_field': 'text', 'value_field': 'id',
                      'actions': YESNO_ACTIONS, 'max_questions': 0})
    if vid == 'pdf-hub':
        extra.update({'label_field': 'title', 'value_field': 'id', 'actions': WORK_ACTION})
    if vid == 'skills':
        extra['items'] = []
        extra['provenance'] = {
            'file': rel, 'abs': str(SKILLS_DIR / '*/SKILL.md'), 'exists': False,
            'size_bytes': None, 'mtime_utc': None, 'sha256': None,
            'read_at': read_at, 'built_at': read_at, 'count': 0,
            'note': 'источник отсутствует; данных нет',
        }
    return view(
        {'id': vid, 'title': title, 'type': typ, 'publish': False,
         'group_by': gb, 'sort_by': sb, 'label_field': 'text', 'value_field': 'id',
         'meta_fields': meta, 'actions': []},
        rel, read_at, 0, [], status='missing', extra=extra or None,
        redact=(vid == 'confidential-review'))


def validate(doc):
    problems = []
    if doc.get('version') != 1:
        problems.append('version != 1')
    ids = [v['id'] for v in doc['views']]
    dupes = [i for i in ids if ids.count(i) > 1]
    if dupes:
        problems.append('дубли id: ' + ', '.join(sorted(set(dupes))))
    for v in doc['views']:
        for key in REQUIRED:
            if key not in v:
                problems.append(f'{v["id"]}: нет поля {key}')
        if v.get('type') not in TYPES:
            problems.append(f'{v["id"]}: type={v.get("type")!r} не из {sorted(TYPES)}')
        if v.get('status') not in {
                'ok', 'missing', 'parse_error', 'requires_initdata', 'private_local_only'}:
            problems.append(f'{v["id"]}: status={v.get("status")!r}')
        if not isinstance(v.get('count'), int) or v['count'] < 0:
            problems.append(f'{v["id"]}: count={v.get("count")!r}')
        if v.get('status') != 'ok' and (v.get('count') != 0 or v.get('publish')):
            problems.append(f'{v["id"]}: missing/parse_error обязан иметь count=0, publish=false')
        if not isinstance(v.get('provenance', {}).get('exists'), bool):
            problems.append(f'{v["id"]}: provenance.exists отсутствует')
        if v.get('publish'):
            src = v.get('source')
            inline_ok = (isinstance(src, list) and bool(src)
                         and isinstance(v.get('items'), list) and bool(v['items']))
            bare_ok = isinstance(src, str) and bool(BARE_FILE_RE.match(src))
            if not (inline_ok or bare_ok):
                problems.append(
                    f'{v["id"]}: publish=true source={src!r} — нужен inline items '
                    f'или голое имя файла из корня miniapp')
    # Гарантия от утечки приватных данных в публичный документ.
    blob = json.dumps(doc, ensure_ascii=False)
    for marker in PRIVATE_MARKERS:
        if marker in blob:
            problems.append(f'утечка приватного маркера в views.json: {marker!r}')
    if SECRET_RE.search(blob):
        problems.append('в views.json найдено нечто похожее на токен/секрет')
    skills = next((v for v in doc['views'] if v['id'] == 'skills'), None)
    if skills is not None:
        expected_source = SOURCES.get('skills', SKILLS_SOURCE)
        src = skills.get('source')
        if not (isinstance(src, list) and src) and src != expected_source:
            problems.append('skills: source должен быть inline items или ' + expected_source)
        items = skills.get('items') or []
        total = skills.get('items_total', len(items))
        if skills.get('count') != total:
            problems.append(f'skills: count={skills.get("count")} != items_total={total}')
        for it in items:
            if len(it.get('description') or '') > DESC_LIMIT:
                problems.append(f'skills: description длиннее {DESC_LIMIT}: {it.get("id")}')
    el = next((v for v in doc['views'] if v['id'] == 'elements-table'), None)
    if el is not None:
        if el.get('source') != PUB['elements']:
            problems.append('elements-table: неверный source (ожидался ' + PUB['elements'] + ')')
        if el.get('status') == 'ok' and el.get('count', 0) <= 0:
            problems.append('elements-table: items пуст, а статус ok')
        if el.get('label_field') != 'label' or el.get('value_field') != 'id':
            problems.append('elements-table: label/value поля не из spec')
    yn = next((v for v in doc['views'] if v['id'] == 'yesno-decisions'), None)
    if yn is not None:
        if yn.get('type') != 'decision':
            problems.append('yesno-decisions: type должен быть decision')
        if not isinstance(yn.get('max_questions'), int):
            problems.append('yesno-decisions: нет max_questions')
        expect = [('Да', 'yes', 'y'), ('Нет', 'no', 'n'), ('Не знаю', 'unknown', 'u')]
        acts = yn.get('actions') or []
        if len(acts) != len(expect) or any(
                a.get('label') != e[0] or a.get('answer') != e[1] or a.get('hotkey') != e[2]
                or a.get('source') != 'miniapp_yesno'
                for a, e in zip(acts, expect)):
            problems.append('yesno-decisions: действия Да/Нет/Не знаю не из spec')
    conf = next((v for v in doc['views'] if v['id'] == 'confidential-review'), None)
    if conf is not None:
        if conf.get('publish') is not False:
            problems.append('confidential-review: publish должен быть false')
        if conf.get('status') not in {'private_local_only', 'requires_initdata'}:
            problems.append('confidential-review: status должен быть private_local_only')
        if conf.get('source') not in {'local', PRIVATE_API_SOURCE}:
            problems.append("confidential-review: source должен быть 'local'")
        if conf.get('items'):
            problems.append('confidential-review: items не должен встраиваться в views.json')
        if 'hint' not in conf:
            problems.append('confidential-review: нет подписи-намека')
        if conf.get('provenance_note', {}).get('parse_ok') is not True:
            problems.append('confidential-review: не пройдена сверка числа записей (16+13)')
    return problems


def main():
    read_at = iso()
    views = []
    for vid, key, builder in SPECS:
        rel = SOURCES[key]
        if not source_files(key, rel):
            views.append(missing_view(vid, rel, read_at))
            continue
        try:
            views.append(builder(rel, read_at))
        except Exception as e:  # источник есть, но не читается — данные не выдумываем
            print(f'WARN {vid}: {type(e).__name__}: {e}', file=sys.stderr)
            v = missing_view(vid, rel, read_at)
            v['status'] = 'parse_error'
            views.append(v)
    doc = {'version': 1, 'built_at': read_at, 'views': views}
    problems = validate(doc)
    if problems:
        print('ОТКАЗ: views.json НЕ записан:', file=sys.stderr)
        for p in problems[:20]:
            print('  - ' + p, file=sys.stderr)
        return 2
    tmp = OUT.with_name(OUT.name + '.tmp')
    mode = OUT.stat().st_mode & 0o777 if OUT.exists() else 0o664
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.chmod(tmp, mode)
    os.replace(tmp, OUT)
    print(f'OK -> {OUT}')
    print(f'  видов: {len(views)} · publish=true: '
          f'{sum(1 for v in views if v["publish"])} · built_at: {read_at}')
    for v in views:
        print(f'    {v["id"]:<22} {v["type"]:<9} count={v["count"]:<5} '
              f'publish={str(v["publish"]):<5} status={v["status"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
