from pathlib import Path
from unittest.mock import Mock, patch

from dify_plugin import OAICompatLargeLanguageModel
from dify_plugin.entities.model import AIModelEntity, I18nObject, ModelFeature, ModelType
from dify_plugin.entities.model.message import AssistantPromptMessage, UserPromptMessage

from model_catalog import parse_catalog
from models._credentials import ENDPOINT_URL
from models.llm.llm import AMDGPUCloudLargeLanguageModel

ROOT = Path(__file__).resolve().parents[1]


def _schema(model: str, features: list[ModelFeature]) -> AIModelEntity:
    return AIModelEntity(
        model=model,
        label=I18nObject(en_US=model),
        model_type=ModelType.LLM,
        features=features,
        model_properties={"mode": "chat", "context_size": 4096},
    )


def test_catalog_files_and_parameter_rules_are_consistent() -> None:
    directory = ROOT / "models" / "llm"
    assert not list(directory.glob("*.yaml"))
    assert (ROOT / "model_catalog.py").is_file()


@patch("models.llm.llm.discover_models")
def test_new_model_schema_is_resolved_from_current_remote_data(discover) -> None:
    discover.return_value = parse_catalog({"data": [{
        "id": "future-model", "architecture": {"input_modalities": ["text", "image"],
                                                "output_modalities": ["text"]},
        "context_length": 99999, "supported_parameters": ["max_tokens"],
        "providers": [{"vision": True}],
    }]})
    model = AMDGPUCloudLargeLanguageModel(model_schemas=[])
    schema = model.get_model_schema("future-model", {"api_key": "rc-fixture"})
    assert schema is not None
    assert schema.model == "future-model"
    assert ModelFeature.VISION in schema.features
    assert schema.model_dump(mode="json")["model_properties"]["context_size"] == 99999


@patch.object(OAICompatLargeLanguageModel, "_invoke", return_value="llm-result")
def test_invoke_uses_fixed_endpoint_source_and_tool_features(invoke) -> None:
    model = AMDGPUCloudLargeLanguageModel(
        model_schemas=[
            _schema(
                "tool-model",
                [
                    ModelFeature.AGENT_THOUGHT,
                    ModelFeature.TOOL_CALL,
                    ModelFeature.STREAM_TOOL_CALL,
                ],
            )
        ]
    )
    credentials = {
        "api_key": "  rc-test  ",
        "endpoint_url": "https://attacker.example/v1",
        "extra_headers": {"X-Custom": "kept", "x-source": "spoofed"},
    }

    result = model._invoke(
        model="tool-model",
        credentials=credentials,
        prompt_messages=[],
        model_parameters={},
        stream=False,
    )

    assert result == "llm-result"
    assert credentials["endpoint_url"] == "https://attacker.example/v1"
    resolved = invoke.call_args.kwargs["credentials"]
    assert resolved == {
        **credentials,
        "api_key": "rc-test",
        "endpoint_url": ENDPOINT_URL,
        "mode": "chat",
        "extra_headers": {"X-Custom": "kept", "X-Source": "dify"},
        "_current_model": "tool-model",
        "function_calling_type": "tool_call",
        "stream_function_calling": "supported",
    }


def test_non_stream_reasoning_round_trips_through_history() -> None:
    entity = _schema("DeepSeek-test", [ModelFeature.AGENT_THOUGHT])
    model = AMDGPUCloudLargeLanguageModel(model_schemas=[entity])
    response = Mock()
    response.json.return_value = {
        "id": "chatcmpl-1",
        "model": "DeepSeek-test",
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": "answer",
                    "reasoning_content": "must preserve </think> & exactly",
                },
            }
        ],
        "usage": {"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3},
    }
    credentials = {"mode": "chat", "_current_model": "DeepSeek-test"}

    result = model._handle_generate_response(
        "DeepSeek-test",
        credentials,
        response,
        [UserPromptMessage(content="hi")],
    )
    assert isinstance(result.message.opaque_body, dict)
    assert result.message.opaque_body["reasoning_content"] == "must preserve </think> & exactly"

    payload = model._convert_prompt_message_to_dict(result.message, credentials)
    assert payload["content"] == "answer"
    assert payload["reasoning_content"] == "must preserve </think> & exactly"

    restored = AssistantPromptMessage(content=result.message.content)
    restored_payload = model._convert_prompt_message_to_dict(restored, credentials)
    assert restored_payload["content"] == "answer"
    assert restored_payload["reasoning_content"] == "must preserve </think> & exactly"


def test_stream_reasoning_marker_escapes_literal_think_tags() -> None:
    model = AMDGPUCloudLargeLanguageModel(model_schemas=[])
    opening, active = model._wrap_thinking_by_reasoning_content(
        {"reasoning_content": "before </think> & after"},
        False,
    )
    closing, active = model._wrap_thinking_by_reasoning_content(
        {"content": "answer"},
        active,
    )

    answer, reasoning = model._extract_reasoning_content(opening + closing)
    assert active is False
    assert answer == "answer"
    assert reasoning == "before </think> & after"


def test_renamed_provider_reads_legacy_reasoning_but_writes_only_new_marker() -> None:
    entity = _schema("DeepSeek-test", [ModelFeature.AGENT_THOUGHT])
    model = AMDGPUCloudLargeLanguageModel(model_schemas=[entity])
    message = AssistantPromptMessage(
        content="<think>\n<!--dify-radeon-reasoning-->old &amp; reasoning\n</think>answer"
    )
    result = model._convert_prompt_message_to_dict(message, {"_current_model": "DeepSeek-test"})
    assert result["content"] == "answer"
    assert result["reasoning_content"] == "old & reasoning"
    wrapped, _ = model._wrap_thinking_by_reasoning_content({"reasoning_content": "new"}, False)
    assert "<!--dify-amdgpucloud-reasoning-->" in wrapped
    assert "<!--dify-radeon-reasoning-->" not in wrapped