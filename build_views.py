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
    'grids': 'shared-repo/bots/miniapp/grids.json',
    'tree': 'shared-repo/bots/miniapp/tree.json',
    'video-tree': 'shared-repo/bots/miniapp/video-tree.json',
    'video-authors': 'shared-repo/bots/miniapp/video-authors.json',
    'voiceideas': 'shared-repo/bots/miniapp/voice-ideas.json',
    'lifeideas': 'shared-repo/bots/miniapp/life-ideas.json',
}
SKILLS_DIR = pathlib.Path.home() / '.config/opencode/skills'
SKILLS_SOURCE = '~/.config/opencode/skills/*/SKILL.md'
# Приватный текст не едет в публичный views.json: вид ссылается на
# авторизованный HTTPS-эндпоинт process_api (проверка initData на сервере).
PRIVATE_API_SOURCE = '/private/review'

# Static GitHub Pages не имеет filesystem: в publish=true вид нельзя положить
# локальный путь в source — иначе views.js делает fetch и получает HTTP 404.
# Локальные пути выше остаются только для чтения билдером; в views.json уходят
# только голые имена файлов из корня miniapp. Тяжёлые массивы (cs2-ideas, skills)
# пишутся отдельными файлами и подгружаются views.js по требованию — инлайнить
# их в views.json нельзя: он раздувался до ~600 КБ и грузился при каждом открытии.
PUB = {
    'atlas': 'atlas.json',
    'prompts': 'prompts.json',
    'cs2': 'cs2-ideas.json',      # отдельный файл, не inline
    'confidential': 'local',      # приватный слой: только локально, через process_api
    'skills': 'skills.json',      # отдельный файл, не inline
    'elements': 'elements.json',
    'yesno': 'yesno-questions.json',
    'works': 'works.json',
    'grids': 'grids.json',
    'tree': 'tree.json',        # голое имя: Pages отдаёт файл из корня miniapp
    'video-tree': 'video-tree.json',
    'voiceideas': 'voice-ideas.json',
    'lifeideas': 'life-ideas.json',
}
PUB_BY_REL = {SOURCES[k]: v for k, v in PUB.items()}

# Отдельные источники для видов, которые раньше инлайнились в views.json.
# Ключ — имя файла в корне miniapp, значение — payload с массивом items.
SIDE_OUTPUTS = {}
SIDE_NAMES = (PUB['cs2'], PUB['skills'], PUB['voiceideas'], PUB['lifeideas'],
              'prompts-groups.json', 'prompts-3days.json', 'prompts-branches.json',
              'prompts-wants.json', 'prompts-verdicts.json', 'prompts-unanswered.json')


