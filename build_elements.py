#!/usr/bin/env python3
"""Единая таблица обновляемых элементов мини-апа (elements.json).

Цель: один аудируемый объект, где для КАЖДОГО динамического элемента UI
464 сравнены «что показывает мини-ап» (displayed, из опубликованных JSON)
и «что есть на самом деле» (actual, из живого зонда или пересчёта источника).
Таблица умеет содержать подтаблицы: поле `group` у строки и вложенный массив
`subtables` (каждая подтаблица — дочерняя таблица со своими строками).

Правила контракта (наследуют build_views.py / build_prompts.py):
  * НИ одного выдуманного значения. Нет источника или зонд упал ->
    actual=null, status="missing", причина в provenance.reason.
  * display/actual/status — как в views.js type=table:
    id / label / source / status / displayed / actual / age_sec (+ group).
  * Статус: ok|stale|missing|mismatch. stale только по возрасту источника
    относительно TTL из index.html (TTL там в мс, здесь в секундах).
  * Пишем только НОВЫЙ файл elements.json (tmp + os.replace).
    index.html, views.js, status.json, miniapp_status.py — не трогаем вообще.

Источники (только чтение): status.json, sessions.json, live.json, tree.json,
prompts.json, atlas.json, views.json, replies.json, questions.json.
Живые зонды: pgrep -fc '[o]pencode run', systemctl --user list-units,
/api/session/active и /api/session?limit=200 через `opencode api`.
Дополнительно (только чтение, с контролем доступности): git-история
опубликованного prompts.json (переход 204 -> 409) и счётчики источников,
на которые ссылается views.json.

Запуск: python3 ~/shared-repo/bots/miniapp/build_elements.py
"""
import collections
import datetime
import glob as globmod
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path('/home/nyaka')
HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / 'elements.json'
TMP = HERE / '.elements.json.tmp'
PAGES = ROOT / 'runtime/tmp-checkpoint/tg-miniapp-pages'
OPENCODE = ROOT / '.opencode/bin/opencode'
MSK = datetime.timezone(datetime.timedelta(hours=3))

# Все путь источника — относительно ROOT. Ни одного захардкоженного числа:
# числа приходят только из файлов и зондов ниже.
FILES = {
    'status':   'shared-repo/bots/miniapp/status.json',
    'sessions': 'shared-repo/bots/miniapp/sessions.json',
    'live':     'shared-repo/bots/miniapp/live.json',
    'tree':     'shared-repo/bots/miniapp/tree.json',
    'prompts':  'shared-repo/bots/miniapp/prompts.json',
    'atlas':    'shared-repo/bots/miniapp/atlas.json',
    'views':    'shared-repo/bots/miniapp/views.json',
    'replies':  'shared-repo/bots/miniapp/replies.json',
    'questions':'shared-repo/bots/miniapp/questions.json',
}
# TTL из index.html (значения там в мс) переведены в секунды, чтобы
# сравнивать напрямую с age_sec.
TTL = {'status': 15, 'sessions': 30, 'replies': 15, 'prompts': 300,
       'questions': 30, 'live': 180, 'atlas': 180, 'tree': 60,
       'views': 300, 'api': 15, 'git': 3600}

GROUPS = [
    ('header',    'header',   'Шапка: агенты, воркеры, сессии, свежесть статуса'),
    ('prompts',   'prompts',  'Промпты: счётчик, темы, возраст чекпоинта'),
    ('tree',      'tree',     'Дерево задач: корни, статусы, свежесть файла'),
    ('live',      'live',     'Живые работы: задачи, active, очереди ноут/ПК'),
    ('sessions',  'sessions', 'Сессии: опубликованные и живые через API'),
    ('atlas',     'atlas',    'Атлас: узлы, связи, типы, возраст графа'),
    ('studio',    'studio',   'Студия: виды views.json и их реальные источники'),
    ('questions', 'questions','Вопросы: счётчик и свежесть'),
    ('chat',      'chat',     'Чат: ответы из replies.json'),
]


def iso(ts):
    """Epoch -> ISO MSK. None остаётся None (не выдумываем время)."""
    if ts is None:
        return None
    return datetime.datetime.fromtimestamp(ts, MSK).isoformat()


def sh(argv, timeout=12):
    """Безопасный subprocess: (stdout|None, error|None). Никогда не бросает."""
    try:
        p = subprocess.run(argv, capture_output=True, text=True,
                           timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError) as e:
        return None, f'{type(e).__name__}: {e}'
    if p.returncode != 0:
        return None, f'rc={p.returncode}: {(p.stderr or p.stdout or "").strip()[:200]}'
    return p.stdout, None


