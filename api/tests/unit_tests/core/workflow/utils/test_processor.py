import json
from unittest.mock import patch

import pytest

from core.workflow.utils.condition import processor as processor_module
from core.workflow.utils.condition.processor import (
    ConditionProcessor,
    _convert_to_bool,
    _evaluate_condition,
    _normalize_numeric_values,
    _process_sub_conditions,
)


class DummyVariable:
    def __init__(self, value):
        self.value = value


class DummyBooleanSegment(DummyVariable):
    pass


class DummyArrayBooleanSegment(DummyVariable):
    pass


class DummyArrayFileSegment(DummyVariable):
    pass


class DummyTemplate:
    def __init__(self, text):
        self.text = text


class DummyVariablePool:
    def __init__(self, mapping):
        self.mapping = mapping

    def get(self, selector):
        return self.mapping.get(selector)

    def convert_template(self, value):
        return DummyTemplate(value)


class DummyCondition:
    def __init__(
        self,
        variable_selector,
        comparison_operator,
        value=None,
        sub_variable_condition=None,
    ):
        self.variable_selector = variable_selector
        self.comparison_operator = comparison_operator
        self.value = value
        self.sub_variable_condition = sub_variable_condition


class DummySubCondition:
    def __init__(self, key, comparison_operator, value):
        self.key = key
        self.comparison_operator = comparison_operator
        self.value = value


class DummySubVariableCondition:
    def __init__(self, conditions, logical_operator):
        self.conditions = conditions
        self.logical_operator = logical_operator


class TestConvertToBool:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (1, True),
            (0, False),
            ("1", True),
            ("0", False),
            ("true", True),
            ("false", False),
        ],
    )
    def test_valid_conversions(self, value, expected):
        assert _convert_to_bool(value) is expected

    def test_invalid_type_raises(self):
        with pytest.raises(json.JSONDecodeError):
            _convert_to_bool("invalid-json")

    def test_unexpected_type_raises(self):
        with pytest.raises(TypeError, match="unexpected value"):
            _convert_to_bool([1])


class TestNormalizeNumericValues:
    def test_int_and_str_whole(self):
        value, expected = _normalize_numeric_values(5, "10")
        assert value == 5
        assert expected == 10

    def test_int_and_str_float(self):
        value, expected = _normalize_numeric_values(5, "10.5")
        assert isinstance(value, float)
        assert expected == 10.5

    def test_invalid_expected(self):
        with pytest.raises(ValueError):
            _normalize_numeric_values(5, object())

    def test_float_expected(self):
        value, expected = _normalize_numeric_values(5, 2.5)
        assert value == 5.0
        assert expected == 2.5

    def test_invalid_string_expected(self):
        with pytest.raises(ValueError, match="Cannot convert"):
            _normalize_numeric_values(5, "not-a-number")


