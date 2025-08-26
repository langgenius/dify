from core.variables.types import ArrayValidation, SegmentType


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
        value = ["hello", "world", "foo"]
        assert SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.ALL)

    def test_array_validation_all_fail(self):
        value = ["hello", 123, "world"]
        # Should return False, since 123 is not a string
        assert not SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.ALL)

    def test_array_validation_first(self):
        value = ["hello", 123, None]
        assert SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.FIRST)

    def test_array_validation_none(self):
        value = [1, 2, 3]
        # validation is None, skip
        assert SegmentType.ARRAY_STRING.is_valid(value, array_validation=ArrayValidation.NONE)
