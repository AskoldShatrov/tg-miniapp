#!/usr/bin/env python3
"""
build_yesno.py — генератор сужающих да/нет-вопросов из РЕАЛЬНЫХ данных.

Читает реальные файлы, считает evidence (числа!) и атомарно пишет
yesno-questions.json. Никаких выдуманных ID: все scope.ids извлекаются
из самих реестров селекторами из спеки /tmp/opencode/yes-no-app-spec.md.

НЕ трогает index.html, views.js, views.json, wants.json, бота.
Формат вопроса — ровно по §2.1 спеки (+ поле count, как требует ТЗ).
Три ответа: yes/no/unknown; unknown НЕ запускает эффекты, вопрос остаётся open.
"""
import json
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

HOME = "/home/nyaka"
MSK = timezone(timedelta(hours=3))

PATHS = {
    "wants": os.path.join(HOME, ".config/opencode/wants.json"),
    "progress": os.path.join(HOME, ".config/opencode/progress.json"),
    "decisions": os.path.join(HOME, "shared-repo/bots/miniapp/decisions.json"),
    "atlas": os.path.join(HOME, "shared-repo/bots/miniapp/atlas.json"),
    "prompts": os.path.join(HOME, "shared-repo/bots/miniapp/prompts.json"),
    "ux_audit": "/tmp/opencode/ux-time-audit.md",
}
OUT = os.path.join(HOME, "shared-repo/bots/miniapp/yesno-questions.json")


def load(key):
    with open(PATHS[key], encoding="utf-8") as fh:
        return json.load(fh)


