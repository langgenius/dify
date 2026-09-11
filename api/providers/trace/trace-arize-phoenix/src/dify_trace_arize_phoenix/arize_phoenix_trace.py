"""Arize and Phoenix export the same complete OpenInference/OTLP span tree."""

from typing import Any, override
from urllib.parse import quote, urlsplit

from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status
from pydantic import JsonValue

from core.helper.ssl_context import create_grpc_credentials, create_ssl_context
from core.ops.otlp_trace import OtlpTraceClient, otlp_span, otlp_trace_id
from core.ops.provider_export import export_span_id, json_text, span_attributes
from core.ops.trace_data import CompletedTrace, ExportedParentSpans, TraceSpan
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
    def __init__(self, *args: Any, disabled: bool = False, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.disabled = disabled

    @override
    def verify_credentials(self) -> bool:
        return self.disabled or super().verify_credentials()

    @override
    def export_trace(
        self, completed_trace: CompletedTrace, parent_span: dict[str, JsonValue] | None = None
    ) -> ExportedParentSpans:
        if self.disabled or (parent_span is not None and parent_span.get("disabled") is True):
            return ExportedParentSpans(
                spans={
                    span.span_id: {
                        "trace_id": otlp_trace_id(completed_trace, parent_span),
                        "span_id": export_span_id(completed_trace, span.span_id),
                        "disabled": True,
                    }
                    for span in completed_trace.spans
                }
            )
        return super().export_trace(completed_trace, parent_span)

    @override
    def build_span(
        self, completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
    ) -> Span:
        metadata = span_attributes(completed_trace, span)
        metadata.pop("dify.inputs", None)
        metadata.pop("dify.outputs", None)
        process_data = span.attributes.get("process_data")
        captured = {**(process_data if isinstance(process_data, dict) else {}), **span.attributes}
        node_type = span.attributes.get("node_type")
        native_type = node_type if span.node_execution_id and isinstance(node_type, str) else span.span_type
        inputs = span.inputs
        if span.node_execution_id and node_type in ("question-classifier", "parameter-extractor"):
            inputs = span.attributes.get("original_inputs", inputs)
        attributes: dict[str, Any] = {
            **metadata,
            "metadata": json_text(metadata),
            "session.id": completed_trace.source.session_id
            or completed_trace.source.conversation_id
            or completed_trace.source.workflow_run_id,
            "user.id": completed_trace.source.actor_id,
            "input.value": inputs if isinstance(inputs, str) else json_text(inputs),
            "input.mime_type": "text/plain" if isinstance(inputs, str) else "application/json",
            "output.value": span.outputs if isinstance(span.outputs, str) else json_text(span.outputs),
            "output.mime_type": "text/plain" if isinstance(span.outputs, str) else "application/json",
            "openinference.span.kind": {"suggested_question": "TOOL", "generate_name": "CHAIN"}.get(
                str(span.attributes.get("operation_type")),
                {
                    "llm": "LLM",
                    "tool": "TOOL",
                    "retrieval": "RETRIEVER",
                    "knowledge-retrieval": "RETRIEVER",
                    "agent": "AGENT",
                }.get(native_type, "CHAIN"),
            ),
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
            documents = (
                span.outputs.get("result", span.outputs.get("documents", []))
                if isinstance(span.outputs, dict)
                else span.outputs
            )
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
        exported_span = otlp_span(completed_trace, span, parent_span, attributes=attributes)
        # Existing provider status filters include stopped workflows with a reason.
        if span.span_type == "workflow" and span.status == "cancelled" and span.error:
            exported_span.status.code = Status.STATUS_CODE_ERROR
        return exported_span


def create_trace_client(provider_name: str, provider_config: dict[str, Any]) -> OpenInferenceTraceClient:
    config_class = ArizeConfig if provider_name == "arize" else PhoenixConfig
    config = config_class.model_validate(provider_config)
    runtime_settings = (
        provider_config["_runtime_settings"]
        if "_runtime_settings" in provider_config
        else config_class.load_runtime_settings(provider_config)
    )
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
    if isinstance(config, ArizeConfig):
        parsed_endpoint = urlsplit(config.endpoint)
        target = parsed_endpoint.netloc if parsed_endpoint.port else f"{parsed_endpoint.netloc}:443"
        scheme = "http" if runtime_settings.get("insecure", parsed_endpoint.scheme == "http") else "https"
        return OpenInferenceTraceClient(
            f"{scheme}://{target}",
            headers,
            resource_attributes,
            project_url,
            protocol="grpc",
            disabled=bool(runtime_settings.get("disabled", False)),
            grpc_credentials={"trace": create_grpc_credentials(runtime_settings.get("tls", {}))},
        )
    endpoint = config.endpoint.rstrip("/")
    if not endpoint.endswith("/v1/traces"):
        endpoint += "/v1/traces"
    return OpenInferenceTraceClient(
        endpoint,
        headers,
        resource_attributes,
        project_url,
        disabled=bool(runtime_settings.get("disabled", False)),
        ssl_context=create_ssl_context(runtime_settings.get("tls", {}), verify=runtime_settings.get("verify", True)),
    )
