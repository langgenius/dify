#!/usr/bin/env python3
"""Block net-new HTTP exceptions raised or defined in service and core code.

Services and core raise domain exceptions; controllers translate them into HTTP
errors at the boundary (see api/AGENTS.md). An HTTP exception raised inside a
service is also invisible to the API error contract lint when reached through
dynamic dispatch, so its status and code go undocumented.

The base and the checked revision are each analysed against their own copy of
``api/``: names resolve through the imports and definitions of their lexical
scope, and project classes count as HTTP exceptions when they inherit from one.
A file passes when every HTTP exception site in it already existed in the base
under the same scope and resolved exception, so an import or base-class change
that turns an untouched ``raise`` into an HTTP error is caught too.
"""

from __future__ import annotations

import argparse
import ast
import sys
from collections import Counter
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from ast_grep_guard import (
    Violation,
    git_output,
    has_reasoned_guard_ignore,
    parse_args,
    print_violations,
)

RULE_ID = "no-new-service-http-error"
API_ROOT = Path("api")
SCANNED_ROOTS = (API_ROOT / "services", API_ROOT / "core")
VIOLATION_MESSAGE = "no-new-service-http-error net-new HTTP exception in service or core code"

WERKZEUG_EXCEPTIONS = "werkzeug.exceptions"
HTTP_BASES = frozenset({"libs.exception.BaseHTTPException"})
ABORT_FUNCTIONS = frozenset({"flask.abort", "flask_restx.abort", f"{WERKZEUG_EXCEPTIONS}.abort"})

# A name binds either to a dotted target or to an expression evaluated in its scope.
Binding = str | ast.expr
SourceReader = Callable[[str], str | None]
ModuleLoader = Callable[[], "ModuleSource | None"]


def is_api_python_path(path: str) -> bool:
    source_path = Path(path)
    return source_path.suffix in {".py", ".pyi"} and source_path.is_relative_to(API_ROOT)


def is_service_python_source_path(path: str) -> bool:
    source_path = Path(path)
    return source_path.suffix in {".py", ".pyi"} and any(source_path.is_relative_to(root) for root in SCANNED_ROOTS)


def module_name(path: Path) -> str:
    parts = list(path.relative_to(API_ROOT).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts)


@dataclass(eq=False)
class Scope:
    qualname: str
    parent: Scope | None
    is_class: bool = False
    names: dict[str, list[Binding]] = field(default_factory=dict)
    star_imports: list[str] = field(default_factory=list)

    def bind(self, name: str, binding: Binding) -> None:
        self.names.setdefault(name, []).append(binding)

    def child(self, name: str, *, is_class: bool = False) -> Scope:
        qualname = f"{self.qualname}.{name}" if self.qualname else name
        return Scope(qualname, self, is_class=is_class)


@dataclass(frozen=True, eq=False)
class Site:
    node: ast.Raise | ast.Call | ast.ClassDef
    scope: Scope


