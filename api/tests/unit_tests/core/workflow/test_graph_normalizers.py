"""Pure graph normalizers shared by the workflow generator's postprocess (cmd+K
``/create`` and ``/refine``) and the Dify Builder's ``apply_repair`` chokepoint.

The if-else cases run against the REAL ESQ1-303 dev draft (app 0f11bedc,
dumped 2026-09-21), which graphon refused to start because ``value`` was the
JSON number 60 (``Condition.value: str | Sequence[str] | bool | None``)."""

import copy
import json
from pathlib import Path

from core.workflow.graph_normalizers import (
    normalize_condition_value,
    normalize_condition_values,
    normalize_filter_condition_value,
)

_FIXTURES = Path(__file__).parent / "fixtures"


def _esq1_303_nodes() -> list[dict]:
    return json.loads((_FIXTURES / "esq1_303_draft_graph.json").read_text(encoding="utf-8"))["nodes"]


def _if_else_value(nodes: list[dict], node_id: str = "node2"):
    node = next(n for n in nodes if n["id"] == node_id)
    return node["data"]["cases"][0]["conditions"][0]["value"]


class TestNormalizeConditionValue:
    def test_numbers_become_strings(self):
        assert normalize_condition_value(60, "=") == "60"
        assert normalize_condition_value(60.0, "=") == "60"  # an integral float is not "60.0"
        assert normalize_condition_value(60.5, ">") == "60.5"
        assert normalize_condition_value(0, "=") == "0"
        assert normalize_condition_value(1, "=") == "1"  # pydantic would coerce int 1 to True

    def test_bool_is_checked_before_int_and_preserved(self):
        assert normalize_condition_value(True, "is") is True
        assert normalize_condition_value(False, "is") is False

    def test_strings_none_and_string_lists_pass_through(self):
        assert normalize_condition_value("60", "=") == "60"
        assert normalize_condition_value(None, "empty") is None
        assert normalize_condition_value(["a", "b"], "in") == ["a", "b"]

    def test_list_items_are_coerced_to_strings(self):
        assert normalize_condition_value([1, "b", 2.5, True], "in") == ["1", "b", "2.5", "True"]

    def test_a_scalar_under_a_list_operator_becomes_a_one_item_list(self):
        assert normalize_condition_value(3, "in") == ["3"]
        assert normalize_condition_value(3, "not in") == ["3"]
        assert normalize_condition_value(3, "all of") == ["3"]
        assert normalize_condition_value("x", "in") == ["x"]

    def test_list_items_use_integral_float_rule(self):
        # integral floats in lists should become strings without decimal point
        assert normalize_condition_value([1.0, 2.5], "=") == ["1", "2.5"]


class TestNormalizeFilterConditionValue:
    def test_none_becomes_empty_string(self):
        assert normalize_filter_condition_value(None) == ""

    def test_bool_is_preserved(self):
        assert normalize_filter_condition_value(True) is True
        assert normalize_filter_condition_value(False) is False

    def test_numbers_become_strings_not_lists(self):
        assert normalize_filter_condition_value(7) == "7"
        assert normalize_filter_condition_value(7.0) == "7"
        assert normalize_filter_condition_value(7.5) == "7.5"

    def test_strings_pass_through(self):
        assert normalize_filter_condition_value("value") == "value"

    def test_list_items_normalized_no_wrapping(self):
        # Unlike Condition, we don't wrap in a list—we keep the list but normalize items
        assert normalize_filter_condition_value(["a", 2]) == ["a", "2"]
        assert normalize_filter_condition_value([1.0, "b"]) == ["1", "b"]


class TestNormalizeConditionValues:
    def test_heals_the_esq1_303_dev_draft_and_names_the_node(self):
        nodes = _esq1_303_nodes()
        assert _if_else_value(nodes) == 60

        changed = normalize_condition_values(nodes)

        assert changed == ["node2"]
        assert _if_else_value(nodes) == "60"

    def test_is_idempotent_and_reports_nothing_on_a_clean_graph(self):
        nodes = _esq1_303_nodes()
        normalize_condition_values(nodes)

        assert normalize_condition_values(nodes) == []

    def test_covers_sub_variable_conditions_loop_break_conditions_and_list_operator_filters(self):
        nodes = [
            {
                "id": "branch",
                "data": {
                    "type": "if-else",
                    "cases": [
                        {
                            "case_id": "true",
                            "conditions": [
                                {
                                    "variable_selector": ["s", "files"],
                                    "comparison_operator": "contains",
                                    "value": None,
                                    "sub_variable_condition": {
                                        "logical_operator": "and",
                                        "conditions": [{"key": "size", "comparison_operator": ">", "value": 1024}],
                                    },
                                }
                            ],
                        }
                    ],
                },
            },
            {
                "id": "loop",
                "data": {
                    "type": "loop",
                    "break_conditions": [{"variable_selector": ["loop", "i"], "comparison_operator": "≥", "value": 10}],
                },
            },
            {
                "id": "filter",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "n", "comparison_operator": "in", "value": 7}],
                    },
                },
            },
            {"id": "legacy", "data": {"type": "if-else", "conditions": [{"comparison_operator": "=", "value": 2}]}},
        ]

        changed = normalize_condition_values(nodes)

        assert changed == ["branch", "loop", "filter", "legacy"]
        sub = nodes[0]["data"]["cases"][0]["conditions"][0]["sub_variable_condition"]["conditions"][0]
        assert sub["value"] == "1024"
        assert nodes[1]["data"]["break_conditions"][0]["value"] == "10"
        assert nodes[2]["data"]["filter_by"]["conditions"][0]["value"] == "7"
        assert nodes[3]["data"]["conditions"][0]["value"] == "2"

    def test_other_node_types_and_malformed_shapes_are_left_alone(self):
        nodes = [
            {"id": "llm", "data": {"type": "llm", "value": 3}},
            {"id": "odd", "data": {"type": "if-else", "cases": "not-a-list"}},
            {"id": "odd2", "data": {"type": "if-else", "cases": [{"conditions": ["junk", None]}]}},
            "not-a-node",
        ]
        before = copy.deepcopy(nodes)

        assert normalize_condition_values(nodes) == []
        assert nodes == before

    def test_list_operator_with_none_bool_and_lists(self):
        """List-operator filters follow FilterCondition (None → "", no wrapping)."""
        nodes = [
            {
                "id": "filter_none",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "x", "comparison_operator": "empty", "value": None}],
                    },
                },
            },
            {
                "id": "filter_bool",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "x", "comparison_operator": "is", "value": True}],
                    },
                },
            },
            {
                "id": "filter_list",
                "data": {
                    "type": "list-operator",
                    "filter_by": {
                        "enabled": True,
                        "conditions": [{"key": "x", "comparison_operator": "in", "value": ["a", 2]}],
                    },
                },
            },
        ]

        changed = normalize_condition_values(nodes)

        # filter_none changed (None → ""), filter_list changed (items normalized)
        # filter_bool unchanged (True stays True)
        assert "filter_none" in changed
        assert "filter_list" in changed
        assert "filter_bool" not in changed
        assert nodes[0]["data"]["filter_by"]["conditions"][0]["value"] == ""
        assert nodes[1]["data"]["filter_by"]["conditions"][0]["value"] is True
        assert nodes[2]["data"]["filter_by"]["conditions"][0]["value"] == ["a", "2"]
