"""Export completed observations to Langfuse v4 with attempt-owned SDK resources."""

from typing import Any, override
from uuid import UUID

from langfuse import __version__ as langfuse_version
from langfuse import propagate_attributes

# The pinned SDK's public client caches resources by public key and cannot backdate
# observations. Use its serializers and processor without initializing that client.
from langfuse._client.attributes import create_generation_attributes, create_span_attributes
from langfuse._client.span_processor import LangfuseSpanProcessor
from opentelemetry import context, trace
from opentelemetry.exporter.otlp.proto.common.trace_encoder import encode_spans
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanLimits, TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.sdk.trace.id_generator import IdGenerator
from opentelemetry.sdk.trace.sampling import ALWAYS_ON
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient
from core.ops.provider_export import (
    TraceExportError,
    TraceProviderHttpClient,
    basic_auth,
    export_span_id,
    provider_uuid,
    span_attributes,
    span_id_bytes,
    timestamp_ns,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans
from dify_trace_langfuse.config import LangfuseConfig


class LangfuseSpanIds(IdGenerator):
    def __init__(self, trace_id: str, span_ids: dict[str, str]):
        self.trace_id = int(trace_id, 16)
        self.span_ids = iter(span_ids.values())

    @override
    def generate_trace_id(self) -> int:
        return self.trace_id

    @override
    def generate_span_id(self) -> int:
        return int(next(self.span_ids), 16)


class LangfuseTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = LangfuseConfig.model_validate(provider_config)
        self.http = TraceProviderHttpClient(
            self.config.host,
            {"Authorization": basic_auth(self.config.public_key, self.config.secret_key)},
        )

    def verify_credentials(self) -> bool:
        self.http.request("GET", "api/public/projects")
        return True

    def get_project_url(self) -> str:
        projects = self.http.request("GET", "api/public/projects").json().get("data", [])
        return f"{self.config.host.rstrip('/')}/project/{projects[0]['id']}" if projects else self.config.host

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        root = completed_trace.spans[0]
        trace_id = UUID(provider_uuid(completed_trace.trace_id)).hex
        trace_name, trace_version = root.span_name, root.source_workflow_version
        parent = None
        if parent_span is not None:
            trace_id, parent_id = str(parent_span["trace_id"]), str(parent_span["span_id"])
            # Legacy UUID observation IDs cannot be represented by 64-bit OTEL parents.
            if len(trace_id) != 32 or len(parent_id) != 16:
                raise TraceExportError("langfuse_legacy_parent_receipt")
            parent = trace.NonRecordingSpan(
                trace.SpanContext(int(trace_id, 16), int(parent_id, 16), True, trace.TraceFlags(1))
            )
            if not parent.get_span_context().is_valid:
                raise TraceExportError("langfuse_invalid_parent_receipt")
            trace_name = str(parent_span.get("trace_name", trace_name))
            if parent_span.get("version") is not None:
                trace_version = str(parent_span["version"])
        span_ids = {
            span.span_id: span_id_bytes(export_span_id(completed_trace, span.span_id)).hex()
            for span in completed_trace.spans
        }
        collector = InMemorySpanExporter()
        provider = TracerProvider(
            resource=Resource({"service.name": "dify"}),
            sampler=ALWAYS_ON,
            id_generator=LangfuseSpanIds(trace_id, span_ids),
            # CompletedTrace already bounds content; do not silently drop its metadata.
            span_limits=SpanLimits(
                max_span_attributes=SpanLimits.UNSET,
                max_span_attribute_length=SpanLimits.UNSET,
            ),
            shutdown_on_exit=False,
        )
        token = context.attach(context.Context())
        try:
            processor = LangfuseSpanProcessor(
                public_key=self.config.public_key,
                secret_key=self.config.secret_key,
                base_url=self.config.host,
                span_exporter=collector,
                flush_at=1,
                flush_interval=1,
            )
            provider.add_span_processor(processor)
            tracer = provider.get_tracer(
                "langfuse-sdk", langfuse_version, attributes={"public_key": self.config.public_key}
            )
            observations: dict[str, trace.Span] = {}
            with propagate_attributes(
                user_id=completed_trace.source.actor_id,
                session_id=completed_trace.source.session_id or completed_trace.source.conversation_id,
                trace_name=trace_name,
                version=trace_version,
                metadata={"dify.tenant_id": completed_trace.source.tenant_id},
            ):
                for span in completed_trace.spans:
                    attributes = create_span_attributes(
                        input=span.inputs,
                        output=span.outputs,
                        metadata={**root.attributes, **span_attributes(completed_trace, span)},
                        level="ERROR" if span.status == "error" else "DEFAULT",
                        status_message=span.error,
                    )
                    # SDK propagation caps strings at 200 characters; keep Dify's
                    # longer correlation values on every observation as well.
                    attributes.update(
                        {
                            key: value
                            for key, value in {
                                "user.id": completed_trace.source.actor_id,
                                "session.id": completed_trace.source.session_id
                                or completed_trace.source.conversation_id,
                                "langfuse.trace.name": trace_name,
                                "langfuse.version": trace_version,
                            }.items()
                            if value is not None
                        }
                    )
                    if span.span_type == "llm":
                        cost = span.usage.get("total_price", span.usage.get("total_cost"))
                        model = span.attributes.get("model_name") or span.attributes.get("ls_model_name")
                        attributes.update(
                            create_generation_attributes(
                                model=model if isinstance(model, str) else None,
                                usage_details={
                                    key: tokens
                                    for key, value in (
                                        ("input", "prompt_tokens"),
                                        ("output", "completion_tokens"),
                                        ("total", "total_tokens"),
                                    )
                                    if isinstance(tokens := span.usage.get(value), int)
                                },
                                cost_details={"total": float(str(cost))} if cost is not None else None,
                            )
                        )
                    # OTLP integer attributes are signed 64-bit; preserve larger JSON numbers as strings.
                    for key, value in attributes.items():
                        if isinstance(value, int) and not -(2**63) <= value < 2**63:
                            attributes[key] = str(value)
                    observation_parent = observations[span.parent_span_id] if span.parent_span_id else parent
                    observation = tracer.start_span(
                        span.span_name,
                        context=trace.set_span_in_context(observation_parent)
                        if observation_parent is not None
                        else context.get_current(),
                        attributes=attributes,
                        start_time=timestamp_ns(span.started_at),
                    )
                    if parent is not None and span.span_id == completed_trace.root_span_id:
                        observation.set_attribute("langfuse.internal.is_app_root", False)
                    if span.status == "error":
                        observation.set_status(trace.StatusCode.ERROR, span.error)
                    observations[span.span_id] = observation
                # Keep parents alive until their children have inherited the SDK root scope.
                for span in completed_trace.spans:
                    observations[span.span_id].end(end_time=timestamp_ns(span.ended_at))
                    # Drain locally so even trees larger than the SDK queue cannot lose spans.
                    if not provider.force_flush():
                        raise TraceExportError("langfuse_flush_failed", retryable=True)
            finished = collector.get_finished_spans()
            if len(finished) != len(completed_trace.spans):
                raise TraceExportError("langfuse_incomplete_export")
            request = encode_spans(finished)
        finally:
            context.detach(token)
            provider.shutdown()
        # SDK flushing only fills our local collector. The existing transport checks
        # actual HTTP/OTLP acceptance, and OPS owns retries after ambiguous failures.
        transport = OtlpTraceClient(
            f"{self.http.endpoint}/api/public/otel/v1/traces",
            {
                **self.http.headers,
                "x-langfuse-ingestion-version": "4",
                "x-langfuse-sdk-name": "python",
                "x-langfuse-sdk-version": langfuse_version,
            },
            {},
            self.config.host,
        )
        transport.http.deadline = self.http.deadline
        transport.send_traces(request)
        return ExportedParentSpans(
            spans={
                span_id: {
                    "trace_id": trace_id,
                    "span_id": exported_id,
                    "trace_name": trace_name,
                    "version": trace_version,
                }
                for span_id, exported_id in span_ids.items()
            }
        )
