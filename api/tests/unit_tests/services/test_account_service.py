import json
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from configs import dify_config
from models.account import Account, AccountStatus, TenantAccountRole, TenantStatus
from services.account_service import AccountService, RegisterService, TenantService
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountPasswordError,
    AccountRegisterError,
    CurrentPasswordIncorrectError,
    NoPermissionError,
)


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
        tenant_join.last_opened_at = kwargs.pop("last_opened_at", None)
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

        mock_db_dependencies["db"].session.scalar.return_value = mock_account

        mock_password_dependencies["compare_password"].return_value = True

        # Execute test
        result = AccountService.authenticate("test@example.com", "password", session=mock_db_dependencies["db"].session)

        # Verify results
        assert result == mock_account
        self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_authenticate_account_not_found(self, mock_db_dependencies):
        """Test authentication when account does not exist."""
        mock_db_dependencies["db"].session.scalar.return_value = None

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountPasswordError,
            AccountService.authenticate,
            "notfound@example.com",
            "password",
            session=mock_db_dependencies["db"].session,
        )

    def test_authenticate_account_banned(self, mock_db_dependencies):
        """Test authentication when account is banned."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(status="banned")

        mock_db_dependencies["db"].session.scalar.return_value = mock_account

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountLoginError,
            AccountService.authenticate,
            "banned@example.com",
            "password",
            session=mock_db_dependencies["db"].session,
        )

    def test_authenticate_password_error(self, mock_db_dependencies, mock_password_dependencies):
        """Test authentication with wrong password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        mock_db_dependencies["db"].session.scalar.return_value = mock_account

        mock_password_dependencies["compare_password"].return_value = False

        # Execute test and verify exception
        self._assert_exception_raised(
            AccountPasswordError,
            AccountService.authenticate,
            "test@example.com",
            "wrongpassword",
            session=mock_db_dependencies["db"].session,
        )

    def test_authenticate_pending_account_activates(self, mock_db_dependencies, mock_password_dependencies):
        """Test authentication for a pending account, which should activate on login."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(status="pending")

        mock_db_dependencies["db"].session.scalar.return_value = mock_account

        mock_password_dependencies["compare_password"].return_value = True

        # Execute test
        result = AccountService.authenticate(
            "pending@example.com", "password", session=mock_db_dependencies["db"].session
        )

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
            session=mock_db_dependencies["db"].session,
        )

        # Verify results
        assert result.email == "test@example.com"
        assert result.name == "Test User"
        assert result.interface_language == "en-US"
        assert result.interface_theme == "light"
        assert result.password is not None
        assert result.password_salt is not None
        assert result.timezone == "America/New_York"

        # Verify database operations
        mock_db_dependencies["db"].session.add.assert_called_once()
        added_account = mock_db_dependencies["db"].session.add.call_args[0][0]
        assert added_account.email == "test@example.com"
        assert added_account.name == "Test User"
        assert added_account.interface_language == "en-US"
        assert added_account.interface_theme == "light"
        assert added_account.password is not None
        assert added_account.password_salt is not None
        assert added_account.timezone == "America/New_York"
        self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_create_account_uses_explicit_timezone(
        self, mock_db_dependencies, mock_password_dependencies, mock_external_service_dependencies
    ):
        """Test account creation prefers explicit browser timezone."""
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_password_dependencies["hash_password"].return_value = b"hashed_password"

        result = AccountService.create_account(
            email="test@example.com",
            name="Test User",
            interface_language="en-US",
            password="password123",
            timezone="Asia/Shanghai",
            session=mock_db_dependencies["db"].session,
        )

        assert result.timezone == "Asia/Shanghai"
        added_account = mock_db_dependencies["db"].session.add.call_args[0][0]
        assert added_account.timezone == "Asia/Shanghai"
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
            session=MagicMock(),
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
            session=mock_db_dependencies["db"].session,
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
            session=mock_db_dependencies["db"].session,
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
        result = AccountService.update_account_password(
            mock_account, "old_password", "new_password123", session=mock_db_dependencies["db"].session
        )

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

    def test_update_account_password_current_password_incorrect(self, mock_db_dependencies, mock_password_dependencies):
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
            session=mock_db_dependencies["db"].session,
        )

        # Verify password comparison was called
        mock_password_dependencies["compare_password"].assert_called_once_with(
            "wrong_password", "hashed_password", "salt"
        )

    def test_update_account_password_invalid_new_password(self, mock_db_dependencies, mock_password_dependencies):
        """Test password update with invalid new password."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_password_dependencies["compare_password"].return_value = True
        mock_password_dependencies["valid_password"].side_effect = ValueError("Password too short")

        # Execute test and verify exception
        self._assert_exception_raised(
            ValueError,
            AccountService.update_account_password,
            mock_account,
            "old_password",
            "short",
            session=mock_db_dependencies["db"].session,
        )

        # Verify password validation was called
        mock_password_dependencies["valid_password"].assert_called_once_with("short")

    # ==================== User Loading Tests ====================

    def test_load_user_success(self, mock_db_dependencies):
        """Test successful user loading with current tenant."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        mock_tenant_join = TestAccountAssociatedDataFactory.create_tenant_join_mock()

        mock_db_dependencies["db"].session.get.return_value = mock_account
        mock_db_dependencies["db"].session.scalar.return_value = mock_tenant_join

        # Mock datetime
        with (
            patch("services.account_service.datetime") as mock_datetime,
            patch.object(AccountService, "_refresh_account_last_active") as mock_refresh_last_active,
        ):
            mock_now = datetime.now()
            mock_datetime.now.return_value = mock_now
            mock_datetime.UTC = "UTC"

            # Execute test
            result = AccountService.load_user("user-123", mock_db_dependencies["db"].session)

            # Verify results
            assert result == mock_account
            assert mock_account.set_tenant_id.called
            mock_refresh_last_active.assert_called_once_with(mock_account, mock_db_dependencies["db"].session)

    def test_load_user_not_found(self, mock_db_dependencies):
        """Test user loading when user does not exist."""
        mock_db_dependencies["db"].session.get.return_value = None

        # Execute test
        result = AccountService.load_user("non-existent-user", mock_db_dependencies["db"].session)

        # Verify results
        assert result is None

    def test_load_user_banned(self, mock_db_dependencies):
        """Test user loading when user is banned."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(status="banned")

        mock_db_dependencies["db"].session.get.return_value = mock_account

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

        mock_db_dependencies["db"].session.get.return_value = mock_account
        # First scalar: current tenant (None), second scalar: available tenant
        mock_db_dependencies["db"].session.scalar.side_effect = [None, mock_available_tenant]

        # Mock datetime
        with (
            patch("services.account_service.datetime") as mock_datetime,
            patch("services.account_service.naive_utc_now") as mock_naive_utc_now,
            patch.object(AccountService, "_refresh_account_last_active") as mock_refresh_last_active,
        ):
            mock_now = datetime.now()
            mock_datetime.now.return_value = mock_now
            mock_datetime.UTC = "UTC"
            mock_naive_utc_now.return_value = mock_now

            # Execute test
            result = AccountService.load_user("user-123", mock_db_dependencies["db"].session)

            # Verify results
            assert result == mock_account
            assert mock_available_tenant.current is True
            assert mock_available_tenant.last_opened_at == mock_now
            self._assert_database_operations_called(mock_db_dependencies["db"])
            mock_refresh_last_active.assert_called_once_with(mock_account, mock_db_dependencies["db"].session)

    def test_load_user_no_tenants(self, mock_db_dependencies):
        """Test user loading when user has no tenants at all."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        mock_db_dependencies["db"].session.get.return_value = mock_account
        # First scalar: current tenant (None), second scalar: available tenant (None)
        mock_db_dependencies["db"].session.scalar.side_effect = [None, None]

        # Mock datetime
        with patch("services.account_service.datetime") as mock_datetime:
            mock_now = datetime.now()
            mock_datetime.now.return_value = mock_now
            mock_datetime.UTC = "UTC"

            # Execute test
            result = AccountService.load_user("user-123", mock_db_dependencies["db"].session)

            # Verify results
            assert result is None

    def test_refresh_account_last_active_uses_redis_gate_and_conditional_update(self, mock_db_dependencies):
        """Test last-active refresh is gated in Redis and conditionally written to DB."""
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        now = datetime(2026, 6, 2, 2, 45, 49)
        mock_account.last_active_at = now - timedelta(minutes=15)

        with (
            patch("services.account_service.naive_utc_now", return_value=now),
            patch("services.account_service.redis_client") as mock_redis_client,
        ):
            mock_redis_client.set.return_value = True

            AccountService._refresh_account_last_active(mock_account, mock_db_dependencies["db"].session)

        mock_redis_client.set.assert_called_once_with(
            "account_last_active_refresh:user-123",
            1,
            ex=600,
            nx=True,
        )
        mock_db_dependencies["db"].session.execute.assert_called_once()
        mock_db_dependencies["db"].session.commit.assert_called_once()

    def test_refresh_account_last_active_skips_db_when_redis_gate_exists(self, mock_db_dependencies):
        """Test concurrent refresh attempts do not enqueue duplicate DB updates."""
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        now = datetime(2026, 6, 2, 2, 45, 49)
        mock_account.last_active_at = now - timedelta(minutes=15)

        with (
            patch("services.account_service.naive_utc_now", return_value=now),
            patch("services.account_service.redis_client") as mock_redis_client,
        ):
            mock_redis_client.set.return_value = None

            AccountService._refresh_account_last_active(mock_account, mock_db_dependencies["db"].session)

        mock_redis_client.set.assert_called_once_with(
            "account_last_active_refresh:user-123",
            1,
            ex=600,
            nx=True,
        )
        mock_db_dependencies["db"].session.execute.assert_not_called()
        mock_db_dependencies["db"].session.commit.assert_not_called()

    def test_refresh_account_last_active_skips_recent_account(self, mock_db_dependencies):
        """Test recent activity does not touch Redis or DB."""
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        now = datetime(2026, 6, 2, 2, 45, 49)
        mock_account.last_active_at = now - timedelta(minutes=5)

        with (
            patch("services.account_service.naive_utc_now", return_value=now),
            patch("services.account_service.redis_client") as mock_redis_client,
        ):
            AccountService._refresh_account_last_active(mock_account, mock_db_dependencies["db"].session)

        mock_redis_client.set.assert_not_called()
        mock_db_dependencies["db"].session.execute.assert_not_called()
        mock_db_dependencies["db"].session.commit.assert_not_called()


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

    def test_iter_member_account_id_batches_uses_offset_limit(self):
        class FakeScalarResult:
            def __init__(self, items: list[str]) -> None:
                self.items = items

            def all(self) -> list[str]:
                return self.items

        offsets: list[int] = []

        def scalars(stmt):
            offsets.append(stmt._offset_clause.value)
            if len(offsets) == 1:
                return FakeScalarResult(["acct-1", "acct-2"])
            if len(offsets) == 2:
                return FakeScalarResult(["acct-3"])
            return FakeScalarResult([])

        batches = list(
            TenantService.iter_member_account_id_batches("tenant-1", 2, session=SimpleNamespace(scalars=scalars))
        )

        assert batches == [["acct-1", "acct-2"], ["acct-3"]]
        assert offsets == [0, 2, 4]

    # ==================== get_account_role_in_tenant Tests ====================
    # Backs the auth pipeline's `load_workspace_role`: None => non-member
    # (pipeline maps to 404), otherwise the caller's role (out-of-set role => 403).

    def test_get_account_role_in_tenant_returns_role_for_member(self):
        """A row in TenantAccountJoin yields the caller's role."""
        mock_session = MagicMock()
        mock_session.execute.return_value.scalar_one_or_none.return_value = TenantAccountRole.ADMIN

        role = TenantService.get_account_role_in_tenant(mock_session, "account-1", "tenant-1")

        assert role == TenantAccountRole.ADMIN

    def test_get_account_role_in_tenant_returns_none_for_non_member(self):
        """No join row => None, so the gate cannot leak the workspace's existence."""
        mock_session = MagicMock()
        mock_session.execute.return_value.scalar_one_or_none.return_value = None

        role = TenantService.get_account_role_in_tenant(mock_session, "account-1", "tenant-1")

        assert role is None

    def test_get_account_role_in_tenant_short_circuits_empty_account_id(self):
        """None/empty account_id (SSO bearer, missing identity) returns None
        without ever touching the session."""
        mock_session = MagicMock()

        assert TenantService.get_account_role_in_tenant(mock_session, None, "tenant-1") is None
        mock_session.execute.assert_not_called()

    def test_get_account_role_in_tenant_query_is_scoped(self):
        """The lookup must filter on BOTH tenant_id and account_id — otherwise
        a member of workspace A could read their role for workspace B. Compile
        the statement and assert both identifiers appear in the WHERE clause."""
        account_id = "11111111-1111-1111-1111-111111111111"
        tenant_id = "22222222-2222-2222-2222-222222222222"
        mock_session = MagicMock()
        mock_session.execute.return_value.scalar_one_or_none.return_value = TenantAccountRole.NORMAL

        TenantService.get_account_role_in_tenant(mock_session, account_id, tenant_id)

        stmt = mock_session.execute.call_args.args[0]
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert account_id in compiled
        assert tenant_id in compiled

    # ==================== Tenant Creation Tests ====================

    def test_create_owner_tenant_if_not_exist_new_user(
        self, mock_db_dependencies, mock_rsa_dependencies, mock_external_service_dependencies
    ):
        """Test creating owner tenant for new user without existing tenants."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Mock scalar to return None (no existing tenant joins)
        mock_db_dependencies["db"].session.scalar.return_value = None

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
                    TenantService.create_owner_tenant_if_not_exist(
                        mock_account, session=mock_db_dependencies["db"].session
                    )

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

        # Mock scalar to return None (no existing member)
        mock_db_dependencies["db"].session.scalar.return_value = None

        # Mock database operations
        mock_db_dependencies["db"].session.add = MagicMock()

        # Execute test
        result = TenantService.create_tenant_member(
            mock_tenant, mock_account, mock_db_dependencies["db"].session, "normal"
        )

        # Verify member was created with correct parameters
        assert result is not None
        mock_db_dependencies["db"].session.add.assert_called_once()

        # Verify the TenantAccountJoin object was added with correct parameters
        added_tenant_account_join = mock_db_dependencies["db"].session.add.call_args[0][0]
        assert added_tenant_account_join.tenant_id == "tenant-456"
        assert added_tenant_account_join.account_id == "user-123"
        assert added_tenant_account_join.role == "normal"

        self._assert_database_operations_called(mock_db_dependencies["db"])

    # ==================== Member Removal Tests ====================

    def test_remove_pending_member_deletes_orphaned_account(self):
        """Test that removing a pending member with no other workspaces deletes the account."""
        # Arrange
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123", role="owner")
        mock_pending_member = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="pending-user-789", email="pending@example.com", status=AccountStatus.PENDING
        )

        mock_ta = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="pending-user-789", role="normal"
        )

        with patch("services.account_service.db") as mock_db:
            mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
                tenant_id="tenant-456", account_id="operator-123", role="owner"
            )

            # scalar calls: permission check, ta lookup, owner_id lookup, remaining count
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_ta, "operator-123", 0]

            with patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync:
                mock_sync.return_value = True

                # Act
                TenantService.remove_member_from_tenant(
                    mock_tenant, mock_pending_member, mock_operator, session=mock_db.session
                )

                # Assert: enterprise sync still receives the correct member ID
                mock_sync.assert_called_once_with(
                    workspace_id="tenant-456",
                    member_id="pending-user-789",
                    source="workspace_member_removed",
                )

            # Assert: both join record and account should be deleted
            mock_db.session.delete.assert_any_call(mock_ta)
            mock_db.session.delete.assert_any_call(mock_pending_member)
            assert mock_db.session.delete.call_count == 2

    def test_remove_pending_member_keeps_account_with_other_workspaces(self):
        """Test that removing a pending member who belongs to other workspaces preserves the account."""
        # Arrange
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123", role="owner")
        mock_pending_member = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="pending-user-789", email="pending@example.com", status=AccountStatus.PENDING
        )

        mock_ta = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="pending-user-789", role="normal"
        )

        with patch("services.account_service.db") as mock_db:
            mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
                tenant_id="tenant-456", account_id="operator-123", role="owner"
            )

            # scalar calls: permission check, ta lookup, owner_id lookup, remaining count = 1
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_ta, "operator-123", 1]

            with patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync:
                mock_sync.return_value = True

                # Act
                TenantService.remove_member_from_tenant(
                    mock_tenant, mock_pending_member, mock_operator, session=mock_db.session
                )

            # Assert: only the join record should be deleted, not the account
            mock_db.session.delete.assert_called_once_with(mock_ta)

    def test_remove_active_member_preserves_account(self):
        """Test that removing an active member never deletes the account, even with no other workspaces."""
        # Arrange
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123", role="owner")
        mock_active_member = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="active-user-789", email="active@example.com", status=AccountStatus.ACTIVE
        )

        mock_ta = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="active-user-789", role="normal"
        )

        with patch("services.account_service.db") as mock_db:
            mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
                tenant_id="tenant-456", account_id="operator-123", role="owner"
            )

            # scalar calls: permission check, ta lookup, owner_id lookup (no count for active member)
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_ta, "operator-123"]

            with patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync:
                mock_sync.return_value = True

                # Act
                TenantService.remove_member_from_tenant(
                    mock_tenant, mock_active_member, mock_operator, session=mock_db.session
                )

            # Assert: only the join record should be deleted
            mock_db.session.delete.assert_called_once_with(mock_ta)

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
            # Mock scalar for the join query
            mock_db.session.scalar.return_value = mock_tenant_join

            with patch("services.account_service.naive_utc_now") as mock_naive_utc_now:
                mock_now = datetime(2026, 6, 5, 11, 0, 0)
                mock_naive_utc_now.return_value = mock_now

                # Execute test
                TenantService.switch_tenant(mock_account, "tenant-456", session=mock_db.session)

            # Verify tenant was switched
            assert mock_tenant_join.current is True
            assert mock_tenant_join.last_opened_at == mock_now
            self._assert_database_operations_called(mock_db)

    def test_switch_tenant_no_tenant_id(self):
        """Test tenant switching without providing tenant ID."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Execute test and verify exception
        self._assert_exception_raised(ValueError, TenantService.switch_tenant, mock_account, None, session=MagicMock())

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
            # scalar calls: permission check, target member lookup, operator role lookup
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_target_join, mock_operator_join]

            # Execute test
            TenantService.update_member_role(mock_tenant, mock_member, "admin", mock_operator, session=mock_db.session)

            # Verify role was updated
            assert mock_target_join.role == "admin"
            self._assert_database_operations_called(mock_db)

    def test_create_owner_tenant_if_not_exist_rbac_enabled_assigns_owner_role(
        self, mock_db_dependencies, mock_external_service_dependencies
    ):
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(account_id="user-rbac", name="RBAC User")
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True

        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-rbac"
        mock_tenant.name = "RBAC User's Workspace"

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.TenantService.create_tenant", return_value=mock_tenant),
            patch("services.account_service.TenantService.create_tenant_member"),
            patch(
                "services.account_service.AccountService._resolve_legacy_role_id",
                return_value="rbac-owner-id",
            ),
            patch("services.account_service.RBACService") as mock_rbac_service,
            patch("services.account_service.tenant_was_created.send"),
        ):
            mock_db_dependencies["db"].session.scalar.return_value = None

            TenantService.create_owner_tenant_if_not_exist(
                mock_account, is_setup=True, session=mock_db_dependencies["db"].session
            )

        mock_rbac_service.MemberRoles.replace.assert_called_once_with(
            tenant_id="tenant-rbac",
            account_id="user-rbac",
            member_account_id="user-rbac",
            role_ids=["rbac-owner-id"],
        )

    def test_admin_can_update_admin_member_role(self):
        """Test admin can update another non-owner member, including an admin."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_target_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="member-789", role="admin"
        )
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="admin"
        )

        with patch("services.account_service.db") as mock_db:
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_target_join, mock_operator_join]

            TenantService.update_member_role(mock_tenant, mock_member, "editor", mock_operator, session=mock_db.session)

            assert mock_target_join.role == "editor"
            self._assert_database_operations_called(mock_db)

    def test_admin_cannot_update_owner_member_role(self):
        """Test admin cannot update an owner member."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_target_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="member-789", role="owner"
        )
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="admin"
        )

        with patch("services.account_service.db") as mock_db:
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_target_join, mock_operator_join]

            with pytest.raises(NoPermissionError):
                TenantService.update_member_role(
                    mock_tenant, mock_member, "editor", mock_operator, session=mock_db.session
                )

    def test_admin_cannot_promote_member_to_owner(self):
        """Test admin cannot promote a non-owner member to owner."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_target_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="member-789", role="admin"
        )
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="admin"
        )

        with patch("services.account_service.db") as mock_db:
            mock_db.session.scalar.side_effect = [mock_operator_join, mock_target_join, mock_operator_join]

            with pytest.raises(NoPermissionError):
                TenantService.update_member_role(
                    mock_tenant, mock_member, "owner", mock_operator, session=mock_db.session
                )

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

        mock_db_dependencies["db"].session.scalar.return_value = mock_operator_join

        # Execute test - should not raise exception
        TenantService.check_member_permission(
            mock_tenant, mock_operator, mock_member, "add", session=mock_db_dependencies["db"].session
        )

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
            session=MagicMock(),
        )

    def test_admin_can_remove_non_owner_member(self, mock_db_dependencies):
        """Test admin can remove a non-owner member."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="admin"
        )
        mock_member_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="member-789", role="admin"
        )
        mock_db_dependencies["db"].session.scalar.side_effect = [mock_operator_join, mock_member_join]

        TenantService.check_member_permission(
            mock_tenant, mock_operator, mock_member, "remove", session=mock_db_dependencies["db"].session
        )

    def test_admin_cannot_remove_owner_member(self, mock_db_dependencies):
        """Test admin cannot remove an owner member."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="operator-123", role="admin"
        )
        mock_member_join = TestAccountAssociatedDataFactory.create_tenant_join_mock(
            tenant_id="tenant-456", account_id="member-789", role="owner"
        )
        mock_db_dependencies["db"].session.scalar.side_effect = [mock_operator_join, mock_member_join]

        with pytest.raises(NoPermissionError):
            TenantService.check_member_permission(
                mock_tenant, mock_operator, mock_member, "remove", session=MagicMock()
            )

    def test_rbac_member_can_remove_non_owner_member(self):
        """Test RBAC workspace.member.manage allows removing a non-owner member."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")

        mock_permissions = MagicMock()
        mock_permissions.workspace = MagicMock(permission_keys=["workspace.member.manage"])

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.RBACService.MyPermissions.get", return_value=mock_permissions),
            patch("services.account_service.AccountService.is_rbac_workspace_owner", return_value=False),
        ):
            TenantService.check_member_permission(
                mock_tenant, mock_operator, mock_member, "remove", session=MagicMock()
            )

    def test_rbac_member_cannot_remove_without_permission(self):
        """Test RBAC permission check rejects removal without workspace.member.manage."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")

        mock_permissions = MagicMock()
        mock_permissions.workspace = MagicMock(permission_keys=["workspace.role.manage"])

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.RBACService.MyPermissions.get", return_value=mock_permissions),
        ):
            with pytest.raises(NoPermissionError):
                TenantService.check_member_permission(
                    mock_tenant, mock_operator, mock_member, "remove", session=MagicMock()
                )

    def test_rbac_member_cannot_remove_owner_member(self):
        """Test RBAC permission check rejects removing an owner member."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")

        mock_permissions = MagicMock()
        mock_permissions.workspace = MagicMock(permission_keys=["workspace.member.manage"])

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.RBACService.MyPermissions.get", return_value=mock_permissions),
            patch("services.account_service.AccountService.is_rbac_workspace_owner", return_value=True),
        ):
            with pytest.raises(NoPermissionError):
                TenantService.check_member_permission(
                    mock_tenant, mock_operator, mock_member, "remove", session=MagicMock()
                )

    def test_get_rbac_workspace_owner_account_id(self):
        mock_roles = MagicMock()
        mock_roles.data = [SimpleNamespace(account_id="owner-account")]
        mock_rbac_roles = MagicMock()
        mock_rbac_roles.members.return_value = mock_roles

        with (
            patch(
                "services.account_service.AccountService._resolve_legacy_role_id",
                return_value="owner-role-id",
            ),
            patch("services.account_service.RBACService.Roles", mock_rbac_roles),
        ):
            owner_account_id = AccountService.get_rbac_workspace_owner_account_id("tenant-1", "acct-1")

        assert owner_account_id == "owner-account"
        call = mock_rbac_roles.members.call_args
        assert call.kwargs["tenant_id"] == "tenant-1"
        assert call.kwargs["account_id"] == "acct-1"
        assert call.kwargs["role_id"] == "owner-role-id"
        assert call.kwargs["options"].page_number == 1
        assert call.kwargs["options"].results_per_page == 1


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
                    RegisterService.setup(
                        "admin@example.com",
                        "Admin User",
                        "password123",
                        "192.168.1.1",
                        "en-US",
                        session=mock_db_dependencies["db"].session,
                    )

                    # Verify results
                    mock_create_account.assert_called_once_with(
                        email="admin@example.com",
                        name="Admin User",
                        interface_language="en-US",
                        password="password123",
                        is_setup=True,
                        session=mock_db_dependencies["db"].session,
                    )
                    mock_create_tenant.assert_called_once_with(
                        account=mock_account, is_setup=True, session=mock_db_dependencies["db"].session
                    )
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
                session=mock_db_dependencies["db"].session,
            )

            # Verify rollback operations were called
            mock_db_dependencies["db"].session.execute.assert_called()

    # ==================== Registration Tests ====================

    def test_create_account_and_tenant_calls_default_workspace_join_when_enterprise_enabled(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Enterprise-only side effect should be invoked when ENTERPRISE_ENABLED is True."""
        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", True, raising=False)

        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.TenantService.create_owner_tenant_if_not_exist") as mock_create_workspace,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account

            result = AccountService.create_account_and_tenant(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                password=None,
                session=mock_db_dependencies["db"].session,
            )

            assert result == mock_account
            mock_create_workspace.assert_called_once_with(
                account=mock_account, session=mock_db_dependencies["db"].session
            )
            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_create_account_and_tenant_does_not_call_default_workspace_join_when_enterprise_disabled(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Enterprise-only side effect should not be invoked when ENTERPRISE_ENABLED is False."""
        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", False, raising=False)

        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.TenantService.create_owner_tenant_if_not_exist") as mock_create_workspace,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account

            AccountService.create_account_and_tenant(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                password=None,
                session=mock_db_dependencies["db"].session,
            )

            mock_create_workspace.assert_called_once_with(
                account=mock_account, session=mock_db_dependencies["db"].session
            )
            mock_join_default_workspace.assert_not_called()

    def test_create_account_and_tenant_still_calls_default_workspace_join_when_workspace_creation_fails(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Default workspace join should still be attempted when personal workspace creation fails."""
        from services.errors.workspace import WorkSpaceNotAllowedCreateError

        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", True, raising=False)
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.TenantService.create_owner_tenant_if_not_exist") as mock_create_workspace,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account
            mock_create_workspace.side_effect = WorkSpaceNotAllowedCreateError()

            with pytest.raises(WorkSpaceNotAllowedCreateError):
                AccountService.create_account_and_tenant(
                    email="test@example.com",
                    name="Test User",
                    interface_language="en-US",
                    password=None,
                    session=mock_db_dependencies["db"].session,
                )

            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

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
                    session=mock_db_dependencies["db"].session,
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
                    timezone=None,
                    session=mock_db_dependencies["db"].session,
                )
                mock_create_tenant.assert_called_once_with(
                    "Test User's Workspace", session=mock_db_dependencies["db"].session
                )
                mock_create_member.assert_called_once_with(
                    mock_tenant, mock_account, mock_db_dependencies["db"].session, role="owner"
                )
                mock_event.send.assert_called_once_with(mock_tenant)
                self._assert_database_operations_called(mock_db_dependencies["db"])

    def test_register_calls_default_workspace_join_when_enterprise_enabled(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Enterprise-only side effect should be invoked after successful register commit."""
        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", True, raising=False)

        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account

            result = RegisterService.register(
                email="test@example.com",
                name="Test User",
                password="password123",
                language="en-US",
                create_workspace_required=False,
                session=mock_db_dependencies["db"].session,
            )

            assert result == mock_account
            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_register_does_not_call_default_workspace_join_when_enterprise_disabled(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Enterprise-only side effect should not be invoked when ENTERPRISE_ENABLED is False."""
        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", False, raising=False)

        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account

            RegisterService.register(
                email="test@example.com",
                name="Test User",
                password="password123",
                language="en-US",
                create_workspace_required=False,
                session=mock_db_dependencies["db"].session,
            )

            mock_join_default_workspace.assert_not_called()

    def test_register_still_calls_default_workspace_join_when_personal_workspace_creation_fails(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Default workspace join should run even when personal workspace creation raises."""
        from services.errors.workspace import WorkSpaceNotAllowedCreateError

        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", True, raising=False)
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.TenantService.create_tenant") as mock_create_tenant,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account
            mock_create_tenant.side_effect = WorkSpaceNotAllowedCreateError()

            with pytest.raises(AccountRegisterError, match="Workspace is not allowed to create."):
                RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                    session=mock_db_dependencies["db"].session,
                )

            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))
            mock_db_dependencies["db"].session.commit.assert_not_called()

    def test_register_still_calls_default_workspace_join_when_workspace_limit_exceeded(
        self, mock_db_dependencies, mock_external_service_dependencies, monkeypatch
    ):
        """Default workspace join should run before propagating workspace-limit registration failure."""
        from services.errors.workspace import WorkspacesLimitExceededError

        monkeypatch.setattr(dify_config, "ENTERPRISE_ENABLED", True, raising=False)
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        mock_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="11111111-1111-1111-1111-111111111111"
        )

        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.TenantService.create_tenant") as mock_create_tenant,
            patch("services.enterprise.enterprise_service.try_join_default_workspace") as mock_join_default_workspace,
        ):
            mock_create_account.return_value = mock_account
            mock_create_tenant.side_effect = WorkspacesLimitExceededError()

            with pytest.raises(AccountRegisterError, match="Registration failed:"):
                RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                    session=mock_db_dependencies["db"].session,
                )

            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))
            mock_db_dependencies["db"].session.commit.assert_not_called()

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
                    session=mock_db_dependencies["db"].session,
                )

                # Verify results
                assert result == mock_account
                mock_link_account.assert_called_once_with(
                    "google", "oauth123", mock_account, session=mock_db_dependencies["db"].session
                )
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
                    session=mock_db_dependencies["db"].session,
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
                    session=mock_db_dependencies["db"].session,
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
                session=mock_db_dependencies["db"].session,
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

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
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
                        session=mock_db_dependencies["db"].session,
                    )

                    # Verify results
                    assert result == "invite-token-123"
                    mock_register.assert_called_once_with(
                        email="newuser@example.com",
                        name="newuser",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                        session=mock_db_dependencies["db"].session,
                    )
                    mock_lookup.assert_called_once_with(mock_db_dependencies["db"].session, "newuser@example.com")

    def test_invite_new_member_normalizes_new_account_email(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """Ensure inviting with mixed-case email normalizes before registering."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mixed_email = "Invitee@Example.com"

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
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
                        session=mock_db_dependencies["db"].session,
                    )

                    mock_register.assert_called_once_with(
                        email="invitee@example.com",
                        name="invitee",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                        session=mock_db_dependencies["db"].session,
                    )
                    mock_lookup.assert_called_once_with(mock_db_dependencies["db"].session, mixed_email)
                    mock_check_permission.assert_called_once_with(
                        mock_tenant,
                        mock_inviter,
                        None,
                        "add",
                        session=mock_db_dependencies["db"].session,
                    )
                    mock_create_member.assert_called_once_with(
                        mock_tenant, mock_new_account, mock_db_dependencies["db"].session, "normal"
                    )
                    mock_switch_tenant.assert_called_once_with(
                        mock_new_account, mock_tenant.id, session=mock_db_dependencies["db"].session
                    )
                    mock_generate_token.assert_called_once_with(
                        mock_tenant, mock_new_account, "normal", requires_setup=True
                    )
                    mock_task_dependencies.delay.assert_called_once()

    def test_invite_new_member_existing_account(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """Test inviting a pending account that is not in the tenant yet."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test Workspace"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="pending"
        )

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = mock_existing_account

            # Mock scalar for TenantAccountJoin lookup - no existing member
            mock_db_dependencies["db"].session.scalar.return_value = None

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
                    session=mock_db_dependencies["db"].session,
                )

                # Verify results
                assert result == "invite-token-123"
                mock_create_member.assert_called_once_with(
                    mock_tenant, mock_existing_account, mock_db_dependencies["db"].session, "normal"
                )
                mock_generate_token.assert_called_once_with(
                    mock_tenant, mock_existing_account, "normal", requires_setup=True
                )
                mock_task_dependencies.delay.assert_called_once()
                mock_lookup.assert_called_once_with(mock_db_dependencies["db"].session, "existing@example.com")

    def test_invite_existing_active_account_requires_acceptance_before_joining(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """Existing active accounts outside the tenant receive an invite without immediate membership."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test Workspace"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="active"
        )

        with patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup:
            mock_lookup.return_value = mock_existing_account
            mock_db_dependencies["db"].session.scalar.return_value = None

            with (
                patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
            ):
                mock_generate_token.return_value = "invite-token-123"

                result = RegisterService.invite_new_member(
                    tenant=mock_tenant,
                    email="existing@example.com",
                    language="en-US",
                    role="admin",
                    inviter=mock_inviter,
                    session=mock_db_dependencies["db"].session,
                )

                assert result == "invite-token-123"
                mock_check_permission.assert_called_once_with(
                    mock_tenant,
                    mock_inviter,
                    mock_existing_account,
                    "add",
                    session=mock_db_dependencies["db"].session,
                )
                mock_create_member.assert_not_called()
                mock_generate_token.assert_called_once_with(
                    mock_tenant, mock_existing_account, "admin", requires_setup=False
                )
                mock_task_dependencies.delay.assert_called_once()

    def test_invite_new_member_already_in_tenant(self, mock_db_dependencies, mock_redis_dependencies):
        """Test inviting a member who is already in the tenant."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="active"
        )

        mock_db_dependencies[
            "db"
        ].session.scalar.return_value = TestAccountAssociatedDataFactory.create_tenant_join_mock()

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
                session=mock_db_dependencies["db"].session,
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
            session=MagicMock(),
        )

    # ==================== RBAC Member Invitation Tests ====================

    def test_invite_new_member_rbac_enabled_new_account(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """When RBAC is enabled, create the member join and replace RBAC member roles."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            patch("services.account_service.dify_config") as mock_config,
        ):
            mock_lookup.return_value = None
            mock_config.RBAC_ENABLED = True

            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="new-user-rbac", email="rbac@example.com", name="rbacuser", status="pending"
            )
            with (
                patch("services.account_service.RegisterService.register") as mock_register,
                patch("services.account_service.TenantService.check_member_permission"),
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.TenantService.switch_tenant"),
                patch("services.account_service.RegisterService.generate_invite_token", return_value="rbac-token"),
                patch("services.account_service.RBACService") as mock_rbac_service,
            ):
                mock_register.return_value = mock_new_account

                result = RegisterService.invite_new_member(
                    tenant=mock_tenant,
                    email="rbac@example.com",
                    language="en-US",
                    role="rbac-role-id-123",
                    inviter=mock_inviter,
                    session=mock_db_dependencies["db"].session,
                )

                assert result == "rbac-token"
                mock_create_member.assert_called_once_with(
                    mock_tenant, mock_new_account, mock_db_dependencies["db"].session, TenantAccountRole.NORMAL.value
                )
                mock_rbac_service.MemberRoles.replace.assert_called_once_with(
                    tenant_id=str(mock_tenant.id),
                    account_id=mock_inviter.id,
                    member_account_id=mock_new_account.id,
                    role_ids=["rbac-role-id-123"],
                )

    def test_invite_new_member_rbac_enabled_existing_account(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """When RBAC is enabled and account exists, create the member join and replace RBAC member roles."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status="pending"
        )

        mock_db_dependencies["db"].session.scalar.return_value = None

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            patch("services.account_service.dify_config") as mock_config,
        ):
            mock_lookup.return_value = mock_existing_account
            mock_config.RBAC_ENABLED = True

            with (
                patch("services.account_service.TenantService.check_member_permission"),
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.RegisterService.generate_invite_token", return_value="rbac-token"),
                patch("services.account_service.RBACService") as mock_rbac_service,
            ):
                result = RegisterService.invite_new_member(
                    tenant=mock_tenant,
                    email="existing-rbac@example.com",
                    language="en-US",
                    role="rbac-role-id-456",
                    inviter=mock_inviter,
                    session=mock_db_dependencies["db"].session,
                )

                assert result == "rbac-token"
                mock_create_member.assert_called_once_with(
                    mock_tenant,
                    mock_existing_account,
                    mock_db_dependencies["db"].session,
                    TenantAccountRole.NORMAL.value,
                )
                mock_rbac_service.MemberRoles.replace.assert_called_once_with(
                    tenant_id=str(mock_tenant.id),
                    account_id=mock_inviter.id,
                    member_account_id=mock_existing_account.id,
                    role_ids=["rbac-role-id-456"],
                )

    def test_invite_new_member_rbac_enabled_existing_active_account_adds_role_before_signin_response(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """Existing active accounts still need an RBAC membership before the API returns the signin URL."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status=AccountStatus.ACTIVE
        )

        mock_db_dependencies["db"].session.scalar.return_value = None

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            patch("services.account_service.dify_config") as mock_config,
        ):
            mock_lookup.return_value = mock_existing_account
            mock_config.RBAC_ENABLED = True

            with (
                patch("services.account_service.TenantService.check_member_permission"),
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.RBACService") as mock_rbac_service,
            ):
                with pytest.raises(AccountAlreadyInTenantError):
                    RegisterService.invite_new_member(
                        tenant=mock_tenant,
                        email="existing-rbac@example.com",
                        language="en-US",
                        role="rbac-role-id-456",
                        inviter=mock_inviter,
                        session=mock_db_dependencies["db"].session,
                    )

                mock_create_member.assert_called_once_with(
                    mock_tenant,
                    mock_existing_account,
                    mock_db_dependencies["db"].session,
                    TenantAccountRole.NORMAL.value,
                )
                mock_rbac_service.MemberRoles.replace.assert_called_once_with(
                    tenant_id=str(mock_tenant.id),
                    account_id=mock_inviter.id,
                    member_account_id=mock_existing_account.id,
                    role_ids=["rbac-role-id-456"],
                )
                mock_task_dependencies.delay.assert_not_called()

    def test_invite_new_member_rbac_disabled_uses_legacy_role(
        self, mock_db_dependencies, mock_redis_dependencies, mock_task_dependencies
    ):
        """When RBAC is disabled, create_tenant_member should be called and MemberRoles.replace should NOT."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-legacy"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-789", name="Inviter")

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            patch("services.account_service.dify_config") as mock_config,
        ):
            mock_lookup.return_value = None
            mock_config.RBAC_ENABLED = False

            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="legacy-user", email="legacy@example.com", name="legacyuser", status="pending"
            )
            with (
                patch("services.account_service.RegisterService.register") as mock_register,
                patch("services.account_service.TenantService.check_member_permission"),
                patch("services.account_service.TenantService.create_tenant_member") as mock_create_member,
                patch("services.account_service.TenantService.switch_tenant"),
                patch("services.account_service.RegisterService.generate_invite_token", return_value="legacy-token"),
                patch("services.account_service.RBACService") as mock_rbac_service,
            ):
                mock_register.return_value = mock_new_account

                result = RegisterService.invite_new_member(
                    tenant=mock_tenant,
                    email="legacy@example.com",
                    language="en-US",
                    role="editor",
                    inviter=mock_inviter,
                    session=mock_db_dependencies["db"].session,
                )

                assert result == "legacy-token"
                mock_create_member.assert_called_once_with(
                    mock_tenant, mock_new_account, mock_db_dependencies["db"].session, "editor"
                )
                mock_rbac_service.MemberRoles.replace.assert_not_called()

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
            result = RegisterService.generate_invite_token(mock_tenant, mock_account, "admin", requires_setup=True)

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
            assert stored_data["role"] == "admin"
            assert stored_data["requires_setup"] is True

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
        mock_tenant.status = TenantStatus.NORMAL
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

            # Mock scalar for tenant lookup, then account lookup.
            mock_db_dependencies["db"].session.scalar.side_effect = [mock_tenant, mock_account]

            # Execute test
            result = RegisterService.get_invitation_if_token_valid(
                "tenant-456", "test@example.com", "token-123", session=mock_db_dependencies["db"].session
            )

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
        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=MagicMock()
        )

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

        # Mock scalar for tenant lookup - not found
        mock_db_dependencies["db"].session.scalar.return_value = None

        # Execute test
        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=mock_db_dependencies["db"].session
        )

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_account_not_found(self, mock_db_dependencies, mock_redis_dependencies):
        """Test invitation validation when account is not found."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.status = TenantStatus.NORMAL

        # Mock Redis data
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        # Mock scalar for tenant lookup, then account lookup.
        mock_db_dependencies["db"].session.scalar.side_effect = [mock_tenant, None]

        # Execute test
        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=mock_db_dependencies["db"].session
        )

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_account_id_mismatch(self, mock_db_dependencies, mock_redis_dependencies):
        """Test invitation validation when account ID doesn't match."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_tenant.status = TenantStatus.NORMAL
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

        # Mock scalar for tenant lookup, then account lookup.
        mock_db_dependencies["db"].session.scalar.side_effect = [mock_tenant, mock_account]

        # Execute test
        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=mock_db_dependencies["db"].session
        )

        # Verify results
        assert result is None

    def test_get_invitation_with_case_fallback_returns_initial_match(self):
        """Fallback helper should return the initial invitation when present."""
        invitation = {"workspace_id": "tenant-456"}
        with patch(
            "services.account_service.RegisterService.get_invitation_if_token_valid", return_value=invitation
        ) as mock_get:
            result = RegisterService.get_invitation_with_case_fallback(
                "tenant-456", "User@Test.com", "token-123", session=MagicMock()
            )

        assert result == invitation
        mock_get.assert_called_once_with(
            "tenant-456", "User@Test.com", "token-123", session=mock_get.call_args.kwargs["session"]
        )

    def test_get_invitation_with_case_fallback_retries_with_lowercase(self):
        """Fallback helper should retry with lowercase email when needed."""
        invitation = {"workspace_id": "tenant-456"}
        with patch("services.account_service.RegisterService.get_invitation_if_token_valid") as mock_get:
            mock_get.side_effect = [None, invitation]
            result = RegisterService.get_invitation_with_case_fallback(
                "tenant-456", "User@Test.com", "token-123", session=MagicMock()
            )

        assert result == invitation
        assert mock_get.call_args_list == [
            (("tenant-456", "User@Test.com", "token-123"), {"session": mock_get.call_args_list[0].kwargs["session"]}),
            (("tenant-456", "user@test.com", "token-123"), {"session": mock_get.call_args_list[1].kwargs["session"]}),
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


class TestSessionInjectedGetters:
    """Coverage for the session-injected getters used by the openapi
    surface. These methods bypass the Flask-scoped ``db.session``
    proxy: callers (controllers) pass a session in. The tests simply
    verify the delegation contract — that the method routes the call
    through the *passed* session, not through ``db.session``.
    """

    def test_get_account_by_id_uses_passed_session_no_side_effects(self):
        """``get_account_by_id`` must be a plain delegation to
        ``session.get(Account, ...)`` — no banned-status raise, no
        commit (those are the side-effects of ``load_user`` we
        explicitly want to skip).
        """
        mock_session = MagicMock()
        sentinel_account = MagicMock(spec=Account)
        mock_session.get.return_value = sentinel_account

        result = AccountService.get_account_by_id(mock_session, "user-123")

        assert result is sentinel_account
        mock_session.get.assert_called_once_with(Account, "user-123")
        mock_session.commit.assert_not_called()

    def test_get_account_by_id_returns_none_for_unknown_account(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert AccountService.get_account_by_id(mock_session, "missing") is None

    def test_get_account_by_email_returns_scalar_or_none(self):
        """Plain getter — case-sensitive equality (callers needing the
        case-insensitive existence check use
        :meth:`has_active_account_with_email`).
        """
        mock_session = MagicMock()
        sentinel = MagicMock(spec=Account)
        mock_session.execute.return_value.scalar_one_or_none.return_value = sentinel

        assert AccountService.get_account_by_email(mock_session, "alice@example.com") is sentinel

        mock_session.execute.return_value.scalar_one_or_none.return_value = None
        assert AccountService.get_account_by_email(mock_session, "ghost@example.com") is None

    def test_account_belongs_to_tenant_short_circuits_on_falsy_account_id(self):
        """SSO bearers with no ``account_id`` (and any other falsy id)
        must collapse to ``False`` without a DB round-trip — that's the
        contract :class:`MembershipStrategy` relies on.
        """
        mock_session = MagicMock()

        assert TenantService.account_belongs_to_tenant(mock_session, None, "tenant-1") is False
        assert TenantService.account_belongs_to_tenant(mock_session, "", "tenant-1") is False
        mock_session.execute.assert_not_called()

    def test_account_belongs_to_tenant_true_when_join_row_exists(self):
        mock_session = MagicMock()
        mock_session.execute.return_value.scalar_one_or_none.return_value = "join-id"

        assert TenantService.account_belongs_to_tenant(mock_session, "user-1", "tenant-1") is True
        mock_session.execute.assert_called_once()

    def test_account_belongs_to_tenant_false_when_no_join(self):
        mock_session = MagicMock()
        mock_session.execute.return_value.scalar_one_or_none.return_value = None

        assert TenantService.account_belongs_to_tenant(mock_session, "user-1", "tenant-1") is False

    def test_get_account_memberships_returns_join_tenant_pairs(self):
        """Returns whatever ``session.query(...).join(...).filter(...).all()``
        produces — ordering unspecified, callers pick the default
        workspace from the join row.
        """
        mock_session = MagicMock()
        rows = [(MagicMock(), MagicMock()), (MagicMock(), MagicMock())]
        mock_session.query.return_value.join.return_value.filter.return_value.all.return_value = rows

        out = TenantService.get_account_memberships(mock_session, "user-123")

        assert out == rows
        # No fall-through to the global db.session proxy.
        assert mock_session.query.called

    def test_get_workspaces_for_account_uses_session_execute(self):
        """The list endpoint orders by ``Tenant.created_at``; the helper
        passes the ordered query through ``session.execute(...).all()``.
        """
        mock_session = MagicMock()
        rows = [(MagicMock(), MagicMock())]
        mock_session.execute.return_value.all.return_value = rows

        out = TenantService.get_workspaces_for_account(mock_session, "user-123")

        assert out == rows
        assert mock_session.execute.called

    def test_get_tenant_by_id_is_plain_session_get(self):
        """``get_tenant_by_id`` must NOT apply a status filter — the
        openapi auth pipeline needs to map ``status == ARCHIVE`` to a
        403, distinct from a 404 for "missing".
        """
        from models import Tenant

        mock_session = MagicMock()
        sentinel = MagicMock(spec=Tenant)
        mock_session.get.return_value = sentinel

        assert TenantService.get_tenant_by_id(mock_session, "tenant-1") is sentinel
        mock_session.get.assert_called_once_with(Tenant, "tenant-1")

    def test_get_tenant_by_id_returns_none_when_missing(self):
        mock_session = MagicMock()
        mock_session.get.return_value = None

        assert TenantService.get_tenant_by_id(mock_session, "missing") is None

    def test_get_tenants_by_ids_short_circuits_on_empty_input(self):
        """Empty id list must not emit ``WHERE id IN ()``."""
        mock_session = MagicMock()

        assert TenantService.get_tenants_by_ids(mock_session, []) == []
        mock_session.execute.assert_not_called()

    def test_get_tenants_by_ids_returns_scalars(self):
        mock_session = MagicMock()
        tenants = [MagicMock(), MagicMock()]
        mock_session.execute.return_value.scalars.return_value.all.return_value = tenants

        assert TenantService.get_tenants_by_ids(mock_session, ["t1", "t2"]) == tenants
        mock_session.execute.assert_called_once()

    def test_get_tenant_name_returns_scalar_or_none(self):
        """Single-column lookup: ``session.execute(...).scalar_one_or_none()``
        — used by openapi list endpoints to denormalise
        ``workspace_name`` onto each row.
        """
        mock_session = MagicMock()
        mock_session.execute.return_value.scalar_one_or_none.return_value = "Acme Inc."

        assert TenantService.get_tenant_name(mock_session, "tenant-1") == "Acme Inc."

        mock_session.execute.return_value.scalar_one_or_none.return_value = None
        assert TenantService.get_tenant_name(mock_session, "missing") is None

    def test_find_workspace_for_account_returns_first_row_or_none(self):
        """Per-id read returns ``session.execute(...).first()`` directly;
        callers map ``None`` → 404 to avoid leaking workspace IDs across
        tenants.
        """
        mock_session = MagicMock()
        sentinel_row = (MagicMock(), MagicMock())
        mock_session.execute.return_value.first.return_value = sentinel_row

        assert TenantService.find_workspace_for_account(mock_session, "user-123", "ws-1") is sentinel_row

        mock_session.execute.return_value.first.return_value = None
        assert TenantService.find_workspace_for_account(mock_session, "user-123", "ws-1") is None
