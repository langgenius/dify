"""Lint documented business errors against what Flask-RESTX views statically raise.

Business errors are documented in three places (see ``controllers/API_SCHEMA_GUIDE.md``):
``@error_responses(...)`` on a handler, ``document_errors(wrapper, ...)`` in a view
decorator, and ``document_errors(ResourceClass, ...)`` for ``method_decorators``. This
linter infers what each Console, Web and Service API operation can raise and compares it
with what those declarations document at runtime:

- missing (error): the handler body or its callees raise a business error nothing
  documents. ``--fix`` adds it to the handler's ``@error_responses``.
- undocumented decorator (error): a view decorator raises a business error it does not
  document. Fix it in the decorator; the report names it.
- placeholder code (error): the handler raises a ``BaseHTTPException`` subclass that never
  declares an ``error_code``, so nothing can document it. Declare one; ``--fix`` never
  adds such a class.
- unproduced status (warning): a declared error status that no declared or inferred error,
  hand-built body, generic handler or framework behavior produces. Declare the business
  error that produces it or drop the bare ``@ns.response(status)``.
- non-standard error body (error): the handler, or a ``controllers`` helper it calls,
  returns ``(body, 4xx/5xx)`` whose body lacks ``code``/``message``/``status`` for a
  status with no ``@ns.response(status, ..., Model)``, or calls ``flask_restx.abort``
  with a message or extra fields. Raise a ``BaseHTTPException`` instead, or declare the
  status's real model.

Inference is static and conservative toward over-reporting: it follows direct raises,
re-raises in ``except`` blocks, ``raise factory(...)`` through the exception classes the
factory returns, ``abort(<status>)``, Pydantic validation, and calls that
resolve to backend functions (``controllers``, ``libs``, ``services``, ``core``,
``machinery``) up to ``--max-depth``. Calls through instances, ``application_services()``,
signals and other dynamic dispatch are invisible, so a missing report is reliable but the
absence of one is not proof, and a declaration the lint cannot infer is left alone: it is
neither reported nor removed unless ``--fix --prune`` is asked to. A translation inside
``except X`` is skipped when ``X`` is defined in the backend and nothing in the backend
raises it; builtin and library exceptions (pydantic's ``ValidationError``) are always treated
as reachable. Inference also cannot tell which branch of a shared translator a given
operation reaches, so ``--fix`` declares the translator's whole union: give each operation a
translator that maps only what its service call raises, and the inferred set is the
documented set. ``/openapi/v1`` and resources built by factories are not linted.
"""

from __future__ import annotations

import argparse
import ast
import builtins
import inspect
import pkgutil
import subprocess
import sys
import textwrap
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import FunctionType, ModuleType
from typing import Any, cast

from flask import abort as flask_abort
from flask_restx import Namespace
from flask_restx import abort as restx_abort
from werkzeug.exceptions import HTTPException, default_exceptions
from werkzeug.exceptions import abort as werkzeug_abort

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

DECORATOR_NAME = "error_responses"
DEFAULT_MAX_DEPTH = 6
RECURSE_PREFIXES = ("controllers.", "libs.", "services.", "core.", "machinery.")
VALIDATE_ATTRS = frozenset({"model_validate", "model_validate_json", "validate_python", "validate_json"})
ABORTS = (restx_abort, flask_abort, werkzeug_abort)
HTTP_METHODS = ("get", "put", "post", "delete", "patch")
HASHABLE_CONSTANTS = (bool, int, str, type(None))

type FunctionNode = ast.FunctionDef | ast.AsyncFunctionDef


def _is_exception_class(obj: object) -> bool:
    return isinstance(obj, type) and issubclass(obj, BaseException)


def _qualname(obj: FunctionType | type) -> str:
    return f"{obj.__module__}.{obj.__qualname__}"


def _handler_types(handler: ast.ExceptHandler) -> list[ast.expr]:
    if handler.type is None:
        return []
    return list(handler.type.elts) if isinstance(handler.type, ast.Tuple) else [handler.type]


def _all_subclasses(cls: type) -> set[type]:
    seen = {cls}
    stack = [cls]
    while stack:
        for subclass in stack.pop().__subclasses__():
            if subclass not in seen:
                seen.add(subclass)
                stack.append(subclass)
    return seen


def resolve(expr: ast.AST, env: Mapping[str, object], owner: type | None) -> object:
    """The object a name or attribute chain refers to; ``self``/``cls`` resolve on ``owner``."""
    if isinstance(expr, ast.Name):
        return env.get(expr.id)
    if isinstance(expr, ast.Attribute):
        if isinstance(expr.value, ast.Name) and expr.value.id in {"self", "cls"} and owner is not None:
            return getattr(owner, expr.attr, None)  # guard-ignore: no-new-getattr -- resolves source attribute names
        base = resolve(expr.value, env, owner)
        if base is None:
            return None
        try:
            return getattr(base, expr.attr, None)  # guard-ignore: no-new-getattr -- resolves source attribute names
        except Exception:
            return None
    if isinstance(expr, ast.Call):
        # ``Service(...).method``: an instance resolves its methods like its class does.
        built = resolve(expr.func, env, owner)
        return built if isinstance(built, type) and not issubclass(built, BaseException) else None
    return None


