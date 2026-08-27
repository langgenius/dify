"""Arity guard for the ``__handler__`` test seam.

``@endpoint`` is annotated ``Callable[[Callable[..., Any]], Callable[..., Any]]``, so a
decorated view is ``Callable[..., Any]`` and ``.__handler__`` carries no signature a
static checker could bind a call against — a probe of three deliberate mis-calls produced
zero errors. This module supplies that check dynamically: it parses every
``<var>.<method>.__handler__(...)`` call in the openapi test trees, resolves the receiver
to its imported class, and binds the call site's real positional count and keyword names
against ``inspect.signature`` of the live handler.

The bookkeeping below is the point of the guard, not decoration. A checker that skips the
call sites it cannot resolve reads as coverage while covering nothing, so every textual
``__handler__`` occurrence must land in exactly one accounted bucket, and anything the
checker cannot bind fails with ``file:line`` instead of being passed over. The other half
of that bargain is not failing correct code: a guard that cries wolf is a guard someone
weakens, so ambiguity is resolved by refusing to guess, never by inventing a fallback.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import io
import itertools
import operator
import tokenize
from collections import Counter
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import pytest

_TESTS_ROOT = Path(__file__).resolve().parents[3]

_SCAN_TREES = (
    "unit_tests/controllers/openapi",
    "test_containers_integration_tests/controllers/openapi",
)

# Sites per file, pinned exactly. Per file rather than per tree because a tree total lets
# one file's coverage being deleted net out against sites added in another.
_EXPECTED_SITES: dict[str, int] = {
    "unit_tests/controllers/openapi/test_account.py": 2,
    "unit_tests/controllers/openapi/test_app_dsl.py": 1,
    "unit_tests/controllers/openapi/test_app_run_streaming.py": 2,
    "unit_tests/controllers/openapi/test_apps_permitted_external_query.py": 1,
    "unit_tests/controllers/openapi/test_endpoint.py": 1,
    "unit_tests/controllers/openapi/test_human_input_form.py": 6,
    "unit_tests/controllers/openapi/test_workflow_events_openapi.py": 8,
    "unit_tests/controllers/openapi/test_workspaces_members.py": 16,
    "test_containers_integration_tests/controllers/openapi/test_account.py": 2,
    "test_containers_integration_tests/controllers/openapi/test_account_sessions.py": 5,
    "test_containers_integration_tests/controllers/openapi/test_app_dsl.py": 7,
    "test_containers_integration_tests/controllers/openapi/test_app_run.py": 1,
    "test_containers_integration_tests/controllers/openapi/test_apps.py": 6,
    "test_containers_integration_tests/controllers/openapi/test_files.py": 1,
    "test_containers_integration_tests/controllers/openapi/test_workspaces.py": 7,
}

_SEAM = "__handler__"
_SENTINEL = object()

_REASON_STAR_ARGS = "`*args` at the call site hides the real arity"
_REASON_STAR_KWARGS = "`**kwargs` at the call site hides the real arity"
_REASON_NOT_A_CALL = f"`{_SEAM}` is read, not called"
_REASON_DYNAMIC = f"reached dynamically — write it as `<var>.<method>.{_SEAM}(...)` so the call can be bound"
_REASON_SHADOWED = "is rebound by a statement that does not name a class"

# `getattr(view, "__handler__")` would otherwise be bucketed as a string, so the
# conservation sum balances while the call site itself disappears.
_ATTRIBUTE_BUILTINS = frozenset({"getattr", "setattr", "hasattr"})

# The only way a seam occurrence escapes the bind check, keyed on
# (file, receiver, reason, enclosing statement) and pinned by count. The statement anchor
# is what stops the slot being consumed by a different shape at the same receiver — an
# alias-then-call would keep file, receiver and reason identical. Anything absent from
# this table and unbindable is a reported failure, never a silent skip.
_EXEMPT_SITES: dict[tuple[str, str, str, str], int] = {
    (
        "unit_tests/controllers/openapi/test_endpoint.py",
        "view",
        _REASON_NOT_A_CALL,
        "assert view.__handler__ is not None",
    ): 1,
}

_STRING_TOKENS = frozenset({tokenize.STRING, tokenize.COMMENT, tokenize.FSTRING_MIDDLE})

# {argname: value node} for one @pytest.mark.parametrize case; empty for an unparametrized call.
Case = dict[str, ast.expr]
# (scope kind, defining node, {name: [(first line the binding is in effect, class name or
# None when the binding form does not name one)]})
Scope = tuple[str, ast.AST, dict[str, list[tuple[int, str | None]]]]


class _UnresolvableError(Exception):
    """A seam occurrence the checker cannot bind. Never swallowed — it either matches a
    pinned exemption or becomes a reported failure."""


@dataclass
class Report:
    textual: int = 0
    in_strings: int = 0
    bound: int = 0
    exempt: Counter[tuple[str, str, str, str]] = field(default_factory=Counter)
    failures: list[str] = field(default_factory=list)
    per_file: Counter[str] = field(default_factory=Counter)

    @property
    def unresolved(self) -> int:
        return len(self.failures)

    @property
    def sites(self) -> int:
        return self.bound + sum(self.exempt.values()) + self.unresolved


def _instantiated_class(value: ast.expr | None) -> str | None:
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Name):
        return value.func.id
    return None


class _Scan(ast.NodeVisitor):
    """Collects every ``__handler__`` attribute node with the scopes and the statement
    enclosing it.

    Bindings are recorded per function rather than per module because a module-wide name
    map is wrong here: `api` is rebound to a different class in nearly every test of a
    file, so a module-wide map resolves a handful of sites and mis-resolves the rest.
    Class bodies are recorded but never consulted from a nested method — class-level names
    are not in a method's lookup chain.

    Every form that binds a name is recorded, not just ``=``. A `for`, `with`, walrus or
    comprehension target the walker did not know about would let a lookup reach *past* the
    real binder to an earlier ``api = SomeApi()`` and bind the call against the wrong
    handler. Those forms are recorded with no class name, which poisons the lookup instead.
    """

    def __init__(self) -> None:
        self.scopes: list[Scope] = []
        self.statement: ast.stmt | None = None
        self.sites: list[tuple[ast.Attribute, list[Scope], ast.stmt | None]] = []

    def visit(self, node: ast.AST) -> None:
        if not isinstance(node, ast.stmt):
            super().visit(node)
            return
        previous, self.statement = self.statement, node
        super().visit(node)
        self.statement = previous

    def _in_scope(self, kind: str, node: ast.AST) -> None:
        self.scopes.append((kind, node, {}))
        self.generic_visit(node)
        self.scopes.pop()

    def _bind(self, target: ast.expr | None, in_effect_from: int, value: ast.expr | None) -> None:
        if not self.scopes:
            return
        if isinstance(target, ast.Name):
            self.scopes[-1][2].setdefault(target.id, []).append((in_effect_from, _instantiated_class(value)))
        elif isinstance(target, ast.Tuple | ast.List):
            # `a, b = X(), Y()` resolves each name against its positional counterpart.
            # Anything that breaks the correspondence — a length mismatch, a starred
            # target, a right-hand side that is not a literal sequence — is ambiguous, so
            # every element is poisoned instead of guessed at.
            elements = value.elts if isinstance(value, ast.Tuple | ast.List) else []
            positional = len(elements) == len(target.elts) and not any(
                isinstance(element, ast.Starred) for element in target.elts
            )
            for index, element in enumerate(target.elts):
                self._bind(element, in_effect_from, elements[index] if positional else None)
        elif isinstance(target, ast.Starred):
            self._bind(target.value, in_effect_from, None)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._in_scope("function", node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._in_scope("function", node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._in_scope("class", node)

    def visit_ListComp(self, node: ast.ListComp) -> None:
        # A comprehension target binds only inside the comprehension, so it gets its own
        # scope; it is in effect from the comprehension's own first line.
        self.scopes.append(("comprehension", node, {}))
        for generator in node.generators:
            self._bind(generator.target, node.lineno, None)
        self.generic_visit(node)
        self.scopes.pop()

    visit_SetComp = visit_ListComp
    visit_DictComp = visit_ListComp
    visit_GeneratorExp = visit_ListComp

    def visit_Assign(self, node: ast.Assign) -> None:
        for target in node.targets:
            self._bind(target, node.lineno + 1, node.value)
        self.generic_visit(node)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        self._bind(node.target, node.lineno + 1, node.value)
        self.generic_visit(node)

    def visit_AugAssign(self, node: ast.AugAssign) -> None:
        self._bind(node.target, node.lineno + 1, None)
        self.generic_visit(node)

    def visit_NamedExpr(self, node: ast.NamedExpr) -> None:
        # A walrus binds inside its own expression, so it is in effect on its own line.
        self._bind(node.target, node.lineno, None)
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        self._bind(node.target, node.lineno, None)
        self.generic_visit(node)

    visit_AsyncFor = visit_For

    def visit_With(self, node: ast.With) -> None:
        for item in node.items:
            self._bind(item.optional_vars, node.lineno, None)
        self.generic_visit(node)

    visit_AsyncWith = visit_With

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr == _SEAM:
            self.sites.append((node, list(self.scopes), self.statement))
        self.generic_visit(node)


def _label(path: Path) -> str:
    try:
        return path.relative_to(_TESTS_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _count_in_strings(source: str) -> int:
    return sum(
        token.string.count(_SEAM)
        for token in tokenize.generate_tokens(io.StringIO(source).readline)
        if token.type in _STRING_TOKENS
    )


def _module_imports(tree: ast.Module) -> dict[str, tuple[str, str]]:
    imports: dict[str, tuple[str, str]] = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            for alias in node.names:
                imports[alias.asname or alias.name] = (node.module, alias.name)
    return imports


def _string_literals(nodes: Sequence[ast.expr], what: str) -> list[str]:
    values = []
    for node in nodes:
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            raise _UnresolvableError(f"{what} `{ast.unparse(node)}` is not a string literal")
        values.append(node.value)
    return values


def _literal_names(node: ast.expr) -> list[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [name.strip() for name in node.value.split(",")]
    if isinstance(node, ast.Tuple | ast.List):
        return _string_literals(node.elts, "parametrize argname")
    raise _UnresolvableError(f"parametrize argnames `{ast.unparse(node)}` are not literal")


def _case_values(row: ast.expr, arity: int) -> list[ast.expr]:
    """One parametrize row's values. ``pytest.param(v1, v2, id=...)`` carries them as its
    own positional arguments, so it is unwrapped rather than declared unreadable."""
    if isinstance(row, ast.Call) and ast.unparse(row.func).endswith("param"):
        return list(row.args)
    if arity > 1 and isinstance(row, ast.Tuple | ast.List):
        return list(row.elts)
    return [row]


def _parametrize_cases(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[Case]:
    """Each ``@pytest.mark.parametrize`` case as ``{argname: value node}``.

    A receiver or a ``**kwargs`` fed by parametrize is a static literal at every case, so
    the call binds once per case rather than being written off as unresolvable.
    """
    per_decorator: list[list[Case]] = []
    for decorator in function.decorator_list:
        if not (isinstance(decorator, ast.Call) and ast.unparse(decorator.func).endswith("parametrize")):
            continue
        if len(decorator.args) < 2:
            raise _UnresolvableError("parametrize argnames/argvalues are not both positional")
        names = _literal_names(decorator.args[0])
        argvalues = decorator.args[1]
        if not isinstance(argvalues, ast.List | ast.Tuple):
            raise _UnresolvableError(f"parametrize argvalues `{ast.unparse(argvalues)}` are not a literal sequence")
        cases: list[Case] = []
        for row in argvalues.elts:
            values = _case_values(row, len(names))
            if len(values) != len(names):
                raise _UnresolvableError(f"parametrize case `{ast.unparse(row)}` does not match {names}")
            cases.append(dict(zip(names, values, strict=True)))
        per_decorator.append(cases)
    if not per_decorator:
        return [{}]
    return [
        {name: value for case in combination for name, value in case.items()}
        for combination in itertools.product(*per_decorator)
    ]


def _cases(scopes: Sequence[Scope]) -> list[Case]:
    functions = [node for kind, node, _bindings in scopes if kind == "function"]
    innermost = functions[-1] if functions else None
    if isinstance(innermost, ast.FunctionDef | ast.AsyncFunctionDef):
        return _parametrize_cases(innermost)
    return [{}]


def _bound_class_name(name: str, lineno: int, scopes: Sequence[Scope]) -> str | None:
    """The binding of ``name`` in effect at ``lineno``, searched from the innermost
    enclosing function or comprehension scope outward — never a sibling function's, never
    module scope. ``None`` means no binding at all; a binding whose form does not name a
    class raises rather than letting the lookup reach past it to an earlier one."""
    for kind, _node, bindings in reversed(scopes):
        if kind == "class":
            continue
        in_effect = [entry for entry in bindings.get(name, ()) if entry[0] <= lineno]
        if in_effect:
            # Ties go to the last binding recorded, which is the last one in source order.
            class_name = max(reversed(in_effect), key=operator.itemgetter(0))[1]
            if class_name is None:
                raise _UnresolvableError(f"`{name}` {_REASON_SHADOWED}")
            return class_name
    return None


def _case_class_name(name: str, case: Case) -> str:
    value = case.get(name)
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Name):
        return value.func.id
    raise _UnresolvableError(f"no preceding `{name} = SomeApi()` binding in an enclosing function scope")


def _load_handler(class_name: str, method: str, imports: dict[str, tuple[str, str]]) -> Callable[..., object]:
    if class_name not in imports:
        raise _UnresolvableError(f"`{class_name}` is not imported at module level")
    module_name, attribute = imports[class_name]
    try:
        module = importlib.import_module(module_name)
    except ImportError as exc:
        raise _UnresolvableError(f"`{module_name}` is not importable: {exc}") from exc
    owner = getattr(module, attribute, None)  # guard-ignore: no-new-getattr -- class name parsed from an import binding
    if owner is None:
        raise _UnresolvableError(f"`{module_name}` has no `{attribute}`")
    view = getattr(owner, method, None)  # guard-ignore: no-new-getattr -- method name parsed from the call site text
    if view is None:
        raise _UnresolvableError(f"`{class_name}` has no `{method}`")
    handler = view.__handler__ if hasattr(view, _SEAM) else None
    if handler is None:
        raise _UnresolvableError(f"`{class_name}.{method}` exposes no `{_SEAM}` — lost `@endpoint`?")
    return handler


def _keyword_names(keyword: ast.keyword, case: Case) -> list[str]:
    if keyword.arg is not None:
        return [keyword.arg]
    mapping = case.get(keyword.value.id) if isinstance(keyword.value, ast.Name) else None
    if not isinstance(mapping, ast.Dict) or any(key is None for key in mapping.keys):
        raise _UnresolvableError(_REASON_STAR_KWARGS)
    return _string_literals([key for key in mapping.keys if key is not None], "parametrized kwargs key")


def _call_shape(call: ast.Call, case: Case) -> tuple[int, list[str]]:
    if any(isinstance(arg, ast.Starred) for arg in call.args):
        raise _UnresolvableError(_REASON_STAR_ARGS)
    return len(call.args), [name for keyword in call.keywords for name in _keyword_names(keyword, case)]


def _bind_site(
    node: ast.Attribute, call: ast.Call | None, imports: dict[str, tuple[str, str]], scopes: Sequence[Scope]
) -> None:
    if call is None:
        raise _UnresolvableError(_REASON_NOT_A_CALL)
    receiver = node.value
    if not (isinstance(receiver, ast.Attribute) and isinstance(receiver.value, ast.Name)):
        raise _UnresolvableError(f"receiver `{ast.unparse(receiver)}` is not `<var>.<method>`")

    name = receiver.value.id
    bound = _bound_class_name(name, node.lineno, scopes)
    # Parametrize expansion runs only where the site actually depends on it, so argvalues
    # the checker cannot read never fail a site that resolves perfectly well on its own.
    needs_cases = bound is None or any(keyword.arg is None for keyword in call.keywords)
    for case in _cases(scopes) if needs_cases else [{}]:
        class_name = bound if bound is not None else _case_class_name(name, case)
        handler = _load_handler(class_name, receiver.attr, imports)
        positional, keywords = _call_shape(call, case)
        signature = inspect.signature(handler)
        try:
            signature.bind(*[_SENTINEL] * positional, **dict.fromkeys(keywords, _SENTINEL))
        except TypeError as exc:
            raise _UnresolvableError(f"{class_name}.{receiver.attr}{signature} rejects this call: {exc}") from exc


def _dynamic_literals(tree: ast.Module) -> list[ast.Constant]:
    """``"__handler__"`` handed to getattr/setattr/hasattr. Left alone it counts as a
    string, so the conservation sum balances while the call site itself disappears."""
    return [
        argument
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _ATTRIBUTE_BUILTINS
        for argument in node.args
        if isinstance(argument, ast.Constant) and isinstance(argument.value, str) and _SEAM in argument.value
    ]


def scan_source(path: Path, source: str, report: Report) -> None:
    label = _label(path)
    before = report.sites
    report.textual += source.count(_SEAM)
    tree = ast.parse(source, filename=str(path))

    dynamic = _dynamic_literals(tree)
    report.in_strings += _count_in_strings(source) - sum(literal.value.count(_SEAM) for literal in dynamic)
    report.failures += [f"{label}:{literal.lineno}: `{_SEAM}` {_REASON_DYNAMIC}" for literal in dynamic]

    imports = _module_imports(tree)
    calls = {
        id(node.func): node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == _SEAM
    }
    scan = _Scan()
    scan.visit(tree)
    for node, scopes, statement in scan.sites:
        try:
            _bind_site(node, calls.get(id(node)), imports, scopes)
        except _UnresolvableError as exc:
            key = (label, ast.unparse(node.value), str(exc), ast.unparse(statement) if statement else "")
            if report.exempt[key] < _EXEMPT_SITES.get(key, 0):
                report.exempt[key] += 1
            else:
                report.failures.append(f"{label}:{node.lineno}: {ast.unparse(node.value)}.{_SEAM} — {exc}")
        else:
            report.bound += 1
    report.per_file[label] += report.sites - before


def _python_files(root: Path) -> Iterator[Path]:
    this_file = Path(__file__).resolve()
    return (path for path in sorted(root.rglob("*.py")) if path != this_file)


def scan_tree(root: Path) -> Report:
    report = Report()
    for path in _python_files(root):
        scan_source(path, path.read_text(encoding="utf-8"), report)
    return report


@pytest.fixture(scope="module")
def reports() -> dict[str, Report]:
    return {tree: scan_tree(_TESTS_ROOT / tree) for tree in _SCAN_TREES}


def test_no_unbindable_handler_call_sites(reports: dict[str, Report]) -> None:
    failures = [failure for report in reports.values() for failure in report.failures]
    assert not failures, "\n".join(["handler seam call sites that do not bind:", *failures])


def test_seam_occurrences_are_conserved(reports: dict[str, Report]) -> None:
    """Every textual `__handler__` lands in exactly one bucket. This is what makes a
    skipped call site arithmetically impossible to hide behind a green run."""
    for tree, report in reports.items():
        bucketed = report.bound + sum(report.exempt.values()) + report.unresolved + report.in_strings
        assert bucketed == report.textual, (
            f"{tree}: {report.textual} textual `{_SEAM}` occurrences but {bucketed} accounted for "
            f"(bound={report.bound} exempt={sum(report.exempt.values())} "
            f"unresolved={report.unresolved} in_strings={report.in_strings})"
        )


def test_expected_site_count(reports: dict[str, Report]) -> None:
    found = {label: count for report in reports.values() for label, count in report.per_file.items() if count}
    assert found == _EXPECTED_SITES, (
        "seam sites moved — a file was renamed out of the scan, or sites were added or deleted; "
        "update _EXPECTED_SITES deliberately"
    )


def test_every_exemption_is_still_needed(reports: dict[str, Report]) -> None:
    seen: Counter[tuple[str, str, str, str]] = Counter()
    for report in reports.values():
        seen.update(report.exempt)
    assert dict(seen) == _EXEMPT_SITES, "the pinned exemption table no longer matches what the scan found"


def _scan_as(path: Path, source: str) -> Report:
    """Scan `source` under `path`'s label without touching the file at that path."""
    report = Report()
    scan_source(path, source, report)
    return report


