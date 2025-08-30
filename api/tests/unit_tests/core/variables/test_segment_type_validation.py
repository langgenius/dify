"""
Comprehensive unit tests for SegmentType.is_valid and SegmentType._validate_array methods.

This module provides thorough testing of the validation logic for all SegmentType values,
including edge cases, error conditions, and different ArrayValidation strategies.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from core.file.enums import FileTransferMethod, FileType
from core.file.models import File
from core.variables.types import ArrayValidation, SegmentType


def create_test_file(
    file_type: FileType = FileType.DOCUMENT,
    transfer_method: FileTransferMethod = FileTransferMethod.LOCAL_FILE,
    filename: str = "test.txt",
    extension: str = ".txt",
    mime_type: str = "text/plain",
    size: int = 1024,
) -> File:
    """Factory function to create File objects for testing."""
    return File(
        tenant_id="test-tenant",
        type=file_type,
        transfer_method=transfer_method,
        filename=filename,
        extension=extension,
        mime_type=mime_type,
        size=size,
        related_id="test-file-id" if transfer_method != FileTransferMethod.REMOTE_URL else None,
        remote_url="https://example.com/file.txt" if transfer_method == FileTransferMethod.REMOTE_URL else None,
        storage_key="test-storage-key",
    )


@dataclass
class ValidationTestCase:
    """Test case data structure for validation tests."""

    segment_type: SegmentType
    value: Any
    expected: bool
    description: str

    def get_id(self):
        return self.description


@dataclass
class ArrayValidationTestCase:
    """Test case data structure for array validation tests."""

    segment_type: SegmentType
    value: Any
    array_validation: ArrayValidation
    expected: bool
    description: str

    def get_id(self):
        return self.description


# Test data construction functions
def get_boolean_cases() -> list[ValidationTestCase]:
    return [
        # valid values
        ValidationTestCase(SegmentType.BOOLEAN, True, True, "True boolean"),
        ValidationTestCase(SegmentType.BOOLEAN, False, True, "False boolean"),
        # Invalid values
        ValidationTestCase(SegmentType.BOOLEAN, 1, False, "Integer 1 (not boolean)"),
        ValidationTestCase(SegmentType.BOOLEAN, 0, False, "Integer 0 (not boolean)"),
        ValidationTestCase(SegmentType.BOOLEAN, "true", False, "String 'true'"),
        ValidationTestCase(SegmentType.BOOLEAN, "false", False, "String 'false'"),
        ValidationTestCase(SegmentType.BOOLEAN, None, False, "None value"),
        ValidationTestCase(SegmentType.BOOLEAN, [], False, "Empty list"),
        ValidationTestCase(SegmentType.BOOLEAN, {}, False, "Empty dict"),
    ]


def get_number_cases() -> list[ValidationTestCase]:
    """Get test cases for valid number values."""
    return [
        # valid values
        ValidationTestCase(SegmentType.NUMBER, 42, True, "Positive integer"),
        ValidationTestCase(SegmentType.NUMBER, -42, True, "Negative integer"),
        ValidationTestCase(SegmentType.NUMBER, 0, True, "Zero integer"),
        ValidationTestCase(SegmentType.NUMBER, 3.14, True, "Positive float"),
        ValidationTestCase(SegmentType.NUMBER, -3.14, True, "Negative float"),
        ValidationTestCase(SegmentType.NUMBER, 0.0, True, "Zero float"),
        ValidationTestCase(SegmentType.NUMBER, float("inf"), True, "Positive infinity"),
        ValidationTestCase(SegmentType.NUMBER, float("-inf"), True, "Negative infinity"),
        ValidationTestCase(SegmentType.NUMBER, float("nan"), True, "float(NaN)"),
        # invalid number values
        ValidationTestCase(SegmentType.NUMBER, "42", False, "String number"),
        ValidationTestCase(SegmentType.NUMBER, None, False, "None value"),
        ValidationTestCase(SegmentType.NUMBER, [], False, "Empty list"),
        ValidationTestCase(SegmentType.NUMBER, {}, False, "Empty dict"),
        ValidationTestCase(SegmentType.NUMBER, "3.14", False, "String float"),
    ]


def get_string_cases() -> list[ValidationTestCase]:
    """Get test cases for valid string values."""
    return [
        # valid values
        ValidationTestCase(SegmentType.STRING, "", True, "Empty string"),
        ValidationTestCase(SegmentType.STRING, "hello", True, "Simple string"),
        ValidationTestCase(SegmentType.STRING, "🚀", True, "Unicode emoji"),
        ValidationTestCase(SegmentType.STRING, "line1\nline2", True, "Multiline string"),
        # invalid values
        ValidationTestCase(SegmentType.STRING, 123, False, "Integer"),
        ValidationTestCase(SegmentType.STRING, 3.14, False, "Float"),
        ValidationTestCase(SegmentType.STRING, True, False, "Boolean"),
        ValidationTestCase(SegmentType.STRING, None, False, "None value"),
        ValidationTestCase(SegmentType.STRING, [], False, "Empty list"),
        ValidationTestCase(SegmentType.STRING, {}, False, "Empty dict"),
    ]


def get_object_cases() -> list[ValidationTestCase]:
    """Get test cases for valid object values."""
    return [
        # valid cases
        ValidationTestCase(SegmentType.OBJECT, {}, True, "Empty dict"),
        ValidationTestCase(SegmentType.OBJECT, {"key": "value"}, True, "Simple dict"),
        ValidationTestCase(SegmentType.OBJECT, {"a": 1, "b": 2}, True, "Dict with numbers"),
        ValidationTestCase(SegmentType.OBJECT, {"nested": {"key": "value"}}, True, "Nested dict"),
        ValidationTestCase(SegmentType.OBJECT, {"list": [1, 2, 3]}, True, "Dict with list"),
        ValidationTestCase(SegmentType.OBJECT, {"mixed": [1, "two", {"three": 3}]}, True, "Complex dict"),
        # invalid cases
        ValidationTestCase(SegmentType.OBJECT, "not a dict", False, "String"),
        ValidationTestCase(SegmentType.OBJECT, 123, False, "Integer"),
        ValidationTestCase(SegmentType.OBJECT, 3.14, False, "Float"),
        ValidationTestCase(SegmentType.OBJECT, True, False, "Boolean"),
        ValidationTestCase(SegmentType.OBJECT, None, False, "None value"),
        ValidationTestCase(SegmentType.OBJECT, [], False, "Empty list"),
        ValidationTestCase(SegmentType.OBJECT, [1, 2, 3], False, "List with values"),
    ]


def get_secret_cases() -> list[ValidationTestCase]:
    """Get test cases for valid secret values."""
    return [
        # valid cases
        ValidationTestCase(SegmentType.SECRET, "", True, "Empty secret"),
        ValidationTestCase(SegmentType.SECRET, "secret", True, "Simple secret"),
        ValidationTestCase(SegmentType.SECRET, "api_key_123", True, "API key format"),
        ValidationTestCase(SegmentType.SECRET, "very_long_secret_key_with_special_chars!@#", True, "Complex secret"),
        # invalid cases
        ValidationTestCase(SegmentType.SECRET, 123, False, "Integer"),
        ValidationTestCase(SegmentType.SECRET, 3.14, False, "Float"),
        ValidationTestCase(SegmentType.SECRET, True, False, "Boolean"),
        ValidationTestCase(SegmentType.SECRET, None, False, "None value"),
        ValidationTestCase(SegmentType.SECRET, [], False, "Empty list"),
        ValidationTestCase(SegmentType.SECRET, {}, False, "Empty dict"),
    ]


def get_file_cases() -> list[ValidationTestCase]:
    """Get test cases for valid file values."""
    test_file = create_test_file()
    image_file = create_test_file(
        file_type=FileType.IMAGE, filename="image.jpg", extension=".jpg", mime_type="image/jpeg"
    )
    remote_file = create_test_file(
        transfer_method=FileTransferMethod.REMOTE_URL, filename="remote.pdf", extension=".pdf"
    )

    return [
        # valid cases
        ValidationTestCase(SegmentType.FILE, test_file, True, "Document file"),
        ValidationTestCase(SegmentType.FILE, image_file, True, "Image file"),
        ValidationTestCase(SegmentType.FILE, remote_file, True, "Remote file"),
        # invalid cases
        ValidationTestCase(SegmentType.FILE, "not a file", False, "String"),
        ValidationTestCase(SegmentType.FILE, 123, False, "Integer"),
        ValidationTestCase(SegmentType.FILE, {"filename": "test.txt"}, False, "Dict resembling file"),
        ValidationTestCase(SegmentType.FILE, None, False, "None value"),
        ValidationTestCase(SegmentType.FILE, [], False, "Empty list"),
        ValidationTestCase(SegmentType.FILE, True, False, "Boolean"),
    ]


def get_none_cases() -> list[ValidationTestCase]:
    """Get test cases for valid none values."""
    return [
        # valid cases
        ValidationTestCase(SegmentType.NONE, None, True, "None value"),
        # invalid cases
        ValidationTestCase(SegmentType.NONE, "", False, "Empty string"),
        ValidationTestCase(SegmentType.NONE, 0, False, "Zero integer"),
        ValidationTestCase(SegmentType.NONE, 0.0, False, "Zero float"),
        ValidationTestCase(SegmentType.NONE, False, False, "False boolean"),
        ValidationTestCase(SegmentType.NONE, [], False, "Empty list"),
        ValidationTestCase(SegmentType.NONE, {}, False, "Empty dict"),
        ValidationTestCase(SegmentType.NONE, "null", False, "String 'null'"),
    ]


def get_array_any_validation_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_ANY validation."""
    return [
        ArrayValidationTestCase(
            SegmentType.ARRAY_ANY,
            [1, "string", 3.14, {"key": "value"}, True],
            ArrayValidation.NONE,
            True,
            "Mixed types with NONE validation",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_ANY,
            [1, "string", 3.14, {"key": "value"}, True],
            ArrayValidation.FIRST,
            True,
            "Mixed types with FIRST validation",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_ANY,
            [1, "string", 3.14, {"key": "value"}, True],
            ArrayValidation.ALL,
            True,
            "Mixed types with ALL validation",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_ANY, [None, None, None], ArrayValidation.ALL, True, "All None values"
        ),
    ]


