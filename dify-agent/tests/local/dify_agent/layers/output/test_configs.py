import pytest
from pydantic import JsonValue, TypeAdapter, ValidationError
from pydantic_ai.output import ToolOutput

import dify_agent.layers.output as output_exports
from dify_agent.layers.output import DIFY_OUTPUT_LAYER_TYPE_ID, DifyOutputLayerConfig
from dify_agent.layers.output.output_layer import DifyOutputLayer


def _json_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "severity": {"type": "string", "enum": ["low", "medium", "high"]},
            "actions": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["title", "severity", "actions"],
        "additionalProperties": False,
    }


def _recursive_json_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {"node": {"$ref": "#/$defs/node"}},
        "$defs": {
            "node": {
                "type": "object",
                "properties": {"child": {"$ref": "#/$defs/node"}},
                "additionalProperties": False,
            }
        },
        "additionalProperties": False,
    }


def _remote_ref_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "title": {"$ref": "https://example.com/schema.json"},
        },
    }


def _literal_dollar_ref_value_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "payload": {
                "const": {
                    "$ref": "https://example.com/literal",
                    "kind": "literal",
                },
            },
            "metadata": {
                "type": "object",
                "examples": [
                    {
                        "$ref": "https://example.com/example",
                        "note": "example value",
                    }
                ],
            },
        },
        "required": ["payload", "metadata"],
        "additionalProperties": False,
    }


def _object_local_definitions_ref_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "items": {"$ref": "#/definitions/itemArray"},
        },
        "required": ["items"],
        "definitions": {
            "itemArray": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
    }


def _object_local_defs_ref_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "items": {"$ref": "#/$defs/itemArray"},
        },
        "required": ["items"],
        "$defs": {
            "itemArray": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
    }


def _invalid_json_schema() -> dict[str, JsonValue]:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "wat"},
        },
    }


def _validated_output_type(output_spec: object) -> object:
    assert isinstance(output_spec, ToolOutput)
    return output_spec.output


def test_output_package_exports_client_safe_config_symbols_only() -> None:
    assert output_exports.__all__ == ["DIFY_OUTPUT_LAYER_TYPE_ID", "DifyOutputLayerConfig"]
    assert output_exports.DIFY_OUTPUT_LAYER_TYPE_ID == "dify.output"
    assert not hasattr(output_exports, "DifyOutputLayer")


def test_output_layer_config_accepts_valid_object_schema_and_defaults_name() -> None:
    config = DifyOutputLayerConfig(json_schema=_json_schema())

    assert DIFY_OUTPUT_LAYER_TYPE_ID == "dify.output"
    assert config.name == "final_result"
    assert config.description is None
    assert config.strict is None


