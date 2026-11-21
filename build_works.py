#!/usr/bin/env python3
"""build_works.py — собрать works.json из реальных источников с provenance.

Источники (только читаем):
  * /home/nyaka/docs/*.md                  — дизайн-документы / планы
  * /home/nyaka/ma_reports/**/*.md         — отчёты по НИР / курсовому
  * /home/nyaka/ma_reports/**/master_plan.json — план отчёта
  * /home/nyaka/knowledge/INDEX.md         — индекс базы знаний

Выход: /home/nyaka/shared-repo/bots/miniapp/works.json
Формат: верхний уровень — массив объектов
    {id, title, date, status, path, source, kind, provenance}

Правила:
  * id стабилен (sha256 от source + относительного пути) — чтобы пересборка
    не ломала ссылки и можно было находить исчезнувшие работы;
  * если путь работы больше не существует — status = "missing"
    (запись сохраняется, проставляется missing_since);
  * запись атомарная: temp-файл в той же директории + os.replace().
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

HOME = Path("/home/nyaka")
OUT = HOME / "shared-repo" / "bots" / "miniapp" / "works.json"

DOCS = HOME / "docs"
MA_REPORTS = HOME / "ma_reports"
KNOWLEDGE = HOME / "knowledge"

STATUS_DONE = ("готово", "завершено", "complete", "completed", "done", "ready")
STATUS_PROGRESS = ("в процессе", "in progress", "wip", "draft", "черновик")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_head(path: Path, max_lines: int = 80) -> str:
    """Прочитать только шапку файла — большие файлы не грузим целиком."""
    parts: list[str] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for _ in range(max_lines):
                line = fh.readline()
                if not line:
                    break
                parts.append(line)
    except OSError:
        return ""
    return "".join(parts)


def make_id(source: str, relpath: str) -> str:
    digest = hashlib.sha256(f"{source}:{relpath}".encode("utf-8")).hexdigest()[:10]
    return f"wk-{digest}"


def extract_title(path: Path, head: str) -> tuple[str, str]:
    """Вернуть (title, title_from)."""
    for line in head.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            title = stripped.lstrip("#").strip()
            if title:
                return title[:160], "first-heading"
    if path.suffix.lower() == ".json":
        # master_plan.json: осмысленное имя вместо имени файла
        return path.stem.replace("_", " ").capitalize(), "filename"
    return path.name, "filename"


def derive_status(head: str) -> str:
    low = head.lower()
    if any(marker in low for marker in STATUS_DONE):
        return "done"
    if any(marker in low for marker in STATUS_PROGRESS):
        return "in-progress"
    return "draft"


def file_date(path: Path, head: str) -> str:
    """Дата из шапки (DD.MM.YYYY / YYYY-MM-DD), иначе mtime файла."""
    import re

    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", head)
    if m:
        return m.group(1)
    m = re.search(r"\b(\d{2})\.(\d{2})\.(\d{4})\b", head)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d")


def candidates() -> Iterable[tuple[Path, str, str]]:
    """(path, source, kind) — только реально существующие файлы."""
    if DOCS.is_dir():
        for p in sorted(DOCS.glob("*.md")):
            yield p, "docs", "design-doc"
    if MA_REPORTS.is_dir():
        for p in sorted(MA_REPORTS.rglob("*.md")):
            yield p, "ma_reports", "report"
        for p in sorted(MA_REPORTS.rglob("master_plan.json")):
            yield p, "ma_reports", "plan"
    index = KNOWLEDGE / "INDEX.md"
    if index.is_file():
        yield index, "knowledge", "index"


def load_existing() -> dict[str, dict]:
    if not OUT.is_file():
        return {}
    try:
        data = json.loads(OUT.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, list):
        return {}
    return {str(w.get("id")): w for w in data if isinstance(w, dict) and w.get("id")}


def build() -> list[dict]:
    existing = load_existing()
    built: dict[str, dict] = {}
    extracted_at = now_iso()

    for path, source, kind in candidates():
        try:
            rel = path.relative_to(HOME).as_posix()
        except ValueError:
            rel = path.name
        head = read_head(path)
        title, title_from = extract_title(path, head)
        work = {
            "id": make_id(source, rel),
            "title": title,
            "date": file_date(path, head),
            "status": derive_status(head),
            "path": str(path),
            "source": source,
            "kind": kind,
            "provenance": {
                "root": str(path.parent if source == "docs" else
                             (MA_REPORTS if source == "ma_reports" else KNOWLEDGE)),
                "relpath": rel,
                "discovered_by": "build_works.py:candidates",
                "title_from": title_from,
                "date_from": "heading-or-mtime",
                "extracted_at": extracted_at,
            },
        }
        built[work["id"]] = work

    # Слияние: исчезнувшие пути помечаем missing, сохраняя запись.
    merged: dict[str, dict] = dict(built)
    for wid, old in existing.items():
        if wid not in merged:
            merged[wid] = old  # путь уже не сканируется — проверяем ниже

    for wid, work in merged.items():
        if not Path(str(work.get("path", ""))).exists():
            work["status"] = "missing"
            work.setdefault("missing_since", now_iso())
        else:
            work.pop("missing_since", None)

    return sorted(
        merged.values(),
        key=lambda w: (str(w.get("source")), str(w.get("date")), str(w.get("title"))),
    )


def atomic_write_json(path: Path, data: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".works-", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o664)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main() -> int:
    works = build()
    atomic_write_json(OUT, works)
    by_source: dict[str, int] = {}
    for w in works:
        by_source[str(w.get("source"))] = by_source.get(str(w.get("source")), 0) + 1
    print(f"записано работ: {len(works)} -> {OUT}")
    for source, count in sorted(by_source.items()):
        print(f"  {source}: {count}")
    missing = [w for w in works if w.get("status") == "missing"]
    print(f"  missing: {len(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
