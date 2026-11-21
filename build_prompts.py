#!/usr/bin/env python3
"""Генератор prompts.json для мини-апа — «человеческая сортировка» промптов.

Собирает реальные пользовательские промпты из трёх источников:
  * inbox.log              — сырые сообщения Telegram с датами (главный источник)
  * session_user_msgs.json — первые сообщения сессий OpenCode
  * wants.json             — хотелки (становятся связями и коротким ответом)
  * pc_user_msgs.json      — те же сессии, но с Windows-ПК (нет файла — пропуск)

НЕ changing исходные файлы — только читает. Пишет prompts.json рядом с index.html.

Запуск: python3 ~/shared-repo/bots/miniapp/build_prompts.py
"""
import json, os, re, sys, datetime, pathlib, html

ROOT = pathlib.Path('/home/nyaka')
OUT = pathlib.Path(__file__).resolve().parent / 'prompts.json'
INBOX = ROOT / 'shared-repo/bots/inbox.log'
SESSIONS = ROOT / 'runtime/tmp-checkpoint/session_user_msgs.json'
WANTS = ROOT / '.config/opencode/wants.json'
YEAR = 2026
# inbox.log и сессии пишут локальное время ноута (MSK), а не UTC. Раньше метки
# разбирались как UTC — все запросы в мини-апе показывались на 3 часа вперёд и
# попадали не в тот день. Парсим именно как +0300.
MSK = datetime.timezone(datetime.timedelta(hours=3))

# --- контракт данных: кто / откуда / когда ------------------------------------
# Единственное место, где меняется соответствие логин -> имя. По логам
# (inbox.log) 1869196044 подписывается «Аскольд» и говорит про Ивана в третьем
# лице; 1869196044 же — chat_id владельца бота. Это гипотеза с доказательствами,
# поэтому словарь, а не хардкод: поменять местами — одна строка.
USERS = {'1869196044': 'Аскольд', '435824119': 'Иван'}
OWNER_UID = '1869196044'          # config.json: chat_id владельца бота
SOURCE_LABEL = {'telegram': 'ТГ бот', 'session': 'ноут', 'pc': 'ПК'}
PC_MSGS = ROOT / 'runtime/tmp-checkpoint/pc_user_msgs.json'
STALE_DAYS = 1                    # старше суток -> запись честно помечается is_stale
DAY_MS = 86_400_000
SCHEMA = pathlib.Path(__file__).resolve().parent / 'prompts.schema.json'


def user_of(uid):
    """Логин -> человеческое имя; пустой логин -> пустая строка, незнакомый -> как есть."""
    uid = str(uid or '')
    return USERS.get(uid, uid)


def _resolve_ref(ref, root):
    if not ref.startswith('#/'):
        raise ValueError(f'внешний $ref не поддержан: {ref}')
    node = root
    for part in ref[2:].split('/'):
        node = node[part.replace('~1', '/').replace('~0', '~')]
    return node


