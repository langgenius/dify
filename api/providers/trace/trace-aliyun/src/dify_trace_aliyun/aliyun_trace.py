"""Send captured spans to Aliyun with explicitly captured HTTP and TLS settings."""

import json
import re
import socket
from typing import Any, override
from urllib.parse import quote, urljoin, urlsplit

from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status
from pydantic import JsonValue

from configs import dify_config
from core.helper.ssl_context import create_ssl_context
from core.ops.otlp_trace import OtlpTraceClient, otlp_span
from core.ops.provider_export import json_text, span_attributes
from core.ops.trace_data import CompletedTrace, TraceSpan
from dify_trace_aliyun.config import AliyunConfig


def message_parts(content: JsonValue) -> list[JsonValue]:
    if isinstance(content, str):
        return [{"type": "text", "content": content}] if content else []
    if not isinstance(content, list):
        return [{"type": "text", "content": json_text(content)}] if content is not None else []
    parts: list[JsonValue] = []
    for item in content:
        if not isinstance(item, dict):
            parts.extend(message_parts(item))
        elif item.get("type") in {"text", "reasoning"}:
            parts.append({"type": item["type"], "content": item.get("content", item.get("text", item.get("data", "")))})
        elif item.get("type") in {"image", "image_url", "audio", "video", "file"}:
            image_url = item.get("image_url")
            uri = image_url.get("url") if isinstance(image_url, dict) else image_url
            parts.append(
                {
                    "type": "uri",
                    "uri": uri or item.get("url") or item.get("data"),
                    "modality": str(item["type"]).removesuffix("_url"),
                }
            )
        else:
            parts.append(item)
    return parts


def gen_ai_messages(value: JsonValue, default_role: str) -> list[dict[str, JsonValue]]:
    """Convert captured Dify/OpenAI messages into Aliyun's ordered role/parts schema."""
    if isinstance(value, dict) and isinstance(value.get("messages"), list):
        value = value["messages"]
    values = value if isinstance(value, list) else [value]
    messages: list[dict[str, JsonValue]] = []
    for item in values:
        if item is None:
            continue
        message = item if isinstance(item, dict) else {"content": item}
        role = str(message.get("role") or default_role)
        content = message.get("content", message.get("text", message.get("answer", message.get("thought"))))
        existing_parts = message.get("parts")
        parts: list[JsonValue] = list(existing_parts) if isinstance(existing_parts, list) else message_parts(content)
        if role == "tool":
            parts = [{"type": "tool_call_response", "id": message.get("tool_call_id"), "result": content}]
        else:
            tool_calls = message.get("tool_calls")
            for tool_call in tool_calls if isinstance(tool_calls, list) else []:
                if not isinstance(tool_call, dict):
                    continue
                function = tool_call.get("function")
                if not isinstance(function, dict):
                    function = tool_call
                arguments = function.get("arguments")
                if isinstance(arguments, str):
                    try:
                        arguments = json.loads(arguments)
                    except ValueError:
                        pass
                parts.append(
                    {
                        "type": "tool_call",
                        "id": tool_call.get("id"),
                        "name": function.get("name"),
                        "arguments": arguments,
                    }
                )
        formatted: dict[str, JsonValue] = {"role": role, "parts": parts}
        if message.get("finish_reason") is not None:
            formatted["finish_reason"] = message["finish_reason"]
        messages.append(formatted)
    return messages


