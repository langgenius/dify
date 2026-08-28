"""Binds handler `ctx.<name>` reads to the loads their own route wiring actually derives.

T2 made auth `Context` a store: `app`/`workspace`/`workspace_role`/`caller` are filled by
whichever requirement asks for them first, and a reader whose datum was never loaded raises
`LookupError`. Which requirement fills a datum is a property of each route's decorator —
`spec.requirements` merged with its subject's pipeline `fixed` — so nothing short of
re-deriving that merge from the live objects can tell a safe read from a coincidence.

This module re-derives it instead of declaring it. A requirement's loads are read off its
`run` by walking every call it reaches: a call to one of `loaders.py`'s four `load_*`
functions is a leaf that also loads what *that* function's own body reaches (so
`RequireWorkspaceMembership` loading `workspace_role` also picks up `workspace` and `caller`,
because `load_workspace_role` calls both internally); a call to a same-module function or a
`self` method is unwrapped and walked the same way; anything else — a call on some other
receiver (`subject.mounts_caller(ctx)`, `TenantService.get_x(...)`) — cannot reach a loader's
private surface from outside it, so it is safely ignored, never expanded. There is no
`loads = {...}` table anywhere in this file to fall out of step with those calls.

Two shapes the scan cannot place must fail loudly rather than pass silently, because a scan
that shrugs at what it cannot resolve reads as coverage while covering nothing: a `load_*`
import reached through an alias (the literal name at the call site no longer matches), and a
callee the scan cannot even name (`getattr(self, action)(ctx)` and the like). Both raise
`_UnresolvableError`, which every entry point turns into a reported failure, never a swallowed one.

This is a sibling of `test_handler_seam_bind.py`, not an extension of it: that file scans
*test* call sites for `__handler__` arity; this one scans *production* route wiring — real
`Requirement`/`Pipeline` objects off a live Flask app, exactly like `test_auth_matrix.py`'s
`matrix_app` — for a completely different shape of gap. Neither its `_EXPECTED_SITES`
bookkeeping nor its per-call-site exemption table has anything to bind to here; contorting
this in would only make both harder to read. `test_auth_matrix.py` itself is untouched — it
is pinned by md5 elsewhere and this task adds no production behaviour.
"""

from __future__ import annotations

import ast
import inspect
import textwrap
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from types import ModuleType
from typing import NoReturn, Protocol, cast

import pytest
from flask import Flask

from controllers.openapi import bp as openapi_bp
from controllers.openapi.auth import loaders as loaders_module
from controllers.openapi.auth import subjects as subjects_module
from controllers.openapi.auth.data import CallerKind
from controllers.openapi.auth.pipelines import Pipeline
from controllers.openapi.auth.requirements import Requirement, SubjectCheck
from controllers.openapi.auth.router import subject_router
from controllers.openapi.auth.spec import EndpointSpec
from controllers.openapi.auth.subjects import Subject
from libs.oauth_bearer import AuthContext, SubjectType, TokenType

LOADABLE = ("app", "workspace", "workspace_role", "caller")
_LOADER_NAMES = {f"load_{name}": name for name in LOADABLE}


class _UnresolvableError(Exception):
    """A call, or a handler's use of `ctx`, the scan cannot place. Always reported, never
    swallowed — see the module docstring."""


@dataclass(frozen=True)
class _Home:
    """Where a function being scanned lives: its module's parsed source (for resolving a
    same-module helper call) and its owning class, if any (for resolving a `self.` call).
    """

    module_name: str
    module_ast: ast.Module
    owner_class: ast.ClassDef | None


@dataclass(frozen=True)
class _Facts:
    """What this scan already knows, statically, about the request `ctx.has_app` and
    `subject.caller_kind` would answer at runtime — `has_app` from the route's own URL rule
    (an `<app_id>` segment or none), `caller_kind` from the one `Subject` class a pipeline
    always runs. `None` means "not pinned for this resolution" — an `if` gated on it is
    walked on both branches rather than guessed at, same as any other undecidable condition.

    Without this, `if not ctx.has_app: return` reads as dead weight to a scan that doesn't
    evaluate branches, and a fixed requirement guarding on it (`CheckAppWorkspaceMembership`,
    `ResolveCaller`) would look like it always loads its data — coincidentally covering every
    route regardless of whether that guard clause would actually have returned first.
    """

    has_app: bool | None
    caller_kind: CallerKind | None


