from typing import cast

from configs import dify_config
from dify_app import DifyApp


def init_app(app: DifyApp):
    # register blueprint routers

    from flask_cors import CORS  # type: ignore

    from controllers.console import bp as console_app_bp
    from controllers.files import bp as files_bp
    from controllers.inner_api import bp as inner_api_bp
    from controllers.mcp import bp as mcp_bp
    from controllers.service_api import bp as service_api_bp
    from controllers.web import bp as web_bp

    # Apply CORS to the main app to handle preflight requests
    # Use a more comprehensive approach to ensure all routes are covered
    console_origins = cast(list[str], dify_config.CONSOLE_CORS_ALLOW_ORIGINS)
    web_origins = cast(list[str], dify_config.WEB_API_CORS_ALLOW_ORIGINS)
    all_origins = console_origins + web_origins

    CORS(
        app,
        origins=all_origins,
        supports_credentials=True,
        allow_headers=["Content-Type", "Authorization", "X-App-Code"],
        methods=["GET", "PUT", "POST", "DELETE", "OPTIONS", "PATCH"],
        expose_headers=["X-Version", "X-Env"],
        # Enable automatic handling of preflight requests
        automatic_options=True,
    )

    # Register blueprints
    app.register_blueprint(service_api_bp)
    app.register_blueprint(web_bp)
    app.register_blueprint(console_app_bp)
    app.register_blueprint(files_bp)
    app.register_blueprint(inner_api_bp)
    app.register_blueprint(mcp_bp)
