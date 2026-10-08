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


def test_build_form_fields_carries_the_hint_that_explains_a_blank_field():
    """A requirements field left blank on purpose has to say why, or the user
    sees an unexplained empty box (PM report 2026-09-29). ``testdata_form_fields``
    already carries a hint; this form dropped it on the floor."""
    fields = build_form_fields(
        [{"key": "bocha_api_key", "label": "博查 API 密钥", "type": "text", "hint": "Not stated in your request."}]
    )

    assert fields[0].hint == "Not stated in your request."
