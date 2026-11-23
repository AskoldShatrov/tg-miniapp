#!/usr/bin/env python3
"""Связать гипотезы голосовых идей с сырыми карточками (Атлас -> карточки).

Метод (детерминированный, без LLM):
  1. Нормализуем цитату гипотезы из MASTER_IDEAS и ищем её 4-словные
     шинглы в дословных транскриптах (transcripts.jsonl). Это даёт точный
     `voice`-идентификатор даже там, где numeric audio_N коллидируют по датам.
  2. По найденному voice ID берём сырую карточку из CARDS-ALL (если есть);
     иначе — ближайшую по токенам карточку из того же смыслового ряда.
  3. Приватные голоса (PERSONAL-IDS) отбрасываются: в Pages уходит только
     идентификатор + уже публичный текст карточки, без полного транскрипта.

Пишет голосовые связи в atlas.json (поле voice_signals) и отдельный
источник voice-links.json для декларативного вида мини-апа.
Только чтение исходных корпусов. Запуск:
    python3 ~/shared-repo/bots/miniapp/build_voice_links.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
MINI = HOME / "shared-repo/bots/miniapp"
IDEAS = HOME / "local-llm/work/voice_ideas/MASTER_IDEAS-2026-11-23.json"
CARDS = HOME / "local-llm/work/voice_ideas/CARDS-ALL-2026-11-23.jsonl"
TRANSCRIPTS = HOME / "local-llm/work/transcripts.jsonl"
PERSONAL = HOME / "local-llm/work/voice_ideas/PERSONAL-IDS-2026-11-23.json"
ATLAS = MINI / "atlas.json"
OUT = MINI / "voice-links.json"

STOP = set("""
это того чтобы как что по на и в не я мы вы он она они с для от до за из к у о без при
также может могут были был была более менее очень типа просто реально вот уже еще ещё
да давай блин бля блять хуй пиздец когда который если тогда тема суть смысле то есть
""".split())


def norm(s: str) -> str:
    return re.sub(r"[^а-яёa-z0-9 ]", " ", (s or "").lower()).strip()


def toks(s: str) -> set[str]:
    return {w for w in re.findall(r"[а-яёa-z]{4,}", (s or "").lower()) if w not in STOP}


def shingles(s: str, n: int = 4) -> set[str]:
    w = norm(s).split()
    return {" ".join(w[i:i + n]) for i in range(max(0, len(w) - n + 1))}


def load():
    ideas = json.loads(IDEAS.read_text(encoding="utf-8"))["items"]
    cards = [json.loads(l) for l in CARDS.read_text(encoding="utf-8").splitlines() if l.strip()]
    transcripts = {}
    for l in TRANSCRIPTS.read_text(encoding="utf-8").splitlines():
        if not l.strip():
            continue
        d = json.loads(l)
        transcripts[d["voice"].rsplit("/", 1)[-1]] = d.get("text") or ""
    personal = set(json.loads(PERSONAL.read_text(encoding="utf-8")))
    return ideas, cards, transcripts, personal


def main() -> int:
    ideas, cards, transcripts, personal = load()
    by_voice = {c["id"]: c for c in cards}
    card_tokens = [(c, toks(c["quote"] + " " + c["idea"])) for c in cards]

    # Предындексируем шинглы транскриптов: шингл -> список voice ID.
    inv: dict[str, list[str]] = {}
    for vid, text in transcripts.items():
        if vid in personal:
            continue
        for sh in shingles(text):
            inv.setdefault(sh, []).append(vid)

    items, signals_out = [], []
    matched = 0
    for h in ideas:
        claim = (h.get("quote") or "").strip("«» ")
        sh = shingles(claim)
        hits: dict[str, int] = {}
        for s in sh:
            for vid in inv.get(s, ()):  # один шингл может быть в нескольких голосах
                hits[vid] = hits.get(vid, 0) + 1
        best = max(hits.items(), key=lambda kv: (kv[1], kv[0])) if hits else (None, 0)
        voice, score = best
        signals = []
        match_kind = "нет"
        if voice and score >= 2:
            matched += 1
            full_text = transcripts.get(voice, "")
            card = by_voice.get(voice)
            match_kind = "дословно+карточка" if card else "дословно"
            sig = {
                "voice": voice,
                "claim": claim[:220],
                "shingles": score,
                "match": match_kind,
            }
            if card:
                sig.update({
                    "card_quote": card["quote"][:240],
                    "card_idea": card["idea"][:240],
                    "theme": card.get("theme", ""),
                    "kind": card.get("kind", ""),
                })
            else:
                # Нет готовой карточки Token-поиск по тому же транскрипту:
                # ближайшая карточка из того же смыслового ряда.
                ht = toks(full_text)
                cand = sorted(
                    ((len(ht & ct) / max(1, len(ht | ct)), c) for c, ct in card_tokens if ht & ct),
                    key=lambda x: -x[0],
                )
                if cand and cand[0][0] >= 0.12:
                    c = cand[0][1]
                    sig["match"] = "дословно+похожая карточка"
                    sig.update({
                        "card_quote": c["quote"][:240],
                        "card_idea": c["idea"][:240],
                        "theme": c.get("theme", ""),
                        "kind": c.get("kind", ""),
                    })
            signals.append(sig)
        items.append({
            "id": h["id"],
            "tier": h.get("tier", ""),
            "status": h.get("status", ""),
            "claim": claim[:220],
            "source": h.get("source", ""),
            "theme": h.get("doc", "") or "голосовые",
            "n_signals": len(signals),
            "signals": signals,
        })
        for sig in signals:
            signals_out.append({
                "id": h["id"] + "::" + sig["voice"].split("@")[0],
                "hypothesis": h["id"],
                "tier": h.get("tier", ""),
                "status": h.get("status", ""),
                "hyp_claim": claim[:180],
                "voice": sig["voice"],
                "card_quote": sig.get("card_quote", ""),
                "card_idea": sig.get("card_idea", ""),
                "theme": sig.get("theme", "") or h.get("doc", ""),
                "match": sig.get("match", ""),
            })

    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    doc = {
        "generated": now,
        "source": {
            "ideas": str(IDEAS.relative_to(HOME)),
            "cards": str(CARDS.relative_to(HOME)),
            "transcripts": str(TRANSCRIPTS.relative_to(HOME)),
            "personal_excluded": len(personal),
        },
        "total": len(items),
        "matched": matched,
        "signals": len(signals_out),
        "note": ("Связь гипотеза -> сырая карточка через дословное совпадение с транскриптом. "
                 "Приватные голоса исключены. Полный транскрипт не публикуется — только "
                 "идентификатор голоса и уже публичный текст карточки."),
        "items": items,
        "flat": signals_out,
    }
    OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK {OUT}: {len(items)} гипотез, {matched} с дословной связью, {len(signals_out)} сигналов", file=sys.stderr)

    # Обновляем voice_signals в атласе тем же детерминированным результатом.
    # Схема совместима с build_views.build_atlas_raw_cards: raw_cards/raw_cards_n/
    # voice_refs. Дополнительно держим n_signals/signals с подробностями сопоставления.
    atlas = json.loads(ATLAS.read_text(encoding="utf-8"))
    vs = []
    for it in items:
        raw_cards = []
        for s in it["signals"]:
            # В публикуемый atlas.json идут только безопасные поля: id/theme/kind
            # и технические подробности сопоставления. Дословные цитаты и идеи
            # остаются в локальном voice-links.json и в Pages не попадают.
            raw_cards.append({
                "id": s["voice"],
                "theme": s.get("theme", ""),
                "kind": s.get("kind", ""),
                "match": s.get("match", ""),
                "shingles": s.get("shingles", 0),
            })
        vs.append({
            "hypothesis": it["id"],
            "tier": it["tier"],
            "status": it["status"],
            "n_signals": it["n_signals"],
            "claim": it["claim"],
            # поля для build_atlas_raw_cards
            "raw_cards": raw_cards,
            "raw_cards_n": len(raw_cards),
            "raw_cards_total": len(raw_cards),
            "voice_refs": [s["voice"] for s in it["signals"]],
            "raw_cards_themes": sorted({s.get("theme", "") for s in it["signals"] if s.get("theme")}),
            "raw_cards_note": "дословная связь с транскриптом" if raw_cards else "нет дословной связи",
            "signals": [
                {"voice": s["voice"], "match": s.get("match", ""),
                 # Ни цитаты, ни идеи в публикуемый atlas.json не пишем:
                 # в Pages уходит только идентификатор голоса и метаданные.
                 "theme": s.get("theme", ""), "shingles": s.get("shingles", 0)}
                for s in it["signals"]
            ],
        })
    atlas["voice_signals"] = vs
    if isinstance(atlas.get("counts"), dict):
        atlas["counts"]["voice_signals"] = len(vs)
    ATLAS.write_text(json.dumps(atlas, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK {ATLAS}: voice_signals={len(vs)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
