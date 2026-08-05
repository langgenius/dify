import pytest

from graphon.variables.segment_group import SegmentGroup
from graphon.variables.segments import StringSegment
from graphon.variables.types import ArrayValidation, SegmentType


class TestSegmentTypeIsArrayType:
    """
    Test class for SegmentType.is_array_type method.

    Provides comprehensive coverage of all SegmentType values to ensure
    correct identification of array and non-array types.
    """

    def test_is_array_type(self):
        """
        Test that all SegmentType enum values are covered in our test cases.

        Ensures comprehensive coverage by verifying that every SegmentType
        value is tested for the is_array_type method.
        """
        # Arrange
        expected_array_types = [
            SegmentType.ARRAY_ANY,
            SegmentType.ARRAY_STRING,
            SegmentType.ARRAY_NUMBER,
            SegmentType.ARRAY_OBJECT,
            SegmentType.ARRAY_FILE,
            SegmentType.ARRAY_BOOLEAN,
        ]
        expected_non_array_types = [
            SegmentType.INTEGER,
            SegmentType.FLOAT,
            SegmentType.NUMBER,
            SegmentType.STRING,
            SegmentType.OBJECT,
            SegmentType.SECRET,
            SegmentType.FILE,
            SegmentType.NONE,
            SegmentType.GROUP,
            SegmentType.BOOLEAN,
        ]

        for seg_type in expected_array_types:
            assert seg_type.is_array_type()

        for seg_type in expected_non_array_types:
            assert not seg_type.is_array_type()

        # Act & Assert
        covered_types = set(expected_array_types) | set(expected_non_array_types)
        assert covered_types == set(SegmentType), "All SegmentType values should be covered in tests"

    def test_all_enum_values_are_supported(self):
        """
        Test that all enum values are supported and return boolean values.

        Validates that every SegmentType enum value can be processed by
        is_array_type method and returns a boolean value.
        """
        enum_values: list[SegmentType] = list(SegmentType)
        for seg_type in enum_values:
            is_array = seg_type.is_array_type()
            assert isinstance(is_array, bool), f"is_array_type does not return a boolean for segment type {seg_type}"


class TestSegmentTypeIsValidArrayValidation:
    """
    Test SegmentType.is_valid with array types using different validation strategies.
    """

    def test_array_validation_all_success(self):
        # Arrange
        value = ["hello", "world", "foo"]
        # Act
        is_valid = SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.ALL)
        # Assert
        assert is_valid

    def test_array_validation_all_fail(self):
        # Arrange
        value = ["hello", 123, "world"]
        # Act
        is_valid = SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.ALL)
        # Assert
        assert not is_valid

    def test_array_validation_first(self):
        # Arrange
        value = ["hello", 123, None]
        # Act
        is_valid = SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.FIRST)
        # Assert
        assert is_valid

    def test_array_validation_none(self):
        # Arrange
        value = [1, 2, 3]
        # Act
        is_valid = SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.NONE)
        # Assert
        assert is_valid