def local_instances(node: ast.AST, env: Mapping[str, object], owner: type | None) -> dict[str, tuple[type, ...]]:
    """Classes each name is bound to via ``Class(...)`` in ``node`` (``service = Service(session)``).

    A name assigned in several branches keeps every class, so calls on it are analyzed for each.
    """
    bound: dict[str, dict[type, None]] = {}
    for child in ast.walk(node):
        targets: list[ast.expr] = []
        value: ast.expr | None = None
        if isinstance(child, ast.Assign):
            targets, value = list(child.targets), child.value
        elif isinstance(child, ast.AnnAssign) and child.value is not None:
            targets, value = [cast(ast.expr, child.target)], child.value
        elif isinstance(child, ast.withitem) and child.optional_vars is not None:
            targets, value = [child.optional_vars], child.context_expr
        if not isinstance(value, ast.Call):
            continue
        built = resolve(value, env, owner)
        if isinstance(built, type):
            for target in targets:
                if isinstance(target, ast.Name):
                    bound.setdefault(target.id, {})[built] = None
    return {name: tuple(classes) for name, classes in bound.items()}


def _eval_test(test: ast.expr, bindings: Mapping[str, object]) -> bool | None:
    """Evaluate ``if`` tests decided by constant bindings; ``None`` when undecided."""
    if isinstance(test, ast.Name):
        return bool(bindings[test.id]) if test.id in bindings else None
    if isinstance(test, ast.UnaryOp) and isinstance(test.op, ast.Not):
        inner = _eval_test(test.operand, bindings)
        return None if inner is None else not inner
    if (
        isinstance(test, ast.Compare)
        and isinstance(test.left, ast.Name)
        and test.left.id in bindings
        and len(test.ops) == 1
        and isinstance(test.comparators[0], ast.Constant)
        and test.comparators[0].value is None
    ):
        value = bindings[test.left.id]
        if isinstance(test.ops[0], ast.Is):
            return value is None
        if isinstance(test.ops[0], ast.IsNot):
            return value is not None
    return None


def _walk_pruned(nodes: Iterable[ast.AST], bindings: Mapping[str, object]) -> Iterator[ast.AST]:
    """``ast.walk`` over ``nodes`` that follows only the taken branch of decided ``if``s."""
    stack = list(nodes)
    while stack:
        node = stack.pop()
        yield node
        if isinstance(node, ast.If) and bindings:
            taken = _eval_test(node.test, bindings)
            if taken is not None:
                stack.extend(node.body if taken else node.orelse)
                continue
        stack.extend(ast.iter_child_nodes(node))


def constant_bindings(fn: Callable[..., object], call: ast.Call | None) -> dict[str, object]:
    """Constant arguments, over the defaults, that a decorator factory is called with."""
    try:
        params = list(inspect.signature(fn).parameters.values())
    except (TypeError, ValueError):
        return {}
    bindings: dict[str, object] = {
        param.name: param.default
        for param in params
        if param.default is not inspect.Parameter.empty and isinstance(param.default, HASHABLE_CONSTANTS)
    }
    if call is None:
        return bindings
    for param, arg in zip(params, call.args):
        if isinstance(arg, ast.Constant) and isinstance(arg.value, HASHABLE_CONSTANTS):
            bindings[param.name] = arg.value
        else:
            bindings.pop(param.name, None)
    for keyword in call.keywords:
        if keyword.arg is None:
            continue
        if isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, HASHABLE_CONSTANTS):
            bindings[keyword.arg] = keyword.value.value
        else:
            bindings.pop(keyword.arg, None)
    return bindings


