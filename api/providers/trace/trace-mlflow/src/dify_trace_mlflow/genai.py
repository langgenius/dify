"""Translate Dify's MLflow collector spans to the pinned native GenAI conventions."""

import json
from typing import Any

from opentelemetry.proto.trace.v1.trace_pb2 import Span

from core.ops.otlp_trace import otlp_attributes


def _read_attribute(attributes: dict[str, str], name: str) -> Any:
    try:
        return json.loads(attributes[name])
    except (KeyError, ValueError, TypeError):
        # LiveSpan attributes may have been cut by the configured SDK length limit.
        return None


def _parse_tool_arguments(arguments: Any) -> Any:
    if isinstance(arguments, str):
        try:
            return json.loads(arguments)
        except ValueError:
            pass
    return arguments


def _convert_image(url: str) -> dict[str, Any]:
    if not url.startswith("data:"):
        return {"type": "uri", "modality": "image", "uri": url}
    header, _, content = url.partition(",")
    return {
        "type": "blob",
        "modality": "image",
        "mime_type": header.removeprefix("data:").removesuffix(";base64"),
        "content": content,
    }


def _convert_content(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, list):
        return [{"type": "text", "content": str(content)}] if content is not None else []
    parts = []
    for item in content:
        match item.get("type") if isinstance(item, dict) else None:
            case "text" | "input_text":
                parts.append({"type": "text", "content": item["text"]})
            case "image_url":
                parts.append(_convert_image(item["image_url"]["url"]))
            case "input_image":
                parts.append(_convert_image(item["image_url"]))
            case "input_audio":
                audio = item["input_audio"]
                parts.append(
                    {
                        "type": "blob",
                        "modality": "audio",
                        "mime_type": f"audio/{audio['format']}",
                        "content": audio["data"],
                    }
                )
            case _:
                parts.append({"type": "text", "content": json.dumps(item)})
    return parts


def _convert_message(message: dict[str, Any]) -> dict[str, Any]:
    role = message.get("role", "user")
    parts = _convert_content(message.get("content"))
    if not parts and isinstance(message.get("audio"), dict):
        if isinstance(transcript := message["audio"].get("transcript"), str):
            parts = [{"type": "text", "content": transcript}]
    for call in message.get("tool_calls") or []:
        function = call.get("function", {})
        parts.append(
            {
                "type": "tool_call",
                "id": call.get("id"),
                "name": function.get("name"),
                "arguments": _parse_tool_arguments(function.get("arguments", "{}")),
            }
        )
    if call_id := message.get("tool_call_id"):
        parts = [{"type": "tool_call_response", "id": call_id, "result": parts[0].get("content") if parts else None}]
    return {"role": role, "parts": parts}


def _convert_response_item(item: dict[str, Any], *, output: bool = False) -> dict[str, Any]:
    match item.get("type"):
        case "function_call":
            return {
                "role": "assistant",
                "parts": [
                    {
                        "type": "tool_call",
                        "id": item["call_id"],
                        "name": item["name"],
                        "arguments": _parse_tool_arguments(item["arguments"]),
                    }
                ],
            }
        case "function_call_output" if not output:
            return {
                "role": "tool",
                "parts": [{"type": "tool_call_response", "id": item["call_id"], "result": item["output"]}],
            }
        case "message" if output:
            return {
                "role": item.get("role", "assistant"),
                "parts": [
                    {"type": "text", "content": part["text"] if part.get("type") == "output_text" else json.dumps(part)}
                    for part in item.get("content", [])
                ],
            }
        case _:
            return (
                {"role": "assistant", "parts": [{"type": "text", "content": json.dumps(item)}]}
                if output
                else _convert_message(item)
            )


