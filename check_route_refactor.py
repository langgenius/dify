#!/usr/bin/env python3
"""Validate that refactored Flask resources still register routes via decorators.

This script compares the current working tree against a base revision (default
``origin/main``) and ensures that every ``api.add_resource`` registration removed
from the base code now has an equivalent ``@*.route(...)`` decorator on the
corresponding class in the new code. It relies on ``ast-grep`` to accurately
locate the removed ``add_resource`` calls and uses the Python ``ast`` module to
inspect decorators in the updated code.
"""
from __future__ import annotations

import argparse
import ast
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Iterator, Mapping, Sequence


@dataclass(frozen=True)
class RouteBinding:
    """Represents a mapping between a view class and a route string."""

    view: str
    route: str


@dataclass(frozen=True)
class VerificationIssue:
    """Keeps track of problems discovered during verification."""

    file_path: Path
    view: str
    route: str
    reason: str


@dataclass(frozen=True)
class AnalysisArtifacts:
    """Container for per-file diagnostic data used for debugging."""

    removed: set[RouteBinding]
    remaining: set[RouteBinding]
    new_routes: Mapping[str, set[str]]
    unresolved_removed: list[str]
    unresolved_added: list[str]


class RouteDecoratorCollector(ast.NodeVisitor):
    """Collect ``@*.route`` decorators from a Python source string."""

    def __init__(self, source: str) -> None:
        self._source = source
        self.routes: dict[str, set[str]] = {}
        self.unresolved: list[str] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802 (snake_case)
        class_routes = self.routes.setdefault(node.name, set())
        for decorator in node.decorator_list:
            for route, raw in self._extract_routes(decorator):
                if route is None:
                    self.unresolved.append(f"{node.name}: {raw}")
                    continue
                class_routes.add(route)
        self.generic_visit(node)

    def _extract_routes(self, decorator: ast.expr) -> Iterator[tuple[str | None, str]]:
        if not isinstance(decorator, ast.Call):
            return iter(())
        func = decorator.func
        if not (isinstance(func, ast.Attribute) and func.attr == "route"):
            return iter(())
        yield from (
            item for arg in decorator.args for item in self._extract_literal_strings(arg)
        )

    def _extract_literal_strings(self, expr: ast.expr) -> Iterator[tuple[str | None, str]]:
        segment = ast.get_source_segment(self._source, expr) or ast.unparse(expr)
        if isinstance(expr, ast.Constant) and isinstance(expr.value, str):
            yield expr.value, segment
            return
        if isinstance(expr, ast.Tuple):
            for element in expr.elts:
                yield from self._extract_literal_strings(element)
            return
        yield None, segment


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base",
        default="origin/main",
        help="Git revision to compare against (default: %(default)s)",
    )
    parser.add_argument(
        "--head",
        default="HEAD",
        help="Git revision to treat as the tip (default: %(default)s)",
    )
    parser.add_argument(
        "paths",
        nargs="*",
        help="Optional explicit Python files to check. When omitted, changes are derived from git diff.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print detailed diagnostics for each file.",
    )
    return parser.parse_args(argv)


