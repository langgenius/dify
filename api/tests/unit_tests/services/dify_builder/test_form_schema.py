from core.dify_builder.models import Graph
from services.dify_builder.agent.form_schema import reconcile_form_fields


def test_reconciles_all_concrete_json_value_types() -> None:
    fields = [
        {"key": "enabled", "type": "text"},
        {"key": "count", "type": "text"},
        {"key": "ratio", "type": "text"},
        {"key": "config", "type": "text"},
        {"key": "tags", "type": "text"},
    ]
    values: Graph = {
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


def test_missing_and_null_values_do_not_override_declared_type() -> None:
    marker = "not-a-field"
    fields = [
        {"key": "missing", "type": "number"},
        {"key": "empty", "type": "json_object"},
        marker,
    ]

    reconciled = reconcile_form_fields(fields, {"empty": None})

    assert reconciled == fields
