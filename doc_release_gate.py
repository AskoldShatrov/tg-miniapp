#!/usr/bin/env python3
"""Предотправной гейт учебных PDF: ловит '??', питон, чужую тему и съехавшие титулы.

Запуск: python3 doc_release_gate.py
Вывод: один результат на файл и итог N PASS / M FAIL. Гейт читает только
опубликованные файлы (библиотека мини-апа + outbox), а не черновики.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

HUB = Path(__file__).resolve().parent
OUTBOX = HUB.parent / "outbox-fix-20261127"
Gate = tuple[str, bool, str]

PDFS = [
    HUB / "pdfs/nir-final.pdf",
    HUB / "pdfs/kp-kmvkh-final.pdf",
    HUB / "pdfs/kr1-internet-technologies.pdf",
    HUB / "pdfs/kr2-internet-technologies.pdf",
    HUB / "pdfs/kr3-modelirovanie.pdf",
    HUB / "pdfs/kontrolnye-raboty-1-3-combined.pdf",
    HUB / "word/10-kr1-2-3-shatrov-mvstudium.pdf",
    HUB.parent / "offline/pdfs/kursovaya-it.pdf",
    HUB.parent / "pdfs/zadanie-kp-ispravleno.pdf",
    HUB.parent / "pdfs/zadanie-kp.pdf",
    OUTBOX / "01_НИР_отчёт_37стр.pdf",
    OUTBOX / "02_Курсовой_проект_28стр.pdf",
    OUTBOX / "03_КР3_Моделирование_систем_7стр.pdf",
]


def text_of(pdf: Path) -> str:
    return subprocess.run(["pdftotext", "-layout", str(pdf), "-"],
                          capture_output=True, text=True).stdout


def check(pdf: Path) -> list[Gate]:
    res: list[Gate] = []
    if not pdf.exists():
        return [(str(pdf), False, "нет файла")]
    txt = text_of(pdf)
    qq = txt.count("??")
    res.append(("перекрёстные ссылки", qq == 0, f"?? = {qq}"))
    py = len(re.findall(r"(?i)python|питон", txt))
    res.append(("без питона", py == 0, f"упоминаний = {py}"))
    if "kp-kmvkh" in pdf.name or "Курсовой" in pdf.name:
        ok = "TLS" in txt[:4000] and "тестирования мобильного" not in txt[:4000]
        res.append(("тема КП — TLS", ok, "шифрование TLS" if ok else "чужая тема"))
    if "nir" in pdf.name or "НИР" in pdf.name:
        ok = "Санкт-Петербург" in txt[:4000] and "2026" in txt[:4000]
        res.append(("город на титуле", ok, "на первой странице" if ok else "уехал на другую страницу"))
        # Подчёркивание в PDF — графическая линия, а не текст: ищем признаки
        # старого дефекта — строку, состоящую только из подчёркиваний под ФИО.
        old = bool(re.search(r"(?m)^\s*_{5,}\s*$", txt))
        names = all(n in txt for n in ("Т. Б. Чистякова", "Р. В. Макарук", "А. И. Шатров"))
        ok = names and not old
        res.append(("подписи в строке с ФИО", ok, "нет отдельной линии под фамилией" if ok else "старая вёрстка"))
    return res


def main() -> int:
    total_ok = 0
    total_bad = 0
    for pdf in PDFS:
        checks = check(pdf)
        ok = all(x[1] for x in checks)
        total_ok += ok
        total_bad += not ok
        status = "PASS" if ok else "FAIL"
        short = "; ".join(f"{name}: {note}" for name, passed, note in checks if not passed)
        print(f"{status} {pdf.relative_to(HUB.parent)}" + (f" — {short}" if short else ""))
    print(f"\nИТОГ: {total_ok} PASS / {total_bad} FAIL")
    return 1 if total_bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