class RaiseAnalyzer:
    """Infers the exception classes a function can raise, following resolvable backend calls."""

    def __init__(self, *, max_depth: int = DEFAULT_MAX_DEPTH, modules: Iterable[ModuleType] = ()) -> None:
        self.max_depth = max_depth
        self._memo: dict[tuple[object, ...], set[type]] = {}
        self._trees: dict[object, FunctionNode | None] = {}
        self._raised_classes: set[type] = set()
        self._unresolved_raise_names: set[str] = set()
        for module in modules:
            self._index_raises(module)

    @staticmethod
    def module_env(module: ModuleType) -> dict[str, object]:
        return {**vars(builtins), **vars(module)}

    @staticmethod
    def function_env(fn: FunctionType) -> dict[str, object]:
        env: dict[str, object] = {**vars(builtins), **fn.__globals__}
        try:
            env.update(inspect.getclosurevars(fn).nonlocals)
        except (TypeError, ValueError):
            pass
        return env

    def resolve(self, expr: ast.AST, env: Mapping[str, object], owner: type | None) -> object:
        return resolve(expr, env, owner)

    @staticmethod
    def backend_function(obj: object) -> FunctionType | None:
        if isinstance(obj, (staticmethod, classmethod)):
            obj = obj.__func__
        if inspect.ismethod(obj):
            obj = obj.__func__
        if not inspect.isfunction(obj):
            return None
        # Analyze the wrapped function itself: ``inspect.getsource`` already unwraps, so its
        # globals and cache key must come from the same function. Wrappers such as
        # ``contextlib.contextmanager`` share one ``__code__`` across every decorated function.
        obj = inspect.unwrap(obj)
        if inspect.isfunction(obj) and (obj.__module__ or "").startswith(RECURSE_PREFIXES):
            return obj
        return None

    def _index_raises(self, module: ModuleType) -> None:
        try:
            tree = ast.parse(inspect.getsource(module))
        except (OSError, TypeError, SyntaxError):
            return
        env = self.module_env(module)
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and node.exc is not None:
                target = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
                obj = self.resolve(target, env, None)
                if _is_exception_class(obj):
                    self._raised_classes.add(obj)  # type: ignore[arg-type]
                elif isinstance(target, ast.Attribute):
                    self._unresolved_raise_names.add(target.attr)
                elif isinstance(target, ast.Name):
                    self._unresolved_raise_names.add(target.id)

    def _handler_is_dead(self, handler: ast.ExceptHandler, env: Mapping[str, object], owner: type | None) -> bool:
        """An ``except X`` translating a backend-defined exception that nothing in the backend raises."""
        exprs = _handler_types(handler)
        if not exprs:
            return False
        for expr in exprs:
            caught = self.resolve(expr, env, owner)
            if not _is_exception_class(caught):
                return False
            assert isinstance(caught, type)
            # Only an exception this codebase defines can be shown unraised: builtins and library
            # errors (pydantic's ``ValidationError``, Werkzeug's) are raised by code that is not indexed.
            if issubclass(caught, HTTPException) or not (caught.__module__ or "").startswith(RECURSE_PREFIXES):
                return False
            subclasses = _all_subclasses(caught)
            if subclasses & self._raised_classes or any(
                subclass.__name__ in self._unresolved_raise_names for subclass in subclasses
            ):
                return False
        return True

    def parse_function(self, fn: FunctionType) -> FunctionNode | None:
        key = fn.__code__
        if key not in self._trees:
            node: FunctionNode | None = None
            try:
                parsed = ast.parse(textwrap.dedent(inspect.getsource(fn)))
                first = parsed.body[0] if parsed.body else None
                if isinstance(first, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    node = first
            except (OSError, TypeError, SyntaxError):
                pass
            self._trees[key] = node
        return self._trees[key]

    def raises_of_function(
        self,
        fn: FunctionType,
        owner: type | None,
        depth: int,
        bindings: Mapping[str, object] | None = None,
    ) -> set[type]:
        """What ``fn``'s body (not its decorators) can raise."""
        node = self.parse_function(fn)
        if node is None:
            return set()
        bindings = dict(bindings or {})
        # Depth is part of the key: a result cut short at the depth limit must not be reused
        # by a shallower call that could follow further.
        key = (fn.__code__, owner, frozenset(bindings.items()), depth)
        return self._raises_in(node, self.function_env(fn), owner, depth, bindings, key)

    def raises_of_node(self, node: FunctionNode, env: Mapping[str, object], owner: type | None) -> set[type]:
        return self._raises_in(node, env, owner, 0, {}, (node, owner))

    def _raises_in(
        self,
        node: FunctionNode,
        env: Mapping[str, object],
        owner: type | None,
        depth: int,
        bindings: Mapping[str, object],
        key: tuple[object, ...],
    ) -> set[type]:
        if key in self._memo:
            return self._memo[key]
        self._memo[key] = set()  # breaks recursion cycles

        parents: dict[ast.AST, ast.AST] = {}
        for statement in node.body:
            for parent in ast.walk(statement):
                for child in ast.iter_child_nodes(parent):
                    parents[child] = parent

        def enclosing_handler(child: ast.AST, name: str | None) -> ast.ExceptHandler | None:
            current = parents.get(child)
            while current is not None:
                if isinstance(current, ast.ExceptHandler) and (name is None or current.name == name):
                    return current
                current = parents.get(current)
            return None

        instances = local_instances(node, env, owner)
        env = {**env, **{name: classes[0] for name, classes in instances.items() if len(classes) == 1}}
        branching = {name: classes for name, classes in instances.items() if len(classes) > 1}
        found: set[type] = set()
        for child in _walk_pruned(node.body, bindings):
            if isinstance(child, ast.Raise):
                handler = enclosing_handler(child, None)
                if handler is not None and self._handler_is_dead(handler, env, owner):
                    continue
                found |= self._raised_by(child, env, owner, enclosing_handler)
            elif isinstance(child, ast.Call):
                found |= self._raised_by_call(child, env, owner, depth, branching)

        self._memo[key] = found
        return found

    def _raised_by(
        self,
        node: ast.Raise,
        env: Mapping[str, object],
        owner: type | None,
        enclosing_handler: Callable[[ast.AST, str | None], ast.ExceptHandler | None],
    ) -> set[type]:
        def caught_by(handler: ast.ExceptHandler | None) -> set[type]:
            if handler is None:
                return set()
            types = {self.resolve(expr, env, owner) for expr in _handler_types(handler)}
            # Re-raising a catch-all says nothing stable about what escapes.
            return {t for t in types if _is_exception_class(t) and t not in (Exception, BaseException)}  # type: ignore[misc]

        if node.exc is None:
            return caught_by(enclosing_handler(node, None))
        target = node.exc.func if isinstance(node.exc, ast.Call) else node.exc
        obj = self.resolve(target, env, owner)
        if _is_exception_class(obj):
            return {obj}  # type: ignore[set-item]
        factory = self.backend_function(obj) if isinstance(node.exc, ast.Call) else None
        if factory is not None:
            return self._returned_exceptions(factory)
        if isinstance(target, ast.Name):
            return caught_by(enclosing_handler(node, target.id))
        return set()

    def _returned_exceptions(self, factory: FunctionType, visited: set[object] | None = None) -> set[type]:
        """Exception classes ``factory`` builds in its ``return`` statements (``raise factory(...)``).

        A factory that returns another backend factory's result contributes that factory's classes too.
        """
        visited = set() if visited is None else visited
        if factory.__code__ in visited:
            return set()
        visited.add(factory.__code__)
        node = self.parse_function(factory)
        if node is None:
            return set()
        env = self.function_env(factory)
        found: set[type] = set()
        for child in ast.walk(node):
            if isinstance(child, ast.Return) and isinstance(child.value, ast.Call):
                built = self.resolve(child.value.func, env, None)
                if _is_exception_class(built):
                    found.add(built)  # type: ignore[arg-type]
                elif (delegate := self.backend_function(built)) is not None:
                    found |= self._returned_exceptions(delegate, visited)
        return found

    def _raised_by_call(
        self,
        node: ast.Call,
        env: Mapping[str, object],
        owner: type | None,
        depth: int,
        branching: Mapping[str, tuple[type, ...]],
    ) -> set[type]:
        receiver = node.func.value if isinstance(node.func, ast.Attribute) else None
        if branching and isinstance(receiver, ast.Name) and receiver.id in branching:
            # ``service.run()`` where branches bind ``service`` to different classes: any may run.
            found_any: set[type] = set()
            for cls in branching[receiver.id]:
                found_any |= self._raised_by_call(node, {**env, receiver.id: cls}, owner, depth, {})
            return found_any
        found: set[type] = set()
        if isinstance(node.func, ast.Attribute) and node.func.attr in VALIDATE_ATTRS:
            found.add(ValueError)
        obj = self.resolve(node.func, env, owner)
        if any(obj is abort for abort in ABORTS):
            status = node.args[0] if node.args else None
            if isinstance(status, ast.Constant) and isinstance(status.value, int):
                exception = default_exceptions.get(status.value)
                if exception is not None:
                    found.add(exception)
            return found
        target = self.backend_function(obj)
        if target is None or depth >= self.max_depth:
            return found
        call_owner = owner
        if isinstance(node.func, ast.Attribute):
            base = self.resolve(node.func.value, env, owner)
            if isinstance(base, type):
                call_owner = base
        found |= self.raises_of_function(target, call_owner, depth + 1)
        callee = self.parse_function(target)
        if callee is not None:
            # The callee's own decorators (e.g. an error-translating wrapper) raise on its behalf.
            for decorator, bindings in self.decorators_of(callee, self.function_env(target), call_owner):
                found |= self.raises_of_function(decorator, call_owner, depth + 1, bindings)
        return found

    def decorators_of(
        self, node: FunctionNode, env: Mapping[str, object], owner: type | None
    ) -> Iterator[tuple[FunctionType, dict[str, object]]]:
        """Backend view decorators applied to ``node``, with their constant factory arguments."""
        for decorator in node.decorator_list:
            call = decorator if isinstance(decorator, ast.Call) else None
            target = call.func if call is not None else decorator
            fn = self.backend_function(self.resolve(target, env, owner))
            if fn is not None:
                yield fn, constant_bindings(fn, call)


# ---- declarations -------------------------------------------------------------------


@dataclass
class Declaration:
    """The ``@error_responses(...)`` on a handler, as written."""

    node: ast.Call | None
    exceptions: set[type] = field(default_factory=set)
    unresolved: list[str] = field(default_factory=list)


def _decorator_call(node: FunctionNode) -> ast.Call | None:
    for decorator in node.decorator_list:
        if (
            isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Name)
            and decorator.func.id == DECORATOR_NAME
        ):
            return decorator
    return None


