from core.dify_builder.handlers_fix import build_form_fields


def test_build_form_fields_preserves_supported_scalar_and_json_types():
    fields = build_form_fields(
        [
            {"key": "enabled", "type": "bool"},
            {"key": "count", "type": "number"},
            {"key": "items", "type": "json"},
            {"key": "config", "type": "json_object"},
        ]
    )

    assert [field.type for field in fields] == ["bool", "number", "json", "json_object"]
