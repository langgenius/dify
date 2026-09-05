"""Reusable OTLP adapter base for unified-trace providers.

Absorbs the generic parts of an OTLP/OTLP-HTTP provider: canonical-span mapping,
W3C traceparent handling, synchronous per-span export, and export-before-publish
ordering. Subclasses customize exporter construction, resource attributes,
headers, and (optionally) the span-attribute mapping.
"""

import json
from datetime import datetime
from typing import cast

from openinference.semconv.trace import OpenInferenceMimeTypeValues, OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry.context import _SUPPRESS_INSTRUMENTATION_KEY, Context, attach, detach, set_value
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import SpanExportResult
from opentelemetry.trace import Span, Status, StatusCode, get_current_span, set_span_in_context
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.util.types import AttributeValue

from core.ops.exceptions import InvalidTraceParentContextError, RetryableTraceDispatchError
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

_KIND_MAP: dict[CanonicalSpanKind, OpenInferenceSpanKindValues] = {
    CanonicalSpanKind.CHAIN: OpenInferenceSpanKindValues.CHAIN,
    CanonicalSpanKind.LLM: OpenInferenceSpanKindValues.LLM,
    CanonicalSpanKind.RETRIEVER: OpenInferenceSpanKindValues.RETRIEVER,
    CanonicalSpanKind.TOOL: OpenInferenceSpanKindValues.TOOL,
    CanonicalSpanKind.AGENT: OpenInferenceSpanKindValues.AGENT,
}


def _nanos(value: datetime | None) -> int | None:
    return int(value.timestamp() * 1_000_000_000) if value is not None else None


def _json(value: object) -> str:
    return json.dumps(value, default=str, ensure_ascii=False)


class OTLPUnifiedAdapter:
    """Translate canonical spans to isolated OpenTelemetry spans and export them over OTLP."""

    provider_name: str = "otlp"

    def __init__(self, config, *, endpoint: str | None = None, scope_key: str = "") -> None:
        self._config = config
        self._exporter = self.build_exporter(config)
        provider = trace_sdk.TracerProvider(resource=self.build_resource(config))
        self._tracer = cast(trace_sdk.Tracer, provider.get_tracer(f"unified_{self.provider_name}_{scope_key}"))
        self._propagator = TraceContextTextMapPropagator()
        self._scope = destination_scope(
            self.provider_name, endpoint if endpoint is not None else config.endpoint, scope_key
        )

    @property
    def scope(self) -> str:
        return self._scope

    def build_headers(self, config) -> dict[str, str]:
        return {}

    def build_resource(self, config) -> Resource:
        return Resource.create({})

    def build_exporter(self, config) -> OTLPSpanExporter:
        return OTLPSpanExporter(
            endpoint=config.endpoint,
            headers=self.build_headers(config),
            timeout=30,
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
            SpanAttributes.OPENINFERENCE_SPAN_KIND: _KIND_MAP[canonical_span.kind].value,
            SpanAttributes.INPUT_VALUE: _json(canonical_span.inputs),
            SpanAttributes.INPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
            SpanAttributes.OUTPUT_VALUE: _json(canonical_span.outputs),
            SpanAttributes.OUTPUT_MIME_TYPE: OpenInferenceMimeTypeValues.JSON.value,
            SpanAttributes.METADATA: _json(metadata),
            SpanAttributes.SESSION_ID: trace.session_id,
            "dify.span.id": canonical_span.id,
            "dify.span.synthetic": canonical_span.synthetic,
        }

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
            token = attach(set_value(_SUPPRESS_INSTRUMENTATION_KEY, True))
            try:
                try:
                    export_result = self._exporter.export((cast(trace_sdk.ReadableSpan, span),))
                except Exception as error:
                    raise RetryableTraceDispatchError(f"{self.provider_name} span export failed") from error
            finally:
                detach(token)
            if export_result is not SpanExportResult.SUCCESS:
                raise RetryableTraceDispatchError(
                    f"{self.provider_name} span export failed: canonical_span_id={canonical_span.id}"
                )
            if provider_parent_context is not None:
                publish_parent_context(canonical_span.id, provider_parent_context)


class OTLPUnifiedTrace(UnifiedTraceInstance):
    """Wire an OTLPUnifiedAdapter subclass into the unified runtime."""

    adapter_class: type[OTLPUnifiedAdapter]

    def __init__(self, config) -> None:
        super().__init__(
            config,
            builder=CanonicalTraceBuilder(RepositoryWorkflowExecutionLoader(self.get_service_account_with_tenant)),
            adapter=self.adapter_class(config),
            coordinator=ParentContextCoordinator(redis_client, resolve_parent_destination),
        )

    def api_check(self) -> bool:
        """Connectivity check expected by OpsTraceManager.check_trace_config_is_effective."""
        try:
            adapter = cast(OTLPUnifiedAdapter, self._adapter)
            span = adapter._tracer.start_span("api_check")
            span.set_attribute("test", "true")
            span.end()
            result = adapter._exporter.export((cast(trace_sdk.ReadableSpan, span),))
            if result is not SpanExportResult.SUCCESS:
                raise ValueError("OTLP collector rejected the api_check span")
            return True
        except ValueError:
            raise
        except Exception as e:
            raise ValueError(f"[OTel] API check failed: {str(e)}") from e
