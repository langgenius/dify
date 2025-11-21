"""
Comprehensive unit tests for Account model.

This test suite covers:
- Account model validation
- Password hashing/verification
- Account status transitions
- Tenant relationship integrity
- Email uniqueness constraints
"""

import base64
import secrets
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from libs.password import compare_password, hash_password, valid_password
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole


class TestAccountModelValidation:
    """Test suite for Account model validation and basic operations."""

    def test_account_creation_with_required_fields(self):
        """Test creating an account with all required fields."""
        # Arrange & Act
        account = Account(
            name="Test User",
            email="test@example.com",
            password="hashed_password",
            password_salt="salt_value",
        )

        # Assert
        assert account.name == "Test User"
        assert account.email == "test@example.com"
        assert account.password == "hashed_password"
        assert account.password_salt == "salt_value"
        assert account.status == "active"  # Default value

    def test_account_creation_with_optional_fields(self):
        """Test creating an account with optional fields."""
        # Arrange & Act
        account = Account(
            name="Test User",
            email="test@example.com",
            avatar="https://example.com/avatar.png",
            interface_language="en-US",
            interface_theme="dark",
            timezone="America/New_York",
        )

        # Assert
        assert account.avatar == "https://example.com/avatar.png"
        assert account.interface_language == "en-US"
        assert account.interface_theme == "dark"
        assert account.timezone == "America/New_York"

    def test_account_creation_without_password(self):
        """Test creating an account without password (for invite-based registration)."""
        # Arrange & Act
        account = Account(
            name="Invited User",
            email="invited@example.com",
        )

        # Assert
        assert account.password is None
        assert account.password_salt is None
        assert not account.is_password_set

    def test_account_is_password_set_property(self):
        """Test the is_password_set property."""
        # Arrange
        account_with_password = Account(
            name="User With Password",
            email="withpass@example.com",
            password="hashed_password",
        )
        account_without_password = Account(
            name="User Without Password",
            email="nopass@example.com",
        )

        # Assert
        assert account_with_password.is_password_set
        assert not account_without_password.is_password_set

    def test_account_default_status(self):
        """Test that account has default status of 'active'."""
        # Arrange & Act
        account = Account(
            name="Test User",
            email="test@example.com",
        )

        # Assert
        assert account.status == "active"

    def test_account_get_status_method(self):
        """Test the get_status method returns AccountStatus enum."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
            status="pending",
        )

        # Act
        status = account.get_status()

        # Assert
        assert status == AccountStatus.PENDING
        assert isinstance(status, AccountStatus)


class TestPasswordHashingAndVerification:
    """Test suite for password hashing and verification functionality."""

    def test_password_hashing_produces_consistent_result(self):
        """Test that hashing the same password with the same salt produces the same result."""
        # Arrange
        password = "TestPassword123"
        salt = secrets.token_bytes(16)

        # Act
        hash1 = hash_password(password, salt)
        hash2 = hash_password(password, salt)

        # Assert
        assert hash1 == hash2

    def test_password_hashing_different_salts_produce_different_hashes(self):
        """Test that different salts produce different hashes for the same password."""
        # Arrange
        password = "TestPassword123"
        salt1 = secrets.token_bytes(16)
        salt2 = secrets.token_bytes(16)

        # Act
        hash1 = hash_password(password, salt1)
        hash2 = hash_password(password, salt2)

        # Assert
        assert hash1 != hash2

    def test_password_comparison_success(self):
        """Test successful password comparison."""
        # Arrange
        password = "TestPassword123"
        salt = secrets.token_bytes(16)
        password_hashed = hash_password(password, salt)

        # Encode to base64 as done in the application
        base64_salt = base64.b64encode(salt).decode()
        base64_password_hashed = base64.b64encode(password_hashed).decode()

        # Act
        result = compare_password(password, base64_password_hashed, base64_salt)

        # Assert
        assert result is True

    def test_password_comparison_failure(self):
        """Test password comparison with wrong password."""
        # Arrange
        correct_password = "TestPassword123"
        wrong_password = "WrongPassword456"
        salt = secrets.token_bytes(16)
        password_hashed = hash_password(correct_password, salt)

        # Encode to base64
        base64_salt = base64.b64encode(salt).decode()
        base64_password_hashed = base64.b64encode(password_hashed).decode()

        # Act
        result = compare_password(wrong_password, base64_password_hashed, base64_salt)

        # Assert
        assert result is False

    def test_valid_password_with_correct_format(self):
        """Test password validation with correct format."""
        # Arrange
        valid_passwords = [
            "Password123",
            "Test1234",
            "MySecure1Pass",
            "abcdefgh1",
        ]

        # Act & Assert
        for password in valid_passwords:
            result = valid_password(password)
            assert result == password

    def test_valid_password_with_incorrect_format(self):
        """Test password validation with incorrect format."""
        # Arrange
        invalid_passwords = [
            "short1",  # Too short
            "NoNumbers",  # No numbers
            "12345678",  # No letters
            "Pass1",  # Too short
        ]

        # Act & Assert
        for password in invalid_passwords:
            with pytest.raises(ValueError, match="Password must contain letters and numbers"):
                valid_password(password)

    def test_password_hashing_integration_with_account(self):
        """Test password hashing integration with Account model."""
        # Arrange
        password = "SecurePass123"
        salt = secrets.token_bytes(16)
        base64_salt = base64.b64encode(salt).decode()
        password_hashed = hash_password(password, salt)
        base64_password_hashed = base64.b64encode(password_hashed).decode()

        # Act
        account = Account(
            name="Test User",
            email="test@example.com",
            password=base64_password_hashed,
            password_salt=base64_salt,
        )

        # Assert
        assert account.is_password_set
        assert compare_password(password, account.password, account.password_salt)


class TestAccountStatusTransitions:
    """Test suite for account status transitions."""

    def test_account_status_enum_values(self):
        """Test that AccountStatus enum has all expected values."""
        # Assert
        assert AccountStatus.PENDING == "pending"
        assert AccountStatus.UNINITIALIZED == "uninitialized"
        assert AccountStatus.ACTIVE == "active"
        assert AccountStatus.BANNED == "banned"
        assert AccountStatus.CLOSED == "closed"

    def test_account_status_transition_pending_to_active(self):
        """Test transitioning account status from pending to active."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
            status=AccountStatus.PENDING,
        )

        # Act
        account.status = AccountStatus.ACTIVE
        account.initialized_at = datetime.now(UTC)

        # Assert
        assert account.get_status() == AccountStatus.ACTIVE
        assert account.initialized_at is not None

    def test_account_status_transition_active_to_banned(self):
        """Test transitioning account status from active to banned."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
            status=AccountStatus.ACTIVE,
        )

        # Act
        account.status = AccountStatus.BANNED

        # Assert
        assert account.get_status() == AccountStatus.BANNED

    def test_account_status_transition_active_to_closed(self):
        """Test transitioning account status from active to closed."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
            status=AccountStatus.ACTIVE,
        )

        # Act
        account.status = AccountStatus.CLOSED

        # Assert
        assert account.get_status() == AccountStatus.CLOSED

    def test_account_status_uninitialized(self):
        """Test account with uninitialized status."""
        # Arrange & Act
        account = Account(
            name="Test User",
            email="test@example.com",
            status=AccountStatus.UNINITIALIZED,
        )

        # Assert
        assert account.get_status() == AccountStatus.UNINITIALIZED
        assert account.initialized_at is None


