import re
from datetime import datetime

import pytest

from core.ops.utils import generate_dotted_order, validate_project_name, validate_url, validate_url_with_path


class TestValidateUrl:
    """Test cases for validate_url function"""

    def test_valid_https_url(self):
        """Test valid HTTPS URL"""
        result = validate_url("https://example.com", "https://default.com")
        assert result == "https://example.com"

    def test_valid_http_url(self):
        """Test valid HTTP URL"""
        result = validate_url("http://example.com", "https://default.com")
        assert result == "http://example.com"

    def test_url_with_path_removed(self):
        """Test that URL path is removed during normalization"""
        result = validate_url("https://example.com/api/v1/test", "https://default.com")
        assert result == "https://example.com"

    def test_url_with_query_removed(self):
        """Test that URL query parameters are removed"""
        result = validate_url("https://example.com?param=value", "https://default.com")
        assert result == "https://example.com"

    def test_url_with_fragment_removed(self):
        """Test that URL fragments are removed"""
        result = validate_url("https://example.com#section", "https://default.com")
        assert result == "https://example.com"

    def test_empty_url_returns_default(self):
        """Test empty URL returns default"""
        result = validate_url("", "https://default.com")
        assert result == "https://default.com"

    def test_none_url_returns_default(self):
        """Test None URL returns default"""
        result = validate_url(None, "https://default.com")
        assert result == "https://default.com"

    def test_whitespace_url_returns_default(self):
        """Test whitespace URL returns default"""
        result = validate_url("   ", "https://default.com")
        assert result == "https://default.com"

    def test_invalid_scheme_raises_error(self):
        """Test invalid scheme raises ValueError"""
        with pytest.raises(ValueError, match="URL scheme must be one of"):
            validate_url("ftp://example.com", "https://default.com")

    def test_no_scheme_raises_error(self):
        """Test URL without scheme raises ValueError"""
        with pytest.raises(ValueError, match="URL scheme must be one of"):
            validate_url("example.com", "https://default.com")

    def test_custom_allowed_schemes(self):
        """Test custom allowed schemes"""
        result = validate_url("https://example.com", "https://default.com", allowed_schemes=("https",))
        assert result == "https://example.com"

        with pytest.raises(ValueError, match="URL scheme must be one of"):
            validate_url("http://example.com", "https://default.com", allowed_schemes=("https",))


class TestValidateUrlWithPath:
    """Test cases for validate_url_with_path function"""

    def test_valid_url_with_path(self):
        """Test valid URL with path"""
        result = validate_url_with_path("https://example.com/api/v1", "https://default.com")
        assert result == "https://example.com/api/v1"

    def test_valid_url_with_required_suffix(self):
        """Test valid URL with required suffix"""
        result = validate_url_with_path("https://example.com/api/", "https://default.com", required_suffix="/api/")
        assert result == "https://example.com/api/"

    def test_url_without_required_suffix_raises_error(self):
        """Test URL without required suffix raises error"""
        with pytest.raises(ValueError, match="URL should end with /api/"):
            validate_url_with_path("https://example.com/api", "https://default.com", required_suffix="/api/")

    def test_empty_url_returns_default(self):
        """Test empty URL returns default"""
        result = validate_url_with_path("", "https://default.com")
        assert result == "https://default.com"

    def test_none_url_returns_default(self):
        """Test None URL returns default"""
        result = validate_url_with_path(None, "https://default.com")
        assert result == "https://default.com"

    def test_invalid_scheme_raises_error(self):
        """Test invalid scheme raises ValueError"""
        with pytest.raises(ValueError, match="URL must start with https:// or http://"):
            validate_url_with_path("ftp://example.com", "https://default.com")

    def test_no_scheme_raises_error(self):
        """Test URL without scheme raises ValueError"""
        with pytest.raises(ValueError, match="URL must start with https:// or http://"):
            validate_url_with_path("example.com", "https://default.com")


class TestValidateProjectName:
    """Test cases for validate_project_name function"""

    def test_valid_project_name(self):
        """Test valid project name"""
        result = validate_project_name("my-project", "default")
        assert result == "my-project"

    def test_empty_project_name_returns_default(self):
        """Test empty project name returns default"""
        result = validate_project_name("", "default")
        assert result == "default"

    def test_none_project_name_returns_default(self):
        """Test None project name returns default"""
        result = validate_project_name(None, "default")
        assert result == "default"

    def test_whitespace_project_name_returns_default(self):
        """Test whitespace project name returns default"""
        result = validate_project_name("   ", "default")
        assert result == "default"

    def test_project_name_with_whitespace_trimmed(self):
        """Test project name with whitespace is trimmed"""
        result = validate_project_name("  my-project  ", "default")
        assert result == "my-project"

    def test_custom_default_name(self):
        """Test custom default name"""
        result = validate_project_name("", "Custom Default")
        assert result == "Custom Default"


class TestGenerateDottedOrder:
    """Test cases for generate_dotted_order function"""

    def test_dotted_order_has_6_digit_microseconds(self):
        """Test that timestamp includes full 6-digit microseconds for LangSmith API compatibility.

        LangSmith API expects timestamps in format: YYYYMMDDTHHMMSSffffffZ (6-digit microseconds).
        Previously, the code truncated to 3 digits which caused API errors:
        'cannot parse .111 as .000000'
        """
        start_time = datetime(2025, 12, 23, 4, 19, 55, 111000)
        run_id = "test-run-id"
        result = generate_dotted_order(run_id, start_time)

        # Extract timestamp portion (before the run_id)
        timestamp_match = re.match(r"^(\d{8}T\d{6})(\d+)Z", result)
        assert timestamp_match is not None, "Timestamp format should match YYYYMMDDTHHMMSSffffffZ"

        microseconds = timestamp_match.group(2)
        assert len(microseconds) == 6, f"Microseconds should be 6 digits, got {len(microseconds)}: {microseconds}"

    def test_dotted_order_format_matches_langsmith_expected(self):
        """Test that dotted_order format matches LangSmith API expected format."""
        start_time = datetime(2025, 1, 15, 10, 30, 45, 123456)
        run_id = "abc123"
        result = generate_dotted_order(run_id, start_time)

        # LangSmith expects: YYYYMMDDTHHMMSSffffffZ followed by run_id
        assert result == "20250115T103045123456Zabc123"

    def test_dotted_order_with_parent(self):
        """Test dotted_order generation with parent order uses dot separator."""
        start_time = datetime(2025, 12, 23, 4, 19, 55, 111000)
        run_id = "child-run-id"
        parent_order = "20251223T041955000000Zparent-run-id"
        result = generate_dotted_order(run_id, start_time, parent_order)

        assert result == "20251223T041955000000Zparent-run-id.20251223T041955111000Zchild-run-id"

    def test_dotted_order_without_parent_has_no_dot(self):
        """Test dotted_order generation without parent has no dot separator."""
        start_time = datetime(2025, 12, 23, 4, 19, 55, 111000)
        run_id = "test-run-id"
        result = generate_dotted_order(run_id, start_time, None)

        assert "." not in result