def _scan(path: Path, source: str) -> Report:
    path.write_text(source, encoding="utf-8")
    return _scan_as(path, source)


_PROLOGUE = "from controllers.openapi.workspaces import WorkspaceMembersApi, WorkspaceSwitchApi\n\n"


def _mutant(tmp_path: Path, body: str) -> tuple[Path, Report]:
    """A one-test module whose line 4 binds `api` and whose `body` starts at line 5."""
    path = tmp_path / "test_mutant.py"
    source = f"{_PROLOGUE}def test_mutant(ctx, q):\n    api = WorkspaceMembersApi()\n{body}"
    return path, _scan(path, source)


_MIS_CALLS = [
    ('api.get.__handler__(api, ctx, "ws", "surplus")', "too many positional arguments"),
    ('api.get.__handler__(api, ctx, "ws", bogus=1, query=q)', "got an unexpected keyword argument"),
    ('api.get.__handler__(api, workspace_id="ws", query=q)', "missing a required argument: 'ctx'"),
]


@pytest.mark.parametrize(("call", "expected"), _MIS_CALLS)
def test_checker_reports_mis_calls(tmp_path: Path, call: str, expected: str) -> None:
    """Without this the guard can rot into a pass that never bites."""
    path, report = _mutant(tmp_path, f"    {call}\n")

    assert report.bound == 0
    assert len(report.failures) == 1
    assert f"{path.as_posix()}:5:" in report.failures[0]
    assert expected in report.failures[0]