class TestEvaluateConditionOperators:
    @pytest.mark.parametrize(
        ("operator", "value", "expected", "result"),
        [
            ("contains", "hello world", "world", True),
            ("not contains", "hello", "xyz", True),
            ("start with", "hello", "he", True),
            ("end with", "hello", "lo", True),
            ("is", "a", "a", True),
            ("is not", "a", "b", True),
            ("empty", "", None, True),
            ("not empty", "x", None, True),
            ("=", 5, "5", True),
            ("≠", 5, "6", True),
            (">", 10, "5", True),
            ("<", 5, "10", True),
            ("≥", 5, "5", True),
            ("≤", 5, "5", True),
            ("null", None, None, True),
            ("not null", 1, None, True),
            ("in", "a", ["a", "b"], True),
            ("not in", "x", ["a", "b"], True),
            ("exists", 1, None, True),
            ("not exists", None, None, True),
        ],
    )
    def test_supported_operators(self, operator, value, expected, result):
        assert (
            _evaluate_condition(
                operator=operator,
                value=value,
                expected=expected,
            )
            is result
        )

    def test_all_of_string(self):
        assert _evaluate_condition(
            operator="all of",
            value=["a", "b", "c"],
            expected=["a", "b"],
        )

    def test_all_of_bool(self):
        assert _evaluate_condition(
            operator="all of",
            value=[True, False],
            expected=[True],
        )

    def test_unsupported_operator(self):
        with pytest.raises(ValueError):
            _evaluate_condition(
                operator="invalid",
                value=1,
                expected=1,
            )

    def test_all_of_mixed_list_raises(self):
        with pytest.raises(ValueError, match="homogeneous"):
            _evaluate_condition(
                operator="all of",
                value=["a", True],
                expected=["a", True],
            )

    def test_contains_invalid_type_raises(self):
        with pytest.raises(ValueError, match="Invalid actual value type"):
            _evaluate_condition(
                operator="contains",
                value=123,
                expected="1",
            )

    def test_start_with_expected_type_raises(self):
        with pytest.raises(ValueError, match="Expected value must be a string"):
            _evaluate_condition(
                operator="start with",
                value="abc",
                expected=1,
            )

    def test_end_with_actual_type_raises(self):
        with pytest.raises(ValueError, match="Invalid actual value type"):
            _evaluate_condition(
                operator="end with",
                value=123,
                expected="3",
            )

    def test_is_invalid_type_raises(self):
        with pytest.raises(ValueError, match="Invalid actual value type"):
            _evaluate_condition(
                operator="is",
                value=1,
                expected=1,
            )

    def test_equal_invalid_expected_type_raises(self):
        with pytest.raises(ValueError, match="Cannot convert"):
            _evaluate_condition(
                operator="=",
                value=True,
                expected={"a": 1},
            )

    def test_in_expected_not_list_raises(self):
        with pytest.raises(ValueError, match="Invalid expected value type"):
            _evaluate_condition(
                operator="in",
                value="a",
                expected="a",
            )

    def test_not_in_expected_not_list_raises(self):
        with pytest.raises(ValueError, match="Invalid expected value type"):
            _evaluate_condition(
                operator="not in",
                value="a",
                expected="a",
            )

    @pytest.mark.parametrize(
        ("operator", "value", "expected", "result"),
        [
            ("contains", "", "a", False),
            ("not contains", "", "a", True),
            ("start with", "", "a", False),
            ("end with", "", "a", False),
            ("is", None, "a", False),
            ("is not", None, "a", False),
            ("=", None, 1, False),
            ("≠", None, 1, False),
            ("in", "", ["a"], False),
            ("not in", "", ["a"], True),
        ],
    )
    def test_falsy_and_none_branches(self, operator, value, expected, result):
        assert (
            _evaluate_condition(
                operator=operator,
                value=value,
                expected=expected,
            )
            is result
        )

    def test_not_equal_returns_false_on_equal(self):
        assert (
            _evaluate_condition(
                operator="≠",
                value=5,
                expected=5,
            )
            is False
        )

    def test_all_of_container_type_checks(self):
        assert (
            _evaluate_condition(
                operator="all of",
                value=object(),
                expected=["a"],
            )
            is False
        )
        assert (
            _evaluate_condition(
                operator="all of",
                value=object(),
                expected=[True],
            )
            is False
        )

    def test_string_contains_with_non_string_expected(self):
        assert (
            _evaluate_condition(
                operator="contains",
                value="abc",
                expected=1,
            )
            is False
        )

    def test_list_contains_and_not_contains(self):
        assert (
            _evaluate_condition(
                operator="contains",
                value=["a", "b"],
                expected="c",
            )
            is False
        )
        assert (
            _evaluate_condition(
                operator="not contains",
                value=["a", "b"],
                expected="a",
            )
            is False
        )

    def test_start_end_with_error_paths(self):
        with pytest.raises(ValueError, match="Invalid actual value type"):
            _evaluate_condition(
                operator="start with",
                value=123,
                expected="1",
            )
        with pytest.raises(ValueError, match="Expected value must be a string"):
            _evaluate_condition(
                operator="end with",
                value="abc",
                expected=1,
            )

    def test_is_and_is_not_false_cases(self):
        assert (
            _evaluate_condition(
                operator="is",
                value="a",
                expected="b",
            )
            is False
        )
        assert (
            _evaluate_condition(
                operator="is not",
                value="a",
                expected="a",
            )
            is False
        )

    def test_empty_and_not_empty_false_cases(self):
        assert (
            _evaluate_condition(
                operator="empty",
                value="x",
                expected=None,
            )
            is False
        )
        assert (
            _evaluate_condition(
                operator="not empty",
                value="",
                expected=None,
            )
            is False
        )

    def test_numeric_comparisons_errors_and_edges(self):
        with pytest.raises(ValueError, match="Invalid actual value type"):
            _evaluate_condition(
                operator=">",
                value="1",
                expected=1,
            )
        with pytest.raises(ValueError, match="Invalid actual value type"):
            _evaluate_condition(
                operator="<",
                value="1",
                expected=1,
            )
        assert (
            _evaluate_condition(
                operator="≥",
                value=2,
                expected=2.0,
            )
            is True
        )
        assert (
            _evaluate_condition(
                operator="≤",
                value=2,
                expected=2.0,
            )
            is True
        )

    def test_in_and_not_in_results(self):
        assert (
            _evaluate_condition(
                operator="in",
                value="a",
                expected=["a", "b"],
            )
            is True
        )
        assert (
            _evaluate_condition(
                operator="not in",
                value="a",
                expected=["a", "b"],
            )
            is False
        )

    def test_equal_and_not_equal_bool_and_float(self):
        assert (
            _evaluate_condition(
                operator="=",
                value=True,
                expected="1",
            )
            is True
        )
        assert (
            _evaluate_condition(
                operator="=",
                value=1.5,
                expected="1.5",
            )
            is True
        )
        assert (
            _evaluate_condition(
                operator="≠",
                value=True,
                expected=True,
            )
            is False
        )


