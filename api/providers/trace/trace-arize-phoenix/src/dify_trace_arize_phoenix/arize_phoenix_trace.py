"""Arize and Phoenix export the same complete OpenInference/OTLP span tree."""

from typing import Any, override
from urllib.parse import quote

from opentelemetry.proto.trace.v1.trace_pb2 import Span
from pydantic import JsonValue

from core.ops.otlp_trace import OtlpTraceClient, otlp_span
from core.ops.provider_export import json_text, span_attributes
from core.ops.trace_data import CompletedTrace, TraceSpan
from dify_trace_arize_phoenix.config import ArizeConfig, PhoenixConfig


def message_attributes(value: JsonValue, prefix: str, default_role: str) -> dict[str, Any]:
    """Flatten captured messages and tool calls for OpenInference's native message view."""
    if isinstance(value, dict) and isinstance(value.get("messages"), list):
        value = value["messages"]
    messages = value if isinstance(value, list) else [value]
    attributes: dict[str, Any] = {}
    for index, item in enumerate(messages):
        if item is None:
            continue
        message = item if isinstance(item, dict) else {"content": item}
        path = f"{prefix}.{index}.message"
        attributes[f"{path}.role"] = message.get("role") or default_role
        content = message.get("content", message.get("text", message.get("answer", message.get("thought"))))
        if content is not None:
            attributes[f"{path}.content"] = content if isinstance(content, str) else json_text(content)
        for field in ("name", "tool_call_id"):
            if message.get(field) is not None:
                attributes[f"{path}.{field}"] = message[field]
        tool_calls = message.get("tool_calls")
        for tool_index, tool_call in enumerate(tool_calls if isinstance(tool_calls, list) else []):
            if not isinstance(tool_call, dict):
                continue
            function = tool_call.get("function")
            if not isinstance(function, dict):
                function = tool_call
            tool_path = f"{path}.tool_calls.{tool_index}.tool_call"
            attributes[f"{tool_path}.id"] = tool_call.get("id")
            attributes[f"{tool_path}.function.name"] = function.get("name")
            arguments = function.get("arguments")
            attributes[f"{tool_path}.function.arguments"] = (
                arguments if isinstance(arguments, str) else json_text(arguments)
            )
    return attributes


class OpenInferenceTraceClient(OtlpTraceClient):
    @override
    def build_span(
        self, completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
    ) -> Span:
        metadata = span_attributes(completed_trace, span)
        metadata.pop("dify.inputs", None)
        metadata.pop("dify.outputs", None)
        process_data = span.attributes.get("process_data")
        captured = {**(process_data if isinstance(process_data, dict) else {}), **span.attributes}
        attributes: dict[str, Any] = {
            **metadata,
            "metadata": json_text(metadata),
            "session.id": completed_trace.source.session_id or completed_trace.source.conversation_id,
            "user.id": completed_trace.source.actor_id,
            "input.value": span.inputs if isinstance(span.inputs, str) else json_text(span.inputs),
            "input.mime_type": "text/plain" if isinstance(span.inputs, str) else "application/json",
            "output.value": span.outputs if isinstance(span.outputs, str) else json_text(span.outputs),
            "output.mime_type": "text/plain" if isinstance(span.outputs, str) else "application/json",
            "openinference.span.kind": {
                "llm": "LLM",
                "tool": "TOOL",
                "retrieval": "RETRIEVER",
                "agent": "AGENT",
            }.get(span.span_type, "CHAIN"),
        }
        if isinstance(captured.get("tags"), list):
            attributes["tag.tags"] = captured["tags"]
        for field, key in (
            ("prompt_tokens", "llm.token_count.prompt"),
            ("completion_tokens", "llm.token_count.completion"),
            ("total_tokens", "llm.token_count.total"),
        ):
            attributes[key] = span.usage.get(field)
        if span.span_type == "llm":
            attributes.update(
                {
                    "llm.model_name": captured.get("model_name") or captured.get("ls_model_name"),
                    "llm.provider": captured.get("model_provider") or captured.get("ls_provider"),
                    "llm.system": captured.get("model_provider") or captured.get("ls_provider"),
                    **message_attributes(span.inputs, "llm.input_messages", "user"),
                    **message_attributes(span.outputs, "llm.output_messages", "assistant"),
                }
            )
            parameters = captured.get("model_parameters")
            if isinstance(parameters, dict):
                attributes["llm.invocation_parameters"] = json_text(parameters)
                tools = parameters.get("tools")
                for index, tool in enumerate(tools if isinstance(tools, list) else []):
                    attributes[f"llm.tools.{index}.tool.json_schema"] = json_text(tool)
            total_cost = span.usage.get("total_price", span.usage.get("total_cost"))
            if isinstance(total_cost, (int, float, str)):
                try:
                    attributes["llm.cost.total"] = float(total_cost)
                except ValueError:
                    pass
        elif span.span_type == "tool":
            attributes.update(
                {
                    "tool.name": captured.get("tool_name") or span.span_name,
                    "tool.description": captured.get("tool_description"),
                    "tool.parameters": json_text(captured.get("tool_parameters", span.inputs)),
                }
            )
        elif span.span_type == "retrieval":
            documents = span.outputs.get("documents", []) if isinstance(span.outputs, dict) else span.outputs
            for index, document in enumerate(documents if isinstance(documents, list) else []):
                if not isinstance(document, dict):
                    continue
                document_metadata = document.get("metadata")
                document_metadata = document_metadata if isinstance(document_metadata, dict) else {}
                path = f"retrieval.documents.{index}.document"
                attributes.update(
                    {
                        f"{path}.id": document.get("id") or document_metadata.get("document_id"),
                        f"{path}.content": document.get("page_content", document.get("content")),
                        f"{path}.score": document.get("score", document_metadata.get("score")),
                        f"{path}.metadata": json_text(document_metadata),
                    }
                )
        return otlp_span(completed_trace, span, parent_span, attributes=attributes)


def create_trace_client(provider_name: str, provider_config: dict[str, Any]) -> OpenInferenceTraceClient:
    config = (ArizeConfig if provider_name == "arize" else PhoenixConfig).model_validate(provider_config)
    headers = {"authorization": f"Bearer {config.api_key}"} if config.api_key else {}
    resource_attributes = {
        "openinference.project.name": config.project or "default",
        "model_id": config.project or "default",
    }
    if isinstance(config, ArizeConfig):
        headers.update({"api_key": config.api_key or "", "space_id": config.space_id or ""})
        project_url = "https://app.arize.com/"
    else:
        headers["api_key"] = config.api_key or ""
        project_url = config.endpoint.rstrip("/") + "/projects/"
    project_url += f"?redirect_project_name={quote(config.project or 'default', safe='')}"
    endpoint = config.endpoint.rstrip("/")
    if not endpoint.endswith("/v1/traces"):
        endpoint += "/v1/traces"
    return OpenInferenceTraceClient(endpoint, headers, resource_attributes, project_url)
