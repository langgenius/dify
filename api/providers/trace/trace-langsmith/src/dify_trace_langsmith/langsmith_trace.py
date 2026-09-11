"""Create LangSmith runs synchronously, with explicit IDs and ancestor order."""

from random import Random
from typing import Any
from urllib.parse import quote, urlsplit
from uuid import UUID

from pydantic import JsonValue

from core.helper.ssl_context import create_ssl_context
from core.ops.provider_export import TraceExportError, TraceProviderHttpClient, export_span_id, span_attributes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
from dify_trace_langsmith.config import LangSmithConfig


def _prepare_timed_spans(completed_trace: CompletedTrace) -> list[TraceSpan]:
    """Keep untimed details as marked instants at a captured endpoint, never export time."""
    spans: dict[str, TraceSpan] = {}
    for span in completed_trace.spans:
        if span.started_at is None or span.ended_at is None:
            parent = spans.get(span.parent_span_id or "")
            anchor = span.started_at or span.ended_at or (parent.started_at if parent else None)
            if anchor is None:
                raise TraceExportError("langsmith_span_time_missing")
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
            raise TraceExportError("langsmith_span_time_invalid")
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


def _format_llm_inputs(value: JsonValue) -> dict[str, JsonValue]:
    value = _normalize_messages(value)
    if isinstance(value, dict) and "messages" in value:
        return value
    if isinstance(value, list):
        return {"messages": value}
    if isinstance(value, dict) and "role" in value:
        return {"messages": [value]}
    if isinstance(value, str):
        return {"messages": [{"role": "user", "content": value}]}
    return value if isinstance(value, dict) else {"input": value}


def _format_llm_outputs(value: JsonValue) -> dict[str, JsonValue]:
    value = _normalize_messages(value)
    if isinstance(value, dict) and "choices" in value:
        return dict(value)
    message: dict[str, JsonValue]
    if isinstance(value, dict) and "role" in value:
        message = dict(value)
    elif isinstance(value, dict) and isinstance(value.get("text"), str):
        message = {"role": "assistant", "content": value["text"]}
    elif isinstance(value, (str, list)):
        message = {"role": "assistant", "content": value}
    else:
        return dict(value) if isinstance(value, dict) else {"output": value}
    choice: dict[str, JsonValue] = {"index": 0, "message": message}
    if isinstance(value, dict):
        if "finish_reason" in value:
            choice["finish_reason"] = value["finish_reason"]
        if "tool_calls" in value:
            message["tool_calls"] = value["tool_calls"]
    return {"choices": [choice]}


def _map_usage_metadata(span: TraceSpan) -> dict[str, JsonValue]:
    usage = {
        target: span.usage[source]
        for source, target in (
            ("prompt_tokens", "input_tokens"),
            ("completion_tokens", "output_tokens"),
            ("total_tokens", "total_tokens"),
        )
        if isinstance(span.usage.get(source), int)
    }
    for source, target in (
        ("prompt_price", "input_cost"),
        ("completion_price", "output_cost"),
        ("total_price", "total_cost"),
    ):
        if (cost := span.usage.get(source, span.usage.get(target))) is not None:
            usage[target] = float(str(cost))
    return usage


