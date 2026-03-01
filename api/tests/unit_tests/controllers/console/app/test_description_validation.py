import pytest

from libs.validators import validate_description_length


class TestDescriptionValidationUnit:
    """Unit tests for the centralized description validation function."""

    def test_validate_description_length_valid(self):
        """Test validation function with valid descriptions."""
        # Empty string should be valid
        assert validate_description_length("") == ""

        # None should be valid
        assert validate_description_length(None) is None

        # Short description should be valid
        short_desc = "Short description"
        assert validate_description_length(short_desc) == short_desc

        # Exactly 400 characters should be valid
        exactly_400 = "x" * 400
        assert validate_description_length(exactly_400) == exactly_400

        # Just under limit should be valid
        just_under = "x" * 399
        assert validate_description_length(just_under) == just_under

    def test_validate_description_length_invalid(self):
        """Test validation function with invalid descriptions."""
        # 401 characters should fail
        just_over = "x" * 401
        with pytest.raises(ValueError) as exc_info:
            validate_description_length(just_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        # 500 characters should fail
        way_over = "x" * 500
        with pytest.raises(ValueError) as exc_info:
            validate_description_length(way_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        # 1000 characters should fail
        very_long = "x" * 1000
        with pytest.raises(ValueError) as exc_info:
            validate_description_length(very_long)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

    def test_boundary_values(self):
        """Test boundary values around the 400 character limit."""
        boundary_tests = [
            (0, True),  # Empty
            (1, True),  # Minimum
            (399, True),  # Just under limit
            (400, True),  # Exactly at limit
            (401, False),  # Just over limit
            (402, False),  # Over limit
            (500, False),  # Way over limit
        ]

        for length, should_pass in boundary_tests:
            test_desc = "x" * length

            if should_pass:
                # Should not raise exception
                assert validate_description_length(test_desc) == test_desc
            else:
                # Should raise ValueError
                with pytest.raises(ValueError):
                    validate_description_length(test_desc)

    def test_special_characters(self):
        """Test validation with special characters, Unicode, etc."""
        # Unicode characters
        unicode_desc = "测试描述" * 100  # Chinese characters
        if len(unicode_desc) <= 400:
            assert validate_description_length(unicode_desc) == unicode_desc

        # Special characters
        special_desc = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?" * 10
        if len(special_desc) <= 400:
            assert validate_description_length(special_desc) == special_desc

        # Mixed content
        mixed_desc = "Mixed content: 测试 123 !@# " * 15
        if len(mixed_desc) <= 400:
            assert validate_description_length(mixed_desc) == mixed_desc
        elif len(mixed_desc) > 400:
            with pytest.raises(ValueError):
                validate_description_length(mixed_desc)

    def test_whitespace_handling(self):
        """Test validation with various whitespace scenarios."""
        # Leading/trailing whitespace
        whitespace_desc = "   Description with whitespace   "
        if len(whitespace_desc) <= 400:
            assert validate_description_length(whitespace_desc) == whitespace_desc

        # Newlines and tabs
        multiline_desc = "Line 1\nLine 2\tTabbed content"
        if len(multiline_desc) <= 400:
            assert validate_description_length(multiline_desc) == multiline_desc

        # Only whitespace over limit
        only_spaces = " " * 401
        with pytest.raises(ValueError):
            validate_description_length(only_spaces)
