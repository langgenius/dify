"""
Comprehensive unit tests for VariableTruncator class based on current implementation.

This test suite covers all functionality of the current VariableTruncator including:
- JSON size calculation for different data types
- String, array, and object truncation logic
- Segment-based truncation interface
- Helper methods for budget-based truncation
- Edge cases and error handling
"""

import functools
import json
import uuid
from typing import Any
from uuid import uuid4

import pytest

from core.file.enums import FileTransferMethod, FileType
from core.file.models import File
from core.variables.segments import (
    ArrayFileSegment,
    ArrayNumberSegment,
    ArraySegment,
    FileSegment,
    FloatSegment,
    IntegerSegment,
    NoneSegment,
    ObjectSegment,
    StringSegment,
)
from services.variable_truncator import (
    DummyVariableTruncator,
    MaxDepthExceededError,
    TruncationResult,
    UnknownTypeError,
    VariableTruncator,
)


@pytest.fixture
def file() -> File:
    return File(
        id=str(uuid4()),  # Generate new UUID for File.id
        tenant_id=str(uuid.uuid4()),
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        related_id=str(uuid.uuid4()),
        filename="test_file.txt",
        extension=".txt",
        mime_type="text/plain",
        size=1024,
        storage_key="initial_key",
    )


_compact_json_dumps = functools.partial(json.dumps, separators=(",", ":"))


class TestCalculateJsonSize:
    """Test calculate_json_size method with different data types."""

    @pytest.fixture
    def truncator(self):
        return VariableTruncator()

    def test_string_size_calculation(self):
        """Test JSON size calculation for strings."""
        # Simple ASCII string
        assert VariableTruncator.calculate_json_size("hello") == 7  # "hello" + 2 quotes

        # Empty string
        assert VariableTruncator.calculate_json_size("") == 2  # Just quotes

        # Unicode string
        assert VariableTruncator.calculate_json_size("你好") == 4

    def test_number_size_calculation(self, truncator):
        """Test JSON size calculation for numbers."""
        assert truncator.calculate_json_size(123) == 3
        assert truncator.calculate_json_size(12.34) == 5
        assert truncator.calculate_json_size(-456) == 4
        assert truncator.calculate_json_size(0) == 1

    def test_boolean_size_calculation(self, truncator):
        """Test JSON size calculation for booleans."""
        assert truncator.calculate_json_size(True) == 4  # "true"
        assert truncator.calculate_json_size(False) == 5  # "false"

    def test_null_size_calculation(self, truncator):
        """Test JSON size calculation for None/null."""
        assert truncator.calculate_json_size(None) == 4  # "null"

    def test_array_size_calculation(self, truncator):
        """Test JSON size calculation for arrays."""
        # Empty array
        assert truncator.calculate_json_size([]) == 2  # "[]"

        # Simple array
        simple_array = [1, 2, 3]
        # [1,2,3] = 1 + 1 + 1 + 1 + 1 + 2 = 7 (numbers + commas + brackets)
        assert truncator.calculate_json_size(simple_array) == 7

        # Array with strings
        string_array = ["a", "b"]
        # ["a","b"] = 3 + 3 + 1 + 2 = 9 (quoted strings + comma + brackets)
        assert truncator.calculate_json_size(string_array) == 9

    def test_object_size_calculation(self, truncator):
        """Test JSON size calculation for objects."""
        # Empty object
        assert truncator.calculate_json_size({}) == 2  # "{}"

        # Simple object
        simple_obj = {"a": 1}
        # {"a":1} = 3 + 1 + 1 + 2 = 7 (key + colon + value + brackets)
        assert truncator.calculate_json_size(simple_obj) == 7

        # Multiple keys
        multi_obj = {"a": 1, "b": 2}
        # {"a":1,"b":2} = 3 + 1 + 1 + 1 + 3 + 1 + 1 + 2 = 13
        assert truncator.calculate_json_size(multi_obj) == 13

    def test_nested_structure_size_calculation(self, truncator):
        """Test JSON size calculation for nested structures."""
        nested = {"items": [1, 2, {"nested": "value"}]}
        size = truncator.calculate_json_size(nested)
        assert size > 0  # Should calculate without error

        # Verify it matches actual JSON length roughly

        actual_json = _compact_json_dumps(nested)
        # Should be close but not exact due to UTF-8 encoding considerations
        assert abs(size - len(actual_json.encode())) <= 5

    def test_calculate_json_size_max_depth_exceeded(self, truncator):
        """Test that calculate_json_size handles deep nesting gracefully."""
        # Create deeply nested structure
        nested: dict[str, Any] = {"level": 0}
        current = nested
        for i in range(105):  # Create deep nesting
            current["next"] = {"level": i + 1}
            current = current["next"]

        # Should either raise an error or handle gracefully
        with pytest.raises(MaxDepthExceededError):
            truncator.calculate_json_size(nested)

    def test_calculate_json_size_unknown_type(self, truncator):
        """Test that calculate_json_size raises error for unknown types."""

        class CustomType:
            pass

        with pytest.raises(UnknownTypeError):
            truncator.calculate_json_size(CustomType())


