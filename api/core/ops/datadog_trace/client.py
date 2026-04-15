"""
Datadog trace client for OTLP HTTP span export.
"""

import hashlib
import logging
import socket
from collections import OrderedDict

import httpx
from opentelemetry import trace as trace_api
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.semconv.resource import ResourceAttributes
from opentelemetry.trace import SpanKind, Status, TraceFlags
from opentelemetry.util.types import AttributeValue

from configs import dify_config

logger = logging.getLogger(__name__)
MAX_SPAN_CONTEXTS = 1024


class DatadogTraceClient:
    """
    Datadog OTLP HTTP client with deterministic trace correlation support.
    """

    def __init__(self, api_key: str, site: str, service_name: str):
        self.api_key = api_key
        self.site = site
        self.endpoint = f"https://otlp.{site}/v1/traces"
        self.service_name = service_name
        self.tracer_provider: TracerProvider | None = None
        self.span_processor: BatchSpanProcessor | None = None
        self.tracer: trace_api.Tracer | None = None
        self.span_contexts: OrderedDict[str, trace_api.SpanContext] = OrderedDict()

    def _ensure_tracer(self) -> None:
        if self.tracer is not None:
            return

        resource = Resource(
            attributes={
                ResourceAttributes.SERVICE_NAME: self.service_name,
                ResourceAttributes.SERVICE_VERSION: f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
                ResourceAttributes.DEPLOYMENT_ENVIRONMENT: f"{dify_config.DEPLOY_ENV}-{dify_config.EDITION}",
                ResourceAttributes.HOST_NAME: socket.gethostname(),
                ResourceAttributes.TELEMETRY_SDK_LANGUAGE: "python",
                ResourceAttributes.TELEMETRY_SDK_NAME: "opentelemetry",
            }
        )
        exporter = OTLPSpanExporter(
            endpoint=self.endpoint,
            headers={"dd-api-key": self.api_key},
            timeout=30,
        )
        self.tracer_provider = TracerProvider(resource=resource)
        self.span_processor = BatchSpanProcessor(
            span_exporter=exporter,
            max_queue_size=1000,
            schedule_delay_millis=5000,
            max_export_batch_size=50,
        )
        self.tracer_provider.add_span_processor(self.span_processor)
        self.tracer = self.tracer_provider.get_tracer("dify-sdk", dify_config.project.version)

    def _remember_span_context(self, key: str, span_context: trace_api.SpanContext) -> None:
        self.span_contexts[key] = span_context
        self.span_contexts.move_to_end(key)
        if len(self.span_contexts) > MAX_SPAN_CONTEXTS:
            self.span_contexts.popitem(last=False)

    @staticmethod
    def compute_trace_id(key: str) -> int:
        """
        Compute a deterministic 128-bit trace ID from a logical entity key.
        """
        digest = hashlib.md5(key.encode(), usedforsecurity=False).digest()
        return int.from_bytes(digest, byteorder="big")

    def add_span(
        self,
        name: str,
        attributes: dict[str, AttributeValue],
        start_time_ns: int,
        end_time_ns: int,
        trace_id: int | None = None,
        store_key: str | None = None,
        parent_key: str | None = None,
        status: Status | None = None,
    ) -> None:
        """
        Create a span with explicit timing and optional trace correlation hints.
        """
        try:
            self._ensure_tracer()

            parent_context = None
            if parent_key and parent_key in self.span_contexts:
                self.span_contexts.move_to_end(parent_key)
                parent_context = trace_api.set_span_in_context(
                    trace_api.NonRecordingSpan(self.span_contexts[parent_key])
                )
            elif trace_id is not None:
                parent_context = trace_api.set_span_in_context(
                    trace_api.NonRecordingSpan(
                        trace_api.SpanContext(
                            trace_id=trace_id,
                            span_id=trace_id & 0xFFFFFFFFFFFFFFFF or 1,
                            is_remote=True,
                            trace_flags=TraceFlags(TraceFlags.SAMPLED),
                        )
                    )
                )

            if self.tracer is None:
                raise ValueError("Datadog tracer is not initialized")

            span = self.tracer.start_span(
                name=name,
                context=parent_context,
                kind=SpanKind.INTERNAL,
                attributes=attributes,
                start_time=start_time_ns,
            )

            if store_key:
                self._remember_span_context(store_key, span.get_span_context())

            if status:
                span.set_status(status)

            span.end(end_time=end_time_ns)
        except Exception:
            logger.exception("[Datadog] Failed to create span: %s", name)

    def api_check(self) -> bool:
        """
        Validate the Datadog API key against the site-specific auth endpoint.
        """
        try:
            response = httpx.get(
                f"https://api.{self.site}/api/v1/validate",
                headers={"DD-API-KEY": self.api_key},
                timeout=10,
            )
            return response.status_code in (200, 429)
        except Exception:
            logger.info("[Datadog] API check failed", exc_info=True)
            return False

    def get_project_url(self) -> str:
        return f"https://app.{self.site}/llm/traces"

    def shutdown(self) -> None:
        try:
            if self.span_processor is not None:
                self.span_processor.force_flush()
                self.span_processor.shutdown()
            if self.tracer_provider is not None:
                self.tracer_provider.shutdown()
        except Exception:
            logger.exception("[Datadog] Error during client shutdown")
        finally:
            self.tracer_provider = None
            self.span_processor = None
            self.tracer = None
            self.span_contexts.clear()
