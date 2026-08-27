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
checker cannot bind fails with ``file:line`` instead of being passed over.
"""

from __future__ import annotations

import ast
import importlib
import inspect
import io
import itertools
import tokenize
from collections import Counter
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import pytest

_TESTS_ROOT = Path(__file__).resolve().parents[3]

# The trees to scan, each with the site count below which the scan is no longer trustworthy:
# a file renamed out of the glob fails loudly instead of quietly dropping coverage to zero.
_SCAN_TREES = {
    "unit_tests/controllers/openapi": 38,
    "test_containers_integration_tests/controllers/openapi": 30,
}

_SEAM = "__handler__"
_SENTINEL = object()

_REASON_STAR_ARGS = "`*args` at the call site hides the real arity"
_REASON_STAR_KWARGS = "`**kwargs` at the call site hides the real arity"
_REASON_NOT_A_CALL = f"`{_SEAM}` is read, not called"

# The only way a seam occurrence escapes the bind check, pinned exactly: an extra
# unreachable occurrence fails, a stale entry fails, and a count change fails. Anything
# absent from this table and unbindable is a reported failure, never a silent skip.
_EXEMPT_SITES: dict[tuple[str, str, str], int] = {
    ("unit_tests/controllers/openapi/test_endpoint.py", "view", _REASON_NOT_A_CALL): 1,
}

_STRING_TOKENS = frozenset({tokenize.STRING, tokenize.COMMENT, tokenize.FSTRING_MIDDLE})

# {argname: value node} for one @pytest.mark.parametrize case; empty for an unparametrized call.
Case = dict[str, ast.expr]
# ("function" | "class", defining node, {name: [(lineno, class name), ...]})
Scope = tuple[str, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef, dict[str, list[tuple[int, str]]]]


class _UnresolvableError(Exception):
    """A seam occurrence the checker cannot bind. Never swallowed — it either matches a
    pinned exemption or becomes a reported failure."""


@dataclass
class Report:
    textual: int = 0
    in_strings: int = 0
    bound: int = 0
    exempt: Counter[tuple[str, str, str]] = field(default_factory=Counter)
    failures: list[str] = field(default_factory=list)

    @property
    def unresolved(self) -> int:
        return len(self.failures)

    @property
    def sites(self) -> int:
        return self.bound + sum(self.exempt.values()) + self.unresolved


class _Scan(ast.NodeVisitor):
    """Collects every ``__handler__`` attribute node together with the chain of scopes
    enclosing it.

    Bindings are recorded per function rather than per module because a module-wide name
    map is wrong here: `api` is rebound to a different class in nearly every test of a
    file, so a module-wide map resolves a handful of sites and mis-resolves the rest.
    Class bodies are recorded but never consulted from a nested method — class-level names
    are not in a method's lookup chain.
    """

    def __init__(self) -> None:
        self.scopes: list[Scope] = []
        self.sites: list[tuple[ast.Attribute, list[Scope]]] = []

    def _in_scope(self, kind: str, node: ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef) -> None:
        self.scopes.append((kind, node, {}))
        self.generic_visit(node)
        self.scopes.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._in_scope("function", node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self._in_scope("function", node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._in_scope("class", node)

    def visit_Assign(self, node: ast.Assign) -> None:
        if self.scopes and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.scopes[-1][2].setdefault(target.id, []).append((node.lineno, node.value.func.id))
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr == _SEAM:
            self.sites.append((node, list(self.scopes)))
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
            values = row.elts if len(names) > 1 and isinstance(row, ast.Tuple | ast.List) else [row]
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


def _resolve_class_name(name: str, lineno: int, scopes: Sequence[Scope], case: Case) -> str:
    """The nearest preceding ``name = SomeApi()`` in the innermost enclosing function
    scope that has one — never a later binding, never a sibling function's."""
    for kind, _node, bindings in reversed(scopes):
        if kind == "class":
            continue
        preceding = [entry for entry in bindings.get(name, ()) if entry[0] < lineno]
        if preceding:
            return max(preceding)[1]
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
    owner = getattr(module, attribute, None)
    if owner is None:
        raise _UnresolvableError(f"`{module_name}` has no `{attribute}`")
    view = getattr(owner, method, None)
    if view is None:
        raise _UnresolvableError(f"`{class_name}` has no `{method}`")
    handler = getattr(view, _SEAM, None)
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

    for case in _cases(scopes):
        class_name = _resolve_class_name(receiver.value.id, node.lineno, scopes, case)
        handler = _load_handler(class_name, receiver.attr, imports)
        positional, keywords = _call_shape(call, case)
        signature = inspect.signature(handler)
        try:
            signature.bind(*[_SENTINEL] * positional, **dict.fromkeys(keywords, _SENTINEL))
        except TypeError as exc:
            raise _UnresolvableError(f"{class_name}.{receiver.attr}{signature} rejects this call: {exc}") from exc


