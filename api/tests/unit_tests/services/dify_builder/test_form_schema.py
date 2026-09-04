from services.dify_builder.agent.form_schema import reconcile_form_fields


def test_reconciles_all_concrete_json_value_types():
    fields = [
        {"key": "enabled", "type": "text"},
        {"key": "count", "type": "text"},
        {"key": "ratio", "type": "text"},
        {"key": "config", "type": "text"},
        {"key": "tags", "type": "text"},
    ]
    values = {
        "enabled": False,
        "count": 0,
        "ratio": 0.5,
        "config": {},
        "tags": [],
    }

    reconciled = reconcile_form_fields(fields, values)

    assert [field["type"] for field in reconciled] == [
        "bool",
        "number",
        "number",
        "json_object",
        "json",
    ]
    assert fields == [
        {"key": "enabled", "type": "text"},
        {"key": "count", "type": "text"},
        {"key": "ratio", "type": "text"},
        {"key": "config", "type": "text"},
        {"key": "tags", "type": "text"},
    ]


def test_string_values_only_keep_string_compatible_field_types():
    fields = [
        {"key": "title", "type": "textarea"},
        {"key": "mode", "type": "select", "options": ["fast"]},
        {"key": "looks_boolean", "type": "bool"},
        {"key": "looks_numeric", "type": "number"},
    ]
    values = {
        "title": "Summary",
        "mode": "safe",
        "looks_boolean": "true",
        "looks_numeric": "3",
    }

    reconciled = reconcile_form_fields(fields, values)

    assert [field["type"] for field in reconciled] == ["textarea", "select", "text", "text"]
    assert reconciled[1]["options"] == ["fast", "safe"]


def test_select_does_not_duplicate_known_value_after_option_stringification():
    fields = [{"key": "choice", "type": "select", "options": [1, "2"]}]

    reconciled = reconcile_form_fields(fields, {"choice": "1"})

    assert reconciled[0]["options"] == [1, "2"]


def test_missing_and_null_values_do_not_override_declared_type():
    marker = "not-a-field"
    fields = [
        {"key": "missing", "type": "number"},
        {"key": "empty", "type": "json_object"},
        marker,
    ]

    reconciled = reconcile_form_fields(fields, {"empty": None})

    assert reconciled == fields
