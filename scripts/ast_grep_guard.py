#!/usr/bin/env python3
"""Shared helpers for baseline-aware ast-grep CI guards."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOT = Path.cwd()
RULES_ROOT = REPO_ROOT / "scripts" / "ast_grep_rules"
HUNK_PATTERN = re.compile(
    r"^@@ -(?P<old_start>\d+)(?:,(?P<old_count>\d+))? \+(?P<new_start>\d+)(?:,(?P<new_count>\d+))? @@"
)

PathPredicate = Callable[[str], bool]
MatchPredicate = Callable[["Match"], bool]


@dataclass(frozen=True)
class Hunk:
    old_start: int
    old_count: int
    new_start: int
    new_count: int

    def contains_old(self, line_number: int) -> bool:
        return self._contains(line_number, self.old_start, self.old_count)

    def contains_new(self, line_number: int) -> bool:
        return self._contains(line_number, self.new_start, self.new_count)

    @staticmethod
    def _contains(line_number: int, start: int, count: int) -> bool:
        if count == 0:
            return False
        return start <= line_number < start + count


@dataclass(frozen=True)
class Match:
    line_number: int
    source_line: str
    text: str
    meta_variables: dict[str, str]


@dataclass(frozen=True)
class Violation:
    path: str
    line_number: int
    message: str


def rule_path(filename: str) -> Path:
    return RULES_ROOT / filename


def parse_args(description: str | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    diff_source_group = parser.add_mutually_exclusive_group(required=True)
    diff_source_group.add_argument(
        "--staged",
        action="store_true",
        help="Inspect staged changes against HEAD, for pre-commit style usage.",
    )
    diff_source_group.add_argument(
        "--base-rev",
        help="Inspect changes between the provided git revision and HEAD.",
    )
    return parser.parse_args()


def resolve_ast_grep_command() -> list[str]:
    if shutil.which("ast-grep"):
        return ["ast-grep"]
    if shutil.which("uvx"):
        return ["uvx", "--from", "ast-grep-cli", "ast-grep"]
    raise RuntimeError("ast-grep executable not found")


def git_output(*args: str, allow_missing: bool = False) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=SCAN_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode == 0:
        return completed.stdout
    if allow_missing:
        return ""
    raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "git command failed")


def collect_diff_text(args: argparse.Namespace) -> str:
    if args.staged:
        return git_output("diff", "--cached", "--unified=0", "--diff-filter=AM", "--no-ext-diff")
    return git_output(
        "diff",
        "--unified=0",
        "--diff-filter=AM",
        "--no-ext-diff",
        f"{args.base_rev}..HEAD",
    )


def parse_changed_hunks(diff_text: str) -> dict[str, list[Hunk]]:
    changed_hunks: dict[str, list[Hunk]] = {}
    current_path: str | None = None

    for line in diff_text.splitlines():
        if line.startswith("diff --git "):
            parts = line.split()
            current_path = parts[3][2:]
            changed_hunks.setdefault(current_path, [])
            continue

        if current_path is None:
            continue

        hunk_match = HUNK_PATTERN.match(line)
        if not hunk_match:
            continue

        changed_hunks[current_path].append(
            Hunk(
                old_start=int(hunk_match.group("old_start")),
                old_count=parse_count(hunk_match.group("old_count")),
                new_start=int(hunk_match.group("new_start")),
                new_count=parse_count(hunk_match.group("new_count")),
            )
        )

    return {path: hunks for path, hunks in changed_hunks.items() if hunks}


def parse_count(value: str | None) -> int:
    if value is None:
        return 1
    return int(value)


def is_python_source_path(path: str) -> bool:
    return Path(path).suffix in {".py", ".pyi"}


def load_file_versions(path: str, args: argparse.Namespace) -> tuple[str, str]:
    if args.staged:
        return (
            git_output("show", f"HEAD:{path}", allow_missing=True),
            git_output("show", f":{path}"),
        )

    return (
        git_output("show", f"{args.base_rev}:{path}", allow_missing=True),
        git_output("show", f"HEAD:{path}"),
    )


def run_ast_grep(source: str, *, rule: Path) -> list[Match]:
    if not source.strip():
        return []

    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", encoding="utf-8") as temp_file:
        temp_file.write(source)
        temp_file.flush()
        completed = subprocess.run(
            [
                *resolve_ast_grep_command(),
                "scan",
                "--rule",
                str(rule),
                "--json=compact",
                temp_file.name,
            ],
            cwd=REPO_ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    if completed.returncode not in (0, 1):
        raise RuntimeError(completed.stderr.strip() or completed.stdout.strip() or "ast-grep command failed")

    if not completed.stdout.strip():
        return []

    lines = source.splitlines()
    raw_matches = json.loads(completed.stdout)
    matches: list[Match] = []
    for raw_match in raw_matches:
        line_number = int(raw_match["range"]["start"]["line"]) + 1
        source_line = lines[line_number - 1] if line_number - 1 < len(lines) else ""
        matches.append(
            Match(
                line_number=line_number,
                source_line=source_line,
                text=extract_match_text(raw_match, fallback=source_line),
                meta_variables=extract_meta_variables(raw_match),
            )
        )
    return matches


def extract_match_text(raw_match: dict[str, Any], *, fallback: str) -> str:
    text = raw_match.get("text")
    if isinstance(text, str) and text:
        return text

    lines = raw_match.get("lines")
    if isinstance(lines, str) and lines:
        return lines

    return fallback


def extract_meta_variables(raw_match: dict[str, Any]) -> dict[str, str]:
    meta_variables = raw_match.get("metaVariables")
    if not isinstance(meta_variables, dict):
        return {}

    single_variables = meta_variables.get("single")
    if not isinstance(single_variables, dict):
        return {}

    result: dict[str, str] = {}
    for name, value in single_variables.items():
        if not isinstance(name, str) or not isinstance(value, dict):
            continue
        text = value.get("text")
        if isinstance(text, str):
            result[name] = text
    return result


def has_reasoned_noqa(source_line: str, rule_id: str) -> bool:
    pattern = re.compile(rf"# noqa: {re.escape(rule_id)}(?:\s+(?P<reason>\S.*))?\s*$")
    match = pattern.search(source_line)
    if not match:
        return False
    reason = match.group("reason")
    return reason is not None and bool(reason.strip())


def collect_hunk_violations(
    path: str,
    old_matches: list[Match],
    new_matches: list[Match],
    hunk: Hunk,
    *,
    is_reportable_match: MatchPredicate,
    violation_message: str,
) -> list[Violation]:
    old_in_hunk = [
        match for match in old_matches if hunk.contains_old(match.line_number) and is_reportable_match(match)
    ]
    new_in_hunk = [
        match for match in new_matches if hunk.contains_new(match.line_number) and is_reportable_match(match)
    ]
    surplus = len(new_in_hunk) - len(old_in_hunk)
    if surplus <= 0:
        return []

    return [
        Violation(path=path, line_number=match.line_number, message=violation_message)
        for match in new_in_hunk[-surplus:]
    ]


def find_net_new_violations(
    changed_hunks: dict[str, list[Hunk]],
    args: argparse.Namespace,
    *,
    rule: Path,
    is_scanned_path: PathPredicate,
    is_reportable_match: MatchPredicate,
    violation_message: str,
) -> list[Violation]:
    violations: list[Violation] = []
    for path, hunks in changed_hunks.items():
        if not is_scanned_path(path):
            continue
        old_source, new_source = load_file_versions(path, args)
        old_matches = run_ast_grep(old_source, rule=rule)
        new_matches = run_ast_grep(new_source, rule=rule)
        for hunk in hunks:
            violations.extend(
                collect_hunk_violations(
                    path,
                    old_matches,
                    new_matches,
                    hunk,
                    is_reportable_match=is_reportable_match,
                    violation_message=violation_message,
                )
            )
    return sorted(violations, key=lambda item: (item.path, item.line_number))


def print_violations(violations: list[Violation]) -> None:
    for violation in violations:
        print(f"{violation.path}:{violation.line_number}: {violation.message}", file=sys.stderr)


def run_guard(
    *,
    description: str | None,
    rule: Path,
    is_scanned_path: PathPredicate,
    is_reportable_match: MatchPredicate,
    violation_message: str,
) -> int:
    try:
        args = parse_args(description)
        changed_hunks = parse_changed_hunks(collect_diff_text(args))
        violations = find_net_new_violations(
            changed_hunks,
            args,
            rule=rule,
            is_scanned_path=is_scanned_path,
            is_reportable_match=is_reportable_match,
            violation_message=violation_message,
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if violations:
        print_violations(violations)
        return 1
    return 0
