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


def test_transform_response_parses_json_result_and_converts_scientific_notation() -> None:
    response = "<<RESULT>>{\"value\": \"1e+3\", \"nested\": {\"x\": \"2E-2\"}}<<RESULT>>"

    result: Mapping[str, Any] = _DummyTransformer.transform_response(response)

    assert result == {"value": 1000.0, "nested": {"x": 0.02}}


def test_transform_response_raises_for_missing_result_tag() -> None:
    with pytest.raises(ValueError, match="no result tag found"):
        _DummyTransformer.transform_response("plain output")

