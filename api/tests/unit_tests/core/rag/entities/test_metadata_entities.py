import pytest
from pydantic import ValidationError

from core.rag.entities.metadata_entities import Condition, MetadataFilteringCondition

STRING_OPERATORS = [
    "contains",
    "not contains",
    "start with",
    "end with",
    "is",
    "is not",
    "empty",
    "not empty",
    "in",
    "not in",
]
NUMERIC_OPERATORS = ["=", "\u2260", ">", "<", "\u2265", "\u2264"]
TIME_OPERATORS = ["before", "after"]


class TestCondition:
    def test_minimal_construction_uses_defaults(self):
        condition = Condition(name="author", comparison_operator="is")
        assert condition.name == "author"
        assert condition.comparison_operator == "is"
        assert condition.value is None

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            pytest.param("alice", "alice", id="string"),
            pytest.param(["alice", "bob"], ["alice", "bob"], id="string-list"),
            pytest.param([], [], id="empty-list"),
            pytest.param(2024, 2024, id="int"),
            pytest.param(3.5, 3.5, id="float"),
            pytest.param(None, None, id="none"),
            pytest.param(True, 1, id="bool-coerced-to-int"),
        ],
    )
    def test_supported_value_types_are_kept(self, value, expected):
        condition = Condition(name="year", comparison_operator="is", value=value)
        assert condition.value == expected

    @pytest.mark.parametrize("operator", [*STRING_OPERATORS, *NUMERIC_OPERATORS, *TIME_OPERATORS])
    def test_all_supported_operators_are_accepted(self, operator: str):
        condition = Condition(name="field", comparison_operator=operator)
        assert condition.comparison_operator == operator

    def test_unknown_operator_is_rejected(self):
        with pytest.raises(ValidationError, match="comparison_operator"):
            Condition(name="field", comparison_operator="like")

    def test_name_is_required(self):
        with pytest.raises(ValidationError, match="name"):
            Condition(comparison_operator="is")

    def test_comparison_operator_is_required(self):
        with pytest.raises(ValidationError, match="comparison_operator"):
            Condition(name="field")

    def test_mapping_value_is_rejected(self):
        with pytest.raises(ValidationError, match="value"):
            Condition(name="field", comparison_operator="is", value={"nested": "dict"})


class TestMetadataFilteringCondition:
    def test_minimal_construction_uses_defaults(self):
        filtering = MetadataFilteringCondition()
        assert filtering.logical_operator == "and"
        assert filtering.conditions is None

    def test_logical_operator_or_is_accepted(self):
        filtering = MetadataFilteringCondition(logical_operator="or")
        assert filtering.logical_operator == "or"

    def test_unknown_logical_operator_is_rejected(self):
        with pytest.raises(ValidationError, match="logical_operator"):
            MetadataFilteringCondition(logical_operator="xor")

    def test_conditions_accept_model_instances(self):
        filtering = MetadataFilteringCondition(
            conditions=[
                Condition(name="author", comparison_operator="is", value="alice"),
                Condition(name="year", comparison_operator=">", value=2020),
            ]
        )
        assert [c.name for c in filtering.conditions] == ["author", "year"]
        assert filtering.conditions[1].value == 2020

    def test_conditions_accept_mappings(self):
        filtering = MetadataFilteringCondition(
            conditions=[{"name": "author", "comparison_operator": "is", "value": "alice"}]
        )
        assert isinstance(filtering.conditions[0], Condition)
        assert filtering.conditions[0].value == "alice"

    def test_empty_conditions_list_is_accepted(self):
        filtering = MetadataFilteringCondition(conditions=[])
        assert filtering.conditions == []

    def test_invalid_condition_entry_is_rejected(self):
        with pytest.raises(ValidationError, match="conditions"):
            MetadataFilteringCondition(conditions=[{"name": "author"}])
