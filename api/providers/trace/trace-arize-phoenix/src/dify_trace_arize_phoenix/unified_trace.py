"""Phoenix adapter for the provider-neutral unified tracing runtime."""

import json
from datetime import datetime
from typing import cast
from urllib.parse import urlparse

from openinference.semconv.trace import OpenInferenceMimeTypeValues, OpenInferenceSpanKindValues, SpanAttributes
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk import trace as trace_sdk
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.trace import Span, Status, StatusCode, get_current_span, set_span_in_context
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.util.types import AttributeValue

from core.ops.exceptions import InvalidTraceParentContextError
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
from dify_trace_arize_phoenix.config import PhoenixConfig
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


def setup_unified_tracer(config: PhoenixConfig) -> tuple[trace_sdk.Tracer, SimpleSpanProcessor]:
    """Create an isolated Phoenix tracer without touching the legacy provider."""
    parsed = urlparse(config.endpoint)
    endpoint = f"{parsed.scheme}://{parsed.netloc}{parsed.path.rstrip('/')}/v1/traces"
    exporter = OTLPSpanExporter(
        endpoint=endpoint,
        headers={
            "api_key": config.api_key or "",
            "authorization": f"Bearer {config.api_key or ''}",
        },
        timeout=30,
    )
    provider = trace_sdk.TracerProvider(
        resource=Resource(
            attributes={
                "openinference.project.name": config.project or "",
                "model_id": config.project or "",
            }
        )
    )
    processor = SimpleSpanProcessor(exporter)
    provider.add_span_processor(processor)
    return cast(trace_sdk.Tracer, provider.get_tracer(f"unified_phoenix_{config.project}")), processor


class UnifiedPhoenixAdapter:
    """Translate canonical spans to isolated OpenTelemetry/OpenInference spans."""

    provider_name = "phoenix"

    def __init__(self, config: PhoenixConfig) -> None:
        self._config = config
        self._tracer, self._processor = setup_unified_tracer(config)
        self._propagator = TraceContextTextMapPropagator()
        self._scope = destination_scope(self.provider_name, config.endpoint, config.project or "")

    @property
    def scope(self) -> str:
        return self._scope

    def _root_context(self, parent: ParentResolution | None) -> Context | None:
        if parent is None or parent.kind is ParentResolutionKind.LINKED_ROOT:
            return None
        if parent.context is None:
            return None
        traceparent = parent.context.provider_context.get("traceparent")
        if not traceparent:
            raise InvalidTraceParentContextError("Phoenix parent context is missing traceparent")
        context = self._propagator.extract(carrier={"traceparent": traceparent})
        span_context = get_current_span(context).get_span_context()
        if not span_context.is_valid or not span_context.is_remote:
            raise InvalidTraceParentContextError("Phoenix parent context contains an invalid traceparent")
        return context

    def _attributes(
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
                attributes=self._attributes(canonical_span, trace, parent),
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
            if provider_parent_context is not None:
                publish_parent_context(canonical_span.id, provider_parent_context)


class UnifiedPhoenixTrace(UnifiedTraceInstance):
    """Fully isolated unified Phoenix trace instance selected by the new registry."""

    def __init__(self, config: PhoenixConfig) -> None:
        super().__init__(
            config,
            builder=CanonicalTraceBuilder(RepositoryWorkflowExecutionLoader(self.get_service_account_with_tenant)),
            adapter=UnifiedPhoenixAdapter(config),
            coordinator=ParentContextCoordinator(redis_client, resolve_parent_destination),
        )
