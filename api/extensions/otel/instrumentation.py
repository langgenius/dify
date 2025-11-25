import contextlib
import logging

import flask
from opentelemetry.instrumentation.celery import CeleryInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.metrics import get_meter, get_meter_provider
from opentelemetry.semconv.trace import SpanAttributes
from opentelemetry.trace import Span, get_tracer_provider
from opentelemetry.trace.status import StatusCode

from configs import dify_config
from dify_app import DifyApp
from extensions.otel.runtime import is_celery_worker

logger = logging.getLogger(__name__)


class ExceptionLoggingHandler(logging.Handler):
    def emit(self, record: logging.LogRecord):
        with contextlib.suppress(Exception):
            if record.exc_info:
                tracer = get_tracer_provider().get_tracer("dify.exception.logging")
                with tracer.start_as_current_span(
                    "log.exception",
                    attributes={
                        "log.level": record.levelname,
                        "log.message": record.getMessage(),
                        "log.logger": record.name,
                        "log.file.path": record.pathname,
                        "log.file.line": record.lineno,
                    },
                ) as span:
                    span.set_status(StatusCode.ERROR)
                    if record.exc_info[1]:
                        span.record_exception(record.exc_info[1])
                        span.set_attribute("exception.message", str(record.exc_info[1]))
                    if record.exc_info[0]:
                        span.set_attribute("exception.type", record.exc_info[0].__name__)


def instrument_exception_logging() -> None:
    exception_handler = ExceptionLoggingHandler()
    logging.getLogger().addHandler(exception_handler)


def init_flask_instrumentor(app: DifyApp) -> None:
    meter = get_meter("http_metrics", version=dify_config.project.version)
    _http_response_counter = meter.create_counter(
        "http.server.response.count",
        description="Total number of HTTP responses by status code, method and target",
        unit="{response}",
    )

    def response_hook(span: Span, status: str, response_headers: list) -> None:
        if span and span.is_recording():
            try:
                if status.startswith("2"):
                    span.set_status(StatusCode.OK)
                else:
                    span.set_status(StatusCode.ERROR, status)

                status = status.split(" ")[0]
                status_code = int(status)
                status_class = f"{status_code // 100}xx"
                attributes: dict[str, str | int] = {"status_code": status_code, "status_class": status_class}
                request = flask.request
                if request and request.url_rule:
                    attributes[SpanAttributes.HTTP_TARGET] = str(request.url_rule.rule)
                if request and request.method:
                    attributes[SpanAttributes.HTTP_METHOD] = str(request.method)
                _http_response_counter.add(1, attributes)
            except Exception:
                logger.exception("Error setting status and attributes")

    from opentelemetry.instrumentation.flask import FlaskInstrumentor

    instrumentor = FlaskInstrumentor()
    if dify_config.DEBUG:
        logger.info("Initializing Flask instrumentor")
    instrumentor.instrument_app(app, response_hook=response_hook)


def init_sqlalchemy_instrumentor(app: DifyApp) -> None:
    with app.app_context():
        engines = list(app.extensions["sqlalchemy"].engines.values())
        SQLAlchemyInstrumentor().instrument(enable_commenter=True, engines=engines)


def init_redis_instrumentor() -> None:
    RedisInstrumentor().instrument()


def init_httpx_instrumentor() -> None:
    HTTPXClientInstrumentor().instrument()


def init_instruments(app: DifyApp) -> None:
    if not is_celery_worker():
        init_flask_instrumentor(app)
        CeleryInstrumentor(tracer_provider=get_tracer_provider(), meter_provider=get_meter_provider()).instrument()

    instrument_exception_logging()
    init_sqlalchemy_instrumentor(app)
    init_redis_instrumentor()
    init_httpx_instrumentor()
