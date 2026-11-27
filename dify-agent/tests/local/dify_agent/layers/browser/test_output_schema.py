from __future__ import annotations

import pytest

from dify_agent.layers.browser.output_schema import OutputSchemaError, build_output_model


def test_builds_typed_model_from_object_schema() -> None:
    model = build_output_model(
        {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "price": {"type": "number"},
                "in_stock": {"type": "boolean", "default": True},
                "count": {"type": "integer"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title", "price"],
        }
    )
    result = model(title="Example Domain", price=19.5)
    assert result.title == "Example Domain"
    assert result.price == 19.5
    assert result.in_stock is True
    assert result.count is None
    assert result.tags is None


def test_builds_nested_objects_and_enums() -> None:
    model = build_output_model(
        {
            "type": "object",
            "properties": {
                "origin": {
                    "type": "object",
                    "properties": {"city": {"type": "string"}},
                    "required": ["city"],
                },
                "status": {"type": "string", "enum": ["ok", "error"]},
            },
            "required": ["origin", "status"],
        }
    )
    result = model(origin={"city": "New York"}, status="ok")
    assert result.origin.city == "New York"
    assert result.status == "ok"
    with pytest.raises(Exception):
        model(origin={"city": "New York"}, status="maybe")  # type: ignore[arg-type]


def test_optional_fields_default_to_none_and_reject_extra_keys() -> None:
    model = build_output_model(
        {
            "type": "object",
            "properties": {"note": {"type": "string", "description": "free text"}},
        }
    )
    result = model()
    assert result.note is None
    assert model.model_fields["note"].description == "free text"
    with pytest.raises(Exception):
        model(**{"surprise": 1})  # type: ignore[call-arg]


def test_untyped_property_becomes_any() -> None:
    model = build_output_model({"type": "object", "properties": {"raw": {}}})
    result = model(raw={"anything": [1, 2]})
    assert result.raw == {"anything": [1, 2]}


def test_rejects_non_object_top_level() -> None:
    with pytest.raises(OutputSchemaError, match="JSON object with 'properties'"):
        build_output_model({"type": "string"})
    with pytest.raises(OutputSchemaError, match="JSON object"):
        build_output_model(42)


def test_rejects_structural_composition() -> None:
    for fragment in ({"$ref": "#"}, {"anyOf": []}, {"oneOf": []}, {"pattern": "x"}):
        schema = {"type": "object", "properties": {"a": {"type": "string", **{k: v for k, v in fragment.items()}}}}
        with pytest.raises(OutputSchemaError, match="not supported"):
            build_output_model(schema)


def test_rejects_type_lists_and_bad_identifiers() -> None:
    with pytest.raises(OutputSchemaError, match="list of 'type'"):
        build_output_model({"type": "object", "properties": {"a": {"type": ["string", "null"]}}})
    with pytest.raises(OutputSchemaError, match="Python identifiers"):
        build_output_model({"type": "object", "properties": {"9lives": {"type": "string"}}})


def test_rejects_unknown_required_entries_and_deep_nesting() -> None:
    with pytest.raises(OutputSchemaError, match="not a declared property"):
        build_output_model({"type": "object", "properties": {"a": {"type": "string"}}, "required": ["zz"]})
    deep: dict = {"type": "string"}
    for _ in range(20):
        deep = {"type": "object", "properties": {"child": deep}, "required": ["child"]}
    with pytest.raises(OutputSchemaError, match="too deep"):
        build_output_model(deep)
