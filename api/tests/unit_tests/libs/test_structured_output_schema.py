from copy import deepcopy

import pytest
from pydantic import BaseModel, Field

from libs.structured_output_schema import to_strict_json_schema


def test_to_strict_json_schema_normalizes_nested_objects_without_mutating_input() -> None:
    schema = {
        "$defs": {
            "Verdict": {
                "type": "object",
                "properties": {
                    "verdict": {"type": "string"},
                    "reason": {
                        "anyOf": [{"type": "string"}, {"type": "null"}],
                        "default": None,
                    },
                },
                "required": ["verdict"],
            }
        },
        "type": "object",
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {"$ref": "#/$defs/Verdict"},
            }
        },
        "required": ["verdicts"],
    }

    strict_schema = to_strict_json_schema(schema)

    assert "additionalProperties" not in schema
    assert "additionalProperties" not in schema["$defs"]["Verdict"]
    assert schema["$defs"]["Verdict"]["properties"]["reason"]["default"] is None

    assert strict_schema["additionalProperties"] is False
    assert strict_schema["required"] == ["verdicts"]
    strict_verdict = strict_schema["$defs"]["Verdict"]
    assert strict_verdict["additionalProperties"] is False
    assert strict_verdict["required"] == ["verdict", "reason"]
    assert "default" not in strict_verdict["properties"]["reason"]
    assert strict_verdict["properties"]["reason"]["anyOf"] == [
        {"type": "string"},
        {"type": "null"},
    ]


def test_to_strict_json_schema_preserves_pydantic_example_values() -> None:
    example = {"type": "object", "default": None, "properties": {"name": "data"}}

    class JudgeResponse(BaseModel):
        payload: dict[str, object] = Field(examples=[example])

    schema = JudgeResponse.model_json_schema()
    original = deepcopy(schema)

    strict_schema = to_strict_json_schema(schema)

    assert strict_schema["properties"]["payload"]["examples"] == [example]
    assert strict_schema["properties"]["payload"]["additionalProperties"] is False
    assert schema == original


@pytest.mark.parametrize("keyword", ["const", "enum", "default", "examples"])
def test_to_strict_json_schema_preserves_literal_objects(keyword: str) -> None:
    literal = {"type": "object", "default": None, "properties": {"name": {"type": "string"}}}
    value = [literal] if keyword in {"enum", "examples"} else literal
    schema = {"type": "object", "properties": {"payload": {"type": "object", keyword: value}}}

    strict_schema = to_strict_json_schema(schema)

    assert strict_schema["properties"]["payload"][keyword] == value


@pytest.mark.parametrize("property_name", ["const", "enum", "default", "examples"])
def test_to_strict_json_schema_visits_keyword_named_properties(property_name: str) -> None:
    nested = {
        "type": "object",
        "properties": {"reason": {"anyOf": [{"type": "string"}, {"type": "null"}], "default": None}},
    }
    schema = {"type": "object", "properties": {property_name: nested}}

    strict_schema = to_strict_json_schema(schema)

    strict_nested = strict_schema["properties"][property_name]
    assert strict_nested["additionalProperties"] is False
    assert strict_nested["required"] == ["reason"]
    assert "default" not in strict_nested["properties"]["reason"]