def test_checker_accepts_a_correct_call(tmp_path: Path) -> None:
    _path, report = _mutant(tmp_path, '    api.get.__handler__(api, ctx, "ws", query=q)\n')

    assert (report.bound, report.failures) == (1, [])


def test_checker_reports_a_view_that_lost_the_seam(tmp_path: Path) -> None:
    _path, report = _mutant(tmp_path, "    api.dispatch_request.__handler__(api, ctx)\n")

    assert len(report.failures) == 1
    assert f"exposes no {_SEAM}" in report.failures[0].replace("`", "")


def test_checker_reports_a_seam_reached_through_getattr(tmp_path: Path) -> None:
    """A `"__handler__"` string handed to getattr would otherwise be bucketed as a string,
    so the conservation sum balances while the call site itself disappears."""
    call = 'getattr(api.get, "__handler__")(api, ctx, "ws", "surplus", "extra", bogus=1)'
    path, report = _mutant(tmp_path, f"    {call}\n")

    assert report.in_strings == 0
    assert len(report.failures) == 1
    assert f"{path.as_posix()}:5:" in report.failures[0]
    assert report.bound + report.unresolved + report.in_strings == report.textual


_SHADOWING = [
    '    for api in (WorkspaceSwitchApi(),):\n        api.get.__handler__(api, ctx, "ws", query=q)\n',
    '    [api.get.__handler__(api, ctx, "ws", query=q) for api in (WorkspaceSwitchApi(),)]\n',
    '    with WorkspaceSwitchApi() as api:\n        api.get.__handler__(api, ctx, "ws", query=q)\n',
    '    (api := WorkspaceSwitchApi()) and api.get.__handler__(api, ctx, "ws", query=q)\n',
]


