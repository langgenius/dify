import ast
import functools
import inspect
import sys
import textwrap
from collections.abc import Callable, Generator
from contextlib import contextmanager

import pytest
from flask_restx import Namespace, abort
from pydantic import BaseModel, ValidationError

from dev import lint_error_responses as lint
from libs.exception import BaseHTTPException


class _MissingError(BaseHTTPException):
    error_code = "missing_thing"
    code = 404


class _GuardError(BaseHTTPException):
    error_code = "guard_denied"
    code = 403


class _ServiceError(Exception):
    pass


class _NeverRaisedServiceError(Exception):
    pass


class _Payload(BaseModel):
    name: str


def _service() -> None:
    raise _ServiceError()


def _guard(*, strict: bool = False) -> Callable[[Callable[[], object]], Callable[[], object]]:
    def decorator(view: Callable[[], object]) -> Callable[[], object]:
        def decorated() -> object:
            if strict:
                raise _GuardError()
            return view()

        return decorated

    return decorator


def _handler() -> None:
    _Payload.model_validate({})
    try:
        _service()
    except _ServiceError:
        raise _MissingError()
    try:
        pass
    except _NeverRaisedServiceError:
        raise _GuardError()
    abort(409)


def _validating_handler() -> None:
    try:
        _Payload.model_validate({})
    except ValidationError:
        raise _MissingError()


def _delegating_handler() -> None:
    _service()


def _swallowing_handler() -> None:
    try:
        _service()
        raise _MissingError()
    except (_ServiceError, _MissingError):
        pass


def _passthrough_handler() -> None:
    try:
        raise _MissingError()
    except (BaseHTTPException, ValueError):
        raise
    except Exception as error:
        raise _GuardError() from error


def _named_reraise_handler() -> None:
    try:
        raise _MissingError()
    except BaseHTTPException as error:
        raise error


def _missing_factory() -> BaseHTTPException:
    return _MissingError()


def _denied_or_missing_factory(denied: bool) -> BaseHTTPException:
    if denied:
        return _GuardError()
    return _missing_factory()


def _factory_handler() -> None:
    raise _denied_or_missing_factory(False)


@pytest.fixture
def analyzer(monkeypatch: pytest.MonkeyPatch) -> lint.RaiseAnalyzer:
    monkeypatch.setattr(lint, "RECURSE_PREFIXES", (__name__,))
    return lint.RaiseAnalyzer(modules=[sys.modules[__name__]])


def test_infers_raises_translations_aborts_and_validation(analyzer: lint.RaiseAnalyzer) -> None:
    from werkzeug.exceptions import Conflict

    raised = analyzer.raises_of_function(_handler, None, 0)

    assert {_MissingError, Conflict, ValueError} <= raised
    # The callee's raise is translated by the handler's ``except``, so only the translation escapes.
    assert _ServiceError not in raised
    assert _ServiceError in analyzer.raises_of_function(_delegating_handler, None, 0)


def test_caught_exceptions_do_not_escape(analyzer: lint.RaiseAnalyzer) -> None:
    assert analyzer.raises_of_function(_swallowing_handler, None, 0) == set()


def test_bare_and_named_reraises_escape_what_the_handler_caught(analyzer: lint.RaiseAnalyzer) -> None:
    passthrough = analyzer.raises_of_function(_passthrough_handler, None, 0)
    assert _MissingError in passthrough
    # Every handler body is analysed, since an exception this analysis cannot see may reach it.
    assert _GuardError in passthrough
    assert analyzer.raises_of_function(_named_reraise_handler, None, 0) == {_MissingError}


def test_skips_translations_of_exceptions_nothing_raises(analyzer: lint.RaiseAnalyzer) -> None:
    assert _GuardError not in analyzer.raises_of_function(_handler, None, 0)


def test_follows_factories_that_delegate_to_other_factories(analyzer: lint.RaiseAnalyzer) -> None:
    assert {_GuardError, _MissingError} <= analyzer.raises_of_function(_factory_handler, None, 0)


def test_keeps_translations_of_library_exceptions(analyzer: lint.RaiseAnalyzer) -> None:
    # pydantic raises ValidationError from code the analyzer never indexes, so the handler is live.
    assert _MissingError in analyzer.raises_of_function(_validating_handler, None, 0)


def test_prunes_branches_decided_by_constant_factory_arguments(analyzer: lint.RaiseAnalyzer) -> None:
    call = ast.parse("_guard(strict=True)", mode="eval").body
    assert isinstance(call, ast.Call)

    assert _GuardError not in analyzer.raises_of_function(_guard, None, 1, lint.constant_bindings(_guard, None))
    assert _GuardError in analyzer.raises_of_function(_guard, None, 1, lint.constant_bindings(_guard, call))


def test_reads_declarations_and_names_what_it_cannot_resolve() -> None:
    source = textwrap.dedent(
        """
        @error_responses(_MissingError, _GuardError, unknown.Error)
        def handler():
            pass
        """
    )
    node = ast.parse(source).body[0]
    assert isinstance(node, ast.FunctionDef)

    declaration = lint.read_declaration(node, vars(sys.modules[__name__]))

    assert declaration.exceptions == {_MissingError, _GuardError}
    assert declaration.unresolved == ["unknown.Error"]


SOURCE = """from flask_restx import Resource

from controllers.console import console_ns


class ItemApi(Resource):
    @console_ns.doc("get_item")
    def get(self):
        pass

    @error_responses(OldError)
    @console_ns.doc("delete_item")
    def delete(self):
        pass

    @error_responses(GoneError)
    def put(self):
        pass
"""


