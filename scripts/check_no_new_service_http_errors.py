#!/usr/bin/env python3
"""Block net-new HTTP exceptions raised or defined in service and core code.

Services and core raise domain exceptions; controllers translate them into HTTP
errors at the boundary (see api/AGENTS.md). An HTTP exception raised inside a
service is also invisible to the API error contract lint when reached through
dynamic dispatch, so its status and code go undocumented.

Names are resolved through each file's imports, so aliases such as
``from werkzeug.exceptions import NotFound as Missing`` are caught, and project
classes count as HTTP exceptions when they inherit from one anywhere under
``api/``.
"""

from __future__ import annotations

import ast
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import TypeGuard

from ast_grep_guard import (
    Match,
    collect_diff_text,
    collect_hunk_violations,
    git_output,
    has_reasoned_guard_ignore,
    load_file_versions,
    parse_args,
    parse_changed_hunks,
    print_violations,
)

RULE_ID = "no-new-service-http-error"
API_ROOT = Path("api")
SCANNED_ROOTS = (API_ROOT / "services", API_ROOT / "core")
VIOLATION_MESSAGE = (
    "no-new-service-http-error net-new HTTP exception in service or core code"
)

WERKZEUG_EXCEPTIONS = "werkzeug.exceptions"
HTTP_BASES = frozenset({"libs.exception.BaseHTTPException"})
ABORT_FUNCTIONS = frozenset(
    {"flask.abort", "flask_restx.abort", f"{WERKZEUG_EXCEPTIONS}.abort"}
)
# Bindings followed through re-exports before giving up on a name.
MAX_ALIAS_HOPS = 16


def is_service_python_source_path(path: str) -> bool:
    source_path = Path(path)
    return source_path.suffix in {".py", ".pyi"} and any(
        source_path.is_relative_to(root) for root in SCANNED_ROOTS
    )


