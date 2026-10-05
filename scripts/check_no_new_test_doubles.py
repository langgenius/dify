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
per file: an additional copy or a different constructor call is rejected.
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
import sys
from collections import Counter
from pathlib import Path

from ast_grep_guard import (
    Match,
    Violation,
    git_output,
    has_reasoned_guard_ignore,
    is_python_source_path,
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
        "diff", "--name-status", "-z", "--find-renames", "--diff-filter=AMR", "--no-ext-diff", *revisions
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
        versions[path] = (old_source, git_output("show", f"{new_revision}:{path}"))
    return versions


def find_new_mock_calls(changed: dict[str, tuple[str, str]]) -> list[Violation]:
    """Keep identical baseline calls, but catch alias changes outside their hunks."""
    violations: list[Violation] = []
    for path, (old_source, new_source) in changed.items():
        old_calls = Counter(match.text for match in run_ast_grep(old_source, rule=rule_path("no_new_mock.yml")))
        for match in run_ast_grep(new_source, rule=rule_path("no_new_mock.yml")):
            if old_calls[match.text]:
                old_calls[match.text] -= 1
                continue
            violations.append(
                Violation(
                    path=path,
                    line_number=match.line_number,
                    message="no-new-mock: instantiate a real class instead of Mock, MagicMock or SimpleNamespace",
                )
            )
    return violations


def is_reportable_subclass(match: Match) -> bool:
    return not has_reasoned_guard_ignore(match.source_line, STUB_RULE_ID)


def find_new_stub_subclasses(changed: dict[str, tuple[str, str]]) -> list[Violation]:
    violations: list[Violation] = []
    for path, (old_source, new_source) in changed.items():
        if not Path(path).is_relative_to("api/tests"):
            continue
        old_matches = run_ast_grep(old_source, rule=rule_path("no_new_stub_subclass.yml"))
        new_matches = run_ast_grep(new_source, rule=rule_path("no_new_stub_subclass.yml"))
        old_names = Counter(match.meta_variables["NAME"] for match in old_matches if is_reportable_subclass(match))
        for match in new_matches:
            if not is_reportable_subclass(match):
                continue
            name = match.meta_variables["NAME"]
            if old_names[name]:
                old_names[name] -= 1
                continue
            violations.append(
                Violation(
                    path=path,
                    line_number=match.line_number,
                    message=f"{STUB_RULE_ID}: {name} bypasses a runtime constructor; instantiate the real class",
                )
            )
    return violations


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
