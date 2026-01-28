import logging
import time

from opentelemetry.trace import get_current_span
from opentelemetry.trace.span import INVALID_SPAN_ID, INVALID_TRACE_ID

from configs import dify_config
from contexts.wrapper import RecyclableContextVar
from core.logging.context import init_request_context
from dify_app import DifyApp

logger = logging.getLogger(__name__)


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

    # Capture the decorator's return value to avoid pyright reportUnusedFunction
    _ = before_request
    _ = add_trace_headers

    return dify_app


def create_app() -> DifyApp:
    start_time = time.perf_counter()
    app = create_flask_app_with_configs()
    initialize_extensions(app)
    end_time = time.perf_counter()
    if dify_config.DEBUG:
        logger.info("Finished create_app (%s ms)", round((end_time - start_time) * 1000, 2))
    return app


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
        ext_set_secretkey,
        ext_compress,
        ext_code_based_extension,
        ext_database,
        ext_app_metrics,
        ext_migrate,
        ext_redis,
        ext_storage,
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


def create_migrations_app():
    app = create_flask_app_with_configs()
    from extensions import ext_database, ext_migrate

    # Initialize only required extensions
    ext_database.init_app(app)
    ext_migrate.init_app(app)

    return app
