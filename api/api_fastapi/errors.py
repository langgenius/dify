"""Exception handlers that serialize FastAPI/API v2 errors consistently."""

from __future__ import annotations

import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from flask import got_request_exception
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse, Response
from werkzeug.exceptions import HTTPException as WerkzeugHTTPException
from werkzeug.http import HTTP_STATUS_CODES

from libs.exception import BaseHTTPException
from libs.token import build_force_logout_cookie_headers


class ErrorResponse(BaseModel):
    """Standard JSON error envelope returned by FastAPI/API v2 routes."""

    code: str
    message: str
    status: int
    params: str | None = None


@dataclass
class ResponseParts:
    """HTTP response components produced by exception translators."""

    payload: ErrorResponse
    status_code: int
    headers: dict[str, str] = field(default_factory=dict)
    set_cookie_headers: list[str] = field(default_factory=list)


def register_exception_handlers(app: FastAPI) -> None:
    """Register the shared FastAPI error serialization contract.

    The v2 migration still raises many legacy Werkzeug exceptions from reused
    service/controller code. New FastAPI routes also raise Starlette HTTP and
    request validation exceptions. Domain and service errors should be caught
    at the router boundary and translated into predictable `BaseHTTPException`
    subclasses for that API surface; this module remains the final framework
    serializer and compatibility fallback.
    """

    app.add_exception_handler(BaseHTTPException, handle_base_http_exception)
    app.add_exception_handler(WerkzeugHTTPException, handle_werkzeug_http_exception)
    app.add_exception_handler(StarletteHTTPException, handle_starlette_http_exception)
    app.add_exception_handler(RequestValidationError, handle_request_validation_error)
    app.add_exception_handler(ValueError, handle_value_error)
    app.add_exception_handler(Exception, handle_general_exception)


async def handle_base_http_exception(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, BaseHTTPException):
        return await handle_general_exception(request, exc)

    status_code = exc.code or 500
    payload = _payload_from_exception_data(exc, status_code) or ErrorResponse(
        code=exc.error_code,
        message=str(exc.description),
        status=status_code,
    )
    response = ResponseParts(payload=payload, status_code=status_code)
    _add_unauthorized_headers(response, exc)
    _emit_request_exception(request, exc)
    return _json_response(response)


async def handle_werkzeug_http_exception(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, WerkzeugHTTPException):
        return await handle_general_exception(request, exc)

    if exc.response is not None:
        prepared_response = cast(Any, exc.response)
        return Response(
            content=prepared_response.get_data(),
            status_code=exc.response.status_code,
            headers=dict(exc.response.headers),
            media_type=exc.response.mimetype,
        )

    response = _werkzeug_response_parts(exc)
    _emit_request_exception(request, exc)
    return _json_response(response)


async def handle_starlette_http_exception(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, StarletteHTTPException):
        return await handle_general_exception(request, exc)

    status_code = exc.status_code
    message = _message_from_detail(exc.detail, status_code)
    response = ResponseParts(
        payload=ErrorResponse(
            code=_http_status_code_name(status_code),
            message=message,
            status=status_code,
        ),
        status_code=status_code,
    )
    if exc.headers:
        response.headers.update(dict(exc.headers))
    _add_unauthorized_headers(response, exc)
    _emit_request_exception(request, exc)
    return _json_response(response)


async def handle_request_validation_error(request: Request, exc: Exception) -> Response:
    if not isinstance(exc, RequestValidationError):
        return await handle_general_exception(request, exc)

    _emit_request_exception(request, exc)
    logger.exception("value_error in request handler")
    return _json_response(
        ResponseParts(
            payload=ErrorResponse(code="invalid_param", message=str(exc), status=400),
            status_code=400,
        )
    )


async def handle_value_error(request: Request, exc: Exception) -> Response:
    _emit_request_exception(request, exc)
    logger.exception("value_error in request handler")
    return _json_response(
        ResponseParts(
            payload=ErrorResponse(code="invalid_param", message=str(exc), status=400),
            status_code=400,
        )
    )


