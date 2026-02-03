"""Enterprise OTEL exporter — shared by EnterpriseOtelTrace, event handlers, and direct instrumentation.

Uses its own TracerProvider (configurable sampling, separate from ext_otel.py infrastructure)
and the global MeterProvider (shared with ext_otel.py — both target the same collector).

Initialized once during Flask extension init (single-threaded via ext_enterprise_telemetry.py).
Accessed via ``ext_enterprise_telemetry.get_enterprise_exporter()`` from any thread/process.
"""

import logging
import socket
import uuid
from datetime import datetime
from typing import Any, cast

from opentelemetry import metrics, trace
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.grpc._log_exporter import OTLPLogExporter as GRPCLogExporter
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter as GRPCSpanExporter
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter as HTTPLogExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter as HTTPSpanExporter
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.trace.sampling import ParentBasedTraceIdRatio
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import SpanContext, TraceFlags
from opentelemetry.util.types import Attributes, AttributeValue

from configs import dify_config
from enterprise.telemetry.entities import EnterpriseTelemetryCounter, EnterpriseTelemetryHistogram
from enterprise.telemetry.id_generator import (
    CorrelationIdGenerator,
    compute_deterministic_span_id,
    set_correlation_id,
    set_span_id_source,
)

logger = logging.getLogger(__name__)


def is_enterprise_telemetry_enabled() -> bool:
    return bool(dify_config.ENTERPRISE_ENABLED and dify_config.ENTERPRISE_TELEMETRY_ENABLED)


def _parse_otlp_headers(raw: str) -> dict[str, str]:
    """Parse ``key=value,key2=value2`` into a dict."""
    if not raw:
        return {}
    headers: dict[str, str] = {}
    for pair in raw.split(","):
        if "=" not in pair:
            continue
        k, v = pair.split("=", 1)
        headers[k.strip()] = v.strip()
    return headers


def _datetime_to_ns(dt: datetime) -> int:
    """Convert a datetime to nanoseconds since epoch (OTEL convention)."""
    return int(dt.timestamp() * 1_000_000_000)


class _ExporterFactory:
    def __init__(self, protocol: str, endpoint: str, headers: dict[str, str]):
        self._protocol = protocol
        self._endpoint = endpoint
        self._headers = headers
        self._grpc_headers = tuple(headers.items()) if headers else None
        self._http_headers = headers or None

    def create_trace_exporter(self) -> HTTPSpanExporter | GRPCSpanExporter:
        if self._protocol == "grpc":
            return GRPCSpanExporter(
                endpoint=self._endpoint or None,
                headers=self._grpc_headers,
                insecure=True,
            )
        trace_endpoint = f"{self._endpoint}/v1/traces" if self._endpoint else ""
        return HTTPSpanExporter(endpoint=trace_endpoint or None, headers=self._http_headers)

    def create_log_exporter(self, logs_endpoint_override: str) -> tuple[HTTPLogExporter | GRPCLogExporter | None, str]:
        if self._protocol == "grpc":
            logs_endpoint = logs_endpoint_override or self._endpoint
            if not logs_endpoint:
                return None, "Enterprise OTEL logs enabled but endpoint is empty"
            return GRPCLogExporter(endpoint=logs_endpoint, headers=self._grpc_headers, insecure=True), ""

        logs_endpoint = logs_endpoint_override or self._append_logs_path()
        if not logs_endpoint:
            return None, "Enterprise OTEL logs enabled but endpoint is empty"
        return HTTPLogExporter(endpoint=logs_endpoint, headers=self._http_headers), ""

    def _append_logs_path(self) -> str:
        if not self._endpoint:
            return ""
        if self._endpoint.endswith("/"):
            return f"{self._endpoint}v1/logs"
        return f"{self._endpoint}/v1/logs"


class EnterpriseLoggingHandler(LoggingHandler):
    @staticmethod
    def _coerce_attribute_value(value: object) -> AttributeValue:
        if isinstance(value, (str, bool, int, float)):
            return value
        return str(value)

    @staticmethod
    def _parse_hex_id(value: object, expected_len: int) -> int | None:
        if isinstance(value, int):
            return value if value != 0 else None
        if not isinstance(value, str):
            return None
        raw = value.strip().lower()
        raw = raw.removeprefix("0x")
        if expected_len and len(raw) != expected_len:
            return None
        try:
            parsed = int(raw, 16)
        except ValueError:
            return None
        return parsed if parsed != 0 else None

    @staticmethod
    def _get_attributes(record: logging.LogRecord) -> Attributes:
        raw_attributes = LoggingHandler._get_attributes(record) or {}
        attributes: dict[str, AttributeValue] = dict(raw_attributes)
        extra_attrs = attributes.pop("attributes", None)
        if isinstance(extra_attrs, dict):
            extra_attrs_dict = cast(dict[str, object], extra_attrs)
            for key, value in extra_attrs_dict.items():
                if key not in attributes:
                    attributes[key] = EnterpriseLoggingHandler._coerce_attribute_value(value)
        return attributes

    def _translate(self, record: logging.LogRecord):
        log_record = super()._translate(record)
        trace_id = self._parse_hex_id(getattr(record, "trace_id", None), 32)
        span_id = self._parse_hex_id(getattr(record, "span_id", None), 16)
        if trace_id is not None:
            log_record.trace_id = trace_id
        if span_id is not None:
            log_record.span_id = span_id
        return log_record


