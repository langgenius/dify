import json

from services.dify_builder.agent import mock_inputs


class _Msg:
    def __init__(self, t):
        self._t = t

    def get_text_content(self):
        return self._t


class _Result:
    def __init__(self, t):
        self.message = _Msg(t)


class _FakeInstance:
    def __init__(self, replies):
        self._r = list(replies)

    def invoke_llm(self, **_kwargs):
        return _Result(self._r.pop(0))


class _BoomInstance:
    def invoke_llm(self, **_kwargs):
        raise RuntimeError("provider down")


_SCHEMA = {
    "variables": [
        {"variable": "query", "type": "text-input"},
        {"variable": "count", "type": "number"},
    ]
}


def test_generate_uses_llm_values_keyed_by_variable():
    m = _FakeInstance([json.dumps({"inputs": {"query": "hello", "count": 3}})])
    assert mock_inputs.generate(m, _SCHEMA, {}) == {"query": "hello", "count": 3}


def test_generate_degrades_to_typed_defaults_on_boom():
    out = mock_inputs.generate(_BoomInstance(), _SCHEMA, {})
    assert set(out.keys()) == {"query", "count"}
    assert isinstance(out["query"], str)
    assert isinstance(out["count"], int | float)


def test_generate_degrades_on_none_model():
    out = mock_inputs.generate(None, _SCHEMA, {})
    assert set(out.keys()) == {"query", "count"}


def test_generate_empty_schema_is_empty_inputs():
    assert mock_inputs.generate(None, {"variables": []}, {}) == {}
