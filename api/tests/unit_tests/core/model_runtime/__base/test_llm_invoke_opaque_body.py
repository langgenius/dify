from __future__ import annotations

from datetime import datetime
from typing import Any
from unittest.mock import patch

from core.model_runtime.callbacks.base_callback import Callback
from core.model_runtime.entities.common_entities import I18nObject
from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta
from core.model_runtime.entities.message_entities import AssistantPromptMessage, PromptMessage, UserPromptMessage
from core.model_runtime.entities.model_entities import ModelType
from core.model_runtime.entities.provider_entities import ConfigurateMethod, ProviderEntity
from core.model_runtime.model_providers.__base.large_language_model import LargeLanguageModel
from core.plugin.entities.plugin_daemon import PluginModelProviderEntity


class _CaptureAfterInvokeCallback(Callback):
    after_result: LLMResult | None

    def __init__(self) -> None:
        self.after_result = None

    def on_before_invoke(self, **kwargs: Any) -> None:  # noqa: ANN401
        return None

    def on_new_chunk(self, **kwargs: Any) -> None:  # noqa: ANN401
        return None

    def on_after_invoke(self, result: LLMResult, **kwargs: Any) -> None:  # noqa: ANN401
        self.after_result = result

    def on_invoke_error(self, **kwargs: Any) -> None:  # noqa: ANN401
        return None


def _build_llm_instance() -> LargeLanguageModel:
    declaration = ProviderEntity(
        provider="test",
        label=I18nObject(en_US="test"),
        supported_model_types=[ModelType.LLM],
        configurate_methods=[ConfigurateMethod.PREDEFINED_MODEL],
    )
    plugin_model_provider = PluginModelProviderEntity(
        id="pmp_1",
        created_at=datetime.now(),
        updated_at=datetime.now(),
        provider="test",
        tenant_id="tenant_1",
        plugin_unique_identifier="test/plugin",
        plugin_id="test/plugin",
        declaration=declaration,
    )

    return LargeLanguageModel(
        tenant_id="tenant_1",
        plugin_id="test/plugin",
        provider_name="test",
        plugin_model_provider=plugin_model_provider,
    )


def test_invoke_non_stream_preserves_assistant_opaque_body() -> None:
    llm = _build_llm_instance()
    prompt_messages: list[PromptMessage] = [UserPromptMessage(content="hi")]

    chunk = LLMResultChunk(
        model="gpt-test",
        prompt_messages=[],
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="hello", opaque_body={"provider_message_id": "msg_123"}),
        ),
    )

    def _mock_invoke_llm(self, **kwargs: Any):  # noqa: ANN001, ANN401
        yield chunk

    with patch("core.plugin.impl.model.PluginModelClient.invoke_llm", new=_mock_invoke_llm):
        result = llm.invoke(
            model="gpt-test",
            credentials={},
            prompt_messages=prompt_messages,
            model_parameters={},
            stream=False,
        )

    assert isinstance(result, LLMResult)
    assert result.message.opaque_body == {"provider_message_id": "msg_123"}
    assert list(result.prompt_messages) == prompt_messages


def test_invoke_stream_preserves_assistant_opaque_body_in_after_callback() -> None:
    llm = _build_llm_instance()
    prompt_messages: list[PromptMessage] = [UserPromptMessage(content="hi")]
    callback = _CaptureAfterInvokeCallback()

    tool_call_1 = AssistantPromptMessage.ToolCall(
        id="1",
        type="function",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="func_foo", arguments='{"arg1": '),
    )
    tool_call_2 = AssistantPromptMessage.ToolCall(
        id="",
        type="",
        function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments='"value"}'),
    )

    chunk1 = LLMResultChunk(
        model="gpt-test",
        prompt_messages=[],
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="h", tool_calls=[tool_call_1], opaque_body={"provider_message_id": "msg_123"}),
        ),
    )
    chunk2 = LLMResultChunk(
        model="gpt-test",
        prompt_messages=[],
        delta=LLMResultChunkDelta(
            index=0,
            message=AssistantPromptMessage(content="i", tool_calls=[tool_call_2]),
        ),
    )

    def _mock_invoke_llm(self, **kwargs: Any):  # noqa: ANN001, ANN401
        yield chunk1
        yield chunk2

    with patch("core.plugin.impl.model.PluginModelClient.invoke_llm", new=_mock_invoke_llm):
        gen = llm.invoke(
            model="gpt-test",
            credentials={},
            prompt_messages=prompt_messages,
            model_parameters={},
            stream=True,
            callbacks=[callback],
        )
        chunks = list(gen)

    assert chunks[0].prompt_messages == prompt_messages
    assert callback.after_result is not None
    assert callback.after_result.message.opaque_body == {"provider_message_id": "msg_123"}
    assert len(callback.after_result.message.tool_calls) == 1
    assert callback.after_result.message.tool_calls[0].function.arguments == '{"arg1": "value"}'