def validate(node, schema, root=None, path='$'):
    """Минимальный валидатор JSON Schema 2020-12 (без внешних библиотек).

    Поддержано ровно то, что нужно контракту: $ref (#/...), type, required,
    properties, items, enum, const, minimum, additionalProperties=false.
    Возвращает список ошибок (пустой список = документ валиден).
    """
    root = schema if root is None else root
    errs = []
    if '$ref' in schema:
        return validate(node, _resolve_ref(schema['$ref'], root), root, path)
    if 'const' in schema and node != schema['const']:
        errs.append(f'{path}: ожидалось {schema["const"]!r}, получено {node!r}')
    if 'enum' in schema and node not in schema['enum']:
        errs.append(f'{path}: {node!r} не из {schema["enum"]}')
    t = schema.get('type')
    if t:
        checks = {
            'object': lambda v: isinstance(v, dict),
            'array': lambda v: isinstance(v, list),
            'string': lambda v: isinstance(v, str),
            'boolean': lambda v: isinstance(v, bool),
            'null': lambda v: v is None,
            'integer': lambda v: isinstance(v, int) and not isinstance(v, bool),
            'number': lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
        }
        types = t if isinstance(t, list) else [t]
        if not any(checks[x](node) for x in types):
            return errs + [f'{path}: тип {type(node).__name__}, ожидался {t}']
    if isinstance(node, dict):
        for k in schema.get('required', []):
            if k not in node:
                errs.append(f'{path}.{k}: обязательное поле отсутствует')
        props = schema.get('properties', {})
        for k, sub in props.items():
            if k in node:
                errs += validate(node[k], sub, root, f'{path}.{k}')
        if schema.get('additionalProperties') is False:
            for k in node:
                if k not in props:
                    errs.append(f'{path}.{k}: лишнее поле')
    if isinstance(node, list) and 'items' in schema:
        for i, v in enumerate(node):
            errs += validate(v, schema['items'], root, f'{path}[{i}]')
    if isinstance(node, (int, float)) and not isinstance(node, bool):
        if 'minimum' in schema and node < schema['minimum']:
            errs.append(f'{path}: {node} < minimum {schema["minimum"]}')
        if 'maximum' in schema and node > schema['maximum']:
            errs.append(f'{path}: {node} > maximum {schema["maximum"]}')
    return errs

# --- темы «по-человечески»: порядок = приоритет в UI ---
THEMES = [
    ("Мини-ап и Telegram", ["мини-ап", "миниап", "mini app", "webapp", "телеграм", "tg ", "тг ", "сообщени", "кнопк", "меню", "переписк", "контраст", "стил", "markdown", "форматирован"]),
    ("Голос, ASR и диктофон", ["голос", "расшифров", "asr", "whisper", "deepgram", "диктофон", "диктов", "микрофон", "речь", "озвуч", "transcri"]),
    ("Экономика и оверлей CS2", ["оверлей", "экономик", "gsi", "allplayers", "раунд", "противник", "hud", "инъекц", "кадр"]),
    ("Демки, радар и FACEIT", ["демк", "faceit", "hltv", "радар", "dust2", "дуэл", "cyan", "fps", "кадр", "scanfeed", "сканфид", "топ-1000"]),
    ("Агенты, модели и лимиты", ["агент", "модел", "лимит", " allowance", "бесплатн", "квот", "flash", "deepseek", "oglm", "kim", "minimax", "жадно", "параллел", "воркер", "шедоу"]),
    ("Прогресс, гейты и claims", ["прогресс", "claims", "гейт", "p0-", "верифик", "проверк", "отчет", "отчёт", "failed", "pass", "open", "гипотез", "h0", "black box"]),
    ("Сеть, VPN и доступ", ["vpn", "прокси", "cloudflare", "туннел", "localhost.run", "сеть", "dpi", "1300", "wireguard", "clash"]),
    ("НИР, курсовая и презентации", ["нир", "курсов", "научн", "макарук", "uml", "блок-схем", "фипс", "презентац", "слайд", "диплом"]),
    ("Память, цели и хотелки", ["память", "цель", "цели", "хотелк", "wants", "иде", "сводк", "ежедневн", "обзор", "ревизи"]),
]

STOP = {'/start', '/app', '/status', '/tasks', '/memory', '/tg', '/vpn', '/bundle', '/fix', '/invite', '/access', '/revoke'}


def parse_ts(s):
    """Локальное время MSK -> epoch ms. '2026-11-20 10:58:39 [+0300]' / '20.11 00:08'."""
    try:
        s = str(s).strip()
        if re.match(r'^\d{4}-', s):
            s = re.sub(r'\s*[+-]\d{2}:?\d{2}$', '', s)  # явный офсет из сессий
            return int(datetime.datetime.strptime(s, '%Y-%m-%d %H:%M:%S')
                       .replace(tzinfo=MSK).timestamp() * 1000)
        m = re.match(r'^(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})', s)
        if m:
            d, mo, h, mi = map(int, m.groups())
            return int(datetime.datetime(YEAR, mo, d, h, mi, tzinfo=MSK).timestamp() * 1000)
    except Exception:
        pass
    return None