def get_array_string_validation_none_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_STRING validation with NONE strategy."""
    return [
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING,
            ["hello", "world"],
            ArrayValidation.NONE,
            True,
            "Valid strings with NONE validation",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING,
            [123, 456],
            ArrayValidation.NONE,
            True,
            "Invalid elements with NONE validation",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING,
            ["valid", 123, True],
            ArrayValidation.NONE,
            True,
            "Mixed types with NONE validation",
        ),
    ]


def get_array_string_validation_first_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_STRING validation with FIRST strategy."""
    return [
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING, ["hello", "world"], ArrayValidation.FIRST, True, "All valid strings"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING,
            ["hello", 123, True],
            ArrayValidation.FIRST,
            True,
            "First valid, others invalid",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING,
            [123, "hello", "world"],
            ArrayValidation.FIRST,
            False,
            "First invalid, others valid",
        ),
        ArrayValidationTestCase(SegmentType.ARRAY_STRING, [None, "hello"], ArrayValidation.FIRST, False, "First None"),
    ]


def get_array_string_validation_all_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_STRING validation with ALL strategy."""
    return [
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING, ["hello", "world", "test"], ArrayValidation.ALL, True, "All valid strings"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING, ["hello", 123, "world"], ArrayValidation.ALL, False, "One invalid element"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING, [123, 456, 789], ArrayValidation.ALL, False, "All invalid elements"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_STRING, ["valid", None, "also_valid"], ArrayValidation.ALL, False, "Contains None"
        ),
    ]


def get_array_number_validation_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_NUMBER validation with different strategies."""
    return [
        # NONE strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, [1, 2.5, 3], ArrayValidation.NONE, True, "Valid numbers with NONE"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, ["not", "numbers"], ArrayValidation.NONE, True, "Invalid elements with NONE"
        ),
        # FIRST strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, [42, "not a number"], ArrayValidation.FIRST, True, "First valid number"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, ["not a number", 42], ArrayValidation.FIRST, False, "First invalid"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, [3.14, 2.71, 1.41], ArrayValidation.FIRST, True, "All valid floats"
        ),
        # ALL strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, [1, 2, 3, 4.5], ArrayValidation.ALL, True, "All valid numbers"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER, [1, "invalid", 3], ArrayValidation.ALL, False, "One invalid element"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_NUMBER,
            [float("inf"), float("-inf"), float("nan")],
            ArrayValidation.ALL,
            True,
            "Special float values",
        ),
    ]