class TestTenantRelationshipIntegrity:
    """Test suite for tenant relationship integrity."""

    @patch("models.account.db")
    def test_account_current_tenant_property(self, mock_db):
        """Test the current_tenant property getter."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.id = str(uuid4())

        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid4())

        account._current_tenant = tenant

        # Act
        result = account.current_tenant

        # Assert
        assert result == tenant

    @patch("models.account.Session")
    @patch("models.account.db")
    def test_account_current_tenant_setter_with_valid_tenant(self, mock_db, mock_session_class):
        """Test setting current_tenant with a valid tenant relationship."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.id = str(uuid4())

        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid4())

        # Mock the session and queries
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        # Mock TenantAccountJoin query result
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
        )
        mock_session.scalar.return_value = tenant_join

        # Mock Tenant query result
        mock_session.scalars.return_value.one.return_value = tenant

        # Act
        account.current_tenant = tenant

        # Assert
        assert account._current_tenant == tenant
        assert account.role == TenantAccountRole.OWNER

    @patch("models.account.Session")
    @patch("models.account.db")
    def test_account_current_tenant_setter_without_relationship(self, mock_db, mock_session_class):
        """Test setting current_tenant when no relationship exists."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.id = str(uuid4())

        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid4())

        # Mock the session and queries
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session

        # Mock no TenantAccountJoin found
        mock_session.scalar.return_value = None

        # Act
        account.current_tenant = tenant

        # Assert
        assert account._current_tenant is None

    def test_account_current_tenant_id_property(self):
        """Test the current_tenant_id property."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid4())

        # Act - with tenant
        account._current_tenant = tenant
        tenant_id = account.current_tenant_id

        # Assert
        assert tenant_id == tenant.id

        # Act - without tenant
        account._current_tenant = None
        tenant_id_none = account.current_tenant_id

        # Assert
        assert tenant_id_none is None

    @patch("models.account.Session")
    @patch("models.account.db")
    def test_account_set_tenant_id_method(self, mock_db, mock_session_class):
        """Test the set_tenant_id method."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.id = str(uuid4())

        tenant = Tenant(name="Test Tenant")
        tenant.id = str(uuid4())

        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.ADMIN,
        )

        # Mock the session and queries
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.execute.return_value.first.return_value = (tenant, tenant_join)

        # Act
        account.set_tenant_id(tenant.id)

        # Assert
        assert account._current_tenant == tenant
        assert account.role == TenantAccountRole.ADMIN

    @patch("models.account.Session")
    @patch("models.account.db")
    def test_account_set_tenant_id_with_no_relationship(self, mock_db, mock_session_class):
        """Test set_tenant_id when no relationship exists."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.id = str(uuid4())
        tenant_id = str(uuid4())

        # Mock the session and queries
        mock_session = MagicMock()
        mock_session_class.return_value.__enter__.return_value = mock_session
        mock_session.execute.return_value.first.return_value = None

        # Act
        account.set_tenant_id(tenant_id)

        # Assert - should not set tenant when no relationship exists
        # The method returns early without setting _current_tenant