class TestStringTruncation:
    LENGTH_LIMIT = 10
    """Test string truncation functionality."""

    @pytest.fixture
    def small_truncator(self):
        return VariableTruncator(string_length_limit=10)

    def test_short_string_no_truncation(self, small_truncator):
        """Test that short strings are not truncated."""
        short_str = "hello"
        result = small_truncator._truncate_string(short_str, self.LENGTH_LIMIT)
        assert result.value == short_str
        assert result.truncated is False
        assert result.value_size == VariableTruncator.calculate_json_size(short_str)

    def test_long_string_truncation(self, small_truncator: VariableTruncator):
        """Test that long strings are truncated with ellipsis."""
        long_str = "this is a very long string that exceeds the limit"
        result = small_truncator._truncate_string(long_str, self.LENGTH_LIMIT)

        assert result.truncated is True
        assert result.value == long_str[:5] + "..."
        assert result.value_size == 10  # 10 chars + "..."

    def test_exact_limit_string(self, small_truncator: VariableTruncator):
        """Test string exactly at limit."""
        exact_str = "1234567890"  # Exactly 10 chars
        result = small_truncator._truncate_string(exact_str, self.LENGTH_LIMIT)
        assert result.value == "12345..."
        assert result.truncated is True
        assert result.value_size == 10


class TestArrayTruncation:
    """Test array truncation functionality."""

    @pytest.fixture
    def small_truncator(self):
        return VariableTruncator(array_element_limit=3, max_size_bytes=100)

    def test_small_array_no_truncation(self, small_truncator: VariableTruncator):
        """Test that small arrays are not truncated."""
        small_array = [1, 2]
        result = small_truncator._truncate_array(small_array, 1000)
        assert result.value == small_array
        assert result.truncated is False

    def test_array_element_limit_truncation(self, small_truncator: VariableTruncator):
        """Test that arrays over element limit are truncated."""
        large_array = [1, 2, 3, 4, 5, 6]  # Exceeds limit of 3
        result = small_truncator._truncate_array(large_array, 1000)

        assert result.truncated is True
        assert result.value == [1, 2, 3]

    def test_array_size_budget_truncation(self, small_truncator: VariableTruncator):
        """Test array truncation due to size budget constraints."""
        # Create array with strings that will exceed size budget
        large_strings = ["very long string " * 5, "another long string " * 5]
        result = small_truncator._truncate_array(large_strings, 50)

        assert result.truncated is True
        # Should have truncated the strings within the array
        for item in result.value:
            assert isinstance(item, str)
        assert VariableTruncator.calculate_json_size(result.value) <= 50

    def test_array_with_nested_objects(self, small_truncator):
        """Test array truncation with nested objects."""
        nested_array = [
            {"name": "item1", "data": "some data"},
            {"name": "item2", "data": "more data"},
            {"name": "item3", "data": "even more data"},
        ]
        result = small_truncator._truncate_array(nested_array, 30)

        assert isinstance(result.value, list)
        assert len(result.value) <= 3
        for item in result.value:
            assert isinstance(item, dict)


