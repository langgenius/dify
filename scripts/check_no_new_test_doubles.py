"""Reject net-new mock constructors and constructor-bypassing runtime subclasses.

Mock, MagicMock and SimpleNamespace calls are checked in all changed Python
sources, including common qualified names, import aliases and direct factory
aliases. AsyncMock and method patching are outside this rule's scope.

The subclass rule covers the audited ModelInstance, ModelManager,
DatasetRetrieval, TraceQueueManager, MessageBasedAppQueueManager and Thread
base names (including qualified names and import aliases) in api/tests/. It
checks explicit __init__ overrides and dataclass-generated initializers. This
is a syntactic guard, not general Python inheritance or execution analysis.
Protocol and Pydantic model implementations are not targeted.

Both rules retain the provided Git baseline. Identical mock calls are counted
per file, with removed occurrences available to match code moved between files:
an additional copy or a different constructor call is rejected.
Git-detected renames retain the source file's baseline, including paths with
spaces. Subclass matches are compared by class name within each changed file,
not only by the line of the class header:
removing a super call or adding a dataclass decorator must still be detected.
An existing offending class can be edited or removed without adding another.
For a justified subclass exception only, add
`# guard-ignore: no-new-stub-subclass -- <reason>` on the class header.
"""

from __future__ import annotations

import argparse
import ast
import sys
import textwrap
from collections import Counter
from dataclasses import replace
from pathlib import Path

from ast_grep_guard import (
    Match,
    Violation,
    filter_moved_matches,
    git_output,
    has_reasoned_guard_ignore,
    is_python_source_path,
    match_key,
    parse_args,
    print_violations,
    rule_path,
    run_ast_grep,
)

STUB_RULE_ID = "no-new-stub-subclass"


def changed_file_versions(args: argparse.Namespace) -> dict[str, tuple[str, str]]:
    """Read Git blobs, preserving rename baselines and NUL-delimited filenames."""
    revisions = ["--cached"] if args.staged else [f"{args.base_rev}..HEAD"]
    status_text = git_output(
        "diff",
        "--name-status",
        "-z",
        "--find-renames",
        "--diff-filter=AMRD",
        "--no-ext-diff",
        *revisions,
    )
    if not status_text:
        return {}
    fields = iter(status_text.rstrip("\0").split("\0"))
    old_revision = "HEAD" if args.staged else args.base_rev
    new_revision = "" if args.staged else "HEAD"
    versions: dict[str, tuple[str, str]] = {}
    for status in fields:
        try:
            old_path = next(fields)
            path = next(fields) if status.startswith("R") else old_path
        except StopIteration as exc:
            raise RuntimeError("Incomplete Git name-status output") from exc
        if not is_python_source_path(path):
            continue
        old_source = "" if status == "A" else git_output("show", f"{old_revision}:{old_path}")
        new_source = "" if status == "D" else git_output("show", f"{new_revision}:{path}")
        versions[path] = (old_source, new_source)
    return versions


def mock_matches(source: str) -> list[Match]:
    """Keep import renames from turning existing constructors into new calls."""
    bindings: dict[str, str] = {}
    for node in ast.parse(source).body:
        if isinstance(node, ast.Import):
            for alias in node.names:
                bindings[alias.asname or alias.name.split(".")[0]] = (
                    alias.name if alias.asname else alias.name.split(".")[0]
                )
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                bindings[alias.asname or alias.name] = alias.name
    matches = []
    for match in run_ast_grep(source, rule=rule_path("no_new_mock.yml")):
        tree = ast.parse(textwrap.dedent(match.text))
        for node in ast.walk(tree):
            if isinstance(node, ast.Name) and node.id in bindings:
                node.id = bindings[node.id]
        matches.append(replace(match, text=ast.unparse(tree)))
    return matches


def find_new_mock_calls(changed: dict[str, tuple[str, str]]) -> list[Violation]:
    """Keep identical baseline calls, but catch alias changes outside their hunks."""
    removed: Counter[str] = Counter()
    added: list[tuple[str, Match]] = []
    for path, (old_source, new_source) in changed.items():
        if old_source == new_source:
            continue
        old_calls = Counter(match_key(match) for match in mock_matches(old_source))
        for match in mock_matches(new_source):
            key = match_key(match)
            if old_calls[key]:
                old_calls[key] -= 1
                continue
            added.append((path, match))
        removed.update(old_calls)
    return [
        Violation(
            path,
            match.line_number,
            "no-new-mock: instantiate a real class instead of Mock, MagicMock or SimpleNamespace",
        )
        for path, match in filter_moved_matches(added, removed)
    ]


def is_reportable_subclass(match: Match) -> bool:
    return not has_reasoned_guard_ignore(match.source_line, STUB_RULE_ID)


def find_new_stub_subclasses(changed: dict[str, tuple[str, str]]) -> list[Violation]:
    removed: Counter[str] = Counter()
    added: list[tuple[str, Match]] = []
    for path, (old_source, new_source) in changed.items():
        if not Path(path).is_relative_to("api/tests"):
            continue
        old_matches = run_ast_grep(old_source, rule=rule_path("no_new_stub_subclass.yml"))
        new_matches = run_ast_grep(new_source, rule=rule_path("no_new_stub_subclass.yml"))
        old_names: dict[str, list[Match]] = {}
        for match in old_matches:
            if is_reportable_subclass(match):
                old_names.setdefault(match.meta_variables["NAME"], []).append(match)
        for match in new_matches:
            if not is_reportable_subclass(match):
                continue
            name = match.meta_variables["NAME"]
            if old_names.get(name):
                old_names[name].pop()
                continue
            added.append((path, match))
        removed.update(match_key(match) for matches in old_names.values() for match in matches)
    return [
        Violation(
            path,
            match.line_number,
            f"{STUB_RULE_ID}: {match.meta_variables['NAME']} bypasses a runtime constructor; "
            "instantiate the real class",
        )
        for path, match in filter_moved_matches(added, removed)
    ]


def main() -> int:
    try:
        args = parse_args(__doc__)
        changed = changed_file_versions(args)
        violations = find_new_mock_calls(changed)
        violations.extend(find_new_stub_subclasses(changed))
    except (OSError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    print_violations(sorted(violations, key=lambda item: (item.path, item.line_number)))
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main())