def read_declaration(node: FunctionNode, env: Mapping[str, object]) -> Declaration:
    call = _decorator_call(node)
    declaration = Declaration(node=call)
    if call is None:
        return declaration

    def collect(exprs: Iterable[ast.expr], into: set[type]) -> None:
        for expr in exprs:
            obj = resolve(expr, env, None)
            if _is_exception_class(obj):
                into.add(obj)  # type: ignore[arg-type]
            else:
                declaration.unresolved.append(ast.unparse(expr))

    collect(call.args, declaration.exceptions)
    return declaration


def operation_doc(resource: type, method: str) -> dict[str, Any]:
    """The merged class and method Flask-RESTX doc for one operation."""
    from flask_restx.utils import merge

    def inherited(name: str) -> object:
        return next((klass.__dict__[name] for klass in resource.__mro__ if name in klass.__dict__), None)

    method_impl = inherited(method)
    method_doc = vars(method_impl).get("__apidoc__") if isinstance(method_impl, FunctionType) else None
    class_docs = inherited("__apidoc__")
    class_doc = class_docs.get(method) if isinstance(class_docs, dict) else None
    return merge(
        class_doc if isinstance(class_doc, dict) else {},
        method_doc if isinstance(method_doc, dict) else {},
    )


def documented_at_runtime(resource: type, method: str) -> set[type]:
    """Errors the merged class and method docs document for one operation."""
    from libs.external_api import ERROR_CODES_VENDOR_KEY

    names = (operation_doc(resource, method).get("vendor") or {}).get(ERROR_CODES_VENDOR_KEY, {})
    return {pkgutil.resolve_name(name) for name in names}