def classify(text):
    t = text.lower()
    for name, kws in THEMES:
        if any(k in t for k in kws):
            return name
    return 'Разное'


def load_wants():
    out = []
    try:
        d = json.loads(WANTS.read_text(encoding='utf-8'))
        for w in d.get('items', []):
            title = w.get('title') or ''
            detail = (w.get('detail') or '')[:240]
            status = w.get('status') or ''
            result = (w.get('result') or '')[:180]
            answer = result or ({'done': 'сделано', 'doing': 'в работе', 'deferred': 'отложено', 'open': 'открыто'}.get(status, status))
            out.append({'id': w.get('id'), 'title': title, 'detail': detail,
                        'status': status, 'answer': answer, 'tags': w.get('tags') or []})
    except Exception as e:
        print('wants: WARN', e)
    return out


def load_prompts():
    items = []
    # 1) Telegram inbox — основной источник с точными датами
    pat = re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*\|\s*(\d+)\s*\|\s*(.*)$')
    try:
        for line in INBOX.read_text(encoding='utf-8').split('\n'):
            m = pat.match(line)
            if not m:
                continue
            ts, uid, text = m.group(1), m.group(2), m.group(3).strip()
            if not text or text in STOP or text.startswith('📝') or text.startswith('[память'):
                continue
            # склеиваем многострочные:
            if items and items[-1]['source'] == 'telegram' and items[-1]['_date'] == ts[:10] and \
               datetime.datetime.strptime(ts, '%Y-%m-%d %H:%M:%S') - datetime.datetime.strptime(items[-1]['_tsraw'], '%Y-%m-%d %H:%M:%S') < datetime.timedelta(seconds=90):
                items[-1]['text'] += '\n' + text
                items[-1]['_tsraw'] = ts
                items[-1]['ts'] = parse_ts(ts)
                continue
            items.append({'id': 'tg-' + ts.replace(' ', '').replace(':', '').replace('-', ''),
                          'text': text, 'ts': parse_ts(ts), 'source': 'telegram',
                          'source_label': SOURCE_LABEL['telegram'],
                          'user_id': uid, 'user': user_of(uid),
                          '_date': ts[:10], '_tsraw': ts})
    except Exception as e:
        print('inbox: WARN', e)
    # 2) сессии OpenCode
    try:
        for s in json.loads(SESSIONS.read_text(encoding='utf-8')):
            txts = s.get('user_texts') or []
            if not txts:
                continue
            items.append({'id': 'ses-' + s.get('id', '?')[-10:],
                          'text': txts[0].strip(), 'ts': parse_ts(s.get('updated', '')),
                          'source': 'session', 'title': s.get('title', ''),
                          'source_label': SOURCE_LABEL['session'],
                          'user_id': str(s.get('user_id') or OWNER_UID),
                          'user': user_of(s.get('user_id') or OWNER_UID)})
    except Exception as e:
        print('sessions: WARN', e)
    # 3) Windows-ПК — те же пользовательские сообщения, снятые на ПК. Файла может
    #    не быть (ПК выключен/чекпоинт не снят) — тогда источник тихо пропускаем.
    if PC_MSGS.exists():
        try:
            data = json.loads(PC_MSGS.read_text(encoding='utf-8'))
            rows = data.get('items', []) if isinstance(data, dict) else data
            for s in rows:
                txts = s.get('user_texts') or []
                if not txts:
                    continue
                uid = str(s.get('user_id') or OWNER_UID)
                items.append({'id': 'pc-' + str(s.get('id', '?'))[-10:],
                              'text': txts[0].strip(),
                              'ts': parse_ts(s.get('updated') or s.get('ts') or ''),
                              'source': 'pc', 'title': s.get('title', ''),
                              'source_label': SOURCE_LABEL['pc'],
                              'user_id': uid, 'user': user_of(uid)})
        except Exception as e:
            print('pc: WARN', e)
    # чистим служебные поля, сортируем
    for it in items:
        it.pop('_date', None); it.pop('_tsraw', None)
    items = [it for it in items if it['text'] and len(it['text']) > 3]
    items.sort(key=lambda x: x.get('ts') or 0, reverse=True)
    return items