class AliyunTraceClient(OtlpTraceClient):
    @override
    def build_span(
        self, completed_trace: CompletedTrace, span: TraceSpan, parent_span: dict[str, JsonValue] | None = None
    ) -> Span:
        process_data = span.attributes.get("process_data")
        captured = {**(process_data if isinstance(process_data, dict) else {}), **span.attributes}
        native_type = span.span_type
        if span.node_execution_id and isinstance(node_type := captured.get("node_type"), str):
            native_type = {"llm": "llm", "tool": "tool", "knowledge-retrieval": "retrieval", "agent": "agent"}.get(
                node_type, "node"
            )
        inputs = captured.get("original_inputs", span.inputs) if native_type == "node" else span.inputs
        attributes: dict[str, Any] = {
            **span_attributes(completed_trace, span),
            "input.value": json_text(inputs),
            "output.value": span.outputs if isinstance(span.outputs, str) else json_text(span.outputs),
            "gen_ai.session.id": completed_trace.source.session_id or completed_trace.source.conversation_id,
            "gen_ai.user.id": completed_trace.source.actor_id,
            "gen_ai.conversation.id": completed_trace.source.conversation_id,
            "gen_ai.framework": "dify",
            "gen_ai.span.kind": {
                "llm": "LLM",
                "tool": "TOOL",
                "retrieval": "RETRIEVER",
                "agent": "AGENT",
                "node": "TASK",
            }.get(native_type, "CHAIN"),
            "gen_ai.operation.name": {
                "llm": "chat",
                "tool": "execute_tool",
                "retrieval": "retrieval",
                "agent": "invoke_agent",
            }.get(native_type, native_type),
        }
        attributes.pop("dify.inputs", None)
        attributes.pop("dify.outputs", None)
        usage = span.usage or captured.get("aggregate_usage")
        if isinstance(usage, dict):
            for field, key in (
                ("prompt_tokens", "gen_ai.usage.input_tokens"),
                ("completion_tokens", "gen_ai.usage.output_tokens"),
                ("total_tokens", "gen_ai.usage.total_tokens"),
            ):
                attributes[key] = usage.get(field)
            ttft = usage.get("time_to_first_token", captured.get("gen_ai_server_time_to_first_token"))
            if isinstance(ttft, (int, float)) and not isinstance(ttft, bool):
                attributes["gen_ai.response.time_to_first_token"] = int(ttft * 1_000_000_000)
        if native_type == "llm":
            # Plugin thought details have no node execution ID; concrete LLM titles
            # can use the same suffix without changing their native projection.
            is_agent_thought = not span.node_execution_id and span.span_name.endswith(" Thought")
            original_inputs = captured.get("original_inputs", span.inputs)
            original_inputs = original_inputs if isinstance(original_inputs, dict) else {}
            model_name = (
                captured.get("model_name")
                or original_inputs.get("model_name")
                or (span.span_name.removesuffix(" Thought") if is_agent_thought else None)
            )
            completion = span.outputs
            if isinstance(completion, dict):
                completion = (
                    str(completion.get("thought") or completion.get("action") or completion.get("text") or "")
                    if is_agent_thought
                    else str(completion.get("text") or completion.get("error_message") or span.error or "")
                )
            elif span.node_execution_id and captured.get("node_type") == "llm":
                completion = span.error or ""
            attributes.update(
                {
                    "gen_ai.request.model": model_name,
                    "gen_ai.response.model": model_name,
                    "gen_ai.provider.name": captured.get("model_provider")
                    or captured.get("provider")
                    or original_inputs.get("model_provider"),
                    "gen_ai.prompt": json_text(span.inputs),
                    "gen_ai.completion": completion,
                    "output.value": json_text(span.outputs) if is_agent_thought else completion,
                    "gen_ai.input.messages": json_text(gen_ai_messages(span.inputs, "user")),
                    "gen_ai.output.messages": json_text(gen_ai_messages(span.outputs, "assistant")),
                }
            )
            if isinstance(span.outputs, dict) and (
                finish_reason := span.outputs.get("finish_reason") or span.outputs.get("error_type")
            ):
                attributes["gen_ai.response.finish_reason"] = finish_reason
                attributes["gen_ai.response.finish_reasons"] = [finish_reason]
            parameters = captured.get("model_parameters")
            if isinstance(parameters, dict):
                for field in (
                    "temperature",
                    "top_p",
                    "top_k",
                    "max_tokens",
                    "frequency_penalty",
                    "presence_penalty",
                    "seed",
                ):
                    attributes[f"gen_ai.request.{field}"] = parameters.get(field)
                if parameters.get("tools"):
                    attributes["gen_ai.tool.definitions"] = json_text(parameters["tools"])
        elif native_type == "agent":
            attributes["gen_ai.agent.name"] = captured.get("agent_name") or span.span_name
            if captured.get("node_type") == "agent" and isinstance(span.outputs, dict):
                attributes["output.value"] = str(span.outputs.get("text", ""))
            round_match = re.fullmatch(r"ROUND\s+(\d+)", span.span_name, re.IGNORECASE)
            round_number = captured.get("agent_round") or (int(round_match[1]) if round_match else None)
            if round_number is not None:
                attributes.update(
                    {"gen_ai.span.kind": "STEP", "gen_ai.operation.name": "react", "gen_ai.react.round": round_number}
                )
                if span.error:
                    attributes["gen_ai.react.finish_reason"] = "error"
        elif native_type == "tool":
            tool_output = span.outputs if isinstance(span.outputs, dict) else {}
            tool_metadata = captured.get("metadata")
            tool_info = tool_metadata.get("tool_info") if isinstance(tool_metadata, dict) else None
            tool_info = tool_info if isinstance(tool_info, dict) else {}
            tool_name = (
                captured.get("tool_name") or tool_output.get("tool_name") or span.span_name.removeprefix("CALL ")
            )
            provider_type = (
                captured.get("provider_type") or tool_output.get("provider_type") or tool_info.get("provider_type")
            )
            tool_type = (
                "datastore"
                if provider_type in {"dataset-retrieval", "datastore"}
                else "extension"
                if provider_type == "extension"
                else "function"
            )
            tool_arguments = span.inputs
            tool_result = span.outputs
            if span.inputs is None and span.span_name.startswith("CALL "):
                tool_arguments = tool_output.get("tool_call_args", tool_output.get("tool_call_input", tool_output))
                tool_result = tool_output.get("output", tool_output)
                attributes["input.value"] = json_text(tool_arguments)
                attributes["output.value"] = tool_result if isinstance(tool_result, str) else json_text(tool_result)
            elif captured.get("operation_type") == "tool" and not span.node_execution_id:
                tool_result = str(span.outputs)
                attributes["output.value"] = tool_result
            tool_result_text = tool_result if isinstance(tool_result, str) else json_text(tool_result)
            attributes.update(
                {
                    "gen_ai.tool.name": tool_name,
                    "gen_ai.tool.type": tool_type,
                    "gen_ai.tool.description": captured.get("tool_description")
                    or captured.get("description")
                    or tool_output.get("description")
                    or tool_info.get("description")
                    or tool_info.get("tool_description"),
                    "gen_ai.tool.call.id": captured.get("tool_call_id") or span.span_id,
                    "gen_ai.tool.call.arguments": json_text(tool_arguments),
                    "gen_ai.tool.call.result": tool_result_text,
                }
            )
            for field in ("id", "name", "description", "version"):
                attributes[f"gen_ai.skill.{field}"] = captured.get(f"skill_{field}") or tool_output.get(
                    f"skill_{field}"
                )
        elif native_type == "retrieval":
            workflow_results = isinstance(span.outputs, dict) and "result" in span.outputs
            documents = (
                span.outputs.get("result", span.outputs.get("documents", []))
                if isinstance(span.outputs, dict)
                else span.outputs
            )
            retrieval_documents: list[JsonValue] = []
            for document in documents if isinstance(documents, list) else []:
                if not isinstance(document, dict):
                    continue
                document_metadata = document.get("metadata")
                document_metadata = dict(document_metadata) if isinstance(document_metadata, dict) else {}
                retrieval_document: dict[str, JsonValue] = {
                    "content": document.get("page_content", document.get("content")),
                    "metadata": document_metadata,
                    "score": document.get("score", document_metadata.get("score")),
                    "id": document.get("id") or document_metadata.get("document_id"),
                }
                if workflow_results:
                    if document.get("title"):
                        document_metadata["title"] = document["title"]
                    if source := document_metadata.get("source") or document_metadata.get("_source"):
                        document_metadata["source"] = source
                    if isinstance(extra_metadata := document_metadata.get("doc_metadata"), dict):
                        document_metadata.update(extra_metadata)
                retrieval_documents.append({"document": retrieval_document} if workflow_results else retrieval_document)
            query = span.inputs.get("query", span.inputs) if isinstance(span.inputs, dict) else span.inputs
            query_text = query if isinstance(query, str) else json_text(query)
            if isinstance(span.outputs, dict) and "documents" in span.outputs:
                native_documents: list[JsonValue] = []
                for document in documents if isinstance(documents, list) else []:
                    if not isinstance(document, dict):
                        continue
                    metadata = document.get("metadata")
                    metadata = metadata if isinstance(metadata, dict) else {}
                    native_documents.append(
                        {
                            "content": document.get("page_content", document.get("content")),
                            "metadata": {key: metadata.get(key) for key in ("dataset_id", "doc_id", "document_id")},
                            "score": metadata.get("score"),
                        }
                    )
            else:
                native_documents = retrieval_documents
            attributes.update(
                {
                    "input.value": query_text,
                    "output.value": json_text(documents if workflow_results else native_documents),
                    "retrieval.query": query_text,
                    "retrieval.document": json_text(native_documents),
                    "gen_ai.retrieval.query.text": query_text,
                    "gen_ai.retrieval.documents": json_text(retrieval_documents),
                    "gen_ai.data_source.id": captured.get("dataset_id"),
                    "gen_ai.request.model": captured.get("embedding_model"),
                    "gen_ai.provider.name": captured.get("embedding_model_provider"),
                }
            )
        exported_span = otlp_span(completed_trace, span, parent_span, attributes=attributes)
        if span.attributes.get("operation_type") == "message" or (
            span.span_type == "workflow"
            and span.span_id == completed_trace.root_span_id
            and not completed_trace.source.message_id
            and parent_span is None
        ):
            exported_span.kind = Span.SPAN_KIND_SERVER
        # Existing provider status filters include stopped workflows with a reason.
        if span.span_type == "workflow" and span.status == "cancelled" and span.error:
            exported_span.status.code = Status.STATUS_CODE_ERROR
        return exported_span


