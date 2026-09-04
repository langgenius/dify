import pytest

from graphon.model_runtime.entities.llm_entities import LLMResult, LLMResultChunk, LLMResultChunkDelta, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from services.dify_builder.agent import llm


class _Msg:
    def __init__(self, text):
        self._t = text

    def get_text_content(self):
        return self._t


class _Result:
    def __init__(self, text):
        self.message = _Msg(text)


class _FakeInstance:
    def __init__(self, replies):
        self._replies = list(replies)
        self.calls = []

    def invoke_llm(self, *, prompt_messages, model_parameters=None, stop=None, stream=True, **kw):  # noqa: ARG002
        self.calls.append(prompt_messages)
        return _Result(self._replies.pop(0))


def test_invoke_text_returns_completion():
    inst = _FakeInstance(["hello world"])
    assert llm.invoke_text(inst, system="s", user="u") == "hello world"
    assert len(inst.calls) == 1


def test_invoke_text_stream_yields_model_deltas():
    chunks = [
        LLMResultChunk(
            model="model",
            prompt_messages=[],
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=delta),
            ),
        )
        for delta in ("hello ", "world")
    ]

    class _StreamingInstance:
        def invoke_llm(self, **_kwargs):
            return iter(chunks)

    assert list(llm.invoke_text_stream(_StreamingInstance(), system="s", user="u")) == [
        "hello ",
        "world",
    ]


def test_invoke_text_stream_routes_split_think_tags_to_reasoning_callback():
    chunks = [
        LLMResultChunk(
            model="model",
            prompt_messages=[],
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(content=delta),
            ),
        )
        for delta in ("<thi", "nk>plan ", "carefully</think>answer")
    ]

    class _StreamingInstance:
        def invoke_llm(self, **_kwargs):
            return iter(chunks)

    reasoning: list[str] = []
    answer = "".join(
        llm.invoke_text_stream(
            _StreamingInstance(),
            system="s",
            user="u",
            on_reasoning=reasoning.append,
        )
    )

    assert answer == "answer"
    assert "".join(reasoning) == "plan carefully"


def test_invoke_text_routes_native_reasoning_separately_from_answer():
    result = LLMResult(
        model="model",
        message=AssistantPromptMessage(content="answer"),
        usage=LLMUsage.empty_usage(),
        reasoning_content="consider the workflow",
    )

    class _NativeReasoningInstance:
        def invoke_llm(self, **_kwargs):
            return result

    reasoning: list[str] = []
    answer = llm.invoke_text(
        _NativeReasoningInstance(),
        system="s",
        user="u",
        on_reasoning=reasoning.append,
    )

    assert answer == "answer"
    assert reasoning == ["consider the workflow"]


def test_invoke_json_clean():
    inst = _FakeInstance(['{"a": 1}'])
    assert llm.invoke_json(inst, system="s", user="u") == {"a": 1}
    assert len(inst.calls) == 1


def test_invoke_json_repairs_without_retry():
    inst = _FakeInstance(['{"a": 1,}'])  # trailing comma -> json_repair fixes it
    assert llm.invoke_json(inst, system="s", user="u") == {"a": 1}
    assert len(inst.calls) == 1


def test_invoke_json_retries_once_then_succeeds():
    inst = _FakeInstance(["not json at all", '{"b": 2}'])
    assert llm.invoke_json(inst, system="s", user="u") == {"b": 2}
    assert len(inst.calls) == 2


def test_invoke_json_raises_after_failed_retry():
    inst = _FakeInstance(["nope", "still nope"])
    with pytest.raises(llm.LlmError):
        llm.invoke_json(inst, system="s", user="u")
    assert len(inst.calls) == 2