def side_file(name, items, read_at, total=None, **extra):
    """Подготовить отдельный файл-источник вместо inline-массива в views.json."""
    payload = {
        'items': list(items),
        'count': len(items),
        'total': total if total is not None else len(items),
        'built_at': read_at,
    }
    payload.update(extra)
    SIDE_OUTPUTS[name] = payload

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
    edges = d.get('edges') or []
    return view(
        {'id': 'atlas-tree',
         'title': f'Атлас: сущности по видам ({len(edges)} связей не визуализируются)',
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


def build_task_tree(rel, read_at):
    """Дерево задач из tree.json: 24 корня, 118 узлов, id/name/status/children.

    views.js buildTree сам находит children и строит настоящую вложенность;
    group_by служит запасной группировкой и фильтром по статусу.
    """
    d = read_json(rel)
    roots = d if isinstance(d, list) else (d.get('roots') or d.get('items') or [])
    nodes = []

    def walk(n):
        nodes.append(n)
        for c in (n.get('children') or []):
            walk(c)

    for r in roots:
        walk(r)
    statuses = sorted({n.get('status') for n in nodes if n.get('status')})
    return view(
        {'id': 'task-tree',
         'title': f'Дерево задач: {len(roots)} корней / {len(nodes)} узлов',
         'type': 'tree', 'publish': True, 'group_by': 'status', 'sort_by': 'id',
         'label_field': 'name', 'value_field': 'id',
         'meta_fields': ['status'], 'actions': WORK_ACTION},
        rel, read_at, len(nodes),
        [{'field': 'status', 'values': statuses}],
        extra={'root_count': len(roots), 'node_count': len(nodes),
               'note': 'источник tree.json; task-tree.js читает LIVE.tree напрямую, '
                       'реестр views нужен для единого входа и аудита'})


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


def _prompt_rows(d):
    """Плоские строки из 9 именованных групп prompts.json с подписями смыслов."""
    as_of = (d.get('meta') or {}).get('as_of')
    rows = []
    for g in d.get('groups') or []:
        for p in g.get('prompts') or []:
            r = dict(p)
            r['group'] = g.get('name')
            r['want'] = (p.get('wants') or [None])[0]
            r['has_answer'] = bool(p.get('answer'))
            if as_of and p.get('ts'):
                r['age_days'] = round((as_of - p['ts']) / 86_400_000, 2)
            rows.append(r)
    return rows


def _prompt_view(vid, title, group_by, side_name, predicate):
    def build(rel, read_at):
        d = read_json(rel)
        rows = [r for r in _prompt_rows(d) if predicate(r)]
        side_file(side_name, rows, read_at)
        values = sorted({str(r.get(group_by)) for r in rows
                         if r.get(group_by) not in (None, '', False)})
        return view(
            {'id': vid, 'title': title,
             'type': 'cards', 'publish': True, 'group_by': group_by, 'sort_by': 'ts',
             'label_field': 'text', 'value_field': 'id',
             'meta_fields': ['group', 'source_label', 'user', 'want', 'age_days', 'is_stale'],
             'actions': WORK_ACTION},
            rel, read_at, len(rows), [{'field': group_by, 'values': values}],
            extra={'source': side_name})
    return build


def build_prompts_groups(rel, read_at):
    """Настоящее дерево: 9 смысловых ветвей → промпты с подписью ответа."""
    d = read_json(rel)
    rows = _prompt_rows(d)
    nodes = []
    for g in d.get('groups') or []:
        kids = []
        for p in g.get('prompts') or []:
            kids.append({
                'id': p.get('id'),
                'name': (p.get('text') or '')[:160],
                'status': 'PASS' if p.get('answer') else 'OPEN',
                'user': p.get('user'),
                'source_label': p.get('source_label'),
                'is_stale': p.get('is_stale'),
            })
        nodes.append({'id': g.get('id'), 'name': g.get('name'),
                      'status': 'PASS' if kids else 'OPEN', 'children': kids})
    side_file('prompts-groups.json', nodes, read_at, total=len(rows))
    groups = sorted({g.get('name') for g in d.get('groups') or [] if g.get('name')})
    return view(
        {'id': 'prompts-semantic-groups', 'title': 'Промпты: дерево из 9 смысловых ветвей',
         'type': 'tree', 'publish': True, 'group_by': None, 'sort_by': 'id',
         'label_field': 'name', 'value_field': 'id',
         'meta_fields': ['status', 'user', 'source_label', 'is_stale'],
         'actions': WORK_ACTION},
        rel, read_at, len(rows),
        [{'field': 'group', 'values': groups}],
        extra={'source': 'prompts-groups.json', 'count': len(rows)})
build_prompts_3days = _prompt_view(
    'prompts-lenta-3days', 'Промпты: лента последних 3 дней',
    'source', 'prompts-3days.json', lambda r: r.get('age_days') is not None and r['age_days'] <= 3)
build_prompts_branches = _prompt_view(
    'prompts-opencode-branches', 'Промпты: ветки сессий OpenCode',
    'title', 'prompts-branches.json', lambda r: r.get('source') == 'session')
build_prompts_wants = _prompt_view(
    'prompts-wants-links', 'Промпты: связи с хотелками',
    'want', 'prompts-wants.json', lambda r: bool(r.get('want')))
build_prompts_verdicts = _prompt_view(
    'prompts-verdicts', 'Промпты: свежие короткие ответы (не дубль связей с хотелками)',
    'user', 'prompts-verdicts.json',
    lambda r: bool(r.get('answer_short')) and r.get('is_stale') is False)
build_prompts_unanswered = _prompt_view(
    'prompts-unanswered', 'Промпты: без ответа',
    'source', 'prompts-unanswered.json', lambda r: not r.get('has_answer'))


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
    meta = inline_items(items)
    shown = meta.pop('source')
    meta.pop('items', None)  # сам массив уходит в отдельный файл, не в views.json
    uniq = len({it.get('voice') for _, it in rows if it.get('voice')})
    declared = d.get('total')
    # Единица счёта — строка theme-item, НЕ голосовое: одна запись может
    # входить в несколько тем. «300 из 1438» без уточнения единицы читается
    # как 300 голосовых из 1438; называем все три числа явно, данные не трогаем.
    honest_note = (
        f"показано {len(shown)} из {meta['items_total']} строк тем "
        f"(уникальных голосовых {uniq}, классифицировано {declared}); "
        "строка ≠ голосовое: запись может входить в несколько тем"
    )
    side_file(PUB['cs2'], shown, read_at, total=meta['items_total'],
              shown_rows=len(shown), total_rows=meta['items_total'],
              unique_voices=uniq, declared_total=declared,
              note=honest_note)
    extra = meta
    extra['items_note'] = honest_note
    extra['count_note'] = (
        f'count={len(rows)} — строки тем, не голосовые; '
        f'уникальных голосовых {uniq} из {declared} классифицированных'
    )
    extra['provenance_note'] = {
        'declared_total': declared,
        'themed_rows': len(rows),
        'unique_voices': uniq,
        'note': ('count = число строк theme-item (запись может входить в несколько тем), '
                 'НЕ число голосовых; shown_rows = загружено строк; '
                 'declared_total — классифицировано голосовых в исходном файле; '
                 'unique_voices — уникальных голосовых среди строк тем'),
    }
    return view(
        {'id': 'cs2-ideas',
         'title': (f'CS2: голосовые идеи по темам — {len(shown)}/{meta["items_total"]} '
                   f'строк, уникальных голосовых {uniq}'),
         'type': 'table', 'publish': True, 'group_by': 'theme', 'sort_by': 'voice',
         'label_field': 'text', 'value_field': 'voice',
         'meta_fields': ['theme', 'voice'], 'actions': WORK_ACTION},
        rel, read_at, len(rows),
        [{'field': 'theme', 'values': sorted(themes)}],
        extra=extra)


def build_voice_ideas(rel, read_at):
    """115 идей из голосовых: статус/гейт/корпус, без цитат и имён."""
    d = read_json(rel)
    items = d.get('items') or []
    queue = d.get('queue') or []
    tiers = sorted({x.get('tier') for x in items if x.get('tier')})
    themes = sorted({x.get('theme') for x in items if x.get('theme')})
    meta = inline_items(items)
    shown = meta.pop('source')
    meta.pop('items', None)
    side_file(PUB['voiceideas'], shown, read_at, total=meta['items_total'], queue=queue)
    extra = meta
    extra['queue_n'] = len(queue)
    extra['note'] = d.get('note')
    v = view(
        {'id': 'voice-ideas',
         'title': f'Голосовые идеи: {len(items)} гипотез, {len(queue)} готовы к прогону',
         'type': 'table', 'publish': True, 'group_by': 'tier', 'sort_by': 'id',
         'label_field': 'title', 'value_field': 'id',
         'meta_fields': ['tier_label', 'status', 'theme'], 'actions': WORK_ACTION},
        rel, read_at, len(items),
        [{'field': 'tier', 'values': tiers},
         {'field': 'theme', 'values': themes}],
        extra=extra)
    v['provenance'].pop('abs', None)
    return v


def build_life_ideas(rel, read_at):
    """157 не-CS принципов (работа, инструменты, жизнь): без цитат и имён."""
    d = read_json(rel)
    items = d.get('items') or []
    cats = sorted({x.get('cat') for x in items if x.get('cat')})
    meta = inline_items(items)
    shown = meta.pop('source')
    meta.pop('items', None)
    side_file(PUB['lifeideas'], shown, read_at, total=meta['items_total'])
    extra = meta
    extra['note'] = d.get('note')
    v = view(
        {'id': 'life-ideas',
         'title': f'Не-CS идеи из голосовых: {len(items)} принципов',
         'type': 'cards', 'publish': True, 'group_by': 'cat', 'sort_by': 'id',
         'label_field': 'idea', 'value_field': 'id',
         'meta_fields': ['cat'], 'actions': WORK_ACTION},
        rel, read_at, len(items),
        [{'field': 'cat', 'values': cats}],
        extra=extra)
    v['provenance'].pop('abs', None)
    return v


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
            # R12: в публичный манифест — только идентификатор вида и флаг
            # publish=false. Агрегаты, абсолютные пути и подсказки не публикуем.
            'notice': 'Нужен авторизованный запрос: GET/POST /private/review',
        },
        redact=True)
    # source указывает на авторизованный эндпоинт; publish=false не даёт
    # views.js делать fetch с Pages и уводит рендер в плашку «нужен запрос».
    v['source'] = PRIVATE_API_SOURCE
    v['publish'] = False
    v.pop('items', None)  # в публичном документе приватных записей нет
    # R12: даже redact=True оставляет абсолютный путь в provenance — удаляем
    # блок целиком. В публичном манифесте остаются id, publish=false и notice.
    v.pop('provenance', None)
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
    meta = inline_items(items)
    shown = meta.pop('source')
    meta.pop('items', None)
    side_file(PUB['skills'], shown, read_at, total=meta['items_total'])
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
        extra={**meta, 'provenance': prov})


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