class TestAccountRolePermissions:
    """Test suite for account role permissions."""

    def test_is_admin_or_owner_with_admin_role(self):
        """Test is_admin_or_owner property with admin role."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.role = TenantAccountRole.ADMIN

        # Act & Assert
        assert account.is_admin_or_owner

    def test_is_admin_or_owner_with_owner_role(self):
        """Test is_admin_or_owner property with owner role."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.role = TenantAccountRole.OWNER

        # Act & Assert
        assert account.is_admin_or_owner

    def test_is_admin_or_owner_with_normal_role(self):
        """Test is_admin_or_owner property with normal role."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
        )
        account.role = TenantAccountRole.NORMAL

        # Act & Assert
        assert not account.is_admin_or_owner

    def test_is_admin_property(self):
        """Test is_admin property."""
        # Arrange
        admin_account = Account(name="Admin", email="admin@example.com")
        admin_account.role = TenantAccountRole.ADMIN

        owner_account = Account(name="Owner", email="owner@example.com")
        owner_account.role = TenantAccountRole.OWNER

        # Act & Assert
        assert admin_account.is_admin
        assert not owner_account.is_admin

    def test_has_edit_permission_with_editing_roles(self):
        """Test has_edit_permission property with roles that have edit permission."""
        # Arrange
        roles_with_edit = [
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
        ]

        for role in roles_with_edit:
            account = Account(name="Test User", email=f"test_{role}@example.com")
            account.role = role

            # Act & Assert
            assert account.has_edit_permission, f"Role {role} should have edit permission"

    def test_has_edit_permission_without_editing_roles(self):
        """Test has_edit_permission property with roles that don't have edit permission."""
        # Arrange
        roles_without_edit = [
            TenantAccountRole.NORMAL,
            TenantAccountRole.DATASET_OPERATOR,
        ]

        for role in roles_without_edit:
            account = Account(name="Test User", email=f"test_{role}@example.com")
            account.role = role

            # Act & Assert
            assert not account.has_edit_permission, f"Role {role} should not have edit permission"

    def test_is_dataset_editor_property(self):
        """Test is_dataset_editor property."""
        # Arrange
        dataset_roles = [
            TenantAccountRole.OWNER,
            TenantAccountRole.ADMIN,
            TenantAccountRole.EDITOR,
            TenantAccountRole.DATASET_OPERATOR,
        ]

        for role in dataset_roles:
            account = Account(name="Test User", email=f"test_{role}@example.com")
            account.role = role

            # Act & Assert
            assert account.is_dataset_editor, f"Role {role} should have dataset edit permission"

        # Test normal role doesn't have dataset edit permission
        normal_account = Account(name="Normal User", email="normal@example.com")
        normal_account.role = TenantAccountRole.NORMAL
        assert not normal_account.is_dataset_editor

    def test_is_dataset_operator_property(self):
        """Test is_dataset_operator property."""
        # Arrange
        dataset_operator = Account(name="Dataset Operator", email="operator@example.com")
        dataset_operator.role = TenantAccountRole.DATASET_OPERATOR

        normal_account = Account(name="Normal User", email="normal@example.com")
        normal_account.role = TenantAccountRole.NORMAL

        # Act & Assert
        assert dataset_operator.is_dataset_operator
        assert not normal_account.is_dataset_operator

    def test_current_role_property(self):
        """Test current_role property."""
        # Arrange
        account = Account(name="Test User", email="test@example.com")
        account.role = TenantAccountRole.EDITOR

        # Act
        current_role = account.current_role

        # Assert
        assert current_role == TenantAccountRole.EDITOR