def module_name(path: Path) -> str:
    parts = list(path.relative_to(API_ROOT).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


def import_bindings(tree: ast.Module, module: str, *, is_package: bool) -> dict[str, str]:
    """Map each name a module imports to the dotted name it refers to."""
    package = module if is_package else module.rpartition(".")[0]
    bindings: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    bindings[alias.asname] = alias.name
                else:
                    top = alias.name.split(".", 1)[0]
                    bindings[top] = top
        elif isinstance(node, ast.ImportFrom):
            source = node.module or ""
            if node.level:
                anchor = package.split(".") if package else []
                anchor = anchor[: len(anchor) - (node.level - 1)] if node.level > 1 else anchor
                source = ".".join([*anchor, *([source] if source else [])])
            for alias in node.names:
                if alias.name != "*":
                    bindings[alias.asname or alias.name] = f"{source}.{alias.name}"
    return bindings


def dotted(node: ast.expr, bindings: dict[str, str], module: str) -> str | None:
    if isinstance(node, ast.Call):
        return dotted(node.func, bindings, module)
    if isinstance(node, ast.Name):
        return bindings.get(node.id, f"{module}.{node.id}")
    if isinstance(node, ast.Attribute):
        owner = dotted(node.value, bindings, module)
        return f"{owner}.{node.attr}" if owner else None
    return None


class ModuleSource:
    def __init__(self, module: str, tree: ast.Module, *, is_package: bool) -> None:
        self.module = module
        self.tree = tree
        self.bindings = import_bindings(tree, module, is_package=is_package)
        self.class_bases = {
            node.name: [dotted(base, self.bindings, module) for base in node.bases]
            for node in tree.body
            if isinstance(node, ast.ClassDef)
        }

    def resolve(self, node: ast.expr) -> str | None:
        return dotted(node, self.bindings, self.module)


def parse_module(source: str, path: Path) -> ModuleSource | None:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return None
    return ModuleSource(
        module_name(path), tree, is_package=path.stem == "__init__"
    )


class HttpErrorIndex:
    """HTTP exception classes defined anywhere under ``api/``."""

    def __init__(self, modules: Iterable[ModuleSource]) -> None:
        self.modules = {module.module: module for module in modules}
        self._http: dict[str, bool] = {}

    def canonical(self, name: str) -> str:
        for _ in range(MAX_ALIAS_HOPS):
            owner, _, attr = name.rpartition(".")
            module = self.modules.get(owner)
            if module is None or attr in module.class_bases or attr not in module.bindings:
                return name
            name = module.bindings[attr]
        return name

    def is_http_class(self, name: str | None, extra: ModuleSource | None = None) -> bool:
        if name is None:
            return False
        name = self.canonical(name)
        owner, _, attr = name.rpartition(".")
        if owner == WERKZEUG_EXCEPTIONS:
            return attr[:1].isupper() and attr != "Aborter"
        if name in HTTP_BASES:
            return True
        source = extra if extra is not None and extra.module == owner else self.modules.get(owner)
        if source is None or attr not in source.class_bases:
            return False
        key = f"{id(source)}:{name}"
        if key not in self._http:
            self._http[key] = False  # break inheritance cycles
            self._http[key] = any(self.is_http_class(base, extra) for base in source.class_bases[attr])
        return self._http[key]


def tracked_api_modules() -> list[ModuleSource]:
    modules: list[ModuleSource] = []
    for line in git_output("ls-files", "--", f"{API_ROOT}/*.py").splitlines():
        path = Path(line)
        if not path.is_file():
            continue
        module = parse_module(path.read_text(encoding="utf-8"), path)
        if module is not None:
            modules.append(module)
    return modules


def is_http_error_node(
    node: ast.AST, module: ModuleSource, index: HttpErrorIndex
) -> TypeGuard[ast.Raise | ast.Call | ast.ClassDef]:
    if isinstance(node, ast.Raise):
        return node.exc is not None and index.is_http_class(module.resolve(node.exc), module)
    if isinstance(node, ast.Call):
        return module.resolve(node.func) in ABORT_FUNCTIONS
    if isinstance(node, ast.ClassDef):
        return node.col_offset == 0 and index.is_http_class(f"{module.module}.{node.name}", module)
    return False


def http_error_matches(source: str, path: Path, index: HttpErrorIndex) -> list[Match]:
    module = parse_module(source, path)
    if module is None:
        return []
    lines = source.splitlines()
    found = [node for node in ast.walk(module.tree) if is_http_error_node(node, module, index)]
    matches = []
    for node in sorted(found, key=lambda item: (item.lineno, item.col_offset)):
        source_line = lines[node.lineno - 1]
        matches.append(
            Match(
                line_number=node.lineno,
                source_line=source_line,
                text=ast.get_source_segment(source, node) or source_line,
                meta_variables={},
            )
        )
    return matches


def reportable(matches: list[Match]) -> list[Match]:
    return [match for match in matches if not has_reasoned_guard_ignore(match.source_line, RULE_ID)]


def main() -> int:
    try:
        args = parse_args(__doc__)
        changed_hunks = parse_changed_hunks(collect_diff_text(args))
        scanned = {path: hunks for path, hunks in changed_hunks.items() if is_service_python_source_path(path)}
        if not scanned:
            return 0
        index = HttpErrorIndex(tracked_api_modules())
        violations = []
        for path, hunks in scanned.items():
            old_source, new_source = load_file_versions(path, args)
            old_matches = reportable(http_error_matches(old_source, Path(path), index))
            new_matches = reportable(http_error_matches(new_source, Path(path), index))
            for hunk in hunks:
                violations.extend(
                    collect_hunk_violations(
                        path,
                        old_matches,
                        new_matches,
                        hunk,
                        is_reportable_match=lambda _match: True,
                        violation_message=VIOLATION_MESSAGE,
                    )
                )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    if violations:
        print_violations(sorted(violations, key=lambda item: (item.path, item.line_number)))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
