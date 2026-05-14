import logging
import time

import socketio  # type: ignore[reportMissingTypeStubs]
from flask import request
from opentelemetry.trace import get_current_span
from opentelemetry.trace.span import INVALID_SPAN_ID, INVALID_TRACE_ID

from configs import dify_config
from contexts.wrapper import RecyclableContextVar
from controllers.console.error import UnauthorizedAndForceLogout
from core.logging.context import init_request_context
from dify_app import DifyApp
from extensions.ext_socketio import sio
from services.enterprise.enterprise_service import EnterpriseService
from services.feature_service import LicenseStatus

logger = logging.getLogger(__name__)

# Console bootstrap APIs exempt from license check.
# Defined at module level to avoid per-request tuple construction.
# - system-features: license status for expiry UI (GlobalPublicStoreProvider)
# - setup: install/setup status check (AppInitializer)
# - init: init password validation for fresh install (InitPasswordPopup)
# - login: auto-login after setup completion (InstallForm)
# - features: billing/plan features (ProviderContextProvider)
# - account/profile: login check + user profile (AppContextProvider, useIsLogin)
# - workspaces/current: workspace + model providers (AppContextProvider)
# - version: version check (AppContextProvider)
# - activate/check: invitation link validation (signin page)
# Without these exemptions, the signin page triggers location.reload()
# on unauthorized_and_force_logout, causing an infinite loop.
_CONSOLE_EXEMPT_PREFIXES = (
    "/console/api/system-features",
    "/console/api/setup",
    "/console/api/init",
    "/console/api/login",
    "/console/api/features",
    "/console/api/account/profile",
    "/console/api/workspaces/current",
    "/console/api/version",
    "/console/api/activate/check",
)


# ----------------------------
# Application Factory Function
# ----------------------------
def create_flask_app_with_configs() -> DifyApp:
    """
    create a raw flask app
    with configs loaded from .env file
    """
    dify_app = DifyApp(__name__)
    dify_app.config.from_mapping(dify_config.model_dump())
    dify_app.config["RESTX_INCLUDE_ALL_MODELS"] = True

    # add before request hook
    @dify_app.before_request
    def before_request():
        # Initialize logging context for this request
        init_request_context()
        RecyclableContextVar.increment_thread_recycles()

        # Enterprise license validation for API endpoints (both console and webapp)
        # When license expires, block all API access except bootstrap endpoints needed
        # for the frontend to load the license expiration page without infinite reloads.
        if dify_config.ENTERPRISE_ENABLED:
            is_console_api = request.path.startswith("/console/api/")
            is_webapp_api = request.path.startswith("/api/")

            if is_console_api or is_webapp_api:
                if is_console_api:
                    is_exempt = any(request.path.startswith(p) for p in _CONSOLE_EXEMPT_PREFIXES)
                else:  # webapp API
                    is_exempt = request.path.startswith("/api/system-features")

                if not is_exempt:
                    try:
                        # Check license status (cached — see EnterpriseService for TTL details)
                        license_status = EnterpriseService.get_cached_license_status()
                        if license_status in (LicenseStatus.INACTIVE, LicenseStatus.EXPIRED, LicenseStatus.LOST):
                            raise UnauthorizedAndForceLogout(
                                f"Enterprise license is {license_status}. Please contact your administrator."
                            )
                        if license_status is None:
                            raise UnauthorizedAndForceLogout(
                                "Unable to verify enterprise license. Please contact your administrator."
                            )
                    except UnauthorizedAndForceLogout:
                        raise
                    except Exception:
                        logger.exception("Failed to check enterprise license status")
                        raise UnauthorizedAndForceLogout(
                            "Unable to verify enterprise license. Please contact your administrator."
                        )

    # add after request hook for injecting trace headers from OpenTelemetry span context
    # Only adds headers when OTEL is enabled and has valid context
    @dify_app.after_request
    def add_trace_headers(response):
        try:
            span = get_current_span()
            ctx = span.get_span_context() if span else None

            if not ctx or not ctx.is_valid:
                return response

            # Inject trace headers from OTEL context
            if ctx.trace_id != INVALID_TRACE_ID and "X-Trace-Id" not in response.headers:
                response.headers["X-Trace-Id"] = format(ctx.trace_id, "032x")
            if ctx.span_id != INVALID_SPAN_ID and "X-Span-Id" not in response.headers:
                response.headers["X-Span-Id"] = format(ctx.span_id, "016x")

        except Exception:
            # Never break the response due to tracing header injection
            logger.warning("Failed to add trace headers to response", exc_info=True)
        return response

    # Capture the decorator return values so static checkers do not treat the hooks as unused.
    _ = before_request
    _ = add_trace_headers

    return dify_app


def create_app() -> tuple[socketio.WSGIApp, DifyApp]:
    start_time = time.perf_counter()
    app = create_flask_app_with_configs()
    initialize_extensions(app)

    sio.app = app
    socketio_app = socketio.WSGIApp(sio, app)

    end_time = time.perf_counter()
    if dify_config.DEBUG:
        logger.info("Finished create_app (%s ms)", round((end_time - start_time) * 1000, 2))
    return socketio_app, app


def initialize_extensions(app: DifyApp):
    # Initialize Flask context capture for workflow execution
    from context.flask_app_context import init_flask_context
    from extensions import (
        ext_app_metrics,
        ext_blueprints,
        ext_celery,
        ext_code_based_extension,
        ext_commands,
        ext_compress,
        ext_database,
        ext_enterprise_telemetry,
        ext_fastopenapi,
        ext_forward_refs,
        ext_hosting_provider,
        ext_import_modules,
        ext_logging,
        ext_login,
        ext_logstore,
        ext_mail,
        ext_migrate,
        ext_orjson,
        ext_otel,
        ext_proxy_fix,
        ext_redis,
        ext_request_logging,
        ext_sentry,
        ext_session_factory,
        ext_set_secretkey,
        ext_storage,
        ext_timezone,
        ext_warnings,
    )

    init_flask_context()

    extensions = [
        ext_timezone,
        ext_logging,
        ext_warnings,
        ext_import_modules,
        ext_orjson,
        ext_forward_refs,
        ext_compress,
        ext_code_based_extension,
        ext_database,
        ext_app_metrics,
        ext_migrate,
        ext_redis,
        ext_storage,
        ext_set_secretkey,
        ext_logstore,  # Initialize logstore after storage, before celery
        ext_celery,
        ext_login,
        ext_mail,
        ext_hosting_provider,
        ext_sentry,
        ext_proxy_fix,
        ext_blueprints,
        ext_commands,
        ext_fastopenapi,
        ext_otel,
        ext_enterprise_telemetry,
        ext_request_logging,
        ext_session_factory,
    ]
    for ext in extensions:
        short_name = ext.__name__.split(".")[-1]
        is_enabled = ext.is_enabled() if hasattr(ext, "is_enabled") else True
        if not is_enabled:
            if dify_config.DEBUG:
                logger.info("Skipped %s", short_name)
            continue

        start_time = time.perf_counter()
        ext.init_app(app)
        end_time = time.perf_counter()
        if dify_config.DEBUG:
            logger.info("Loaded %s (%s ms)", short_name, round((end_time - start_time) * 1000, 2))


def create_migrations_app() -> DifyApp:
    app = create_flask_app_with_configs()
    from extensions import ext_database, ext_migrate

    # Initialize only required extensions
    ext_database.init_app(app)
    ext_migrate.init_app(app)

    return app