class TestConditionProcessor:
    def test_variable_not_found(self):
        processor = ConditionProcessor()
        pool = DummyVariablePool({})

        cond = DummyCondition("x", "=")

        with pytest.raises(ValueError):
            processor.process_conditions(
                variable_pool=pool,
                conditions=[cond],
                operator="and",
            )

    def test_boolean_conversion(self):
        processor = ConditionProcessor()
        pool = DummyVariablePool({"flag": DummyBooleanSegment(True)})

        cond = DummyCondition("flag", "=", "1")

        result = processor.process_conditions(
            variable_pool=pool,
            conditions=[cond],
            operator="and",
        )

        assert result.final_result is True
        assert result.group_results == [True]

    def test_short_circuit_and(self):
        processor = ConditionProcessor()
        pool = DummyVariablePool(
            {
                "a": DummyVariable(1),
                "b": DummyVariable(2),
            }
        )

        cond1 = DummyCondition("a", "=", 0)
        cond2 = DummyCondition("b", "=", 2)

        result = processor.process_conditions(
            variable_pool=pool,
            conditions=[cond1, cond2],
            operator="and",
        )

        assert result.final_result is False
        assert len(result.group_results) == 1

    def test_short_circuit_or(self):
        processor = ConditionProcessor()
        pool = DummyVariablePool(
            {
                "a": DummyVariable(1),
                "b": DummyVariable(2),
            }
        )

        cond1 = DummyCondition("a", "=", 1)
        cond2 = DummyCondition("b", "=", 0)

        result = processor.process_conditions(
            variable_pool=pool,
            conditions=[cond1, cond2],
            operator="or",
        )

        assert result.final_result is True
        assert len(result.group_results) == 1

    def test_array_file_segment_requires_sub_condition(self, monkeypatch):
        processor = ConditionProcessor()
        monkeypatch.setattr(processor_module, "ArrayFileSegment", DummyArrayFileSegment)

        pool = DummyVariablePool({"files": DummyArrayFileSegment(["file1"])})

        cond = DummyCondition("files", "contains")

        with pytest.raises(ValueError, match="Sub variable is required"):
            processor.process_conditions(
                variable_pool=pool,
                conditions=[cond],
                operator="and",
            )

    def test_exists_operator_does_not_require_expected(self):
        processor = ConditionProcessor()
        pool = DummyVariablePool({"value": DummyVariable(1)})

        cond = DummyCondition("value", "exists")

        result = processor.process_conditions(
            variable_pool=pool,
            conditions=[cond],
            operator="and",
        )

        assert result.final_result is True
        assert result.group_results == [True]

    def test_boolean_list_conversion(self, monkeypatch):
        processor = ConditionProcessor()
        monkeypatch.setattr(processor_module, "ArrayBooleanSegment", DummyArrayBooleanSegment)

        pool = DummyVariablePool({"flags": DummyArrayBooleanSegment([True, False])})

        cond = DummyCondition("flags", "all of", ["true", "false"])

        result = processor.process_conditions(
            variable_pool=pool,
            conditions=[cond],
            operator="and",
        )

        assert result.final_result is True

    def test_template_conversion_applies(self):
        processor = ConditionProcessor()

        class TemplatePool(DummyVariablePool):
            def convert_template(self, value):
                return DummyTemplate("resolved")

        pool = TemplatePool({"var": DummyVariable("resolved")})

        cond = DummyCondition("var", "is", "{{template}}")

        result = processor.process_conditions(
            variable_pool=pool,
            conditions=[cond],
            operator="and",
        )

        assert result.final_result is True


