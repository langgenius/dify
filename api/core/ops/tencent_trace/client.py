"""
Tencent APM Trace Client - handles network operations, metrics, and API communication
"""

import importlib
import logging
import os
import socket
from typing import Optional
from urllib.parse import urlparse

from opentelemetry import trace as trace_api
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import SpanKind

from configs import dify_config

from .entities.tencent_semconv import LLM_OPERATION_DURATION
from .entities.tencent_trace_entity import SpanData

logger = logging.getLogger(__name__)


class TencentTraceClient:
    """Tencent APM trace client using OpenTelemetry OTLP exporter"""

    def __init__(
        self,
        service_name: str,
        endpoint: str,
        token: str,
        max_queue_size: int = 1000,
        schedule_delay_sec: int = 5,
        max_export_batch_size: int = 50,
        metrics_export_interval_sec: int = 10,
    ):
        self.endpoint = endpoint
        self.token = token
        self.service_name = service_name
        self.metrics_export_interval_sec = metrics_export_interval_sec

        self.resource = Resource(
            attributes={
                ResourceAttributes.SERVICE_NAME: service_name,
                ResourceAttributes.SERVICE_VERSION: f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
                ResourceAttributes.DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
                ResourceAttributes.HOST_NAME: socket.gethostname(),
            }
        )
        # Prepare gRPC endpoint/metadata
        grpc_endpoint = endpoint
        insecure = False
        if endpoint.startswith("http://") or endpoint.startswith("https://"):
            parsed = urlparse(endpoint)
            host = parsed.hostname or "localhost"
            port = parsed.port or 4317
            grpc_endpoint = f"{host}:{port}"
            insecure = parsed.scheme == "http"
        else:
            if "localhost" in endpoint or "127.0.0.1" in endpoint:
                insecure = True

        headers = (("authorization", f"Bearer {token}"),)

        self.exporter = OTLPSpanExporter(
            endpoint=grpc_endpoint,
            headers=headers,
            insecure=insecure,
            timeout=30,
        )

        self.tracer_provider = TracerProvider(resource=self.resource)
        self.span_processor = BatchSpanProcessor(
            span_exporter=self.exporter,
            max_queue_size=max_queue_size,
            schedule_delay_millis=schedule_delay_sec * 1000,
            max_export_batch_size=max_export_batch_size,
        )
        self.tracer_provider.add_span_processor(self.span_processor)

        self.tracer = self.tracer_provider.get_tracer("dify.tencent_apm")

        # Store span contexts for parent-child relationships
        self.span_contexts: dict[int, trace_api.SpanContext] = {}

        self.meter: Optional[object] = None
        self.hist_llm_duration: Optional[object] = None
        self.metric_reader: Optional[object] = None

        # Metrics exporter and instruments
        try:
            from opentelemetry import metrics
            from opentelemetry.sdk.metrics import Histogram, MeterProvider
            from opentelemetry.sdk.metrics.export import AggregationTemporality, PeriodicExportingMetricReader

            protocol = os.getenv("OTEL_EXPORTER_OTLP_PROTOCOL", "").strip().lower()
            use_http_protobuf = protocol in {"http/protobuf", "http-protobuf"}
            use_http_json = protocol in {"http/json", "http-json"}

            # Set preferred temporality for histograms to DELTA
            preferred_temporality: dict[type, AggregationTemporality] = {Histogram: AggregationTemporality.DELTA}

            metric_reader = None
            if use_http_json:
                exporter_cls = None
                for mod_path in (
                    "opentelemetry.exporter.otlp.http.json.metric_exporter",
                    "opentelemetry.exporter.otlp.json.metric_exporter",
                ):
                    try:
                        mod = importlib.import_module(mod_path)
                        exporter_cls = getattr(mod, "OTLPMetricExporter", None)
                        if exporter_cls:
                            break
                    except Exception:
                        continue
                if exporter_cls is not None:
                    try:
                        metric_exporter = exporter_cls(
                            endpoint=endpoint,
                            headers={"authorization": f"Bearer {token}"},
                            preferred_temporality=preferred_temporality,
                        )
                    except Exception:
                        metric_exporter = exporter_cls(
                            endpoint=endpoint,
                            headers={"authorization": f"Bearer {token}"},
                        )
                else:
                    from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
                        OTLPMetricExporter as HttpMetricExporter,
                    )

                    try:
                        metric_exporter = HttpMetricExporter(
                            endpoint=endpoint,
                            headers={"authorization": f"Bearer {token}"},
                            preferred_temporality=preferred_temporality,
                        )
                    except Exception:
                        metric_exporter = HttpMetricExporter(
                            endpoint=endpoint,
                            headers={"authorization": f"Bearer {token}"},
                        )
                metric_reader = PeriodicExportingMetricReader(
                    metric_exporter, export_interval_millis=self.metrics_export_interval_sec * 1000
                )

            elif use_http_protobuf:
                from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
                    OTLPMetricExporter as HttpMetricExporter,
                )

                try:
                    metric_exporter = HttpMetricExporter(
                        endpoint=endpoint,
                        headers={"authorization": f"Bearer {token}"},
                        preferred_temporality=preferred_temporality,
                    )
                except Exception:
                    metric_exporter = HttpMetricExporter(
                        endpoint=endpoint,
                        headers={"authorization": f"Bearer {token}"},
                    )
                metric_reader = PeriodicExportingMetricReader(
                    metric_exporter, export_interval_millis=self.metrics_export_interval_sec * 1000
                )
            else:
                from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import (
                    OTLPMetricExporter as GrpcMetricExporter,
                )

                grpc_endpoint = endpoint
                insecure = False
                if endpoint.startswith("http://") or endpoint.startswith("https://"):
                    parsed = urlparse(endpoint)
                    host = parsed.hostname or "localhost"
                    port = parsed.port or 4317
                    grpc_endpoint = f"{host}:{port}"
                    insecure = parsed.scheme == "http"
                else:
                    if "localhost" in endpoint or "127.0.0.1" in endpoint:
                        insecure = True

                try:
                    metric_exporter = GrpcMetricExporter(
                        endpoint=grpc_endpoint,
                        headers={"authorization": f"Bearer {token}"},
                        insecure=insecure,
                        preferred_temporality=preferred_temporality,
                    )
                except Exception:
                    metric_exporter = GrpcMetricExporter(
                        endpoint=grpc_endpoint,
                        headers={"authorization": f"Bearer {token}"},
                        insecure=insecure,
                    )
                metric_reader = PeriodicExportingMetricReader(
                    metric_exporter, export_interval_millis=self.metrics_export_interval_sec * 1000
                )

            if metric_reader is not None:
                provider = MeterProvider(resource=self.resource, metric_readers=[metric_reader])
                metrics.set_meter_provider(provider)
                self.meter = metrics.get_meter("dify-sdk", dify_config.project.version)
                self.hist_llm_duration = self.meter.create_histogram(
                    name=LLM_OPERATION_DURATION,
                    unit="s",
                    description="LLM operation duration (seconds)",
                )
                self.metric_reader = metric_reader
            else:
                self.meter = None
                self.hist_llm_duration = None
                self.metric_reader = None
        except Exception:
            logger.exception("[Tencent APM] Metrics initialization failed; metrics disabled")
            self.meter = None
            self.hist_llm_duration = None
            self.metric_reader = None

    def add_span(self, span_data: SpanData) -> None:
        """Create and export span using OpenTelemetry Tracer API"""
        try:
            self._create_and_export_span(span_data)
            logger.debug("[Tencent APM] Created span: %s", span_data.name)

        except Exception:
            logger.exception("[Tencent APM] Failed to create span: %s", span_data.name)

    # Metrics recording API
    def record_llm_duration(self, latency_seconds: float, attributes: dict[str, str] | None = None) -> None:
        """Record LLM operation duration histogram in seconds."""
        try:
            if not hasattr(self, "hist_llm_duration") or self.hist_llm_duration is None:
                return
            attrs: dict[str, str] = {}
            if attributes:
                for k, v in attributes.items():
                    attrs[k] = str(v) if not isinstance(v, (str, int, float, bool)) else v  # type: ignore[assignment]
            self.hist_llm_duration.record(latency_seconds, attrs)  # type: ignore[attr-defined]
        except Exception:
            logger.debug("[Tencent APM] Failed to record LLM duration", exc_info=True)

    def _create_and_export_span(self, span_data: SpanData) -> None:
        """Create span using OpenTelemetry Tracer API"""
        try:
            parent_context = None
            if span_data.parent_span_id and span_data.parent_span_id in self.span_contexts:
                parent_context = trace_api.set_span_in_context(
                    trace_api.NonRecordingSpan(self.span_contexts[span_data.parent_span_id])
                )

            span = self.tracer.start_span(
                name=span_data.name,
                context=parent_context,
                kind=SpanKind.INTERNAL,
                start_time=span_data.start_time,
            )
            self.span_contexts[span_data.span_id] = span.get_span_context()

            if span_data.attributes:
                from opentelemetry.util.types import AttributeValue

                attributes: dict[str, AttributeValue] = {}
                for key, value in span_data.attributes.items():
                    if isinstance(value, (int, float, bool)):
                        attributes[key] = value
                    else:
                        attributes[key] = str(value)
                span.set_attributes(attributes)

            if span_data.events:
                for event in span_data.events:
                    span.add_event(event.name, event.attributes, event.timestamp)

            if span_data.status:
                span.set_status(span_data.status)

            # Manually end span; do not use context manager to avoid double-end warnings
            span.end(end_time=span_data.end_time)

        except Exception:
            logger.exception("[Tencent APM] Error creating span: %s", span_data.name)

    def api_check(self) -> bool:
        """Check API connectivity using socket connection test for gRPC endpoints"""
        try:
            if self.endpoint.startswith("http://127.0.0.1:4317") or self.endpoint.startswith("http://localhost:4317"):
                host, port = "127.0.0.1", 4317
            elif self.endpoint.startswith("https://"):
                parsed = urlparse(self.endpoint)
                host = parsed.hostname or "localhost"
                port = parsed.port or 443
            elif self.endpoint.startswith("http://"):
                parsed = urlparse(self.endpoint)
                host = parsed.hostname or "localhost"
                port = parsed.port or 80
            else:
                logger.warning("[Tencent APM] Invalid endpoint format: %s", self.endpoint)
                return False

            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            result = sock.connect_ex((host, port))
            sock.close()

            if result == 0:
                logger.info("[Tencent APM] Endpoint %s:%s is accessible", host, port)
                return True
            else:
                logger.warning("[Tencent APM] Endpoint %s:%s is not accessible", host, port)
                if host in ["127.0.0.1", "localhost"]:
                    logger.info("[Tencent APM] Development environment detected, allowing config save")
                    return True
                return False

        except Exception:
            logger.exception("[Tencent APM] API check failed")
            if "127.0.0.1" in self.endpoint or "localhost" in self.endpoint:
                return True
            return False

    def get_project_url(self) -> str:
        """Get project console URL"""
        return "https://console.cloud.tencent.com/apm"

    def shutdown(self) -> None:
        """Shutdown the client and export remaining spans"""
        try:
            if self.span_processor:
                logger.info("[Tencent APM] Flushing remaining spans before shutdown")
                _ = self.span_processor.force_flush()
                self.span_processor.shutdown()

            if self.tracer_provider:
                self.tracer_provider.shutdown()
            if self.metric_reader is not None:
                try:
                    self.metric_reader.shutdown()  # type: ignore[attr-defined]
                except Exception:
                    pass

        except Exception:
            logger.exception("[Tencent APM] Error during client shutdown")
