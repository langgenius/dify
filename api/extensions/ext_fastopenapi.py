from fastopenapi.routers import FlaskRouter
from flask_cors import CORS

from configs import dify_config
from controllers.fastopenapi import console_router
from dify_app import DifyApp
from extensions.ext_blueprints import AUTHENTICATED_HEADERS, EXPOSED_HEADERS

DOCS_PREFIX = "/fastopenapi"


def init_app(app: DifyApp) -> None:
    docs_enabled = dify_config.SWAGGER_UI_ENABLED
    docs_url = f"{DOCS_PREFIX}/docs" if docs_enabled else None
    redoc_url = f"{DOCS_PREFIX}/redoc" if docs_enabled else None
    openapi_url = f"{DOCS_PREFIX}/openapi.json" if docs_enabled else None

    router = FlaskRouter(
        app=app,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
        openapi_version="3.0.0",
        title="Dify API (FastOpenAPI PoC)",
        version="1.0",
        description="FastOpenAPI proof of concept for Dify API",
    )

    # Ensure route decorators are evaluated.
    import controllers.console.ping as ping_module
    from controllers.console import setup

    _ = ping_module
    _ = setup

    router.include_router(console_router, prefix="/console/api")
    CORS(
        app,
        resources={r"/console/api/.*": {"origins": dify_config.CONSOLE_CORS_ALLOW_ORIGINS}},
        supports_credentials=True,
        allow_headers=list(AUTHENTICATED_HEADERS),
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=list(EXPOSED_HEADERS),
    )
    app.extensions["fastopenapi"] = router
