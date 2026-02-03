"""
Test cases for ParameterExtractorNode._validate_result and _transform_result methods.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from core.model_runtime.entities import LLMMode
from core.variables.types import SegmentType
from core.workflow.nodes.llm import ModelConfig, VisionConfig
from core.workflow.nodes.parameter_extractor.entities import ParameterConfig, ParameterExtractorNodeData
from core.workflow.nodes.parameter_extractor.exc import (
    InvalidNumberOfParametersError,
    InvalidSelectValueError,
    InvalidValueTypeError,
    RequiredParameterMissingError,
)
from core.workflow.nodes.parameter_extractor.parameter_extractor_node import ParameterExtractorNode
from factories.variable_factory import build_segment_with_type


@dataclass
class ValidTestCase:
    """Test case data for valid scenarios."""

    name: str
    parameters: list[ParameterConfig]
    result: dict[str, Any]

    def get_name(self) -> str:
        return self.name


@dataclass
class ErrorTestCase:
    """Test case data for error scenarios."""

    name: str
    parameters: list[ParameterConfig]
    result: dict[str, Any]
    expected_exception: type[Exception]
    expected_message: str

    def get_name(self) -> str:
        return self.name


@dataclass
class TransformTestCase:
    """Test case data for transformation scenarios."""

    name: str
    parameters: list[ParameterConfig]
    input_result: dict[str, Any]
    expected_result: dict[str, Any]

    def get_name(self) -> str:
        return self.name


class TestParameterExtractorNodeMethods:
    """Test helper class that provides access to the methods under test."""

    def validate_result(self, data: ParameterExtractorNodeData, result: dict[str, Any]) -> dict[str, Any]:
        """Wrapper to call _validate_result method."""
        node = ParameterExtractorNode.__new__(ParameterExtractorNode)
        return node._validate_result(data=data, result=result)

    def transform_result(self, data: ParameterExtractorNodeData, result: dict[str, Any]) -> dict[str, Any]:
        """Wrapper to call _transform_result method."""
        node = ParameterExtractorNode.__new__(ParameterExtractorNode)
        return node._transform_result(data=data, result=result)


class TestValidateResult:
    """Test cases for _validate_result method."""

    @staticmethod
    def get_valid_test_cases() -> list[ValidTestCase]:
        """Get test cases that should pass validation."""
        return [
            ValidTestCase(
                name="single_string_parameter",
                parameters=[ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True)],
                result={"name": "John"},
            ),
            ValidTestCase(
                name="single_number_parameter_int",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                result={"age": 25},
            ),
            ValidTestCase(
                name="single_number_parameter_float",
                parameters=[ParameterConfig(name="price", type=SegmentType.NUMBER, description="Price", required=True)],
                result={"price": 19.99},
            ),
            ValidTestCase(
                name="single_bool_parameter_true",
                parameters=[
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True)
                ],
                result={"active": True},
            ),
            ValidTestCase(
                name="single_bool_parameter_true",
                parameters=[
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True)
                ],
                result={"active": True},
            ),
            ValidTestCase(
                name="single_bool_parameter_false",
                parameters=[
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True)
                ],
                result={"active": False},
            ),
            ValidTestCase(
                name="select_parameter_valid_option",
                parameters=[
                    ParameterConfig(
                        name="status",
                        type="select",  # pyright: ignore[reportArgumentType]
                        description="Status",
                        required=True,
                        options=["active", "inactive"],
                    )
                ],
                result={"status": "active"},
            ),
            ValidTestCase(
                name="array_string_parameter",
                parameters=[
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True)
                ],
                result={"tags": ["tag1", "tag2", "tag3"]},
            ),
            ValidTestCase(
                name="array_number_parameter",
                parameters=[
                    ParameterConfig(name="scores", type=SegmentType.ARRAY_NUMBER, description="Scores", required=True)
                ],
                result={"scores": [85, 92.5, 78]},
            ),
            ValidTestCase(
                name="array_object_parameter",
                parameters=[
                    ParameterConfig(name="items", type=SegmentType.ARRAY_OBJECT, description="Items", required=True)
                ],
                result={"items": [{"name": "item1"}, {"name": "item2"}]},
            ),
            ValidTestCase(
                name="multiple_parameters",
                parameters=[
                    ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True),
                    ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True),
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True),
                ],
                result={"name": "John", "age": 25, "active": True},
            ),
            ValidTestCase(
                name="optional_parameter_present",
                parameters=[
                    ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True),
                    ParameterConfig(name="nickname", type=SegmentType.STRING, description="Nickname", required=False),
                ],
                result={"name": "John", "nickname": "Johnny"},
            ),
            ValidTestCase(
                name="empty_array_parameter",
                parameters=[
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True)
                ],
                result={"tags": []},
            ),
        ]

    @staticmethod
    def get_error_test_cases() -> list[ErrorTestCase]:
        """Get test cases that should raise exceptions."""
        return [
            ErrorTestCase(
                name="invalid_number_of_parameters_too_few",
                parameters=[
                    ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True),
                    ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True),
                ],
                result={"name": "John"},
                expected_exception=InvalidNumberOfParametersError,
                expected_message="Invalid number of parameters",
            ),
            ErrorTestCase(
                name="invalid_number_of_parameters_too_many",
                parameters=[ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True)],
                result={"name": "John", "age": 25},
                expected_exception=InvalidNumberOfParametersError,
                expected_message="Invalid number of parameters",
            ),
            ErrorTestCase(
                name="invalid_string_value_none",
                parameters=[
                    ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True),
                ],
                result={"name": None},  # Parameter present but None value, will trigger type check first
                expected_exception=InvalidValueTypeError,
                expected_message="Invalid value for parameter name, expected segment type: string, actual_type: none",
            ),
            ErrorTestCase(
                name="invalid_select_value",
                parameters=[
                    ParameterConfig(
                        name="status",
                        type="select",
                        description="Status",
                        required=True,
                        options=["active", "inactive"],
                    )
                ],
                result={"status": "pending"},
                expected_exception=InvalidSelectValueError,
                expected_message="Invalid `select` value for parameter status",
            ),
            ErrorTestCase(
                name="invalid_number_value_string",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                result={"age": "twenty-five"},
                expected_exception=InvalidValueTypeError,
                expected_message="Invalid value for parameter age, expected segment type: number, actual_type: string",
            ),
            ErrorTestCase(
                name="invalid_bool_value_string",
                parameters=[
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True)
                ],
                result={"active": "yes"},
                expected_exception=InvalidValueTypeError,
                expected_message=(
                    "Invalid value for parameter active, expected segment type: boolean, actual_type: string"
                ),
            ),
            ErrorTestCase(
                name="invalid_string_value_number",
                parameters=[
                    ParameterConfig(
                        name="description", type=SegmentType.STRING, description="Description", required=True
                    )
                ],
                result={"description": 123},
                expected_exception=InvalidValueTypeError,
                expected_message=(
                    "Invalid value for parameter description, expected segment type: string, actual_type: integer"
                ),
            ),
            ErrorTestCase(
                name="invalid_array_value_not_list",
                parameters=[
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True)
                ],
                result={"tags": "tag1,tag2,tag3"},
                expected_exception=InvalidValueTypeError,
                expected_message=(
                    "Invalid value for parameter tags, expected segment type: array[string], actual_type: string"
                ),
            ),
            ErrorTestCase(
                name="invalid_array_number_wrong_element_type",
                parameters=[
                    ParameterConfig(name="scores", type=SegmentType.ARRAY_NUMBER, description="Scores", required=True)
                ],
                result={"scores": [85, "ninety-two", 78]},
                expected_exception=InvalidValueTypeError,
                expected_message=(
                    "Invalid value for parameter scores, expected segment type: array[number], actual_type: array[any]"
                ),
            ),
            ErrorTestCase(
                name="invalid_array_string_wrong_element_type",
                parameters=[
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True)
                ],
                result={"tags": ["tag1", 123, "tag3"]},
                expected_exception=InvalidValueTypeError,
                expected_message=(
                    "Invalid value for parameter tags, expected segment type: array[string], actual_type: array[any]"
                ),
            ),
            ErrorTestCase(
                name="invalid_array_object_wrong_element_type",
                parameters=[
                    ParameterConfig(name="items", type=SegmentType.ARRAY_OBJECT, description="Items", required=True)
                ],
                result={"items": [{"name": "item1"}, "item2"]},
                expected_exception=InvalidValueTypeError,
                expected_message=(
                    "Invalid value for parameter items, expected segment type: array[object], actual_type: array[any]"
                ),
            ),
            ErrorTestCase(
                name="required_parameter_missing",
                parameters=[
                    ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True),
                    ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=False),
                ],
                result={"age": 25, "other": "value"},  # Missing required 'name' parameter, but has correct count
                expected_exception=RequiredParameterMissingError,
                expected_message="Parameter name is required",
            ),
        ]

    @pytest.mark.parametrize("test_case", get_valid_test_cases(), ids=ValidTestCase.get_name)
    def test_validate_result_valid_cases(self, test_case):
        """Test _validate_result with valid inputs."""
        helper = TestParameterExtractorNodeMethods()

        node_data = ParameterExtractorNodeData(
            title="Test Node",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
            query=["test_query"],
            parameters=test_case.parameters,
            reasoning_mode="function_call",
            vision=VisionConfig(),
        )

        result = helper.validate_result(data=node_data, result=test_case.result)
        assert result == test_case.result, f"Failed for case: {test_case.name}"

    @pytest.mark.parametrize("test_case", get_error_test_cases(), ids=ErrorTestCase.get_name)
    def test_validate_result_error_cases(self, test_case):
        """Test _validate_result with invalid inputs that should raise exceptions."""
        helper = TestParameterExtractorNodeMethods()

        node_data = ParameterExtractorNodeData(
            title="Test Node",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
            query=["test_query"],
            parameters=test_case.parameters,
            reasoning_mode="function_call",
            vision=VisionConfig(),
        )

        with pytest.raises(test_case.expected_exception) as exc_info:
            helper.validate_result(data=node_data, result=test_case.result)

        assert test_case.expected_message in str(exc_info.value), f"Failed for case: {test_case.name}"


class TestTransformResult:
    """Test cases for _transform_result method."""

    @staticmethod
    def get_transform_test_cases() -> list[TransformTestCase]:
        """Get test cases for result transformation."""
        return [
            # String parameter transformation
            TransformTestCase(
                name="string_parameter_present",
                parameters=[ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True)],
                input_result={"name": "John"},
                expected_result={"name": "John"},
            ),
            TransformTestCase(
                name="string_parameter_missing",
                parameters=[ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True)],
                input_result={},
                expected_result={"name": ""},
            ),
            # Number parameter transformation
            TransformTestCase(
                name="number_parameter_int_present",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                input_result={"age": 25},
                expected_result={"age": 25},
            ),
            TransformTestCase(
                name="number_parameter_float_present",
                parameters=[ParameterConfig(name="price", type=SegmentType.NUMBER, description="Price", required=True)],
                input_result={"price": 19.99},
                expected_result={"price": 19.99},
            ),
            TransformTestCase(
                name="number_parameter_missing",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                input_result={},
                expected_result={"age": 0},
            ),
            # Bool parameter transformation
            TransformTestCase(
                name="bool_parameter_missing",
                parameters=[
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True)
                ],
                input_result={},
                expected_result={"active": False},
            ),
            # Select parameter transformation
            TransformTestCase(
                name="select_parameter_present",
                parameters=[
                    ParameterConfig(
                        name="status",
                        type="select",
                        description="Status",
                        required=True,
                        options=["active", "inactive"],
                    )
                ],
                input_result={"status": "active"},
                expected_result={"status": "active"},
            ),
            TransformTestCase(
                name="select_parameter_missing",
                parameters=[
                    ParameterConfig(
                        name="status",
                        type="select",
                        description="Status",
                        required=True,
                        options=["active", "inactive"],
                    )
                ],
                input_result={},
                expected_result={"status": ""},
            ),
            # Array parameter transformation - present cases
            TransformTestCase(
                name="array_string_parameter_present",
                parameters=[
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True)
                ],
                input_result={"tags": ["tag1", "tag2"]},
                expected_result={
                    "tags": build_segment_with_type(segment_type=SegmentType.ARRAY_STRING, value=["tag1", "tag2"])
                },
            ),
            TransformTestCase(
                name="array_number_parameter_present",
                parameters=[
                    ParameterConfig(name="scores", type=SegmentType.ARRAY_NUMBER, description="Scores", required=True)
                ],
                input_result={"scores": [85, 92.5]},
                expected_result={
                    "scores": build_segment_with_type(segment_type=SegmentType.ARRAY_NUMBER, value=[85, 92.5])
                },
            ),
            TransformTestCase(
                name="array_number_parameter_with_string_conversion",
                parameters=[
                    ParameterConfig(name="scores", type=SegmentType.ARRAY_NUMBER, description="Scores", required=True)
                ],
                input_result={"scores": [85, "92.5", "78"]},
                expected_result={
                    "scores": build_segment_with_type(segment_type=SegmentType.ARRAY_NUMBER, value=[85, 92.5, 78])
                },
            ),
            TransformTestCase(
                name="array_object_parameter_present",
                parameters=[
                    ParameterConfig(name="items", type=SegmentType.ARRAY_OBJECT, description="Items", required=True)
                ],
                input_result={"items": [{"name": "item1"}, {"name": "item2"}]},
                expected_result={
                    "items": build_segment_with_type(
                        segment_type=SegmentType.ARRAY_OBJECT, value=[{"name": "item1"}, {"name": "item2"}]
                    )
                },
            ),
            # Array parameter transformation - missing cases
            TransformTestCase(
                name="array_string_parameter_missing",
                parameters=[
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True)
                ],
                input_result={},
                expected_result={"tags": build_segment_with_type(segment_type=SegmentType.ARRAY_STRING, value=[])},
            ),
            TransformTestCase(
                name="array_number_parameter_missing",
                parameters=[
                    ParameterConfig(name="scores", type=SegmentType.ARRAY_NUMBER, description="Scores", required=True)
                ],
                input_result={},
                expected_result={"scores": build_segment_with_type(segment_type=SegmentType.ARRAY_NUMBER, value=[])},
            ),
            TransformTestCase(
                name="array_object_parameter_missing",
                parameters=[
                    ParameterConfig(name="items", type=SegmentType.ARRAY_OBJECT, description="Items", required=True)
                ],
                input_result={},
                expected_result={"items": build_segment_with_type(segment_type=SegmentType.ARRAY_OBJECT, value=[])},
            ),
            # Multiple parameters transformation
            TransformTestCase(
                name="multiple_parameters_mixed",
                parameters=[
                    ParameterConfig(name="name", type=SegmentType.STRING, description="Name", required=True),
                    ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True),
                    ParameterConfig(name="active", type=SegmentType.BOOLEAN, description="Active", required=True),
                    ParameterConfig(name="tags", type=SegmentType.ARRAY_STRING, description="Tags", required=True),
                ],
                input_result={"name": "John", "age": 25},
                expected_result={
                    "name": "John",
                    "age": 25,
                    "active": False,
                    "tags": build_segment_with_type(segment_type=SegmentType.ARRAY_STRING, value=[]),
                },
            ),
            # Number parameter transformation with string conversion
            TransformTestCase(
                name="number_parameter_string_to_float",
                parameters=[ParameterConfig(name="price", type=SegmentType.NUMBER, description="Price", required=True)],
                input_result={"price": "19.99"},
                expected_result={"price": 19.99},  # String not converted, falls back to default
            ),
            TransformTestCase(
                name="number_parameter_string_to_int",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                input_result={"age": "25"},
                expected_result={"age": 25},  # String not converted, falls back to default
            ),
            TransformTestCase(
                name="number_parameter_invalid_string",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                input_result={"age": "invalid_number"},
                expected_result={"age": 0},  # Invalid string conversion fails, falls back to default
            ),
            TransformTestCase(
                name="number_parameter_non_string_non_number",
                parameters=[ParameterConfig(name="age", type=SegmentType.NUMBER, description="Age", required=True)],
                input_result={"age": ["not_a_number"]},  # Non-string, non-number value
                expected_result={"age": 0},  # Falls back to default
            ),
            TransformTestCase(
                name="array_number_parameter_with_invalid_string_conversion",
                parameters=[
                    ParameterConfig(name="scores", type=SegmentType.ARRAY_NUMBER, description="Scores", required=True)
                ],
                input_result={"scores": [85, "invalid", "78"]},
                expected_result={
                    "scores": build_segment_with_type(
                        segment_type=SegmentType.ARRAY_NUMBER, value=[85, 78]
                    )  # Invalid string skipped
                },
            ),
        ]

    @pytest.mark.parametrize("test_case", get_transform_test_cases(), ids=TransformTestCase.get_name)
    def test_transform_result_cases(self, test_case):
        """Test _transform_result with various inputs."""
        helper = TestParameterExtractorNodeMethods()

        node_data = ParameterExtractorNodeData(
            title="Test Node",
            model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
            query=["test_query"],
            parameters=test_case.parameters,
            reasoning_mode="function_call",
            vision=VisionConfig(),
        )

        result = helper.transform_result(data=node_data, result=test_case.input_result)
        assert result == test_case.expected_result, (
            f"Failed for case: {test_case.name}. Expected: {test_case.expected_result}, Got: {result}"
        )