class EnterpriseExporter:
    """Shared OTEL exporter for all enterprise telemetry.

    ``export_span`` creates spans with optional real timestamps, deterministic
    span/trace IDs, and cross-workflow parent linking.
    ``increment_counter`` / ``record_histogram`` emit OTEL metrics at 100% accuracy.
    """

    def __init__(self, config: object) -> None:
        endpoint: str = getattr(config, "ENTERPRISE_OTLP_ENDPOINT", "")
        headers_raw: str = getattr(config, "ENTERPRISE_OTLP_HEADERS", "")
        protocol: str = (getattr(config, "ENTERPRISE_OTLP_PROTOCOL", "http") or "http").lower()
        service_name: str = getattr(config, "ENTERPRISE_SERVICE_NAME", "dify")
        sampling_rate: float = getattr(config, "ENTERPRISE_OTEL_SAMPLING_RATE", 1.0)
        self.include_content: bool = getattr(config, "ENTERPRISE_INCLUDE_CONTENT", True)
        self._logs_enabled: bool = bool(getattr(config, "ENTERPRISE_OTEL_LOGS_ENABLED", False))
        self._logs_endpoint: str = getattr(config, "ENTERPRISE_OTLP_LOGS_ENDPOINT", "")
        self._log_provider: LoggerProvider | None = None
        self._log_handler: logging.Handler | None = None

        resource = Resource(
            attributes={
                ResourceAttributes.SERVICE_NAME: service_name,
                ResourceAttributes.HOST_NAME: socket.gethostname(),
            }
        )
        sampler = ParentBasedTraceIdRatio(sampling_rate)
        id_generator = CorrelationIdGenerator()
        self._tracer_provider = TracerProvider(resource=resource, sampler=sampler, id_generator=id_generator)

        headers = _parse_otlp_headers(headers_raw)
        factory = _ExporterFactory(protocol, endpoint, headers)

        trace_exporter = factory.create_trace_exporter()
        self._tracer_provider.add_span_processor(BatchSpanProcessor(trace_exporter))
        self._tracer = self._tracer_provider.get_tracer("dify.enterprise")

        self._init_logs_pipeline(factory, resource)

        meter = metrics.get_meter("dify.enterprise")
        self._counters = {
            EnterpriseTelemetryCounter.TOKENS: meter.create_counter("dify.tokens.total", unit="{token}"),
            EnterpriseTelemetryCounter.REQUESTS: meter.create_counter("dify.requests.total", unit="{request}"),
            EnterpriseTelemetryCounter.ERRORS: meter.create_counter("dify.errors.total", unit="{error}"),
            EnterpriseTelemetryCounter.FEEDBACK: meter.create_counter("dify.feedback.total", unit="{feedback}"),
            EnterpriseTelemetryCounter.DATASET_RETRIEVALS: meter.create_counter(
                "dify.dataset.retrievals.total", unit="{retrieval}"
            ),
        }
        self._histograms = {
            EnterpriseTelemetryHistogram.WORKFLOW_DURATION: meter.create_histogram("dify.workflow.duration", unit="s"),
            EnterpriseTelemetryHistogram.NODE_DURATION: meter.create_histogram("dify.node.duration", unit="s"),
            EnterpriseTelemetryHistogram.MESSAGE_DURATION: meter.create_histogram("dify.message.duration", unit="s"),
            EnterpriseTelemetryHistogram.MESSAGE_TTFT: meter.create_histogram(
                "dify.message.time_to_first_token", unit="s"
            ),
            EnterpriseTelemetryHistogram.TOOL_DURATION: meter.create_histogram("dify.tool.duration", unit="s"),
        }

    def _init_logs_pipeline(self, factory: _ExporterFactory, resource: Resource) -> None:
        if not self._logs_enabled:
            return

        log_exporter, warning = factory.create_log_exporter(self._logs_endpoint)
        if not log_exporter:
            logger.warning(warning)
            return

        self._log_provider = LoggerProvider(resource=resource, shutdown_on_exit=False)
        self._log_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))
        self._log_handler = EnterpriseLoggingHandler(logger_provider=self._log_provider)

    def export_span(
        self,
        name: str,
        attributes: dict[str, Any],
        correlation_id: str | None = None,
        span_id_source: str | None = None,
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        trace_correlation_override: str | None = None,
        parent_span_id_source: str | None = None,
    ) -> None:
        """Export an OTEL span with optional deterministic IDs and real timestamps.

        Args:
            name: Span operation name.
            attributes: Span attributes dict.
            correlation_id: Source for trace_id derivation (groups spans in one trace).
            span_id_source: Source for deterministic span_id (e.g. workflow_run_id or node_execution_id).
            start_time: Real span start time. When None, uses current time.
            end_time: Real span end time. When None, span ends immediately.
            trace_correlation_override: Override trace_id source (for cross-workflow linking).
                When set, trace_id is derived from this instead of ``correlation_id``.
            parent_span_id_source: Override parent span_id source (for cross-workflow linking).
                When set, parent span_id is derived from this value. When None and
                ``correlation_id`` is set, parent is the workflow root span.
        """
        effective_trace_correlation = trace_correlation_override or correlation_id
        set_correlation_id(effective_trace_correlation)
        set_span_id_source(span_id_source)

        try:
            parent_context: Context | None = None
            # A span is the "root" of its correlation group when span_id_source == correlation_id
            # (i.e. a workflow root span).  All other spans are children.
            if parent_span_id_source:
                # Cross-workflow linking: parent is an explicit span (e.g. tool node in outer workflow)
                parent_span_id = compute_deterministic_span_id(parent_span_id_source)
                parent_trace_id = (
                    cast(int, uuid.UUID(effective_trace_correlation).int) if effective_trace_correlation else 0
                )
                if parent_trace_id:
                    parent_span_context = SpanContext(
                        trace_id=parent_trace_id,
                        span_id=parent_span_id,
                        is_remote=True,
                        trace_flags=TraceFlags(TraceFlags.SAMPLED),
                    )
                    parent_context = trace.set_span_in_context(trace.NonRecordingSpan(parent_span_context))
            elif correlation_id and correlation_id != span_id_source:
                # Child span: parent is the correlation-group root (workflow root span)
                parent_span_id = compute_deterministic_span_id(correlation_id)
                parent_trace_id = cast(int, uuid.UUID(effective_trace_correlation or correlation_id).int)
                parent_span_context = SpanContext(
                    trace_id=parent_trace_id,
                    span_id=parent_span_id,
                    is_remote=True,
                    trace_flags=TraceFlags(TraceFlags.SAMPLED),
                )
                parent_context = trace.set_span_in_context(trace.NonRecordingSpan(parent_span_context))

            span_start_time = _datetime_to_ns(start_time) if start_time is not None else None
            span_end_on_exit = end_time is None

            with self._tracer.start_as_current_span(
                name,
                context=parent_context,
                start_time=span_start_time,
                end_on_exit=span_end_on_exit,
            ) as span:
                for key, value in attributes.items():
                    if value is not None:
                        span.set_attribute(key, value)
                if end_time is not None:
                    span.end(end_time=_datetime_to_ns(end_time))
        except Exception:
            logger.exception("Failed to export span %s", name)
        finally:
            set_correlation_id(None)
            set_span_id_source(None)

    def increment_counter(
        self, name: EnterpriseTelemetryCounter, value: int, labels: dict[str, AttributeValue]
    ) -> None:
        counter = self._counters.get(name)
        if counter:
            counter.add(value, cast(Attributes, labels))

    def record_histogram(
        self, name: EnterpriseTelemetryHistogram, value: float, labels: dict[str, AttributeValue]
    ) -> None:
        histogram = self._histograms.get(name)
        if histogram:
            histogram.record(value, cast(Attributes, labels))

    def shutdown(self) -> None:
        self._tracer_provider.shutdown()
        if self._log_provider:
            self._log_provider.shutdown()

    def attach_log_handler(self) -> None:
        if not self._log_handler:
            return
        root_logger = logging.getLogger()
        if self._log_handler in root_logger.handlers:
            return
        try:
            from core.logging.filters import IdentityContextFilter, TraceContextFilter

            self._log_handler.addFilter(TraceContextFilter())
            self._log_handler.addFilter(IdentityContextFilter())
        except Exception:
            logger.exception("Failed to attach log filters to enterprise handler")
        root_logger.addHandler(self._log_handler)
