from configs import dify_config
from constants import HEADER_NAME_APP_CODE, HEADER_NAME_CSRF_TOKEN, HEADER_NAME_PASSPORT
from dify_app import DifyApp

BASE_CORS_HEADERS: tuple[str, ...] = ("Content-Type", HEADER_NAME_APP_CODE, HEADER_NAME_PASSPORT)
SERVICE_API_HEADERS: tuple[str, ...] = (*BASE_CORS_HEADERS, "Authorization")
AUTHENTICATED_HEADERS: tuple[str, ...] = (*SERVICE_API_HEADERS, HEADER_NAME_CSRF_TOKEN)
FILES_HEADERS: tuple[str, ...] = (*BASE_CORS_HEADERS, HEADER_NAME_CSRF_TOKEN)
EMBED_HEADERS: tuple[str, ...] = ("Content-Type", HEADER_NAME_APP_CODE)
EXPOSED_HEADERS: tuple[str, ...] = ("X-Version", "X-Env", "X-Trace-Id")


def _apply_cors_once(bp, /, **cors_kwargs):
    """Make CORS idempotent so blueprints can be reused across multiple app instances."""

    if getattr(bp, "_dify_cors_applied", False):
        return

    from flask_cors import CORS

    CORS(bp, **cors_kwargs)
    bp._dify_cors_applied = True


def init_app(app: DifyApp):
    # register blueprint routers

    from controllers.console import bp as console_app_bp
    from controllers.files import bp as files_bp
    from controllers.inner_api import bp as inner_api_bp
    from controllers.mcp import bp as mcp_bp
    from controllers.service_api import bp as service_api_bp
    from controllers.trigger import bp as trigger_bp
    from controllers.web import bp as web_bp

    _apply_cors_once(
        service_api_bp,
        allow_headers=list(SERVICE_API_HEADERS),
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=list(EXPOSED_HEADERS),
    )
    app.register_blueprint(service_api_bp)

    _apply_cors_once(
        web_bp,
        resources={
            # Embedded bot endpoints (unauthenticated, cross-origin safe)
            r"^/chat-messages$": {
                "origins": dify_config.WEB_API_CORS_ALLOW_ORIGINS,
                "supports_credentials": False,
                "allow_headers": list(EMBED_HEADERS),
                "methods": ["GET", "POST", "OPTIONS"],
            },
            r"^/chat-messages/.*": {
                "origins": dify_config.WEB_API_CORS_ALLOW_ORIGINS,
                "supports_credentials": False,
                "allow_headers": list(EMBED_HEADERS),
                "methods": ["GET", "POST", "OPTIONS"],
            },
            # Default web application endpoints (authenticated)
            r"/*": {
                "origins": dify_config.WEB_API_CORS_ALLOW_ORIGINS,
                "supports_credentials": True,
                "allow_headers": list(AUTHENTICATED_HEADERS),
                "methods": ["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
            },
        },
        expose_headers=list(EXPOSED_HEADERS),
    )
    app.register_blueprint(web_bp)

    _apply_cors_once(
        console_app_bp,
        resources={r"/*": {"origins": dify_config.CONSOLE_CORS_ALLOW_ORIGINS}},
        supports_credentials=True,
        allow_headers=list(AUTHENTICATED_HEADERS),
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=list(EXPOSED_HEADERS),
    )
    app.register_blueprint(console_app_bp)

    _apply_cors_once(
        files_bp,
        allow_headers=list(FILES_HEADERS),
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=list(EXPOSED_HEADERS),
    )
    app.register_blueprint(files_bp)

    app.register_blueprint(inner_api_bp)
    app.register_blueprint(mcp_bp)

    # Register trigger blueprint with CORS for webhook calls
    _apply_cors_once(
        trigger_bp,
        allow_headers=["Content-Type", "Authorization", "X-App-Code"],
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH", "HEAD"],
        expose_headers=list(EXPOSED_HEADERS),
    )
    app.register_blueprint(trigger_bp)