def test_output_layer_config_rejects_non_object_top_level_json_schema() -> None:
    with pytest.raises(ValidationError, match="Schema must declare an object output"):
        _ = DifyOutputLayerConfig(json_schema={"type": "array", "items": {"type": "string"}})


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"json_schema": _json_schema(), "name": "bad name"}, "letters, numbers, underscores, or hyphens"),
        ({"json_schema": _json_schema(), "unknown": True}, "Extra inputs are not permitted"),
    ],
)
def test_output_layer_config_rejects_invalid_input(payload: dict[str, object], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        _ = DifyOutputLayerConfig.model_validate(payload)


def test_output_layer_builds_validated_output_contract_for_object_schema() -> None:
    config = DifyOutputLayerConfig(
        json_schema=_json_schema(),
        name="incident_summary",
        description="Structured incident summary.",
        strict=True,
    )

    layer = DifyOutputLayer.from_config(config)
    output_contract = layer.build_output_contract()
    output_type = output_contract.output_type
    output_schema = TypeAdapter(output_type.output).json_schema() if isinstance(output_type, ToolOutput) else {}
    valid_output = {"title": "Database outage", "severity": "high", "actions": ["page on-call"]}
    output_adapter = TypeAdapter(_validated_output_type(output_contract.output_type))

    assert isinstance(output_type, ToolOutput)
    assert output_type.name == "incident_summary"
    assert output_type.description is None
    assert output_type.strict is True
    assert output_schema["type"] == "object"
    assert output_schema["title"] == "incident_summary"
    assert output_schema["description"] == "Structured incident summary."
    assert output_adapter.validate_python(valid_output) == valid_output


@pytest.mark.parametrize(
    ("invalid_output", "message"),
    [
        (
            {"title": "Database outage", "severity": "high", "actions": "page on-call"},
            "Output does not match JSON Schema",
        ),
        ({"title": "Database outage", "actions": []}, "Output does not match JSON Schema"),
        ({"title": "Database outage", "severity": "urgent", "actions": []}, "Output does not match JSON Schema"),
        (
            {"title": "Database outage", "severity": "high", "actions": [], "extra": True},
            "Output does not match JSON Schema",
        ),
    ],
)
def test_output_layer_object_contract_retries_invalid_model_output(invalid_output: JsonValue, message: str) -> None:
    output_contract = DifyOutputLayer.from_config(
        DifyOutputLayerConfig(json_schema=_json_schema())
    ).build_output_contract()
    output_adapter = TypeAdapter(_validated_output_type(output_contract.output_type))

    with pytest.raises(ValidationError, match=message):
        _ = output_adapter.validate_python(invalid_output)


def test_output_layer_rejects_non_defs_local_ref_in_direct_object_schema() -> None:
    layer = DifyOutputLayer.from_config(DifyOutputLayerConfig(json_schema=_object_local_definitions_ref_schema()))

    with pytest.raises(ValueError, match=r"Only local refs under '#/\$defs/' are supported"):
        _ = layer.build_output_contract()


def test_output_layer_keeps_local_defs_ref_working_in_direct_object_schema() -> None:
    output_contract = DifyOutputLayer.from_config(
        DifyOutputLayerConfig(json_schema=_object_local_defs_ref_schema(), name="direct_defs_result")
    ).build_output_contract()
    output_adapter = TypeAdapter(_validated_output_type(output_contract.output_type))
    output_schema = output_adapter.json_schema()

    assert isinstance(output_contract.output_type, ToolOutput)
    assert output_schema == {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": ["items"],
        "title": "direct_defs_result",
    }
    assert output_adapter.validate_python({"items": ["a", "b"]}) == {"items": ["a", "b"]}


def test_output_layer_rejects_recursive_json_schema_during_contract_build() -> None:
    layer = DifyOutputLayer.from_config(DifyOutputLayerConfig(json_schema=_recursive_json_schema()))

    with pytest.raises(ValueError):
        _ = layer.build_output_contract()


def test_output_layer_rejects_invalid_json_schema_during_contract_build() -> None:
    layer = DifyOutputLayer.from_config(DifyOutputLayerConfig(json_schema=_invalid_json_schema()))

    with pytest.raises(ValueError):
        _ = layer.build_output_contract()


def test_output_layer_rejects_remote_ref_during_contract_build() -> None:
    layer = DifyOutputLayer.from_config(DifyOutputLayerConfig(json_schema=_remote_ref_schema()))

    with pytest.raises(ValueError, match=r"Remote \$ref values are not supported"):
        _ = layer.build_output_contract()


def test_output_layer_allows_literal_dollar_ref_values_under_const_and_examples() -> None:
    layer = DifyOutputLayer.from_config(DifyOutputLayerConfig(json_schema=_literal_dollar_ref_value_schema()))

    output_contract = layer.build_output_contract()
    output_adapter = TypeAdapter(_validated_output_type(output_contract.output_type))

    assert output_adapter.validate_python(
        {
            "payload": {
                "$ref": "https://example.com/literal",
                "kind": "literal",
            },
            "metadata": {"note": "runtime value"},
        }
    ) == {
        "payload": {
            "$ref": "https://example.com/literal",
            "kind": "literal",
        },
        "metadata": {"note": "runtime value"},
    }
