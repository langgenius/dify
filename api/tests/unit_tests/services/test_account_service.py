import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from models.account import Account, AccountStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountPasswordError,
    AccountRegisterError,
    CurrentPasswordIncorrectError,
)
from tests.unit_tests.services.services_test_help import ServiceDbTestHelper


class TestAccountAssociatedDataFactory:
    """Factory class for creating test data and mock objects for account service tests."""

    @staticmethod
    def create_account_mock(
        account_id: str = "user-123",
        email: str = "test@example.com",
        name: str = "Test User",
        status: str = "active",
        password: str = "hashed_password",
        password_salt: str = "salt",
        interface_language: str = "en-US",
        interface_theme: str = "light",
        timezone: str = "UTC",
        **kwargs,
    ) -> MagicMock:
        """Create a mock account with specified attributes."""
        account = MagicMock(spec=Account)
        account.id = account_id
        account.email = email
        account.name = name
        account.status = status
        account.password = password
        account.password_salt = password_salt
        account.interface_language = interface_language
        account.interface_theme = interface_theme
        account.timezone = timezone
        # Set last_active_at to a datetime object that's older than 10 minutes
        account.last_active_at = datetime.now() - timedelta(minutes=15)
        account.initialized_at = None
        for key, value in kwargs.items():
            setattr(account, key, value)
        return account

    @staticmethod
    def create_tenant_join_mock(
        tenant_id: str = "tenant-456",
        account_id: str = "user-123",
        current: bool = True,
        role: str = "normal",
        **kwargs,
    ) -> MagicMock:
        """Create a mock tenant account join record."""
        tenant_join = MagicMock()
        tenant_join.tenant_id = tenant_id
        tenant_join.account_id = account_id
        tenant_join.current = current
        tenant_join.role = role
        for key, value in kwargs.items():
            setattr(tenant_join, key, value)
        return tenant_join

    @staticmethod
    def create_feature_service_mock(allow_register: bool = True):
        """Create a mock feature service."""
        mock_service = MagicMock()
        mock_service.get_system_features.return_value.is_allow_register = allow_register
        return mock_service

    @staticmethod
    def create_billing_service_mock(email_frozen: bool = False):
        """Create a mock billing service."""
        mock_service = MagicMock()
        mock_service.is_email_in_freeze.return_value = email_frozen
        return mock_service