def _video_grids_builder(vid, group_by, default_title):
    """Сетки разборов видео: фильтры и счётчики считаются из grids.json, не хардкодятся."""
    def _build(rel, read_at, scope=None, title=None):
        d = read_json(rel)
        items = d.get('items') or []
        fields = ('author', 'video', 'cluster', 'verdict_source', 'n2_status')
        values = {f: sorted({str(x.get(f)) for x in items if x.get(f)}) for f in fields}
        filters = [{'field': group_by, 'values': values.get(group_by, [])},
                   {'field': 'verdict_source', 'values': values['verdict_source']}]
        for f in ('author', 'cluster', 'n2_status'):
            if f != group_by and values[f]:
                filters.append({'field': f, 'values': values[f]})
        extra = {}
        if scope is not None:
            extra['scope'] = scope
        if title is not None:
            extra['title'] = title
        return view(
            {'id': vid, 'title': title or default_title,
             'type': 'cards', 'publish': False, 'group_by': group_by, 'sort_by': 'id',
             'label_field': 'claim', 'value_field': 'id',
             'meta_fields': ['verdict_label', 'verdict_source', 'cluster_title',
                             'n2_status', 'author', 'video_labels', 'as_of',
                             'scope_note', 'coverage_authors_pct'],
             'actions': WORK_ACTION},
            rel, read_at, len(items), filters, extra=extra or None)
    return _build


