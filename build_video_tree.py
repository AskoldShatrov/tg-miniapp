#!/usr/bin/env python3
"""Дерево смыслов из разборов видео вместо трёх плоских сеток.

Один источник — grids.json (40 claim, 8 кластеров, 2 автора). Структура:
корень → 4 смысловых ветви → 8 кластеров → claim с подписью вердикта.

Пороги зафиксированы ДО сборки и проверяются до записи файла:
  ветвление на каждом уровне   ≤ 7
  глубина от корня до claim    ≥ 3
  сущностей на одном экране    ≤ 7
  покрытие claim               = 40/40, без дублей
"""
import datetime
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "grids.json"
OUT = HERE / "video-tree.json"

MAX_BRANCHING = 7
MIN_DEPTH = 3
MAX_SCREEN = 7
EXPECTED_CLAIMS = 40

# 8 кластеров сгруппированы по 2 в 4 ветви — branching 4/2/≤7.
BRANCHES = [
    ("B1", "Командная структура и тайминг", ["roles", "timing"]),
    ("B2", "Огонь и пространство", ["grenades", "peek"]),
    ("B3", "Движение и прицел", ["movement", "aim_hit"]),
    ("B4", "Когниция и инструменты", ["cognition", "settings"]),
]

STATUS_RANK = {"PASS": 0, "OPEN": 1, "FAIL": 2}


def claim_status(item):
    if item.get("verdict_source") != "verification":
        return "OPEN"
    label = (item.get("verdict_label") or "").lower()
    if "отрицательно" in label:
        return "FAIL"
    if "подтверждено" in label:
        return "PASS"
    return "OPEN"


def aggregate(statuses):
    if not statuses:
        return "OPEN"
    if all(s == "PASS" for s in statuses):
        return "PASS"
    if any(s == "FAIL" for s in statuses):
        return "FAIL"
    return "OPEN"


def shorten(text, limit=120):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def main():
    data = json.loads(SRC.read_text(encoding="utf-8"))
    items = data.get("items") or []
    by_cluster = {}
    for item in items:
        by_cluster.setdefault(item.get("cluster"), []).append(item)

    roots = []
    checks = []
    all_claim_ids = []

    root_children = []
    for bid, btitle, cluster_keys in BRANCHES:
        cluster_nodes = []
        for key in cluster_keys:
            claims = sorted(by_cluster.get(key, []), key=lambda x: x.get("id") or "")
            claim_nodes = []
            for item in claims:
                status = claim_status(item)
                all_claim_ids.append(item.get("id"))
                name = f"{item.get('id')} · {shorten(item.get('claim'))} · {item.get('verdict_label')}"
                claim_nodes.append({
                    "id": item.get("id"),
                    "name": name,
                    "status": status,
                    "source": "verification" if item.get("verdict_source") == "verification" else "n2_status_only",
                    "author": item.get("author"),
                    "video": item.get("video"),
                    "cluster": key,
                    "as_of": item.get("as_of"),
                    "how_to_check": item.get("how_to_check"),
                })
            title = claims[0].get("cluster_title") if claims else key
            cluster_nodes.append({
                "id": key,
                "name": f"{title} · {len(claims)} claim",
                "labeling": "author_manual",
                "status": aggregate([n["status"] for n in claim_nodes]),
                "children": claim_nodes,
            })
        root_children.append({
            "id": bid,
            "name": f"{btitle} · {sum(len(c['children']) for c in cluster_nodes)} claim",
            "status": aggregate([c["status"] for c in cluster_nodes]),
            "children": cluster_nodes,
        })

    roots.append({
        "id": "video-ideas",
        "name": "Разборы видео — дерево смыслов (40 claim)",
        "status": aggregate([b["status"] for b in root_children]),
        "children": root_children,
    })

    # Проверки ДО записи.
    def walk(node, depth=0):
        kids = node.get("children") or []
        if kids:
            checks.append((f"branching<={MAX_BRANCHING}:{node['id']}", len(kids) <= MAX_BRANCHING, len(kids)))
        yield depth, node
        for kid in kids:
            yield from walk(kid, depth + 1)

    depths = []
    for depth, node in walk(roots[0]):
        if node.get("source") or node.get("cluster"):
            depths.append(depth)
    checks.append((f"depth>={MIN_DEPTH}", bool(depths) and min(depths) >= MIN_DEPTH, min(depths) if depths else 0))
    checks.append((f"screen<={MAX_SCREEN}", all(n <= MAX_SCREEN for n in
                   [len(roots[0]["children"])] + [len(b["children"]) for b in root_children] +
                   [len(c["children"]) for b in root_children for c in b["children"]]),
                   max([len(roots[0]["children"])] + [len(b["children"]) for b in root_children] +
                       [len(c["children"]) for b in root_children for c in b["children"]])))
    checks.append((f"claims={EXPECTED_CLAIMS}", len(all_claim_ids) == EXPECTED_CLAIMS, len(all_claim_ids)))
    checks.append(("claims_unique", len(set(all_claim_ids)) == len(all_claim_ids), len(set(all_claim_ids))))

    ok = True
    for name, passed, value in checks:
        print(f"{'PASS' if passed else 'FAIL'} {name:28} {value}")
        ok &= passed
    if not ok:
        print("RESULT: CHECKS_FAILED — файл не записан")
        return 1

    payload = {
        "version": 1,
        "labeling": {
            "kind": "author_manual_clusters",
            "note": "8 кластеров — авторская разметка из N2, не независимо проверенная таксономия",
            "verification_rows": 19,
            "decisive_verdicts": 12,
            "verification_unverifiable": 7,
            "n2_status_only": 21,
            "verdict_gate": "12/40 решающих вердиктов; гейт 40/40 НЕ взят",
            "delivery_evidence": {
                "field": "prompts.json:delivered_ts + user_id",
                "n": 471,
                "user_id": {"1869196044": 466, "435824119": 5},
            },
        },
        "built_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "built_by": "build_video_tree.py",
        "source": "grids.json",
        "as_of": data.get("as_of"),
        "thresholds": {
            "max_branching": MAX_BRANCHING,
            "min_depth": MIN_DEPTH,
            "max_screen": MAX_SCREEN,
            "expected_claims": EXPECTED_CLAIMS,
        },
        "counts": {
            "claims": len(all_claim_ids),
            "clusters": sum(len(b["children"]) for b in root_children),
            "branches": len(root_children),
            "verification": sum(1 for n in [x for r in roots for b in r["children"] for c in b["children"] for x in c["children"]]
                                if n["source"] == "verification"),
        },
        "nodes": roots,
    }
    tmp = OUT.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(OUT)
    print(f"RESULT: OK → {OUT} ({OUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
