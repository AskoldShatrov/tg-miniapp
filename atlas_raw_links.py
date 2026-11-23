#!/usr/bin/env python3
"""Сопоставить узлы атласа с сырыми голосовыми карточками (cs2_voice_ideas.json).

Для каждого узла atlas.json с текстом ищет по токенному похожести
(Jaccard ≥ 0.06, общих токенов ≥ 2) до 5 сырых карточек и пишет в узел поле

    "raw": [{"voice": "1001@18-08-2026_01-13-33.ogg",
             "themes": ["Карты и вариативность"]}, ...]

`voice` — то же имя, какое видит пользователь в таблице cs2-ideas
(без префикса voice_messages/ и audio_). Дословный текст речи НЕ пишем:
atlas.json публикуется на Pages, поэтому raw содержит только безопасные
идентификаторы. Статистика печатается в stdout.
Создаёт/перезаписывает atlas.json. Только чтение cs2_voice_ideas.json.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path.home() / "shared-repo/bots/miniapp"
ATLAS = ROOT / "atlas.json"
RAW = Path.home() / "local-llm/work/cs2_voice_ideas.json"

# Стоп-слова: предлоги/союзы/местоимения/распространённые глаголы/речевые
# маркеры — для ASR-текста («типа», «блин», «вот», «ну», «это»…) бесполезны.
STOP = set("""
авось ах блин бля блять давай дальше дать его если ей ему её ещё же затем
и или им их каждый кем кому кого когда который кто ли либо мало мало мне
много мной мог может можно мы на над надо например нах наш не него неё
некоторый нигде них но ну нужен нужно ой он она они ось остальной от
откуда откуда парень парни по почему потом потому поэтому после про
просто против после пытаться сам сама сами сделать случай смотри сначала
со собой совсем соскать спросить стоит странный там так такие такой такая
также там тебе тебя тех того только тому тот три тут тут туда ты у если
фи фу хм эй эм эх это этого этой этому эти этих этот эту эхх бы было им
иначе иногда часто часть чего чем что чтобы что именно конечно наконец
впрочем итого кстати чуть эта эты эш эха эээ мой моя моё мои моего моей
ней нему сосед слова игры играть карта карты карту считать смотреть
стиль список суть причина причины как какой какая какое каков какова
все всё всего всех всем входе войди во вой это емна
начало правило правила правила начало конец первый второй третий
человек челы чел игрок игроки команда команды
чуть чуть ещё совсем именно ну
""".split())


def tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[а-яёa-z]{3,}", (s or "").lower()) if w not in STOP}


def short_voice(v: str) -> str:
    """«voice_messages/audio_1001@18-08-2026_01-13-33.ogg» -> «1001@18-08-2026_01-13-33.ogg»."""
    return v.rsplit("/", 1)[-1].replace("audio_", "") or v


def main() -> int:
    raw_doc = json.loads(RAW.read_text(encoding="utf-8"))
    # Сырой корпус: voice -> {text, themes} (карточка может встречаться в нескольких темах).
    by_voice: dict[str, dict] = {}
    for theme, items in (raw_doc.get("themes") or {}).items():
        for it in (items or []):
            v = it.get("voice") or ""
            if not v:
                continue
            entry = by_voice.setdefault(v, {"text": "", "themes": []})
            if len(entry["text"]) < len(it.get("text") or ""):
                entry["text"] = it.get("text") or ""
            if theme not in entry["themes"]:
                entry["themes"].append(theme)
    cards = []
    for v, e in by_voice.items():
        ct = tokens(e["text"])
        if ct:
            cards.append((v, e["text"], e["themes"], ct))
    print(f"raw cards: {len(by_voice)} (themes total: {sum(len(v['themes']) for v in by_voice.values())})", file=sys.stderr)

    doc = json.loads(ATLAS.read_text(encoding="utf-8"))
    # Собрать все дикты-узлы по id (nodes[] + trees — там могут быть отдельные объекты).
    by_id: dict[str, list[dict]] = {}

    def note(n):
        if isinstance(n, dict) and n.get("id"):
            by_id.setdefault(n["id"], []).append(n)
            for c in n.get("children") or []:
                note(c)

    for n in doc.get("nodes") or []:
        note(n)
    for t in doc.get("trees") or []:
        for r in t.get("roots") or []:
            note(r)

    stats = {"nodes": len(by_id), "with_raw": 0, "refs": 0, "dist": {}, "top_scores": []}
    for nid, ds in by_id.items():
        text = " ".join(str(d.get("text") or "") + " " + str(d.get("title") or "") + " " + str(d.get("full") or "")
                        for d in ds)
        nt = tokens(text)
        if not nt:
            continue
        scored = []
        for v, ctext, themes, ct in cards:
            inter = nt & ct
            if not inter:
                continue
            jac = len(inter) / len(nt | ct)
            scored.append((jac, len(inter), v, ctext, themes))
        scored.sort(key=lambda s: (-s[0], -s[1]))
        sel = [s for s in scored if s[1] >= 2 and s[0] >= 0.06][:5]
        if not sel:
            best = scored[0] if scored else None
            if best and best[0] >= 0.03:
                stats["top_scores"].append(round(best[0], 3))
            continue
        raw = [{"voice": short_voice(v), "themes": themes} for _, _, v, ctext, themes in sel]
        for d in ds:
            d["raw"] = raw
        stats["with_raw"] += 1
        stats["refs"] += len(sel)
        stats["dist"][len(sel)] = stats["dist"].get(len(sel), 0) + 1

    print(json.dumps(stats, ensure_ascii=False, indent=2))
    ATLAS.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {ATLAS} ({ATLAS.stat().st_size} bytes)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