def video_scope(corpus, grids):
    """Покрытие снимка N2/67 относительно полного корпуса расшифровок.

    Никаких «просто 2 автора»: снимок обязан объявить, сколько каналов он
    покрывает и кого не покрывает. Чистая функция от двух словарей — чтобы
    гейт можно было проверять отрицательным тестом без правки живых файлов.
    """
    items = corpus.get('items') or []
    by_alias = {str(i.get('grid_id')): i['id'] for i in items if i.get('grid_id')}
    corpus_ids = {i['id'] for i in items if i['transcripts']}
    raw = [str(a.get('id') or a.get('title'))
           for a in (grids.get('authors') or [])]
    mapped = {by_alias.get(a, a) for a in raw}
    covered = sorted(mapped & corpus_ids)
    unknown = sorted(a for a in raw if a not in by_alias and a not in corpus_ids)
    missing = sorted(corpus_ids - set(covered))
    corpus_tr = sum(int(i.get('transcripts') or 0) for i in items)
    covered_tr = sum(int(i.get('transcripts') or 0) for i in items
                     if i['id'] in covered)
    try:
        stale_days = (datetime.datetime.now(datetime.timezone.utc).date()
                      - datetime.date.fromisoformat(grids['as_of'])).days
    except Exception:
        stale_days = -1
    return {
        'corpus': {'channels': len(items), 'with_transcripts': len(corpus_ids),
                   'transcripts': corpus_tr, 'as_of': corpus.get('as_of', '')},
        'snapshot': {'id': grids.get('corpus_id', ''), 'as_of': grids.get('as_of', ''),
                     'authors': len(raw), 'claims': int(grids.get('count') or 0),
                     'videos': int((grids.get('thresholds') or {}).get('videos') or 0)},
        'covered': covered, 'missing': missing, 'unknown': unknown,
        'stale_days': stale_days,
        'covered_transcripts': covered_tr,
        'coverage_authors_pct': round(100 * len(covered) / len(corpus_ids), 1) if corpus_ids else 0,
        'coverage_transcripts_pct': round(100 * covered_tr / corpus_tr, 1) if corpus_tr else 0,
        'scope_note': (f'снимок {grids.get("as_of", "")}: {len(covered)} из '
                       f'{len(corpus_ids)} каналов с расшифровками, {covered_tr} из '
                       f'{corpus_tr} расшифровок; без вердиктов: '
                       f'{", ".join(missing) or "нет"}'),
    }