@pytest.mark.parametrize("body", _SHADOWING)
def test_checker_refuses_a_shadowed_receiver(tmp_path: Path, body: str) -> None:
    """A binding form the walker did not record would let the lookup reach past it to the
    `api = WorkspaceMembersApi()` on line 4 and bind against the wrong handler."""
    _path, report = _mutant(tmp_path, body)

    assert report.bound == 0
    assert len(report.failures) == 1
    assert _REASON_SHADOWED in report.failures[0]


def test_checker_resolves_a_positional_tuple_binding(tmp_path: Path) -> None:
    """`a, b = X(), Y()` resolves unambiguously, so poisoning it would fail correct code.
    Binding each name to the wrong counterpart would swap these two outcomes."""
    _path, report = _mutant(
        tmp_path,
        "    api, other = WorkspaceSwitchApi(), WorkspaceMembersApi()\n"
        '    other.get.__handler__(other, ctx, "ws", query=q)\n'
        '    api.get.__handler__(api, ctx, "ws", query=q)\n',
    )

    assert report.bound == 1
    assert len(report.failures) == 1
    assert "`WorkspaceSwitchApi` has no `get`" in report.failures[0]


_AMBIGUOUS_TUPLES = [
    "    api, other = _make_apis()\n",
    "    api, *rest = WorkspaceSwitchApi(), WorkspaceMembersApi()\n",
]