def load_json(key):
    """Читает источник. Возвращает (data|None, meta). Меняет только чтением."""
    path = ROOT / FILES[key]
    meta = {'key': key, 'path': str(path), 'exists': path.is_file(),
            'mtime': None, 'mtime_iso': None, 'error': None}
    if not meta['exists']:
        meta['error'] = 'файл источника отсутствует'
        return None, meta
    try:
        meta['mtime'] = path.stat().st_mtime
        meta['mtime_iso'] = iso(meta['mtime'])
        with path.open('r', encoding='utf-8') as f:
            return json.load(f), meta
    except (OSError, ValueError) as e:
        meta['error'] = f'{type(e).__name__}: {e}'
        return None, meta


def probe_runs():
    """Живые процессы `opencode run`. Зонд из ТЗ: pgrep -fc '[o]pencode run'."""
    out, err = sh(['pgrep', '-fc', '[o]pencode run'], timeout=6)
    if err or out is None:
        return None, {'command': "pgrep -fc '[o]pencode run'", 'error': err}
    try:
        return int(out.strip().splitlines()[-1]), {'command': "pgrep -fc '[o]pencode run'", 'error': None}
    except (ValueError, IndexError):
        return None, {'command': "pgrep -fc '[o]pencode run'", 'error': f'не удалось разобрать вывод: {out[:120]!r}'}


def probe_workers():
    """Активные systemd-воркеры (cloud/open/backlog) из list-units."""
    out, err = sh(['systemctl', '--user', 'list-units', '--type=service',
                   '--state=running', '--no-legend'], timeout=10)
    if err or out is None:
        return None, {'command': 'systemctl --user list-units --type=service --state=running --no-legend', 'error': err}
    units = [ln.split()[0] for ln in out.splitlines() if ln.strip()]
    workers = [u for u in units
               if re.search(r'(open|cloud|backlog|worker)', u, re.I)
               and u not in ('gcr-ssh-agent.service',)]
    return {'count': len(workers), 'units': workers,
            'all_running': len(units)}, {'command': 'systemctl --user list-units --type=service --state=running --no-legend', 'error': None}


def probe_api(path, timeout=15):
    """`opencode api get <path>` -> (data|None, meta)."""
    if not OPENCODE.is_file():
        return None, {'command': f'opencode api get {path}', 'error': f'бинарник отсутствует: {OPENCODE}'}
    out, err = sh([str(OPENCODE), 'api', 'get', path], timeout=timeout)
    meta = {'command': f'opencode api get {path}', 'error': err}
    if err or out is None:
        return None, meta
    try:
        return json.loads(out), meta
    except ValueError as e:
        meta['error'] = f'JSON: {e}'
        return None, meta


def probe_active_sessions():
    """Живые сессии прямо сейчас: /api/session/active."""
    data, meta = probe_api('/api/session/active')
    if data is None:
        return None, meta
    rows = data.get('data', data) if isinstance(data, dict) else data
    if isinstance(rows, dict):
        n = len(rows)
        running = sum(1 for v in rows.values()
                      if isinstance(v, dict) and v.get('type') == 'running')
    elif isinstance(rows, list):
        n = len(rows)
        running = sum(1 for v in rows
                      if isinstance(v, dict) and v.get('type') == 'running')
    else:
        meta['error'] = 'неожиданная форма ответа API'
        return None, meta
    return {'count': n, 'running': running}, meta


def probe_sessions_window():
    """Сессии за 24 ч и сабагенты: /api/session?limit=200."""
    data, meta = probe_api('/api/session?limit=200')
    if data is None:
        return None, meta
    rows = data.get('data', data) if isinstance(data, dict) else data
    if not isinstance(rows, list):
        meta['error'] = 'неожиданная форма ответа API'
        return None, meta
    now_ms = time.time() * 1000
    live, subs = [], 0
    for s in rows:
        if not isinstance(s, dict) or s.get('archived') or (s.get('time') or {}).get('archived'):
            continue
        try:
            updated = int((s.get('time') or {}).get('updated') or 0)
        except (TypeError, ValueError):
            continue
        if updated and now_ms - updated <= 86_400_000:
            live.append(s)
            if s.get('parentID'):
                subs += 1
    return {'rows': len(rows), 'live_24h': len(live), 'subagents': subs,
            'capped': len(rows) >= 200}, meta


