from core.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from core.model_runtime.entities.message_entities import (
    AssistantPromptMessage,
    TextPromptMessageContent,
    UserPromptMessage,
)
from core.model_runtime.model_providers.__base.large_language_model import _normalize_non_stream_plugin_result


def _make_chunk(
    *,
    model: str = "test-model",
    content: str | list[TextPromptMessageContent] | None,
    tool_calls: list[AssistantPromptMessage.ToolCall] | None = None,
    usage: LLMUsage | None = None,
    system_fingerprint: str | None = None,
) -> LLMResultChunk:
    message = AssistantPromptMessage(content=content, tool_calls=tool_calls or [])
    delta = LLMResultChunkDelta(index=0, message=message, usage=usage)
    return LLMResultChunk(model=model, delta=delta, system_fingerprint=system_fingerprint)


def test__normalize_non_stream_plugin_result__from_first_chunk_str_content_and_tool_calls():
    prompt_messages = [UserPromptMessage(content="hi")]

    tool_calls = [
        AssistantPromptMessage.ToolCall(
            id="1",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="func_foo", arguments=""),
        ),
        AssistantPromptMessage.ToolCall(
            id="",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments='{"arg1": '),
        ),
        AssistantPromptMessage.ToolCall(
            id="",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="", arguments='"value"}'),
        ),
    ]

    usage = LLMUsage.empty_usage().model_copy(update={"prompt_tokens": 1, "total_tokens": 1})
    chunk = _make_chunk(content="hello", tool_calls=tool_calls, usage=usage, system_fingerprint="fp-1")

    result = _normalize_non_stream_plugin_result(
        model="test-model", prompt_messages=prompt_messages, result=iter([chunk])
    )

    assert result.model == "test-model"
    assert result.prompt_messages == prompt_messages
    assert result.message.content == "hello"
    assert result.usage.prompt_tokens == 1
    assert result.system_fingerprint == "fp-1"
    assert result.message.tool_calls == [
        AssistantPromptMessage.ToolCall(
            id="1",
            type="function",
            function=AssistantPromptMessage.ToolCall.ToolCallFunction(name="func_foo", arguments='{"arg1": "value"}'),
        )
    ]


def test__normalize_non_stream_plugin_result__from_first_chunk_list_content():
    prompt_messages = [UserPromptMessage(content="hi")]

    content_list = [TextPromptMessageContent(data="a"), TextPromptMessageContent(data="b")]
    chunk = _make_chunk(content=content_list, usage=LLMUsage.empty_usage())

    result = _normalize_non_stream_plugin_result(
        model="test-model", prompt_messages=prompt_messages, result=iter([chunk])
    )

    assert result.message.content == content_list


def test__normalize_non_stream_plugin_result__passthrough_llm_result():
    prompt_messages = [UserPromptMessage(content="hi")]
    llm_result = LLMResult(
        model="test-model",
        prompt_messages=prompt_messages,
        message=AssistantPromptMessage(content="ok"),
        usage=LLMUsage.empty_usage(),
    )

    assert (
        _normalize_non_stream_plugin_result(model="test-model", prompt_messages=prompt_messages, result=llm_result)
        == llm_result
    )


def test__normalize_non_stream_plugin_result__empty_iterator_defaults():
    prompt_messages = [UserPromptMessage(content="hi")]

    result = _normalize_non_stream_plugin_result(model="test-model", prompt_messages=prompt_messages, result=iter([]))

    assert result.model == "test-model"
    assert result.prompt_messages == prompt_messages
    assert result.message.content == []
    assert result.message.tool_calls == []
    assert result.usage == LLMUsage.empty_usage()
    assert result.system_fingerprint is None
