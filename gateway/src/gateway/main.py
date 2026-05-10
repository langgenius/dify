"""FastAPI application entry — wires middleware, routers, and lifespan hooks."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from gateway.config import Settings
from gateway.dify.app_manager import AppManager
from gateway.dify.client import DifyClient
from gateway.errors import GatewayError
from gateway.middleware.auth import AuthMiddleware
from gateway.middleware.logging import LoggingMiddleware, configure_logging
from gateway.registry import CustomerEntry, CustomerRegistry
from gateway.routers import chat as chat_router
from gateway.routers import models as models_router

logger = structlog.get_logger(__name__)


def _build_dify_client_factory(
    settings: Settings,
    cache: dict[str, DifyClient],
):  # type: ignore[no-untyped-def]
    """Return a function that yields a singleton ``DifyClient`` per ``base_url``."""

    def factory(customer: CustomerEntry) -> DifyClient:
        url = customer.dify.base_url
        existing = cache.get(url)
        if existing is not None:
            return existing
        new_client = DifyClient(
            base_url=url,
            timeout_s=settings.dify_timeout_s,
            stream_timeout_s=settings.dify_stream_timeout_s,
        )
        cache[url] = new_client
        return new_client

    return factory


def create_app(
    settings: Settings | None = None,
    *,
    registry: CustomerRegistry | None = None,
) -> FastAPI:
    """Application factory used by ``uvicorn`` and tests.

    Args:
        settings: optional pre-built Settings (defaults: read env).
        registry: optional pre-built registry (tests inject; production loads
            from ``settings.registry_path``).
    """
    settings = settings or Settings()
    configure_logging(level=settings.log_level, json_output=settings.log_json)

    registry = registry or CustomerRegistry.from_yaml(settings.registry_path)
    logger.info("gateway.bootstrap", customers=len(registry))

    dify_clients: dict[str, DifyClient] = {}
    factory = _build_dify_client_factory(settings, dify_clients)
    app_manager = AppManager(
        registry=registry,
        client_factory=factory,
        ttl_s=settings.app_cache_ttl_s,
        gc_interval_s=settings.app_cache_gc_interval_s,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await app_manager.start()
        try:
            yield
        finally:
            await app_manager.stop()
            for client in dify_clients.values():
                await client.aclose()
            logger.info("gateway.shutdown")

    app = FastAPI(
        title="AI SDK Gateway",
        version="0.1.0",
        description="OpenAI-compatible gateway routing to per-customer Dify deployments.",
        lifespan=lifespan,
    )

    app.state.settings = settings
    app.state.registry = registry
    app.state.app_manager = app_manager
    app.state.dify_client_factory = factory
    app.state.dify_clients = dify_clients

    # Middleware: Logging is outer (request id available even on auth failure),
    # Auth is inner (runs after logging is set up).
    app.add_middleware(AuthMiddleware, registry=registry)
    app.add_middleware(LoggingMiddleware, request_id_header=settings.request_id_header)

    app.include_router(chat_router.router)
    app.include_router(models_router.router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/")
    async def root() -> dict[str, str]:
        return {"service": "ai-sdk-gateway", "version": app.version}

    @app.exception_handler(GatewayError)
    async def _gateway_error_handler(_: Request, exc: GatewayError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.to_openai_envelope())

    return app


# For ``uvicorn gateway.main:app``. Tests should call ``create_app(...)`` directly
# with an in-memory registry instead of relying on this module-level instance.
# Construction is deferred until the attribute is accessed by uvicorn so that
# importing this module (e.g. for unit tests of helpers) does not require a
# registry file on disk.
def __getattr__(name: str) -> Any:
    if name == "app":
        instance = create_app()
        globals()["app"] = instance
        return instance
    raise AttributeError(name)
