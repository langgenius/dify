"""Collector projection examples checked against MLflow 3.11.1's native converter."""

import json
from typing import Any

import pytest
from dify_trace_mlflow.genai import translate_span_to_genai
from dify_trace_mlflow.mlflow_trace import MLflowTraceClient
from opentelemetry.proto.common.v1.common_pb2 import AnyValue
from opentelemetry.proto.trace.v1.trace_pb2 import Span, Status
from opentelemetry.sdk.trace import ReadableSpan
from opentelemetry.trace import SpanKind

from core.ops.otlp_trace import otlp_attributes
from tests.unit_tests.core.ops.test_provider_export import make_completed_trace


def make_span(attributes: dict[str, Any]) -> Span:
    return Span(
        name="Model",
        kind=Span.SPAN_KIND_INTERNAL,
        trace_id=bytes.fromhex("1234567890abcdef1234567890abcdef"),
        span_id=bytes.fromhex("1234567890abcdef"),
        parent_span_id=bytes.fromhex("abcdef1234567890"),
        start_time_unix_nano=1,
        end_time_unix_nano=2,
        attributes=otlp_attributes({key: json.dumps(value) for key, value in attributes.items()}),
        status=Status(code=Status.STATUS_CODE_ERROR, message="Captured error"),
        events=[Span.Event(name="exception", time_unix_nano=2)],
        flags=1,
    )


def read_value(value: AnyValue) -> Any:
    value_kind = value.WhichOneof("value")
    if value_kind == "array_value":
        return [read_value(item) for item in value.array_value.values]
    return value.ListFields()[0][1] if value_kind else None


def read_attributes(span: Span) -> dict[str, Any]:
    return {attribute.key: read_value(attribute.value) for attribute in span.attributes}


def chat_attributes() -> dict[str, Any]:
    return {
        "mlflow.spanType": "LLM",
        "mlflow.message.format": "openai",
        "mlflow.llm.model": "gpt-4o",
        "mlflow.llm.provider": "openai",
        "mlflow.chat.tokenUsage": {"input_tokens": 0, "output_tokens": 5, "total_tokens": 5},
        "mlflow.spanInputs": {
            "messages": [
                {"role": "system", "content": "Be concise."},
                {"role": "user", "content": "你好"},
                {
                    "role": "assistant",
                    "tool_calls": [{"id": "call-1", "function": {"name": "search", "arguments": '{"q":"weather"}'}}],
                },
                {"role": "tool", "tool_call_id": "call-1", "content": "Sunny"},
            ],
            "temperature": 0,
            "max_tokens": 32,
            "top_p": 0.8,
            "stop": "END",
            "tools": [{"type": "function", "function": {"name": "search", "parameters": {"type": "object"}}}],
        },
        "mlflow.spanOutputs": {
            "id": "response-1",
            "model": "gpt-4o-2024",
            "choices": [{"message": {"role": "assistant", "content": "晴天"}, "finish_reason": "stop"}],
        },
        "mlflow.llm.cost": {"total_cost": 0.02},
        "dify.tenant_id": "tenant-1",
        "dify.inputs": {"query": "captured input"},
    }


def test_chat_conversion_keeps_native_message_usage_and_system_instruction_semantics() -> None:
    original = make_span(chat_attributes())
    original_bytes = original.SerializeToString()
    translated = translate_span_to_genai(original)
    attributes = read_attributes(translated)
    assert translated.name == "generate_content gpt-4o"
    assert translated.kind == Span.SPAN_KIND_CLIENT
    assert attributes["gen_ai.usage.input_tokens"] == 0
    assert attributes["gen_ai.usage.output_tokens"] == 5
    assert attributes["gen_ai.provider.name"] == "openai"
    assert attributes["gen_ai.request.temperature"] == 0
    assert attributes["gen_ai.request.stop_sequences"] == ["END"]
    assert attributes["gen_ai.response.finish_reasons"] == ["stop"]
    assert json.loads(attributes["gen_ai.system_instructions"]) == [{"type": "text", "content": "Be concise."}]
    messages = json.loads(attributes["gen_ai.input.messages"])
    assert [message["role"] for message in messages] == ["user", "assistant", "tool"]
    assert messages[1]["parts"] == [
        {"type": "tool_call", "id": "call-1", "name": "search", "arguments": {"q": "weather"}}
    ]
    assert messages[2]["parts"] == [{"type": "tool_call_response", "id": "call-1", "result": "Sunny"}]
    assert json.loads(attributes["gen_ai.output.messages"])[0]["parts"] == [{"type": "text", "content": "晴天"}]
    assert json.loads(attributes["gen_ai.tool.definitions"]) == [
        {"type": "function", "name": "search", "parameters": {"type": "object"}}
    ]
    assert attributes["dify.tenant_id"] == '"tenant-1"'
    assert not any(key.startswith("mlflow.") for key in attributes)
    assert original.SerializeToString() == original_bytes
    translated.ClearField("attributes")
    original.ClearField("attributes")
    translated.name, translated.kind = original.name, original.kind
    assert translated == original


@pytest.mark.parametrize(
    ("span_type", "operation", "kind"),
    [
        ("TOOL", "execute_tool", Span.SPAN_KIND_INTERNAL),
        ("AGENT", "invoke_agent", Span.SPAN_KIND_INTERNAL),
        ("CHAIN", "CHAIN", Span.SPAN_KIND_INTERNAL),
        ("RETRIEVER", "RETRIEVER", Span.SPAN_KIND_INTERNAL),
    ],
)
def test_dify_non_model_types_preserve_native_operation_and_tool_fields(
    span_type: str, operation: str, kind: int
) -> None:
    span = make_span(
        {"mlflow.spanType": span_type, "mlflow.spanInputs": {"input": "argument"}, "mlflow.spanOutputs": ["result"]}
    )
    translated = translate_span_to_genai(span)
    attributes = read_attributes(translated)
    assert translated.name == operation
    assert translated.kind == kind
    assert "gen_ai.input.messages" not in attributes
    if span_type == "TOOL":
        assert attributes["gen_ai.tool.call.arguments"] == '{"input": "argument"}'
        assert attributes["gen_ai.tool.call.result"] == '["result"]'
    else:
        assert "gen_ai.tool.call.arguments" not in attributes