class ModuleSource:
    """A module's lexical scopes, the classes it defines and its candidate sites."""

    def __init__(self, module: str, source: str, *, is_package: bool) -> None:
        self.module = module
        self.lines = source.splitlines()
        self.package = module if is_package else module.rpartition(".")[0]
        self.scope = Scope("", None)
        self.classes: dict[str, tuple[list[ast.expr], Scope]] = {}
        self.sites: list[Site] = []
        for node in ast.parse(source).body:
            self._visit(node, self.scope)

    def _import_source(self, node: ast.ImportFrom) -> str:
        if not node.level:
            return node.module or ""
        anchor = self.package.split(".") if self.package else []
        if node.level > 1:
            anchor = anchor[: len(anchor) - (node.level - 1)]
        return ".".join([*anchor, *([node.module] if node.module else [])])

    def _visit(self, node: ast.AST, scope: Scope) -> None:
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.asname:
                    scope.bind(alias.asname, alias.name)
                else:
                    top = alias.name.split(".", 1)[0]
                    scope.bind(top, top)
            return
        if isinstance(node, ast.ImportFrom):
            source = self._import_source(node)
            for alias in node.names:
                if alias.name == "*":
                    scope.star_imports.append(source)
                else:
                    scope.bind(alias.asname or alias.name, f"{source}.{alias.name}")
            return
        if isinstance(node, ast.ClassDef):
            inner = scope.child(node.name, is_class=True)
            self.classes[inner.qualname] = (node.bases, scope)
            scope.bind(node.name, f"{self.module}.{inner.qualname}")
            self.sites.append(Site(node, inner))
            for child in [*node.decorator_list, *node.bases, *node.keywords]:
                self._visit(child, scope)
            for child in node.body:
                self._visit(child, inner)
            return
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            inner = scope.child(node.name)
            scope.bind(node.name, f"{self.module}.{inner.qualname}")
            for child in [*node.decorator_list, node.args]:
                self._visit(child, scope)
            for child in node.body:
                self._visit(child, inner)
            return
        if isinstance(node, ast.Assign | ast.AnnAssign) and isinstance(node.value, ast.Name | ast.Attribute):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for target in targets:
                if isinstance(target, ast.Name):
                    scope.bind(target.id, node.value)
        if isinstance(node, ast.Raise | ast.Call):
            self.sites.append(Site(node, scope))
        for child in ast.iter_child_nodes(node):
            self._visit(child, scope)

    def resolve(self, node: ast.expr, scope: Scope, seen: frozenset[int] = frozenset()) -> set[str]:
        if isinstance(node, ast.Call):
            return self.resolve(node.func, scope, seen)
        if isinstance(node, ast.Name):
            return self.resolve_name(node.id, scope, seen)
        if isinstance(node, ast.Attribute):
            return {f"{owner}.{node.attr}" for owner in self.resolve(node.value, scope, seen)}
        return set()

    def resolve_name(self, name: str, scope: Scope, seen: frozenset[int] = frozenset()) -> set[str]:
        """Every target ``name`` can be bound to in ``scope``, following Python's scoping rules."""
        current: Scope | None = scope
        while current is not None:
            # Class bodies do not enclose the functions defined in them.
            if (current is scope or not current.is_class) and name in current.names:
                targets: set[str] = set()
                for binding in current.names[name]:
                    if isinstance(binding, str):
                        targets.add(binding)
                    elif id(binding) not in seen:
                        targets |= self.resolve(binding, current, seen | {id(binding)})
                return targets
            if current.parent is None:
                stars = {f"{star}.{name}" for star in current.star_imports}
                return stars | {f"builtins.{name}"}
            current = current.parent
        return set()


class HttpErrorIndex:
    """HTTP exception classes of one revision of ``api/``."""

    def __init__(self, modules: dict[str, ModuleLoader]) -> None:
        self._loaders = modules
        self._modules: dict[str, ModuleSource | None] = {}
        self._http: dict[str, bool] = {}

    def module(self, name: str) -> ModuleSource | None:
        if name not in self._modules:
            load = self._loaders.get(name)
            self._modules[name] = load() if load else None
        return self._modules[name]

    def _split(self, name: str) -> tuple[ModuleSource, str] | None:
        parts = name.split(".")
        for size in range(len(parts) - 1, 0, -1):
            module = self.module(".".join(parts[:size]))
            if module is not None:
                return module, ".".join(parts[size:])
        return None

    def is_http_class(self, name: str) -> bool:
        if name not in self._http:
            self._http[name] = False  # break inheritance and alias cycles
            self._http[name] = self._is_http_class(name)
        return self._http[name]

    def _is_http_class(self, name: str) -> bool:
        owner, _, attr = name.rpartition(".")
        if owner == WERKZEUG_EXCEPTIONS:
            return attr[:1].isupper() and attr != "Aborter"
        if name in HTTP_BASES:
            return True
        found = self._split(name)
        if found is None:
            return False
        module, path = found
        if path in module.classes:
            bases, scope = module.classes[path]
            return any(self.is_http_class(target) for base in bases for target in module.resolve(base, scope))
        head, _, tail = path.partition(".")
        if head not in module.scope.names:
            return False
        return any(
            self.is_http_class(f"{target}.{tail}" if tail else target)
            for target in module.resolve_name(head, module.scope)
        )


@dataclass(frozen=True)
class Match:
    key: tuple[str, ...]
    line_number: int


def site_key(site: Site, module: ModuleSource, index: HttpErrorIndex) -> tuple[str, ...] | None:
    node = site.node
    if isinstance(node, ast.ClassDef):
        if index.is_http_class(f"{module.module}.{site.scope.qualname}"):
            return ("class", site.scope.qualname)
        return None
    if isinstance(node, ast.Call):
        if module.resolve(node.func, site.scope) & ABORT_FUNCTIONS:
            return ("abort", site.scope.qualname)
        return None
    if node.exc is None:
        return None
    targets = sorted(target for target in module.resolve(node.exc, site.scope) if index.is_http_class(target))
    return ("raise", site.scope.qualname, *targets) if targets else None


