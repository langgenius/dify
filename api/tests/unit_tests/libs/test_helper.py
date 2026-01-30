import pytest

from libs.helper import escape_like_pattern, extract_tenant_id
from models.account import Account
from models.model import EndUser


class TestExtractTenantId:
    """Test cases for the extract_tenant_id utility function."""

    def test_extract_tenant_id_from_account_with_tenant(self):
        """Test extracting tenant_id from Account with current_tenant_id."""
        # Create a mock Account object
        account = Account(name="test", email="test@example.com")
        # Mock the current_tenant_id property
        account._current_tenant = type("MockTenant", (), {"id": "account-tenant-123"})()

        tenant_id = extract_tenant_id(account)
        assert tenant_id == "account-tenant-123"

    def test_extract_tenant_id_from_account_without_tenant(self):
        """Test extracting tenant_id from Account without current_tenant_id."""
        # Create a mock Account object
        account = Account(name="test", email="test@example.com")
        account._current_tenant = None

        tenant_id = extract_tenant_id(account)
        assert tenant_id is None

    def test_extract_tenant_id_from_enduser_with_tenant(self):
        """Test extracting tenant_id from EndUser with tenant_id."""
        # Create a mock EndUser object
        end_user = EndUser()
        end_user.tenant_id = "enduser-tenant-456"

        tenant_id = extract_tenant_id(end_user)
        assert tenant_id == "enduser-tenant-456"

    def test_extract_tenant_id_from_enduser_without_tenant(self):
        """Test extracting tenant_id from EndUser without tenant_id."""
        # Create a mock EndUser object
        end_user = EndUser()
        end_user.tenant_id = None

        tenant_id = extract_tenant_id(end_user)
        assert tenant_id is None

    def test_extract_tenant_id_with_invalid_user_type(self):
        """Test extracting tenant_id with invalid user type raises ValueError."""
        invalid_user = "not_a_user_object"

        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(invalid_user)

    def test_extract_tenant_id_with_none_user(self):
        """Test extracting tenant_id with None user raises ValueError."""
        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(None)

    def test_extract_tenant_id_with_dict_user(self):
        """Test extracting tenant_id with dict user raises ValueError."""
        dict_user = {"id": "123", "tenant_id": "456"}

        with pytest.raises(ValueError, match="Invalid user type.*Expected Account or EndUser"):
            extract_tenant_id(dict_user)


class TestEscapeLikePattern:
    """Test cases for the escape_like_pattern utility function."""

    def test_escape_percent_character(self):
        """Test escaping percent character."""
        result = escape_like_pattern("50% discount")
        assert result == "50\\% discount"

    def test_escape_underscore_character(self):
        """Test escaping underscore character."""
        result = escape_like_pattern("test_data")
        assert result == "test\\_data"

    def test_escape_backslash_character(self):
        """Test escaping backslash character."""
        result = escape_like_pattern("path\\to\\file")
        assert result == "path\\\\to\\\\file"

    def test_escape_combined_special_characters(self):
        """Test escaping multiple special characters together."""
        result = escape_like_pattern("file_50%\\path")
        assert result == "file\\_50\\%\\\\path"

    def test_escape_empty_string(self):
        """Test escaping empty string returns empty string."""
        result = escape_like_pattern("")
        assert result == ""

    def test_escape_none_handling(self):
        """Test escaping None returns None (falsy check handles it)."""
        # The function checks `if not pattern`, so None is falsy and returns as-is
        result = escape_like_pattern(None)
        assert result is None

    def test_escape_normal_string_no_change(self):
        """Test that normal strings without special characters are unchanged."""
        result = escape_like_pattern("normal text")
        assert result == "normal text"

    def test_escape_order_matters(self):
        """Test that backslash is escaped first to prevent double escaping."""
        # If we escape % first, then escape \, we might get wrong results
        # This test ensures the order is correct: \ first, then % and _
        result = escape_like_pattern("test\\%_value")
        # Should be: test\\\%\_value
        assert result == "test\\\\\\%\\_value"
