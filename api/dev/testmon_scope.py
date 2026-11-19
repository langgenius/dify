"""Decide whether a pull request may let pytest-testmon select API tests.

testmon links a test to the code that runs while the test runs. Code that runs on import, such as
module constants, class bodies, decorators and default arguments, is linked to no test, so a test
that only reads it is not selected when it changes. testmon also ignores every input that is not
Python code. Selection is therefore allowed only when each changed path is outside the backend, is
a test module, or is an existing API module whose import-time code stayed the same.

Prints why the full suites must run, or nothing when testmon may select tests.
"""

from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from collections.abc import Callable
from pathlib import PurePosixPath
from typing import override

# Top-level directories that API tests never read.
UNRELATED_PREFIXES = ("cli/", "docs/", "e2e/", "images/", "packages/", "sdks/", "skills/", "web/")
# Lint and type-check settings that pytest does not load.
UNRELATED_PATHS = frozenset({"api/.importlinter", "oxlint-suppressions.json"})
UNRELATED_NAMES = frozenset({"pyrefly.toml"})


class _StripFunctionBodies(ast.NodeTransformer):
    """Keep what runs on import: signatures, decorators and defaults stay; bodies run later."""

    @override
    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.FunctionDef:
        node.body = [ast.Pass()]
        return node

    @override
    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> ast.AsyncFunctionDef:
        node.body = [ast.Pass()]
        return node


def _drop_docstring(body: list[ast.stmt]) -> None:
    if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
        if isinstance(body[0].value.value, str):
            del body[0]


def import_time_code(source: str) -> str:
    """Return a comparable form of the code that runs when a module is imported."""
    tree = _StripFunctionBodies().visit(ast.parse(source))
    _drop_docstring(tree.body)
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            _drop_docstring(node.body)
    return ast.dump(tree)


def _is_test_module(path: str) -> bool:
    # testmon links every test in a test module to that module's import-time code.
    name = PurePosixPath(path).name
    return name.startswith("test_") or name.endswith("_test.py")


def blocking_reason(status: str, path: str, read: Callable[[str, str], str]) -> str | None:
    """Explain why one changed path needs the full suites, or return None.

    `status` is a `git diff --name-status --no-renames` letter, and `read(side, path)` returns the
    file at the `base` or `head` side of the diff.
    """
    if (
        path.endswith(".md")
        or path.startswith(UNRELATED_PREFIXES)
        or path in UNRELATED_PATHS
        or PurePosixPath(path).name in UNRELATED_NAMES
    ):
        return None
    if not (path.startswith("api/") and path.endswith(".py")):
        return f"testmon does not track `{path}`"
    if status == "A" or _is_test_module(path):
        return None
    if status != "M":
        # A test that only imports a removed module would fail without being selected.
        return f"`{path}` was removed or changed type"
    try:
        changed = import_time_code(read("base", path)) != import_time_code(read("head", path))
    except SyntaxError:
        return f"`{path}` could not be parsed"
    if changed:
        return f"import-time code in `{path}` changed, which testmon does not link to tests"
    return None


def changed_paths(base: str, head: str) -> list[tuple[str, str]]:
    # Without rename detection, a moved file also reports its old path as deleted.
    output = subprocess.run(
        ["git", "diff", "--name-status", "--no-renames", base, head],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    changes: list[tuple[str, str]] = []
    for line in output.splitlines():
        status, path = line.split("\t", 1)
        changes.append((status[0], path))
    return changes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base", help="Base revision, such as the pull request merge commit's first parent.")
    parser.add_argument("head", help="Revision under test.")
    args = parser.parse_args()
    revisions = {"base": args.base, "head": args.head}

    def read(side: str, path: str) -> str:
        return subprocess.run(
            ["git", "show", f"{revisions[side]}:{path}"], check=True, capture_output=True, text=True
        ).stdout

    for status, path in changed_paths(args.base, args.head):
        if reason := blocking_reason(status, path, read):
            sys.stdout.write(reason + "\n")
            return


if __name__ == "__main__":
    main()
