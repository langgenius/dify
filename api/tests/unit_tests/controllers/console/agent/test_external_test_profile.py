import pytest
from pydantic import ValidationError

from controllers.console.agent.external_tests import ExternalTestOutputField, ExternalTestPayload


def test_public_test_output_schema_has_exactly_the_frozen_six_types() -> None:
    schema = ExternalTestOutputField.model_json_schema()
    assert schema["$defs"]["ExternalTestOutputField"]["properties"]["kind"]["enum"] == [
        "string",
        "number",
        "boolean",
        "object",
        "array",
        "file",
    ]


@pytest.mark.parametrize(
    "output",
    [
        {"name": "n", "kind": "integer"},
        {"name": "items", "kind": "array", "item": {"name": "item", "kind": "integer"}},
        {"name": "record", "kind": "object", "children": [{"name": "n", "kind": "integer"}]},
    ],
)
def test_internal_integer_alias_is_rejected_at_every_public_output_depth(output: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        ExternalTestPayload.model_validate(
            {
                "page_session_id": "page",
                "expected_generation": 1,
                "idempotency_key": "key",
                "task_text": "Task",
                "outputs": [output],
            }
        )


def test_public_profile_converts_to_internal_ports_without_coercing_zero_or_false_defaults() -> None:
    value = ExternalTestOutputField(
        name="record",
        kind="object",
        children=(
            ExternalTestOutputField(name="valid", kind="boolean", has_default=True, default=False),
            ExternalTestOutputField(name="n", kind="number", has_default=True, default=0),
        ),
    )
    field = value.field()
    assert field.children[0].default is False
    assert field.children[1].default == 0