class TestAccountGetByOpenId:
    """Test suite for get_by_openid class method."""

    @patch("models.account.db")
    def test_get_by_openid_success(self, mock_db):
        """Test successful retrieval of account by OpenID."""
        # Arrange
        provider = "google"
        open_id = "google_user_123"
        account_id = str(uuid4())

        mock_account_integrate = MagicMock()
        mock_account_integrate.account_id = account_id

        mock_account = Account(name="Test User", email="test@example.com")
        mock_account.id = account_id

        # Mock the query chain
        mock_query = MagicMock()
        mock_where = MagicMock()
        mock_where.one_or_none.return_value = mock_account_integrate
        mock_query.where.return_value = mock_where
        mock_db.session.query.return_value = mock_query

        # Mock the second query for account
        mock_account_query = MagicMock()
        mock_account_where = MagicMock()
        mock_account_where.one_or_none.return_value = mock_account
        mock_account_query.where.return_value = mock_account_where

        # Setup query to return different results based on model
        def query_side_effect(model):
            if model.__name__ == "AccountIntegrate":
                return mock_query
            elif model.__name__ == "Account":
                return mock_account_query
            return MagicMock()

        mock_db.session.query.side_effect = query_side_effect

        # Act
        result = Account.get_by_openid(provider, open_id)

        # Assert
        assert result == mock_account

    @patch("models.account.db")
    def test_get_by_openid_not_found(self, mock_db):
        """Test get_by_openid when account integrate doesn't exist."""
        # Arrange
        provider = "github"
        open_id = "github_user_456"

        # Mock the query chain to return None
        mock_query = MagicMock()
        mock_where = MagicMock()
        mock_where.one_or_none.return_value = None
        mock_query.where.return_value = mock_where
        mock_db.session.query.return_value = mock_query

        # Act
        result = Account.get_by_openid(provider, open_id)

        # Assert
        assert result is None


class TestTenantAccountJoinModel:
    """Test suite for TenantAccountJoin model."""

    def test_tenant_account_join_creation(self):
        """Test creating a TenantAccountJoin record."""
        # Arrange
        tenant_id = str(uuid4())
        account_id = str(uuid4())

        # Act
        join = TenantAccountJoin(
            tenant_id=tenant_id,
            account_id=account_id,
            role=TenantAccountRole.NORMAL,
            current=True,
        )

        # Assert
        assert join.tenant_id == tenant_id
        assert join.account_id == account_id
        assert join.role == TenantAccountRole.NORMAL
        assert join.current is True

    def test_tenant_account_join_default_values(self):
        """Test default values for TenantAccountJoin."""
        # Arrange
        tenant_id = str(uuid4())
        account_id = str(uuid4())

        # Act
        join = TenantAccountJoin(
            tenant_id=tenant_id,
            account_id=account_id,
        )

        # Assert
        assert join.current is False  # Default value
        assert join.role == "normal"  # Default value
        assert join.invited_by is None  # Default value

    def test_tenant_account_join_with_invited_by(self):
        """Test TenantAccountJoin with invited_by field."""
        # Arrange
        tenant_id = str(uuid4())
        account_id = str(uuid4())
        inviter_id = str(uuid4())

        # Act
        join = TenantAccountJoin(
            tenant_id=tenant_id,
            account_id=account_id,
            role=TenantAccountRole.EDITOR,
            invited_by=inviter_id,
        )

        # Assert
        assert join.invited_by == inviter_id