def probe_prompt_history(current_count):
    """Реальная пара 204 -> 409 из git-истории опубликованного prompts.json.

    Не хардкодим 204/409: ищем коммит, который ВВЁЛ текущее число, и читаем
    предыдущую версию файла. Нет git/репозитория/коммита -> None + причина.
    """
    git = shutil.which('git')
    if not git or not (PAGES / '.git').exists():
        return None, {'error': 'git или репозиторий страниц недоступны',
                      'path': str(PAGES)}
    if current_count is None:
        return None, {'error': 'нет текущего счётчика prompts.json'}
    needle = f'"count": {current_count}'
    out, err = sh([git, '-C', str(PAGES), 'log', '--all', '-S', needle,
                   '--format=%H', '--', 'prompts.json'], timeout=12)
    if err or not out:
        return None, {'error': err or 'коммит с изменением счётчика не найден'}
    commit = out.strip().splitlines()[0]
    old_raw, e1 = sh([git, '-C', str(PAGES), 'show', f'{commit}^:prompts.json'], timeout=12)
    new_raw, e2 = sh([git, '-C', str(PAGES), 'show', f'{commit}:prompts.json'], timeout=12)
    if e1 or e2:
        return None, {'error': f'git show: {e1 or e2}', 'commit': commit[:8]}
    try:
        old = json.loads(old_raw)['meta']['count']
        new = json.loads(new_raw)['meta']['count']
    except (ValueError, KeyError, TypeError) as e:
        return None, {'error': f'разбор версий: {e}', 'commit': commit[:8]}
    return {'old': old, 'new': new, 'commit': commit[:8],
            'command': 'git log -S + git show (read-only)'}, {'error': None}


def count_view(view):
    """Пересчёт реального числа строк для вида из views.json. Только чтение.

    У multi-source файлов (atlas.json, prompts.json) нельзя просто взять
    «первый массив» — это даёт ложное совпадение/расхождение. Правило
    пересчёта привязано к id вида из той же спецификации; нет правила —
    возвращаем None (missing), а не выдумываем число.
    """
    src = str(view.get('source') or '')
    vid = str(view.get('id') or '')
    if not src:
        return None, 'нет source в спецификации вида'
    if '*' in src:
        pattern = src[2:] if src.startswith('~/') else src
        p = pathlib.Path.home() / pattern if src.startswith('~/') else pathlib.Path(pattern)
        items = sorted(globmod.glob(str(p)))  # '*' может быть в любой части пути
        return len(items), f'glob {src}'
    p = (pathlib.Path.home() / src[2:] if src.startswith('~/')
         else pathlib.Path(src) if src.startswith('/') else ROOT / src)
    if not p.is_file():
        return None, f'источник вида отсутствует: {p}'
    try:
        if p.suffix == '.json':
            d = json.loads(p.read_text(encoding='utf-8'))
            if vid == 'atlas-tree' and isinstance(d.get('nodes'), list):
                return len(d['nodes']), f'len(nodes) {src}'
            if vid == 'atlas-grids' and isinstance(d.get('grids'), list):
                return len(d['grids']), f'len(grids) {src}'
            if vid == 'atlas-goals' and isinstance(d.get('nodes'), list):
                return sum(1 for n in d['nodes'] if n.get('kind') == 'goal'), f'kind=goal in nodes {src}'
            if vid == 'prompts-cards' and isinstance(d.get('groups'), list):
                return sum(len(g.get('prompts') or []) for g in d['groups']), f'sum(groups[].prompts) {src}'
            if vid == 'cs2-ideas' and isinstance(d, dict):
                if isinstance(d.get('total'), int):
                    return d['total'], f'total {src}'
                themes = d.get('themes') or {}
                return sum(len(v) for v in themes.values() if isinstance(v, list)), f'sum(themes[]) {src}'
            if isinstance(d, list):
                return len(d), f'len(array) {src}'
            return None, f'нет правила пересчёта для вида {vid}'
        if vid == 'confidential-review':
            text = p.read_text(encoding='utf-8', errors='replace')
            pat = re.compile(r'^\*\*\d+\s*·\s*(PERSONAL|SENSITIVE|UNCERTAIN|PUBLIC)(?=[,\*])', re.M)
            return len(pat.findall(text)), f'записи PERSONAL/SENSITIVE/UNCERTAIN/PUBLIC {src}'
        return None, f'нет правила пересчёта для вида {vid}'
    except (OSError, ValueError) as e:
        return None, f'{type(e).__name__}: {e}'


