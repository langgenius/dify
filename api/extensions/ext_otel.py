import atexit
import logging
import os
import platform
import socket
import sys
from typing import Union

import flask
from celery.signals import worker_init  # type: ignore
from flask_login import user_loaded_from_request, user_logged_in  # type: ignore

from configs import dify_config
from dify_app import DifyApp


@user_logged_in.connect
@user_loaded_from_request.connect
def on_user_loaded(_sender, user):
    if dify_config.ENABLE_OTEL:
        from opentelemetry.trace import get_current_span

        if user:
            current_span = get_current_span()
            if current_span:
                current_span.set_attribute("service.tenant.id", user.current_tenant_id)
                current_span.set_attribute("service.user.id", user.id)


def init_app(app: DifyApp):
    from opentelemetry.semconv.trace import SpanAttributes

    def is_celery_worker():
        return "celery" in sys.argv[0].lower()

    def instrument_exception_logging():
        exception_handler = ExceptionLoggingHandler()
        logging.getLogger().addHandler(exception_handler)

    def init_flask_instrumentor(app: DifyApp):
        meter = get_meter("http_metrics", version=dify_config.CURRENT_VERSION)
        _http_response_counter = meter.create_counter(
            "http.server.response.count",
            description="Total number of HTTP responses by status code, method and target",
            unit="{response}",
        )

        def response_hook(span: Span, status: str, response_headers: list):
            if span and span.is_recording():
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

        instrumentor = FlaskInstrumentor()
        if dify_config.DEBUG:
            logging.info("Initializing Flask instrumentor")
        instrumentor.instrument_app(app, response_hook=response_hook)

    def init_sqlalchemy_instrumentor(app: DifyApp):
        with app.app_context():
            engines = list(app.extensions["sqlalchemy"].engines.values())
            SQLAlchemyInstrumentor().instrument(enable_commenter=True, engines=engines)

    def setup_context_propagation():
        # Configure propagators
        set_global_textmap(
            CompositePropagator(
                [
                    TraceContextTextMapPropagator(),  # W3C trace context
                    B3Format(),  # B3 propagation (used by many systems)
                ]
            )
        )

    def shutdown_tracer():
        provider = trace.get_tracer_provider()
        if hasattr(provider, "force_flush"):
            provider.force_flush()

    class ExceptionLoggingHandler(logging.Handler):
        """Custom logging handler that creates spans for logging.exception() calls"""

        def emit(self, record):
            try:
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
                        span.record_exception(record.exc_info[1])
                        span.set_attribute("exception.type", record.exc_info[0].__name__)
                        span.set_attribute("exception.message", str(record.exc_info[1]))
            except Exception:
                pass

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.instrumentation.celery import CeleryInstrumentor
    from opentelemetry.instrumentation.flask import FlaskInstrumentor
    from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
    from opentelemetry.metrics import get_meter, get_meter_provider, set_meter_provider
    from opentelemetry.propagate import set_global_textmap
    from opentelemetry.propagators.b3 import B3Format
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import ConsoleMetricExporter, PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        BatchSpanProcessor,
        ConsoleSpanExporter,
    )
    from opentelemetry.sdk.trace.sampling import ParentBasedTraceIdRatio
    from opentelemetry.semconv.resource import ResourceAttributes
    from opentelemetry.trace import Span, get_tracer_provider, set_tracer_provider
    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
    from opentelemetry.trace.status import StatusCode

    setup_context_propagation()
    # Initialize OpenTelemetry
    # Follow Semantic Convertions 1.32.0 to define resource attributes
    resource = Resource(
        attributes={
            ResourceAttributes.SERVICE_NAME: dify_config.APPLICATION_NAME,
            ResourceAttributes.SERVICE_VERSION: f"dify-{dify_config.CURRENT_VERSION}-{dify_config.COMMIT_SHA}",
            ResourceAttributes.PROCESS_PID: os.getpid(),
            ResourceAttributes.DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
            ResourceAttributes.HOST_NAME: socket.gethostname(),
            ResourceAttributes.HOST_ARCH: platform.machine(),
            "custom.deployment.git_commit": dify_config.COMMIT_SHA,
            ResourceAttributes.HOST_ID: platform.node(),
            ResourceAttributes.OS_TYPE: platform.system().lower(),
            ResourceAttributes.OS_DESCRIPTION: platform.platform(),
            ResourceAttributes.OS_VERSION: platform.version(),
        }
    )
    sampler = ParentBasedTraceIdRatio(dify_config.OTEL_SAMPLING_RATE)
    provider = TracerProvider(resource=resource, sampler=sampler)
    set_tracer_provider(provider)
    exporter: Union[OTLPSpanExporter, ConsoleSpanExporter]
    metric_exporter: Union[OTLPMetricExporter, ConsoleMetricExporter]
    if dify_config.OTEL_EXPORTER_TYPE == "otlp":
        exporter = OTLPSpanExporter(
            endpoint=dify_config.OTLP_BASE_ENDPOINT + "/v1/traces",
            headers={"Authorization": f"Bearer {dify_config.OTLP_API_KEY}"},
        )
        metric_exporter = OTLPMetricExporter(
            endpoint=dify_config.OTLP_BASE_ENDPOINT + "/v1/metrics",
            headers={"Authorization": f"Bearer {dify_config.OTLP_API_KEY}"},
        )
    else:
        # Fallback to console exporter
        exporter = ConsoleSpanExporter()
        metric_exporter = ConsoleMetricExporter()

    provider.add_span_processor(
        BatchSpanProcessor(
            exporter,
            max_queue_size=dify_config.OTEL_MAX_QUEUE_SIZE,
            schedule_delay_millis=dify_config.OTEL_BATCH_EXPORT_SCHEDULE_DELAY,
            max_export_batch_size=dify_config.OTEL_MAX_EXPORT_BATCH_SIZE,
            export_timeout_millis=dify_config.OTEL_BATCH_EXPORT_TIMEOUT,
        )
    )
    reader = PeriodicExportingMetricReader(
        metric_exporter,
        export_interval_millis=dify_config.OTEL_METRIC_EXPORT_INTERVAL,
        export_timeout_millis=dify_config.OTEL_METRIC_EXPORT_TIMEOUT,
    )
    set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))
    if not is_celery_worker():
        init_flask_instrumentor(app)
        CeleryInstrumentor(tracer_provider=get_tracer_provider(), meter_provider=get_meter_provider()).instrument()
    instrument_exception_logging()
    init_sqlalchemy_instrumentor(app)
    atexit.register(shutdown_tracer)


def is_enabled():
    return dify_config.ENABLE_OTEL


@worker_init.connect(weak=False)
def init_celery_worker(*args, **kwargs):
    if dify_config.ENABLE_OTEL:
        from opentelemetry.instrumentation.celery import CeleryInstrumentor
        from opentelemetry.metrics import get_meter_provider
        from opentelemetry.trace import get_tracer_provider

        tracer_provider = get_tracer_provider()
        metric_provider = get_meter_provider()
        if dify_config.DEBUG:
            logging.info("Initializing OpenTelemetry for Celery worker")
        CeleryInstrumentor(tracer_provider=tracer_provider, meter_provider=metric_provider).instrument()
