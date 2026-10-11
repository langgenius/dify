import pytest

from graphon.runtime.variable_pool import VariablePool
from libs.workflow_template_values import resolve_template_value, template_value_selectors


@pytest.mark.parametrize("value", [0, 1.5, None])
def test_constant_filter_values_do_not_request_workflow_variables(value: int | float | None) -> None:
    assert list(template_value_selectors(value)) == []


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, "True"),
        (False, "False"),
        (["I10", "I20"], "['I10', 'I20']"),
        ({"guide_item_id": "I10"}, "{'guide_item_id': 'I10'}"),
    ],
)
def test_boolean_and_collection_filter_references_resolve_to_strings(
    value: bool | list[str] | dict[str, str], expected: str
) -> None:
    pool = VariablePool()
    pool.add(["start", "filter_value"], value)

    assert resolve_template_value("{{#start.filter_value#}}", pool) == expected