class TestAccountService:
    """
    Comprehensive unit tests for AccountService methods.

    This test suite covers all account-related operations including:
    - Authentication and login
    - Account creation and registration
    - Password management
    - JWT token generation
    - User loading and tenant management
    - Error conditions and edge cases
    """

    @pytest.fixture
    def mock_db_dependencies(self):
        """Common mock setup for database dependencies."""
        with patch("services.account_service.db") as mock_db:
            mock_db.session.add = MagicMock()
            mock_db.session.commit = MagicMock()
            yield {
                "db": mock_db,
            }

    @pytest.fixture
    def mock_password_dependencies(self):
        """Mock setup for password-related functions."""
        with (
            patch("services.account_service.compare_password") as mock_compare_password,
            patch("services.account_service.hash_password") as mock_hash_password,
            patch("services.account_service.valid_password") as mock_valid_password,
        ):
            yield {
                "compare_password": mock_compare_password,
                "hash_password": mock_hash_password,
                "valid_password": mock_valid_password,
            }

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
            patch("services.account_service.PassportService") as mock_passport_service,
        ):
            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
                "passport_service": mock_passport_service,
            }

    @pytest.fixture
    def mock_db_with_autospec(self):
        """
        Mock database with autospec for more realistic behavior.
        This approach preserves the actual method signatures and behavior.
        """
        with patch("services.account_service.db", autospec=True) as mock_db:
            # Create a more realistic session mock
            mock_session = MagicMock()
            mock_db.session = mock_session

            # Setup basic session methods
            mock_session.add = MagicMock()
            mock_session.commit = MagicMock()
            mock_session.query = MagicMock()

            yield mock_db

    def _assert_database_operations_called(self, mock_db):
        """Helper method to verify database operations were called."""
        mock_db.session.commit.assert_called()

    def _assert_database_operations_not_called(self, mock_db):
        """Helper method to verify database operations were not called."""
        mock_db.session.commit.assert_not_called()

    def _assert_exception_raised(self, exception_type, callable_func, *args, **kwargs):
        """Helper method to verify that specific exception is raised."""
        with pytest.raises(exception_type):
            callable_func(*args, **kwargs)

    # ==================== Authentication Tests ====================

    def test_authenticate_success(self, mock_db_dependencies, mock_password_dependencies):
        """Test successful authentication with correct email and password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Setup smart database query mock
        query_results = {("Account", "email", "test@example.com"): mock_account}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        mock_password_dependencies["compare_password"].return_value = True

        # Execute test
        result = AccountService.authenticate("test@example.com", "password")

        # Verify results
        assert result == mock_account
        self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_authenticate_account_not_found(self, mock_db_dependencies):
        """Test authentication when account does not exist."""
        # Setup smart database query mock - no matching results
        query_results = {("Account", "email", "notfound@example.com"): None}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountPasswordError, AccountService.authenticate, "notfound@example.com", "password"
        )

    def test_authenticate_account_banned(self, mock_db_dependencies):
        """Test authentication when account is banned."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(status="banned")

        # Setup smart database query mock
        query_results = {("Account", "email", "banned@example.com"): mock_account}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Execute test and verify exception
        self._assert_exception_raised(AccountLoginError, AccountService.authenticate, "banned@example.com", "password")

    def test_authenticate_password_error(self, mock_db_dependencies, mock_password_dependencies):
        """Test authentication with wrong password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Setup smart database query mock
        query_results = {("Account", "email", "test@example.com"): mock_account}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        mock_password_dependencies["compare_password"].return_value = False

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountPasswordError, AccountService.authenticate, "test@example.com", "wrongpassword"
        )

    def test_authenticate_pending_account_activates(self, mock_db_dependencies, mock_password_dependencies):
        """Test authentication for a pending account, which should activate on login."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(status="pending")

        # Setup smart database query mock
        query_results = {("Account", "email", "pending@example.com"): mock_account}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        mock_password_dependencies["compare_password"].return_value = True

        # Execute test
        result = AccountService.authenticate("pending@example.com", "password")

        # Verify results
        assert result == mock_account
        assert mock_account.status == "active"
        self._assert_database_operations_called(mock_db_dependencies["db"])

    # ==================== Account Creation Tests ====================

    def test_create_account_success(
        self, mock_db_dependencies, mock_password_dependencies, mock_external_service_dependencies
    ):
        """Test successful account creation with all required parameters."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_password_dependencies["hash_password"].return_value = b"hashed_password"

        # Execute test
        result = AccountService.create_account(
            email="test@example.com",
            name="Test User",
            interface_language="en-US",
            password="password123",
            interface_theme="light",
        )

        # Verify results
        assert result.email == "test@example.com"
        assert result.name == "Test User"
        assert result.interface_language == "en-US"
        assert result.interface_theme == "light"
        assert result.password is not None
        assert result.password_salt is not None
        assert result.timezone is not None

        # Verify database operations
        mock_db_dependencies["db"].session.add.assert_called_once()
        added_account = mock_db_dependencies["db"].session.add.call_args[0][0]
        assert added_account.email == "test@example.com"
        assert added_account.name == "Test User"
        assert added_account.interface_language == "en-US"
        assert added_account.interface_theme == "light"
        assert added_account.password is not None
        assert added_account.password_salt is not None
        assert added_account.timezone is not None
        self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_create_account_registration_disabled(self, mock_external_service_dependencies):
        """Test account creation when registration is disabled."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = False

        # Execute test and verify exception
        self._assert_exception_raised(
            Exception,  # AccountNotFound
            AccountService.create_account,
            email="test@example.com",
            name="Test User",
            interface_language="en-US",
        )

    def test_create_account_email_frozen(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test account creation with frozen email address."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True
        dify_config.BILLING_ENABLED = True

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountRegisterError,
            AccountService.create_account,
            email="frozen@example.com",
            name="Test User",
            interface_language="en-US",
        )
        dify_config.BILLING_ENABLED = False

    def test_create_account_without_password(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test account creation without password (for invite-based registration)."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute test
        result = AccountService.create_account(
            email="test@example.com",
            name="Test User",
            interface_language="zh-CN",
            password=None,
            interface_theme="dark",
        )

        # Verify results
        assert result.email == "test@example.com"
        assert result.name == "Test User"
        assert result.interface_language == "zh-CN"
        assert result.interface_theme == "dark"
        assert result.password is None
        assert result.password_salt is None
        assert result.timezone is not None

        # Verify database operations
        mock_db_dependencies["db"].session.add.assert_called_once()
        added_account = mock_db_dependencies["db"].session.add.call_args[0][0]
        assert added_account.email == "test@example.com"
        assert added_account.name == "Test User"
        assert added_account.interface_language == "zh-CN"
        assert added_account.interface_theme == "dark"
        assert added_account.password is None
        assert added_account.password_salt is None
        assert added_account.timezone is not None
        self._assert_database_operations_called(mock_db_dependencies["db"])

    # ==================== Password Management Tests ====================

    def test_update_account_password_success(self, mock_db_dependencies, mock_password_dependencies):
        """Test successful password update with correct current password and valid new password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_password_dependencies["compare_password"].return_value = True
        mock_password_dependencies["valid_password"].return_value = None
        mock_password_dependencies["hash_password"].return_value = b"new_hashed_password"

        # Execute test
        result = AccountService.update_account_password(mock_account, "old_password", "new_password123")

        # Verify results
        assert result == mock_account
        assert mock_account.password is not None
        assert mock_account.password_salt is not None

        # Verify password validation was called
        mock_password_dependencies["compare_password"].assert_called_once_with(
            "old_password", "hashed_password", "salt"
        )
        mock_password_dependencies["valid_password"].assert_called_once_with("new_password123")

        # Verify database operations
        self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_update_account_password_current_password_incorrect(self, mock_password_dependencies):
        """Test password update with incorrect current password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_password_dependencies["compare_password"].return_value = False

        # Execute test and verify exception
        self._assert_exception_raised(
            CurrentPasswordIncorrectError,
            AccountService.update_account_password,
            mock_account,
            "wrong_password",
            "new_password123",
        )

        # Verify password comparison was called
        mock_password_dependencies["compare_password"].assert_called_once_with(
            "wrong_password", "hashed_password", "salt"
        )

    def test_update_account_password_invalid_new_password(self, mock_password_dependencies):
        """Test password update with invalid new password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_password_dependencies["compare_password"].return_value = True
        mock_password_dependencies["valid_password"].side_effect = ValueError("Password too short")

        # Execute test and verify exception
        self._assert_exception_raised(
            ValueError, AccountService.update_account_password, mock_account, "old_password", "short"
        )

        # Verify password validation was called
        mock_password_dependencies["valid_password"].assert_called_once_with("short")

    # ==================== User Loading Tests ====================

    def test_load_user_success(self, mock_db_dependencies):
        """Test successful user loading with current tenant."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_tenant_join = TestAccountAssociatedDataFactory.create_tenant_join_mock()

        # Setup smart database query mock
        query_results = {
            ("Account", "id", "user-123"): mock_account,
            ("TenantAccountJoin", "account_id", "user-123"): mock_tenant_join,
        }
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Mock datetime
        with patch("services.account_service.datetime") as mock_datetime:
            mock_now = datetime.now()
            mock_datetime.now.return_value = mock_now
            mock_datetime.UTC = "UTC"

            # Execute test
            result = AccountService.load_user("user-123")

            # Verify results
            assert result == mock_account
            assert mock_account.set_tenant_id.called

    def test_load_user_not_found(self, mock_db_dependencies):
        """Test user loading when user does not exist."""
        # Setup smart database query mock - no matching results
        query_results = {("Account", "id", "non-existent-user"): None}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Execute test
        result = AccountService.load_user("non-existent-user")

        # Verify results
        assert result is None

    def test_load_user_banned(self, mock_db_dependencies):
        """Test user loading when user is banned."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(status="banned")

        # Setup smart database query mock
        query_results = {("Account", "id", "user-123"): mock_account}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Execute test and verify exception
        self._assert_exception_raised(
            Exception,  # Unauthorized
            AccountService.load_user,
            "user-123",
        )

    def test_load_user_no_current_tenant(self, mock_db_dependencies):
        """Test user loading when user has no current tenant but has available tenants."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_available_tenant = TestAccountAssociatedDataFactory.create_tenant_join_mock(current=False)

        # Setup smart database query mock for complex scenario
        query_results = {
            ("Account", "id", "user-123"): mock_account,
            ("TenantAccountJoin", "account_id", "user-123"): None,  # No current tenant
            ("TenantAccountJoin", "order_by", "first_available"): mock_available_tenant,  # First available tenant
        }
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Mock datetime
        with patch("services.account_service.datetime") as mock_datetime:
            mock_now = datetime.now()
            mock_datetime.now.return_value = mock_now
            mock_datetime.UTC = "UTC"

            # Execute test
            result = AccountService.load_user("user-123")

            # Verify results
            assert result == mock_account
            assert mock_available_tenant.current is True
            self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_load_user_no_tenants(self, mock_db_dependencies):
        """Test user loading when user has no tenants at all."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Setup smart database query mock for no tenants scenario
        query_results = {
            ("Account", "id", "user-123"): mock_account,
            ("TenantAccountJoin", "account_id", "user-123"): None,  # No current tenant
            ("TenantAccountJoin", "order_by", "first_available"): None,  # No available tenants
        }
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Mock datetime
        with patch("services.account_service.datetime") as mock_datetime:
            mock_now = datetime.now()
            mock_datetime.now.return_value = mock_now
            mock_datetime.UTC = "UTC"

            # Execute test
            result = AccountService.load_user("user-123")

            # Verify results
            assert result is None


class TestTenantService:
    """
    Comprehensive unit tests for TenantService methods.

    This test suite covers all tenant-related operations including:
    - Tenant creation and management
    - Member management and permissions
    - Tenant switching
    - Role updates and permission checks
    - Error conditions and edge cases
    """

    @pytest.fixture
    def mock_db_dependencies(self):
        """Common mock setup for database dependencies."""
        with patch("services.account_service.db") as mock_db:
            mock_db.session.add = MagicMock()
            mock_db.session.commit = MagicMock()
            yield {
                "db": mock_db,
            }

    @pytest.fixture
    def mock_rsa_dependencies(self):
        """Mock setup for RSA-related functions."""
        with patch("services.account_service.generate_key_pair") as mock_generate_key_pair:
            yield mock_generate_key_pair

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
        ):
            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
            }

    def _assert_database_operations_called(self, mock_db):
        """Helper method to verify database operations were called."""
        mock_db.session.commit.assert_called()

    def _assert_exception_raised(self, exception_type, callable_func, *args, **kwargs):
        """Helper method to verify that specific exception is raised."""
        with pytest.raises(exception_type):
            callable_func(*args, **kwargs)

    # ==================== Tenant Creation Tests ====================

    def test_create_owner_tenant_if_not_exist_new_user(
        self, mock_db_dependencies, mock_rsa_dependencies, mock_external_service_dependencies
    ):
        """Test creating owner tenant for new user without existing tenants."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Setup smart database query mock - no existing tenant joins
        query_results = {
            ("TenantAccountJoin", "account_id", "user-123"): None,
            ("TenantAccountJoin", "tenant_id", "tenant-456"): None,  # For has_roles check
        }
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Setup external service mocks
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True

        # Mock tenant creation
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test User's Workspace"

        # Mock database operations
        mock_db_dependencies["db"].session.add = MagicMock()

        # Mock RSA key generation
        mock_rsa_dependencies.return_value = "mock_public_key"

        # Mock has_roles method to return False (no existing owner)
        with patch("services.account_service.TenantService.has_roles") as mock_has_roles:
            mock_has_roles.return_value = False

            # Mock Tenant creation to set proper ID
            with patch("services.account_service.Tenant") as mock_tenant_class:
                mock_tenant_instance = MagicMock()
                mock_tenant_instance.id = "tenant-456"
                mock_tenant_instance.name = "Test User's Workspace"
                mock_tenant_class.return_value = mock_tenant_instance

                # Mock the db import in CreditPoolService to avoid database connection
                with patch("services.credit_pool_service.db") as mock_credit_pool_db:
                    mock_credit_pool_db.session.add = MagicMock()
                    mock_credit_pool_db.session.commit = MagicMock()

                    # Execute test
                    TenantService.create_owner_tenant_if_not_exist(mock_account)

        # Verify tenant was created with correct parameters
        mock_db_dependencies["db"].session.add.assert_called()

        # Get all calls to session.add
        add_calls = mock_db_dependencies["db"].session.add.call_args_list

        # Should have at least 2 calls: one for Tenant, one for TenantAccountJoin
        assert len(add_calls) >= 2

        # Verify Tenant was added with correct name
        tenant_added = False
        tenant_account_join_added = False

        for call in add_calls:
            added_object = call[0][0]  # First argument of the call

            # Check if it's a Tenant object
            if hasattr(added_object, "name") and hasattr(added_object, "id"):
                # This should be a Tenant object
                assert added_object.name == "Test User's Workspace"
                tenant_added = True

            # Check if it's a TenantAccountJoin object
            elif (
                hasattr(added_object, "tenant_id")
                and hasattr(added_object, "account_id")
                and hasattr(added_object, "role")
            ):
                # This should be a TenantAccountJoin object
                assert added_object.tenant_id is not None
                assert added_object.account_id == "user-123"
                assert added_object.role == "owner"
                tenant_account_join_added = True

        assert tenant_added, "Tenant object was not added to database"
        assert tenant_account_join_added, "TenantAccountJoin object was not added to database"

        self._assert_database_operations_called(mock_db_dependencies["db"])
        assert mock_rsa_dependencies.called, "RSA key generation was not called"

    # ==================== Member Management Tests ====================

    def test_create_tenant_member_success(self, mock_db_dependencies):
        """Test successful tenant member creation."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Setup smart database query mock - no existing member
        query_results = {("TenantAccountJoin", "tenant_id", "tenant-456"): None}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Mock database operations
        mock_db_dependencies["db"].session.add = MagicMock()

        # Execute test
        result = TenantService.create_tenant_member(mock_tenant, mock_account, "normal")

        # Verify member was created with correct parameters
        assert result is not None
        mock_db_dependencies["db"].session.add.assert_called_once()

        # Verify the TenantAccountJoin object was added with correct parameters
        added_tenant_account_join = mock_db_dependencies["db"].session.add.call_args[0][0]
        assert added_tenant_account_join.tenant_id == "tenant-456"
        assert added_tenant_account_join.account_id == "user-123"
        assert added_tenant_account_join.role == "normal"

        self._assert_database_operations_called(mock_db_dependencies["db"])

    # ==================== Tenant Switching Tests ====================

    def test_switch_tenant_success(self):
        """Test successful tenant switching."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_tenant_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="user-123", current=False
        )

        # Mock the complex query in switch_tenant method
        with patch("services.account_service.db") as mock_db:
            # Mock the join query that returns the tenant_account_join
            mock_query = MagicMock()
            mock_where = MagicMock()
            mock_where.first.return_value = mock_tenant_join
            mock_query.where.return_value = mock_where
            mock_query.join.return_value = mock_query
            mock_db.session.query.return_value = mock_query

            # Execute test
            TenantService.switch_tenant(mock_account, "tenant-456")

            # Verify tenant was switched
            assert mock_tenant_join.current is True
            self._assert_database_operations_called(mock_db)

    def test_switch_tenant_no_tenant_id(self):
        """Test tenant switching without providing tenant ID."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Execute test and verify exception
        self._assert_exception_raised(ValueError, TenantService.switch_tenant, mock_account, None)

    # ==================== Role Management Tests ====================

    def test_update_member_role_success(self):
        """Test successful member role update."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_target_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="member-789", role="normal"
        )
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="owner"
        )

        # Mock the database queries in update_member_role method
        with patch("services.account_service.db") as mock_db:
            # Mock the first query for operator permission check
            mock_query1 = MagicMock()
            mock_filter1 = MagicMock()
            mock_filter1.first.return_value = mock_operator_join
            mock_query1.filter_by.return_value = mock_filter1

            # Mock the second query for target member
            mock_query2 = MagicMock()
            mock_filter2 = MagicMock()
            mock_filter2.first.return_value = mock_target_join
            mock_query2.filter_by.return_value = mock_filter2

            # Make the query method return different mocks for different calls
            mock_db.session.query.side_effect = [mock_query1, mock_query2]

            # Execute test
            TenantService.update_member_role(mock_tenant, mock_member, "admin", mock_operator)

            # Verify role was updated
            assert mock_target_join.role == "admin"
            self._assert_database_operations_called(mock_db)

    # ==================== Permission Check Tests ====================

    def test_check_member_permission_success(self, mock_db_dependencies):
        """Test successful member permission check."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="owner"
        )

        # Setup smart database query mock
        query_results = {("TenantAccountJoin", "tenant_id", "tenant-456"): mock_operator_join}
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Execute test - should not raise exception
        TenantService.check_member_permission(mock_tenant, mock_operator, mock_member, "add")

    def test_check_member_permission_operate_self(self):
        """Test member permission check when operator tries to operate self."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")

        # Execute test and verify exception
        from services.errors.account import CannotOperateSelfError

        self._assert_exception_raised(
            CannotOperateSelfError,
            TenantService.check_member_permission,
            mock_tenant,
            mock_operator,
            mock_operator,  # Same as operator
            "add",
        )