_MODULE_AST_CACHE: dict[str, ast.Module] = {}


def _cached_module_ast(module: ModuleType) -> ast.Module:
    if module.__name__ not in _MODULE_AST_CACHE:
        _MODULE_AST_CACHE[module.__name__] = ast.parse(textwrap.dedent(inspect.getsource(module)))
    return _MODULE_AST_CACHE[module.__name__]


def _find_class(module_ast: ast.Module, name: str) -> ast.ClassDef | None:
    for node in module_ast.body:
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    return None


def _find_function(container: ast.Module | ast.ClassDef, name: str) -> ast.FunctionDef | ast.AsyncFunctionDef | None:
    for node in container.body:
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == name:
            return node
    return None


def _loader_aliases(module_ast: ast.Module) -> frozenset[str]:
    """Local names an import bound to a loader under a different name than it was
    defined with — the one shape this scan deliberately does not follow (see the
    `_resolve_name_call` alias branch), so it must be seen coming, not missed.
    """
    aliases: set[str] = set()
    for node in module_ast.body:
        if isinstance(node, ast.ImportFrom) and node.module == loaders_module.__name__:
            for alias in node.names:
                if alias.name in _LOADER_NAMES and alias.asname and alias.asname != alias.name:
                    aliases.add(alias.asname)
    return frozenset(aliases)


def _loader_home() -> _Home:
    module_ast = _cached_module_ast(loaders_module)
    return _Home(module_name=loaders_module.__name__, module_ast=module_ast, owner_class=None)


def _resolve_name_call(name: str, home: _Home, visited: set[tuple[str, str]], facts: _Facts) -> frozenset[str]:
    if name in _LOADER_NAMES:
        datum = _LOADER_NAMES[name]
        key = (loaders_module.__name__, name)
        if key in visited:
            return frozenset({datum})
        visited.add(key)
        function = _find_function(_loader_home().module_ast, name)
        if function is None:
            raise _UnresolvableError(f"`{name}` is not defined in {loaders_module.__name__}")
        return frozenset({datum}) | _resolve_loads(function, _loader_home(), visited, facts)
    if name in _loader_aliases(home.module_ast):
        raise _UnresolvableError(
            f"`{name}` is a loader imported under an alias — the scan matches literal `load_*` names only"
        )
    function = _find_function(home.module_ast, name)
    if function is None:
        return frozenset()  # an ordinary call this module doesn't define — cannot reach a loader from here
    key = (home.module_name, name)
    if key in visited:
        return frozenset()
    visited.add(key)
    return _resolve_loads(function, _Home(home.module_name, home.module_ast, None), visited, facts)


def _resolve_self_call(method_name: str, home: _Home, visited: set[tuple[str, str]], facts: _Facts) -> frozenset[str]:
    if home.owner_class is None:
        raise _UnresolvableError(f"self.{method_name} used with no enclosing class in scope")
    method = _find_function(home.owner_class, method_name)
    if method is None:
        raise _UnresolvableError(f"`{home.owner_class.name}.{method_name}` is not defined on that class")
    key = (home.module_name, f"{home.owner_class.name}.{method_name}")
    if key in visited:
        return frozenset()
    visited.add(key)
    return _resolve_loads(method, home, visited, facts)


def _resolve_call(call: ast.Call, home: _Home, visited: set[tuple[str, str]], facts: _Facts) -> frozenset[str]:
    func = call.func
    if isinstance(func, ast.Name):
        return _resolve_name_call(func.id, home, visited, facts)
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and func.value.id == "self":
            return _resolve_self_call(func.attr, home, visited, facts)
        # A call on some other receiver (`subject.mounts_caller(ctx)`, `TenantService.get_x(...)`)
        # cannot reach `loaders.py`'s private surface from outside it — see module docstring.
        return frozenset()
    raise _UnresolvableError(f"`{ast.unparse(call)}` dispatches dynamically — the scan cannot name the callee")