class Table:
    """Плоская таблица строк + описания подтаблиц по группам."""

    def __init__(self, now):
        self.now = now
        self.items = []
        self.sources_meta = {}

    def add(self, rid, group, label, source, field, displayed, actual,
            as_of_ts=None, ttl=None, status=None, mode='compare',
            reason=None, evidence=None, method='file', note=None):
        """Добавляет строку. Статус вычисляется, если не задан явно.

        mode='compare'  — сравниваем displayed и actual, плюс возраст;
        mode='freshness' — статус определяется ТОЛЬКО возрастом (для строк
                           вида «возраст status.json», где displayed — метка
                           времени, а не число для сравнения);
        mode='info'      — констатация факта без сравнения (нет эталона).
        """
        if status is None:
            if actual is None:
                status = 'missing'
            elif mode == 'freshness':
                if as_of_ts is None:
                    status = 'missing'
                elif ttl and (self.now - as_of_ts) > ttl:
                    status = 'stale'
                else:
                    status = 'ok'
            elif mode == 'info':
                status = 'ok'
            elif ttl and as_of_ts is not None and (self.now - as_of_ts) > ttl:
                status = 'stale'
            elif displayed != actual:
                status = 'mismatch'
            else:
                status = 'ok'
        age = max(0, int(self.now - as_of_ts)) if as_of_ts is not None else None
        provenance = {
            'label': source,
            'method': method,
            'path': source,
            'field': field,
            'as_of': iso(as_of_ts),
            'as_of_ts': as_of_ts,
            'ttl_sec': ttl,
            'ttl_ms': ttl * 1000 if ttl is not None else None,
            'evidence': evidence,
            'reason': reason,
            'note': note,
        }
        # Первые 8 ключей — ровно те поля, которые views.js renderTable
        # показывает по умолчанию (columnsOf берёт первые 8 ключей строк).
        row = {
            'id': rid,
            'label': label,
            'source': source,
            'status': status,
            'displayed': displayed,
            'actual': actual,
            'age_sec': age,
            'group': group,
            'screen': group if group != 'header' else 'header',
            'field': field,
            'as_of': iso(as_of_ts),
            'as_of_ts': as_of_ts,
            'ttl': ttl,
            'provenance': provenance,
        }
        if reason is not None:
            row['reason'] = reason
        self.items.append(row)
        return row


def file_stamp(meta, data=None):
    """Возраст источника: явный ts из payload, иначе mtime файла."""
    if isinstance(data, dict):
        for k in ('fetched_at', 'as_of', 'ts', 'generated_epoch', 'built_at'):
            v = data.get(k)
            if isinstance(v, (int, float)) and v > 1_000_000_000:
                return float(v), f'payload.{k}'
        for k in ('as_of', 'generated', 'updatedAt', 'built_at', 'ts_human'):
            v = data.get(k)
            if isinstance(v, str):
                try:
                    ms = datetime.datetime.fromisoformat(v).timestamp()
                    return ms, f'payload.{k}'
                except ValueError:
                    pass
    return meta.get('mtime'), 'mtime файла'