def get_array_object_validation_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_OBJECT validation with different strategies."""
    return [
        # NONE strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_OBJECT, [{}, {"key": "value"}], ArrayValidation.NONE, True, "Valid objects with NONE"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_OBJECT, ["not", "objects"], ArrayValidation.NONE, True, "Invalid elements with NONE"
        ),
        # FIRST strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_OBJECT,
            [{"valid": "object"}, "not an object"],
            ArrayValidation.FIRST,
            True,
            "First valid object",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_OBJECT,
            ["not an object", {"valid": "object"}],
            ArrayValidation.FIRST,
            False,
            "First invalid",
        ),
        # ALL strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_OBJECT,
            [{}, {"a": 1}, {"nested": {"key": "value"}}],
            ArrayValidation.ALL,
            True,
            "All valid objects",
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_OBJECT,
            [{"valid": "object"}, "invalid", {"another": "object"}],
            ArrayValidation.ALL,
            False,
            "One invalid element",
        ),
    ]


def get_array_file_validation_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_FILE validation with different strategies."""
    file1 = create_test_file(filename="file1.txt")
    file2 = create_test_file(filename="file2.txt")

    return [
        # NONE strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_FILE, [file1, file2], ArrayValidation.NONE, True, "Valid files with NONE"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_FILE, ["not", "files"], ArrayValidation.NONE, True, "Invalid elements with NONE"
        ),
        # FIRST strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_FILE, [file1, "not a file"], ArrayValidation.FIRST, True, "First valid file"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_FILE, ["not a file", file1], ArrayValidation.FIRST, False, "First invalid"
        ),
        # ALL strategy
        ArrayValidationTestCase(SegmentType.ARRAY_FILE, [file1, file2], ArrayValidation.ALL, True, "All valid files"),
        ArrayValidationTestCase(
            SegmentType.ARRAY_FILE, [file1, "invalid", file2], ArrayValidation.ALL, False, "One invalid element"
        ),
    ]