def _resolve_calls_in(node: ast.AST, home: _Home, visited: set[tuple[str, str]], facts: _Facts) -> frozenset[str]:
    """Every call reachable from `node` (a statement or an expression) — an `if` test is
    evaluated unconditionally on every pass through it, whichever branch is or isn't taken,
    and a non-`if` statement (`Assign`, bare `Expr`, `Return`, ...) has no branch to decide."""
    loaded: set[str] = set()
    for descendant in ast.walk(node):
        if isinstance(descendant, ast.Call):
            loaded |= _resolve_call(descendant, home, visited, facts)
    return frozenset(loaded)


def _evaluate_condition(test: ast.expr, facts: _Facts) -> bool | None:
    """Whether `test` is statically decidable from `facts` — `ctx.has_app` (route-derived)
    or `subject.caller_kind` (pipeline-derived) — or `None` when it turns on something this
    scan cannot pin (a config flag, an opaque method call), in which case both branches of
    the `if` it guards are walked rather than one being guessed at.
    """
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        inner = _evaluate_condition(test.operand, facts)
        return None if inner is None else not inner
    if isinstance(test, ast.Attribute) and isinstance(test.value, ast.Name) and test.value.id == "ctx":
        return facts.has_app if test.attr == "has_app" else None
    if (
        isinstance(test, ast.Compare)
        and len(test.ops) == 1
        and len(test.comparators) == 1
        and isinstance(test.ops[0], ast.Is | ast.IsNot)
        and isinstance(test.left, ast.Attribute)
        and isinstance(test.left.value, ast.Name)
        and test.left.value.id == "subject"
        and test.left.attr == "caller_kind"
        and facts.caller_kind is not None
    ):
        comparator = test.comparators[0]
        if isinstance(comparator, ast.Attribute) and isinstance(comparator.value, ast.Name):
            if comparator.value.id != "CallerKind" or comparator.attr not in CallerKind.__members__:
                return None
            equal = facts.caller_kind is CallerKind[comparator.attr]
            return equal if isinstance(test.ops[0], ast.Is) else not equal
    return None


def _ends_with_stop(statements: list[ast.stmt]) -> bool:
    return bool(statements) and isinstance(statements[-1], ast.Return | ast.Raise | ast.Continue | ast.Break)


def _resolve_body(
    statements: list[ast.stmt], home: _Home, visited: set[tuple[str, str]], facts: _Facts
) -> frozenset[str]:
    """Walks a straight-line function body, honouring the one control-flow shape this
    surface actually uses: an `if <decidable>: return`/`raise` guard clause. A branch this
    scan cannot decide is walked on both sides without truncating what follows — the
    coarseness `RBACCheck`'s `dify_config.RBAC_ENABLED` gate relies on — but a decided guard
    clause that stops must actually stop, or a fixed requirement guarding on `ctx.has_app`
    would look like it loads its data on every route, whether or not that guard would have
    returned first.
    """
    loaded: set[str] = set()
    for statement in statements:
        if isinstance(statement, ast.If):
            loaded |= _resolve_calls_in(statement.test, home, visited, facts)
            decision = _evaluate_condition(statement.test, facts)
            if decision is None:
                loaded |= _resolve_body(statement.body, home, visited, facts)
                loaded |= _resolve_body(statement.orelse, home, visited, facts)
                continue
            branch = statement.body if decision else statement.orelse
            loaded |= _resolve_body(branch, home, visited, facts)
            if _ends_with_stop(branch):
                return frozenset(loaded)
            continue
        loaded |= _resolve_calls_in(statement, home, visited, facts)  # covers Assign/Expr/Return/Raise alike
    return frozenset(loaded)


