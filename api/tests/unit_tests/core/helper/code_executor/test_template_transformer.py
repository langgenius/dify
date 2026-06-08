import json
from base64 import b64decode
from collections.abc import Mapping
from typing import Any

import pytest

from core.helper.code_executor.template_transformer import TemplateTransformer


class _DummyTransformer(TemplateTransformer):
    @classmethod
    def get_runner_script(cls) -> str:
        return f"CODE={cls._code_placeholder};INPUTS={cls._inputs_placeholder}"


def test_serialize_code_encodes_to_base64() -> None:
    encoded = _DummyTransformer.serialize_code("print('hi')")

    assert b64decode(encoded.encode()).decode() == "print('hi')"


def test_assemble_runner_script_embeds_code_and_inputs() -> None:
    script = _DummyTransformer.assemble_runner_script("x = 1", {"a": "b"})

    assert "CODE=x = 1" in script
    payload = script.split("INPUTS=", maxsplit=1)[1]
    assert json.loads(b64decode(payload.encode()).decode()) == {"a": "b"}


def test_transform_caller_returns_runner_and_empty_preload() -> None:
    runner, preload = _DummyTransformer.transform_caller("x = 2", {"k": "v"})

    assert "CODE=x = 2" in runner
    assert preload == ""


def test_serialize_inputs_encodes_payload() -> None:
    payload = _DummyTransformer.serialize_inputs({"foo": "bar"})

    assert json.loads(b64decode(payload.encode()).decode()) == {"foo": "bar"}


def test_transform_response_parses_json_result_and_converts_scientific_notation() -> None:
    response = '<<RESULT>>{"value": "1e+3", "nested": {"x": "2E-2"}, "arr": ["3e+1"]}<<RESULT>>'

    result: Mapping[str, Any] = _DummyTransformer.transform_response(response)

    assert result == {"value": 1000.0, "nested": {"x": 0.02}, "arr": [30.0]}


def test_transform_response_raises_for_invalid_json() -> None:
    with pytest.raises(ValueError, match="Failed to parse JSON response"):
        _DummyTransformer.transform_response("<<RESULT>>{invalid json}<<RESULT>>")


def test_transform_response_raises_for_non_dict_result() -> None:
    with pytest.raises(ValueError, match="Result must be a dict"):
        _DummyTransformer.transform_response("<<RESULT>>[1,2,3]<<RESULT>>")


def test_transform_response_raises_for_non_string_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("json.loads", lambda _: {1: "x"})

    with pytest.raises(ValueError, match="Result keys must be strings"):
        _DummyTransformer.transform_response('<<RESULT>>{"ignored": true}<<RESULT>>')


def test_transform_response_raises_for_unexpected_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise_unexpected(_: str) -> Any:
        raise RuntimeError("boom")

    monkeypatch.setattr("json.loads", _raise_unexpected)

    with pytest.raises(ValueError, match="Unexpected error during response transformation"):
        _DummyTransformer.transform_response('<<RESULT>>{"a":1}<<RESULT>>')


def test_transform_response_raises_for_missing_result_tag() -> None:
    with pytest.raises(ValueError, match="no result tag found"):
        _DummyTransformer.transform_response("plain output")