def explicit_error_statuses(doc: Mapping[str, Any]) -> set[int]:
    """Statuses whose response declares its own model (``@ns.response(status, ..., Model)``)."""
    statuses = set()
    for status, entry in (doc.get("responses") or {}).items():
        if isinstance(entry, (tuple, list)) and len(entry) >= 2 and entry[1] is not None:
            statuses.add(int(status))
    return statuses


# ---- error bodies --------------------------------------------------------------------

STANDARD_BODY_KEYS = frozenset({"code", "message", "status"})


@dataclass(frozen=True)
class BodySite:
    """A hand-built error response: ``return body, status`` or ``abort(..., message=...)`` (module or namespace)."""

    location: str
    status: int | None
    standard: bool
    abort: bool


def _status_value(expr: ast.expr, env: Mapping[str, object]) -> int | None:
    value = expr.value if isinstance(expr, ast.Constant) else resolve(expr, env, None)
    if isinstance(value, int) and not isinstance(value, bool) and 400 <= value < 600:
        return int(value)
    return None


def _body_is_standard(body: ast.expr) -> bool:
    if not isinstance(body, ast.Dict):
        return False
    keys = {key.value for key in body.keys if isinstance(key, ast.Constant)}
    return keys >= STANDARD_BODY_KEYS


def error_body_sites(
    analyzer: RaiseAnalyzer,
    node: FunctionNode,
    env: Mapping[str, object],
    owner: type | None,
    location: Callable[[int], str],
    *,
    depth: int = 2,
    visited: set[object] | None = None,
) -> Iterator[BodySite]:
    """Hand-built error responses in ``node`` and in the ``controllers`` helpers it calls."""
    visited = set() if visited is None else visited
    for child in ast.walk(node):
        if child is not node and isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            continue
        if isinstance(child, ast.Return) and isinstance(child.value, ast.Tuple) and len(child.value.elts) >= 2:
            status = _status_value(child.value.elts[1], env)
            if status is not None:
                yield BodySite(location(child.lineno), status, _body_is_standard(child.value.elts[0]), abort=False)
        elif isinstance(child, ast.Call):
            target = resolve(child.func, env, owner)
            if target is restx_abort or (inspect.ismethod(target) and target.__func__ is Namespace.abort):
                if len(child.args) > 1 or child.keywords:
                    status = _status_value(child.args[0], env) if child.args else None
                    yield BodySite(location(child.lineno), status, standard=False, abort=True)
                continue
            fn = analyzer.backend_function(target)
            if fn is None or depth == 0 or fn in visited or not fn.__module__.startswith("controllers."):
                continue
            visited.add(fn)
            helper = analyzer.parse_function(fn)
            if helper is None:
                continue
            try:
                path = Path(inspect.getsourcefile(fn) or "")
                first_line = inspect.getsourcelines(fn)[1]
            except (OSError, TypeError):
                continue
            yield from error_body_sites(
                analyzer,
                helper,
                analyzer.function_env(fn),
                owner,
                lambda line, path=path, first_line=first_line: f"{path.relative_to(API_ROOT)}:{first_line + line - 1}",
                depth=depth - 1,
                visited=visited,
            )


# ---- lint ---------------------------------------------------------------------------


@dataclass
class HandlerReport:
    path: Path
    class_name: str
    method: str
    line: int
    module: ModuleType
    declaration: Declaration
    inferred: set[type] = field(default_factory=set)
    missing: set[type] = field(default_factory=set)

    @property
    def location(self) -> str:
        return f"{self.path.relative_to(API_ROOT)}:{self.line}: {self.class_name}.{self.method}"

    @property
    def stale(self) -> set[type]:
        """Declared but not inferred: a hand declaration behind dynamic dispatch, or a leftover.

        Only ``--prune`` acts on it."""
        return self.declaration.exceptions - self.inferred