def _resolve_loads(
    function: ast.FunctionDef | ast.AsyncFunctionDef, home: _Home, visited: set[tuple[str, str]], facts: _Facts
) -> frozenset[str]:
    return _resolve_body(function.body, home, visited, facts)


def requirement_loads(requirement: Requirement, facts: _Facts) -> frozenset[str]:
    """What `requirement` loads under `facts`, derived from its own `run` — never a
    declared table."""
    cls = type(requirement)
    module = inspect.getmodule(cls)
    if module is None:
        raise _UnresolvableError(f"{cls.__qualname__}'s defining module could not be found")
    module_ast = _cached_module_ast(module)
    class_ast = _find_class(module_ast, cls.__name__)
    if class_ast is None:
        raise _UnresolvableError(f"{module.__name__}.{cls.__name__} not found in its own source")
    run = _find_function(class_ast, "run")
    if run is None:
        raise _UnresolvableError(f"{cls.__qualname__} defines no run")
    home = _Home(module_name=module.__name__, module_ast=module_ast, owner_class=class_ast)
    return _resolve_loads(run, home, set(), facts)


def _combined_loads(requirements: tuple[Requirement, ...], facts: _Facts) -> frozenset[str]:
    loaded: set[str] = set()
    for requirement in requirements:
        loaded |= requirement_loads(requirement, facts)
    return frozenset(loaded)


class _CtxUsage(ast.NodeVisitor):
    """`ctx.<attr>` reads in a handler body. A bare `ctx` — handed to something else rather
    than read as a named attribute — is exactly the hole the module docstring calls out, so
    it is recorded rather than silently walked past.
    """

    def __init__(self) -> None:
        self.reads: set[str] = set()
        self.bare_ctx = False

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if isinstance(node.value, ast.Name) and node.value.id == "ctx":
            self.reads.add(node.attr)
            return
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id == "ctx":
            self.bare_ctx = True


def _handler_ctx_reads(handler: object) -> frozenset[str]:
    source = textwrap.dedent(inspect.getsource(handler))  # type: ignore[arg-type]
    tree = ast.parse(source)
    function = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef))
    usage = _CtxUsage()
    for statement in function.body:
        usage.visit(statement)
    if usage.bare_ctx:
        raise _UnresolvableError("hands `ctx` to something other than a named attribute read")
    return frozenset(name for name in usage.reads if name in LOADABLE)


def _reachable_pipelines(spec: EndpointSpec) -> tuple[tuple[SubjectType, Pipeline], ...]:
    """Every (subject type, pipeline) pair whose subject can actually reach this route's body.

    `SubjectCheck` (rank FIRST) rejects an excluded subject before any other requirement —
    fixed included — runs, so that subject's pipeline never loads anything for this route.
    Reads the real router's registry (`subject_router`), never a hand-kept subject list. The
    subject type travels with its pipeline so the caller can pin `_Facts.caller_kind` to the
    one `Subject` class that pipeline actually runs.
    """
    allowed: frozenset[SubjectType] | None = None
    for requirement in spec.requirements:
        if isinstance(requirement, SubjectCheck):
            allowed = frozenset(subject_cls.subject_type for subject_cls in requirement.allowed)
            break
    pipelines = subject_router._pipelines
    if allowed is None:
        return tuple(pipelines.items())
    return tuple((subject_type, pipeline) for subject_type, pipeline in pipelines.items() if subject_type in allowed)


class _SpecBearingView(Protocol):
    """The shape `@endpoint` leaves on a decorated view — enough of it to read the spec
    and unwrap to the raw handler without spelling out flask-restx's own view type.
    """

    __spec__: EndpointSpec
    __name__: str

    def __call__(self, *args: object, **kwargs: object) -> object: ...


def _resource_handler(resource: type, method: str) -> object | None:
    return getattr(resource, method.lower(), None)  # guard-ignore: no-new-getattr -- HTTP verb selects the handler


