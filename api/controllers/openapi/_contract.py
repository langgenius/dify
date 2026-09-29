"""``@accepts`` and ``@returns`` own one slice of the contract from a single model
reference, so the advertised and enforced contracts can't drift.

``@endpoint`` composes both under ``subject_router.guard``, exposing
``view.__handler__`` as the one documented test seam. ``returns`` is still used
bare by the unauthenticated ``index.py`` probes, which have no auth layer to
compose with.

``endpoint()`` also builds the route's ``EndpointSpec`` (``auth/spec.py``), which
carries the catalog fields ``op``, ``kind``, ``summary``, ``internal`` and
``deprecated`` that ``_catalog.py`` reads to describe ``/openapi/v1``. A ``list``
op gets ``paginated`` as well, which fills the next-page hint on a bare
``PaginationEnvelope`` result.
"""

from __future__ import annotations

import inspect
from collections.abc import Callable, Sequence
from functools import wraps
from typing import Any, Final, cast

from flask_restx import abort
from pydantic import BaseModel, ValidationError

from controllers.common.schema import query_params_from_model, query_params_from_request
from controllers.openapi import openapi_ns
from controllers.openapi._errors import ErrorBody
from controllers.openapi._hints import next_page_hint
from controllers.openapi._models import PaginationEnvelope
from controllers.openapi._multipart import body_from_request
from controllers.openapi._upload import file_fields
from controllers.openapi.auth.requirements import Requirement
from controllers.openapi.auth.router import subject_router
from controllers.openapi.auth.spec import CatalogMeta, EndpointSpec, Example, Kind
from enums import DeploymentEdition

__all__ = ["Example", "Kind", "accepts", "endpoint", "op_of", "paginated", "returns"]

_INJECTED_KWARGS: Final = frozenset({"ctx", "query", "body"})


def paginated(op: str) -> Callable:
    """Fill the ``Next page`` hint on a bare ``PaginationEnvelope`` result (one with no hints
    of its own). Sits inside ``accepts`` so it sees the validated ``query`` and the path
    kwargs the hint echoes; only this layer knows both those and the op id.
    """

    def decorator(view: Callable) -> Callable:
        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            result = view(*args, **kwargs)
            if not isinstance(result, PaginationEnvelope) or result.hints:
                return result
            path_args = {name: value for name, value in kwargs.items() if name not in _INJECTED_KWARGS}
            hint = next_page_hint(op=op, path_args=path_args, query=kwargs.get("query"), envelope=result)
            if hint is not None:
                result.hints = [hint]
            return result

        return wrapper

    return decorator


def accepts(*, query: type[BaseModel] | None = None, body: type[BaseModel] | None = None) -> Callable:
    """Validate ``query``/``body`` against the models and inject them as keyword-only kwargs."""

    def decorator(view: Callable) -> Callable:
        body_file_fields = file_fields(body) if body is not None else frozenset()

        @wraps(view)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            try:
                if query is not None:
                    kwargs["query"] = query_params_from_request(query)
                if body is not None:
                    kwargs["body"] = body.model_validate(body_from_request(file_fields=body_file_fields))
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


_apply_returns = returns

ReturnSpec = tuple[int, type[BaseModel], str | None]


def _normalize_returns(returns: ReturnSpec | Sequence[ReturnSpec] | None) -> tuple[ReturnSpec, ...]:
    """One ``(code, model, description)`` or several, always ending up a tuple of
    them — the one place that tells the two apart, so `decorator` below never has to.
    """
    if returns is None:
        return ()
    if isinstance(returns[0], int):
        return (cast(ReturnSpec, returns),)  # pyrefly: ignore[redundant-cast]
    return tuple(cast(Sequence[ReturnSpec], returns))  # pyrefly: ignore[redundant-cast]


def op_of(view: Any) -> str:
    """The op id a route declared on ``endpoint``; a hint targeting that route reads it here."""

    return view.__spec__.catalog.op


def endpoint(
    *,
    op: str,
    kind: Kind,
    summary: str,
    requirements: Sequence[Requirement] = (),
    query: type[BaseModel] | None = None,
    body: type[BaseModel] | None = None,
    returns: ReturnSpec | Sequence[ReturnSpec] | None = None,
    edition: frozenset[DeploymentEdition] | None = None,
    account_context: bool = False,
    internal: bool = False,
    deprecated: bool = False,
    examples: Sequence[Example] = (),
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """The one seam a route attaches to for auth, request validation and response
    serialisation — auth, then ``accepts``, then ``returns``. Exposes
    ``view.__handler__`` (the bare handler) and ``view.__spec__`` (the exact
    `EndpointSpec` instance the router runs).

    ``account_context=True`` supplies a framework-neutral ``RequestContext`` after
    account/workspace admission and releases the authentication session before
    the handler. It is for account endpoints whose application services own
    persistence; other endpoints retain the lazy ORM-backed ``Context``.

    ``returns`` takes one ``(code, model, description)`` or several; a route
    that stacked N ``@returns`` today declares them here in the same top-to-bottom
    order and gets the identical nesting back — first entry outermost, last entry
    closest to the handler — including the N-times ``"default"`` error registration
    that stacking N ``@returns`` already produces.

    ``op``/``kind``/``summary`` feed the catalog (see ``_catalog.py``); ``internal``
    hides the op from the CLI's default listing; ``deprecated`` marks it as kept
    for compatibility only; ``examples`` are complete inputs the catalog shows
    next to the schema.
    """
    requirements = tuple(requirements)
    for requirement in requirements:
        if not isinstance(requirement, Requirement):
            raise TypeError(f"requirements must be instances of Requirement, not {requirement!r}")
    spec = EndpointSpec(
        requirements=requirements,
        edition=edition,
        account_context=account_context,
        catalog=CatalogMeta(
            op=op,
            kind=kind,
            summary=summary,
            query=query,
            body=body,
            internal=internal,
            deprecated=deprecated,
            examples=tuple(examples),
        ),
    )
    return_specs = _normalize_returns(returns)

    def decorator(view: Callable[..., Any]) -> Callable[..., Any]:
        if "ctx" not in inspect.signature(view).parameters:
            raise TypeError(f"{view.__qualname__} must declare a 'ctx' parameter")

        decorated = view
        if kind is Kind.LIST:
            decorated = paginated(op)(decorated)
        if query is not None or body is not None:
            decorated = accepts(query=query, body=body)(decorated)
        for return_spec in reversed(return_specs):
            decorated = _apply_returns(*return_spec)(decorated)
        decorated = subject_router.guard(spec)(decorated)

        decorated.__handler__ = view  # type: ignore[attr-defined]
        decorated.__spec__ = spec  # type: ignore[attr-defined]
        return decorated

    return decorator