def full_video_scope(corpus):
    """Покрытие каталога авторов: он обязан показывать весь корпус целиком."""
    items = corpus.get('items') or []
    ids = sorted(i['id'] for i in items if i['transcripts'])
    tr = sum(int(i.get('transcripts') or 0) for i in items)
    return {
        'corpus': {'channels': len(items), 'with_transcripts': len(ids),
                   'transcripts': tr, 'as_of': corpus.get('as_of', '')},
        'snapshot': {'id': 'FULL-CORPUS', 'as_of': corpus.get('as_of', ''),
                     'authors': len(ids), 'claims': 0,
                     'videos': sum(int(i.get('videos_transcribed') or 0) for i in items)},
        'covered': ids, 'missing': [], 'unknown': [], 'stale_days': 0,
        'covered_transcripts': tr,
        'coverage_authors_pct': 100.0 if ids else 0,
        'coverage_transcripts_pct': 100.0 if tr else 0,
        'scope_note': f'полный корпус: {len(ids)} каналов с расшифровками, {tr} расшифровок',
    }


def scope_problems(scope, expected):
    """Сравнить объявленное покрытие с реальным. Возвращает список нарушений."""
    if not isinstance(scope, dict):
        return ['нет scope: снимок не объявляет покрытие корпуса']
    keys = ('corpus', 'snapshot', 'covered', 'missing', 'unknown', 'stale_days',
            'covered_transcripts', 'coverage_authors_pct',
            'coverage_transcripts_pct', 'scope_note')
    problems = [f'scope без поля {k}' for k in keys if k not in scope]
    if problems:
        return problems
    for k in keys:
        if scope[k] != expected[k]:
            problems.append(f'scope.{k}: {scope[k]} != {expected[k]}')
    if expected['unknown']:
        problems.append('снимок содержит авторов вне корпуса: ' + ', '.join(expected['unknown']))
    return problems


def _grids_scope(d):
    return video_scope(read_json(SOURCES['video-authors']), d)


def build_video_grids_authors(rel, read_at):
    d = read_json(rel)
    scope = _grids_scope(d)
    title = ('⚠ ' if scope['stale_days'] >= 3 else '') + (
        f'Разборы видео: сетка авторов {scope["snapshot"]["authors"]} из '
        f'{scope["corpus"]["with_transcripts"]} · снимок {scope["snapshot"]["as_of"]}')
    return _video_grids_builder('video-grids-authors', 'author', title)(rel, read_at,
                                                                        scope=scope, title=title)


def build_video_grids_videos(rel, read_at):
    d = read_json(rel)
    scope = _grids_scope(d)
    title = ('⚠ ' if scope['stale_days'] >= 3 else '') + (
        f'Разборы видео: сетка видео {scope["snapshot"]["videos"]} из '
        f'{scope["corpus"]["transcripts"]} · снимок {scope["snapshot"]["as_of"]}')
    return _video_grids_builder('video-grids-videos', 'video', title)(rel, read_at,
                                                                      scope=scope, title=title)