def scan_source(path: Path, source: str, report: Report) -> None:
    report.textual += source.count(_SEAM)
    report.in_strings += _count_in_strings(source)
    tree = ast.parse(source, filename=str(path))
    imports = _module_imports(tree)
    calls = {
        id(node.func): node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == _SEAM
    }
    scan = _Scan()
    scan.visit(tree)
    label = _label(path)
    for node, scopes in scan.sites:
        try:
            _bind_site(node, calls.get(id(node)), imports, scopes)
        except _UnresolvableError as exc:
            key = (label, ast.unparse(node.value), str(exc))
            if report.exempt[key] < _EXEMPT_SITES.get(key, 0):
                report.exempt[key] += 1
            else:
                report.failures.append(f"{label}:{node.lineno}: {ast.unparse(node.value)}.{_SEAM} — {exc}")
        else:
            report.bound += 1


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


def test_expected_minimum_site_count(reports: dict[str, Report]) -> None:
    for tree, expected in _SCAN_TREES.items():
        assert reports[tree].sites >= expected, (
            f"{tree}: {reports[tree].sites} seam call sites, expected at least {expected} — "
            "a test file was renamed out of the scan or deleted"
        )


def test_every_exemption_is_still_needed(reports: dict[str, Report]) -> None:
    seen: Counter[tuple[str, str, str]] = Counter()
    for report in reports.values():
        seen.update(report.exempt)
    assert dict(seen) == _EXEMPT_SITES, "the pinned exemption table no longer matches what the scan found"


def _mutant(tmp_path: Path, body: str, name: str = "test_mutant.py") -> tuple[Path, Report]:
    source = (
        "from controllers.openapi.workspaces import WorkspaceMembersApi\n\n"
        "def test_mutant(ctx, q):\n"
        "    api = WorkspaceMembersApi()\n"
        f"{body}"
    )
    path = tmp_path / name
    path.write_text(source, encoding="utf-8")
    report = Report()
    scan_source(path, source, report)
    return path, report


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


def test_checker_refuses_a_receiver_bound_in_a_sibling_function(tmp_path: Path) -> None:
    """The precise bug this guard exists to prevent: a module-wide name map would resolve
    `api` here from the sibling test above and report a pass."""
    source = (
        "from controllers.openapi.workspaces import WorkspaceMembersApi\n\n"
        "def test_one(ctx, q):\n"
        "    api = WorkspaceMembersApi()\n\n"
        "def test_two(ctx, q):\n"
        '    api.get.__handler__(api, ctx, "ws", query=q)\n'
    )
    path = tmp_path / "test_sibling.py"
    path.write_text(source, encoding="utf-8")
    report = Report()
    scan_source(path, source, report)

    assert len(report.failures) == 1
    assert "no preceding" in report.failures[0]
    assert f"{path.as_posix()}:7:" in report.failures[0]


def test_checker_binds_every_parametrized_case(tmp_path: Path) -> None:
    """A parametrized receiver plus `**kwargs` is still fully checkable — and the bad case
    must be the one reported."""
    source = (
        "import pytest\n"
        "from controllers.openapi.app_dsl import AppDslImportApi, AppDslImportConfirmApi\n\n"
        '@pytest.mark.parametrize(("api", "kwargs"), [\n'
        '    (AppDslImportApi(), {"workspace_id": "w", "body": None}),\n'
        '    (AppDslImportConfirmApi(), {"workspace_id": "w", "import_id": "i", "bogus": None}),\n'
        "])\n"
        "def test_both(ctx, api, kwargs):\n"
        "    api.post.__handler__(api, ctx, **kwargs)\n"
    )
    path = tmp_path / "test_parametrized.py"
    path.write_text(source, encoding="utf-8")
    report = Report()
    scan_source(path, source, report)

    assert len(report.failures) == 1
    assert "AppDslImportConfirmApi.post" in report.failures[0]
    assert "got an unexpected keyword argument 'bogus'" in report.failures[0]
