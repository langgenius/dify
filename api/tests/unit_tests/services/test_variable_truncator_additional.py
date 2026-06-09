from collections.abc import Mapping
from typing import Any

import pytest

from graphon.nodes.variable_assigner.common.helpers import UpdatedVariable
from graphon.variables.segments import IntegerSegment, ObjectSegment, StringSegment
from graphon.variables.types import SegmentType
from services import variable_truncator as truncator_module
from services.variable_truncator import BaseTruncator, TruncationResult, VariableTruncator


class _AbstractPassthrough(BaseTruncator):
    def truncate(self, segment: Any) -> TruncationResult:
        return super().truncate(segment)  # type: ignore[misc]

    def truncate_variable_mapping(self, v: Mapping[str, Any]) -> tuple[Mapping[str, Any], bool]:
        return super().truncate_variable_mapping(v)  # type: ignore[misc]


class TestBaseTruncatorContract:
    def test_base_truncator_methods_should_execute_abstract_placeholders(self) -> None:
        passthrough = _AbstractPassthrough()

        truncate_result = passthrough.truncate(StringSegment(value="x"))
        mapping_result = passthrough.truncate_variable_mapping({"a": 1})

        assert truncate_result is None
        assert mapping_result is None


class TestVariableTruncatorAdditionalBehavior:
    def test_default_should_use_dify_config_limits(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(truncator_module.dify_config, "WORKFLOW_VARIABLE_TRUNCATION_MAX_SIZE", 111)
        monkeypatch.setattr(truncator_module.dify_config, "WORKFLOW_VARIABLE_TRUNCATION_ARRAY_LENGTH", 7)
        monkeypatch.setattr(truncator_module.dify_config, "WORKFLOW_VARIABLE_TRUNCATION_STRING_LENGTH", 33)

        truncator = VariableTruncator.default()

        assert truncator._max_size_bytes == 111
        assert truncator._array_element_limit == 7
        assert truncator._string_length_limit == 33

    def test_truncate_variable_mapping_should_mark_over_budget_keys_with_ellipsis(self) -> None:
        truncator = VariableTruncator(max_size_bytes=5)
        mapping = {"very_long_key": "value"}

        result, truncated = truncator.truncate_variable_mapping(mapping)

        assert result == {"very_long_key": "..."}
        assert truncated is True

    def test_truncate_variable_mapping_should_handle_segment_values(self) -> None:
        truncator = VariableTruncator(max_size_bytes=100)
        mapping = {"seg": StringSegment(value="hello")}

        result, truncated = truncator.truncate_variable_mapping(mapping)

        assert isinstance(result["seg"], StringSegment)
        assert result["seg"].value == "hello"
        assert truncated is False

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (None, False),
            (True, False),
            (1, False),
            (1.5, False),
            ("x", True),
            ({"k": "v"}, True),
        ],
    )
    def test_json_value_needs_truncation_should_match_expected_rules(
        self,
        value: Any,
        expected: bool,
    ) -> None:
        result = VariableTruncator._json_value_needs_truncation(value)
        assert result is expected

    def test_truncate_should_use_string_fallback_when_truncated_value_size_exceeds_limit(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        truncator = VariableTruncator(max_size_bytes=10)
        forced_result = truncator_module._PartResult(
            value=StringSegment(value="this is too long"),
            value_size=100,
            truncated=True,
        )
        monkeypatch.setattr(truncator, "_truncate_segment", lambda *_args, **_kwargs: forced_result)

        result = truncator.truncate(StringSegment(value="input"))

        assert result.truncated is True
        assert isinstance(result.result, StringSegment)
        assert not result.result.value.startswith('"')

    def test_truncate_segment_should_raise_assertion_for_unexpected_truncatable_segment(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        truncator = VariableTruncator()
        monkeypatch.setattr(VariableTruncator, "_segment_need_truncation", lambda _segment: True)

        with pytest.raises(AssertionError):
            truncator._truncate_segment(IntegerSegment(value=1), 10)

    def test_calculate_json_size_should_unwrap_segment_values(self) -> None:
        segment = StringSegment(value="abc")

        size = VariableTruncator.calculate_json_size(segment)

        assert size == VariableTruncator.calculate_json_size("abc")

    def test_calculate_json_size_should_handle_updated_variable_instances(self) -> None:
        updated = UpdatedVariable(name="n", selector=["node", "var"], value_type=SegmentType.STRING, new_value="v")

        size = VariableTruncator.calculate_json_size(updated)

        assert size > 0

    def test_maybe_qa_structure_should_validate_shape(self) -> None:
        assert VariableTruncator._maybe_qa_structure({"qa_chunks": []}) is True
        assert VariableTruncator._maybe_qa_structure({"qa_chunks": "not-list"}) is False
        assert VariableTruncator._maybe_qa_structure({}) is False

    def test_maybe_parent_child_structure_should_validate_shape(self) -> None:
        assert (
            VariableTruncator._maybe_parent_child_structure({"parent_mode": "full", "parent_child_chunks": []}) is True
        )
        assert VariableTruncator._maybe_parent_child_structure({"parent_mode": 1, "parent_child_chunks": []}) is False
        assert (
            VariableTruncator._maybe_parent_child_structure({"parent_mode": "full", "parent_child_chunks": "bad"})
            is False
        )

    def test_truncate_object_should_truncate_segment_values_inside_object(self) -> None:
        truncator = VariableTruncator(string_length_limit=8, max_size_bytes=30)
        mapping = {"s": StringSegment(value="long-content")}

        result = truncator._truncate_object(mapping, 20)

        assert result.truncated is True
        assert isinstance(result.value["s"], StringSegment)

    def test_truncate_json_primitives_should_handle_updated_variable_input(self) -> None:
        truncator = VariableTruncator(max_size_bytes=100)
        updated = UpdatedVariable(name="n", selector=["node", "var"], value_type=SegmentType.STRING, new_value="v")

        result = truncator._truncate_json_primitives(updated, 100)

        assert isinstance(result.value, dict)

    def test_truncate_json_primitives_should_raise_assertion_for_unsupported_value_type(self) -> None:
        truncator = VariableTruncator()

        with pytest.raises(AssertionError):
            truncator._truncate_json_primitives(object(), 100)  # type: ignore[arg-type]

    def test_truncate_should_apply_json_string_fallback_for_large_non_string_segment(
        self,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        truncator = VariableTruncator(max_size_bytes=10)
        forced_segment = ObjectSegment(value={"k": "v"})
        forced_result = truncator_module._PartResult(value=forced_segment, value_size=100, truncated=True)
        monkeypatch.setattr(truncator, "_truncate_segment", lambda *_args, **_kwargs: forced_result)

        result = truncator.truncate(ObjectSegment(value={"a": "b"}))

        assert result.truncated is True
        assert isinstance(result.result, StringSegment)
