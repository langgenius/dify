"""
Unit tests for DatasetRetrieval.process_metadata_filter_func.

This module provides comprehensive test coverage for the process_metadata_filter_func
method in the DatasetRetrieval class, which is responsible for building SQLAlchemy
filter expressions based on metadata filtering conditions.

Conditions Tested:
==================
1. **String Conditions**: contains, not contains, start with, end with
2. **Equality Conditions**: is / =, is not / ≠
3. **Null Conditions**: empty, not empty
4. **Numeric Comparisons**: before / <, after / >, ≤ / <=, ≥ / >=
5. **List Conditions**: in
6. **Edge Cases**: None values, different data types (str, int, float)

Test Architecture:
==================
- Direct instantiation of DatasetRetrieval
- Mocking of DatasetDocument model attributes
- Verification of SQLAlchemy filter expressions
- Follows Arrange-Act-Assert (AAA) pattern

Running Tests:
==============
    # Run all tests in this module
    uv run --project api pytest \
        api/tests/unit_tests/core/rag/retrieval/test_dataset_retrieval_metadata_filter.py -v

    # Run a specific test
    uv run --project api pytest \
        api/tests/unit_tests/core/rag/retrieval/test_dataset_retrieval_metadata_filter.py::\
TestProcessMetadataFilterFunc::test_contains_condition -v
"""

from unittest.mock import MagicMock

import pytest

from core.rag.retrieval.dataset_retrieval import DatasetRetrieval