def _guarded_routes(app: Flask) -> Iterator[tuple[str, str, bool, EndpointSpec, str, object]]:
    """(method, path, has_app, spec, "Resource.method" label, handler) for every
    `/openapi/v1` route carrying a `__spec__` — the same derivation `test_auth_matrix.py`
    uses, off the same `view.__spec__`, never a hand-kept route list. `has_app` is read off
    the rule's own URL variables — `ctx.has_app` at runtime is exactly `"app_id" in
    view_args`, so a route's own pattern already answers it, for every request it serves.
    """
    for rule in app.url_map.iter_rules():
        path = str(rule)
        if not path.startswith("/openapi/v1"):
            continue
        has_app = "app_id" in rule.arguments
        for method in rule.methods or set():
            if method in {"HEAD", "OPTIONS"}:
                continue
            view = app.view_functions.get(rule.endpoint)
            resource = view.view_class if hasattr(view, "view_class") else None
            if resource is None:
                continue
            handler_view = _resource_handler(resource, method)
            if handler_view is None or not hasattr(handler_view, "__spec__"):
                continue
            view_typed = cast(_SpecBearingView, handler_view)
            spec = view_typed.__spec__
            # `inspect.unwrap` rather than the `__handler__` seam itself: every layer
            # `@endpoint` stacks (`accepts`/`returns`/the router's own `guard`) is
            # `functools.wraps`-preserving, so this reaches the identical raw view — without
            # adding a textual `__handler__` occurrence to a tree `test_handler_seam_bind.py`
            # also scans and separately pins the count of.
            handler = inspect.unwrap(view_typed)
            yield method, path, has_app, spec, f"{resource.__name__}.{handler.__name__}", handler


@dataclass
class LoadCoverageReport:
    unresolvable: list[str] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)


def _scan(app: Flask) -> LoadCoverageReport:
    report = LoadCoverageReport()
    for method, path, has_app, spec, handler_label, handler in _guarded_routes(app):
        try:
            reads = _handler_ctx_reads(handler)
        except _UnresolvableError as exc:
            report.unresolvable.append(f"{method} {path} ({handler_label}): {exc}")
            continue
        if not reads:
            continue
        for subject_type, pipeline in _reachable_pipelines(spec):
            subject_cls = subjects_module._SUBJECT_CLASSES[subject_type]
            facts = _Facts(has_app=has_app, caller_kind=subject_cls.caller_kind)
            try:
                loaded = _combined_loads((*spec.requirements, *pipeline.fixed), facts)
            except _UnresolvableError as exc:
                report.unresolvable.append(f"{method} {path} under {type(pipeline).__name__}: {exc}")
                continue
            missing = sorted(reads - loaded)
            if missing:
                report.missing.append(
                    f"{method} {path} ({handler_label}) reads {missing} under {type(pipeline).__name__}, but "
                    f"nothing in its requirements or fixed loads {missing} — declare a requirement that loads it"
                )
    return report


@pytest.fixture(scope="module")
def routed_app() -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = True
    app.register_blueprint(openapi_bp)
    return app


@pytest.fixture(scope="module")
def load_coverage(routed_app: Flask) -> LoadCoverageReport:
    return _scan(routed_app)


def test_no_unresolvable_ctx_or_load_sites(load_coverage: LoadCoverageReport) -> None:
    assert not load_coverage.unresolvable, "\n".join(["sites the scan could not resolve:", *load_coverage.unresolvable])


def test_every_handler_read_is_backed_by_a_load(load_coverage: LoadCoverageReport) -> None:
    assert not load_coverage.missing, "\n".join(["handler reads with no backing load:", *load_coverage.missing])


class _ProbeCallerContext:
    """A `CallerContext` stand-in for probing `mounts_caller` without a real request.
    `app`/`workspace` raise: no shipped `mounts_caller` reads them, and a future one that
    does needs this probe extended, not silently handed a placeholder model.
    """

    def __init__(self, *, has_app: bool) -> None:
        self.has_app = has_app
        self.workspace_loaded = False

    @property
    def app(self) -> NoReturn:
        raise AssertionError("mounts_caller read .app — extend the probe to cover it")

    @property
    def workspace(self) -> NoReturn:
        raise AssertionError("mounts_caller read .workspace — extend the probe to cover it")


