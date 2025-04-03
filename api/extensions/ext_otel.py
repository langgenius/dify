import logging
import os

from flask_login import current_user
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.metrics import set_meter_provider
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import ConsoleMetricExporter, PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
)
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import Span, get_tracer_provider, set_tracer_provider

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)

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
        get_tracer_provider().add_span_processor(
            BatchSpanProcessor(exporter)
        )
        reader = PeriodicExportingMetricReader(metric_exporter)
        set_meter_provider(MeterProvider(resource=resource, metric_readers=[reader]))
        def request_hook(span: Span, environ: dict):
            try: 
                user_id = current_user.id
                tenant_id = current_user.current_tenant_id
            except:
                tenant_id = ""
                user_id = ""
            if span and span.is_recording():
                span.set_attribute("service.tenant.id", tenant_id)
                span.set_attribute("service.user.id", user_id)
        
        def response_hook(span: Span, status: str, response_headers: list):
            pass

        instrumentor = FlaskInstrumentor()
        instrumentor.instrument_app(app, request_hook=request_hook, response_hook=response_hook)