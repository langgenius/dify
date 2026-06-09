"""Request/response contract decorators for the openapi controllers.

Each openapi handler used to declare its request/response shape twice against
the same Pydantic model — once for Swagger (``@openapi_ns.doc(params=...)`` /
``@openapi_ns.response(...)`` / ``@openapi_ns.expect(...)``) and once for runtime
behaviour (inline ``model_validate`` / ``.model_dump``). The two could drift, and
the inline copies disagreed on the failure status (422 vs 400).

``@accepts`` and ``@returns`` each own one slice of the contract from a single
model reference: they emit the Swagger schema AND perform the runtime
validation/serialisation, so doc and behaviour can no longer diverge. Validation
failures map to a single shape — 422 with ``ValidationError.json()``.

These decorators must sit BELOW ``@auth_router.guard`` (guard stays outermost) so
that auth runs before validation, and so the unit-test ``view.__wrapped__`` seam
keeps unwrapping exactly the guard layer.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import Any

from flask import request
from pydantic import BaseModel, ValidationError
from werkzeug.exceptions import UnprocessableEntity

from controllers.common.schema import query_params_from_model, query_params_from_request
from controllers.openapi import openapi_ns


def accepts(*, query: type[BaseModel] | None = None, body: type[BaseModel] | None = None) -> Callable:
    """Validate the request against ``query``/``body`` models and inject them as typed kwargs.

    Emits the matching Swagger param/body schema from the same models, so the
    advertised contract and the enforced contract stay in lockstep. Injects the
    validated models under the keyword arguments ``query`` and ``body``; the
    handler declares them as keyword-only parameters.
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
                raise UnprocessableEntity(exc.json())
            return view(*args, **kwargs)

        if query is not None:
            openapi_ns.doc(params=query_params_from_model(query))(wrapper)
        if body is not None:
            openapi_ns.expect(openapi_ns.models[body.__name__])(wrapper)
        return wrapper

    return decorator


def returns(code: int, model: type[BaseModel], description: str | None = None) -> Callable:
    """Serialise the handler's returned Pydantic model and emit the response schema.

    The handler returns a ``BaseModel`` (serialised with ``code``) or a
    ``(payload, status)`` tuple (the model in ``payload`` is serialised, the
    status is honoured). Anything else — a dict, a ``flask.Response`` (e.g. an SSE
    stream) — is passed through untouched.
    """

    def decorator(view: Callable) -> Callable:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = view(*args, **kwargs)
            if isinstance(result, tuple):
                payload, status = result
                if isinstance(payload, BaseModel):
                    payload = payload.model_dump(mode="json")
                return payload, status
            if isinstance(result, BaseModel):
                return result.model_dump(mode="json"), code
            return result

        openapi_ns.response(code, description or model.__name__, openapi_ns.models[model.__name__])(wrapper)
        return wrapper

    return decorator