async def handle_general_exception(request: Request, exc: Exception) -> Response:
    _emit_request_exception(request, exc)
    logger.exception("Unhandled exception in request handler")

    status_code = 500
    payload = _payload_from_exception_data(exc, status_code)
    if payload is None:
        payload = ErrorResponse(code="unknown", message=_http_status_message(status_code), status=status_code)

    return _json_response(ResponseParts(payload=payload, status_code=status_code))


logger = logging.getLogger(__name__)

EMPTY_JSON_DECODE_MESSAGE = "Failed to decode JSON object: Expecting value: line 1 column 1 (char 0)"
INVALID_JSON_PAYLOAD_MESSAGE = "Invalid JSON payload received or JSON payload is empty."
BEARER_CHALLENGE = 'Bearer realm="api"'


def _werkzeug_response_parts(exc: WerkzeugHTTPException) -> ResponseParts:
    status_code = exc.code or 500
    default_payload = ErrorResponse(
        code=_snake_case(type(exc).__name__),
        message=_normalize_message(getattr(exc, "description", _http_status_message(status_code))),
        status=status_code,
    )

    headers = _exception_headers(exc)
    if status_code == 400:
        if isinstance(exc.description, Mapping) and exc.description:
            param_key, param_value = next(iter(exc.description.items()))
            payload = ErrorResponse(
                code="invalid_param",
                message=str(param_value),
                params=str(param_key),
                status=status_code,
            )
        else:
            payload = default_payload
        response = ResponseParts(payload=payload, status_code=status_code, headers=headers)
    else:
        response = ResponseParts(payload=default_payload, status_code=status_code, headers=headers)

    _add_unauthorized_headers(response, exc)
    return response


def _payload_from_exception_data(exc: Exception, status_code: int) -> ErrorResponse | None:
    data = getattr(exc, "data", None)
    if not isinstance(data, dict):
        return None

    params = data.get("params")
    return ErrorResponse(
        code=str(data.get("code", "unknown")),
        message=str(data.get("message", _http_status_message(status_code))),
        status=int(data.get("status", status_code)),
        params=str(params) if params is not None else None,
    )


def _json_response(response: ResponseParts) -> JSONResponse:
    json_response = JSONResponse(
        status_code=response.status_code,
        content=response.payload.model_dump(exclude_none=True),
        headers=response.headers,
    )
    for header in response.set_cookie_headers:
        json_response.headers.append("set-cookie", header)
    return json_response


def _add_unauthorized_headers(response: ResponseParts, exc: Exception) -> None:
    if response.status_code != 401:
        return

    response.headers["WWW-Authenticate"] = BEARER_CHALLENGE
    if getattr(exc, "error_code", None) == "unauthorized_and_force_logout":
        response.set_cookie_headers = build_force_logout_cookie_headers()


def _exception_headers(exc: WerkzeugHTTPException) -> dict[str, str]:
    headers: dict[str, str] = {}
    exc_headers = getattr(exc, "headers", None)
    if exc_headers:
        headers.update(exc_headers)
    return headers


def _emit_request_exception(request: Request, exc: Exception) -> None:
    try:
        extension_host = request.app.state.infra.extension_host
    except AttributeError:
        return
    got_request_exception.send(extension_host, exception=exc)


def _message_from_detail(detail: str | None, status_code: int) -> str:
    if isinstance(detail, str):
        return detail
    if detail is None:
        return _http_status_message(status_code)
    return str(detail)


def _normalize_message(message: Any) -> str:
    if message == EMPTY_JSON_DECODE_MESSAGE:
        return INVALID_JSON_PAYLOAD_MESSAGE
    return str(message)


def _http_status_code_name(status_code: int) -> str:
    return _snake_case(_http_status_message(status_code).replace(" ", ""))


def _http_status_message(status_code: int) -> str:
    return HTTP_STATUS_CODES.get(status_code, "")


def _snake_case(value: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", value).lower()