def http_error_matches(module: ModuleSource, index: HttpErrorIndex) -> Iterator[Match]:
    for site in module.sites:
        key = site_key(site, module, index)
        if key is None:
            continue
        line_number = site.node.lineno
        if not has_reasoned_guard_ignore(module.lines[line_number - 1], RULE_ID):
            yield Match(key, line_number)


def net_new(old: list[Match], new: list[Match]) -> list[Match]:
    """Sites beyond what the base had for the same scope and resolved exception."""
    remaining = Counter(match.key for match in old)
    surplus: list[Match] = []
    for match in sorted(new, key=lambda item: item.line_number):
        if remaining[match.key] > 0:
            remaining[match.key] -= 1
        else:
            surplus.append(match)
    return surplus


def changed_api_paths(args: argparse.Namespace) -> set[str]:
    revision = ["--cached"] if args.staged else [f"{args.base_rev}..HEAD"]
    output = git_output("diff", "--name-only", "--no-renames", "--no-ext-diff", *revision)
    return {path for path in output.splitlines() if is_api_python_path(path)}


def revision_readers(args: argparse.Namespace) -> tuple[SourceReader, SourceReader]:
    def show(spec: str) -> str | None:
        return git_output("show", spec, allow_missing=True) or None

    if args.staged:
        return (lambda path: show(f"HEAD:{path}")), (lambda path: show(f":{path}"))
    return (
        (lambda path: show(f"{args.base_rev}:{path}")),
        (lambda path: show(f"HEAD:{path}")),
    )


def parse_module(path: str, source: str | None) -> ModuleSource | None:
    if source is None:
        return None
    source_path = Path(path)
    try:
        return ModuleSource(module_name(source_path), source, is_package=source_path.stem == "__init__")
    except SyntaxError:
        return None


def revision_modules(
    unchanged: dict[str, ModuleLoader], changed: set[str], read: SourceReader
) -> dict[str, ModuleLoader]:
    """Loaders by path: unchanged files are shared, changed ones read from ``read``."""
    loaders = dict(unchanged)
    for path in changed:
        cache: list[ModuleSource | None] = []

        def load(path: str = path, cache: list[ModuleSource | None] = cache) -> ModuleSource | None:
            if not cache:
                cache.append(parse_module(path, read(path)))
            return cache[0]

        loaders[path] = load
    return loaders


def disk_loader(path: str) -> ModuleLoader:
    cache: list[ModuleSource | None] = []

    def load() -> ModuleSource | None:
        if not cache:
            cache.append(parse_module(path, Path(path).read_text(encoding="utf-8")))
        return cache[0]

    return load


def find_violations(args: argparse.Namespace) -> list[Violation]:
    changed = changed_api_paths(args)
    if not changed:
        return []
    tracked = git_output("ls-files", "--", f"{API_ROOT}/*.py").splitlines()
    unchanged = {path: disk_loader(path) for path in tracked if path not in changed and Path(path).is_file()}
    read_old, read_new = revision_readers(args)
    old_files = revision_modules(unchanged, changed, read_old)
    new_files = revision_modules(unchanged, changed, read_new)
    old_index = HttpErrorIndex({module_name(Path(p)): load for p, load in old_files.items()})
    new_index = HttpErrorIndex({module_name(Path(p)): load for p, load in new_files.items()})

    # A change anywhere under api/ can turn an untouched service raise into an
    # HTTP error, so every service and core file is compared.
    violations: list[Violation] = []
    for path in sorted(new_files):
        if not is_service_python_source_path(path):
            continue
        new_module = new_files[path]()
        if new_module is None:
            continue
        old_module = old_files[path]()
        old_matches = list(http_error_matches(old_module, old_index)) if old_module else []
        new_matches = list(http_error_matches(new_module, new_index))
        violations.extend(
            Violation(path=path, line_number=match.line_number, message=VIOLATION_MESSAGE)
            for match in net_new(old_matches, new_matches)
        )
    return violations


def main() -> int:
    try:
        violations = find_violations(parse_args(__doc__))
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if violations:
        print_violations(violations)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
