#!/usr/bin/env python3
"""Report direct SQLAlchemy usage in controller code.

This is the full-inventory companion to ``check_no_new_controller_sqlalchemy.py``.
It scans the current tree instead of a git diff, so migration work can inspect
existing controller usage without turning historical debt into a CI failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass
from pathlib import Path

import check_no_new_controller_sqlalchemy as controller_sqlalchemy_guard
from ast_grep_guard import Match, REPO_ROOT, run_ast_grep


DEFAULT_CONTROLLER_DIR = REPO_ROOT / "api" / "controllers"
MAX_TEXT_LENGTH = 180
SESSION_METHOD_PATTERN = re.compile(r"^(?:db\.session|session)\.(?P<method>[A-Za-z_][A-Za-z0-9_]*)\(")


@dataclass(frozen=True)
class Finding:
    classification: str
    category: str
    file: str
    line: int
    text: str
    source_line: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "paths",
        nargs="*",
        help="Files or directories to scan. Defaults to api/controllers.",
    )
    parser.add_argument("--include-allowed", action="store_true", help="Print allowed flush()/commit() findings.")
    parser.add_argument("--include-suppressed", action="store_true", help="Print reasoned noqa suppressions.")
    parser.add_argument("--summary-only", action="store_true", help="Print counts without per-finding details.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument(
        "--fail-on-findings",
        action="store_true",
        help="Treat reportable direct SQLAlchemy usage as a failure. By default this scanner is report-only.",
    )
    return parser.parse_args()


def iter_python_files(paths: Iterable[Path]) -> Iterable[Path]:
    for path in paths:
        if path.is_file() and path.suffix in {".py", ".pyi"}:
            yield path
        elif path.is_dir():
            yield from sorted(child for child in path.rglob("*.py") if child.is_file())


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT))
    except ValueError:
        return str(path)


def compact_text(text: str) -> str:
    compact = " ".join(text.split())
    if len(compact) <= MAX_TEXT_LENGTH:
        return compact
    return f"{compact[: MAX_TEXT_LENGTH - 3]}..."


def category_for_match(match: Match) -> str:
    text = match.text.strip()
    method_match = SESSION_METHOD_PATTERN.match(text)
    method = method_match.group("method") if method_match else None

    if text.startswith("db.session."):
        return f"scoped-session.{method or 'call'}"
    if text.startswith("session."):
        return f"explicit-session.{method or 'call'}"
    if text.startswith(("Session(", "sessionmaker(")):
        return "session-factory"
    if text.startswith(("sa.", "sqlalchemy.", "db.")):
        return "sql-expression-qualified"
    return "sql-expression"


def classification_for_match(match: Match) -> str:
    if controller_sqlalchemy_guard.is_allowed_session_boundary(match):
        return "allowed"
    if controller_sqlalchemy_guard.is_suppressed(match):
        return "suppressed"
    if controller_sqlalchemy_guard.is_flask_session_get(match):
        return "ignored"
    return "reportable"


def findings_for_file(path: Path) -> list[Finding]:
    source = path.read_text(encoding="utf-8")
    findings: list[Finding] = []
    for match in run_ast_grep(source, rule=controller_sqlalchemy_guard.RULE_PATH):
        findings.append(
            Finding(
                classification=classification_for_match(match),
                category=category_for_match(match),
                file=display_path(path),
                line=match.line_number,
                text=compact_text(match.text),
                source_line=match.source_line.strip(),
            )
        )
    return findings


def print_text_report(
    findings: Sequence[Finding],
    *,
    include_allowed: bool,
    include_suppressed: bool,
    summary_only: bool,
) -> None:
    counts = Counter(finding.classification for finding in findings)
    reportable = [finding for finding in findings if finding.classification == "reportable"]
    category_counts = Counter(finding.category for finding in reportable)
    file_counts = Counter(finding.file for finding in reportable)
    sys.stdout.write(
        "Controller SQLAlchemy scan: "
        f"{counts['reportable']} reportable, "
        f"{counts['allowed']} allowed, "
        f"{counts['suppressed']} suppressed, "
        f"{counts['ignored']} ignored\n"
    )

    if category_counts:
        sys.stdout.write("\nREPORTABLE BY CATEGORY:\n")
        for category, count in sorted(category_counts.items()):
            sys.stdout.write(f"- {category}: {count}\n")

    if file_counts:
        sys.stdout.write("\nREPORTABLE BY FILE:\n")
        for file, count in sorted(file_counts.items()):
            sys.stdout.write(f"- {file}: {count}\n")

    if summary_only:
        return

    print_findings("REPORTABLE", reportable)
    if include_allowed:
        print_findings("ALLOWED", [finding for finding in findings if finding.classification == "allowed"])
    if include_suppressed:
        print_findings("SUPPRESSED", [finding for finding in findings if finding.classification == "suppressed"])


def print_findings(title: str, findings: Sequence[Finding]) -> None:
    if not findings:
        return

    sys.stdout.write(f"\n{title}:\n")
    for finding in findings:
        sys.stdout.write(f"- {finding.file}:{finding.line} [{finding.category}] {finding.text}\n")


def jsonable_findings(
    findings: Sequence[Finding],
    *,
    include_allowed: bool,
    include_suppressed: bool,
    summary_only: bool,
) -> dict[str, object]:
    visible = [
        finding
        for finding in findings
        if finding.classification == "reportable"
        or (include_allowed and finding.classification == "allowed")
        or (include_suppressed and finding.classification == "suppressed")
    ]
    counts = Counter(finding.classification for finding in findings)
    return {
        "summary": dict(sorted(counts.items())),
        "findings": [] if summary_only else [asdict(finding) for finding in visible],
    }


def main() -> int:
    args = parse_args()
    raw_paths = args.paths or [str(DEFAULT_CONTROLLER_DIR)]
    paths = [path if path.is_absolute() else REPO_ROOT / path for path in map(Path, raw_paths)]

    findings: list[Finding] = []
    for path in iter_python_files(paths):
        findings.extend(findings_for_file(path.resolve()))
    findings.sort(key=lambda finding: (finding.file, finding.line, finding.category, finding.text))

    if args.json:
        payload = jsonable_findings(
            findings,
            include_allowed=bool(args.include_allowed),
            include_suppressed=bool(args.include_suppressed),
            summary_only=bool(args.summary_only),
        )
        sys.stdout.write(f"{json.dumps(payload, indent=2, sort_keys=True)}\n")
    else:
        print_text_report(
            findings,
            include_allowed=bool(args.include_allowed),
            include_suppressed=bool(args.include_suppressed),
            summary_only=bool(args.summary_only),
        )

    has_reportable = any(finding.classification == "reportable" for finding in findings)
    return int(bool(args.fail_on_findings) and has_reportable)


if __name__ == "__main__":
    raise SystemExit(main())