def create_trace_client(provider_config: dict[str, Any]) -> AliyunTraceClient:
    config = AliyunConfig.model_validate(provider_config)
    runtime_settings = (
        provider_config["_runtime_settings"]
        if "_runtime_settings" in provider_config
        else AliyunConfig.load_runtime_settings(provider_config)
    )
    hostname = urlsplit(config.endpoint).hostname or ""
    path = (
        "api/v1/traces"
        if hostname == "log.aliyuncs.com" or hostname.endswith(".log.aliyuncs.com")
        else "api/otlp/traces"
    )
    endpoint = urljoin(config.endpoint, f"adapt_{quote(config.license_key, safe='')}/{path}")
    return AliyunTraceClient(
        endpoint,
        runtime_settings["headers"],
        {
            "service.name": config.app_name,
            "service.version": f"dify-{dify_config.project.version}-{dify_config.COMMIT_SHA}",
            "deployment.environment": f"{dify_config.DEPLOY_ENV}-{dify_config.DEPLOYMENT_EDITION.value}",
            "host.name": socket.gethostname(),
            "acs.arms.service.feature": "genai_app",
        },
        "https://arms.console.aliyun.com/#/llm",
        request_timeout=float(runtime_settings.get("request_timeout", 10)),
        ssl_context=create_ssl_context(runtime_settings["tls"], verify=runtime_settings["verify"]),
    )
