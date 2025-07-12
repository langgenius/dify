from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from models.account import Account
from services.account_service import AccountService
from services.errors.account import (
    AccountLoginError,
    AccountNotFoundError,
    AccountPasswordError,
    AccountRegisterError,
    CurrentPasswordIncorrectError,
)


class AccountServiceTestDataFactory:
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
        account.last_active_at = MagicMock()
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

    def _setup_smart_db_query_mock(self, mock_db, query_results):
        """
        Smart database query mock that responds based on model type and query parameters.

        Args:
            mock_db: Mock database session
            query_results: Dict mapping (model_name, filter_key, filter_value) to return value
                          Example: {('Account', 'email', 'test@example.com'): mock_account}
        """

        def query_side_effect(model):
            mock_query = MagicMock()

            def filter_by_side_effect(**kwargs):
                mock_filter_result = MagicMock()

                def first_side_effect():
                    # Find matching result based on model and filter parameters
                    for (model_name, filter_key, filter_value), result in query_results.items():
                        if model.__name__ == model_name and filter_key in kwargs and kwargs[filter_key] == filter_value:
                            return result
                    return None

                mock_filter_result.first.side_effect = first_side_effect

                # Handle order_by calls for complex queries
                def order_by_side_effect(*args, **kwargs):
                    mock_order_result = MagicMock()

                    def order_first_side_effect():
                        # Look for order_by results in the same query_results dict
                        for (model_name, filter_key, filter_value), result in query_results.items():
                            if (
                                model.__name__ == model_name
                                and filter_key == "order_by"
                                and filter_value == "first_available"
                            ):
                                return result
                        return None

                    mock_order_result.first.side_effect = order_first_side_effect
                    return mock_order_result

                mock_filter_result.order_by.side_effect = order_by_side_effect
                return mock_filter_result

            mock_query.filter_by.side_effect = filter_by_side_effect
            return mock_query

        mock_db.session.query.side_effect = query_side_effect

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
        mock_account = AccountServiceTestDataFactory.create_account_mock()

        # Setup smart database query mock
        query_results = {("Account", "email", "test@example.com"): mock_account}
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

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
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountNotFoundError, AccountService.authenticate, "notfound@example.com", "password"
        )

    def test_authenticate_account_banned(self, mock_db_dependencies):
        """Test authentication when account is banned."""
        # Setup test data
        mock_account = AccountServiceTestDataFactory.create_account_mock(status="banned")

        # Setup smart database query mock
        query_results = {("Account", "email", "banned@example.com"): mock_account}
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

        # Execute test and verify exception
        self._assert_exception_raised(AccountLoginError, AccountService.authenticate, "banned@example.com", "password")

    def test_authenticate_password_error(self, mock_db_dependencies, mock_password_dependencies):
        """Test authentication with wrong password."""
        # Setup test data
        mock_account = AccountServiceTestDataFactory.create_account_mock()

        # Setup smart database query mock
        query_results = {("Account", "email", "test@example.com"): mock_account}
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

        mock_password_dependencies["compare_password"].return_value = False

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountPasswordError, AccountService.authenticate, "test@example.com", "wrongpassword"
        )

    def test_authenticate_pending_account_activates(self, mock_db_dependencies, mock_password_dependencies):
        """Test authentication for a pending account, which should activate on login."""
        # Setup test data
        mock_account = AccountServiceTestDataFactory.create_account_mock(status="pending")

        # Setup smart database query mock
        query_results = {("Account", "email", "pending@example.com"): mock_account}
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

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
        mock_account = AccountServiceTestDataFactory.create_account_mock()
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
        mock_account = AccountServiceTestDataFactory.create_account_mock()
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
        mock_account = AccountServiceTestDataFactory.create_account_mock()
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
            mock_account = AccountServiceTestDataFactory.create_account_mock()
            mock_tenant_join = AccountServiceTestDataFactory.create_tenant_join_mock()

            # Setup smart database query mock
            query_results = {
                ("Account", "id", "user-123"): mock_account,
                ("TenantAccountJoin", "account_id", "user-123"): mock_tenant_join,
            }
            self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

            # Mock datetime
            with patch("services.account_service.datetime") as mock_datetime:
                mock_now = MagicMock()
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
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

        # Execute test
        result = AccountService.load_user("non-existent-user")

        # Verify results
        assert result is None

    def test_load_user_banned(self, mock_db_dependencies):
        """Test user loading when user is banned."""
        # Setup test data
        mock_account = AccountServiceTestDataFactory.create_account_mock(status="banned")

        # Setup smart database query mock
        query_results = {("Account", "id", "user-123"): mock_account}
        self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

        # Execute test and verify exception
        self._assert_exception_raised(
            Exception,  # Unauthorized
            AccountService.load_user,
            "user-123",
        )

        def test_load_user_no_current_tenant(self, mock_db_dependencies):
            """Test user loading when user has no current tenant but has available tenants."""
            # Setup test data
            mock_account = AccountServiceTestDataFactory.create_account_mock()
            mock_available_tenant = AccountServiceTestDataFactory.create_tenant_join_mock(current=False)

            # Setup smart database query mock for complex scenario
            query_results = {
                ("Account", "id", "user-123"): mock_account,
                ("TenantAccountJoin", "account_id", "user-123"): None,  # No current tenant
                ("TenantAccountJoin", "order_by", "first_available"): mock_available_tenant,  # First available tenant
            }
            self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

            # Mock datetime
            with patch("services.account_service.datetime") as mock_datetime:
                mock_now = MagicMock()
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
            mock_account = AccountServiceTestDataFactory.create_account_mock()

            # Setup smart database query mock for no tenants scenario
            query_results = {
                ("Account", "id", "user-123"): mock_account,
                ("TenantAccountJoin", "account_id", "user-123"): None,  # No current tenant
                ("TenantAccountJoin", "order_by", "first_available"): None,  # No available tenants
            }
            self._setup_smart_db_query_mock(mock_db_dependencies["db"], query_results)

            # Mock datetime
            with patch("services.account_service.datetime") as mock_datetime:
                mock_now = MagicMock()
                mock_datetime.now.return_value = mock_now
                mock_datetime.UTC = "UTC"

                # Execute test
                result = AccountService.load_user("user-123")

                # Verify results
                assert result is None