def test_apply_edits_inserts_rewrites_and_removes_decorators() -> None:
    edits = [
        lint.DecoratorEdit(class_name="ItemApi", method="get", names=("NewError",)),
        lint.DecoratorEdit(class_name="ItemApi", method="delete", names=("NewError", "OldError")),
        lint.DecoratorEdit(class_name="ItemApi", method="put", names=()),
    ]

    result = lint.apply_edits(
        SOURCE, edits, ["from libs.external_api import error_responses", "from controllers.errors import NewError"]
    )

    assert (
        result
        == """from flask_restx import Resource

from controllers.console import console_ns
from controllers.errors import NewError
from libs.external_api import error_responses


class ItemApi(Resource):
    @error_responses(NewError)
    @console_ns.doc("get_item")
    def get(self):
        pass

    @error_responses(NewError, OldError)
    @console_ns.doc("delete_item")
    def delete(self):
        pass

    def put(self):
        pass
"""
    )


def test_names_exceptions_by_their_module_binding_or_queues_an_import() -> None:
    module = sys.modules[__name__]
    imports: set[str] = set()

    assert lint._name_in_module(_MissingError, module, imports) == "_MissingError"
    assert imports == set()

    from controllers.console.app.error import AppNotFoundError

    assert lint._name_in_module(AppNotFoundError, module, imports) == "AppNotFoundError"
    assert imports == {"from controllers.console.app.error import AppNotFoundError"}


_sample_ns = Namespace("sample")


def _bodies_handler(flag: bool) -> tuple[dict[str, object], int]:
    if flag:
        return {"error": "legacy"}, 400
    if not flag:
        return {"code": "x", "message": "y", "status": 409}, 409
    abort(404, message="gone")
    _sample_ns.abort(400, message="bad scope")
    return {"result": "ok"}, 200


def test_finds_hand_built_error_bodies_and_restx_aborts() -> None:
    tree = ast.parse(inspect.getsource(_bodies_handler))
    node = tree.body[0]
    assert isinstance(node, ast.FunctionDef)

    sites = list(
        lint.error_body_sites(
            lint.RaiseAnalyzer(), node, vars(sys.modules[__name__]), None, lambda line: f"sample:{line}"
        )
    )

    assert sorted((site.status, site.standard, site.abort) for site in sites) == [
        (400, False, False),
        (400, False, True),
        (404, False, True),
        (409, True, False),
    ]


class _OtherGuardError(BaseHTTPException):
    error_code = "other_guard"
    code = 409


@contextmanager
def _translate_service_errors() -> Generator[None]:
    try:
        yield
    except _ServiceError:
        raise _MissingError()


@contextmanager
def _translate_other_errors() -> Generator[None]:
    try:
        yield
    except _ServiceError:
        raise _OtherGuardError()


def _context_manager_handler() -> None:
    with _translate_service_errors():
        _service()


def _other_context_manager_handler() -> None:
    with _translate_other_errors():
        _service()


def test_follows_context_managers_through_their_wrapper(analyzer: lint.RaiseAnalyzer) -> None:
    # contextmanager wrappers share one __code__; each must be analyzed as its own function.
    assert _MissingError in analyzer.raises_of_function(_context_manager_handler, None, 0)
    other = analyzer.raises_of_function(_other_context_manager_handler, None, 0)
    assert _OtherGuardError in other
    assert _MissingError not in other


def _leaf() -> None:
    raise _MissingError()


def _middle() -> None:
    _leaf()


def test_results_do_not_depend_on_scan_order(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(lint, "RECURSE_PREFIXES", (__name__,))
    analyzer = lint.RaiseAnalyzer(max_depth=1)

    # First reach _middle at the depth limit, where its callee is not followed...
    assert _MissingError not in analyzer.raises_of_function(_middle, None, 1)
    # ...then from a shallower call, which must follow it rather than reuse the cut-short result.
    assert _MissingError in analyzer.raises_of_function(_middle, None, 0)


def _translating[**P, R](view: Callable[P, R]) -> Callable[P, R]:
    @functools.wraps(view)
    def decorated(*args: P.args, **kwargs: P.kwargs) -> R:
        try:
            return view(*args, **kwargs)
        except _ServiceError:
            raise _OtherGuardError()

    return decorated


class _HelperResource:
    def get(self) -> None:
        self._load()

    @_translating
    def _load(self) -> None:
        _service()


def test_follows_the_decorators_of_called_helpers(analyzer: lint.RaiseAnalyzer) -> None:
    assert _OtherGuardError in analyzer.raises_of_function(_HelperResource.get, _HelperResource, 0)


class _InstanceService:
    def run(self) -> None:
        raise _MissingError()


def _instance_handler() -> None:
    service = _InstanceService()
    service.run()


def _chained_instance_handler() -> None:
    _InstanceService().run()


def test_follows_methods_called_on_instances(analyzer: lint.RaiseAnalyzer) -> None:
    assert _MissingError in analyzer.raises_of_function(_instance_handler, None, 0)
    assert _MissingError in analyzer.raises_of_function(_chained_instance_handler, None, 0)


class _FirstError(BaseHTTPException):
    error_code = "first"
    code = 400


class _SecondError(BaseHTTPException):
    error_code = "second"
    code = 409


class _FirstService:
    def run(self) -> None:
        raise _FirstError()


class _SecondService:
    def run(self) -> None:
        raise _SecondError()


def _branching_handler(first: bool) -> None:
    if first:
        service: _FirstService | _SecondService = _FirstService()
    else:
        service = _SecondService()
    service.run()


def test_follows_every_class_a_name_is_bound_to(analyzer: lint.RaiseAnalyzer) -> None:
    raised = analyzer.raises_of_function(_branching_handler, None, 0)

    assert {_FirstError, _SecondError} <= raised
