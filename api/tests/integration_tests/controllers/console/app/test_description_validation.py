"""
Unit tests for App description validation functions.

This test module validates the 400-character limit enforcement
for App descriptions across all creation and editing endpoints.
"""

import os
import sys

import pytest

# Add the API root to Python path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))


class TestAppDescriptionValidationUnit:
    """Unit tests for description validation function"""

    def test_validate_description_length_function(self):
        """Test the validate_description_length function directly"""
        from libs.validators import validate_description_length

        # Test valid descriptions
        assert validate_description_length("") == ""
        assert validate_description_length("x" * 400) == "x" * 400
        assert validate_description_length(None) is None

        # Test invalid descriptions
        with pytest.raises(ValueError) as exc_info:
            validate_description_length("x" * 401)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        with pytest.raises(ValueError) as exc_info:
            validate_description_length("x" * 500)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

        with pytest.raises(ValueError) as exc_info:
            validate_description_length("x" * 1000)
        assert "Description cannot exceed 400 characters." in str(exc_info.value)

    def test_boundary_values(self):
        """Test boundary values for description validation"""
        from libs.validators import validate_description_length

        # Test exact boundary
        exactly_400 = "x" * 400
        assert validate_description_length(exactly_400) == exactly_400

        # Test just over boundary
        just_over_400 = "x" * 401
        with pytest.raises(ValueError):
            validate_description_length(just_over_400)

        # Test just under boundary
        just_under_400 = "x" * 399
        assert validate_description_length(just_under_400) == just_under_400

    def test_edge_cases(self):
        """Test edge cases for description validation"""
        from libs.validators import validate_description_length

        # Test None input
        assert validate_description_length(None) is None

        # Test empty string
        assert validate_description_length("") == ""

        # Test single character
        assert validate_description_length("a") == "a"

        # Test unicode characters
        unicode_desc = "测试" * 200  # 400 characters in Chinese
        assert validate_description_length(unicode_desc) == unicode_desc

        # Test unicode over limit
        unicode_over = "测试" * 201  # 402 characters
        with pytest.raises(ValueError):
            validate_description_length(unicode_over)

    def test_whitespace_handling(self):
        """Test how validation handles whitespace"""
        from libs.validators import validate_description_length

        # Test description with spaces
        spaces_400 = " " * 400
        assert validate_description_length(spaces_400) == spaces_400

        # Test description with spaces over limit
        spaces_401 = " " * 401
        with pytest.raises(ValueError):
            validate_description_length(spaces_401)

        # Test mixed content
        mixed_400 = "a" * 200 + " " * 200
        assert validate_description_length(mixed_400) == mixed_400

        # Test mixed over limit
        mixed_401 = "a" * 200 + " " * 201
        with pytest.raises(ValueError):
            validate_description_length(mixed_401)


if __name__ == "__main__":
    # Run tests directly
    import traceback

    test_instance = TestAppDescriptionValidationUnit()
    test_methods = [method for method in dir(test_instance) if method.startswith("test_")]

    passed = 0
    failed = 0

    for test_method in test_methods:
        try:
            print(f"Running {test_method}...")
            getattr(test_instance, test_method)()
            print(f"✅ {test_method} PASSED")
            passed += 1
        except Exception as e:
            print(f"❌ {test_method} FAILED: {str(e)}")
            traceback.print_exc()
            failed += 1

    print(f"\n📊 Test Results: {passed} passed, {failed} failed")

    if failed == 0:
        print("🎉 All tests passed!")
    else:
        print("💥 Some tests failed!")
        sys.exit(1)
