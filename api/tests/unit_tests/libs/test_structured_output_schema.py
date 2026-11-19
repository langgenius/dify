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
