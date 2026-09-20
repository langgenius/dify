#!/usr/bin/env python3
"""Route entrypoint.

A route is the ordered list of documents an agent must read before it touches a
feature. This file is the shared engine; one thin `rule_<VERSION>_<ID>.py` per
feature supplies the config.

    python rule_v0.1_F-001.py              # (re)generate rule_v0.1_F-001.json
    python route.py --version v0.1 --id F-001   # reading list; verify paths, data and status
"""
import argparse
import json
import re
from pathlib import Path

ROUTE_DIR = Path(__file__).resolve().parent
SPEC_DIR = ROUTE_DIR.parent
REPO_ROOT = SPEC_DIR.parent.parent
TEMPLATE = ROUTE_DIR / "rule.template.json"

READ_ORDER = ["domain", "prd", "adrs", "architecture", "data", "tasks", "tests", "runbooks"]
STATES = ("todo", "wip", "blocked", "done")  # status-model.md is the definition; this is the check
ITEM_ID = re.compile(r"\b(?:F-\d+-(?:US|TC|T)\d+|DOM-\d+-R\d+)\b")


def build(version, feature_id, feature_title="", extra=None):
    """Render the rule template for one feature. `extra` appends to any list key."""
    raw = TEMPLATE.read_text(encoding="utf-8")
    for token, value in (
        ("{{VERSION}}", version),
        ("{{FEATURE_ID}}", feature_id),
        ("{{FEATURE_TITLE}}", feature_title or feature_id),
    ):
        raw = raw.replace(token, value)
    rule = json.loads(raw)
    for key, items in (extra or {}).items():
        target = rule["reads"] if key in rule["reads"] else rule
        target.setdefault(key, [])
        target[key] = list(dict.fromkeys(target[key] + list(items)))
    for group, paths in rule["reads"].items():
        rule["reads"][group] = [p for path in paths for p in _expand(path)]
    return rule


def _expand(pattern):
    """Globs let the template stay slug-agnostic; unmatched globs are kept so `show` flags them."""
    if "*" not in pattern:
        return [pattern]
    hits = sorted(str(p.relative_to(REPO_ROOT)) for p in REPO_ROOT.glob(pattern))
    return hits or [pattern]


def emit(rule):
    out = ROUTE_DIR / f"rule_{rule['version']}_{rule['feature_id']}.json"
    out.write_text(json.dumps(rule, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(REPO_ROOT)}")
    return out


def load(version, feature_id):
    path = ROUTE_DIR / f"rule_{version}_{feature_id}.json"
    if not path.exists():
        raise SystemExit(f"missing {path.name} — run rule_{version}_{feature_id}.py first")
    return json.loads(path.read_text(encoding="utf-8"))


def show(rule):
    print(f"# Route {rule['version']} {rule['feature_id']} — {rule['feature_title']}")
    print(f"objective: {rule['objective']}\n")
    n, missing = 0, []
    for group in READ_ORDER:
        for rel in rule["reads"].get(group, []):
            n += 1
            ok = (REPO_ROOT / rel).exists()
            missing.append(rel) if not ok else None
            print(f"{n:>2}. [{group}] {rel}{'' if ok else '   <-- MISSING'}")
    print("\nguardrails:")
    for g in rule.get("guardrails", []):
        print(f"  - {g}")
    print("\nexit criteria:")
    for c in rule.get("exit_criteria", []):
        print(f"  - {c}")
    if missing:
        raise SystemExit(f"\n{len(missing)} referenced document(s) missing")
    print(f"\nall {n} referenced documents present")


def check_data(rule):
    """Fixtures are only worth reading if they still match the model.

    Validate every fixture file in reads.data against the entities declared in
    schemas.json. A drifted fixture is worse than no fixture: it teaches an agent
    a shape the system does not have.
    """
    paths = rule["reads"].get("data", [])
    model = next((p for p in paths if p.endswith("schemas.json")), None)
    fixtures = [p for p in paths if "/fixtures/" in p and p.endswith(".json")]
    if not model or not fixtures:
        return
    defs = json.loads((REPO_ROOT / model).read_text(encoding="utf-8")).get("$defs", {})
    errors, n = [], 0
    for rel in fixtures:
        for entity, records in json.loads((REPO_ROOT / rel).read_text(encoding="utf-8")).items():
            if entity.startswith("$"):
                continue
            schema = defs.get(entity)
            if schema is None:
                errors.append(f"{rel}: entity '{entity}' is not declared in {model}")
                continue
            if not isinstance(records, list):
                errors.append(f"{rel}: entity '{entity}' must hold an array of records")
                continue
            allowed = set(schema.get("properties", {}))
            required = set(schema.get("required", []))
            for i, record in enumerate(records):
                n += 1
                for field in sorted(required - set(record)):
                    errors.append(f"{rel}: {entity}[{i}] missing required field '{field}'")
                for field in sorted(set(record) - allowed):
                    errors.append(f"{rel}: {entity}[{i}] has undeclared field '{field}'")
    print(f"\ndata: {n} fixture record(s) checked against {len(defs)} entity definition(s)")
    for e in errors:
        print(f"  MISMATCH {e}")
    if errors:
        raise SystemExit(f"\n{len(errors)} fixture/model mismatch(es)")



def _status_cells(text):
    """Yield (item id, status word) for every table row that carries one.

    Status lives in a Status column: the task table's own, or the Implementation
    status table the domain, PRD and test documents carry. Both are the same
    shape to read, so one parser serves all four.
    """
    col, rows = None, []
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            col = None
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        nxt = lines[i + 1] if i + 1 < len(lines) else ""
        if set(nxt.replace(" ", "")) <= set("|-:") and nxt.strip():
            col = next((k for k, c in enumerate(cells) if "status" in c.lower()), None)
            continue
        found = ITEM_ID.search(line)
        if not found:
            continue
        cell = cells[col] if col is not None and col < len(cells) else ""
        rows.append((found.group(), cell.strip("` *").split()[0].lower() if cell.strip("` *") else ""))
    return rows


def check_status(rule):
    """Roll up implementation status across the four documents that carry it.

    A status word nobody agreed on reads as information and carries none, so an
    unknown one fails here. A missing one does not: a hub can be part-way through
    adopting the model, and refusing to print the roll-up would hide exactly the
    documents that still need it.
    """
    groups = ("domain", "prd", "tasks", "tests")
    seen, unknown, docs = {s: 0 for s in STATES}, [], 0
    blank = 0
    for group in groups:
        for rel in rule["reads"].get(group, []):
            path = REPO_ROOT / rel
            if not path.exists() or path.suffix != ".md":
                continue
            rows = _status_cells(path.read_text(encoding="utf-8"))
            docs += 1 if rows else 0
            for item, state in rows:
                if not state:
                    blank += 1
                elif state in seen:
                    seen[state] += 1
                else:
                    unknown.append(f"{rel}: {item} has status '{state}', not one of {'|'.join(STATES)}")
    if not docs:
        return
    tally = ", ".join(f"{seen[s]} {s}" for s in STATES)
    print(f"\nstatus: {tally}" + (f", {blank} unstatused" if blank else "") + f" across {docs} document(s)")
    for u in unknown:
        print(f"  UNKNOWN STATE {u}")
    if unknown:
        raise SystemExit(f"\n{len(unknown)} unknown status value(s) — see status-model.md")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--version", required=True)
    p.add_argument("--id", required=True, dest="feature_id")
    a = p.parse_args()
    rule = load(a.version, a.feature_id)
    show(rule)
    check_data(rule)
    check_status(rule)
