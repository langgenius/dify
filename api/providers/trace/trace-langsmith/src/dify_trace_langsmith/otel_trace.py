"""LangSmith's OTel run projection, using owned synchronous HTTP resources."""

import gzip
import zlib
from copy import deepcopy
from datetime import datetime
from typing import Any, override
from uuid import UUID

from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import ExportTraceServiceRequest
from opentelemetry.proto.common.v1.common_pb2 import InstrumentationScope
from opentelemetry.proto.trace.v1.trace_pb2 import ResourceSpans, ScopeSpans, Span, Status
from opentelemetry.sdk.trace.sampling import TraceIdRatioBased
from pydantic import JsonValue

from core.helper.ssl_context import create_ssl_context
from core.ops.otlp_trace import OtlpTraceClient, limit_span_attributes, limit_span_events, otlp_attributes
from core.ops.provider_export import json_text, span_id_bytes, timestamp_ns


def _infer_model_system(model: str) -> str:
    model = model.lower()
    if "anthropic" in model or model.startswith("claude"):
        return "anthropic"
    for system, names in (
        ("aws.bedrock", ("bedrock",)),
        ("az.ai.openai", ("azure", "openai")),
        ("az.ai.inference", ("azure", "inference")),
        ("cohere", ("cohere",)),
        ("deepseek", ("deepseek",)),
        ("gemini", ("gemini",)),
        ("groq", ("groq",)),
        ("ibm.watsonx.ai", ("watson", "ibm")),
        ("mistral_ai", ("mistral",)),
        ("openai", ("gpt", "openai")),
        ("perplexity", ("perplexity", "sonar")),
        ("vertex_ai", ("vertex",)),
        ("xai", ("xai", "grok")),
        ("qwen", ("qwen",)),
    ):
        if all(name in model for name in names) if system.startswith("az.") else any(name in model for name in names):
            return system
    return "langchain"


def _build_run_attributes(run: dict[str, Any]) -> dict[str, Any]:
    metadata = run["extra"]["metadata"]
    model = str(metadata.get("ls_model_name") or "")
    attributes = {
        "langsmith.span.kind": run["run_type"],
        "langsmith.trace.name": run["name"],
        "langsmith.trace.session_name": run["session_name"],
        "gen_ai.operation.name": {"llm": "chat", "tool": "execute_tool", "retriever": "embeddings"}.get(
            run["run_type"], run["run_type"]
        ),
        "gen_ai.system": _infer_model_system(model),
        "gen_ai.request.model": model or None,
    }
    if isinstance(parameters := run["extra"]["invocation_params"], dict):
        for name in ("max_tokens", "temperature", "top_p", "frequency_penalty", "presence_penalty"):
            attributes[f"gen_ai.request.{name}"] = parameters.get(name)
    attributes.update(
        {
            f"langsmith.metadata.{key}": json_text(value) if isinstance(value, (dict, list)) else value
            for key, value in metadata.items()
        }
    )
    if run["tags"]:
        attributes["langsmith.span.tags"] = ", ".join(run["tags"])
    inputs, outputs = run["inputs"], run["outputs"]
    if inputs.get("model") is not None and isinstance(inputs.get("messages"), list):
        attributes.pop("gen_ai.request.model", None)
        attributes["gen_ai.request.model"] = inputs["model"]
    attributes["langsmith.request.streaming"] = inputs.get("stream")
    attributes["gen_ai.prompt"] = json_text(inputs)
    usage = outputs.get("usage_metadata", {})
    if isinstance(usage, dict) and all(isinstance(usage.get(name), int) for name in ("input_tokens", "output_tokens")):
        attributes.update({f"gen_ai.usage.{name}": usage[name] for name in ("input_tokens", "output_tokens")})
        attributes["gen_ai.usage.total_tokens"] = usage["input_tokens"] + usage["output_tokens"]
        attributes["gen_ai.response.model"] = outputs.get("model")
    attributes["gen_ai.response.id"] = outputs.get("id")
    if isinstance(choices := outputs.get("choices"), list):
        reasons = [
            str(choice["finish_reason"])
            for choice in choices
            if isinstance(choice, dict) and choice.get("finish_reason") is not None
        ]
        if reasons:
            attributes["gen_ai.response.finish_reasons"] = ", ".join(reasons)
    for field in ("service_tier", "system_fingerprint"):
        attributes[f"gen_ai.response.{field}"] = outputs.get(field)
    attributes["gen_ai.completion"] = json_text(outputs)
    return attributes


class LangSmithOtlpTraceClient(OtlpTraceClient):
    def __init__(self, settings: dict[str, Any]):
        super().__init__(
            settings["endpoint"],
            settings["headers"],
            {"service.name": settings["service_name"], "langsmith.internal_provider": True},
            "",
            request_timeout=float(settings["request_timeout"]),
            ssl_context=create_ssl_context(settings["tls"], verify=settings["verify"]),
        )
        self.settings = deepcopy(settings)

    def is_sampled(self, trace_id: str, parent_span: dict[str, JsonValue] | None) -> bool:
        if self.settings["disabled"]:
            return False
        sampler = self.settings["sampler"]
        if parent_span is not None and sampler.startswith("parentbased_"):
            return parent_span.get("otel_sampled", True) is not False
        if sampler.endswith("traceidratio"):
            return (
                TraceIdRatioBased(self.settings["sampling_ratio"])
                .should_sample(None, UUID(trace_id).int, "")
                .decision.is_sampled()
            )
        return not sampler.endswith("always_off")

    def build_request(self, runs: list[dict[str, Any]]) -> ExportTraceServiceRequest:
        spans = []
        for run in runs:
            end_time = timestamp_ns(datetime.fromisoformat(run["end_time"]))
            error = run["error"]
            span = Span(
                trace_id=UUID(run["trace_id"]).bytes,
                span_id=span_id_bytes(run["id"]),
                parent_span_id=span_id_bytes(run["parent_run_id"]) if run["parent_run_id"] else b"",
                name=run["name"],
                kind=Span.SPAN_KIND_INTERNAL,
                start_time_unix_nano=timestamp_ns(datetime.fromisoformat(run["start_time"])),
                end_time_unix_nano=end_time,
                flags=1,
                attributes=otlp_attributes(_build_run_attributes(run)),
                status=Status(code=Status.STATUS_CODE_ERROR if error else Status.STATUS_CODE_OK),
            )
            if error:
                span.events.append(
                    Span.Event(
                        name="exception",
                        time_unix_nano=end_time,
                        attributes=otlp_attributes(
                            {
                                "exception.type": "Exception",
                                "exception.message": error,
                                "exception.stacktrace": f"Exception: {error}\n",
                                "exception.escaped": "False",
                            }
                        ),
                    )
                )
            limit_span_attributes(span, **self.settings["span_limits"])
            spans.append(limit_span_events(span, **self.settings["event_limits"]))
        return ExportTraceServiceRequest(
            resource_spans=[
                ResourceSpans(
                    resource=self.resource,
                    scope_spans=[ScopeSpans(scope=InstrumentationScope(name="langsmith"), spans=spans)],
                )
            ]
        )

    @override
    def _send(self, signal: str, serialized: bytes) -> bytes:
        compression = self.settings["compression"]
        if compression == "none":
            return super()._send(signal, serialized)
        return self.http.request(
            "POST",
            content=gzip.compress(serialized) if compression == "gzip" else zlib.compress(serialized),
            headers={
                "Content-Type": "application/x-protobuf",
                "Content-Encoding": compression,
            },
        ).content