def get_array_boolean_validation_cases() -> list[ArrayValidationTestCase]:
    """Get test cases for ARRAY_BOOLEAN validation with different strategies."""
    return [
        # NONE strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [True, False, True], ArrayValidation.NONE, True, "Valid booleans with NONE"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [1, 0, "true"], ArrayValidation.NONE, True, "Invalid elements with NONE"
        ),
        # FIRST strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [True, 1, 0], ArrayValidation.FIRST, True, "First valid boolean"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [1, True, False], ArrayValidation.FIRST, False, "First invalid (integer 1)"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [0, True, False], ArrayValidation.FIRST, False, "First invalid (integer 0)"
        ),
        # ALL strategy
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [True, False, True, False], ArrayValidation.ALL, True, "All valid booleans"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN, [True, 1, False], ArrayValidation.ALL, False, "One invalid element (integer)"
        ),
        ArrayValidationTestCase(
            SegmentType.ARRAY_BOOLEAN,
            [True, "false", False],
            ArrayValidation.ALL,
            False,
            "One invalid element (string)",
        ),
    ]


class TestSegmentTypeIsValid:
    """Test suite for SegmentType.is_valid method covering all non-array types."""

    @pytest.mark.parametrize("case", get_boolean_cases(), ids=lambda case: case.description)
    def test_boolean_validation(self, case):
        assert case.segment_type.is_valid(case.value) == case.expected

    @pytest.mark.parametrize("case", get_number_cases(), ids=lambda case: case.description)
    def test_number_validation(self, case: ValidationTestCase):
        assert case.segment_type.is_valid(case.value) == case.expected

    @pytest.mark.parametrize("case", get_string_cases(), ids=lambda case: case.description)
    def test_string_validation(self, case):
        assert case.segment_type.is_valid(case.value) == case.expected

    @pytest.mark.parametrize("case", get_object_cases(), ids=lambda case: case.description)
    def test_object_validation(self, case):
        assert case.segment_type.is_valid(case.value) == case.expected

    @pytest.mark.parametrize("case", get_secret_cases(), ids=lambda case: case.description)
    def test_secret_validation(self, case):
        assert case.segment_type.is_valid(case.value) == case.expected

    @pytest.mark.parametrize("case", get_file_cases(), ids=lambda case: case.description)
    def test_file_validation(self, case):
        assert case.segment_type.is_valid(case.value) == case.expected

    @pytest.mark.parametrize("case", get_none_cases(), ids=lambda case: case.description)
    def test_none_validation_valid_cases(self, case):
        assert case.segment_type.is_valid(case.value) == case.expected

    def test_unsupported_segment_type_raises_assertion_error(self):
        """Test that unsupported SegmentType values raise AssertionError."""
        # GROUP is not handled in is_valid method
        with pytest.raises(AssertionError, match="this statement should be unreachable"):
            SegmentType.GROUP.is_valid("any value")