class TestObjectTruncation:
    """Test object truncation functionality."""

    @pytest.fixture
    def small_truncator(self):
        return VariableTruncator(max_size_bytes=100)

    def test_small_object_no_truncation(self, small_truncator):
        """Test that small objects are not truncated."""
        small_obj = {"a": 1, "b": 2}
        result = small_truncator._truncate_object(small_obj, 1000)
        assert result.value == small_obj
        assert result.truncated is False

    def test_empty_object_no_truncation(self, small_truncator):
        """Test that empty objects are not truncated."""
        empty_obj = {}
        result = small_truncator._truncate_object(empty_obj, 100)
        assert result.value == empty_obj
        assert result.truncated is False

    def test_object_value_truncation(self, small_truncator):
        """Test object truncation where values are truncated to fit budget."""
        obj_with_long_values = {
            "key1": "very long string " * 10,
            "key2": "another long string " * 10,
            "key3": "third long string " * 10,
        }
        result = small_truncator._truncate_object(obj_with_long_values, 80)

        assert result.truncated is True
        assert isinstance(result.value, dict)

        assert set(result.value.keys()).issubset(obj_with_long_values.keys())

        # Values should be truncated if they exist
        for key, value in result.value.items():
            if isinstance(value, str):
                original_value = obj_with_long_values[key]
                # Value should be same or smaller
                assert len(value) <= len(original_value)

    def test_object_key_dropping(self, small_truncator):
        """Test object truncation where keys are dropped due to size constraints."""
        large_obj = {f"key{i:02d}": f"value{i}" for i in range(20)}
        result = small_truncator._truncate_object(large_obj, 50)

        assert result.truncated is True
        assert len(result.value) < len(large_obj)

        # Should maintain sorted key order
        result_keys = list(result.value.keys())
        assert result_keys == sorted(result_keys)

    def test_object_with_nested_structures(self, small_truncator):
        """Test object truncation with nested arrays and objects."""
        nested_obj = {"simple": "value", "array": [1, 2, 3, 4, 5], "nested": {"inner": "data", "more": ["a", "b", "c"]}}
        result = small_truncator._truncate_object(nested_obj, 60)

        assert isinstance(result.value, dict)