def _probe_auth_context(subject_type: SubjectType) -> AuthContext:
    return AuthContext(
        subject_type=subject_type,
        subject_email=None,
        subject_issuer=None,
        account_id=uuid.uuid4(),
        client_id=None,
        scopes=frozenset(),
        token_id=uuid.uuid4(),
        token_type=TokenType.OAUTH_ACCOUNT,  # unread by mounts_caller; a placeholder either subject accepts
        expires_at=None,
    )


def _mounts_caller(subject_cls: type[Subject], *, has_app: bool) -> bool:
    subject = subject_cls(_probe_auth_context(subject_cls.subject_type))
    return subject.mounts_caller(_ProbeCallerContext(has_app=has_app))


def test_every_mounting_pipeline_loads_a_caller() -> None:
    """`mounted()` mounts flask-login iff `subject.mounts_caller(ctx)` — so a pipeline
    serving a subject that can answer True must load a caller, or every such request 500s
    at mount. Enumerates `subject_router`'s real registry and `Subject.__init_subclass__`'s
    real registry, so a third subject/pipeline pair is covered without naming either of
    today's two classes.

    Checked separately for `has_app` true and false, never blanketed (`_Facts(has_app=None,
    ...)`): a blanket check lets `CheckAppWorkspaceMembership`'s own has_app-gated path to
    `load_workspace_role` (which loads a caller too, transitively) stand in for a caller load
    that is only ever guaranteed on the has_app branch that gate actually takes — exactly
    coincidental coverage, the thing this whole module exists to refuse.
    """
    failures: list[str] = []
    for subject_type, pipeline in subject_router._pipelines.items():
        subject_cls = subjects_module._SUBJECT_CLASSES[subject_type]
        for has_app in (True, False):
            if not _mounts_caller(subject_cls, has_app=has_app):
                continue
            facts = _Facts(has_app=has_app, caller_kind=subject_cls.caller_kind)
            try:
                loaded = _combined_loads(pipeline.fixed, facts)
            except _UnresolvableError as exc:
                failures.append(f"{type(pipeline).__name__} ({subject_cls.__name__}, has_app={has_app}): {exc}")
                continue
            if "caller" not in loaded:
                failures.append(
                    f"{type(pipeline).__name__} serves {subject_cls.__name__} (has_app={has_app}), whose "
                    f"mounts_caller answers True, but its fixed requirements load no caller"
                )
    assert not failures, "\n".join(["pipelines that mount without loading a caller:", *failures])


# --- Resolver self-tests -----------------------------------------------------------------
# Pure-AST fixtures (no import needed) proving the resolver's own edge cases, mirroring
# `test_handler_seam_bind.py`'s mutation tests for its checker.


_BLANKET = _Facts(has_app=None, caller_kind=None)


def _home_from_source(
    source: str, *, module_name: str = "fake_module"
) -> tuple[_Home, ast.FunctionDef | ast.AsyncFunctionDef]:
    tree = ast.parse(source)
    function = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef))
    owner_class = next((node for node in tree.body if isinstance(node, ast.ClassDef)), None)
    return _Home(module_name=module_name, module_ast=tree, owner_class=owner_class), function


def test_resolver_follows_a_same_module_helper() -> None:
    """The brief's own example: `_assert_member` calling `load_workspace_role` makes
    `CheckAppWorkspaceMembership` load it transitively."""
    home, run = _home_from_source(
        "def _helper(ctx):\n    load_workspace_role(ctx)\n\ndef run(subject, ctx, session):\n    _helper(ctx)\n"
    )
    assert "workspace_role" in _resolve_loads(run, home, set(), _BLANKET)


def test_resolver_follows_a_self_method() -> None:
    home, run = _home_from_source(
        "class Probe:\n"
        "    def run(self, subject, ctx, session):\n"
        "        self._helper(ctx)\n\n"
        "    def _helper(self, ctx):\n"
        "        load_app(ctx)\n"
    )
    assert _resolve_loads(run, home, set(), _BLANKET) == frozenset({"app"})


