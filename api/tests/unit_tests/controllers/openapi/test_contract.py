"""Unit tests for the @accepts / @returns contract decorators.

Exercises the decorators in isolation (not through a real controller): a plain
view function decorated with @accepts/@returns, driven inside a request context.
"""

from functools import wraps

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
    """Stand-in for ``@auth_router.guard`` — an outermost @wraps layer."""

    @wraps(view)
    def wrapper(*args, **kwargs):
        return view(*args, **kwargs)

    return wrapper


def test_accepts_injects_validated_query(app):
    @accepts(query=ContractQuery)
    def view(*, query):
        return query

    with app.test_request_context("/?page=3&limit=5"):
        result = view()

    assert isinstance(result, ContractQuery)
    assert result.page == 3
    assert result.limit == 5


def test_accepts_query_uses_defaults_when_absent(app):
    @accepts(query=ContractQuery)
    def view(*, query):
        return query

    with app.test_request_context("/"):
        result = view()

    assert result.page == 1
    assert result.limit == 20


@pytest.mark.parametrize("query_string", ["page=0", "limit=999", "page=abc", "unknown=1"])
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

    data = exc_info.value.data
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


def test_accepts_rejects_invalid_body_with_422(app):
    @accepts(body=ContractBody)
    def view(*, body):
        return body

    with app.test_request_context("/", method="POST", json={"wrong": 1}):
        with pytest.raises(UnprocessableEntity):
            view()


def test_returns_serializes_model_with_decorator_status(app):
    @returns(200, ContractResp)
    def view():
        return ContractResp(value=7)

    with app.test_request_context("/"):
        body, status = view()

    assert status == 200
    assert body == {"value": 7}


def test_returns_serializes_model_in_tuple_and_honors_status(app):
    @returns(200, ContractResp)
    def view():
        return ContractResp(value=9), 201

    with app.test_request_context("/"):
        body, status = view()

    assert status == 201
    assert body == {"value": 9}


def test_returns_passes_through_non_model(app):
    sentinel = object()

    @returns(200, ContractResp)
    def view():
        return sentinel

    with app.test_request_context("/"):
        result = view()

    assert result is sentinel


def test_returns_serializes_model_in_three_tuple_with_headers(app):
    """A (model, status, headers) tuple keeps its trailing status/headers intact."""

    @returns(200, ContractResp)
    def view():
        return ContractResp(value=3), 202, {"X-Test": "1"}

    with app.test_request_context("/"):
        body, status, headers = view()

    assert body == {"value": 3}
    assert status == 202
    assert headers == {"X-Test": "1"}


# Swagger metadata (read off __apidoc__) must survive @wraps up through the guard layer.


def test_accepts_returns_emit_apidoc_through_guard_stack():
    @_guard_like
    @returns(200, ContractResp)
    @accepts(query=ContractQuery)
    def view(*, query):
        return ContractResp(value=1)

    apidoc = getattr(view, "__apidoc__", {})
    assert "page" in apidoc.get("params", {})  # from @accepts(query=)
    assert "200" in apidoc.get("responses", {})  # from @returns (flask_restx keys by str code)


def test_accepts_body_emits_expect_through_guard_stack():
    @_guard_like
    @accepts(body=ContractBody)
    def view(*, body):
        return body

    apidoc = getattr(view, "__apidoc__", {})
    assert apidoc.get("expect")  # body schema advertised via @openapi_ns.expect


def _response_model_name(entry) -> str:
    """Extract the model name from a flask-restx __apidoc__ response entry.

    flask-restx stores responses as ``(description, model, kwargs)`` tuples
    where ``model.name`` is the registered schema name.
    """
    if isinstance(entry, tuple) and len(entry) >= 2:
        model = entry[1]
        return getattr(model, "name", "") or ""
    return ""


def test_accepts_documents_422_error_response(app):
    from controllers.openapi._errors import ErrorBody

    @accepts(query=ContractQuery)
    def view(*, query):
        return query

    doc = getattr(view, "__apidoc__", {})
    responses = doc.get("responses", {})
    assert "422" in responses
    assert _response_model_name(responses["422"]) == ErrorBody.__name__


def test_returns_documents_default_error_response(app):
    from controllers.openapi._errors import ErrorBody

    @returns(200, ContractResp)
    def view():
        return ContractResp(value=1)

    doc = getattr(view, "__apidoc__", {})
    responses = doc.get("responses", {})
    assert "default" in responses
    assert _response_model_name(responses["default"]) == ErrorBody.__name__