class TestSegmentBasedTruncation:
    """Test the main truncate method that works with Segments."""

    @pytest.fixture
    def truncator(self):
        return VariableTruncator()

    @pytest.fixture
    def small_truncator(self):
        return VariableTruncator(string_length_limit=20, array_element_limit=3, max_size_bytes=200)

    def test_integer_segment_no_truncation(self, truncator):
        """Test that integer segments are never truncated."""
        segment = IntegerSegment(value=12345)
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert result.result == segment

    def test_boolean_as_integer_segment(self, truncator):
        """Test boolean values in IntegerSegment are converted to int."""
        segment = IntegerSegment(value=True)
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert isinstance(result.result, IntegerSegment)
        assert result.result.value == 1  # True converted to 1

    def test_float_segment_no_truncation(self, truncator):
        """Test that float segments are never truncated."""
        segment = FloatSegment(value=123.456)
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert result.result == segment

    def test_none_segment_no_truncation(self, truncator):
        """Test that None segments are never truncated."""
        segment = NoneSegment()
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert result.result == segment

    def test_file_segment_no_truncation(self, truncator, file):
        """Test that file segments are never truncated."""
        file_segment = FileSegment(value=file)
        result = truncator.truncate(file_segment)
        assert result.result == file_segment
        assert result.truncated is False

    def test_array_file_segment_no_truncation(self, truncator, file):
        """Test that array file segments are never truncated."""

        array_file_segment = ArrayFileSegment(value=[file] * 20)
        result = truncator.truncate(array_file_segment)
        assert result.result == array_file_segment
        assert result.truncated is False

    def test_string_segment_small_no_truncation(self, truncator):
        """Test small string segments are not truncated."""
        segment = StringSegment(value="hello world")
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert result.result == segment

    def test_string_segment_large_truncation(self, small_truncator):
        """Test large string segments are truncated."""
        long_text = "this is a very long string that will definitely exceed the limit"
        segment = StringSegment(value=long_text)
        result = small_truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is True
        assert isinstance(result.result, StringSegment)
        assert len(result.result.value) < len(long_text)
        assert result.result.value.endswith("...")

    def test_array_segment_small_no_truncation(self, truncator):
        """Test small array segments are not truncated."""
        from factories.variable_factory import build_segment

        segment = build_segment([1, 2, 3])
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert result.result == segment

    def test_array_segment_large_truncation(self, small_truncator):
        """Test large array segments are truncated."""
        from factories.variable_factory import build_segment

        large_array = list(range(10))  # Exceeds element limit of 3
        segment = build_segment(large_array)
        result = small_truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is True
        assert isinstance(result.result, ArraySegment)
        assert len(result.result.value) <= 3

    def test_object_segment_small_no_truncation(self, truncator):
        """Test small object segments are not truncated."""
        segment = ObjectSegment(value={"key": "value"})
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is False
        assert result.result == segment

    def test_object_segment_large_truncation(self, small_truncator):
        """Test large object segments are truncated."""
        large_obj = {f"key{i}": f"very long value {i}" * 5 for i in range(5)}
        segment = ObjectSegment(value=large_obj)
        result = small_truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is True
        assert isinstance(result.result, ObjectSegment)
        # Object should be smaller or equal than original
        original_size = small_truncator.calculate_json_size(large_obj)
        result_size = small_truncator.calculate_json_size(result.result.value)
        assert result_size <= original_size

    def test_final_size_fallback_to_json_string(self, small_truncator):
        """Test final fallback when truncated result still exceeds size limit."""
        # Create data that will still be large after initial truncation
        large_nested_data = {"data": ["very long string " * 5] * 5, "more": {"nested": "content " * 20}}
        segment = ObjectSegment(value=large_nested_data)

        # Use very small limit to force JSON string fallback
        tiny_truncator = VariableTruncator(max_size_bytes=50)
        result = tiny_truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is True
        assert isinstance(result.result, StringSegment)
        # Should be JSON string with possible truncation
        assert len(result.result.value) <= 53  # 50 + "..." = 53

    def test_final_size_fallback_string_truncation(self, small_truncator):
        """Test final fallback for string that still exceeds limit."""
        # Create very long string that exceeds string length limit
        very_long_string = "x" * 6000  # Exceeds default string_length_limit of 5000
        segment = StringSegment(value=very_long_string)

        # Use small limit to test string fallback path
        tiny_truncator = VariableTruncator(string_length_limit=100, max_size_bytes=50)
        result = tiny_truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is True
        assert isinstance(result.result, StringSegment)
        # Should be truncated due to string limit or final size limit
        assert len(result.result.value) <= 1000  # Much smaller than original


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_empty_inputs(self):
        """Test truncator with empty inputs."""
        truncator = VariableTruncator()

        # Empty string
        result = truncator.truncate(StringSegment(value=""))
        assert not result.truncated
        assert result.result.value == ""

        # Empty array
        from factories.variable_factory import build_segment

        result = truncator.truncate(build_segment([]))
        assert not result.truncated
        assert result.result.value == []

        # Empty object
        result = truncator.truncate(ObjectSegment(value={}))
        assert not result.truncated
        assert result.result.value == {}

    def test_zero_and_negative_limits(self):
        """Test truncator behavior with zero or very small limits."""
        # Zero string limit
        with pytest.raises(ValueError):
            truncator = VariableTruncator(string_length_limit=3)

        with pytest.raises(ValueError):
            truncator = VariableTruncator(array_element_limit=0)

        with pytest.raises(ValueError):
            truncator = VariableTruncator(max_size_bytes=0)

    def test_unicode_and_special_characters(self):
        """Test truncator with unicode and special characters."""
        truncator = VariableTruncator(string_length_limit=10)

        # Unicode characters
        unicode_text = "🌍🚀🌍🚀🌍🚀🌍🚀🌍🚀"  # Each emoji counts as 1 character
        result = truncator.truncate(StringSegment(value=unicode_text))
        if len(unicode_text) > 10:
            assert result.truncated is True

        # Special JSON characters
        special_chars = '{"key": "value with \\"quotes\\" and \\n newlines"}'
        result = truncator.truncate(StringSegment(value=special_chars))
        assert isinstance(result.result, StringSegment)


