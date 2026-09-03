"""Reusable OTLP adapter base for unified-trace providers.

Absorbs the generic parts of an OTLP/HTTP provider: canonical-span mapping,
W3C traceparent handling, synchronous per-span export, export-before-publish
ordering, and export failure classification. Subclasses customize exporter
construction, resource attributes, headers, and (optionally) the span-attribute
mapping.

Span attributes use the OpenInference dialect that Phoenix and other LLM
observability backends understand. The keys are literal strings so ``core``
does not depend on the ``openinference-semantic-conventions`` package, which
only the Phoenix provider plugin installs.
"""

import json
from collections.abc import Callable
from datetime import datetime
from typing import Any, NoReturn, cast, override

from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, Context, attach, detach, set_value
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import SpanExportResult
from opentelemetry.trace import Span, Status, StatusCode, get_current_span, set_span_in_context
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.util.types import AttributeValue

from core.ops.entities.config_entity import BaseTracingConfig
from core.ops.exceptions import InvalidTraceParentContextError, RetryableTraceDispatchError, TraceDispatchRejectedError
from core.ops.unified_trace.entities import CanonicalSpan, CanonicalSpanKind, CanonicalSpanStatus, CanonicalTrace
from core.ops.unified_trace.parent_context import (
    ParentContextCoordinator,
    ParentResolution,
    ParentResolutionKind,
    ProviderParentContext,
    destination_scope,
    resolve_parent_destination,
)
from core.ops.unified_trace.provider import ParentContextPublisher, UnifiedTraceInstance
from core.ops.unified_trace.trace_builder import CanonicalTraceBuilder, RepositoryWorkflowExecutionLoader
from extensions.ext_redis import redis_client

# OpenInference span attribute keys (https://github.com/Arize-ai/openinference/tree/main/spec).
OPENINFERENCE_SPAN_KIND = "openinference.span.kind"
INPUT_VALUE = "input.value"
INPUT_MIME_TYPE = "input.mime_type"
OUTPUT_VALUE = "output.value"
OUTPUT_MIME_TYPE = "output.mime_type"
METADATA = "metadata"
SESSION_ID = "session.id"
JSON_MIME_TYPE = "application/json"

EXPORT_TIMEOUT_SECONDS = 30

_KIND_MAP: dict[CanonicalSpanKind, str] = {
    CanonicalSpanKind.CHAIN: "CHAIN",
    CanonicalSpanKind.LLM: "LLM",
    CanonicalSpanKind.RETRIEVER: "RETRIEVER",
    CanonicalSpanKind.TOOL: "TOOL",
    CanonicalSpanKind.AGENT: "AGENT",
}


def _nanos(value: datetime | None) -> int | None:
    return int(value.timestamp() * 1_000_000_000) if value is not None else None


def _json(value: object) -> str:
    return json.dumps(value, default=str, ensure_ascii=False)


def is_terminal_http_status(status_code: object) -> bool:
    """Return True for HTTP statuses that a retry cannot fix.

    Client errors mean a wrong endpoint, wrong credentials, or a rejected payload.
    Request timeout (408) and rate limiting (429) are transient and stay retryable.
    """
    return isinstance(status_code, int) and 400 <= status_code < 500 and status_code not in (408, 429)


class StatusRecordingOTLPSpanExporter(OTLPSpanExporter):
    """OTLP/HTTP span exporter that remembers the HTTP status of the last request.

    ``OTLPSpanExporter.export`` runs its own retry loop for transient failures and
    then collapses every outcome into ``SpanExportResult.FAILURE``. Keeping the last
    status lets the adapter tell a terminal rejection (wrong endpoint or credentials)
    from a transport failure that is worth a Celery retry.
    """

    last_status_code: int | None = None

    @override
    def _export(self, serialized_data: bytes, timeout_sec: float | None = None):
        self.last_status_code = None
        response = super()._export(serialized_data, timeout_sec)
        status_code = getattr(response, "status_code", None)
        self.last_status_code = status_code if isinstance(status_code, int) else None
        return response