@dataclass
class LintResult:
    handlers: dict[tuple[Path, str, str], HandlerReport] = field(default_factory=dict)
    # decorator qualname -> undocumented business errors, and how many operations hit it
    decorator_gaps: dict[str, set[type]] = field(default_factory=lambda: defaultdict(set))
    decorator_hits: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    decorator_sources: dict[str, str] = field(default_factory=dict)
    # hand-built error body site -> the operations whose spec misdescribes it
    body_violations: dict[BodySite, set[str]] = field(default_factory=lambda: defaultdict(set))
    # business error class that keeps the placeholder error_code -> the operations raising it
    placeholder_codes: dict[type, set[str]] = field(default_factory=lambda: defaultdict(set))
    # operation -> declared error statuses nothing inferred, generic or framework-level can produce
    unproduced: dict[str, set[int]] = field(default_factory=lambda: defaultdict(set))
    skipped: list[str] = field(default_factory=list)


def _find_method_node(owner: type, method: str) -> tuple[Path, FunctionNode] | None:
    try:
        path = Path(inspect.getsourcefile(owner) or "")
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (OSError, TypeError, SyntaxError):
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == owner.__name__:
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == method:
                    return path, item
    return None


def _source_location(fn: Callable[..., object]) -> str:
    try:
        path = Path(inspect.getsourcefile(fn) or "")
        line = inspect.getsourcelines(fn)[1]
        return f"{path.relative_to(API_ROOT)}:{line}"
    except (OSError, TypeError, ValueError):
        return _qualname(fn)


def lint(apis: Mapping[str, Any], analyzer: RaiseAnalyzer) -> LintResult:
    from libs.exception import RelayedHTTPError
    from libs.external_api import is_business_error, keeps_placeholder_error_code

    result = LintResult()
    for api in apis.values():

        def business(exceptions: Iterable[type], where: str, api: Any = api) -> set[type]:
            documentable = set()
            for exception in exceptions:
                if not is_business_error(exception) or api.is_generic_error(exception):
                    continue
                if issubclass(exception, RelayedHTTPError):
                    # Documented to keep the operation's codes open; it has no static status.
                    documentable.add(exception)
                    continue
                try:
                    api.resolve_error(exception)
                except ValueError:
                    continue
                if keeps_placeholder_error_code(exception):
                    # Nothing can document it until it declares a code; reported, never fixed.
                    result.placeholder_codes[exception].add(where)
                    continue
                documentable.add(exception)
            return documentable

        for namespace in api.namespaces:
            for route in namespace.resources:
                resource = route.resource
                for method in sorted(m.lower() for m in (resource.methods or [])):
                    owner = next((k for k in resource.__mro__ if method in k.__dict__), None)
                    if owner is None:
                        continue
                    located = _find_method_node(owner, method)
                    if located is None:
                        result.skipped.append(f"{_qualname(resource)}.{method}: source not found")
                        continue
                    path, node = located
                    if not path.is_relative_to(API_ROOT / "controllers"):
                        continue
                    module = sys.modules[owner.__module__]
                    env = analyzer.module_env(module)
                    documented = documented_at_runtime(resource, method)
                    doc = operation_doc(resource, method)
                    explicit = explicit_error_statuses(doc)
                    produced: set[int] = set()
                    for site in error_body_sites(
                        analyzer,
                        node,
                        env,
                        resource,
                        lambda line, path=path: f"{path.relative_to(API_ROOT)}:{line}",
                    ):
                        if site.status is not None:
                            produced.add(site.status)
                        if site.abort or (not site.standard and site.status not in explicit):
                            result.body_violations[site].add(f"{owner.__name__}.{method}")

                    key = (path, owner.__name__, method)
                    report = result.handlers.get(key)
                    if report is None:
                        report = HandlerReport(
                            path=path,
                            class_name=owner.__name__,
                            method=method,
                            line=node.lineno,
                            module=module,
                            declaration=read_declaration(node, env),
                        )
                        result.handlers[key] = report
                    raised_by_handler = analyzer.raises_of_node(node, env, resource)
                    inferred = business(raised_by_handler, f"{owner.__name__}.{method}")
                    report.inferred |= inferred
                    report.missing |= inferred - documented

                    guards: list[tuple[str, FunctionType, set[type]]] = []
                    for decorator, bindings in analyzer.decorators_of(node, env, resource):
                        raised = analyzer.raises_of_function(decorator, resource, 1, bindings)
                        guards.append((_qualname(decorator), decorator, raised))
                    for klass in resource.__mro__:
                        for guard in klass.__dict__.get("method_decorators", None) or []:
                            fn = analyzer.backend_function(guard)
                            if fn is not None:
                                label = f"{_qualname(klass)}.method_decorators[{fn.__name__}]"
                                guards.append((label, fn, analyzer.raises_of_function(fn, resource, 1)))
                    for label, fn, raised in guards:
                        gaps = business(raised, label) - documented
                        if gaps:
                            result.decorator_gaps[label] |= gaps
                            result.decorator_hits[label] += 1
                            result.decorator_sources[label] = _source_location(fn)

                    for exception in raised_by_handler.union(*(raised for _, _, raised in guards)):
                        if exception is HTTPException or not issubclass(exception, Exception):
                            continue
                        try:
                            produced.add(api.resolve_error(exception)[0])
                        except ValueError:
                            continue
                    for exception in documented:
                        # A hand declaration for an error raised through dynamic dispatch still produces its status.
                        try:
                            produced.add(api.resolve_error(exception)[0])
                        except ValueError:
                            continue
                    produced |= _framework_statuses(doc, route.urls) | api.generic_error_statuses()
                    declared = {int(status) for status in doc.get("responses") or {} if str(status)[:1] in "45"}
                    if unproduced := declared - produced:
                        result.unproduced[f"{report.location} {method.upper()}"] |= unproduced
    return result