def build_video_grids_clusters(rel, read_at):
    d = read_json(rel)
    scope = _grids_scope(d)
    title = ('⚠ ' if scope['stale_days'] >= 3 else '') + (
        f'Разборы видео: сетка идей 8 кластеров · снимок {scope["snapshot"]["as_of"]}')
    return _video_grids_builder('video-grids-clusters', 'cluster', title)(rel, read_at,
                                                                          scope=scope, title=title)


def build_video_authors(rel, read_at):
    """Каталог всех авторов с расшифровками — из state.db, не из снимка N2/67."""
    corpus = read_json(rel)
    rows = corpus.get('items') or []
    values = {f: sorted({str(x.get(f)) for x in rows if x.get(f)})
              for f in ('status', 'claim_grid')}
    scope = full_video_scope(corpus)
    extra = inline_items(rows)
    extra['scope'] = scope
    extra['title'] = (f'Разборы видео: все авторы расшифровок '
                      f'({scope["corpus"]["with_transcripts"]} + '
                      f'{scope["corpus"]["channels"] - scope["corpus"]["with_transcripts"]})')
    return view(
        {'id': 'video-authors',
         'title': extra['title'],
         'type': 'cards', 'publish': True, 'group_by': 'status', 'sort_by': 'id',
         'label_field': 'title', 'value_field': 'id',
         'meta_fields': ['alias', 'videos', 'videos_transcribed', 'transcripts',
                         'status', 'claim_grid', 'note', 'scope_note'],
         'actions': WORK_ACTION},
        rel, read_at, len(rows),
        [{'field': 'status', 'values': values['status']},
         {'field': 'claim_grid', 'values': values['claim_grid']}],
        extra=extra)


def build_video_ideas_tree_count(rel, read_at):
    base = build_video_ideas_tree(rel, read_at)
    base['count'] = int((read_json(rel).get('counts') or {}).get('claims', 0))
    return base


def build_video_ideas_tree(rel, read_at):
    """Дерево смыслов вместо сеток: корень → 4 ветви → 8 кластеров → 40 claim."""
    d = read_json(rel)
    nodes = d.get('nodes') or []
    counts = d.get('counts') or {}
    statuses = sorted({n.get('status') for b in nodes for c in b.get('children', [])
                       for n in c.get('children', []) if n.get('status')})
    scope = _grids_scope(read_json(SOURCES['grids']))
    stale = '⚠ ' if scope['stale_days'] >= 3 else ''
    return view(
        {'id': 'video-ideas-tree',
         'title': (f'{stale}Разборы видео: дерево смыслов '
                   f'({counts.get("claims", 0)} утверждений, '
                   f'снимок {scope["snapshot"]["as_of"]})'),
         'type': 'tree', 'publish': True, 'group_by': None, 'sort_by': 'id',
         'label_field': 'name', 'value_field': 'id',
         'meta_fields': ['status', 'source', 'author', 'video', 'cluster', 'as_of',
                         'scope_note', 'coverage_authors_pct'],
         'actions': WORK_ACTION},
        rel, read_at, len(nodes),
        [{'field': 'status', 'values': statuses}],
        extra={'scope': scope})


SPECS = [
    ('atlas-tree', 'atlas', build_atlas_tree),
    ('atlas-grids', 'atlas', build_atlas_grids),
    ('atlas-goals', 'atlas', build_atlas_goals),
    ('task-tree', 'tree', build_task_tree),
    ('prompts-cards', 'prompts', build_prompts),
    ('prompts-semantic-groups', 'prompts', build_prompts_groups),
    ('prompts-lenta-3days', 'prompts', build_prompts_3days),
    ('prompts-opencode-branches', 'prompts', build_prompts_branches),
    ('prompts-wants-links', 'prompts', build_prompts_wants),
    ('prompts-verdicts', 'prompts', build_prompts_verdicts),
    ('prompts-unanswered', 'prompts', build_prompts_unanswered),
    ('cs2-ideas', 'cs2', build_cs2),
    ('confidential-review', 'confidential', build_confidential),
    ('skills', 'skills', build_skills),
    ('elements-table', 'elements', build_elements),
    ('yesno-decisions', 'yesno', build_yesno),
    ('pdf-hub', 'works', build_pdf_hub),
    ('video-grids-authors', 'grids', build_video_grids_authors),
    ('video-grids-videos', 'grids', build_video_grids_videos),
    ('video-grids-clusters', 'grids', build_video_grids_clusters),
    ('video-ideas-tree', 'video-tree', build_video_ideas_tree_count),
    ('video-authors', 'video-authors', build_video_authors),
    ('voice-ideas', 'voiceideas', build_voice_ideas),
    ('life-ideas', 'lifeideas', build_life_ideas),
]

