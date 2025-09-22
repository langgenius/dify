import pytest

from controllers.console.app.app import _validate_description_length as app_validate
from controllers.console.datasets.datasets import _validate_description_length as dataset_validate
from controllers.service_api.dataset.dataset import _validate_description_length as service_dataset_validate


class TestDescriptionValidationUnit:
    """Unit tests for description validation functions in App and Dataset APIs"""

    def test_app_validate_description_length_valid(self):
        """Test App validation function with valid descriptions"""
        # Empty string should be valid
        assert app_validate("") == ""

        # None should be valid
        assert app_validate(None) is None

        # Short description should be valid
        short_desc = "Short description"
        assert app_validate(short_desc) == short_desc

        # Exactly 400 characters should be valid
        exactly_400 = "x" * 400
        assert app_validate(exactly_400) == exactly_400

        # Just under limit should be valid
        just_under = "x" * 399
        assert app_validate(just_under) == just_under

    def test_app_validate_description_length_invalid(self):
        """Test App validation function with invalid descriptions"""
        # 401 characters should fail
        just_over = "x" * 401
        with pytest.raises(ValueError) as exc_info:
            app_validate(just_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        # 500 characters should fail
        way_over = "x" * 500
        with pytest.raises(ValueError) as exc_info:
            app_validate(way_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        # 1000 characters should fail
        very_long = "x" * 1000
        with pytest.raises(ValueError) as exc_info:
            app_validate(very_long)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

    def test_dataset_validate_description_length_valid(self):
        """Test Dataset validation function with valid descriptions"""
        # Empty string should be valid
        assert dataset_validate("") == ""

        # Short description should be valid
        short_desc = "Short description"
        assert dataset_validate(short_desc) == short_desc

        # Exactly 400 characters should be valid
        exactly_400 = "x" * 400
        assert dataset_validate(exactly_400) == exactly_400

        # Just under limit should be valid
        just_under = "x" * 399
        assert dataset_validate(just_under) == just_under

    def test_dataset_validate_description_length_invalid(self):
        """Test Dataset validation function with invalid descriptions"""
        # 401 characters should fail
        just_over = "x" * 401
        with pytest.raises(ValueError) as exc_info:
            dataset_validate(just_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        # 500 characters should fail
        way_over = "x" * 500
        with pytest.raises(ValueError) as exc_info:
            dataset_validate(way_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

    def test_service_dataset_validate_description_length_valid(self):
        """Test Service Dataset validation function with valid descriptions"""
        # Empty string should be valid
        assert service_dataset_validate("") == ""

        # None should be valid
        assert service_dataset_validate(None) is None

        # Short description should be valid
        short_desc = "Short description"
        assert service_dataset_validate(short_desc) == short_desc

        # Exactly 400 characters should be valid
        exactly_400 = "x" * 400
        assert service_dataset_validate(exactly_400) == exactly_400

        # Just under limit should be valid
        just_under = "x" * 399
        assert service_dataset_validate(just_under) == just_under

    def test_service_dataset_validate_description_length_invalid(self):
        """Test Service Dataset validation function with invalid descriptions"""
        # 401 characters should fail
        just_over = "x" * 401
        with pytest.raises(ValueError) as exc_info:
            service_dataset_validate(just_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        # 500 characters should fail
        way_over = "x" * 500
        with pytest.raises(ValueError) as exc_info:
            service_dataset_validate(way_over)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

    def test_app_dataset_validation_consistency(self):
        """Test that App and Dataset validation functions behave identically"""
        test_cases = [
            "",  # Empty string
            "Short description",  # Normal description
            "x" * 100,  # Medium description
            "x" * 400,  # Exactly at limit
        ]

        # Test valid cases produce same results
        for test_desc in test_cases:
            assert app_validate(test_desc) == dataset_validate(test_desc) == service_dataset_validate(test_desc)

        # Test invalid cases produce same errors
        invalid_cases = [
            "x" * 401,  # Just over limit
            "x" * 500,  # Way over limit
            "x" * 1000,  # Very long
        ]

        for invalid_desc in invalid_cases:
            app_error = None
            dataset_error = None
            service_dataset_error = None

            # Capture App validation error
            try:
                app_validate(invalid_desc)
            except ValueError as e:
                app_error = str(e)

            # Capture Dataset validation error
            try:
                dataset_validate(invalid_desc)
            except ValueError as e:
                dataset_error = str(e)

            # Capture Service Dataset validation error
            try:
                service_dataset_validate(invalid_desc)
            except ValueError as e:
                service_dataset_error = str(e)

            # All should produce errors
            assert app_error is not None, f"App validation should fail for {len(invalid_desc)} characters"
            assert dataset_error is not None, f"Dataset validation should fail for {len(invalid_desc)} characters"
            error_msg = f"Service Dataset validation should fail for {len(invalid_desc)} characters"
            assert service_dataset_error is not None, error_msg

            # Errors should be identical
            error_msg = f"Error messages should be identical for {len(invalid_desc)} characters"
            assert app_error == dataset_error == service_dataset_error, error_msg
            assert app_error == "Description cannot exceed 400 characters."

    def test_boundary_values(self):
        """Test boundary values around the 400 character limit"""
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
                assert app_validate(test_desc) == test_desc
                assert dataset_validate(test_desc) == test_desc
                assert service_dataset_validate(test_desc) == test_desc
            else:
                # Should raise ValueError
                with pytest.raises(ValueError):
                    app_validate(test_desc)
                with pytest.raises(ValueError):
                    dataset_validate(test_desc)
                with pytest.raises(ValueError):
                    service_dataset_validate(test_desc)

    def test_special_characters(self):
        """Test validation with special characters, Unicode, etc."""
        # Unicode characters
        unicode_desc = "测试描述" * 100  # Chinese characters
        if len(unicode_desc) <= 400:
            assert app_validate(unicode_desc) == unicode_desc
            assert dataset_validate(unicode_desc) == unicode_desc
            assert service_dataset_validate(unicode_desc) == unicode_desc

        # Special characters
        special_desc = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?" * 10
        if len(special_desc) <= 400:
            assert app_validate(special_desc) == special_desc
            assert dataset_validate(special_desc) == special_desc
            assert service_dataset_validate(special_desc) == special_desc

        # Mixed content
        mixed_desc = "Mixed content: 测试 123 !@# " * 15
        if len(mixed_desc) <= 400:
            assert app_validate(mixed_desc) == mixed_desc
            assert dataset_validate(mixed_desc) == mixed_desc
            assert service_dataset_validate(mixed_desc) == mixed_desc
        elif len(mixed_desc) > 400:
            with pytest.raises(ValueError):
                app_validate(mixed_desc)
            with pytest.raises(ValueError):
                dataset_validate(mixed_desc)
            with pytest.raises(ValueError):
                service_dataset_validate(mixed_desc)

    def test_whitespace_handling(self):
        """Test validation with various whitespace scenarios"""
        # Leading/trailing whitespace
        whitespace_desc = "   Description with whitespace   "
        if len(whitespace_desc) <= 400:
            assert app_validate(whitespace_desc) == whitespace_desc
            assert dataset_validate(whitespace_desc) == whitespace_desc
            assert service_dataset_validate(whitespace_desc) == whitespace_desc

        # Newlines and tabs
        multiline_desc = "Line 1\nLine 2\tTabbed content"
        if len(multiline_desc) <= 400:
            assert app_validate(multiline_desc) == multiline_desc
            assert dataset_validate(multiline_desc) == multiline_desc
            assert service_dataset_validate(multiline_desc) == multiline_desc

        # Only whitespace over limit
        only_spaces = " " * 401
        with pytest.raises(ValueError):
            app_validate(only_spaces)
        with pytest.raises(ValueError):
            dataset_validate(only_spaces)
        with pytest.raises(ValueError):
            service_dataset_validate(only_spaces)
