import pytest

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