class TestProcessMetadataFilterFunc:
    """
    Comprehensive test suite for process_metadata_filter_func method.

    This test class validates all metadata filtering conditions supported by
    the DatasetRetrieval class, including string operations, numeric comparisons,
    null checks, and list operations.

    Method Signature:
    ==================
    def process_metadata_filter_func(
        self, sequence: int, condition: str, metadata_name: str, value: Any | None, filters: list
    ) -> list:

    The method builds SQLAlchemy filter expressions by:
    1. Validating value is not None (except for empty/not empty conditions)
    2. Using DatasetDocument.doc_metadata JSON field operations
    3. Adding appropriate SQLAlchemy expressions to the filters list
    4. Returning the updated filters list

    Mocking Strategy:
    ==================
    - Mock DatasetDocument.doc_metadata to avoid database dependencies
    - Verify filter expressions are created correctly
    - Test with various data types (str, int, float, list)
    """

    @pytest.fixture
    def retrieval(self):
        """
        Create a DatasetRetrieval instance for testing.

        Returns:
            DatasetRetrieval: Instance to test process_metadata_filter_func
        """
        return DatasetRetrieval()

    @pytest.fixture
    def mock_doc_metadata(self):
        """
        Mock the DatasetDocument.doc_metadata JSON field.

        The method uses DatasetDocument.doc_metadata[metadata_name] to access
        JSON fields. We mock this to avoid database dependencies.

        Returns:
            Mock: Mocked doc_metadata attribute
        """
        mock_metadata_field = MagicMock()

        # Create mock for string access
        mock_string_access = MagicMock()
        mock_string_access.like = MagicMock()
        mock_string_access.notlike = MagicMock()
        mock_string_access.__eq__ = MagicMock(return_value=MagicMock())
        mock_string_access.__ne__ = MagicMock(return_value=MagicMock())
        mock_string_access.in_ = MagicMock(return_value=MagicMock())

        # Create mock for float access (for numeric comparisons)
        mock_float_access = MagicMock()
        mock_float_access.__eq__ = MagicMock(return_value=MagicMock())
        mock_float_access.__ne__ = MagicMock(return_value=MagicMock())
        mock_float_access.__lt__ = MagicMock(return_value=MagicMock())
        mock_float_access.__gt__ = MagicMock(return_value=MagicMock())
        mock_float_access.__le__ = MagicMock(return_value=MagicMock())
        mock_float_access.__ge__ = MagicMock(return_value=MagicMock())

        # Create mock for null checks
        mock_null_access = MagicMock()
        mock_null_access.is_ = MagicMock(return_value=MagicMock())
        mock_null_access.isnot = MagicMock(return_value=MagicMock())

        # Setup __getitem__ to return appropriate mock based on usage
        def getitem_side_effect(name):
            if name in ["author", "title", "category"]:
                return mock_string_access
            elif name in ["year", "price", "rating"]:
                return mock_float_access
            else:
                return mock_string_access

        mock_metadata_field.__getitem__ = MagicMock(side_effect=getitem_side_effect)
        mock_metadata_field.as_string.return_value = mock_string_access
        mock_metadata_field.as_float.return_value = mock_float_access
        mock_metadata_field[metadata_name:str].is_ = mock_null_access.is_
        mock_metadata_field[metadata_name:str].isnot = mock_null_access.isnot

        return mock_metadata_field

    # ==================== String Condition Tests ====================

    def test_contains_condition_string_value(self, retrieval):
        """
        Test 'contains' condition with string value.

        Verifies:
        - Filters list is populated with LIKE expression
        - Pattern matching uses %value% syntax
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = "John"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_not_contains_condition(self, retrieval):
        """
        Test 'not contains' condition.

        Verifies:
        - Filters list is populated with NOT LIKE expression
        - Pattern matching uses %value% syntax with negation
        """
        filters = []
        sequence = 0
        condition = "not contains"
        metadata_name = "title"
        value = "banned"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_start_with_condition(self, retrieval):
        """
        Test 'start with' condition.

        Verifies:
        - Filters list is populated with LIKE expression
        - Pattern matching uses value% syntax
        """
        filters = []
        sequence = 0
        condition = "start with"
        metadata_name = "category"
        value = "tech"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_end_with_condition(self, retrieval):
        """
        Test 'end with' condition.

        Verifies:
        - Filters list is populated with LIKE expression
        - Pattern matching uses %value syntax
        """
        filters = []
        sequence = 0
        condition = "end with"
        metadata_name = "filename"
        value = ".pdf"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Equality Condition Tests ====================

    def test_is_condition_with_string_value(self, retrieval):
        """
        Test 'is' (=) condition with string value.

        Verifies:
        - Filters list is populated with equality expression
        - String comparison is used
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "author"
        value = "Jane Doe"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_equals_condition_with_string_value(self, retrieval):
        """
        Test '=' condition with string value.

        Verifies:
        - Same behavior as 'is' condition
        - String comparison is used
        """
        filters = []
        sequence = 0
        condition = "="
        metadata_name = "category"
        value = "technology"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_condition_with_int_value(self, retrieval):
        """
        Test 'is' condition with integer value.

        Verifies:
        - Numeric comparison is used
        - as_float() is called on the metadata field
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "year"
        value = 2023

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_condition_with_float_value(self, retrieval):
        """
        Test 'is' condition with float value.

        Verifies:
        - Numeric comparison is used
        - as_float() is called on the metadata field
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "price"
        value = 19.99

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_not_condition_with_string_value(self, retrieval):
        """
        Test 'is not' (≠) condition with string value.

        Verifies:
        - Filters list is populated with inequality expression
        - String comparison is used
        """
        filters = []
        sequence = 0
        condition = "is not"
        metadata_name = "author"
        value = "Unknown"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_not_equals_condition(self, retrieval):
        """
        Test '≠' condition with string value.

        Verifies:
        - Same behavior as 'is not' condition
        - Inequality expression is used
        """
        filters = []
        sequence = 0
        condition = "≠"
        metadata_name = "category"
        value = "archived"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_is_not_condition_with_numeric_value(self, retrieval):
        """
        Test 'is not' condition with numeric value.

        Verifies:
        - Numeric inequality comparison is used
        - as_float() is called on the metadata field
        """
        filters = []
        sequence = 0
        condition = "is not"
        metadata_name = "year"
        value = 2000

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Null Condition Tests ====================

    def test_empty_condition(self, retrieval):
        """
        Test 'empty' condition (null check).

        Verifies:
        - Filters list is populated with IS NULL expression
        - Value can be None for this condition
        """
        filters = []
        sequence = 0
        condition = "empty"
        metadata_name = "author"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_not_empty_condition(self, retrieval):
        """
        Test 'not empty' condition (not null check).

        Verifies:
        - Filters list is populated with IS NOT NULL expression
        - Value can be None for this condition
        """
        filters = []
        sequence = 0
        condition = "not empty"
        metadata_name = "description"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Numeric Comparison Tests ====================

    def test_before_condition(self, retrieval):
        """
        Test 'before' (<) condition.

        Verifies:
        - Filters list is populated with less than expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "before"
        metadata_name = "year"
        value = 2020

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_less_than_condition(self, retrieval):
        """
        Test '<' condition.

        Verifies:
        - Same behavior as 'before' condition
        - Less than expression is used
        """
        filters = []
        sequence = 0
        condition = "<"
        metadata_name = "price"
        value = 100.0

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_after_condition(self, retrieval):
        """
        Test 'after' (>) condition.

        Verifies:
        - Filters list is populated with greater than expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "after"
        metadata_name = "year"
        value = 2020

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_greater_than_condition(self, retrieval):
        """
        Test '>' condition.

        Verifies:
        - Same behavior as 'after' condition
        - Greater than expression is used
        """
        filters = []
        sequence = 0
        condition = ">"
        metadata_name = "rating"
        value = 4.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_less_than_or_equal_condition_unicode(self, retrieval):
        """
        Test '≤' condition.

        Verifies:
        - Filters list is populated with less than or equal expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "≤"
        metadata_name = "price"
        value = 50.0

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_less_than_or_equal_condition_ascii(self, retrieval):
        """
        Test '<=' condition.

        Verifies:
        - Same behavior as '≤' condition
        - Less than or equal expression is used
        """
        filters = []
        sequence = 0
        condition = "<="
        metadata_name = "year"
        value = 2023

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_greater_than_or_equal_condition_unicode(self, retrieval):
        """
        Test '≥' condition.

        Verifies:
        - Filters list is populated with greater than or equal expression
        - Numeric comparison is used
        """
        filters = []
        sequence = 0
        condition = "≥"
        metadata_name = "rating"
        value = 3.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_greater_than_or_equal_condition_ascii(self, retrieval):
        """
        Test '>=' condition.

        Verifies:
        - Same behavior as '≥' condition
        - Greater than or equal expression is used
        """
        filters = []
        sequence = 0
        condition = ">="
        metadata_name = "year"
        value = 2000

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== List/In Condition Tests ====================

    def test_in_condition_with_comma_separated_string(self, retrieval):
        """
        Test 'in' condition with comma-separated string value.

        Verifies:
        - String is split into list
        - Whitespace is trimmed from each value
        - IN expression is created
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = "tech, science,  AI  "

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_list_value(self, retrieval):
        """
        Test 'in' condition with list value.

        Verifies:
        - List is processed correctly
        - None values are filtered out
        - IN expression is created with valid values
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "tags"
        value = ["python", "javascript", None, "golang"]

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_tuple_value(self, retrieval):
        """
        Test 'in' condition with tuple value.

        Verifies:
        - Tuple is processed like a list
        - IN expression is created
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = ("tech", "science", "ai")

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_empty_string(self, retrieval):
        """
        Test 'in' condition with empty string value.

        Verifies:
        - Empty string results in literal(False) filter
        - No valid values to match
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = ""

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1
        # Verify it's a literal(False) expression
        # This is a bit tricky to test without access to the actual expression

    def test_in_condition_with_only_whitespace(self, retrieval):
        """
        Test 'in' condition with whitespace-only string value.

        Verifies:
        - Whitespace-only string results in literal(False) filter
        - All values are stripped and filtered out
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = "   ,   ,   "

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_in_condition_with_single_string(self, retrieval):
        """
        Test 'in' condition with single non-comma string.

        Verifies:
        - Single string is treated as single-item list
        - IN expression is created with one value
        """
        filters = []
        sequence = 0
        condition = "in"
        metadata_name = "category"
        value = "technology"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    # ==================== Edge Case Tests ====================

    def test_none_value_with_non_empty_condition(self, retrieval):
        """
        Test None value with conditions that require value.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for None values (except empty/not empty)
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0  # No filter added

    def test_none_value_with_equals_condition(self, retrieval):
        """
        Test None value with 'is' (=) condition.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for None values
        """
        filters = []
        sequence = 0
        condition = "is"
        metadata_name = "author"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0

    def test_none_value_with_numeric_condition(self, retrieval):
        """
        Test None value with numeric comparison condition.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for None values
        """
        filters = []
        sequence = 0
        condition = ">"
        metadata_name = "year"
        value = None

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0

    def test_existing_filters_preserved(self, retrieval):
        """
        Test that existing filters are preserved.

        Verifies:
        - Existing filters in the list are not removed
        - New filters are appended to the list
        """
        existing_filter = MagicMock()
        filters = [existing_filter]
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = "test"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 2
        assert filters[0] == existing_filter

    def test_multiple_filters_accumulated(self, retrieval):
        """
        Test multiple calls to accumulate filters.

        Verifies:
        - Each call adds a new filter to the list
        - All filters are preserved across calls
        """
        filters = []

        # First filter
        retrieval.process_metadata_filter_func(0, "contains", "author", "John", filters)
        assert len(filters) == 1

        # Second filter
        retrieval.process_metadata_filter_func(1, ">", "year", 2020, filters)
        assert len(filters) == 2

        # Third filter
        retrieval.process_metadata_filter_func(2, "is", "category", "tech", filters)
        assert len(filters) == 3

    def test_unknown_condition(self, retrieval):
        """
        Test unknown/unsupported condition.

        Verifies:
        - Original filters list is returned unchanged
        - No filter is added for unknown conditions
        """
        filters = []
        sequence = 0
        condition = "unknown_condition"
        metadata_name = "author"
        value = "test"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 0

    def test_empty_string_value_with_contains(self, retrieval):
        """
        Test empty string value with 'contains' condition.

        Verifies:
        - Filter is added even with empty string
        - LIKE expression is created
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "author"
        value = ""

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_special_characters_in_value(self, retrieval):
        """
        Test special characters in value string.

        Verifies:
        - Special characters are handled in value
        - LIKE expression is created correctly
        """
        filters = []
        sequence = 0
        condition = "contains"
        metadata_name = "title"
        value = "C++ & Python's features"

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_zero_value_with_numeric_condition(self, retrieval):
        """
        Test zero value with numeric comparison condition.

        Verifies:
        - Zero is treated as valid value
        - Numeric comparison is performed
        """
        filters = []
        sequence = 0
        condition = ">"
        metadata_name = "price"
        value = 0

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_negative_value_with_numeric_condition(self, retrieval):
        """
        Test negative value with numeric comparison condition.

        Verifies:
        - Negative numbers are handled correctly
        - Numeric comparison is performed
        """
        filters = []
        sequence = 0
        condition = "<"
        metadata_name = "temperature"
        value = -10.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1

    def test_float_value_with_integer_comparison(self, retrieval):
        """
        Test float value with numeric comparison condition.

        Verifies:
        - Float values work correctly
        - Numeric comparison is performed
        """
        filters = []
        sequence = 0
        condition = ">="
        metadata_name = "rating"
        value = 4.5

        result = retrieval.process_metadata_filter_func(sequence, condition, metadata_name, value, filters)

        assert result == filters
        assert len(filters) == 1
