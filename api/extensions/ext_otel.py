import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from flask import g
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.sqlalchemy import SQLAlchemyInstrumentor
from opentelemetry.metrics import set_meter_provider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import ConsoleMetricExporter, PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SpanProcessor,
)
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import Span, get_current_span, get_tracer_provider, set_tracer_provider

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)
from flask import has_request_context, request
from flask_login import user_loaded_from_request, user_logged_in


class DifyAttributesSpanProcessor(SpanProcessor):
    def __init__(self, attributes_provider: Callable[[], dict[str, Any]] | None = None):
        self.attributes_provider = attributes_provider
        self._processing = threading.local() # Avoid recursion

    def on_start(self, span: "Span", parent_context = None) -> None:
        try:
            # FIXME: on_start is called too early before login callbacks
            # so any user info in context like ContextVar, g, etc. is not available
            # We can query user info from database in this function
            # But it's not a good idea to do it here, because it will cause a database query
            # And it will cause a performance issue
            # Besides, query will trigger another on_start call
            # So we need to find a better way to do it
            if getattr(self._processing, 'is_processing', False):
                return

            is_sql_span = span.name.startswith(('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'connect'))
            if is_sql_span:
                logging.info(f"parent_context: {parent_context}, parent span: {span.get_span_context()}")
            else: 
                if has_request_context():
                    logger.info(f"otel Current request path: {request.path}, method: \
                                {request.method}, headers: {request.headers}")
                    logger.info(f"otel g objects: {vars(g)}")
                logging.info(f"otel current span attributes: {span.attributes}")

                self._processing.is_processing = True
                try:
                    if self.attributes_provider:
                        attributes = self.attributes_provider()
                        for key, value in attributes.items():
                            span.set_attribute(key, value)
                finally:
                    self._processing.is_processing = False
        except Exception:
            logger.exception("Error setting span attributes")


    def on_end(self, span: "ReadableSpan") -> None:
        pass

    def force_flush(self, timeout_millis: float | None = None) -> bool:
        return True

    def shutdown(self) -> None:
        pass


# Set it when user logs in
@user_logged_in.connect
@user_loaded_from_request.connect
def on_user_loaded(_sender, user):
    if user:
        current_span = get_current_span()
        if current_span:
            current_span.set_attribute("service.tenant.id", user.current_tenant_id)
            current_span.set_attribute("service.user.id", user.id)

def init_app(app: DifyApp):
    if dify_config.ENABLE_OTEL:
        # Initialize OpenTelemetry
        # Follow Semantic Convertions 1.32.0 to define resource attributes
        resource = Resource(attributes={
            ResourceAttributes.SERVICE_NAME: dify_config.APPLICATION_NAME,
            ResourceAttributes.SERVICE_VERSION: f"dify-{dify_config.CURRENT_VERSION}-{dify_config.COMMIT_SHA}",
            ResourceAttributes.PROCESS_PID: os.getpid(),
            ResourceAttributes.DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
        })
        set_tracer_provider(TracerProvider(resource=resource))
        if dify_config.OTEL_EXPORTER_TYPE == "console":
            exporter = ConsoleSpanExporter()
            metric_exporter = ConsoleMetricExporter()
        else:
            exporter = OTLPSpanExporter(
                endpoint=dify_config.OTLP_BASE_ENDPOINT + "/v1/traces",
                headers={"Authorization": f"Bearer {dify_config.OTLP_API_KEY}"},
            )
            metric_exporter = OTLPMetricExporter(
                endpoint=dify_config.OTLP_BASE_ENDPOINT + "/v1/metrics",
                headers={"Authorization": f"Bearer {dify_config.OTLP_API_KEY}"},
            )
        get_tracer_provider().add_span_processor(DifyAttributesSpanProcessor())
        get_tracer_provider().add_span_processor(
            BatchSpanProcessor(exporter)
        )
        reader = PeriodicExportingMetricReader(metric_exporter)
        set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))

        instrumentor = FlaskInstrumentor()
        instrumentor.instrument_app(app)
        with app.app_context():
            engines = list(app.extensions['sqlalchemy'].engines.values())
            SQLAlchemyInstrumentor().instrument(enable_commenter=True, engines=engines)