@pytest.mark.parametrize("binding", _AMBIGUOUS_TUPLES)
def test_checker_refuses_an_ambiguous_tuple_binding(tmp_path: Path, binding: str) -> None:
    """No positional correspondence to read, so the rebinding poisons the lookup rather
    than letting it reach past to the `api = WorkspaceMembersApi()` on line 4."""
    _path, report = _mutant(tmp_path, binding + '    api.get.__handler__(api, ctx, "ws", query=q)\n')

    assert report.bound == 0
    assert len(report.failures) == 1
    assert _REASON_SHADOWED in report.failures[0]


def test_checker_refuses_a_receiver_bound_in_a_sibling_function(tmp_path: Path) -> None:
    """The precise bug this guard exists to prevent: a module-wide name map would resolve
    `api` here from the sibling test above and report a pass."""
    path = tmp_path / "test_sibling.py"
    report = _scan(
        path,
        f"{_PROLOGUE}"
        "def test_one(ctx, q):\n"
        "    api = WorkspaceMembersApi()\n\n"
        "def test_two(ctx, q):\n"
        '    api.get.__handler__(api, ctx, "ws", query=q)\n',
    )

    assert len(report.failures) == 1
    assert "no preceding" in report.failures[0]
    assert f"{path.as_posix()}:7:" in report.failures[0]