def test_resolver_reports_an_aliased_loader_as_unresolvable() -> None:
    home, run = _home_from_source(
        "from controllers.openapi.auth.loaders import load_app as _hidden\n\n"
        "def run(subject, ctx, session):\n    _hidden(ctx)\n"
    )
    with pytest.raises(_UnresolvableError, match="alias"):
        _resolve_loads(run, home, set(), _BLANKET)


def test_resolver_reports_dynamic_dispatch_as_unresolvable() -> None:
    home, run = _home_from_source("def run(subject, ctx, session):\n    getattr(self, 'x')(ctx)\n")
    with pytest.raises(_UnresolvableError, match="dynamically"):
        _resolve_loads(run, home, set(), _BLANKET)


def test_resolver_ignores_a_call_on_a_foreign_receiver() -> None:
    """`subject.mounts_caller(ctx)` cannot reach `loaders.py` — the exact call that would
    otherwise make this scan cry wolf on every route `ResolveCaller` runs on."""
    home, run = _home_from_source(
        "def run(subject, ctx, session):\n    subject.mounts_caller(ctx)\n    load_caller(ctx)\n"
    )
    assert _resolve_loads(run, home, set(), _BLANKET) == frozenset({"caller"})


def test_resolver_respects_a_decided_has_app_guard_clause() -> None:
    """The precise bug this scan exists to avoid reintroducing: a blanket walk that ignores
    `if not ctx.has_app: return` would count `load_app` as loaded on every route, including
    ones with no `app_id` in the path at all."""
    home, run = _home_from_source(
        "def run(subject, ctx, session):\n    if not ctx.has_app:\n        return\n    load_app(ctx)\n"
    )
    assert _resolve_loads(run, home, set(), _Facts(has_app=False, caller_kind=None)) == frozenset()
    assert _resolve_loads(run, home, set(), _Facts(has_app=True, caller_kind=None)) == frozenset({"app"})


def test_resolver_respects_a_decided_caller_kind_guard_clause() -> None:
    """`_assert_member`'s own guard: an end-user subject never reaches `load_workspace_role`."""
    home, run = _home_from_source(
        "def run(subject, ctx, session):\n"
        "    if subject.caller_kind is not CallerKind.ACCOUNT:\n"
        "        return\n"
        "    load_workspace_role(ctx)\n"
    )
    assert _resolve_loads(run, home, set(), _Facts(has_app=None, caller_kind=CallerKind.END_USER)) == frozenset()
    loaded = _resolve_loads(run, home, set(), _Facts(has_app=None, caller_kind=CallerKind.ACCOUNT))
    assert "workspace_role" in loaded


def test_resolver_walks_both_branches_of_an_undecidable_guard_without_truncating() -> None:
    """`RBACCheck`'s `dify_config.RBAC_ENABLED` gate is exactly this shape: undecidable, so
    both arms count, and — unlike a decided guard clause — nothing after the `if` is
    dropped just because one arm happens to return."""
    home, run = _home_from_source(
        "def run(subject, ctx, session):\n"
        "    if some_flag:\n"
        "        load_app(ctx)\n"
        "    else:\n"
        "        return\n"
        "    load_caller(ctx)\n"
    )
    assert _resolve_loads(run, home, set(), _BLANKET) == frozenset({"app", "caller"})


def test_handler_scan_flags_ctx_handed_to_a_helper() -> None:
    def handler(_self, ctx):
        _process(ctx)  # never called, only its AST is scanned

    with pytest.raises(_UnresolvableError, match="ctx"):
        _handler_ctx_reads(handler)


def test_handler_scan_ignores_non_loadable_attrs() -> None:
    def handler(_self, ctx):
        _ = ctx.session
        _ = ctx.subject.caller_kind

    assert _handler_ctx_reads(handler) == frozenset()


def test_handler_scan_collects_loadable_reads() -> None:
    def handler(_self, ctx):
        _ = ctx.app
        _ = ctx.caller.id

    assert _handler_ctx_reads(handler) == frozenset({"app", "caller"})
