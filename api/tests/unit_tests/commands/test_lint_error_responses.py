import ast
import inspect
import sys
import textwrap
from collections.abc import Callable

import pytest
from flask_restx import abort
from pydantic import BaseModel

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


@pytest.fixture
def analyzer(monkeypatch: pytest.MonkeyPatch) -> lint.RaiseAnalyzer:
    monkeypatch.setattr(lint, "RECURSE_PREFIXES", (__name__,))
    return lint.RaiseAnalyzer(modules=[sys.modules[__name__]])


def test_infers_raises_translations_aborts_and_validation(analyzer: lint.RaiseAnalyzer) -> None:
    from werkzeug.exceptions import Conflict

    raised = analyzer.raises_of_function(_handler, None, 0)

    assert {_MissingError, Conflict, ValueError} <= raised
    # The callee's own raise is followed too.
    assert _ServiceError in raised


def test_skips_translations_of_exceptions_nothing_raises(analyzer: lint.RaiseAnalyzer) -> None:
    assert _GuardError not in analyzer.raises_of_function(_handler, None, 0)


def test_prunes_branches_decided_by_constant_factory_arguments(analyzer: lint.RaiseAnalyzer) -> None:
    call = ast.parse("_guard(strict=True)", mode="eval").body
    assert isinstance(call, ast.Call)

    assert _GuardError not in analyzer.raises_of_function(_guard, None, 1, lint.constant_bindings(_guard, None))
    assert _GuardError in analyzer.raises_of_function(_guard, None, 1, lint.constant_bindings(_guard, call))


def test_reads_declarations_with_unreachable_entries() -> None:
    source = textwrap.dedent(
        """
        @error_responses(_MissingError, unreachable=(_GuardError,))
        def handler():
            pass
        """
    )
    node = ast.parse(source).body[0]
    assert isinstance(node, ast.FunctionDef)

    declaration = lint.read_declaration(node, vars(sys.modules[__name__]))

    assert declaration.exceptions == {_MissingError}
    assert declaration.unreachable == {_GuardError}
    assert declaration.unresolved == []


SOURCE = """from flask_restx import Resource

from controllers.console import console_ns


class ItemApi(Resource):
    @console_ns.doc("get_item")
    def get(self):
        pass

    @error_responses(OldError, unreachable=(DeadError,))
    @console_ns.doc("delete_item")
    def delete(self):
        pass

    @error_responses(GoneError)
    def put(self):
        pass
"""


def test_apply_edits_inserts_rewrites_and_removes_decorators() -> None:
    edits = [
        lint.DecoratorEdit(class_name="ItemApi", method="get", names=("NewError",), unreachable=()),
        lint.DecoratorEdit(
            class_name="ItemApi", method="delete", names=("NewError", "OldError"), unreachable=("DeadError",)
        ),
        lint.DecoratorEdit(class_name="ItemApi", method="put", names=(), unreachable=()),
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

    @error_responses(NewError, OldError, unreachable=(DeadError,))
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


def _bodies_handler(flag: bool) -> tuple[dict[str, object], int]:
    if flag:
        return {"error": "legacy"}, 400
    if not flag:
        return {"code": "x", "message": "y", "status": 409}, 409
    abort(404, message="gone")
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
        (404, False, True),
        (409, True, False),
    ]