def test_checker_binds_every_parametrized_case(tmp_path: Path) -> None:
    """A parametrized receiver plus `**kwargs` is still fully checkable — and the bad case
    must be the one reported."""
    report = _scan(
        tmp_path / "test_parametrized.py",
        "import pytest\n"
        "from controllers.openapi.app_dsl import AppDslImportApi, AppDslImportConfirmApi\n\n"
        '@pytest.mark.parametrize(("api", "kwargs"), [\n'
        '    (AppDslImportApi(), {"workspace_id": "w", "body": None}),\n'
        '    pytest.param(AppDslImportConfirmApi(), {"workspace_id": "w", "import_id": "i", "bogus": None}, id="x"),\n'
        "])\n"
        "def test_both(ctx, api, kwargs):\n"
        "    api.post.__handler__(api, ctx, **kwargs)\n",
    )

    assert len(report.failures) == 1
    assert "AppDslImportConfirmApi.post" in report.failures[0]
    assert "got an unexpected keyword argument 'bogus'" in report.failures[0]


_UNREADABLE_PARAMETRIZE = [
    '@pytest.mark.parametrize("flag", [pytest.param(True, id="on")])',
    '@pytest.mark.parametrize("flag", _FLAGS)',
]


@pytest.mark.parametrize("decorator", _UNREADABLE_PARAMETRIZE)
def test_checker_ignores_parametrize_a_site_does_not_depend_on(tmp_path: Path, decorator: str) -> None:
    """Failing correct code is how a guard gets weakened or deleted. A receiver that
    resolves from a plain local binding must never be held hostage to argvalues the
    checker cannot read."""
    report = _scan(
        tmp_path / "test_unreadable_parametrize.py",
        "import pytest\n"
        "from controllers.openapi.workspaces import WorkspaceMembersApi\n\n"
        "_FLAGS = [True]\n\n"
        f"{decorator}\n"
        "def test_mutant(ctx, q, flag):\n"
        "    api = WorkspaceMembersApi()\n"
        '    api.get.__handler__(api, ctx, "ws", query=q)\n',
    )

    assert (report.bound, report.failures) == (1, [])


_EXEMPT_FILE = _TESTS_ROOT / "unit_tests" / "controllers" / "openapi" / "test_endpoint.py"
_EXEMPT_READ = "def test_handler_seam_is_exposed():\n    assert view.__handler__ is not None\n"
_RESHAPED_READ = (
    "def test_handler_seam_is_exposed():\n"
    "    handler = view.__handler__\n"
    '    handler("self", "ctx", "surplus", bogus=1)\n'
)


def test_exemption_slot_is_anchored_to_the_statement() -> None:
    """Both are scanned under the exempted file's own label and receiver, so only the
    statement anchor separates them. Re-shaping the read into an alias-then-call must not
    consume the slot and leave the call unchecked."""
    exempted = _scan_as(_EXEMPT_FILE, _EXEMPT_READ)
    assert (sum(exempted.exempt.values()), exempted.failures) == (1, [])

    reshaped = _scan_as(_EXEMPT_FILE, _RESHAPED_READ)
    assert sum(reshaped.exempt.values()) == 0
    assert len(reshaped.failures) == 1
