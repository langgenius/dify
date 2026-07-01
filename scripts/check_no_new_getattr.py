#!/usr/bin/env python3
"""Block net-new getattr() usage in changed Python hunks."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCAN_ROOT = Path.cwd()
RULE_PATH = REPO_ROOT / "scripts" / "ast_grep_rules" / "no_new_getattr.yml"
HUNK_PATTERN = re.compile(
    r"^@@ -(?P<old_start>\d+)(?:,(?P<old_count>\d+))? \+(?P<new_start>\d+)(?:,(?P<new_count>\d+))? @@"
)
SUPPRESSION_PATTERN = re.compile(r"# noqa: no-new-getattr(?:\s+(?P<reason>\S.*))?\s*$")


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


@dataclass(frozen=True)
class Violation:
    path: str
    line_number: int
    message: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("pre-commit", "ci"), required=True)
    parser.add_argument("--merge-target", default="main")
    return parser.parse_args()


def resolve_ast_grep_command() -> list[str]:
    for candidate in ("ast-grep", "sg"):
        if shutil.which(candidate):
            return [candidate]
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
    if args.mode == "pre-commit":
        return git_output("diff", "--cached", "--unified=0", "--diff-filter=AM", "--no-ext-diff")
    merge_base = git_output("merge-base", args.merge_target, "HEAD").strip()
    return git_output(
        "diff",
        "--unified=0",
        "--diff-filter=AM",
        "--no-ext-diff",
        f"{merge_base}..HEAD",
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
    if args.mode == "pre-commit":
        return (
            git_output("show", f"HEAD:{path}", allow_missing=True),
            git_output("show", f":{path}"),
        )

    merge_base = git_output("merge-base", args.merge_target, "HEAD").strip()
    return (
        git_output("show", f"{merge_base}:{path}", allow_missing=True),
        git_output("show", f"HEAD:{path}"),
    )


def run_ast_grep(source: str) -> list[Match]:
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
                str(RULE_PATH),
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
        matches.append(Match(line_number=line_number, source_line=source_line))
    return matches


def is_suppressed(source_line: str) -> bool:
    match = SUPPRESSION_PATTERN.search(source_line)
    if not match:
        return False
    reason = match.group("reason")
    return reason is not None and bool(reason.strip())


def collect_hunk_violations(path: str, old_matches: list[Match], new_matches: list[Match], hunk: Hunk) -> list[Violation]:
    old_in_hunk = [match for match in old_matches if hunk.contains_old(match.line_number) and not is_suppressed(match.source_line)]
    new_in_hunk = [match for match in new_matches if hunk.contains_new(match.line_number) and not is_suppressed(match.source_line)]
    surplus = len(new_in_hunk) - len(old_in_hunk)
    if surplus <= 0:
        return []

    return [
        Violation(path=path, line_number=match.line_number, message="no-new-getattr net-new getattr() in added code")
        for match in new_in_hunk[-surplus:]
    ]


def find_net_new_getattr_violations(changed_hunks: dict[str, list[Hunk]], args: argparse.Namespace) -> list[Violation]:
    violations: list[Violation] = []
    for path, hunks in changed_hunks.items():
        if not is_python_source_path(path):
            continue
        old_source, new_source = load_file_versions(path, args)
        old_matches = run_ast_grep(old_source)
        new_matches = run_ast_grep(new_source)
        for hunk in hunks:
            violations.extend(collect_hunk_violations(path, old_matches, new_matches, hunk))
    return sorted(violations, key=lambda item: (item.path, item.line_number))


def print_violations(violations: list[Violation]) -> None:
    for violation in violations:
        print(f"{violation.path}:{violation.line_number}: {violation.message}", file=sys.stderr)


def main() -> int:
    try:
        args = parse_args()
        changed_hunks = parse_changed_hunks(collect_diff_text(args))
        violations = find_net_new_getattr_violations(changed_hunks, args)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if violations:
        print_violations(violations)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
