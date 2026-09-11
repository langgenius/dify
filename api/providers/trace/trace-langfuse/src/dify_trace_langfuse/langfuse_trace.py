"""Export completed observations to Langfuse v4 with attempt-owned SDK resources."""

import math
from datetime import timedelta
from typing import Any, override
from uuid import UUID

from langfuse import __version__ as langfuse_version
from langfuse import propagate_attributes

# The pinned SDK's public client caches resources by public key and cannot backdate
# observations. Use its serializers and processor without initializing that client.
from langfuse._client.attributes import create_generation_attributes, create_span_attributes
from langfuse._client.span_processor import LangfuseSpanProcessor
from langfuse.api import MapValue
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
    json_text,
    provider_uuid,
    span_attributes,
    span_id_bytes,
    timestamp_ns,
)
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
from dify_trace_langfuse.config import LangfuseConfig


def _prepare_timed_spans(completed_trace: CompletedTrace) -> list[TraceSpan]:
    """Keep untimed details as marked instants at a captured endpoint, never export time."""
    spans: dict[str, TraceSpan] = {}
    for span in completed_trace.spans:
        if span.started_at is None or span.ended_at is None:
            parent = spans.get(span.parent_span_id or "")
            anchor = span.started_at or span.ended_at or (parent.started_at if parent else None)
            if anchor is None:
                raise TraceExportError("langfuse_span_time_missing")
            span = span.model_copy(
                update={
                    "started_at": anchor,
                    "ended_at": anchor,
                    "attributes": {
                        **span.attributes,
                        "dify.timing.estimated": True,
                        "dify.timing.source": "captured_endpoint",
                    },
                }
            )
        assert span.started_at is not None
        assert span.ended_at is not None
        if span.ended_at < span.started_at:
            raise TraceExportError("langfuse_span_time_invalid")
        spans[span.span_id] = span
    return list(spans.values())


def _normalize_messages(value: JsonValue) -> JsonValue:
    if isinstance(value, list):
        return [_normalize_messages(item) for item in value]
    if not isinstance(value, dict):
        return value
    message = dict(value)
    if "role" in message:
        if message["role"] == "human":
            message["role"] = "user"
        elif message["role"] == "ai":
            message["role"] = "assistant"
        if "text" in message and "content" not in message:
            message["content"] = message.pop("text")
    if "messages" in message:
        message["messages"] = _normalize_messages(message["messages"])
    return message


def _map_model_parameters(value: JsonValue) -> dict[str, MapValue] | None:
    if not isinstance(value, dict):
        return None
    parameters: dict[str, MapValue] = {}
    for key, parameter in value.items():
        if parameter is None or isinstance(parameter, (str, int, float, bool)):
            parameters[key] = parameter
        elif isinstance(parameter, list) and all(isinstance(item, str) for item in parameter):
            parameters[key] = [item for item in parameter if isinstance(item, str)]
        else:
            parameters[key] = json_text(parameter)
    return parameters


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
        try:
            projects = self.http.request("GET", "api/public/projects").json().get("data", [])
            if projects:
                return f"{self.config.host.rstrip('/')}/project/{projects[0]['id']}"
        except Exception:
            # Project discovery must not prevent reading saved settings.
            return f"{self.config.host.rstrip('/')}/"
        return f"{self.config.host.rstrip('/')}/"

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        spans = _prepare_timed_spans(completed_trace)
        root = spans[0]
        trace_id = UUID(provider_uuid(completed_trace.trace_id)).hex
        if parent_span is None and (external_id := completed_trace.source.external_trace_id):
            try:
                external_uuid = UUID(external_id)
                if external_uuid.int:
                    trace_id = external_uuid.hex
            except ValueError:
                pass
        trace_name, trace_version = root.span_name, root.source_workflow_version
        operation_type = root.attributes.get("operation_type", root.span_type)
        trace_tags = [operation_type if isinstance(operation_type, str) else root.span_type]
        if root.span_type == "workflow" and completed_trace.source.message_id:
            trace_tags.insert(0, "message")
        elif operation_type == "message":
            if isinstance(mode := root.attributes.get("conversation_mode", root.attributes.get("app_mode")), str):
                trace_tags.append(mode)
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
            if isinstance(parent_tags := parent_span.get("tags"), list):
                trace_tags = [tag for tag in parent_tags if isinstance(tag, str)]
        span_ids = {span.span_id: span_id_bytes(export_span_id(completed_trace, span.span_id)).hex() for span in spans}
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
                tags=trace_tags,
                metadata={"dify.tenant_id": completed_trace.source.tenant_id},
            ):
                for span in spans:
                    observation_failed = (
                        span.status == "error"
                        or (span.status == "handled_error" and span.span_type != "workflow")
                        or (span.status == "cancelled" and bool(span.error))
                    )
                    attributes = create_span_attributes(
                        input=_normalize_messages(span.inputs) if span.span_type == "llm" else span.inputs,
                        output=span.outputs,
                        metadata={**root.attributes, **span_attributes(completed_trace, span)},
                        level="ERROR" if observation_failed else "DEFAULT",
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
                                "langfuse.trace.tags": trace_tags,
                            }.items()
                            if value is not None
                        }
                    )
                    if span.span_type == "llm":
                        cost = span.usage.get("total_price", span.usage.get("total_cost"))
                        model = span.attributes.get("model_name")
                        completion_start_time = None
                        ttft = span.usage.get("time_to_first_token")
                        if (
                            isinstance(ttft, (int, float))
                            and math.isfinite(ttft)
                            and ttft >= 0
                            and span.started_at is not None
                            and not span.attributes.get("dify.timing.estimated")
                        ):
                            completion_start_time = span.started_at + timedelta(seconds=ttft)
                        attributes.update(
                            create_generation_attributes(
                                model=model if isinstance(model, str) else None,
                                model_parameters=_map_model_parameters(span.attributes.get("model_parameters")),
                                completion_start_time=completion_start_time,
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
                    if observation_failed:
                        observation.set_status(trace.StatusCode.ERROR, span.error)
                    observations[span.span_id] = observation
                # Keep parents alive until their children have inherited the SDK root scope.
                for span in spans:
                    observations[span.span_id].end(end_time=timestamp_ns(span.ended_at))
                    # Drain locally so even trees larger than the SDK queue cannot lose spans.
                    if not provider.force_flush():
                        raise TraceExportError("langfuse_flush_failed", retryable=True)
            finished = collector.get_finished_spans()
            if len(finished) != len(spans):
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
        receipt_tags: list[JsonValue] = list(trace_tags)
        return ExportedParentSpans(
            spans={
                span_id: {
                    "trace_id": trace_id,
                    "span_id": exported_id,
                    "trace_name": trace_name,
                    "version": trace_version,
                    "tags": receipt_tags,
                }
                for span_id, exported_id in span_ids.items()
            }
        )