def test_multimodal_and_audio_output_use_only_the_captured_content() -> None:
    span = make_span(
        {
            "mlflow.spanType": "LLM",
            "mlflow.message.format": "openai",
            "mlflow.spanInputs": {
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": "Image and audio"},
                            {"type": "image_url", "image_url": {"url": "https://files.example/already-redacted"}},
                            {"type": "image_url", "image_url": {"url": "data:image/png;base64,captured"}},
                            {"type": "input_audio", "input_audio": {"format": "wav", "data": "captured-audio"}},
                        ],
                    }
                ]
            },
            "mlflow.spanOutputs": {
                "choices": [{"message": {"role": "assistant", "content": None, "audio": {"transcript": "Transcript"}}}]
            },
        }
    )
    attributes = read_attributes(translate_span_to_genai(span))
    parts = json.loads(attributes["gen_ai.input.messages"])[0]["parts"]
    assert parts[1] == {"type": "uri", "modality": "image", "uri": "https://files.example/already-redacted"}
    assert parts[2] == {"type": "blob", "modality": "image", "mime_type": "image/png", "content": "captured"}
    assert parts[3] == {"type": "blob", "modality": "audio", "mime_type": "audio/wav", "content": "captured-audio"}
    assert json.loads(attributes["gen_ai.output.messages"])[0]["parts"] == [{"type": "text", "content": "Transcript"}]


def test_truncated_or_unrelated_attributes_do_not_reintroduce_native_content(caplog: pytest.LogCaptureFixture) -> None:
    span = make_span(
        {"mlflow.spanType": "LLM", "mlflow.spanInputs": {"messages": []}, "model_parameters": {"temperature": 0.9}}
    )
    for attribute in span.attributes:
        if attribute.key == "mlflow.spanInputs":
            attribute.value.string_value = '{"secret": "incomplete'
    attributes = read_attributes(translate_span_to_genai(span))
    assert "gen_ai.input.messages" not in attributes
    assert "gen_ai.request.temperature" not in attributes
    assert "incomplete" not in json.dumps(attributes)
    assert not caplog.records


def test_genai_fields_replace_existing_keys_without_duplicate_attributes() -> None:
    span = make_span({"mlflow.spanType": "LLM", "mlflow.llm.model": "model", "gen_ai.request.model": "old"})
    translated = translate_span_to_genai(span)
    assert [attribute.key for attribute in translated.attributes].count("gen_ai.request.model") == 1
    assert read_attributes(translated)["gen_ai.request.model"] == "model"


@pytest.mark.parametrize(
    "case",
    [
        "chat",
        "multimodal",
        "tool",
        "responses",
        "malformed",
        "malformed-content",
        "absent",
        "dify-workflow",
        "dify-tool",
        "dify-model",
    ],
)
def test_projection_matches_optional_pinned_native_translator(case: str) -> None:
    native = pytest.importorskip("mlflow.tracing.export.genai_semconv.translator")
    attributes = chat_attributes()
    if case == "multimodal":
        attributes["mlflow.spanInputs"] = {
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "input_image", "image_url": "data:image/png;base64,YQ=="},
                        {"type": "unknown", "value": 7},
                    ],
                }
            ]
        }
    elif case == "tool":
        attributes = {
            "mlflow.spanType": "TOOL",
            "mlflow.spanInputs": {"input": "argument"},
            "mlflow.spanOutputs": [1, 2],
        }
    elif case == "responses":
        attributes["mlflow.spanInputs"] = {
            "instructions": "System",
            "input": [
                {"type": "function_call", "call_id": "c1", "name": "search", "arguments": "{invalid"},
                {"type": "function_call_output", "call_id": "c1", "output": "result"},
            ],
        }
        attributes["mlflow.spanOutputs"] = {
            "status": "completed",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "answer"}]}],
        }
    elif case == "malformed":
        attributes["mlflow.spanInputs"] = {"messages": ["invalid-message"]}
    elif case == "malformed-content":
        attributes["mlflow.spanInputs"] = {
            "messages": [{"role": "user", "content": [{"type": "text", "sensitive": "not-text"}]}]
        }
    elif case == "absent":
        attributes = {
            "mlflow.spanInputs": {"messages": [{"role": "user", "content": "private"}]},
            "dify.tenant_id": "tenant-2",
        }
    elif case.startswith("dify-"):
        trace = make_completed_trace()
        client = MLflowTraceClient("mlflow", {"tracking_uri": "https://tracker.example", "_runtime_settings": {}})
        captured_span = trace.spans[("dify-workflow", "dify-tool", "dify-model").index(case)]
        attributes = {
            key: json.loads(value)
            for key, value in client._attributes(trace, captured_span, "tr-1234567890abcdef1234567890abcdef").items()
        }
    span = make_span(attributes)
    native_span = native.translate_span_to_genai(
        ReadableSpan(name=span.name, kind=SpanKind.INTERNAL, attributes=read_attributes(span))
    )
    actual = translate_span_to_genai(span)
    assert read_attributes(actual) == dict(native_span.attributes)
    assert actual.name == native_span.name
    assert actual.kind == native_span.kind.value + 1