class TestSegmentTypeArrayValidation:
    """Test suite for SegmentType._validate_array method and array type validation."""

    def test_array_validation_non_list_values(self):
        """Test that non-list values return False for all array types."""
        array_types = [
            SegmentType.ARRAY_ANY,
            SegmentType.ARRAY_STRING,
            SegmentType.ARRAY_NUMBER,
            SegmentType.ARRAY_OBJECT,
            SegmentType.ARRAY_FILE,
            SegmentType.ARRAY_BOOLEAN,
        ]

        non_list_values = [
            "not a list",
            123,
            3.14,
            True,
            None,
            {"key": "value"},
            create_test_file(),
        ]

        for array_type in array_types:
            for value in non_list_values:
                assert array_type.is_valid(value) is False, f"{array_type} should reject {type(value).__name__}"

    def test_empty_array_validation(self):
        """Test that empty arrays are valid for all array types regardless of validation strategy."""
        array_types = [
            SegmentType.ARRAY_ANY,
            SegmentType.ARRAY_STRING,
            SegmentType.ARRAY_NUMBER,
            SegmentType.ARRAY_OBJECT,
            SegmentType.ARRAY_FILE,
            SegmentType.ARRAY_BOOLEAN,
        ]

        validation_strategies = [ArrayValidation.NONE, ArrayValidation.FIRST, ArrayValidation.ALL]

        for array_type in array_types:
            for strategy in validation_strategies:
                assert array_type.is_valid([], strategy) is True, (
                    f"{array_type} should accept empty array with {strategy}"
                )

    @pytest.mark.parametrize("case", get_array_any_validation_cases(), ids=lambda case: case.description)
    def test_array_any_validation(self, case):
        """Test ARRAY_ANY validation accepts any list regardless of content."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_string_validation_none_cases(), ids=lambda case: case.description)
    def test_array_string_validation_with_none_strategy(self, case):
        """Test ARRAY_STRING validation with NONE strategy (no element validation)."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_string_validation_first_cases(), ids=lambda case: case.description)
    def test_array_string_validation_with_first_strategy(self, case):
        """Test ARRAY_STRING validation with FIRST strategy (validate first element only)."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_string_validation_all_cases(), ids=lambda case: case.description)
    def test_array_string_validation_with_all_strategy(self, case):
        """Test ARRAY_STRING validation with ALL strategy (validate all elements)."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_number_validation_cases(), ids=lambda case: case.description)
    def test_array_number_validation_with_different_strategies(self, case):
        """Test ARRAY_NUMBER validation with different validation strategies."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_object_validation_cases(), ids=lambda case: case.description)
    def test_array_object_validation_with_different_strategies(self, case):
        """Test ARRAY_OBJECT validation with different validation strategies."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_file_validation_cases(), ids=lambda case: case.description)
    def test_array_file_validation_with_different_strategies(self, case):
        """Test ARRAY_FILE validation with different validation strategies."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    @pytest.mark.parametrize("case", get_array_boolean_validation_cases(), ids=lambda case: case.description)
    def test_array_boolean_validation_with_different_strategies(self, case):
        """Test ARRAY_BOOLEAN validation with different validation strategies."""
        assert case.segment_type.is_valid(case.value, case.array_validation) == case.expected

    def test_default_array_validation_strategy(self):
        """Test that default array validation strategy is FIRST."""
        # When no array_validation parameter is provided, it should default to FIRST
        assert SegmentType.ARRAY_STRING.is_valid(["valid", 123]) is False  # First element valid
        assert SegmentType.ARRAY_STRING.is_valid([123, "valid"]) is False  # First element invalid

        assert SegmentType.ARRAY_NUMBER.is_valid([42, "invalid"]) is False  # First element valid
        assert SegmentType.ARRAY_NUMBER.is_valid(["invalid", 42]) is False  # First element invalid

    def test_array_validation_edge_cases(self):
        """Test edge cases for array validation."""
        # Test with nested arrays (should be invalid for specific array types)
        nested_array = [["nested", "array"], ["another", "nested"]]

        assert SegmentType.ARRAY_STRING.is_valid(nested_array, ArrayValidation.FIRST) is False
        assert SegmentType.ARRAY_STRING.is_valid(nested_array, ArrayValidation.ALL) is False
        assert SegmentType.ARRAY_ANY.is_valid(nested_array, ArrayValidation.ALL) is True

        # Test with very large arrays (performance consideration)
        large_valid_array = ["string"] * 1000
        large_mixed_array = ["string"] * 999 + [123]  # Last element invalid

        assert SegmentType.ARRAY_STRING.is_valid(large_valid_array, ArrayValidation.ALL) is True
        assert SegmentType.ARRAY_STRING.is_valid(large_mixed_array, ArrayValidation.ALL) is False
        assert SegmentType.ARRAY_STRING.is_valid(large_mixed_array, ArrayValidation.FIRST) is True


class TestSegmentTypeValidationIntegration:
    """Integration tests for SegmentType validation covering interactions between methods."""

    def test_non_array_types_ignore_array_validation_parameter(self):
        """Test that non-array types ignore the array_validation parameter."""
        non_array_types = [
            SegmentType.STRING,
            SegmentType.NUMBER,
            SegmentType.BOOLEAN,
            SegmentType.OBJECT,
            SegmentType.SECRET,
            SegmentType.FILE,
            SegmentType.NONE,
        ]

        for segment_type in non_array_types:
            # Create appropriate valid value for each type
            valid_value: Any
            if segment_type == SegmentType.STRING:
                valid_value = "test"
            elif segment_type == SegmentType.NUMBER:
                valid_value = 42
            elif segment_type == SegmentType.BOOLEAN:
                valid_value = True
            elif segment_type == SegmentType.OBJECT:
                valid_value = {"key": "value"}
            elif segment_type == SegmentType.SECRET:
                valid_value = "secret"
            elif segment_type == SegmentType.FILE:
                valid_value = create_test_file()
            elif segment_type == SegmentType.NONE:
                valid_value = None
            else:
                continue  # Skip unsupported types

            # All array validation strategies should give the same result
            result_none = segment_type.is_valid(valid_value, ArrayValidation.NONE)
            result_first = segment_type.is_valid(valid_value, ArrayValidation.FIRST)
            result_all = segment_type.is_valid(valid_value, ArrayValidation.ALL)

            assert result_none == result_first == result_all == True, (
                f"{segment_type} should ignore array_validation parameter"
            )

    def test_comprehensive_type_coverage(self):
        """Test that all SegmentType enum values are covered in validation tests."""
        all_segment_types = set(SegmentType)

        # Types that should be handled by is_valid method
        handled_types = {
            # Non-array types
            SegmentType.STRING,
            SegmentType.NUMBER,
            SegmentType.BOOLEAN,
            SegmentType.OBJECT,
            SegmentType.SECRET,
            SegmentType.FILE,
            SegmentType.NONE,
            # Array types
            SegmentType.ARRAY_ANY,
            SegmentType.ARRAY_STRING,
            SegmentType.ARRAY_NUMBER,
            SegmentType.ARRAY_OBJECT,
            SegmentType.ARRAY_FILE,
            SegmentType.ARRAY_BOOLEAN,
        }

        # Types that are not handled by is_valid (should raise AssertionError)
        unhandled_types = {
            SegmentType.GROUP,
            SegmentType.INTEGER,  # Handled by NUMBER validation logic
            SegmentType.FLOAT,  # Handled by NUMBER validation logic
        }

        # Verify all types are accounted for
        assert handled_types | unhandled_types == all_segment_types, "All SegmentType values should be categorized"

        # Test that handled types work correctly
        for segment_type in handled_types:
            if segment_type.is_array_type():
                # Test with empty array (should always be valid)
                assert segment_type.is_valid([]) is True, f"{segment_type} should accept empty array"
            else:
                # Test with appropriate valid value
                if segment_type == SegmentType.STRING:
                    assert segment_type.is_valid("test") is True
                elif segment_type == SegmentType.NUMBER:
                    assert segment_type.is_valid(42) is True
                elif segment_type == SegmentType.BOOLEAN:
                    assert segment_type.is_valid(True) is True
                elif segment_type == SegmentType.OBJECT:
                    assert segment_type.is_valid({}) is True
                elif segment_type == SegmentType.SECRET:
                    assert segment_type.is_valid("secret") is True
                elif segment_type == SegmentType.FILE:
                    assert segment_type.is_valid(create_test_file()) is True
                elif segment_type == SegmentType.NONE:
                    assert segment_type.is_valid(None) is True

    def test_boolean_vs_integer_type_distinction(self):
        """Test the important distinction between boolean and integer types in validation."""
        # This tests the comment in the code about bool being a subclass of int

        # Boolean type should only accept actual booleans, not integers
        assert SegmentType.BOOLEAN.is_valid(True) is True
        assert SegmentType.BOOLEAN.is_valid(False) is True
        assert SegmentType.BOOLEAN.is_valid(1) is False  # Integer 1, not boolean
        assert SegmentType.BOOLEAN.is_valid(0) is False  # Integer 0, not boolean

        # Number type should accept both integers and floats, including booleans (since bool is subclass of int)
        assert SegmentType.NUMBER.is_valid(42) is True
        assert SegmentType.NUMBER.is_valid(3.14) is True
        assert SegmentType.NUMBER.is_valid(True) is True  # bool is subclass of int
        assert SegmentType.NUMBER.is_valid(False) is True  # bool is subclass of int

    def test_array_validation_recursive_behavior(self):
        """Test that array validation correctly handles recursive validation calls."""
        # When validating array elements, _validate_array calls is_valid recursively
        # with ArrayValidation.NONE to avoid infinite recursion

        # Test nested validation doesn't cause issues
        nested_arrays = [["inner", "array"], ["another", "inner"]]

        # ARRAY_ANY should accept nested arrays
        assert SegmentType.ARRAY_ANY.is_valid(nested_arrays, ArrayValidation.ALL) is True

        # ARRAY_STRING should reject nested arrays (first element is not a string)
        assert SegmentType.ARRAY_STRING.is_valid(nested_arrays, ArrayValidation.FIRST) is False
        assert SegmentType.ARRAY_STRING.is_valid(nested_arrays, ArrayValidation.ALL) is False