class OTLPUnifiedAdapter[ConfigT: BaseTracingConfig]:
    """Translate canonical spans to isolated OpenTelemetry spans and export them over OTLP/HTTP."""

    provider_name: str = "otlp"

    def __init__(self, config: ConfigT, *, endpoint: str, scope_key: str = "") -> None:
        self._config = config
        self._endpoint = endpoint
        self._exporter = self.build_exporter(config)
        provider = trace_sdk.TracerProvider(resource=self.build_resource(config))
        self._tracer = cast(trace_sdk.Tracer, provider.get_tracer(f"unified_{self.provider_name}_{scope_key}"))
        self._propagator = TraceContextTextMapPropagator()
        self._scope = destination_scope(self.provider_name, endpoint, scope_key)

    @property
    def scope(self) -> str:
        return self._scope

    @property
    def last_export_status_code(self) -> int | None:
        """HTTP status of the most recent export attempt, when the exporter records it."""
        status_code = getattr(self._exporter, "last_status_code", None)
        return status_code if isinstance(status_code, int) else None

    def build_headers(self, config: ConfigT) -> dict[str, str]:
        return {}

    def build_resource(self, config: ConfigT) -> Resource:
        return Resource.create({})

    def build_exporter(self, config: ConfigT) -> OTLPSpanExporter:
        return StatusRecordingOTLPSpanExporter(
            endpoint=self._endpoint,
            headers=self.build_headers(config),
            timeout=EXPORT_TIMEOUT_SECONDS,
        )

    def _root_context(self, parent: ParentResolution | None) -> Context | None:
        if parent is None or parent.kind is ParentResolutionKind.LINKED_ROOT:
            return None
        if parent.context is None:
            return None
        traceparent = parent.context.provider_context.get("traceparent")
        if not traceparent:
            raise InvalidTraceParentContextError(f"{self.provider_name} parent context is missing traceparent")
        context = self._propagator.extract(carrier={"traceparent": traceparent})
        span_context = get_current_span(context).get_span_context()
        if not span_context.is_valid or not span_context.is_remote:
            raise InvalidTraceParentContextError(f"{self.provider_name} parent context contains an invalid traceparent")
        return context

    def attributes(
        self,
        canonical_span: CanonicalSpan,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
    ) -> dict[str, AttributeValue]:
        metadata = dict(canonical_span.metadata)
        if (
            canonical_span.id == trace.root_span_id
            and parent is not None
            and parent.kind is ParentResolutionKind.LINKED_ROOT
            and parent.linked_parent is not None
        ):
            metadata["linked_parent_workflow_run_id"] = parent.linked_parent.parent_workflow_run_id
            metadata["linked_parent_node_execution_id"] = parent.linked_parent.parent_node_execution_id
        metadata["dify.span.kind"] = canonical_span.kind.value
        metadata.pop("dify.span.links", None)
        if canonical_span.links:
            metadata["dify.span.links"] = list(canonical_span.links)
        return {
            OPENINFERENCE_SPAN_KIND: _KIND_MAP[canonical_span.kind],
            INPUT_VALUE: _json(canonical_span.inputs),
            INPUT_MIME_TYPE: JSON_MIME_TYPE,
            OUTPUT_VALUE: _json(canonical_span.outputs),
            OUTPUT_MIME_TYPE: JSON_MIME_TYPE,
            METADATA: _json(metadata),
            SESSION_ID: trace.session_id,
            "dify.span.id": canonical_span.id,
            "dify.span.synthetic": canonical_span.synthetic,
        }

    def _export_span(self, span: Span) -> SpanExportResult:
        """Export one ended span synchronously with instrumentation suppressed."""
        token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
        try:
            return self._exporter.export((cast(trace_sdk.ReadableSpan, span),))
        finally:
            detach(token)

    def _raise_export_failure(self, canonical_span_id: str) -> NoReturn:
        status_code = self.last_export_status_code
        message = f"{self.provider_name} span export failed: canonical_span_id={canonical_span_id}"
        if is_terminal_http_status(status_code):
            raise TraceDispatchRejectedError(f"{message} (HTTP {status_code})")
        raise RetryableTraceDispatchError(message)

    def export_probe_span(self) -> SpanExportResult:
        """Export one probe span so callers can verify the endpoint and credentials."""
        span = self._tracer.start_span("api_check")
        span.set_attribute("test", "true")
        span.end()
        return self._export_span(span)

    def emit(
        self,
        trace: CanonicalTrace,
        parent: ParentResolution | None,
        publish_parent_context: ParentContextPublisher,
    ) -> None:
        span_by_id: dict[str, Span] = {}
        root_context = self._root_context(parent)

        for canonical_span in trace.spans:
            local_parent = span_by_id.get(canonical_span.parent_id or "")
            context = set_span_in_context(local_parent) if local_parent is not None else root_context
            span = self._tracer.start_span(
                name=canonical_span.name,
                context=context,
                attributes=self.attributes(canonical_span, trace, parent),
                start_time=_nanos(canonical_span.start_time),
            )
            span_by_id[canonical_span.id] = span
            provider_parent_context: ProviderParentContext | None = None
            try:
                if canonical_span.can_parent_workflow or canonical_span.publishes_parent_context:
                    carrier: dict[str, str] = {}
                    self._propagator.inject(carrier, context=set_span_in_context(span))
                    provider_parent_context = ProviderParentContext(
                        provider=self.provider_name,
                        scope=self.scope,
                        trace_id=trace.trace_id,
                        parent_id=canonical_span.id,
                        provider_context=carrier,
                    )
                if canonical_span.status is CanonicalSpanStatus.ERROR:
                    error = canonical_span.error or "trace operation failed"
                    span.set_status(Status(StatusCode.ERROR, error))
                    span.record_exception(RuntimeError(error))
                else:
                    span.set_status(Status(StatusCode.OK))
            finally:
                span.end(end_time=_nanos(canonical_span.end_time))
            try:
                export_result = self._export_span(span)
            except Exception as error:
                raise RetryableTraceDispatchError(f"{self.provider_name} span export failed") from error
            if export_result is not SpanExportResult.SUCCESS:
                self._raise_export_failure(canonical_span.id)
            if provider_parent_context is not None:
                publish_parent_context(canonical_span.id, provider_parent_context)


class OTLPUnifiedTrace(UnifiedTraceInstance):
    """Wire an OTLPUnifiedAdapter subclass into the unified runtime."""

    # Subclasses assign their adapter class; its constructor takes the provider config only.
    adapter_class: Callable[[Any], OTLPUnifiedAdapter[Any]]

    def __init__(self, config: BaseTracingConfig) -> None:
        super().__init__(
            config,
            builder=CanonicalTraceBuilder(RepositoryWorkflowExecutionLoader(self.get_service_account_with_tenant)),
            adapter=self.adapter_class(config),
            coordinator=ParentContextCoordinator(redis_client, resolve_parent_destination),
        )

    def api_check(self) -> bool:
        """Connectivity check used by ``OpsTraceManager.check_trace_config_is_effective``."""
        adapter = cast(OTLPUnifiedAdapter[Any], self._adapter)
        try:
            result = adapter.export_probe_span()
        except Exception as e:
            raise ValueError(f"[{adapter.provider_name}] API check failed: {e}") from e
        if result is not SpanExportResult.SUCCESS:
            status_code = adapter.last_export_status_code
            detail = f" (HTTP {status_code})" if status_code is not None else ""
            raise ValueError(f"OTLP collector rejected the api_check span{detail}")
        return True
