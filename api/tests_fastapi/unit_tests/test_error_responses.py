"""Contract tests for FastAPI/API v2 error response serialization."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, cast

import pytest
from fastapi import HTTPException
from httpx import Response
from pydantic import BaseModel, Field
from werkzeug.exceptions import BadRequest, Unauthorized

from api_fastapi.errors import ErrorResponse
from api_fastapi.factory import create_fastapi_app
from api_fastapi.infra import FastAPIInfra
from controllers.console.error import UnauthorizedAndForceLogout
from libs.exception import BaseHTTPException
from tests_fastapi.helpers import apptest_get


class ExampleError(BaseHTTPException):
    error_code = "example_error"
    description = "Example error."
    code = 409


class ExamplePayload(BaseModel):
    name: str
    count: int = Field(gt=0)


@dataclass(frozen=True)
class ErrorCase:
    name: str
    exception_factory: Callable[[], Exception]
    expected: ErrorResponse


@pytest.mark.parametrize(
    "case",
    [
        ErrorCase(
            name="legacy-base-http-exception",
            exception_factory=ExampleError,
            expected=ErrorResponse(code="example_error", message="Example error.", status=409),
        ),
        ErrorCase(
            name="value-error",
            exception_factory=lambda: ValueError("bad input"),
            expected=ErrorResponse(code="invalid_param", message="bad input", status=400),
        ),
        ErrorCase(
            name="fastapi-http-exception",
            exception_factory=lambda: HTTPException(status_code=404, detail="missing"),
            expected=ErrorResponse(code="not_found", message="missing", status=404),
        ),
    ],
    ids=lambda case: case.name,
)
def test_fastapi_errors_return_standard_error_contract(fake_infra: FastAPIInfra, case: ErrorCase) -> None:
    app = create_fastapi_app(infra=fake_infra)

    @app.get(f"/example/errors/{case.name}")
    async def raise_error() -> None:
        raise case.exception_factory()

    response = apptest_get(app, f"/example/errors/{case.name}")

    _assert_error_contract(response, case.expected)


def test_werkzeug_unauthorized_returns_legacy_auth_contract(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    @app.get("/example/errors/unauthorized")
    async def raise_error() -> None:
        raise Unauthorized("auth required")

    response = apptest_get(app, "/example/errors/unauthorized")

    _assert_error_contract(
        response,
        ErrorResponse(code="unauthorized", message="auth required", status=401),
    )
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


def test_force_logout_error_returns_contract_and_clears_auth_cookies(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    @app.get("/example/errors/force-logout")
    async def raise_error() -> None:
        raise UnauthorizedAndForceLogout()

    response = apptest_get(app, "/example/errors/force-logout")

    _assert_error_contract(
        response,
        ErrorResponse(
            code="unauthorized_and_force_logout",
            message="Unauthorized and force logout.",
            status=401,
        ),
    )
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'
    assert len(response.headers.get_list("set-cookie")) == 3


def test_missing_fastapi_route_returns_legacy_not_found_contract(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    response = apptest_get(app, "/api/v2/example/missing")

    _assert_error_contract(
        response,
        ErrorResponse(code="not_found", message="Not Found", status=404),
    )


def test_werkzeug_bad_request_mapping_returns_invalid_param_contract(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    @app.get("/example/errors/bad-request")
    async def raise_error() -> None:
        error = BadRequest()
        cast(Any, error).description = {"field": "is required"}
        raise error

    response = apptest_get(app, "/example/errors/bad-request")

    _assert_error_contract(
        response,
        ErrorResponse(code="invalid_param", message="is required", params="field", status=400),
    )


def test_fastapi_request_validation_matches_restx_pydantic_error_contract(fake_infra: FastAPIInfra) -> None:
    app = create_fastapi_app(infra=fake_infra)

    @app.get("/example/errors/validated")
    async def validated(count: int) -> dict[str, int]:
        return {"count": count}

    response = apptest_get(app, "/example/errors/validated?count=not-an-int")

    actual = ErrorResponse.model_validate(response.json())
    assert response.status_code == 400
    assert actual.code == "invalid_param"
    assert actual.status == 400
    assert "count" in actual.message


def test_pydantic_validation_error_raised_by_route_matches_restx_value_error_contract(
    fake_infra: FastAPIInfra,
) -> None:
    app = create_fastapi_app(infra=fake_infra)

    @app.get("/example/errors/pydantic")
    async def pydantic_error() -> None:
        ExamplePayload.model_validate({"name": "sample", "count": 0})

    response = apptest_get(app, "/example/errors/pydantic")

    actual = ErrorResponse.model_validate(response.json())
    assert response.status_code == 400
    assert actual.code == "invalid_param"
    assert actual.status == 400
    assert "count" in actual.message


def _assert_error_contract(response: Response, expected: ErrorResponse) -> ErrorResponse:
    actual = ErrorResponse.model_validate(response.json())
    assert response.status_code == expected.status
    assert actual.model_dump(exclude_none=True) == expected.model_dump(exclude_none=True)
    return actual
