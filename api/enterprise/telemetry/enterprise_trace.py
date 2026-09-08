"""Enterprise traces, counters and detail logs built once from captured spans."""

import logging
from typing import Any
from uuid import UUID

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import InstrumentationScope
from opentelemetry.proto.metrics.v1.metrics_pb2 import Metric
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, counter, histogram, otlp_attributes, otlp_span
from core.ops.provider_export import export_span_id, provider_uuid, span_attributes, span_id_bytes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan


class EnterpriseTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        endpoint = str(provider_config["endpoint"]).rstrip("/")
        protocol = str(provider_config.get("protocol", "grpc"))
        headers = dict(provider_config.get("headers") or {})
        if provider_config.get("api_key"):
            headers["authorization"] = f"Bearer {provider_config['api_key']}"
        self.otlp = OtlpTraceClient(
            endpoint if protocol == "grpc" else endpoint + "/v1/traces",
            headers,
            {"service.name": provider_config.get("service_name", "dify")},
            "",
            protocol=protocol,
        )
        self.include_content = bool(provider_config.get("include_content", False))
        self.sampling_rate = float(provider_config.get("sampling_rate", 1))
        self.logger = logging.getLogger("dify.telemetry")

    def _operation_type(self, span: TraceSpan) -> str:
        if span.node_execution_id:
            return "node_execution"
        return str(
            span.attributes.get("operation_type")
            or (span.span_name if span.span_type == "operation" else span.span_type)
        )

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        trace_id = str(parent_span["trace_id"]) if parent_span else provider_uuid(completed_trace.trace_id)
        sampled = UUID(trace_id).int / 2**128 < self.sampling_rate
        exported_spans = []
        metrics: list[Metric] = []
        for span in completed_trace.spans:
            operation_type = self._operation_type(span)
            attributes = span_attributes(completed_trace, span)
            attributes.update(
                {
                    "dify.trace_id": trace_id,
                    "dify.message.id": completed_trace.source.message_id,
                    "dify.conversation.id": completed_trace.source.conversation_id,
                    "gen_ai.user.id": completed_trace.source.actor_id,
                    "gen_ai.provider.name": span.attributes.get("model_provider", ""),
                    "gen_ai.request.model": span.attributes.get("model_name", ""),
                    "gen_ai.usage.input_tokens": span.usage.get("prompt_tokens"),
                    "gen_ai.usage.output_tokens": span.usage.get("completion_tokens"),
                    "gen_ai.usage.total_tokens": span.usage.get("total_tokens"),
                }
            )
            if not self.include_content:
                visible_fields = {
                    "dify.tenant_id",
                    "dify.app_id",
                    "dify.pipeline_id",
                    "dify.workflow.id",
                    "dify.workflow.version",
                    "dify.workflow.run_id",
                    "dify.node.execution_id",
                    "dify.node.id",
                    "dify.node.attempt",
                    "dify.span.id",
                    "dify.span.status",
                    "dify.trace.complete",
                    "dify.trace.truncation",
                    "dify.trace.links",
                    "dify.trace_id",
                    "dify.external_trace_id",
                    "dify.message.id",
                    "dify.conversation.id",
                    "dify.app.name",
                    "dify.workspace.name",
                    "dify.invoke_from",
                    "dify.invoked_by",
                    "dify.cost.currency",
                    "dify.usage",
                    "session.id",
                    "user.id",
                    "gen_ai.user.id",
                    "gen_ai.session.id",
                    "gen_ai.provider.name",
                    "gen_ai.system",
                    "gen_ai.framework",
                    "gen_ai.span.kind",
                    "gen_ai.operation.name",
                    "gen_ai.request.model",
                    "gen_ai.response.model",
                    "gen_ai.usage.input_tokens",
                    "gen_ai.usage.output_tokens",
                    "gen_ai.usage.total_tokens",
                    "llm.model_name",
                    "llm.token_count.prompt",
                    "llm.token_count.completion",
                    "llm.token_count.total",
                    "llm.cost.total",
                    "error.message",
                    "openinference.span.kind",
                }
                attributes = {key: value for key, value in attributes.items() if key in visible_fields}
                reference = f"ref:operation_id={completed_trace.source.operation_id}"
                attributes["input.value"] = reference
                attributes["output.value"] = reference
            sends_span = completed_trace.spans[0].span_type == "workflow" or operation_type in {
                "workflow",
                "node_execution",
                "draft_node_execution",
            }
            if sends_span and sampled:
                exported_span = otlp_span(completed_trace, span, parent_span)
                exported_span.name = "dify.workflow.run" if operation_type == "workflow" else "dify.node.execution"
                del exported_span.attributes[:]
                exported_span.attributes.extend(otlp_attributes(attributes))
                exported_spans.append(exported_span)
            event_name = {
                "workflow": "dify.workflow.run",
                "message": "dify.message.run",
                "tool": "dify.tool.execution",
                "moderation": "dify.moderation.check",
                "suggested_question": "dify.suggested_question.generation",
                "dataset_retrieval": "dify.dataset.retrieval",
                "retrieval": "dify.dataset.retrieval",
                "generate_name": "dify.generate_name.execution",
                "node_execution": "dify.node.execution",
            }.get(operation_type, "dify.prompt_generation.execution")
            signal = "span_detail" if sends_span else "metric_only"
            self.logger.info(
                "telemetry.%s",
                signal,
                extra={
                    "attributes": {**attributes, "dify.event.name": event_name, "dify.event.signal": signal},
                    "trace_id": UUID(trace_id).hex,
                    "span_id": span_id_bytes(export_span_id(completed_trace, span.span_id)).hex(),
                    "tenant_id": completed_trace.source.tenant_id,
                    "user_id": completed_trace.source.actor_id,
                },
            )
            if not span.attributes.get("metrics_from_parent"):
                metrics.extend(self._metrics(completed_trace, span, operation_type))
        if exported_spans:
            self.otlp.send_traces(
                ExportTraceServiceRequest(
                    resource_spans=[
                        ResourceSpans(
                            resource=self.otlp.resource,
                            scope_spans=[
                                ScopeSpans(
                                    scope=InstrumentationScope(name="dify.enterprise"),
                                    spans=exported_spans,
                                )
                            ],
                        )
                    ]
                )
            )
        self.otlp.send_metrics(metrics)
        return ExportedParentSpans(
            spans={
                span.span_id: {"trace_id": trace_id, "span_id": export_span_id(completed_trace, span.span_id)}
                for span in completed_trace.spans
            }
        )

    def _metrics(self, completed_trace: CompletedTrace, span: TraceSpan, operation_type: str) -> list[Metric]:
        labels = {
            "tenant_id": completed_trace.source.tenant_id,
            "app_id": span.source_app_id or completed_trace.source.app_id or "",
        }
        status = "failed" if span.status == "error" else "succeeded"
        token_labels = {
            **labels,
            "operation_type": operation_type,
            "model_provider": span.attributes.get("model_provider", ""),
            "model_name": span.attributes.get("model_name", ""),
            "node_type": span.attributes.get("node_type", "") if span.node_execution_id else "",
        }
        metrics: list[Metric] = []
        recorded_usage = span.usage or span.attributes.get("aggregate_usage")
        usage = recorded_usage if isinstance(recorded_usage, dict) else {}
        for field, name in (("prompt_tokens", "input"), ("completion_tokens", "output"), ("total_tokens", "total")):
            if isinstance(value := usage.get(field), int):
                metrics.append(counter(f"dify.tokens.{name}", value, span, token_labels))
        request_type = (
            operation_type
            if operation_type
            in {
                "workflow",
                "node_execution",
                "message",
                "tool",
                "moderation",
                "suggested_question",
                "dataset_retrieval",
                "generate_name",
            }
            else "prompt_generation"
        )
        metrics.append(
            counter(
                "dify.requests.total",
                1,
                span,
                {
                    **labels,
                    "type": request_type,
                    "status": status,
                    "invoke_from": span.attributes.get("triggered_from", span.attributes.get("from_source", "")),
                },
            )
        )
        if span.status == "error":
            metrics.append(counter("dify.errors.total", 1, span, {**labels, "type": request_type}))
        duration_name = {
            "workflow": "workflow",
            "node_execution": "node",
            "message": "message",
            "tool": "tool",
            "prompt_generation": "prompt_generation",
        }.get(request_type)
        if duration_name and span.started_at and span.ended_at:
            metrics.append(
                histogram(
                    f"dify.{duration_name}.duration",
                    (span.ended_at - span.started_at).total_seconds(),
                    span,
                    {**labels, "status": status},
                )
            )
        if isinstance(
            ttft := span.attributes.get(
                "gen_ai_server_time_to_first_token", span.attributes.get("gen_ai.server.time_to_first_token")
            ),
            (int, float),
        ):
            metrics.append(histogram("dify.message.time_to_first_token", float(ttft), span, labels))
        if operation_type in {"retrieval", "dataset_retrieval"}:
            documents = span.outputs.get("documents", []) if isinstance(span.outputs, dict) else span.outputs
            if isinstance(documents, list):
                dataset_ids = {
                    str(document["metadata"]["dataset_id"])
                    for document in documents
                    if isinstance(document, dict)
                    and isinstance(document.get("metadata"), dict)
                    and document["metadata"].get("dataset_id")
                }
                for dataset_id in dataset_ids:
                    metrics.append(
                        counter(
                            "dify.dataset.retrievals.total",
                            1,
                            span,
                            {
                                **labels,
                                "dataset_id": dataset_id,
                                "embedding_model_provider": span.attributes.get("embedding_model_provider", ""),
                                "embedding_model": span.attributes.get("embedding_model", ""),
                                "rerank_model_provider": span.attributes.get("rerank_model_provider", ""),
                                "rerank_model": span.attributes.get("rerank_model_name", ""),
                            },
                        )
                    )
        return metrics