def _framework_statuses(doc: Mapping[str, Any], urls: Iterable[str]) -> set[int]:
    """Statuses Flask/werkzeug can answer for any operation of this shape."""
    statuses = {500}  # unhandled exceptions reach the catch-all handler
    if doc.get("expect"):
        statuses |= {400, 415}  # malformed or non-JSON request bodies
    if any("<uuid:" in url or "<int:" in url for url in urls):
        statuses.add(404)  # typed path parameters that fail to convert
    return statuses


# ---- fix ----------------------------------------------------------------------------


@dataclass(frozen=True)
class DecoratorEdit:
    """The ``@error_responses`` a handler should carry after fixing."""

    class_name: str
    method: str
    names: tuple[str, ...]


def _render(edit: DecoratorEdit) -> str:
    return f"@{DECORATOR_NAME}({', '.join(edit.names)})"


def apply_edits(source: str, edits: Sequence[DecoratorEdit], imports: Iterable[str]) -> str:
    """Rewrite or insert each handler's ``@error_responses`` and add ``imports``.

    Output is unformatted; run ruff format and import sorting afterwards.
    """
    tree = ast.parse(source)
    lines = source.splitlines(keepends=True)
    replacements: list[tuple[int, int, str]] = []  # (start index, end index, text), 0-based, end exclusive
    for edit in edits:
        node = next(
            (
                item
                for class_node in ast.walk(tree)
                if isinstance(class_node, ast.ClassDef) and class_node.name == edit.class_name
                for item in class_node.body
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == edit.method
            ),
            None,
        )
        if node is None:
            raise ValueError(f"{edit.class_name}.{edit.method} not found")
        call = _decorator_call(node)
        text = "" if not edit.names else f"{' ' * node.col_offset}{_render(edit)}\n"
        if call is not None:
            replacements.append((call.lineno - 1, call.end_lineno or call.lineno, text))
        elif text:
            first = node.decorator_list[0] if node.decorator_list else node
            replacements.append((first.lineno - 1, first.lineno - 1, text))
    for start, end, text in sorted(replacements, reverse=True):
        lines[start:end] = [text] if text else []

    new_imports = sorted(set(imports))
    if new_imports:
        last_import = 0
        for statement in tree.body:
            if isinstance(statement, (ast.Import, ast.ImportFrom)):
                last_import = statement.end_lineno or statement.lineno
            elif last_import:
                break
        lines[last_import:last_import] = [f"{line}\n" for line in new_imports]
    return "".join(lines)


def _name_in_module(exception: type, module: ModuleType, imports: set[str]) -> str | None:
    """How ``module`` can refer to ``exception``, queuing an import when it cannot yet."""
    namespace = vars(module)
    if namespace.get(exception.__name__) is exception:
        return exception.__name__
    for name, value in namespace.items():
        if value is exception and not name.startswith("_"):
            return name
    if exception.__name__ in namespace:
        return None
    imports.add(f"from {exception.__module__} import {exception.__name__}")
    return exception.__name__


def plan_fixes(
    result: LintResult, *, prune: bool
) -> tuple[dict[Path, list[DecoratorEdit]], dict[Path, set[str]], list[str]]:
    """The decorator edits and imports per file, plus handlers that cannot be fixed automatically."""
    from libs.external_api import error_responses

    edits: dict[Path, list[DecoratorEdit]] = defaultdict(list)
    imports: dict[Path, set[str]] = defaultdict(set)
    unfixable: list[str] = []
    for report in result.handlers.values():
        declared = report.declaration.exceptions - (report.stale if prune else set())
        if declared | report.missing == report.declaration.exceptions:
            continue
        if report.declaration.unresolved:
            unfixable.append(f"{report.location}: cannot resolve {', '.join(report.declaration.unresolved)}")
            continue
        file_imports: set[str] = set()
        rendered: dict[type, str | None] = {
            exception: _name_in_module(exception, report.module, file_imports)
            for exception in declared | report.missing
        }
        shadowed = [exception.__name__ for exception, name in rendered.items() if name is None]
        if shadowed:
            unfixable.append(f"{report.location}: {', '.join(sorted(shadowed))} shadowed in the module")
            continue
        names = sorted((rendered[e] or "" for e in declared | report.missing), key=str.lower)
        if names and vars(report.module).get(DECORATOR_NAME) is not error_responses:
            file_imports.add(f"from libs.external_api import {DECORATOR_NAME}")
        edits[report.path].append(DecoratorEdit(class_name=report.class_name, method=report.method, names=tuple(names)))
        imports[report.path] |= file_imports
    return edits, imports, unfixable


