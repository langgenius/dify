"""Unit tests for the @accepts / @returns contract decorators.

Exercises the decorators in isolation (not through a real controller): a plain
view function decorated with @accepts/@returns, driven inside a request context.
"""

from functools import wraps
from typing import Any, cast

import pytest
from pydantic import BaseModel, ConfigDict, Field
from werkzeug.exceptions import UnprocessableEntity

from controllers.common.schema import register_response_schema_model, register_schema_model
from controllers.openapi import openapi_ns
from controllers.openapi._contract import accepts, returns


class ContractQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)


class ContractBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str


class ContractResp(BaseModel):
    value: int


@pytest.fixture(autouse=True, scope="module")
def _register_contract_test_models():
    # Register for @accepts(body=)/@returns name lookups; drop on teardown so these
    # test-only models don't leak into the shared openapi_ns / generated spec.
    register_schema_model(openapi_ns, ContractBody)
    register_response_schema_model(openapi_ns, ContractResp)
    yield
    openapi_ns.models.pop(ContractBody.__name__, None)
    openapi_ns.models.pop(ContractResp.__name__, None)


def _guard_like(view):
    """Stand-in for ``@subject_router.guard`` — an outermost @wraps layer."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        return view(*args, **kwargs)

    return wrapper


def test_accepts_injects_validated_query_with_defaults_for_absent_fields(app):
    @accepts(query=ContractQuery)
    def view(*, query):
        return query

    with app.test_request_context("/?page=3"):
        result = view()

    assert isinstance(result, ContractQuery)
    assert result.page == 3
    assert result.limit == 20


@pytest.mark.parametrize("query_string", ["page=abc", "unknown=1"])
def test_accepts_rejects_invalid_query_with_422(app, query_string):
    @accepts(query=ContractQuery)
    def view(*, query):
        return query

    with app.test_request_context(f"/?{query_string}"):
        with pytest.raises(UnprocessableEntity):
            view()


def test_accepts_validation_error_is_sanitized_and_structured(app):
    """422 body is structured and leaks neither the pydantic docs url nor the user input."""

    @accepts(body=ContractBody)
    def view(*, body):
        return body

    with app.test_request_context("/", method="POST", json={"secret": "leak-me"}):
        with pytest.raises(UnprocessableEntity) as exc_info:
            view()

    data = cast(dict[str, Any], cast(Any, exc_info.value).data)
    assert data["message"] == "Request validation failed"
    assert isinstance(data["errors"], list)
    assert data["errors"]
    for err in data["errors"]:
        assert {"type", "loc", "msg"} <= err.keys()
        assert "url" not in err
        assert "input" not in err
    assert "leak-me" not in str(data)


def test_accepts_injects_validated_body(app):
    @accepts(body=ContractBody)
    def view(*, body):
        return body

    with app.test_request_context("/", method="POST", json={"name": "x"}):
        result = view()

    assert isinstance(result, ContractBody)
    assert result.name == "x"


def test_returns_serializes_model_with_decorator_status(app):
    @returns(200, ContractResp)
    def view():
        return ContractResp(value=7)

    with app.test_request_context("/"):
        body, status = view()

    assert status == 200
    assert body == {"value": 7}


@pytest.mark.parametrize("trailing", [(201,), (202, {"X-Test": "1"})], ids=["status", "status_and_headers"])
def test_returns_serializes_model_in_tuple_and_keeps_trailing_parts(app, trailing):
    @returns(200, ContractResp)
    def view():
        return ContractResp(value=9), *trailing

    with app.test_request_context("/"):
        body, *rest = view()

    assert body == {"value": 9}
    assert tuple(rest) == trailing


def test_returns_passes_through_non_model(app):
    sentinel = object()

    @returns(200, ContractResp)
    def view():
        return sentinel

    with app.test_request_context("/"):
        result = view()

    assert result is sentinel


# Swagger metadata (read off __apidoc__) must survive @wraps up through the guard layer.


def test_accepts_returns_emit_apidoc_through_guard_stack():
    @_guard_like
    @returns(200, ContractResp)
    @accepts(query=ContractQuery, body=ContractBody)
    def view(*, query, body):
        return ContractResp(value=1)

    apidoc = getattr(view, "__apidoc__", {})
    assert "page" in apidoc.get("params", {})  # from @accepts(query=)
    assert apidoc.get("expect")  # from @accepts(body=), via @openapi_ns.expect
    assert "200" in apidoc.get("responses", {})  # from @returns (flask_restx keys by str code)