class TestSegmentTypeGetZeroValue:
    """
    Test class for SegmentType.get_zero_value static method.

    Provides comprehensive coverage of all supported SegmentType values to ensure
    correct zero value generation for each type.
    """

    def test_array_types_return_empty_list(self):
        """Test that all array types return empty list segments."""
        array_types = [
            SegmentType.ARRAY_ANY,
            SegmentType.ARRAY_STRING,
            SegmentType.ARRAY_NUMBER,
            SegmentType.ARRAY_OBJECT,
            SegmentType.ARRAY_BOOLEAN,
        ]

        for seg_type in array_types:
            result = SegmentType.get_zero_value(seg_type)
            assert result.value == []
            assert result.value_type == seg_type

    def test_object_returns_empty_dict(self):
        """Test that OBJECT type returns empty dictionary segment."""
        result = SegmentType.get_zero_value(SegmentType.OBJECT)
        assert result.value == {}
        assert result.value_type == SegmentType.OBJECT

    def test_string_returns_empty_string(self):
        """Test that STRING type returns empty string segment."""
        result = SegmentType.get_zero_value(SegmentType.STRING)
        assert result.value == ""
        assert result.value_type == SegmentType.STRING

    def test_integer_returns_zero(self):
        """Test that INTEGER type returns zero segment."""
        result = SegmentType.get_zero_value(SegmentType.INTEGER)
        assert result.value == 0
        assert result.value_type == SegmentType.INTEGER

    def test_float_returns_zero_point_zero(self):
        """Test that FLOAT type returns 0.0 segment."""
        result = SegmentType.get_zero_value(SegmentType.FLOAT)
        assert result.value == 0.0
        assert result.value_type == SegmentType.FLOAT

    def test_number_returns_zero(self):
        """Test that NUMBER type returns zero segment."""
        result = SegmentType.get_zero_value(SegmentType.NUMBER)
        assert result.value == 0
        # NUMBER type with integer value returns INTEGER segment type
        # (NUMBER is a union type that can be INTEGER or FLOAT)
        assert result.value_type == SegmentType.INTEGER
        # Verify that exposed_type returns NUMBER for frontend compatibility
        assert result.value_type.exposed_type() == SegmentType.NUMBER

    def test_boolean_returns_false(self):
        """Test that BOOLEAN type returns False segment."""
        result = SegmentType.get_zero_value(SegmentType.BOOLEAN)
        assert result.value is False
        assert result.value_type == SegmentType.BOOLEAN

    def test_unsupported_types_raise_value_error(self):
        """Test that unsupported types raise ValueError."""
        unsupported_types = [
            SegmentType.SECRET,
            SegmentType.FILE,
            SegmentType.NONE,
            SegmentType.GROUP,
            SegmentType.ARRAY_FILE,
        ]

        for seg_type in unsupported_types:
            with pytest.raises(ValueError, match="unsupported variable type"):
                SegmentType.get_zero_value(seg_type)


class TestSegmentTypeInferSegmentType:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ([], SegmentType.ARRAY_NUMBER),
            ([1, 2, 3], SegmentType.ARRAY_NUMBER),
            ([1, 2.5], SegmentType.ARRAY_NUMBER),
            (["a", "b"], SegmentType.ARRAY_STRING),
            ([{"k": "v"}], SegmentType.ARRAY_OBJECT),
            ([None], SegmentType.ARRAY_ANY),
            ([True, False], SegmentType.ARRAY_BOOLEAN),
            ([[1], [2]], SegmentType.ARRAY_ANY),
            ([1, "a"], SegmentType.ARRAY_ANY),
            (None, SegmentType.NONE),
            (True, SegmentType.BOOLEAN),
            (1, SegmentType.INTEGER),
            (1.2, SegmentType.FLOAT),
            ("abc", SegmentType.STRING),
            ({"k": "v"}, SegmentType.OBJECT),
        ],
    )
    def test_infer_segment_type_supported_values(self, value, expected):
        assert SegmentType.infer_segment_type(value) == expected


class TestSegmentTypeAdditionalMethods:
    def test_cast_value_for_bool_number_and_array_number(self):
        assert SegmentType.cast_value(True, SegmentType.INTEGER) == 1
        assert SegmentType.cast_value(False, SegmentType.NUMBER) == 0
        assert SegmentType.cast_value([True, False], SegmentType.ARRAY_NUMBER) == [1, 0]

        mixed = [True, 1]
        assert SegmentType.cast_value(mixed, SegmentType.ARRAY_NUMBER) is mixed
        assert SegmentType.cast_value("x", SegmentType.STRING) == "x"

    def test_exposed_type_and_element_type(self):
        assert SegmentType.INTEGER.exposed_type() == SegmentType.NUMBER
        assert SegmentType.FLOAT.exposed_type() == SegmentType.NUMBER
        assert SegmentType.STRING.exposed_type() == SegmentType.STRING

        assert SegmentType.ARRAY_STRING.element_type() == SegmentType.STRING
        assert SegmentType.ARRAY_ANY.element_type() is None

        with pytest.raises(ValueError, match="element_type is only supported by array type"):
            SegmentType.STRING.element_type()

    def test_group_validation_for_segment_group_and_list(self):
        valid_group = SegmentGroup(value=[StringSegment(value="a")])
        assert SegmentType.GROUP.is_valid(valid_group) is True
        assert SegmentType.GROUP.is_valid([StringSegment(value="b")]) is True
        assert SegmentType.GROUP.is_valid(["not-segment"]) is False

    def test_unreachable_assertion_branch(self):
        with pytest.raises(AssertionError, match="Expected code to be unreachable"):
            SegmentType.is_valid("not-a-segment-type", None)  # type: ignore[arg-type]