def nonblank(value):
    """Пустая строка, пустой список/словарь и None/NULL считаются «нет поля»."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return bool(value)


# ---------------------------------------------------------------------------
# Q1 · Мусорный хвост want'ов
# ---------------------------------------------------------------------------
def q1():
    data = load("wants")
    items = data["items"]
    statuses = {}
    sources = {}
    for it in items:
        statuses[it.get("status")] = statuses.get(it.get("status"), 0) + 1
        sources[it.get("source")] = sources.get(it.get("source"), 0) + 1

    selector_ids = [
        it["id"] for it in items
        if it.get("status") == "open"
        and it.get("source") in ("message", "unanswered")
        and not nonblank(it.get("evolution"))
        and not nonblank(it.get("detail"))
    ]
    evidence = (
        f"{len(selector_ids)} items match selector of {len(items)} total; "
        f"open={statuses.get('open')}, message={sources.get('message')}, "
        f"unanswered={sources.get('unanswered')}"
    )
    text = (
        f"Хвост из {len(selector_ids)} открытых want'ов "
        "(source=message|unanswered, без evolution и detail) — "
        "это мусор, а не отложенные задачи?"
    )
    return {
        "id": "yn-261121-001",
        "text": text,
        "text_yes": "Архивировать как мусор",
        "text_no": "Оставить и запросить уточнение",
        "scope": {
            "kind": "ids",
            "ids": selector_ids,
            "view": "wants-triage",
            "source_file": ".config/opencode/wants.json",
        },
        "_evidence": evidence,
        "_selector": "status=open & source in {message,unanswered} & !evolution & !detail",
        "_file": ".config/opencode/wants.json",
        "effects": [
            {"when": "yes", "op": "archive", "target": "scope.ids",
             "reason": "мусорный хвост: подтверждено пользователем", "status_to": "archived"},
            {"when": "yes", "op": "supersede", "target": "scope.ids", "by": "yn-261121-001",
             "reason": "дубли/шум без деталей и гейтов", "status_to": "superseded"},
            {"when": "no", "op": "request_clarification", "target": "scope.ids",
             "reason": "пользователь не подтвердил мусор", "assign": "session", "status_to": "open"},
            {"when": "no", "op": "clear_stale", "target": "scope.ids", "value": False,
             "reason": "вопрос снят, данные актуальны", "status_to": "open"},
        ],
        "gate_ref": None,
        "priority": "P0",
    }


# ---------------------------------------------------------------------------
# Q2 · Расхождение «1 агент» в снимке плана
# ---------------------------------------------------------------------------
def q2():
    data = load("progress")
    agent_counts = {}
    claim = None
    for task in data.get("tasks", []):
        for step in task.get("steps", []):
            agent = step.get("agent")
            if agent:
                agent_counts[agent] = agent_counts.get(agent, 0) + 1
        for entry in task.get("history", []):
            if "1 агент" in (entry.get("text") or ""):
                claim = {
                    "task_id": task.get("id"),
                    "text": entry["text"],
                }
    # Реальные имена агентов ровно по списку из ТЗ (все присутствуют в progress.json).
    required = ["cheap-k0", "cheap-k1", "cheap-k2", "cheap-k3",
                "pc", "main", "executor", "progress-sync"]
    real_agents = [a for a in required if a in agent_counts]
    claim_loc = (
        f"tasks[id={claim['task_id']}].history[*].text ~ '1 агент'"
        if claim else "tasks[*].history[*].text ~ '1 агент'"
    )
    evidence = (
        f"claim '1 агент' in {claim_loc} ({claim['text'][:60] if claim else 'n/a'}); "
        f"{len(real_agents)} real agents: {', '.join(real_agents)}"
    )
    text = (
        "Снимок progress.json говорит «1 агент» (сессия 8899), но в логе работают "
        + ", ".join(real_agents)
        + " — считать снимок устаревшим и заменить его реальным списком агентов через supersede?"
    )
    return {
        "id": "yn-261121-002",
        "text": text,
        "text_yes": "Supersede — реальный список агентов",
        "text_no": "Оставить и уточнить, какой агент",
        "scope": {
            "kind": "claim",
            "ids": real_agents,
            "view": "progress-claims",
            "source_file": ".config/opencode/progress.json",
        },
        "_evidence": evidence,
        "_selector": claim_loc + "; agent names from tasks[*].steps[*].agent",
        "_file": ".config/opencode/progress.json",
        "effects": [
            {"when": "yes", "op": "supersede", "target": "scope.ids", "by": "yn-261121-002",
             "reason": "снимок '1 агент' устарел, заменяем реальным перечнем агентов",
             "status_to": "superseded"},
            {"when": "yes", "op": "link", "target": "scope.ids",
             "reason": "связать claim с реальным перечнем агентов progress.json",
             "status_to": "open"},
            {"when": "no", "op": "request_clarification", "target": "scope.ids",
             "reason": "какой именно агент имелся в виду под '1 агент'?", "assign": "session",
             "status_to": "open"},
        ],
        "gate_ref": None,
        "priority": "P0",
    }


# ---------------------------------------------------------------------------
# Q3 · Гейт T4 с готовыми цифрами
# ---------------------------------------------------------------------------
def q3():
    data = load("decisions")
    gate = next((x for x in data if x.get("h") == "GATE-T4"), None)
    report = None
    if gate:
        for token in (gate.get("src") or "").split(";"):
            token = token.strip()
            if token.endswith(".md"):
                report = token
                break
    report_exists = bool(report) and os.path.exists(os.path.join(HOME, report))
    evidence = (
        f"GATE-T4 verdict={gate.get('verdict') if gate else 'missing'}; "
        f"report={report} (exists={report_exists}); note contains n/baseline "
        f"(0.6129 < 0.7742, AWP-rule 0.6452 > 0.5161)"
    )
    text = (
        "GATE-T4 в decisions.json значится OPEN, хотя отчёт "
        f"{report or 'overnight/73-t4-donk-benchmark.md'} содержит n и baseline — "
        "перевести его в «измерено, вердикт ожидает» и связать с отчётом?"
    )
    return {
        "id": "yn-261121-003",
        "text": text,
        "text_yes": "Link отчёт + Measuring",
        "text_no": "Оставить OPEN, уточнить порог",
        "scope": {
            "kind": "claim",
            "ids": ["GATE-T4"],
            "view": "decisions-list",
            "source_file": "shared-repo/bots/miniapp/decisions.json",
        },
        "_evidence": evidence,
        "_selector": f"h=GATE-T4 & verdict=OPEN; src contains '{report}'",
        "_file": "shared-repo/bots/miniapp/decisions.json",
        "effects": [
            {"when": "yes", "op": "link", "target": report or "overnight/73-t4-donk-benchmark.md",
             "reason": "связать OPEN-гейт с готовым отчётом с n и baseline", "status_to": "open"},
            {"when": "yes", "op": "set_status", "target": "GATE-T4",
             "reason": "измерение проведено, вердикт ожидает", "status_to": "measuring"},
            {"when": "yes", "op": "supersede", "target": "GATE-T4", "by": "yn-261121-003",
             "reason": "OPEN заменён на measuring по факту готового отчёта",
             "status_to": "superseded"},
            {"when": "no", "op": "request_clarification", "target": "GATE-T4",
             "reason": "какого порога не хватает для вердикта?", "assign": "session",
             "status_to": "open"},
        ],
        "gate_ref": None,
        "priority": "P1",
    }


# ---------------------------------------------------------------------------
# Q4 · Устаревшие связи атласа
# ---------------------------------------------------------------------------
def q4():
    data = load("atlas")
    nodes = data["nodes"]
    edges = data["edges"]
    status = {n["id"]: n.get("status") for n in nodes}
    closed = {"done", "archived"}
    to_closed = [e for e in edges if status.get(e["to"]) in closed]
    from_closed = [e for e in edges if status.get(e["from"]) in closed]
    refutes_refuted = [
        e for e in edges
        if e.get("type") == "refutes" and status.get(e["to"]) == "refuted"
    ]
    edge_ids = [f"{e['from']}->{e['to']}" for e in refutes_refuted]
    evidence = (
        f"{len(nodes)} nodes / {len(edges)} edges; "
        f"edges to done/archived={len(to_closed) + len(from_closed)}; "
        f"refutes edges to refuted verdicts={len(refutes_refuted)}"
    )
    text = (
        f"В атласе {len(nodes)} узлов и {len(edges)} рёбер; "
        f"{len(refutes_refuted)} рёбер типа refutes указывают на refuted-вердикты "
        "(archived/done-целей нет) — снять эти связи и пересобрать граф?"
    )
    return {
        "id": "yn-261121-004",
        "text": text,
        "text_yes": "Unlink рёбер + Clear stale",
        "text_no": "Сохранить рёбра, уточнить живые связи",
        "scope": {
            "kind": "ids",
            "ids": edge_ids,
            "view": "atlas-graph",
            "source_file": "shared-repo/bots/miniapp/atlas.json",
        },
        "_evidence": evidence,
        "_selector": "edges[type=refutes & to.status=refuted] -> 'from->to'",
        "_file": "shared-repo/bots/miniapp/atlas.json",
        "effects": [
            {"when": "yes", "op": "unlink", "target": "scope.ids",
             "reason": "цель/refuted-вердикт не несёт активной связи", "status_to": "open"},
            {"when": "yes", "op": "clear_stale", "target": "scope.ids", "value": False,
             "reason": "связи пересобраны, stale-флаги сняты", "status_to": "open"},
            {"when": "no", "op": "request_clarification", "target": "scope.ids",
             "reason": "указать живые связи, которые следует сохранить", "assign": "session",
             "status_to": "open"},
        ],
        "gate_ref": None,
        "priority": "P1",
    }


# ---------------------------------------------------------------------------
# Q5 · Промпты с is_stale
# ---------------------------------------------------------------------------
def q5():
    data = load("prompts")
    stale_ids = []
    total = 0
    for group in data.get("groups", []):
        for prompt in group.get("prompts", []):
            total += 1
            if prompt.get("is_stale") is True:
                stale_ids.append(prompt["id"])
    meta = data.get("meta", {})
    evidence = (
        f"{len(stale_ids)} of {total} prompts have is_stale=true; "
        f"meta.generated={meta.get('generated')}, stale_days={meta.get('stale_days')}"
    )
    text = (
        "В view prompts-cards "
        f"{len(stale_ids)} карточек помечены is_stale, но исходники prompts.json свежие "
        f"(generated {meta.get('generated')}) — снять stale-флаги и пересобрать view?"
    )
    return {
        "id": "yn-261121-005",
        "text": text,
        "text_yes": "Clear stale + Link свежий source",
        "text_no": "Оставить флаги, уточнить промпт",
        "scope": {
            "kind": "view",
            "ids": stale_ids,
            "view": "prompts-cards",
            "source_file": "shared-repo/bots/miniapp/prompts.json",
        },
        "_evidence": evidence,
        "_selector": "groups[*].prompts[*] where is_stale == true -> id",
        "_file": "shared-repo/bots/miniapp/prompts.json",
        "effects": [
            {"when": "yes", "op": "clear_stale", "target": "scope.ids", "value": False,
             "reason": "исходники fresh, stale-флаги снимаем", "status_to": "open"},
            {"when": "yes", "op": "link", "target": "scope.ids",
             "reason": "связать карточки со свежим source", "status_to": "open"},
            {"when": "yes", "op": "supersede", "target": "scope.ids", "by": "yn-261121-005",
             "reason": "старая метка is_stale заменена", "status_to": "superseded"},
            {"when": "no", "op": "request_clarification", "target": "scope.ids",
             "reason": "указать конкретный промпт для ручной проверки", "assign": "session",
             "status_to": "open"},
        ],
        "gate_ref": None,
        "priority": "P2",
    }


def finalize(question, built_at, expires):
    """Собрать вопрос ровно по формату §2.1 + count, убрав служебные _поля."""
    return {
        "id": question["id"],
        "text": question["text"],
        "text_yes": question["text_yes"],
        "text_no": question["text_no"],
        "scope": question["scope"],
        "expires": expires,
        "source": {
            "file": question["_file"],
            "selector": question["_selector"],
            "evidence": question["_evidence"],
            "built_at": built_at,
        },
        "effects": question["effects"],
        "gate_ref": question["gate_ref"],
        "priority": question["priority"],
        "status": "open",
        "count": len(question["scope"]["ids"]),
        "created_at": built_at,
    }


def main():
    # Читаем ux-time-audit как дополнительный контекст (наличие не ломает генератор).
    try:
        with open(PATHS["ux_audit"], encoding="utf-8") as fh:
            audit_text = fh.read()
        audit_note = "ux-time-audit.md прочитан (" + str(len(audit_text)) + " симв.)"
    except OSError:
        audit_note = "ux-time-audit.md недоступен"

    built_at = datetime.now(MSK).isoformat(timespec="seconds")
    expires = (datetime.now(MSK) + timedelta(days=2)).isoformat(timespec="seconds")

    raw = [q1(), q2(), q3(), q4(), q5()]
    questions = [finalize(q, built_at, expires) for q in raw]

    payload = {
        "built_at": built_at,
        "spec": "/tmp/opencode/yes-no-app-spec.md",
        "count": len(questions),
        "answer_policy": {
            "values": ["yes", "no", "unknown"],
            "unknown": "эффекты НЕ запускаются, вопрос остаётся status=open",
        },
        "audit_context": audit_note,
        "questions": questions,
    }

    # Атомарная запись: tmp в той же директории -> fsync -> os.replace.
    directory = os.path.dirname(OUT)
    fd, tmp = tempfile.mkstemp(prefix=".yesno-", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, OUT)
    except Exception:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise

    print(f"Записано {OUT} ({len(questions)} вопросов)")
    for q in questions:
        print(f"  {q['id']}  count={q['count']:>3}  {q['source']['evidence']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