def build(now):
    T = Table(now)
    raw = {}
    metas = {}
    for key in FILES:
        raw[key], metas[key] = load_json(key)
        T.sources_meta[key] = metas[key]

    probes = {}
    probes['runs'] = probe_runs()
    probes['workers'] = probe_workers()
    probes['active'] = probe_active_sessions()
    probes['window'] = probe_sessions_window()

    runs, runs_meta = probes['runs']
    workers_probe, workers_meta = probes['workers']
    active, active_meta = probes['active']
    window, window_meta = probes['window']
    workers = workers_probe['count'] if workers_probe else None

    st = raw['status'] or {}
    ss = raw['sessions'] or {}
    lv = raw['live'] or {}
    pr = raw['prompts'] or {}
    at = raw['atlas'] or {}
    vw = raw['views'] or {}
    qs = raw['questions'] or {}
    tree = raw['tree'] if isinstance(raw['tree'], list) else None

    st_ts, st_origin = file_stamp(metas['status'], raw['status'])
    ss_ts, ss_origin = file_stamp(metas['sessions'], raw['sessions'])
    lv_ts, lv_origin = file_stamp(metas['live'], raw['live'])
    pr_ts, pr_origin = file_stamp(metas['prompts'], raw['prompts'])
    at_ts, at_origin = file_stamp(metas['atlas'], raw['atlas'])
    vw_ts, vw_origin = file_stamp(metas['views'], raw['views'])
    qs_ts, qs_origin = file_stamp(metas['questions'], raw['questions'])
    tr_ts, tr_origin = metas['tree'].get('mtime'), 'mtime файла'

    src_status = FILES['status']
    src_sessions = FILES['sessions']
    src_live = FILES['live']
    src_tree = FILES['tree']
    src_prompts = FILES['prompts']
    src_atlas = FILES['atlas']
    src_views = FILES['views']
    src_replies = FILES['replies']
    src_questions = FILES['questions']

    # ---------- header: самое позорное ------------------------------------
    # agents=1 против реальных opencode run и живых сессий.
    T.add('header.agents', 'header', 'Агенты в шапке (🤖 N агентов)',
          src_status, 'agents', st.get('agents'),
          max(x for x in (runs, workers) if x is not None) if (runs is not None or workers is not None) else None,
          st_ts, TTL['status'],
          status=None, method='pgrep + systemctl',
          evidence={'status.agents': st.get('agents'),
                    'status.agents_running': st.get('agents_running'),
                    'pgrep_runs': runs, 'systemd_workers': workers},
          note='agents по метрике status.json = max(живые run, воркеры); '
               'реальный max из зондов не совпадает')
    T.add('header.agents_running', 'header', 'В работе (processes opencode run)',
          src_status, 'agents_running', st.get('agents_running'), runs,
          st_ts, TTL['status'], method="pgrep -fc '[o]pencode run'",
          evidence={'pgrep_runs': runs, 'probe': runs_meta})
    T.add('header.agents_live', 'header', 'Мгновенные агенты (agents_live)',
          src_status, 'agents_live', st.get('agents_live'), runs,
          st_ts, TTL['status'], method="pgrep -fc '[o]pencode run'",
          evidence={'pgrep_runs': runs})
    T.add('header.workers', 'header', 'systemd-воркеры',
          src_status, 'workers', st.get('workers'), workers,
          st_ts, TTL['status'], method='systemctl --user list-units',
          evidence={'probe': workers_probe, 'probe_meta': workers_meta},
          reason=None if workers is not None else (workers_meta or {}).get('error'))
    T.add('header.sessions_active', 'header', 'Активные сессии за 24 ч (status.json)',
          src_status, 'sessions_active', st.get('sessions_active'),
          window['live_24h'] if window else None,
          st_ts, TTL['status'], method='opencode api /api/session?limit=200',
          evidence={'window': window, 'probe_meta': window_meta},
          note='API отдаёт не более 200 строк — actual может быть усечён снизу')
    T.add('header.sessions_now', 'header', 'Живые сессии сейчас (/api/session/active)',
          src_status, 'sessions_active', st.get('sessions_active'),
          active['count'] if active else None,
          now, TTL['api'], method='opencode api /api/session/active',
          evidence={'active': active, 'probe_meta': active_meta},
          note='разные определения: 24 ч (status.json) против прямо сейчас (API)')
    T.add('header.agents_vs_api', 'header', 'Агенты в шапке против живых сессий API',
          src_status, 'agents / /api/session/active', st.get('agents'),
          active['running'] if active else None,
          now, TTL['api'], method='opencode api /api/session/active',
          evidence={'active': active, 'pgrep_runs': runs, 'workers': workers},
          note='шапка считает агентов как max(run, воркеры), но в API прямо сейчас '
               'больше работающих сессий — главное расхождение витрины с реальностью')
    T.add('header.subagents', 'header', 'Сабагенты (дочерние сессии)',
          src_status, 'subagents', st.get('subagents'),
          window['subagents'] if window else None,
          st_ts, TTL['status'], method='opencode api /api/session?limit=200 (parentID)',
          evidence={'window': window})
    T.add('header.game_mode', 'header', 'Режим игры (badge)',
          src_status, 'game_mode', st.get('game_mode'), None,
          st_ts, TTL['status'], mode='info',
          method='net source: game-mode.json не входит в контракт зондов',
          reason='нет разрешённого зонда для game_mode — actual не выдумываем')
    T.add('header.status_age', 'header', 'Возраст status.json',
          src_status, 'ts', st.get('ts_human'), st.get('ts'),
          st_ts, TTL['status'], mode='freshness', method='payload.ts / mtime',
          evidence={'ts': st.get('ts'), 'ts_human': st.get('ts_human'),
                    'origin': st_origin, 'now': now},
          note='возраст считается от ts внутри status.json, а не от времени приёма')

    # ---------- prompts: 204 -> 409 ---------------------------------------
    meta_p = pr.get('meta') or {}
    groups_p = pr.get('groups') or []
    pcount = meta_p.get('count')
    hist, hist_meta = probe_prompt_history(pcount)
    T.add('prompts.count', 'prompts', 'Число промптов (счётчик на экране)',
          src_prompts, 'meta.count',
          hist['old'] if hist else None, pcount,
          pr_ts, TTL['prompts'],
          method='git-история опубликованного prompts.json (+ current file)',
          evidence={'history': hist, 'history_meta': hist_meta,
                    'meta.count': pcount},
          reason=None if hist else hist_meta.get('error'),
          note='опубликованное значение до обновления чекпоинта против текущего файла')
    T.add('prompts.count_consistency', 'prompts', 'meta.count ↔ сумма по темам',
          src_prompts, 'meta.count / sum(groups[].prompts)', pcount,
          sum(len(g.get('prompts') or []) for g in groups_p),
          pr_ts, TTL['prompts'], method='пересчёт групп в файле')
    T.add('prompts.groups', 'prompts', 'Число тем',
          src_prompts, 'meta.groups', meta_p.get('groups'), len(groups_p),
          pr_ts, TTL['prompts'], method='пересчёт groups в файле')
    T.add('prompts.freshness', 'prompts', 'Свежесть чекпоинта промптов',
          src_prompts, 'meta.generated', meta_p.get('generated'), pr_ts,
          pr_ts, TTL['prompts'], mode='freshness', method=pr_origin,
          evidence={'generated': meta_p.get('generated'),
                    'as_of': meta_p.get('as_of'), 'origin': pr_origin})
    T.add('prompts.sources_skipped', 'prompts', 'Источники, пропущенные генератором',
          src_prompts, 'meta.sources_skipped',
          len(meta_p.get('sources_skipped') or []),
          len(meta_p.get('sources_skipped') or []),
          pr_ts, TTL['prompts'], mode='info',
          note='список пропущенных источников (например pc_user_msgs.json) — не выдумываем содержимое')

    # ---------- tree -------------------------------------------------------
    def tree_walk(nodes):
        total = 0
        for node in nodes or []:
            total += 1
            total += tree_walk(node.get('children'))
        return total

    if tree is not None:
        tc = collections.Counter(x.get('status') for x in tree)
        T.add('tree.roots', 'tree', 'Корневые задачи дерева',
              src_tree, 'length', len(tree), len(tree), tr_ts, TTL['tree'],
              method='пересчёт элементов списка')
        T.add('tree.nodes_all', 'tree', 'Все узлы дерева (включая children)',
              src_tree, 'recursive count', len(tree), tree_walk(tree),
              tr_ts, TTL['tree'], mode='info', method='рекурсивный пересчёт',
              note='UI показывает корни; вложенные узлы считаем отдельно')
        for st_name in ('PASS', 'FAIL', 'OPEN'):
            T.add(f'tree.status_{st_name.lower()}', 'tree', f'Задачи со статусом {st_name}',
                  src_tree, f'status={st_name}', tc.get(st_name, 0), tc.get(st_name, 0),
                  tr_ts, TTL['tree'], mode='info', method='пересчёт статусов')
        T.add('tree.freshness', 'tree', 'Свежесть tree.json',
              src_tree, 'mtime', tr_origin, tr_ts, tr_ts, TTL['tree'],
              mode='freshness', method=tr_origin)

    # ---------- live -------------------------------------------------------
    tasks = lv.get('tasks') or []
    tstat = collections.Counter(t.get('status') for t in tasks)
    queues = lv.get('queues') or {}
    T.add('live.tasks_total', 'live', 'Все задачи в live.json',
          src_live, 'tasks.length', len(tasks), len(tasks), lv_ts, TTL['live'],
          method='пересчёт tasks')
    for st_name in ('done', 'running', 'blocked', 'fail'):
        key = f'live.tasks_{st_name}'
        T.add(key, 'live', f'Задачи live: {st_name}',
              src_live, f'tasks[status={st_name}]', tstat.get(st_name, 0),
              tstat.get(st_name, 0), lv_ts, TTL['live'], mode='info',
              method='пересчёт статусов tasks')
    T.add('live.active', 'live', 'Занятые задачи (active)',
          src_live, 'active.length', len(lv.get('active') or []),
          len(lv.get('active') or []), lv_ts, TTL['live'], mode='info',
          method='пересчёт active')
    for side in ('ноут', 'ПК'):
        q = queues.get(side) or {}
        for st_name in ('todo', 'doing', 'done', 'failed'):
            val = q.get(st_name)
            T.add(f'live.queue_{"notebook" if side == "ноут" else "pc"}_{st_name}',
                  'live', f'Очередь {side}: {st_name}',
                  src_live, f'queues.{side}.{st_name}', val, val,
                  lv_ts, TTL['live'], mode='info', method='read queue counter',
                  reason=None if val is not None else f'поле queues.{side}.{st_name} отсутствует в live.json')
    T.add('live.freshness', 'live', 'Свежесть live.json',
          src_live, 'fetched_at', lv.get('fetched_human'), lv_ts, lv_ts,
          TTL['live'], mode='freshness', method=lv_origin)

    # ---------- sessions ---------------------------------------------------
    sess = ss.get('sessions') or []
    T.add('sessions.shown', 'sessions', 'Опубликовано сессий',
          src_sessions, 'count', ss.get('count'), len(sess), ss_ts, TTL['sessions'],
          method='пересчёт sessions[]')
    T.add('sessions.total_active', 'sessions', 'Всего активных сессий',
          src_sessions, 'total_active', ss.get('total_active'),
          window['live_24h'] if window else None, ss_ts, TTL['sessions'],
          method='opencode api /api/session?limit=200',
          evidence={'window': window},
          note='API усечён limit=200; сравнение показывает порядок величины')
    T.add('sessions.subagents', 'sessions', 'Все сабагенты (сверка с API)',
          src_sessions, 'subagents', ss.get('subagents'),
          window['subagents'] if window else None,
          ss_ts, TTL['sessions'], method='opencode api /api/session?limit=200 (parentID)',
          evidence={'window': window})
    T.add('sessions.subagents_published', 'sessions', 'Сабагенты в опубликованной выборке',
          src_sessions, 'sessions[].subagent', ss.get('subagents'),
          sum(1 for s in sess if s.get('subagent')) if sess else None,
          ss_ts, TTL['sessions'], mode='info', method='пересчёт флагов в sessions[]',
          note=f'опубликовано {len(sess)} из {ss.get("total_active")} сессий — '
               'это подвыборка, напрямую с общим числом не сравнивать')
    T.add('sessions.freshness', 'sessions', 'Свежесть sessions.json',
          src_sessions, 'fetched_at', ss.get('fetched_human'), ss_ts, ss_ts,
          TTL['sessions'], mode='freshness', method=ss_origin)

    # ---------- atlas ------------------------------------------------------
    counts_a = at.get('counts') or {}
    nodes_a = at.get('nodes') or []
    edges_a = at.get('edges') or []
    T.add('atlas.nodes', 'atlas', 'Узлы атласа',
          src_atlas, 'counts.nodes', counts_a.get('nodes'), len(nodes_a),
          at_ts, TTL['atlas'], method='пересчёт nodes[]')
    T.add('atlas.edges', 'atlas', 'Связи атласа',
          src_atlas, 'counts.edges', counts_a.get('edges'), len(edges_a),
          at_ts, TTL['atlas'], method='пересчёт edges[]')
    by_kind = collections.Counter(n.get('kind') for n in nodes_a)
    for kind, declared in (counts_a.get('by_kind') or {}).items():
        T.add(f'atlas.kind_{kind}', 'atlas', f'Узлы типа {kind}',
              src_atlas, f'counts.by_kind.{kind}', declared, by_kind.get(kind, 0),
              at_ts, TTL['atlas'], method='пересчёт kind в nodes[]')
    T.add('atlas.freshness', 'atlas', 'Возраст графа атласа',
          src_atlas, 'updatedAt', at.get('updatedAt'), at_ts, at_ts,
          TTL['atlas'], mode='freshness', method=at_origin)

    # ---------- studio: виды и их реальные источники -----------------------
    views = vw.get('views') or []
    T.add('studio.views', 'studio', 'Число видов в views.json',
          src_views, 'views.length', len(views), len(views), vw_ts, TTL['views'],
          mode='info', method='пересчёт views[]')
    for v in views:
        vid = v.get('id') or '?'
        real, how = count_view(v)
        T.add(f'studio.view_{vid}_count', 'studio', f'Вид {vid}: строк',
              str(v.get('source') or '—'), 'count', v.get('count'), real,
              vw_ts, TTL['views'], method=f'пересчёт источника: {how}',
              evidence={'view': vid, 'view_type': v.get('type'),
                        'source': v.get('source')},
              reason=None if real is not None else how,
              note='счётчик в views.json против реального числа строк источника')
    T.add('studio.freshness', 'studio', 'Свежесть views.json',
          src_views, 'built_at', vw.get('built_at'), vw_ts, vw_ts,
          TTL['views'], mode='freshness', method=vw_origin)

    # ---------- questions --------------------------------------------------
    T.add('questions.count', 'questions', 'Вопросы, ожидающие ответа',
          src_questions, 'count', qs.get('count'),
          len(qs.get('questions') or []) if raw['questions'] is not None else None,
          qs_ts, TTL['questions'], method='пересчёт questions[]',
          reason=None if raw['questions'] is not None else metas['questions']['error'])
    T.add('questions.freshness', 'questions', 'Свежесть questions.json',
          src_questions, 'mtime', qs_origin, qs_ts, qs_ts, TTL['questions'],
          mode='freshness', method=qs_origin)

    # ---------- chat: replies.json отсутствует -----------------------------
    T.add('chat.replies', 'chat', 'Ответы в чате (replies.json)',
          src_replies, 'лента ответов', None, None, None, TTL['replies'],
          status='missing', method='чтение replies.json',
          evidence={'meta': metas['replies']},
          reason=metas['replies']['error'] or 'источник ответов недоступен',
          note='счётчик ответов не показываем — данные не выдумываем')

    gmap = {gid: {'id': gid, 'title': screen, 'screen': screen,
                  'description': desc, 'rows': []}
            for gid, screen, desc in GROUPS}
    for row in T.items:
        if row['group'] in gmap:
            gmap[row['group']]['rows'].append(row)

    subtables = []
    for gid, g in gmap.items():
        sub = {
            'id': gid,
            'group': gid,
            'parent': None,
            'parent_group': gid,
            'title': g['title'],
            'screen': g['screen'],
            'description': g['description'],
            'row_filter': {'field': 'group', 'value': gid},
            'row_count': len(g['rows']),
            'columns': ['label', 'displayed', 'actual', 'status',
                        'age_sec', 'source'],
            'rows': g['rows'],
        }
        subtables.append(sub)
        g['subtable_ids'] = [gid]

    by_status = collections.Counter(r['status'] for r in T.items)
    by_group = {gid: {'total': len(g['rows']),
                      'by_status': dict(collections.Counter(r['status'] for r in g['rows']))}
                for gid, g in gmap.items()}

    # Топ расхождений: сначала три позорных из ТЗ в фиксированном порядке,
    # затем остальные по убыванию относительной дельты.
    by_id = {r['id']: r for r in T.items}
    priority = ['header.agents_vs_api', 'prompts.count', 'header.status_age',
                'header.agents_running', 'header.sessions_active']

    def delta(r):
        d, a = r.get('displayed'), r.get('actual')
        if isinstance(d, (int, float)) and isinstance(a, (int, float)) and d:
            return a - d
        if isinstance(d, (int, float)) and isinstance(a, (int, float)):
            return a - d
        return None

    def rel(r):
        d, a = r.get('displayed'), r.get('actual')
        if isinstance(d, (int, float)) and isinstance(a, (int, float)) and d:
            return round((a - d) / abs(d) * 100, 1)
        return None

    picked = []
    for rid in priority:
        r = by_id.get(rid)
        if r is None or r['status'] == 'ok':
            continue
        # «старый» agents с нулевой дельтой — не расхождение, а только
        # устаревшая шапка; в топ берём, только если есть реальная разница
        # или это специальная строка про возраст status.json.
        if rid != 'header.status_age' and delta(r) in (0, None) and r['status'] != 'missing':
            continue
        if r not in picked:
            picked.append(r)
    rest = [r for r in T.items
            if r['status'] != 'ok' and r not in picked
            and (r['status'] == 'missing' or delta(r) not in (0, None))]
    rest.sort(key=lambda r: (r['status'] == 'mismatch',
                             abs(rel(r) or 0), abs(delta(r) or 0),
                             r['age_sec'] or 0), reverse=True)
    top = []
    for r in picked + rest:
        if len(top) >= 5:
            break
        top.append({
            'rank': len(top) + 1,
            'id': r['id'],
            'label': r['label'],
            'status': r['status'],
            'displayed': r.get('displayed'),
            'actual': r.get('actual'),
            'delta': delta(r),
            'delta_pct': rel(r),
            'age_sec': r.get('age_sec'),
            'reason': r.get('reason'),
            'source': r['source'],
            'note': r['provenance'].get('note'),
        })

    return {
        'version': 1,
        'built_at': iso(now),
        'built_at_ts': now,
        'title': 'Единая таблица обновляемых элементов мини-апа',
        'description': ('displayed — что показывает мини-ап по опубликованным '
                        'JSON; actual — живой зонд или пересчёт реального '
                        'источника. Нет источника -> null/missing.'),
        'items': T.items,
        'groups': [{k: v for k, v in g.items()} for g in gmap.values()],
        'subtables': subtables,
        'summary': {
            'total': len(T.items),
            'by_status': dict(by_status),
            'by_group': by_group,
            'top_discrepancies': top,
            'mismatch': by_status.get('mismatch', 0),
            'stale': by_status.get('stale', 0),
            'missing': by_status.get('missing', 0),
            'ok': by_status.get('ok', 0),
        },
        'provenance': {
            'generator': 'shared-repo/bots/miniapp/build_elements.py',
            'read_only_sources': T.sources_meta,
            'probes': {
                'runs': runs_meta,
                'workers': workers_meta,
                'active_sessions': active_meta,
                'sessions_window': window_meta,
                'prompt_history': hist_meta,
            },
            'ttl_sec_from_index_html': TTL,
            'note': 'Все значения прочитаны из реальных файлов/зондов; '
                    'недоступные источники помечены missing без подмены.',
        },
    }


