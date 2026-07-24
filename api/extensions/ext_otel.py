import atexit
import logging
import os
import platform
import socket
from typing import Union

from configs import dify_config
from dify_app import DifyApp

logger = logging.getLogger(__name__)


def init_app(app: DifyApp):
    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter as GRPCMetricExporter
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter as GRPCSpanExporter
    from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter as HTTPMetricExporter
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as HTTPSpanExporter
    from opentelemetry.metrics import set_meter_provider
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import ConsoleMetricExporter, PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import (
        BatchSpanProcessor,
        ConsoleSpanExporter,
    )
    from opentelemetry.sdk.trace.sampling import ParentBasedTraceIdRatio
    from opentelemetry.semconv._incubating.attributes.deployment_attributes import (  # type: ignore[import-untyped]
        DEPLOYMENT_ENVIRONMENT_NAME,
    )
    from opentelemetry.semconv._incubating.attributes.host_attributes import (  # type: ignore[import-untyped]
        HOST_ARCH,
        HOST_ID,
        HOST_NAME,
    )
    from opentelemetry.semconv._incubating.attributes.os_attributes import (  # type: ignore[import-untyped]
        OS_DESCRIPTION,
        OS_TYPE,
        OS_VERSION,
    )
    from opentelemetry.semconv._incubating.attributes.process_attributes import (  # type: ignore[import-untyped]
        PROCESS_PID,
    )
    from opentelemetry.semconv.attributes.service_attributes import (  # type: ignore[import-untyped]
        SERVICE_NAME,
        SERVICE_VERSION,
    )
    from opentelemetry.trace import set_tracer_provider

    from extensions.otel.instrumentation import init_instruments
    from extensions.otel.runtime import setup_context_propagation, shutdown_tracer

    setup_context_propagation()
    # Initialize OpenTelemetry
    # Follow Semantic Convertions 1.32.0 to define resource attributes
    resource = Resource(
        attributes={
            SERVICE_NAME: dify_config.APPLICATION_NAME,
            SERVICE_VERSION: f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
            PROCESS_PID: os.getpid(),
            DEPLOYMENT_ENVIRONMENT_NAME: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
            HOST_NAME: socket.gethostname(),
            HOST_ARCH: platform.machine(),
            "custom.deployment.git_commit": dify_config.COMMIT_SHA,
            HOST_ID: platform.node(),
            OS_TYPE: platform.system().lower(),
            OS_DESCRIPTION: platform.platform(),
            OS_VERSION: platform.version(),
        }
    )
    sampler = ParentBasedTraceIdRatio(dify_config.OTEL_SAMPLING_RATE)
    provider = TracerProvider(resource=resource, sampler=sampler)

    set_tracer_provider(provider)
    exporter: Union[GRPCSpanExporter, HTTPSpanExporter, ConsoleSpanExporter]
    metric_exporter: Union[GRPCMetricExporter, HTTPMetricExporter, ConsoleMetricExporter]
    protocol = (dify_config.OTEL_EXPORTER_OTLP_PROTOCOL or "").lower()
    if dify_config.OTEL_EXPORTER_TYPE == "otlp":
        if protocol == "grpc":
            exporter = GRPCSpanExporter(
                endpoint=dify_config.OTLP_BASE_ENDPOINT,
                # Header field names must consist of lowercase letters, check RFC7540
                headers=(("authorization", f"Bearer {dify_config.OTLP_API_KEY}"),),
                insecure=True,
            )
            metric_exporter = GRPCMetricExporter(
                endpoint=dify_config.OTLP_BASE_ENDPOINT,
                headers=(("authorization", f"Bearer {dify_config.OTLP_API_KEY}"),),
                insecure=True,
            )
        else:
            headers = {"Authorization": f"Bearer {dify_config.OTLP_API_KEY}"} if dify_config.OTLP_API_KEY else None

            trace_endpoint = dify_config.OTLP_TRACE_ENDPOINT
            if not trace_endpoint:
                trace_endpoint = dify_config.OTLP_BASE_ENDPOINT + "/v1/traces"
            exporter = HTTPSpanExporter(
                endpoint=trace_endpoint,
                headers=headers,
            )

            metric_endpoint = dify_config.OTLP_METRIC_ENDPOINT
            if not metric_endpoint:
                metric_endpoint = dify_config.OTLP_BASE_ENDPOINT + "/v1/metrics"
            metric_exporter = HTTPMetricExporter(
                endpoint=metric_endpoint,
                headers=headers,
            )
    else:
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

    init_instruments(app)

    atexit.register(shutdown_tracer)


def is_enabled():
    return dify_config.ENABLE_OTEL
