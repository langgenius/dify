import logging

from flask_login import current_user
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
)
from opentelemetry.trace import Span, get_tracer_provider, set_tracer_provider

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)

def init_app(app: DifyApp):
    if dify_config.ENABLE_OTEL:
        # Initialize OpenTelemetry
        set_tracer_provider(TracerProvider())
        if dify_config.OTEL_EXPORTER_TYPE == "console":
            exporter = ConsoleSpanExporter()
        else:
            # TODO: deploy with otel collector
            exporter = OTLPSpanExporter(
                endpoint=dify_config.OTLP_BASE_ENDPOINT + "/v1/traces",
                headers={"Authorization": f"Bearer {dify_config.OTLP_API_KEY}"},
            )
        get_tracer_provider().add_span_processor(
            BatchSpanProcessor(exporter)
        )

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