class TestSubConditionProcessing:
    @patch("core.workflow.utils.condition.processor.file_manager")
    @patch("core.workflow.utils.condition.processor.FileAttribute")
    def test_process_sub_conditions_extension(
        self,
        mock_file_attribute,
        mock_file_manager,
    ):
        mock_file_attribute.EXTENSION = "extension"
        mock_file_attribute.return_value = "extension"

        mock_file_manager.get_attr.side_effect = lambda file, attr: ".txt"

        variable = DummyArrayFileSegment(["file1", "file2"])

        sub_condition = DummySubCondition(
            key="extension",
            comparison_operator="contains",
            value="txt",
        )

        result = _process_sub_conditions(
            variable=variable,
            sub_conditions=[sub_condition],
            operator="and",
        )

        assert result is True

    @patch("core.workflow.utils.condition.processor.file_manager")
    @patch("core.workflow.utils.condition.processor.FileAttribute")
    def test_process_sub_conditions_not_operator(
        self,
        mock_file_attribute,
        mock_file_manager,
    ):
        mock_file_attribute.return_value = "name"

        mock_file_manager.get_attr.side_effect = lambda file, attr: "abc"

        variable = DummyArrayFileSegment(["file1"])

        sub_condition = DummySubCondition(
            key="name",
            comparison_operator="not contains",
            value="z",
        )

        result = _process_sub_conditions(
            variable=variable,
            sub_conditions=[sub_condition],
            operator="and",
        )

        assert result is True

    @patch("core.workflow.utils.condition.processor.file_manager")
    @patch("core.workflow.utils.condition.processor.FileAttribute")
    def test_process_sub_conditions_extension_requires_str(
        self,
        mock_file_attribute,
        mock_file_manager,
    ):
        mock_file_attribute.EXTENSION = "extension"
        mock_file_attribute.return_value = "extension"

        mock_file_manager.get_attr.side_effect = lambda file, attr: "txt"

        variable = DummyArrayFileSegment(["file1"])

        sub_condition = DummySubCondition(
            key="extension",
            comparison_operator="contains",
            value=123,
        )

        with pytest.raises(TypeError, match="Expected value must be a string"):
            _process_sub_conditions(
                variable=variable,
                sub_conditions=[sub_condition],
                operator="and",
            )

    @patch("core.workflow.utils.condition.processor.file_manager")
    @patch("core.workflow.utils.condition.processor.FileAttribute")
    def test_process_sub_conditions_or_operator(self, mock_file_attribute, mock_file_manager):
        mock_file_attribute.return_value = "name"
        mock_file_manager.get_attr.side_effect = lambda file, attr: "abc"

        variable = DummyArrayFileSegment(["file1", "file2"])

        sub_condition = DummySubCondition(
            key="name",
            comparison_operator="contains",
            value="z",
        )

        result = _process_sub_conditions(
            variable=variable,
            sub_conditions=[sub_condition],
            operator="or",
        )

        assert result is False

    @patch("core.workflow.utils.condition.processor.file_manager")
    @patch("core.workflow.utils.condition.processor.FileAttribute")
    def test_process_sub_conditions_extension_normalizes_dot(self, mock_file_attribute, mock_file_manager):
        mock_file_attribute.EXTENSION = "extension"
        mock_file_attribute.return_value = "extension"

        mock_file_manager.get_attr.side_effect = lambda file, attr: "txt"

        variable = DummyArrayFileSegment(["file1"])

        sub_condition = DummySubCondition(
            key="extension",
            comparison_operator="contains",
            value="txt",
        )

        result = _process_sub_conditions(
            variable=variable,
            sub_conditions=[sub_condition],
            operator="and",
        )

        assert result is True

    @patch("core.workflow.utils.condition.processor.file_manager")
    @patch("core.workflow.utils.condition.processor.FileAttribute")
    def test_process_sub_conditions_not_operator_false(self, mock_file_attribute, mock_file_manager):
        mock_file_attribute.return_value = "name"
        mock_file_manager.get_attr.side_effect = lambda file, attr: "abc"

        variable = DummyArrayFileSegment(["file1"])

        sub_condition = DummySubCondition(
            key="name",
            comparison_operator="not contains",
            value="a",
        )

        result = _process_sub_conditions(
            variable=variable,
            sub_conditions=[sub_condition],
            operator="and",
        )

        assert result is False