class TestIntegrationScenarios:
    """Test realistic integration scenarios."""

    def test_workflow_output_scenario(self):
        """Test truncation of typical workflow output data."""
        truncator = VariableTruncator()

        workflow_data = {
            "result": "success",
            "data": {
                "users": [
                    {"id": 1, "name": "Alice", "email": "alice@example.com"},
                    {"id": 2, "name": "Bob", "email": "bob@example.com"},
                ]
                * 3,  # Multiply to make it larger
                "metadata": {
                    "count": 6,
                    "processing_time": "1.23s",
                    "details": "x" * 200,  # Long string but not too long
                },
            },
        }

        segment = ObjectSegment(value=workflow_data)
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert isinstance(result.result, (ObjectSegment, StringSegment))
        # Should handle complex nested structure appropriately

    def test_large_text_processing_scenario(self):
        """Test truncation of large text data."""
        truncator = VariableTruncator(string_length_limit=100)

        large_text = "This is a very long text document. " * 20  # Make it larger than limit

        segment = StringSegment(value=large_text)
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        assert result.truncated is True
        assert isinstance(result.result, StringSegment)
        assert len(result.result.value) <= 103  # 100 + "..."
        assert result.result.value.endswith("...")

    def test_mixed_data_types_scenario(self):
        """Test truncation with mixed data types in complex structure."""
        truncator = VariableTruncator(string_length_limit=30, array_element_limit=3, max_size_bytes=300)

        mixed_data = {
            "strings": ["short", "medium length", "very long string " * 3],
            "numbers": [1, 2.5, 999999],
            "booleans": [True, False, True],
            "nested": {
                "more_strings": ["nested string " * 2],
                "more_numbers": list(range(5)),
                "deep": {"level": 3, "content": "deep content " * 3},
            },
            "nulls": [None, None],
        }

        segment = ObjectSegment(value=mixed_data)
        result = truncator.truncate(segment)

        assert isinstance(result, TruncationResult)
        # Should handle all data types appropriately
        if result.truncated:
            # Verify the result is smaller or equal than original
            original_size = truncator.calculate_json_size(mixed_data)
            if isinstance(result.result, ObjectSegment):
                result_size = truncator.calculate_json_size(result.result.value)
                assert result_size <= original_size

    def test_file_and_array_file_variable_mapping(self, file):
        truncator = VariableTruncator(string_length_limit=30, array_element_limit=3, max_size_bytes=300)

        mapping = {"array_file": [file]}
        truncated_mapping, truncated = truncator.truncate_variable_mapping(mapping)
        assert truncated is False
        assert truncated_mapping == mapping


def test_dummy_variable_truncator_methods():
    """Test DummyVariableTruncator methods work correctly."""
    truncator = DummyVariableTruncator()

    # Test truncate_variable_mapping
    test_data: dict[str, Any] = {
        "key1": "value1",
        "key2": ["item1", "item2"],
        "large_array": list(range(2000)),
    }
    result, is_truncated = truncator.truncate_variable_mapping(test_data)

    assert result == test_data
    assert not is_truncated

    # Test truncate method
    segment = StringSegment(value="test string")
    result = truncator.truncate(segment)
    assert isinstance(result, TruncationResult)
    assert result.result == segment
    assert result.truncated is False

    segment = ArrayNumberSegment(value=list(range(2000)))
    result = truncator.truncate(segment)
    assert isinstance(result, TruncationResult)
    assert result.result == segment
    assert result.truncated is False
