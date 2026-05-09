"""SDK key extraction and customer attachment.

Extracts ``Authorization: Bearer <sdk_key>`` from incoming requests, looks up
the customer in :class:`~gateway.registry.CustomerRegistry`, and stashes the
resolved :class:`~gateway.registry.CustomerEntry` on ``request.state.customer``.

Routes that do not need authentication (e.g. ``/health``) are excluded by
``EXEMPT_PATHS``.

Failures are caught **inside** ``dispatch`` and rendered as 401 JSON responses
directly. We cannot rely on FastAPI's ``@app.exception_handler(GatewayError)``
here: ``BaseHTTPMiddleware`` runs *outside* Starlette's ``ExceptionMiddleware``,
so exceptions raised before ``call_next`` returns propagate up the ASGI chain
and become 500s instead of being shaped by our handler.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from gateway.errors import GatewayError, InvalidSdkKeyError
from gateway.registry import CustomerRegistry

EXEMPT_PATHS: frozenset[str] = frozenset({"/health", "/", "/docs", "/openapi.json", "/redoc"})

_BEARER_PREFIX = "Bearer "


def extract_sdk_key(authorization_header: str | None) -> str:
    """Parse a ``Bearer <key>`` header, or raise :class:`InvalidSdkKeyError`.

    Trims whitespace; rejects empty or malformed values. The key value itself
    is *not* validated for shape here—registry lookup is the source of truth.
    """
    if not authorization_header:
        raise InvalidSdkKeyError("missing Authorization header", param="authorization")

    header = authorization_header.strip()
    if not header.startswith(_BEARER_PREFIX):
        raise InvalidSdkKeyError(
            "Authorization header must use 'Bearer <sdk_key>' scheme",
            param="authorization",
        )

    key = header[len(_BEARER_PREFIX) :].strip()
    if not key:
        raise InvalidSdkKeyError("empty SDK key", param="authorization")

    return key


class AuthMiddleware(BaseHTTPMiddleware):
    """Resolve the SDK key on every non-exempt request.

    The middleware does *not* enforce authorization beyond presence + lookup;
    per-resource authorization (e.g. "this customer may use this model") lives
    in routers because it depends on request body parsing.

    Note:
        Constructed with the registry as a dependency so tests can swap it.
    """

    def __init__(self, app, registry: CustomerRegistry) -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._registry = registry

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        try:
            sdk_key = extract_sdk_key(request.headers.get("authorization"))
            customer = self._registry.lookup(sdk_key)
            if customer is None:
                raise InvalidSdkKeyError("unknown SDK key", param="authorization")
        except GatewayError as exc:
            # Render directly: BaseHTTPMiddleware runs outside FastAPI's
            # ExceptionMiddleware, so raising would skip the global handler
            # and become a 500. See module docstring for details.
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.to_openai_envelope(),
            )

        # Stash on state for downstream handlers/middleware. We deliberately
        # avoid attaching the raw SDK key to keep it out of logs/metrics that
        # serialize request.state.
        request.state.customer = customer
        request.state.customer_id = customer.customer_id

        return await call_next(request)