def _ruff(paths: Sequence[Path]) -> None:
    files = [str(path) for path in paths]
    subprocess.run(
        [sys.executable, "-m", "ruff", "check", "--select", "I,F401", "--fix", "--quiet", *files], check=False
    )
    subprocess.run([sys.executable, "-m", "ruff", "format", "--quiet", *files], check=False)


# ---- cli ----------------------------------------------------------------------------


def _target_apis() -> dict[str, Any]:
    from dev.generate_swagger_specs import create_spec_app

    create_spec_app()
    from controllers.console import api as console_api
    from controllers.service_api import api as service_api
    from controllers.web import api as web_api

    # /openapi/v1 admits through polymorphic Requirement checks that static analysis cannot follow.
    return {"console": console_api, "web": web_api, "service": service_api}


def _emit(line: str) -> None:
    sys.stdout.write(f"{line}\n")


def _names(exceptions: Iterable[type]) -> str:
    return ", ".join(sorted(exception.__name__ for exception in exceptions))


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--fix", action="store_true", help="add missing errors to handlers' @error_responses")
    parser.add_argument(
        "--prune",
        action="store_true",
        help="with --fix, also remove entries the handler is not inferred to raise; review the result, since "
        "inference cannot see dynamic dispatch and a hand declaration behind it is right",
    )
    parser.add_argument("--max-depth", type=int, default=DEFAULT_MAX_DEPTH, help="call depth to follow")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    apis = _target_apis()
    modules = [
        module
        for module in list(sys.modules.values())
        if isinstance(file := vars(module).get("__file__"), str)
        and Path(file).is_relative_to(API_ROOT)
        and not Path(file).is_relative_to(API_ROOT / "tests")
        and not Path(file).is_relative_to(API_ROOT / ".venv")
    ]
    result = lint(apis, RaiseAnalyzer(max_depth=args.max_depth, modules=modules))

    failures = 0
    if args.fix:
        edits, imports, unfixable = plan_fixes(result, prune=args.prune)
        for path, file_edits in edits.items():
            source = path.read_text(encoding="utf-8")
            path.write_text(apply_edits(source, file_edits, imports[path]), encoding="utf-8")
        if edits:
            _ruff(list(edits))
        fixed = {(path, edit.class_name, edit.method) for path, file_edits in edits.items() for edit in file_edits}
        _emit(f"fixed {len(fixed)} handlers in {len(edits)} files")
        for message in unfixable:
            _emit(f"error: {message}")
            failures += 1
    else:
        fixed = set()

    for key, report in sorted(result.handlers.items(), key=lambda item: item[1].location):
        if report.missing and key not in fixed:
            _emit(f"error: {report.location}: raises undocumented {_names(report.missing)} (run with --fix)")
            failures += 1
    for site, operations in sorted(result.body_violations.items(), key=lambda item: item[0].location):
        where = ", ".join(sorted(operations))
        if site.abort:
            _emit(
                f"error: {site.location}: flask_restx.abort with a message or extra fields replaces the standard "
                f"error body ({where}); raise an HTTPException instead"
            )
        else:
            _emit(
                f"error: {site.location}: non-standard error body with {site.status} ({where}); raise a "
                f"BaseHTTPException or declare @ns.response({site.status}, ..., Model) for it"
            )
        failures += 1
    for label, gaps in sorted(result.decorator_gaps.items()):
        _emit(
            f"error: {result.decorator_sources[label]}: {label} raises {_names(gaps)} without document_errors "
            f"({result.decorator_hits[label]} operations)"
        )
        failures += 1
    for exception, operations in sorted(result.placeholder_codes.items(), key=lambda item: _qualname(item[0])):
        _emit(
            f"error: {_qualname(exception)} keeps the placeholder error_code; declare one so "
            f"{', '.join(sorted(operations))} can document it"
        )
        failures += 1
    for operation, statuses in sorted(result.unproduced.items()):
        _emit(
            f"warning: {operation}: declares {', '.join(map(str, sorted(statuses)))} that nothing produces; "
            "declare the business error behind it or drop the bare @ns.response"
        )
    for message in result.skipped:
        _emit(f"skipped: {message}")
    _emit(f"{len(result.handlers)} handlers checked, {failures} errors")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