def run_command(command: Sequence[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        capture_output=True,
        text=True,
        cwd=None if cwd is None else str(cwd),
    )


def get_changed_python_files(base: str, head: str, explicit: Sequence[str] | None) -> list[Path]:
    if explicit:
        return [Path(path) for path in explicit if path.endswith(".py")]
    diff_cmd = ["git", "diff", f"{base}...{head}", "--name-only"]
    result = run_command(diff_cmd)
    return [Path(line) for line in result.stdout.splitlines() if line.endswith(".py")]


def run_ast_grep(pattern: str, content: str, *, selector: str | None = None) -> list[dict]:
    with NamedTemporaryFile(mode="w", suffix=".py", delete=False) as temp_file:
        temp_file.write(content)
        temp_path = Path(temp_file.name)
    try:
        command = ["ast-grep", "run", "--lang", "python", "-p", pattern, "--json=stream"]
        if selector:
            command += ["--selector", selector]
        command.append(str(temp_path))
        output = run_command(command)
        matches = [json.loads(line) for line in output.stdout.splitlines() if line.strip()]
        return matches
    finally:
        temp_path.unlink(missing_ok=True)


def find_add_resource_bindings(content: str) -> tuple[set[RouteBinding], list[str]]:
    pattern = "api.add_resource($VIEW, $ROUTE)"
    matches = run_ast_grep(pattern, content)
    bindings: set[RouteBinding] = set()
    unresolved: list[str] = []
    for match in matches:
        snippet = match["text"]
        view_name, routes, unknown = parse_add_resource_snippet(snippet)
        for route in routes:
            bindings.add(RouteBinding(view=view_name, route=route))
        unresolved.extend(unknown)
    return bindings, unresolved


def parse_add_resource_snippet(snippet: str) -> tuple[str, list[str], list[str]]:
    module = ast.parse(snippet.strip())
    if not module.body or not isinstance(module.body[0], ast.Expr):
        raise ValueError("Unexpected structure in add_resource snippet")
    call = module.body[0].value
    if not isinstance(call, ast.Call):
        raise ValueError("Snippet does not contain a call expression")
    if not call.args:
        raise ValueError("add_resource call missing view argument")
    view_expr = call.args[0]
    view_name = ast.get_source_segment(snippet, view_expr) or ast.unparse(view_expr)
    routes: list[str] = []
    unresolved: list[str] = []
    for arg in call.args[1:]:
        value = evaluate_route_literal(arg)
        if value is None:
            unresolved.append(ast.get_source_segment(snippet, arg) or ast.unparse(arg))
            continue
        routes.append(value)
    return view_name.split(".")[-1], routes, unresolved


def evaluate_route_literal(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Tuple):
        parts: list[str] = []
        for element in node.elts:
            value = evaluate_route_literal(element)
            if value is None:
                return None
            parts.append(value)
        return "".join(parts)
    try:
        literal = ast.literal_eval(node)
    except Exception:  # noqa: BLE001 - we intentionally surface None for complex values
        return None
    return literal if isinstance(literal, str) else None


def collect_route_decorators(content: str) -> tuple[dict[str, set[str]], list[str]]:
    collector = RouteDecoratorCollector(content)
    collector.visit(ast.parse(content))
    return collector.routes, collector.unresolved


def load_file_from_git(revision: str, path: Path) -> str:
    command = ["git", "show", f"{revision}:{path.as_posix()}"]
    result = run_command(command)
    return result.stdout


def read_worktree_file(path: Path) -> str:
    return path.read_text()


def analyze_file(path: Path, base_rev: str) -> AnalysisArtifacts:
    try:
        base_content = load_file_from_git(base_rev, path)
    except subprocess.CalledProcessError as err:
        raise FileNotFoundError(f"Unable to load {path} from {base_rev}") from err
    new_path = Path(path)
    if not new_path.exists():
        raise FileNotFoundError(f"File {path} no longer exists in working tree")
    current_content = read_worktree_file(new_path)
    old_bindings, unresolved_old = find_add_resource_bindings(base_content)
    new_bindings, _ = find_add_resource_bindings(current_content)
    removed_bindings = old_bindings.difference(new_bindings)
    new_routes, unresolved_new = collect_route_decorators(current_content)
    return AnalysisArtifacts(
        removed=removed_bindings,
        remaining=new_bindings,
        new_routes=new_routes,
        unresolved_removed=unresolved_old,
        unresolved_added=unresolved_new,
    )


def verify_routes(artifacts: AnalysisArtifacts, path: Path) -> list[VerificationIssue]:
    issues: list[VerificationIssue] = []
    route_map = artifacts.new_routes
    for binding in sorted(artifacts.removed, key=lambda item: (item.view, item.route)):
        view_routes = route_map.get(binding.view, set())
        if binding.route not in view_routes:
            issues.append(
                VerificationIssue(
                    file_path=path,
                    view=binding.view,
                    route=binding.route,
                    reason="missing matching @*.route decorator",
                )
            )
    for raw in artifacts.unresolved_removed:
        issues.append(
            VerificationIssue(
                file_path=path,
                view="<unknown>",
                route=raw,
                reason="could not resolve literal route removed from add_resource",
            )
        )
    for raw in artifacts.unresolved_added:
        issues.append(
            VerificationIssue(
                file_path=path,
                view="<unknown>",
                route=raw,
                reason="could not resolve literal route in decorator",
            )
        )
    return issues


def describe_artifacts(artifacts: AnalysisArtifacts, path: Path) -> str:
    lines = [f"File: {path}"]
    if artifacts.removed:
        lines.append("  Removed add_resource bindings:")
        for binding in sorted(artifacts.removed, key=lambda item: (item.view, item.route)):
            lines.append(f"    - {binding.view}: {binding.route}")
    if artifacts.remaining:
        lines.append("  add_resource still present (ignored):")
        for binding in sorted(artifacts.remaining, key=lambda item: (item.view, item.route)):
            lines.append(f"    - {binding.view}: {binding.route}")
    if artifacts.new_routes:
        lines.append("  Decorator routes:")
        for view, routes in sorted(artifacts.new_routes.items()):
            formatted = ", ".join(sorted(routes)) or "<none>"
            lines.append(f"    - {view}: {formatted}")
    if artifacts.unresolved_removed:
        lines.append("  Unresolved add_resource literals:")
        for raw in artifacts.unresolved_removed:
            lines.append(f"    - {raw}")
    if artifacts.unresolved_added:
        lines.append("  Unresolved decorator literals:")
        for raw in artifacts.unresolved_added:
            lines.append(f"    - {raw}")
    return "\n".join(lines)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    paths = get_changed_python_files(args.base, args.head, args.paths)
    if not paths:
        print("No Python files to inspect.")
        return 0
    all_issues: list[VerificationIssue] = []
    for path in paths:
        try:
            artifacts = analyze_file(path, args.base)
        except FileNotFoundError as err:
            print(err, file=sys.stderr)
            return 1
        if args.verbose:
            print(describe_artifacts(artifacts, path))
        all_issues.extend(verify_routes(artifacts, path))
    if all_issues:
        print("Detected potential route regressions:")
        for issue in all_issues:
            print(
                f"- {issue.file_path}: view={issue.view} route={issue.route} :: {issue.reason}",
            )
        return 1
    print("All removed api.add_resource bindings have matching @*.route decorators.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())