def main():
    prompts = load_prompts()
    wants = load_wants()
    # grouping
    groups = {}
    for p in prompts:
        g = classify(p['text'])
        groups.setdefault(g, []).append(p)
    # links from wants: по совпадению ключевых слов заголовка с текстом промпта
    out_groups = []
    for name, items in groups.items():
        glinks = [w['id'] for w in wants if any(k.lower() in name.lower() for k in w['title'].split()[:3])][:6]
        for p in items:
            t = p['text'].lower()
            wlinks = [w['id'] for w in wants if w['title'] and any(
                word.lower() in t for word in re.findall(r'[A-Za-zА-Яа-яЁё]{5,}', w['title'])[:4])][:4]
            p['wants'] = list(dict.fromkeys(wlinks))[:4]
            # автозаполненный «ответ в пару слов» — только если есть явная связь и результат
            for w in wants:
                if w['id'] in p['wants'] and w['answer'] and w['status'] in ('done', 'pass'):
                    p.setdefault('answer', w['answer'][:90]); break
        out_groups.append({'id': 'g' + str(len(out_groups) + 1), 'name': name,
                           'wants': list(dict.fromkeys(glinks)), 'prompts': items})
    now = datetime.datetime.now(datetime.timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    # честный штамп на каждой записи: когда сказано (as_of) и устарело ли (>1 дня)
    for p in prompts:
        p['as_of'] = p.get('ts')
        p['is_stale'] = p['as_of'] is None or now_ms - p['as_of'] > STALE_DAYS * DAY_MS
    sources = ['inbox.log', 'session_user_msgs.json', 'wants.json']
    skipped = []
    if PC_MSGS.exists():
        sources.append(str(PC_MSGS.relative_to(ROOT)))
    else:
        skipped.append(str(PC_MSGS.relative_to(ROOT)))
    meta = {'generated': now.isoformat(timespec='seconds'),
            'generated_human': now.strftime('%d.%m %H:%M UTC'),
            'as_of': now_ms,
            'stale_days': STALE_DAYS,
            'count': len(prompts), 'groups': len(out_groups),
            'users': USERS,
            'source_labels': SOURCE_LABEL,
            'sources': sources, 'sources_skipped': skipped,
            'note': 'группировка по темам; связи с хотелками; ответ — из результата хотелки; '
                    'as_of/is_stale — возраст записи на момент генерации'}
    doc = {'meta': meta, 'groups': out_groups}
    # --- инварианты контракта: нарушение = файл не пишем, выход с кодом 2 ---
    total = sum(len(g['prompts']) for g in out_groups)
    ids = [p['id'] for g in out_groups for p in g['prompts']]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    problems = []
    if meta['count'] != total:
        problems.append(f'meta.count={meta["count"]} != сумма промптов в группах={total}')
    if dupes:
        problems.append('дубли id: ' + ', '.join(dupes[:5]) + (' …' if len(dupes) > 5 else ''))
    if not problems:
        try:
            problems = validate(doc, json.loads(SCHEMA.read_text(encoding='utf-8')))
        except Exception as e:
            problems = [f'схема {SCHEMA.name}: {e}']
    if problems:
        print('ОТКАЗ: prompts.json НЕ записан, контракт нарушен:', file=sys.stderr)
        for x in problems[:20]:
            print('  - ' + x, file=sys.stderr)
        return 2
    # атомарная запись: tmp в том же каталоге + os.replace
    tmp = OUT.with_name(OUT.name + '.tmp')
    mode = OUT.stat().st_mode & 0o777 if OUT.exists() else 0o664
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding='utf-8')
    os.chmod(tmp, mode)
    os.replace(tmp, OUT)
    print(f'OK -> {OUT}')
    print(f'  промптов: {len(prompts)}, тем: {len(out_groups)}, хотелок: {len(wants)}, '
          f'устаревших: {sum(1 for p in prompts if p["is_stale"])}')
    for g in out_groups:
        print(f'    {g["name"]}: {len(g["prompts"])}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