def _translate_messages(inputs: Any, outputs: Any, *, responses: bool) -> dict[str, Any]:
    attributes: dict[str, Any] = {}
    if inputs is not None:
        messages = inputs.get("input" if responses else "messages")
        if responses and isinstance(messages, str):
            attributes["gen_ai.input.messages"] = json.dumps([{"role": "user", "parts": _convert_content(messages)}])
        elif isinstance(messages, list):
            attributes["gen_ai.input.messages"] = json.dumps(
                [_convert_response_item(message) for message in messages]
                if responses
                else [_convert_message(message) for message in messages if message.get("role") != "system"]
            )
        system_parts = []
        if responses:
            if isinstance(instructions := inputs.get("instructions"), str) and instructions:
                system_parts = [{"type": "text", "content": instructions}]
        elif isinstance(messages, list):
            system_parts = [
                {"type": "text", "content": message["content"]}
                for message in messages
                if message.get("role") == "system" and isinstance(message.get("content"), str)
            ]
        if system_parts:
            attributes["gen_ai.system_instructions"] = json.dumps(system_parts)
        for source, target in (
            ("temperature", "temperature"),
            ("max_tokens", "max_tokens"),
            ("top_p", "top_p"),
            ("stop", "stop_sequences"),
        ):
            if (value := inputs.get(source)) is not None:
                attributes["gen_ai.request." + target] = (
                    [value] if source == "stop" and isinstance(value, str) else value
                )
        if inputs.get("tools") is not None:
            attributes["gen_ai.tool.definitions"] = json.dumps(
                [
                    {
                        "type": tool.get("type", "function"),
                        **(tool.get("function") or {key: value for key, value in tool.items() if key != "type"}),
                    }
                    for tool in inputs["tools"]
                ]
            )
    if outputs is not None:
        messages = outputs.get("output" if responses else "choices")
        if isinstance(messages, list):
            converted = []
            for message in messages:
                content = (
                    _convert_response_item(message, output=True)
                    if responses
                    else _convert_message(message.get("message") or message.get("delta", {}))
                )
                reason = outputs.get("status") if responses else message.get("finish_reason")
                if reason:
                    content["finish_reason"] = reason
                converted.append(content)
            attributes["gen_ai.output.messages"] = json.dumps(converted)
        for key in ("id", "model"):
            if value := outputs.get(key):
                attributes["gen_ai.response." + key] = value
        reasons = []
        if responses and outputs.get("status"):
            reasons = [outputs["status"]]
        elif not responses and isinstance(messages, list):
            reasons = [message["finish_reason"] for message in messages if message.get("finish_reason")]
        if reasons:
            attributes["gen_ai.response.finish_reasons"] = reasons
    return attributes


def translate_span_to_genai(span: Span) -> Span:
    """Copy a collector span; never reopen inputs or change the native export's span."""
    translated = Span()
    translated.CopyFrom(span)
    encoded = {attribute.key: attribute.value.string_value for attribute in span.attributes}
    attributes: dict[str, Any] = {}
    span_type = _read_attribute(encoded, "mlflow.spanType")
    operation = {
        "CHAT_MODEL": "chat",
        "LLM": "generate_content",
        "EMBEDDING": "embeddings",
        "TOOL": "execute_tool",
        "AGENT": "invoke_agent",
    }.get(span_type, span_type)
    if operation:
        attributes["gen_ai.operation.name"] = operation
    for source, target in (
        ("mlflow.llm.model", "gen_ai.request.model"),
        ("mlflow.llm.provider", "gen_ai.provider.name"),
    ):
        if value := _read_attribute(encoded, source):
            attributes[target] = value
    if isinstance(usage := _read_attribute(encoded, "mlflow.chat.tokenUsage"), dict):
        for key in ("input_tokens", "output_tokens"):
            if usage.get(key) is not None:
                attributes["gen_ai.usage." + key] = usage[key]
    inputs = _read_attribute(encoded, "mlflow.spanInputs")
    outputs = _read_attribute(encoded, "mlflow.spanOutputs")
    if span_type == "TOOL":
        if inputs is not None:
            attributes["gen_ai.tool.call.arguments"] = json.dumps(inputs)
        if outputs is not None:
            attributes["gen_ai.tool.call.result"] = json.dumps(outputs)
    if attributes:
        try:
            responses = (
                _read_attribute(encoded, "mlflow.message.format") == "openai"
                and inputs is not None
                and "input" in inputs
            )
            attributes.update(_translate_messages(inputs, outputs, responses=responses))
        except (AttributeError, KeyError, TypeError, ValueError):
            # Native conversion retains universal fields when inputs do not match a message shape.
            pass
        if "gen_ai.tool.definitions" not in attributes and (tools := _read_attribute(encoded, "mlflow.chat.tools")):
            attributes["gen_ai.tool.definitions"] = tools if isinstance(tools, str) else json.dumps(tools)
    del translated.attributes[:]
    translated.attributes.extend(
        attribute
        for attribute in span.attributes
        if not attribute.key.startswith("mlflow.") and attribute.key not in attributes
    )
    translated.attributes.extend(otlp_attributes(attributes))
    if operation:
        model = attributes.get("gen_ai.request.model")
        translated.name = f"{operation} {model}" if model else operation
        if operation in {"chat", "text_completion", "embeddings", "generate_content"}:
            translated.kind = Span.SPAN_KIND_CLIENT
        elif operation in {"execute_tool", "invoke_agent"}:
            translated.kind = Span.SPAN_KIND_INTERNAL
    return translated