def main():
    now = time.time()
    doc = build(now)
    text = json.dumps(doc, ensure_ascii=False, indent=2) + '\n'
    TMP.write_text(text, encoding='utf-8')
    os.replace(str(TMP), str(OUT))  # атомарная замена
    s = doc['summary']
    print(f"элементов: {s['total']} · ok={s['ok']} mismatch={s['mismatch']} "
          f"stale={s['stale']} missing={s['missing']}")
    print('топ-5 расхождений:')
    for x in s['top_discrepancies']:
        d = x['delta']
        pct = x['delta_pct']
        if x['status'] == 'missing':
            change = f"источник недоступен · {x['reason'] or 'причина не указана'}"
        elif d is None:
            change = (f"{x['displayed']} → {x['actual']} · "
                      f"возраст {x['age_sec']} c против TTL источника")
        else:
            change = (f"{x['displayed']} → {x['actual']} "
                      f"({'+' if d >= 0 else ''}{d}"
                      + (f", {'+' if pct >= 0 else ''}{pct}%" if pct is not None else '')
                      + ')')
        print(f" {x['rank']}. {x['id']}: {change} [{x['status']}]")
        if x.get('note'):
            print(f"    {x['note']}")
    print(f"файл: {OUT}")


if __name__ == '__main__':
    try:
        main()
    except Exception as e:  #pragma: no cover — диагностика, без тихой подмены данных
        print(f'build_elements: ОШИБКА {type(e).__name__}: {e}', file=sys.stderr)
        raise