def _map_run_type_and_tags(span: TraceSpan) -> tuple[str, list[str]]:
    operation_type = span.attributes.get("operation_type", span.span_type)
    if not isinstance(operation_type, str):
        operation_type = span.span_type
    is_node_execution = bool(
        span.node_execution_id
        or span.attributes.get("node_execution_id")
        or span.span_type == "node"
        or operation_type == "draft_node_execution"
    )
    if operation_type in {"suggested_question", "generate_name"}:
        run_type = "tool"
    elif span.node_execution_id and isinstance(node_type := span.attributes.get("node_type"), str):
        process_data = span.attributes.get("process_data")
        model_mode = span.attributes.get(
            "model_mode", process_data.get("model_mode") if isinstance(process_data, dict) else None
        )
        run_type = "llm" if model_mode == "chat" else "retriever" if node_type == "knowledge-retrieval" else "tool"
    elif span.span_type == "llm":
        run_type = "llm"
    elif span.span_type in {"retrieval", "knowledge-retrieval"} or operation_type == "dataset_retrieval":
        run_type = "retriever"
    elif operation_type == "message":
        run_type = "chain"
    elif (
        span.span_type in {"workflow", "tool"}
        or is_node_execution
        or operation_type in {"moderation", "suggested_question", "generate_name", "tool"}
    ):
        run_type = "tool"
    else:
        run_type = "chain"

    tags = ["dify", span.span_type]
    if operation_type:
        tags.append(operation_type)
    if is_node_execution:
        tags.append("node_execution")
    if operation_type == "message" or span.span_type == "llm":
        if isinstance(mode := span.attributes.get("conversation_mode", span.attributes.get("app_mode")), str) and mode:
            tags.append(mode)
    if span.span_type == "tool" or operation_type == "tool":
        if isinstance(tool_name := span.attributes.get("tool_name"), str) and tool_name:
            tags.append(tool_name)
    return run_type, list(dict.fromkeys(tags))