MISSING_META = {
    'atlas-tree': ('Атлас: сущности по видам (связи не визуализируются)', 'tree', 'kind', 'id', ['kind', 'status']),
    'atlas-grids': ('Атлас: сетки (group_by)', 'cards', 'group_by', 'id', ['group_by']),
    'atlas-goals': ('Цели атласа: чек-лист по статусам', 'checklist', 'status', 'id', ['status']),
    'task-tree': ('Дерево задач (tree.json)', 'tree', 'status', 'id', ['status']),
    'prompts-cards': ('Промпты: карточки с сортировкой по времени', 'cards', 'source', 'ts', ['user']),
    'prompts-semantic-groups': ('Промпты: дерево из 9 смысловых ветвей', 'tree', None, 'id', ['status', 'user']),
    'prompts-lenta-3days': ('Промпты: лента последних 3 дней', 'cards', 'source', 'ts', ['age_days']),
    'prompts-opencode-branches': ('Промпты: ветки сессий OpenCode', 'cards', 'title', 'ts', ['title']),
    'prompts-wants-links': ('Промпты: связи с хотелками', 'cards', 'want', 'ts', ['want']),
    'prompts-verdicts': ('Промпты: ответы по получателям', 'cards', 'user', 'ts', ['user']),
    'prompts-unanswered': ('Промпты: без ответа', 'cards', 'source', 'ts', ['source_label']),
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
    'video-grids-authors': ('Разборы видео: сетка авторов (2) · вердикты по 40 claim', 'cards', 'author', 'id', ['verdict_label', 'verdict_source']),
    'video-grids-videos': ('Разборы видео: сетка видео (10) · вердикты по 40 claim', 'cards', 'video', 'id', ['verdict_label', 'verdict_source']),
    'video-grids-clusters': ('Разборы видео: сетка идей (8 кластеров, гейт G3)', 'cards', 'cluster', 'id', ['verdict_label', 'verdict_source']),
    'video-ideas-tree': ('Разборы видео: дерево смыслов (40 claim, ветвление ≤7)', 'tree', None, 'id', ['status', 'cluster', 'source']),
    'video-authors': ('Разборы видео: все авторы расшифровок (5 + 1)', 'cards', 'status', 'id', ['alias', 'videos', 'transcripts', 'claim_grid']),
    'voice-ideas': ('Голосовые идеи: иерархия 115', 'table', 'tier', 'id', ['tier_label', 'status', 'theme']),
    'life-ideas': ('Не-CS идеи из голосовых', 'cards', 'cat', 'id', ['cat']),
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
        if v.get('id') != 'confidential-review' and not isinstance(
                v.get('provenance', {}).get('exists'), bool):
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
        src = skills.get('source')
        if src != PUB['skills']:
            problems.append('skills: source должен быть ' + PUB['skills'] + ' (не inline)')
        if skills.get('publish') and skills.get('status') == 'ok' and not skills.get('count'):
            problems.append('skills: publish=true, но count=0')
        total = skills.get('items_total', skills.get('count'))
        if skills.get('count') != total:
            problems.append(f'skills: count={skills.get("count")} != items_total={total}')
        if isinstance(skills.get('items'), list) and skills['items']:
            problems.append('skills: items не должен инлайниться в views.json')
    cs2 = next((v for v in doc['views'] if v['id'] == 'cs2-ideas'), None)
    if cs2 is not None:
        src = cs2.get('source')
        if src != PUB['cs2']:
            problems.append('cs2-ideas: source должен быть ' + PUB['cs2'] + ' (не inline)')
        total = cs2.get('items_total', cs2.get('count'))
        if cs2.get('count') != total:
            problems.append(f'cs2-ideas: count={cs2.get("count")} != items_total={total}')
        if isinstance(cs2.get('items'), list) and cs2['items']:
            problems.append('cs2-ideas: items не должен инлайниться в views.json')
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
        # R12: публичный манифест содержит только id/publish=false/notice.
        # Подсказки, агрегаты и абсолютные пути не требуются и не публикуются.
        if any(k in conf for k in ('hint', 'provenance', 'provenance_note')):
            problems.append('confidential-review: в публичном манифесте есть приватные метаданные')

    # Системный гейт: любой вид разборов обязан честно объявлять покрытие
    # снимка относительно полного корпуса расшифровок. Сокрытие разрыва,
    # выдуманный автор или устаревший счётчик ломают сборку views.json.
    try:
        corpus = read_json(SOURCES['video-authors'])
        grids = read_json(SOURCES['grids'])
    except Exception:
        corpus = grids = None
    if corpus is not None and grids is not None:
        snap = video_scope(corpus, grids)
        full = full_video_scope(corpus)
        by_id = {v.get('id'): v for v in doc['views']}
        for vid in ('video-grids-authors', 'video-grids-videos',
                    'video-grids-clusters', 'video-ideas-tree'):
            v = by_id.get(vid)
            if v and v.get('status') == 'ok':
                for problem in scope_problems(v.get('scope'), snap):
                    problems.append(f'{vid}: {problem}')
        v = by_id.get('video-authors')
        if v and v.get('status') == 'ok':
            for problem in scope_problems(v.get('scope'), full):
                problems.append(f'video-authors: {problem}')
    return problems


def validate_side(side, views):
    """Проверить отдельные файлы-источники перед атомарной записью."""
    problems = []
    expected = {v.get('source') for v in views
                if v.get('publish') and v.get('status') == 'ok'
                and v.get('source') in SIDE_NAMES}
    if set(side) != expected:
        problems.append('отдельные источники: ожидались ' + ', '.join(sorted(expected)) +
                        ', получены ' + ', '.join(sorted(side)))
    for name, payload in side.items():
        items = payload.get('items')
        if not isinstance(items, list):
            problems.append(f'{name}: отсутствует массив items')
            continue
        if payload.get('count') != len(items):
            problems.append(f'{name}: count != len(items)')
        if name == PUB['skills']:
            for it in items:
                if len(it.get('description') or '') > DESC_LIMIT:
                    problems.append(f'{name}: description длиннее {DESC_LIMIT}: {it.get("id")}')
    return problems


def main():
    SIDE_OUTPUTS.clear()
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
    problems = validate(doc) + validate_side(SIDE_OUTPUTS, views)
    if problems:
        print('ОТКАЗ: views.json НЕ записан:', file=sys.stderr)
        for p in problems[:20]:
            print('  - ' + p, file=sys.stderr)
        return 2
    # Сначала отдельные источники, затем views.json — иначе spec может сослаться
    # на ещё не существующий файл. Каждый файл пишется через tmp + os.replace.
    for name, payload in SIDE_OUTPUTS.items():
        target = OUT.with_name(name)
        tmp = OUT.with_name(name + '.tmp')
        mode = target.stat().st_mode & 0o777 if target.exists() else 0o664
        tmp.write_text(json.dumps(payload, ensure_ascii=False,
                                  separators=(',', ':')) + '\n', encoding='utf-8')
        os.chmod(tmp, mode)
        os.replace(tmp, target)
        print(f'OK -> {target} ({target.stat().st_size} байт, items={payload["count"]})')
    tmp = OUT.with_name(OUT.name + '.tmp')
    mode = OUT.stat().st_mode & 0o777 if OUT.exists() else 0o664
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.chmod(tmp, mode)
    os.replace(tmp, OUT)
    print(f'OK -> {OUT} ({OUT.stat().st_size} байт)')
    print(f'  видов: {len(views)} · publish=true: '
          f'{sum(1 for v in views if v["publish"])} · built_at: {read_at}')
    for v in views:
        print(f'    {v["id"]:<22} {v["type"]:<9} count={v["count"]:<5} '
              f'publish={str(v["publish"]):<5} status={v["status"]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
