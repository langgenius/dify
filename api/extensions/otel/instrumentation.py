import contextlib
import logging

from quart import request
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.metrics import get_meter, get_meter_provider
from opentelemetry.semconv.trace import SpanAttributes
from opentelemetry.trace import Span, get_current_span, get_tracer_provider
from opentelemetry.trace.status import StatusCode

from configs import dify_config
from dify_app import DifyApp
from extensions.otel.runtime import is_celery_worker

logger = logging.getLogger(__name__)


class ExceptionLoggingHandler(logging.Handler):
    """
    Handler that records exceptions to the current OpenTelemetry span.

    Unlike creating a new span, this records exceptions on the existing span
    to maintain trace context consistency throughout the request lifecycle.
    """

    def emit(self, record: logging.LogRecord):
        with contextlib.suppress(Exception):
            if not record.exc_info:
                return

            from opentelemetry.trace import get_current_span

            span = get_current_span()
            if not span or not span.is_recording():
                return

            # Record exception on the current span instead of creating a new one
            span.set_status(StatusCode.ERROR, record.getMessage())

            # Add log context as span events/attributes
            span.add_event(
                "log.exception",
                attributes={
                    "log.level": record.levelname,
                    "log.message": record.getMessage(),
                    "log.logger": record.name,
                    "log.file.path": record.pathname,
                    "log.file.line": record.lineno,
                },
            )

            if record.exc_info[1]:
                span.record_exception(record.exc_info[1])
            if record.exc_info[0]:
                span.set_attribute("exception.type", record.exc_info[0].__name__)


def instrument_exception_logging() -> None:
    exception_handler = ExceptionLoggingHandler()
    logging.getLogger().addHandler(exception_handler)


def init_asgi_instrumentor(app: DifyApp) -> None:
    meter = get_meter("http_metrics", version=dify_config.project.version)
    _http_response_counter = meter.create_counter(
        "http.server.response.count",
        description="Total number of HTTP responses by status code, method and target",
        unit="{response}",
    )

    if hasattr(app, "asgi_app"):
        app.asgi_app = OpenTelemetryMiddleware(app.asgi_app)
    else:
        app.asgi_app = OpenTelemetryMiddleware(app)

    if dify_config.DEBUG:
        logger.info("Initializing ASGI instrumentor")

    @app.after_request  # type: ignore[misc]
    async def add_http_metrics(response):  # pyright: ignore[reportUnusedFunction]
        span = get_current_span()
        if span and span.is_recording():
            try:
                status_code = response.status_code
                if 200 <= status_code < 400:
                    span.set_status(StatusCode.OK)
                else:
                    span.set_status(StatusCode.ERROR, str(status_code))

                status_class = f"{status_code // 100}xx"
                attributes: dict[str, str | int] = {"status_code": status_code, "status_class": status_class}
                if request and request.url_rule:
                    attributes[SpanAttributes.HTTP_TARGET] = str(request.url_rule.rule)
                if request and request.method:
                    attributes[SpanAttributes.HTTP_METHOD] = str(request.method)
                _http_response_counter.add(1, attributes)
            except Exception:
                logger.exception("Error setting status and attributes")
        return response


async def init_sqlalchemy_instrumentor(app: DifyApp) -> None:
    from extensions.ext_database import db

    async with app.app_context():
        engines = [db.engine]
        binds = app.config.get("SQLALCHEMY_BINDS") or {}
        for bind_key in binds:
            engines.append(db.get_engine(bind_key=bind_key))
        SQLAlchemyInstrumentor().instrument(enable_commenter=True, engines=engines)


def init_redis_instrumentor() -> None:
    RedisInstrumentor().instrument()


def init_httpx_instrumentor() -> None:
    HTTPXClientInstrumentor().instrument()


def init_instruments(app: DifyApp) -> None:
    if not is_celery_worker():
        init_asgi_instrumentor(app)
        CeleryInstrumentor(tracer_provider=get_tracer_provider(), meter_provider=get_meter_provider()).instrument()

    instrument_exception_logging()

    async def _init_sqlalchemy() -> None:
        await init_sqlalchemy_instrumentor(app)

    app.before_serving(_init_sqlalchemy)
    init_redis_instrumentor()
    init_httpx_instrumentor()
