"""Application factory for the standalone FastAPI/API v2 process."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from api_fastapi.errors import register_exception_handlers
from api_fastapi.infra import FastAPIInfra, create_fastapi_infra
from api_fastapi.middleware.flask_session import FlaskCompatibleSessionMiddleware
from api_fastapi.routers import router as v2_router
from configs import dify_config
from extensions.ext_blueprints import AUTHENTICATED_HEADERS, EXPOSED_HEADERS


def create_fastapi_app(*, infra: FastAPIInfra | None = None) -> FastAPI:
    """Create the standalone ASGI app that serves /api/v2 routes.

    API v2 currently serves console-authenticated endpoints from a separate
    ASGI process, so it must mirror the legacy console API CORS contract for
    browser requests until the frontend can use a same-origin gateway.
    """

    app_infra = infra or create_fastapi_infra()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        try:
            yield
        finally:
            await app_infra.async_engine.dispose()

    app = FastAPI(
        title="Dify API v2",
        version="1.0.0-poc",
        docs_url="/api/v2/docs",
        redoc_url="/api/v2/redoc",
        openapi_url="/api/v2/openapi.json",
        lifespan=lifespan,
    )
    if not app_infra.extension_host.secret_key:
        app_infra.extension_host.secret_key = dify_config.SECRET_KEY or "dify-fastapi-poc"
    app.add_middleware(FlaskCompatibleSessionMiddleware, flask_app=app_infra.extension_host)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=dify_config.CONSOLE_CORS_ALLOW_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        allow_headers=list(AUTHENTICATED_HEADERS),
        expose_headers=list(EXPOSED_HEADERS),
    )
    register_exception_handlers(app)
    app.state.infra = app_infra
    app.include_router(v2_router)

    return app
