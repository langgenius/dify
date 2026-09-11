"""Send Tencent spans and cumulative metrics through their explicitly captured transports."""

import socket
from typing import Any, override

from opentelemetry.proto.metrics.v1.metrics_pb2 import Metric
from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status
from opentelemetry.sdk.version import __version__ as otel_sdk_version
from pydantic import JsonValue

from configs import dify_config
from core.helper.ssl_context import create_grpc_credentials, create_ssl_context
from core.ops.otlp_trace import OtlpTraceClient, histogram, otlp_span
from core.ops.provider_export import TraceProviderHttpClient, json_text, span_attributes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
from dify_trace_tencent.config import TencentConfig

# Preserve the explicit buckets used by the previous Tencent SDK histograms.
HISTOGRAM_BOUNDS = (0, 5, 10, 25, 50, 75, 100, 250, 500, 750, 1000, 2500, 5000, 7500, 10000)


def usage_seconds(span: TraceSpan, field: str, *legacy_attributes: str) -> float | None:
    value = span.usage.get(field)
    if value is None:
        value = next((span.attributes[key] for key in legacy_attributes if span.attributes.get(key) is not None), None)
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) and value >= 0 else None


class TencentTraceClient(OtlpTraceClient):
    """Project Tencent's span attributes and existing metric series from captured calls."""

    @override
    def build_span(
        self, completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
    ) -> Span:
        model_labels = self._model_labels(span)
        attributes = {
            **span_attributes(completed_trace, span),
            **model_labels,
            "gen_ai.provider.name": model_labels["gen_ai.system"],
            "gen_ai.session.id": completed_trace.source.session_id or completed_trace.source.conversation_id,
            "gen_ai.user.id": completed_trace.source.actor_id,
            "gen_ai.framework": "dify",
            "gen_ai.span.kind": {
                "llm": "GENERATION",
                "workflow": "WORKFLOW",
                "operation": "WORKFLOW",
                "tool": "TOOL",
                "retrieval": "RETRIEVER",
                "agent": "AGENT",
            }.get(span.span_type, "TASK"),
            "gen_ai.is_entry": "true" if span.span_id == completed_trace.root_span_id else "false",
            "gen_ai.entity.input": json_text(span.inputs),
            "gen_ai.entity.output": json_text(span.outputs),
            "gen_ai.usage.input_tokens": span.usage.get("prompt_tokens"),
            "gen_ai.usage.output_tokens": span.usage.get("completion_tokens"),
            "gen_ai.usage.total_tokens": span.usage.get("total_tokens"),
        }
        if span.span_type == "llm":
            attributes.update(
                {
                    "gen_ai.prompt": json_text(span.inputs),
                    "gen_ai.completion": json_text(span.outputs),
                    "gen_ai.response.finish_reason": span.outputs.get("finish_reason")
                    if isinstance(span.outputs, dict)
                    else None,
                    "llm.is_streaming": self._is_streaming(span),
                }
            )
        elif span.span_type == "tool":
            attributes.update(
                {
                    "tool.name": span.attributes.get("tool_name") or span.span_name,
                    "tool.description": span.attributes.get("tool_description"),
                    "tool.parameters": json_text(span.attributes.get("tool_parameters", span.inputs)),
                }
            )
        elif span.span_type == "retrieval":
            attributes.update(
                {"retrieval.query": json_text(span.inputs), "retrieval.document": json_text(span.outputs)}
            )
        for field, key, legacy in (
            ("time_to_first_token", "gen_ai.server.time_to_first_token", "gen_ai_server_time_to_first_token"),
            ("time_to_generate", "gen_ai.streaming.time_to_generate", "llm_streaming_time_to_generate"),
        ):
            if (seconds := usage_seconds(span, field, legacy, key)) is not None:
                attributes[key] = seconds
        exported_span = otlp_span(completed_trace, span, parent_span, attributes=attributes)
        # Existing provider status filters include stopped workflows with a reason.
        if span.span_type == "workflow" and span.status == "cancelled" and span.error:
            exported_span.status.code = Status.STATUS_CODE_ERROR
        return exported_span

    @override
    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        receipt = super().export_trace(completed_trace, parent_span)
        self.send_metrics(self.build_metrics(completed_trace))
        return receipt

    @staticmethod
    def _model_labels(span: TraceSpan) -> dict[str, Any]:
        process_data = span.attributes.get("process_data")
        model = {**(process_data if isinstance(process_data, dict) else {}), **span.attributes}
        return {
            "gen_ai.operation.name": model.get("model_mode") or "chat",
            "gen_ai.system": model.get("model_provider") or model.get("ls_provider") or "",
            "gen_ai.request.model": model.get("model_name") or model.get("ls_model_name") or "",
            "gen_ai.response.model": model.get("model_name") or model.get("ls_model_name") or "",
        }

    @staticmethod
    def _is_streaming(span: TraceSpan) -> bool:
        return (
            bool(span.attributes.get("is_streaming_request"))
            or usage_seconds(
                span, "time_to_first_token", "gen_ai_server_time_to_first_token", "gen_ai.server.time_to_first_token"
            )
            is not None
        )

    def build_metrics(self, completed_trace: CompletedTrace) -> list[Metric]:
        metrics: list[Metric] = []
        for span in completed_trace.spans:
            is_message = span.attributes.get("operation_type") == "message" and span.span_type == "operation"
            if span.span_id == completed_trace.root_span_id and span.started_at and span.ended_at:
                seconds = (span.ended_at - span.started_at).total_seconds()
                trace_labels = (
                    {
                        "conversation_mode": "workflow",
                        "workflow_status": {
                            "ok": "succeeded",
                            "error": "failed",
                            "handled_error": "partial-succeeded",
                            "cancelled": "stopped",
                            "incomplete": "unknown",
                        }[span.status],
                        "has_conversation": "true" if completed_trace.source.conversation_id else "false",
                    }
                    if span.span_type == "workflow"
                    else {
                        "conversation_mode": span.attributes.get("conversation_mode") or "chat",
                        "stream": "true" if self._is_streaming(span) else "false",
                    }
                )
                if seconds > 0:
                    metrics.append(
                        histogram(
                            "gen_ai.trace.duration", seconds, span, trace_labels, explicit_bounds=HISTOGRAM_BOUNDS
                        )
                    )
            is_model = span.span_type == "llm" or (
                span.span_type == "node"
                and span.attributes.get("node_type") in ("llm", "question-classifier", "parameter-extractor")
            )
            # Message roots and logical retry nodes carry the call aggregate. Detail
            # spans must not count the same logical call again in the existing series.
            if span.attributes.get("metrics_from_parent") or (not is_model and not is_message):
                continue
            aggregate_usage = span.attributes.get("aggregate_usage")
            if not span.usage and isinstance(aggregate_usage, dict):
                span = span.model_copy(update={"usage": aggregate_usage})
            labels = self._model_labels(span)
            if (latency := usage_seconds(span, "latency", "provider_response_latency")) is not None and latency > 0:
                metrics.append(
                    histogram(
                        "gen_ai.client.operation.duration",
                        latency,
                        span,
                        {
                            "gen_ai.operation.name": labels["gen_ai.operation.name"],
                            "gen_ai.system": labels["gen_ai.system"],
                            "gen_ai.response.model": labels["gen_ai.response.model"],
                            "stream": "true" if self._is_streaming(span) else "false",
                        },
                        explicit_bounds=HISTOGRAM_BOUNDS,
                    )
                )
            for field, token_type in (("prompt_tokens", "input"), ("completion_tokens", "output")):
                tokens = span.usage.get(field)
                if isinstance(tokens, (int, float)) and not isinstance(tokens, bool) and tokens > 0:
                    metrics.append(
                        histogram(
                            "gen_ai.client.token.usage",
                            float(tokens),
                            span,
                            {
                                **labels,
                                "gen_ai.token.type": token_type,
                                "server.address": labels["gen_ai.system"],
                            },
                            "token",
                            explicit_bounds=HISTOGRAM_BOUNDS,
                        )
                    )
            for field, key, legacy in (
                ("time_to_first_token", "gen_ai.server.time_to_first_token", "gen_ai_server_time_to_first_token"),
                ("time_to_generate", "gen_ai.streaming.time_to_generate", "llm_streaming_time_to_generate"),
            ):
                streaming_seconds = usage_seconds(span, field, legacy, key)
                if streaming_seconds is not None and streaming_seconds > 0:
                    metrics.append(
                        histogram(
                            key, streaming_seconds, span, {**labels, "stream": "true"}, explicit_bounds=HISTOGRAM_BOUNDS
                        )
                    )
        return metrics


