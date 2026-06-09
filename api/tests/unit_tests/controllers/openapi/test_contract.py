"""Unit tests for the @accepts / @returns contract decorators.

Exercises the decorators in isolation (not through a real controller): a plain
view function decorated with @accepts/@returns, driven inside a request context.
"""

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


# @accepts(body=) and @returns emit Swagger via openapi_ns, which resolves models
# by name — register the body/response models so those lookups succeed.
register_schema_model(openapi_ns, ContractBody)
register_response_schema_model(openapi_ns, ContractResp)


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
