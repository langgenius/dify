"""Request/response contract decorators for the openapi controllers.

``@accepts`` and ``@returns`` own one slice of the contract from a single model
reference — emitting the Swagger schema AND doing the runtime validation/
serialisation — so the advertised and enforced contracts can't drift. Validation
failures map to a single shape: 422.

They must sit BELOW ``@auth_router.guard`` so auth runs before validation and the
``view.__wrapped__`` unit-test seam unwraps exactly the guard layer.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import request
from flask_restx import abort
from pydantic import BaseModel, ValidationError

from controllers.common.schema import query_params_from_model, query_params_from_request
from controllers.openapi import openapi_ns
from controllers.openapi._errors import ErrorBody


def accepts(*, query: type[BaseModel] | None = None, body: type[BaseModel] | None = None) -> Callable:
    """Validate ``query``/``body`` against the models and inject them as keyword-only kwargs.

    Emits the matching Swagger schema from the same models, so doc and enforcement
    stay in lockstep.
    """

    def decorator(view: Callable) -> Callable:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                if query is not None:
                    kwargs["query"] = query_params_from_request(query)
                if body is not None:
                    kwargs["body"] = body.model_validate(request.get_json(silent=True) or {})
            except ValidationError as exc:
                # Sanitized 422 — no pydantic `url` (version) or `input` (user payload) leak.
                abort(
                    422,
                    message="Request validation failed",
                    errors=exc.errors(include_url=False, include_input=False, include_context=False),
                )
            return view(*args, **kwargs)

        if query is not None:
            openapi_ns.doc(params=query_params_from_model(query))(wrapper)
        if body is not None:
            openapi_ns.expect(openapi_ns.models[body.__name__])(wrapper)
        if query is not None or body is not None:
            openapi_ns.response(422, "Validation error", openapi_ns.models[ErrorBody.__name__])(wrapper)
        return wrapper

    return decorator


def returns(code: int, model: type[BaseModel], description: str | None = None) -> Callable:
    """Serialise the handler's returned model and emit the response schema.

    Accepts a ``BaseModel`` (serialised with ``code``) or a ``(model, status[, headers])``
    tuple (status/headers honoured). Other returns — a bare ``(dict, status)``, an SSE
    ``Response`` — pass through untouched.
    """

    def decorator(view: Callable) -> Callable:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = view(*args, **kwargs)
            if isinstance(result, BaseModel):
                return result.model_dump(mode="json"), code
            if isinstance(result, tuple) and result and isinstance(result[0], BaseModel):
                payload, *rest = result
                return (payload.model_dump(mode="json"), *rest)
            return result

        openapi_ns.response(code, description or model.__name__, openapi_ns.models[model.__name__])(wrapper)
        openapi_ns.response("default", "Error", openapi_ns.models[ErrorBody.__name__])(wrapper)
        return wrapper

    return decorator