class TestRegisterService:
    """
    Comprehensive unit tests for RegisterService methods.

    This test suite covers all registration-related operations including:
    - System setup
    - Account registration
    - Member invitation
    - Token management
    - Invitation validation
    - Error conditions and edge cases
    """

    @pytest.fixture
    def mock_db_dependencies(self):
        """Common mock setup for database dependencies."""
        with patch("services.account_service.db") as mock_db:
            mock_db.session.add = MagicMock()
            mock_db.session.commit = MagicMock()
            mock_db.session.begin_nested = MagicMock()
            mock_db.session.rollback = MagicMock()
            yield {
                "db": mock_db,
            }

    @pytest.fixture
    def mock_redis_dependencies(self):
        """Mock setup for Redis-related functions."""
        with patch("services.account_service.redis_client") as mock_redis:
            yield mock_redis

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
            patch("services.account_service.PassportService") as mock_passport_service,
        ):
            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
                "passport_service": mock_passport_service,
            }

    @pytest.fixture
    def mock_task_dependencies(self):
        """Mock setup for task dependencies."""
        with patch("services.account_service.send_invite_member_mail_task") as mock_send_mail:
            yield mock_send_mail

    def _assert_database_operations_called(self, mock_db):
        """Helper method to verify database operations were called."""
        mock_db.session.commit.assert_called()

    def _assert_database_operations_not_called(self, mock_db):
        """Helper method to verify database operations were not called."""
        mock_db.session.commit.assert_not_called()

    def _assert_exception_raised(self, exception_type, callable_func, *args, **kwargs):
        """Helper method to verify that specific exception is raised."""
        with pytest.raises(exception_type):
            callable_func(*args, **kwargs)

    # ==================== Setup Tests ====================

    def test_setup_success(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test successful system setup."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            # Mock TenantService.create_owner_tenant_if_not_exist
            with patch("services.account_service.TenantService.create_owner_tenant_if_not_exist") as mock_create_tenant:
                # Mock DifySetup
                with patch("services.account_service.DifySetup") as mock_dify_setup:
                    mock_dify_setup_instance = MagicMock()
                    mock_dify_setup.return_value = mock_dify_setup_instance

                    # Execute test
                    RegisterService.setup("admin@example.com", "Admin User", "password123", "192.168.1.1", "en-US")

                    # Verify results
                    mock_create_account.assert_called_once_with(
                        email="admin@example.com",
                        name="Admin User",
                        interface_language="en-US",
                        password="password123",
                        is_setup=True,
                    )
                    mock_create_tenant.assert_called_once_with(account=mock_account, is_setup=True)
                    mock_dify_setup.assert_called_once()
                    self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_setup_failure_rollback(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test setup failure with proper rollback."""
        # Setup mocks to simulate failure
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account to raise exception
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.side_effect = Exception("Database error")

            # Execute test and verify exception
            self._assert_exception_raised(
                ValueError,
                RegisterService.setup,
                "admin@example.com",
                "Admin User",
                "password123",
                "192.168.1.1",
                "en-US",
            )

            # Verify rollback operations were called
            mock_db_dependencies["db"].session.query.assert_called()

    # ==================== Registration Tests ====================

    def test_register_success(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test successful account registration."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            # Mock TenantService.create_tenant and create_tenant_member
            with (
                patch("services.account_service.TenantService.create_tenant") as mock_create_tenant,
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.tenant_was_created") as mock_event,
            ):
                mock_tenant = MagicMock()
                mock_tenant.id = "tenant-456"
                mock_create_tenant.return_value = mock_tenant

                # Execute test
                result = RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                )

                # Verify results
                assert result == mock_account
                assert result.status == "active"
                assert result.initialized_at is not None
                mock_create_account.assert_called_once_with(
                    email="test@example.com",
                    name="Test User",
                    interface_language="en-US",
                    password="password123",
                    is_setup=False,
                )
                mock_create_tenant.assert_called_once_with("Test User's Workspace")
                mock_create_member.assert_called_once_with(mock_tenant, mock_account, role="owner")
                mock_event.send.assert_called_once_with(mock_tenant)
                self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_register_with_oauth(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test account registration with OAuth integration."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account and link_account_integrate
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.AccountService.link_account_integrate") as mock_link_account,
        ):
            mock_create_account.return_value = mock_account

            # Mock TenantService methods
            with (
                patch("services.account_service.TenantService.create_tenant") as mock_create_tenant,
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.tenant_was_created") as mock_event,
            ):
                mock_tenant = MagicMock()
                mock_create_tenant.return_value = mock_tenant

                # Execute test
                result = RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password=None,
                    open_id="oauth123",
                    provider="google",
                    language="en-US",
                )

                # Verify results
                assert result == mock_account
                mock_link_account.assert_called_once_with("google", "oauth123", mock_account)
                self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_register_with_pending_status(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test account registration with pending status."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            # Mock TenantService methods
            with (
                patch("services.account_service.TenantService.create_tenant") as mock_create_tenant,
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.tenant_was_created") as mock_event,
            ):
                mock_tenant = MagicMock()
                mock_create_tenant.return_value = mock_tenant

                # Execute test with pending status
                from models.account import AccountStatus

                result = RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                    status=AccountStatus.PENDING,
                )

                # Verify results
                assert result == mock_account
                assert result.status == "pending"
                self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_register_workspace_not_allowed(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test registration when workspace creation is not allowed."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            # Execute test and verify exception
            from services.errors.workspace import WorkSpaceNotAllowedCreateError

            with patch("services.account_service.TenantService.create_tenant") as mock_create_tenant:
                mock_create_tenant.side_effect = WorkSpaceNotAllowedCreateError()

                self._assert_exception_raised(
                    AccountRegisterError,
                    RegisterService.register,
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                )

                # Verify rollback was called
                mock_db_dependencies["db"].session.rollback.assert_called()

    def test_register_general_exception(self, mock_db_dependencies, mock_external_service_dependencies):
        """Test registration with general exception handling."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account to raise exception
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.side_effect = Exception("Unexpected error")

            # Execute test and verify exception
            self._assert_exception_raised(
                AccountRegisterError,
                RegisterService.register,
                email="test@example.com",
                name="Test User",
                password="password123",
                language="en-US",
            )

            # Verify rollback was called
            mock_db_dependencies["db"].session.rollback.assert_called()

    # ==================== Member Invitation Tests ====================

    def test_invite_new_member_new_account(self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies):
        """Test inviting a new member who doesn't have an account."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test Workspace"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")

        # Mock database queries - need to mock the Session query
        mock_session = MagicMock()
        mock_session.query.return_value.filter_by.return_value.first.return_value = None  # No existing account

        with (
            patch("services.account_service.Session") as mock_session_class,
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session_class.return_value.__exit__.return_value = None
            mock_lookup.return_value = None

            # Mock RegisterService.register
            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="new-user-456", email="newuser@example.com", name="newuser", status="pending"
            )
            with patch("services.account_service.RegisterService.register") as mock_register:
                mock_register.return_value = mock_new_account

                # Mock TenantService methods
                with (
                    patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                    patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                    patch("services.account_service.TenantService.switch_tenant") as mock_switch_tenant,
                    patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
                ):
                    mock_generate_token.return_value = "invite-token-123"

                    # Execute test
                    result = RegisterService.invite_new_member(
                        tenant=mock_tenant,
                        email="newuser@example.com",
                        language="en-US",
                        role="normal",
                        inviter=mock_inviter,
                    )

                    # Verify results
                    assert result == "invite-token-123"
                    mock_register.assert_called_once_with(
                        email="newuser@example.com",
                        name="newuser",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                    )
                    mock_lookup.assert_called_once_with("newuser@example.com", session=mock_session)

    def test_invite_new_member_normalizes_new_account_email(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """Ensure inviting with mixed-case email normalizes before registering."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mixed_email = "Invitee@Example.com"

        mock_session = MagicMock()
        with (
            patch("services.account_service.Session") as mock_session_class,
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session_class.return_value.__exit__.return_value = None
            mock_lookup.return_value = None

            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="new-user-789", email="invitee@example.com", name="invitee", status="pending"
            )
            with patch("services.account_service.RegisterService.register") as mock_register:
                mock_register.return_value = mock_new_account
                with (
                    patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                    patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                    patch("services.account_service.TenantService.switch_tenant") as mock_switch_tenant,
                    patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
                ):
                    mock_generate_token.return_value = "invite-token-abc"

                    RegisterService.invite_new_member(
                        tenant=mock_tenant,
                        email=mixed_email,
                        language="en-US",
                        role="normal",
                        inviter=mock_inviter,
                    )

                    mock_register.assert_called_once_with(
                        email="invitee@example.com",
                        name="invitee",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                    )
                    mock_lookup.assert_called_once_with(mixed_email, session=mock_session)
                    mock_check_permission.assert_called_once_with(mock_tenant, mock_inviter, None, "add")
                    mock_create_member.assert_called_once_with(mock_tenant, mock_new_account, "normal")
                    mock_switch_tenant.assert_called_once_with(mock_new_account, mock_tenant.id)
                    mock_generate_token.assert_called_once_with(mock_tenant, mock_new_account)
                    mock_task_dependencies.delay.assert_called_once()

    def test_invite_new_member_existing_account(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """Test inviting a new member who already has an account."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test Workspace"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="pending"
        )

        # Mock database queries - need to mock the Session query
        mock_session = MagicMock()
        mock_session.query.return_value.filter_by.return_value.first.return_value = mock_existing_account

        with (
            patch("services.account_service.Session") as mock_session_class,
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_session_class.return_value.__enter__.return_value = mock_session
            mock_session_class.return_value.__exit__.return_value = None
            mock_lookup.return_value = mock_existing_account

            # Mock the db.session.query for TenantAccountJoin
            mock_db_query = MagicMock()
            mock_db_query.filter_by.return_value.first.return_value = None  # No existing member
            mock_db_dependencies["db"].session.query.return_value = mock_db_query

            # Mock TenantService methods
            with (
                patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
            ):
                mock_generate_token.return_value = "invite-token-123"

                # Execute test
                result = RegisterService.invite_new_member(
                    tenant=mock_tenant,
                    email="existing@example.com",
                    language="en-US",
                    role="normal",
                    inviter=mock_inviter,
                )

                # Verify results
                assert result == "invite-token-123"
                mock_create_member.assert_called_once_with(mock_tenant, mock_existing_account, "normal")
                mock_generate_token.assert_called_once_with(mock_tenant, mock_existing_account)
                mock_task_dependencies.delay.assert_called_once()
                mock_lookup.assert_called_once_with("existing@example.com", session=mock_session)

    def test_invite_new_member_already_in_tenant(self, mock_db_dependencies, mock_redis_dependencies):
        """Test inviting a member who is already in the tenant."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="active"
        )

        # Mock database queries
        query_results = {
            (
                "TenantAccountJoin",
                "tenant_id",
                "tenant-456",
            ): TestAccountAssociatedDataFactory.create_tenant_join_mock(),
        }
        ServiceDbTestHelper.setup_db_query_filter_by_mock(mock_db_dependencies["db"], query_results)

        # Mock TenantService methods
        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
        ):
            mock_lookup.return_value = mock_existing_account
            # Execute test and verify exception
            self._assert_exception_raised(
                AccountAlreadyInTenantError,
                RegisterService.invite_new_member,
                tenant=mock_tenant,
                email="existing@example.com",
                language="en-US",
                role="normal",
                inviter=mock_inviter,
            )
            mock_lookup.assert_called_once()

    def test_invite_new_member_no_inviter(self):
        """Test inviting a member without providing an inviter."""
        # Setup test data
        mock_tenant = MagicMock()

        # Execute test and verify exception
        self._assert_exception_raised(
            ValueError,
            RegisterService.invite_new_member,
            tenant=mock_tenant,
            email="test@example.com",
            language="en-US",
            role="normal",
            inviter=None,
        )

    # ==================== Token Management Tests ====================

    def test_generate_invite_token_success(self, mock_redis_dependencies):
        """Test successful invite token generation."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="user-123", email="test@example.com"
        )

        # Mock uuid generation
        with patch("services.account_service.uuid.uuid4") as mock_uuid:
            mock_uuid.return_value = "test-uuid-123"

            # Execute test
            result = RegisterService.generate_invite_token(mock_tenant, mock_account)

            # Verify results
            assert result == "test-uuid-123"
            mock_redis_dependencies.setex.assert_called_once()

            # Verify the stored data
            call_args = mock_redis_dependencies.setex.call_args
            assert call_args[0][0] == "member_invite:token:test-uuid-123"
            stored_data = json.loads(call_args[0][2])
            assert stored_data["account_id"] == "user-123"
            assert stored_data["email"] == "test@example.com"
            assert stored_data["workspace_id"] == "tenant-456"

    def test_is_valid_invite_token_valid(self, mock_redis_dependencies):
        """Test checking valid invite token."""
        # Setup mock
        mock_redis_dependencies.get.return_value = b'{"test": "data"}'

        # Execute test
        result = RegisterService.is_valid_invite_token("valid-token")

        # Verify results
        assert result is True
        mock_redis_dependencies.get.assert_called_once_with("member_invite:token:valid-token")

    def test_is_valid_invite_token_invalid(self, mock_redis_dependencies):
        """Test checking invalid invite token."""
        # Setup mock
        mock_redis_dependencies.get.return_value = None

        # Execute test
        result = RegisterService.is_valid_invite_token("invalid-token")

        # Verify results
        assert result is False
        mock_redis_dependencies.get.assert_called_once_with("member_invite:token:invalid-token")

    def test_revoke_token_with_workspace_and_email(self, mock_redis_dependencies):
        """Test revoking token with workspace ID and email."""
        # Execute test
        RegisterService.revoke_token("workspace-123", "test@example.com", "token-123")

        # Verify results
        mock_redis_dependencies.delete.assert_called_once()
        call_args = mock_redis_dependencies.delete.call_args
        assert "workspace-123" in call_args[0][0]
        # The email is hashed, so we check for the hash pattern instead
        assert "member_invite_token:" in call_args[0][0]

    def test_revoke_token_without_workspace_and_email(self, mock_redis_dependencies):
        """Test revoking token without workspace ID and email."""
        # Execute test
        RegisterService.revoke_token("", "", "token-123")

        # Verify results
        mock_redis_dependencies.delete.assert_called_once_with("member_invite:token:token-123")

    # ==================== Invitation Validation Tests ====================

    def test_get_invitation_if_token_valid_success(self, mock_db_dependencies, mock_redis_dependencies):
        """Test successful invitation validation."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.status = "normal"
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="user-123", email="test@example.com"
        )

        with patch("services.account_service.RegisterService.get_invitation_by_token") as mock_get_invitation_by_token:
            # Mock the invitation data returned by get_invitation_by_token
            invitation_data = {
                "account_id": "user-123",
                "email": "test@example.com",
                "workspace_id": "tenant-456",
            }
            mock_get_invitation_by_token.return_value = invitation_data

            # Mock database queries - complex query mocking
            mock_query1 = MagicMock()
            mock_query1.where.return_value.first.return_value = mock_tenant

            mock_query2 = MagicMock()
            mock_query2.join.return_value.where.return_value.first.return_value = (mock_account, "normal")

            mock_db_dependencies["db"].session.query.side_effect = [mock_query1, mock_query2]

            # Execute test
            result = RegisterService.get_invitation_if_token_valid("tenant-456", "test@example.com", "token-123")

            # Verify results
            assert result is not None
            assert result["account"] == mock_account
            assert result["tenant"] == mock_tenant
            assert result["data"] == invitation_data

    def test_get_invitation_if_token_valid_no_token_data(self, mock_redis_dependencies):
        """Test invitation validation with no token data."""
        # Setup mock
        mock_redis_dependencies.get.return_value = None

        # Execute test
        result = RegisterService.get_invitation_if_token_valid("tenant-456", "test@example.com", "token-123")

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_tenant_not_found(self, mock_db_dependencies, mock_redis_dependencies):
        """Test invitation validation when tenant is not found."""
        # Setup mock Redis data
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        # Mock database queries - no tenant found
        mock_query = MagicMock()
        mock_query.filter.return_value.first.return_value = None
        mock_db_dependencies["db"].session.query.return_value = mock_query

        # Execute test
        result = RegisterService.get_invitation_if_token_valid("tenant-456", "test@example.com", "token-123")

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_account_not_found(self, mock_db_dependencies, mock_redis_dependencies):
        """Test invitation validation when account is not found."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.status = "normal"

        # Mock Redis data
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        # Mock database queries
        mock_query1 = MagicMock()
        mock_query1.filter.return_value.first.return_value = mock_tenant

        mock_query2 = MagicMock()
        mock_query2.join.return_value.where.return_value.first.return_value = None  # No account found

        mock_db_dependencies["db"].session.query.side_effect = [mock_query1, mock_query2]

        # Execute test
        result = RegisterService.get_invitation_if_token_valid("tenant-456", "test@example.com", "token-123")

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_account_id_mismatch(self, mock_db_dependencies, mock_redis_dependencies):
        """Test invitation validation when account ID doesn't match."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.status = "normal"
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="different-user-456", email="test@example.com"
        )

        # Mock Redis data with different account ID
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        # Mock database queries
        mock_query1 = MagicMock()
        mock_query1.filter.return_value.first.return_value = mock_tenant

        mock_query2 = MagicMock()
        mock_query2.join.return_value.where.return_value.first.return_value = (mock_account, "normal")

        mock_db_dependencies["db"].session.query.side_effect = [mock_query1, mock_query2]

        # Execute test
        result = RegisterService.get_invitation_if_token_valid("tenant-456", "test@example.com", "token-123")

        # Verify results
        assert result is None

    def test_get_invitation_with_case_fallback_returns_initial_match(self):
        """Fallback helper should return the initial invitation when present."""
        invitation = {"workspace_id": "tenant-456"}
        with patch(
            "services.account_service.RegisterService.get_invitation_if_token_valid", return_value=invitation
        ) as mock_get:
            result = RegisterService.get_invitation_with_case_fallback("tenant-456", "User@Test.com", "token-123")

        assert result == invitation
        mock_get.assert_called_once_with("tenant-456", "User@Test.com", "token-123")

    def test_get_invitation_with_case_fallback_retries_with_lowercase(self):
        """Fallback helper should retry with lowercase email when needed."""
        invitation = {"workspace_id": "tenant-456"}
        with patch("services.account_service.RegisterService.get_invitation_if_token_valid") as mock_get:
            mock_get.side_effect = [None, invitation]
            result = RegisterService.get_invitation_with_case_fallback("tenant-456", "User@Test.com", "token-123")

        assert result == invitation
        assert mock_get.call_args_list == [
            (("tenant-456", "User@Test.com", "token-123"),),
            (("tenant-456", "user@test.com", "token-123"),),
        ]

    # ==================== Helper Method Tests ====================

    def test_get_invitation_token_key(self):
        """Test the _get_invitation_token_key helper method."""
        # Execute test
        result = RegisterService._get_invitation_token_key("test-token")

        # Verify results
        assert result == "member_invite:token:test-token"

    def test_get_invitation_by_token_with_workspace_and_email(self, mock_redis_dependencies):
        """Test get_invitation_by_token with workspace ID and email."""
        # Setup mock
        mock_redis_dependencies.get.return_value = b"user-123"

        # Execute test
        result = RegisterService.get_invitation_by_token("token-123", "workspace-456", "test@example.com")

        # Verify results
        assert result is not None
        assert result["account_id"] == "user-123"
        assert result["email"] == "test@example.com"
        assert result["workspace_id"] == "workspace-456"

    def test_get_invitation_by_token_without_workspace_and_email(self, mock_redis_dependencies):
        """Test get_invitation_by_token without workspace ID and email."""
        # Setup mock
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        # Execute test
        result = RegisterService.get_invitation_by_token("token-123")

        # Verify results
        assert result is not None
        assert result == invitation_data

    def test_get_invitation_by_token_no_data(self, mock_redis_dependencies):
        """Test get_invitation_by_token with no data."""
        # Setup mock
        mock_redis_dependencies.get.return_value = None

        # Execute test
        result = RegisterService.get_invitation_by_token("token-123")

        # Verify results
        assert result is None
