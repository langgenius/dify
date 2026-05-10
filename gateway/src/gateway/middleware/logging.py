"""Structured logging middleware: request_id + customer_id binding.

Generates (or echoes) a request id, binds it to the structlog context for the
duration of the request, and emits a single completion log line with timing.

Layered with :class:`~gateway.middleware.auth.AuthMiddleware`: this middleware
runs *before* auth so request ids appear even on rejected requests.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

import structlog
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = structlog.get_logger(__name__)


class LoggingMiddleware(BaseHTTPMiddleware):
    """Bind request id (and later customer id) into structlog contextvars."""

    def __init__(self, app, request_id_header: str = "x-request-id") -> None:  # type: ignore[no-untyped-def]
        super().__init__(app)
        self._request_id_header = request_id_header.lower()

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        request_id = request.headers.get(self._request_id_header) or uuid.uuid4().hex
        request.state.request_id = request_id

        # Bind into contextvars so downstream log lines get request_id for free.
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        start = time.perf_counter()
        status_code: int | str = "error"
        try:
            response = await call_next(request)
            status_code = response.status_code
            response.headers[self._request_id_header] = request_id

            # Customer id is set by AuthMiddleware (downstream); attach if present.
            customer_id = getattr(request.state, "customer_id", None)
            if customer_id is not None:
                structlog.contextvars.bind_contextvars(customer_id=customer_id)

            return response
        finally:
            duration_ms = (time.perf_counter() - start) * 1000.0
            logger.info(
                "request.completed",
                status=status_code,
                duration_ms=round(duration_ms, 2),
            )
            structlog.contextvars.clear_contextvars()


def configure_logging(level: str = "INFO", json_output: bool = True) -> None:
    """Configure structlog + stdlib logging once at process startup.

    Idempotent in practice: structlog.configure() replaces the previous chain.
    """
    import logging

    timestamper = structlog.processors.TimeStamper(fmt="iso", utc=True)

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        timestamper,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    renderer = (
        structlog.processors.JSONRenderer()
        if json_output
        else structlog.dev.ConsoleRenderer()
    )

    structlog.configure(
        processors=[*shared_processors, renderer],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )
