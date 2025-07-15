import pytest

from libs.helper import extract_tenant_id
from models.account import Account
from models.model import EndUser


class TestExtractTenantId:
    """Test cases for the extract_tenant_id utility function."""

    def test_extract_tenant_id_from_account_with_tenant(self):
        """Test extracting tenant_id from Account with current_tenant_id."""
        # Create a mock Account object
        account = Account()
        # Mock the current_tenant_id property
        account._current_tenant = type("MockTenant", (), {"id": "account-tenant-123"})()

        tenant_id = extract_tenant_id(account)
        assert tenant_id == "account-tenant-123"

    def test_extract_tenant_id_from_account_without_tenant(self):
        """Test extracting tenant_id from Account without current_tenant_id."""
        # Create a mock Account object
        account = Account()
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