def create_trace_client(provider_config: dict[str, Any]) -> TencentTraceClient:
    config = TencentConfig.model_validate(provider_config)
    runtime_settings = (
        provider_config["_runtime_settings"]
        if "_runtime_settings" in provider_config
        else TencentConfig.load_runtime_settings(provider_config)
    )
    http_metrics = runtime_settings["metrics_protocol"] == "http/protobuf"
    headers = {"authorization": f"Bearer {config.token}"}
    return TencentTraceClient(
        config.endpoint,
        headers,
        {
            "service.name": config.service_name,
            "service.version": f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
            "deployment.environment": f"{dify_config.DEPLOY_ENV}-{dify_config.DEPLOYMENT_EDITION.value}",
            "host.name": socket.gethostname(),
            "telemetry.sdk.language": "python",
            "telemetry.sdk.name": "opentelemetry",
            "telemetry.sdk.version": otel_sdk_version,
        },
        "https://console.cloud.tencent.com/apm",
        protocol="grpc",
        metrics_http=TraceProviderHttpClient(
            config.endpoint,
            headers,
            ssl_context=create_ssl_context(runtime_settings["metrics_tls"], verify=runtime_settings["metrics_verify"]),
        )
        if http_metrics
        else None,
        metrics_protocol=runtime_settings["metrics_protocol"],
        grpc_credentials={
            "trace": create_grpc_credentials(runtime_settings["trace_tls"]),
            **({"metrics": create_grpc_credentials(runtime_settings["metrics_tls"])} if not http_metrics else {}),
        },
    )