class LangSmithTraceClient:
    def __init__(self, provider_config: dict[str, Any]):
        self.config = LangSmithConfig.model_validate(provider_config)
        runtime_settings = (
            provider_config["_runtime_settings"]
            if "_runtime_settings" in provider_config
            else LangSmithConfig.load_runtime_settings(provider_config)
        )
        self.hide_inputs = bool(runtime_settings.get("hide_inputs", False))
        self.hide_outputs = bool(runtime_settings.get("hide_outputs", False))
        self.hide_metadata = bool(runtime_settings.get("hide_metadata", False))
        self.sampling_rate = float(runtime_settings.get("sampling_rate", 1.0))
        api_key = self.config.api_key.strip().strip('"').strip("'")
        headers = {"x-api-key": api_key} if api_key else {}
        if workspace_id := runtime_settings.get("workspace_id"):
            headers["X-Tenant-Id"] = workspace_id
        self.http = TraceProviderHttpClient(
            self.config.endpoint, headers, ssl_context=create_ssl_context(runtime_settings.get("tls", {}))
        )

    def verify_credentials(self) -> bool:
        self.http.request("GET", "sessions", params={"name": self.config.project, "limit": 1})
        return True

    def get_project_url(self) -> str:
        try:
            sessions = self.http.request("GET", "sessions", params={"name": self.config.project, "limit": 1}).json()
            if sessions and isinstance(sessions, list) and sessions[0].get("id"):
                tenant_id = quote(str(sessions[0].get("tenant_id", "")), safe="")
                project_id = quote(str(sessions[0]["id"]), safe="")
                endpoint = urlsplit(self.http.endpoint)
                web_url = "https://smith.langchain.com"
                # Match the SDK's self-hosted API suffix and cloud region mappings.
                if endpoint.path.endswith(("/api", "/api/v1")):
                    web_url = endpoint._replace(path=endpoint.path.rsplit("/api", 1)[0]).geturl()
                elif (region := endpoint.netloc.split(".", 1)[0]) in {"eu", "aws", "apac", "dev", "beta"}:
                    web_url = f"https://{region}.smith.langchain.com"
                return f"{web_url}/o/{tenant_id}/projects/p/{project_id}"
        except Exception:
            # Project discovery must not prevent reading saved settings.
            return "https://smith.langchain.com/"
        return "https://smith.langchain.com/"

    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        span_ids = {span.span_id: export_span_id(completed_trace, span.span_id) for span in completed_trace.spans}
        if parent_span is None and (external_id := completed_trace.source.external_trace_id):
            try:
                external_uuid = UUID(external_id)
                if external_uuid.int:
                    span_ids[completed_trace.root_span_id] = str(external_uuid)
            except ValueError:
                pass
        trace_id = str(parent_span["trace_id"]) if parent_span else span_ids[completed_trace.root_span_id]
        # One Bernoulli decision per trace, seeded by its identity so another worker's retry agrees.
        sampled = (
            parent_span.get("sampled", True) is not False
            if parent_span is not None
            else Random(trace_id).random() < self.sampling_rate  # noqa: S311 -- trace sampling is not a security decision
        )
        if not sampled:
            return ExportedParentSpans(
                spans={
                    span_id: {"trace_id": trace_id, "span_id": exported_id, "sampled": False}
                    for span_id, exported_id in span_ids.items()
                }
            )
        spans = _prepare_timed_spans(completed_trace)
        receipts: dict[str, dict[str, JsonValue]] = {}
        runs = []
        for span in spans:
            parent = receipts.get(span.parent_span_id or "") or parent_span
            assert span.started_at is not None
            assert span.ended_at is not None
            span_id = span_ids[span.span_id]
            own_order = span.started_at.strftime("%Y%m%dT%H%M%S%fZ") + span_id
            if parent is not None and not parent.get("dotted_order"):
                raise TraceExportError("langsmith_parent_order_missing")
            dotted_order = f"{parent['dotted_order']}.{own_order}" if parent else own_order
            inputs = span.inputs if isinstance(span.inputs, dict) else {"input": span.inputs}
            outputs = span.outputs if isinstance(span.outputs, dict) else {"output": span.outputs}
            metadata = span_attributes(completed_trace, span)
            if session_id := completed_trace.source.session_id or completed_trace.source.conversation_id:
                metadata["session_id"] = session_id
            if span.span_type == "llm":
                inputs, outputs = _format_llm_inputs(span.inputs), _format_llm_outputs(span.outputs)
                outputs["usage_metadata"] = _map_usage_metadata(span)
                metadata.update(
                    {
                        key: value
                        for key, value in {
                            "ls_model_name": span.attributes.get("model_name"),
                            "ls_provider": span.attributes.get("model_provider"),
                            "ls_model_type": "chat",
                        }.items()
                        if value is not None
                    }
                )
            if span.node_execution_id and span.attributes.get("node_type") in (
                "question-classifier",
                "parameter-extractor",
            ):
                original_inputs = span.attributes.get("original_inputs", span.inputs)
                inputs = original_inputs if isinstance(original_inputs, dict) else {"input": original_inputs}
            run_type, tags = _map_run_type_and_tags(span)
            # Captured metadata contains copies of content hidden by the SDK switches.
            if self.hide_inputs:
                for key in ("dify.inputs", "original_inputs", "query"):
                    metadata.pop(key, None)
            if self.hide_outputs:
                metadata.pop("dify.outputs", None)
            if self.hide_inputs or self.hide_outputs:
                metadata.pop("files", None)
                metadata.pop("process_data", None)
                metadata.pop("dify.events", None)
            run = {
                "id": span_id,
                "trace_id": trace_id,
                "name": span.span_name,
                "run_type": run_type,
                "start_time": span.started_at.isoformat(),
                "end_time": span.ended_at.isoformat() if span.ended_at else None,
                "inputs": {} if self.hide_inputs else inputs,
                "outputs": {} if self.hide_outputs else outputs,
                "error": span.error
                if span.status == "error" or (span.status == "cancelled" and span.span_type == "workflow")
                else None,
                "parent_run_id": parent["span_id"] if parent else None,
                "dotted_order": dotted_order,
                "session_name": self.config.project,
                "extra": {
                    "metadata": {} if self.hide_metadata else metadata,
                    "invocation_params": span.attributes.get("model_parameters", {}),
                },
                "tags": tags,
            }
            runs.append(run)
            receipts[span.span_id] = {
                "trace_id": trace_id,
                "span_id": span_id,
                "dotted_order": dotted_order,
                "sampled": True,
            }
        # Build and validate every run before posting; retries retain IDs and ancestor order.
        for run in runs:
            self.http.request("POST", "runs/batch", json={"post": [run]})
        return ExportedParentSpans(spans=receipts)