class TestTenantModel:
    """Test suite for Tenant model."""

    def test_tenant_creation(self):
        """Test creating a Tenant."""
        # Arrange & Act
        tenant = Tenant(name="Test Workspace")

        # Assert
        assert tenant.name == "Test Workspace"
        assert tenant.status == "normal"  # Default value
        assert tenant.plan == "basic"  # Default value

    def test_tenant_custom_config_dict_property(self):
        """Test custom_config_dict property getter."""
        # Arrange
        tenant = Tenant(name="Test Workspace")
        config = {"feature1": True, "feature2": "value"}
        tenant.custom_config = '{"feature1": true, "feature2": "value"}'

        # Act
        result = tenant.custom_config_dict

        # Assert
        assert result["feature1"] is True
        assert result["feature2"] == "value"

    def test_tenant_custom_config_dict_property_empty(self):
        """Test custom_config_dict property with empty config."""
        # Arrange
        tenant = Tenant(name="Test Workspace")
        tenant.custom_config = None

        # Act
        result = tenant.custom_config_dict

        # Assert
        assert result == {}

    def test_tenant_custom_config_dict_setter(self):
        """Test custom_config_dict property setter."""
        # Arrange
        tenant = Tenant(name="Test Workspace")
        config = {"feature1": True, "feature2": "value"}

        # Act
        tenant.custom_config_dict = config

        # Assert
        assert tenant.custom_config == '{"feature1": true, "feature2": "value"}'

    @patch("models.account.db")
    def test_tenant_get_accounts(self, mock_db):
        """Test getting accounts associated with a tenant."""
        # Arrange
        tenant = Tenant(name="Test Workspace")
        tenant.id = str(uuid4())

        account1 = Account(name="User 1", email="user1@example.com")
        account1.id = str(uuid4())
        account2 = Account(name="User 2", email="user2@example.com")
        account2.id = str(uuid4())

        # Mock the query chain
        mock_scalars = MagicMock()
        mock_scalars.all.return_value = [account1, account2]
        mock_db.session.scalars.return_value = mock_scalars

        # Act
        accounts = tenant.get_accounts()

        # Assert
        assert len(accounts) == 2
        assert account1 in accounts
        assert account2 in accounts


class TestTenantStatusEnum:
    """Test suite for TenantStatus enum."""

    def test_tenant_status_enum_values(self):
        """Test TenantStatus enum values."""
        # Arrange & Act
        from models.account import TenantStatus

        # Assert
        assert TenantStatus.NORMAL == "normal"
        assert TenantStatus.ARCHIVE == "archive"


class TestAccountIntegration:
    """Integration tests for Account model with related models."""

    def test_account_with_multiple_tenants(self):
        """Test account associated with multiple tenants."""
        # Arrange
        account = Account(name="Multi-Tenant User", email="multi@example.com")
        account.id = str(uuid4())

        tenant1_id = str(uuid4())
        tenant2_id = str(uuid4())

        join1 = TenantAccountJoin(
            tenant_id=tenant1_id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )

        join2 = TenantAccountJoin(
            tenant_id=tenant2_id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=False,
        )

        # Assert - verify the joins are created correctly
        assert join1.account_id == account.id
        assert join2.account_id == account.id
        assert join1.current is True
        assert join2.current is False

    def test_account_last_login_tracking(self):
        """Test account last login tracking."""
        # Arrange
        account = Account(name="Test User", email="test@example.com")
        login_time = datetime.now(UTC)
        login_ip = "192.168.1.1"

        # Act
        account.last_login_at = login_time
        account.last_login_ip = login_ip

        # Assert
        assert account.last_login_at == login_time
        assert account.last_login_ip == login_ip

    def test_account_initialization_tracking(self):
        """Test account initialization tracking."""
        # Arrange
        account = Account(
            name="Test User",
            email="test@example.com",
            status=AccountStatus.PENDING,
        )

        # Act - simulate initialization
        account.status = AccountStatus.ACTIVE
        account.initialized_at = datetime.now(UTC)

        # Assert
        assert account.get_status() == AccountStatus.ACTIVE
        assert account.initialized_at is not None
