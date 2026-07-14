import json
from collections.abc import Iterator
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.orm import Session

from configs import dify_config
from models.account import (
    Account,
    AccountIntegrate,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantPluginAutoUpgradeStrategy,
    TenantStatus,
)
from models.dataset import Dataset
from models.model import App, DifySetup
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
    def sqlite_session(self, sqlite_engine) -> Iterator[Session]:
        """SQLite session with the account/workspace tables these service tests touch."""
        tables = [
            model.metadata.tables[model.__tablename__]
            for model in (
                Account,
                Tenant,
                TenantAccountJoin,
                TenantPluginAutoUpgradeStrategy,
            )
        ]
        Account.metadata.create_all(sqlite_engine, tables=tables)
        with Session(sqlite_engine, expire_on_commit=False) as session:
            yield session

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

    def _assert_exception_raised(self, exception_type, callable_func, *args, **kwargs):
        """Helper method to verify that specific exception is raised."""
        with pytest.raises(exception_type):
            callable_func(*args, **kwargs)

    # ==================== Authentication Tests ====================

    def test_authenticate_success(self, sqlite_session: Session, mock_password_dependencies):
        """Test successful authentication with correct email and password."""
        account = Account(
            name="Test User",
            email="test@example.com",
            password="hashed_password",
            password_salt="salt",
        )
        sqlite_session.add(account)
        sqlite_session.commit()

        mock_password_dependencies["compare_password"].return_value = True

        result = AccountService.authenticate("test@example.com", "password", session=sqlite_session)

        assert result is account

    def test_authenticate_account_not_found(self, sqlite_session: Session):
        """Test authentication when account does not exist."""
        self._assert_exception_raised(
            AccountPasswordError,
            AccountService.authenticate,
            "notfound@example.com",
            "password",
            session=sqlite_session,
        )

    def test_authenticate_account_banned(self, sqlite_session: Session):
        """Test authentication when account is banned."""
        account = Account(
            name="Banned User",
            email="banned@example.com",
            password="hashed_password",
            password_salt="salt",
            status=AccountStatus.BANNED,
        )
        sqlite_session.add(account)
        sqlite_session.commit()

        self._assert_exception_raised(
            AccountLoginError,
            AccountService.authenticate,
            "banned@example.com",
            "password",
            session=sqlite_session,
        )

    def test_authenticate_password_error(self, sqlite_session: Session, mock_password_dependencies):
        """Test authentication with wrong password."""
        account = Account(
            name="Test User",
            email="test@example.com",
            password="hashed_password",
            password_salt="salt",
        )
        sqlite_session.add(account)
        sqlite_session.commit()

        mock_password_dependencies["compare_password"].return_value = False

        self._assert_exception_raised(
            AccountPasswordError,
            AccountService.authenticate,
            "test@example.com",
            "wrongpassword",
            session=sqlite_session,
        )

    def test_authenticate_pending_account_activates(self, sqlite_session: Session, mock_password_dependencies):
        """Test authentication for a pending account, which should activate on login."""
        account = Account(
            name="Pending User",
            email="pending@example.com",
            password="hashed_password",
            password_salt="salt",
            status=AccountStatus.PENDING,
        )
        sqlite_session.add(account)
        sqlite_session.commit()

        mock_password_dependencies["compare_password"].return_value = True

        result = AccountService.authenticate("pending@example.com", "password", session=sqlite_session)

        assert result is account
        assert account.status == AccountStatus.ACTIVE
        assert account.initialized_at is not None

    # ==================== Account Creation Tests ====================

    def test_create_account_success(
        self, sqlite_session: Session, mock_password_dependencies, mock_external_service_dependencies
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
            session=sqlite_session,
        )

        # Verify results
        assert result.email == "test@example.com"
        assert result.name == "Test User"
        assert result.interface_language == "en-US"
        assert result.interface_theme == "light"
        assert result.password is not None
        assert result.password_salt is not None
        assert result.timezone == "America/New_York"

        persisted_account = sqlite_session.scalar(select(Account).where(Account.email == "test@example.com"))
        assert persisted_account is result

    def test_create_account_uses_explicit_timezone(
        self, sqlite_session: Session, mock_password_dependencies, mock_external_service_dependencies
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
            session=sqlite_session,
        )

        assert result.timezone == "Asia/Shanghai"
        persisted_account = sqlite_session.scalar(select(Account).where(Account.email == "test@example.com"))
        assert persisted_account is result
        assert persisted_account.timezone == "Asia/Shanghai"

    def test_create_account_registration_disabled(self, sqlite_session: Session, mock_external_service_dependencies):
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
            session=sqlite_session,
        )

    def test_create_account_email_frozen(self, sqlite_session: Session, mock_external_service_dependencies):
        """Test account creation with frozen email address."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True
        with patch("services.account_service.dify_config.BILLING_ENABLED", True):
            self._assert_exception_raised(
                AccountRegisterError,
                AccountService.create_account,
                email="frozen@example.com",
                name="Test User",
                interface_language="en-US",
                session=sqlite_session,
            )

    def test_create_account_without_password(self, sqlite_session: Session, mock_external_service_dependencies):
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
            session=sqlite_session,
        )

        # Verify results
        assert result.email == "test@example.com"
        assert result.name == "Test User"
        assert result.interface_language == "zh-CN"
        assert result.interface_theme == "dark"
        assert result.password is None
        assert result.password_salt is None
        assert result.timezone is not None

        persisted_account = sqlite_session.scalar(select(Account).where(Account.email == "test@example.com"))
        assert persisted_account is result

    # ==================== Password Management Tests ====================

    def test_update_account_password_success(self, sqlite_session: Session, mock_password_dependencies):
        """Test successful password update with correct current password and valid new password."""
        account = Account(
            name="Test User",
            email="test@example.com",
            password="hashed_password",
            password_salt="salt",
        )
        sqlite_session.add(account)
        sqlite_session.commit()
        mock_password_dependencies["compare_password"].return_value = True
        mock_password_dependencies["valid_password"].return_value = None
        mock_password_dependencies["hash_password"].return_value = b"new_hashed_password"

        result = AccountService.update_account_password(
            account, "old_password", "new_password123", session=sqlite_session
        )

        assert result is account
        assert account.password is not None
        assert account.password_salt is not None

        # Verify password validation was called
        mock_password_dependencies["compare_password"].assert_called_once_with(
            "old_password", "hashed_password", "salt"
        )
        mock_password_dependencies["valid_password"].assert_called_once_with("new_password123")

        # Verify database operations

    def test_update_account_password_current_password_incorrect(
        self, sqlite_session: Session, mock_password_dependencies
    ):
        """Test password update with incorrect current password."""
        # Setup test data
        mock_account = Account(
            name="Test User",
            email="test@example.com",
            password="hashed_password",
            password_salt="salt",
        )
        mock_password_dependencies["compare_password"].return_value = False

        # Execute test and verify exception
        self._assert_exception_raised(
            CurrentPasswordIncorrectError,
            AccountService.update_account_password,
            mock_account,
            "wrong_password",
            "new_password123",
            session=sqlite_session,
        )

        # Verify password comparison was called
        mock_password_dependencies["compare_password"].assert_called_once_with(
            "wrong_password", "hashed_password", "salt"
        )

    def test_update_account_password_invalid_new_password(self, sqlite_session: Session, mock_password_dependencies):
        """Test password update with invalid new password."""
        # Setup test data
        mock_account = Account(
            name="Test User",
            email="test@example.com",
            password="hashed_password",
            password_salt="salt",
        )
        mock_password_dependencies["compare_password"].return_value = True
        mock_password_dependencies["valid_password"].side_effect = ValueError("Password too short")

        # Execute test and verify exception
        self._assert_exception_raised(
            ValueError,
            AccountService.update_account_password,
            mock_account,
            "old_password",
            "short",
            session=sqlite_session,
        )

        # Verify password validation was called
        mock_password_dependencies["valid_password"].assert_called_once_with("short")

    # ==================== User Loading Tests ====================

    def test_load_user_success(self, sqlite_session: Session):
        """Test successful user loading with current tenant."""
        account = Account(name="Test User", email="test@example.com")
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add_all([account, tenant])
        sqlite_session.flush()
        tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=True,
        )
        sqlite_session.add(tenant_join)
        sqlite_session.commit()

        with (
            patch.object(Account, "set_tenant_id") as mock_set_tenant_id,
            patch.object(AccountService, "_refresh_account_last_active") as mock_refresh_last_active,
        ):
            result = AccountService.load_user(account.id, sqlite_session)

            assert result is account
            mock_set_tenant_id.assert_called_once_with(tenant.id)
            mock_refresh_last_active.assert_called_once_with(account, sqlite_session)

    def test_load_user_not_found(self, sqlite_session: Session):
        """Test user loading when user does not exist."""
        result = AccountService.load_user("non-existent-user", sqlite_session)

        assert result is None

    def test_load_user_banned(self, sqlite_session: Session):
        """Test user loading when user is banned."""
        account = Account(name="Banned User", email="banned@example.com", status=AccountStatus.BANNED)
        sqlite_session.add(account)
        sqlite_session.commit()

        self._assert_exception_raised(
            Exception,  # Unauthorized
            AccountService.load_user,
            account.id,
            sqlite_session,
        )

    def test_load_user_no_current_tenant(self, sqlite_session: Session):
        """Test user loading when user has no current tenant but has available tenants."""
        account = Account(name="Test User", email="test@example.com")
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add_all([account, tenant])
        sqlite_session.flush()
        available_tenant_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=False,
        )
        sqlite_session.add(available_tenant_join)
        sqlite_session.commit()

        with (
            patch.object(Account, "set_tenant_id") as mock_set_tenant_id,
            patch("services.account_service.naive_utc_now") as mock_naive_utc_now,
            patch.object(AccountService, "_refresh_account_last_active") as mock_refresh_last_active,
        ):
            mock_now = datetime.now()
            mock_naive_utc_now.return_value = mock_now

            result = AccountService.load_user(account.id, sqlite_session)

            assert result is account
            assert available_tenant_join.current is True
            assert available_tenant_join.last_opened_at == mock_now
            mock_set_tenant_id.assert_called_once_with(tenant.id)

            mock_refresh_last_active.assert_called_once_with(account, sqlite_session)

    def test_load_user_no_tenants(self, sqlite_session: Session):
        """Test user loading when user has no tenants at all."""
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()

        result = AccountService.load_user(account.id, sqlite_session)

        assert result is None

    def test_refresh_account_last_active_uses_redis_gate_and_conditional_update(self, sqlite_session: Session):
        """Test last-active refresh is gated in Redis and conditionally written to DB."""
        now = datetime(2026, 6, 2, 2, 45, 49)
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()
        account.last_active_at = now - timedelta(minutes=15)
        sqlite_session.commit()

        with (
            patch("services.account_service.naive_utc_now", return_value=now),
            patch("services.account_service.redis_client") as mock_redis_client,
        ):
            mock_redis_client.set.return_value = True

            AccountService._refresh_account_last_active(account, sqlite_session)

        mock_redis_client.set.assert_called_once_with(
            f"account_last_active_refresh:{account.id}",
            1,
            ex=600,
            nx=True,
        )
        sqlite_session.refresh(account)
        assert account.last_active_at == now

    def test_refresh_account_last_active_skips_db_when_redis_gate_exists(self, sqlite_session: Session):
        """Test concurrent refresh attempts do not enqueue duplicate DB updates."""
        now = datetime(2026, 6, 2, 2, 45, 49)
        original_last_active_at = now - timedelta(minutes=15)
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()
        account.last_active_at = original_last_active_at
        sqlite_session.commit()

        with (
            patch("services.account_service.naive_utc_now", return_value=now),
            patch("services.account_service.redis_client") as mock_redis_client,
        ):
            mock_redis_client.set.return_value = None

            AccountService._refresh_account_last_active(account, sqlite_session)

        mock_redis_client.set.assert_called_once_with(
            f"account_last_active_refresh:{account.id}",
            1,
            ex=600,
            nx=True,
        )
        sqlite_session.refresh(account)
        assert account.last_active_at == original_last_active_at

    def test_refresh_account_last_active_skips_recent_account(self, sqlite_session: Session):
        """Test recent activity does not touch Redis or DB."""
        now = datetime(2026, 6, 2, 2, 45, 49)
        original_last_active_at = now - timedelta(minutes=5)
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()
        account.last_active_at = original_last_active_at
        sqlite_session.commit()

        with (
            patch("services.account_service.naive_utc_now", return_value=now),
            patch("services.account_service.redis_client") as mock_redis_client,
        ):
            AccountService._refresh_account_last_active(account, sqlite_session)

        mock_redis_client.set.assert_not_called()
        sqlite_session.refresh(account)
        assert account.last_active_at == original_last_active_at


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

    def _assert_exception_raised(self, exception_type, callable_func, *args, **kwargs):
        """Helper method to verify that specific exception is raised."""
        with pytest.raises(exception_type):
            callable_func(*args, **kwargs)

    def _add_tenant_account_join(
        self,
        sqlite_session: Session,
        tenant: Tenant,
        account_id: str,
        role: TenantAccountRole,
        *,
        current: bool = False,
    ) -> TenantAccountJoin:
        """Create a real membership row for TenantService persistence tests."""
        tenant_account_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account_id,
            role=role,
            current=current,
        )
        sqlite_session.add(tenant_account_join)
        return tenant_account_join

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

    @pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
    def test_get_account_role_in_tenant_returns_role_for_member(self, sqlite_session: Session):
        """A row in TenantAccountJoin yields the caller's role."""
        sqlite_session.add(
            TenantAccountJoin(tenant_id="tenant-1", account_id="account-1", role=TenantAccountRole.ADMIN)
        )
        sqlite_session.commit()

        role = TenantService.get_account_role_in_tenant("account-1", "tenant-1", session=sqlite_session)

        assert role == TenantAccountRole.ADMIN

    @pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
    def test_get_account_role_in_tenant_returns_none_for_non_member(self, sqlite_session: Session):
        """No join row => None, so the gate cannot leak the workspace's existence."""
        role = TenantService.get_account_role_in_tenant("account-1", "tenant-1", session=sqlite_session)

        assert role is None

    @pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
    def test_get_account_role_in_tenant_short_circuits_empty_account_id(self, sqlite_session: Session):
        """None/empty account_id (SSO bearer, missing identity) returns None
        without ever touching the session."""
        statements: list[str] = []

        def record_sql(conn, cursor, statement, parameters, context, executemany):
            statements.append(statement)

        bind = sqlite_session.get_bind()
        event.listen(bind, "before_cursor_execute", record_sql)
        try:
            assert TenantService.get_account_role_in_tenant(None, "tenant-1", session=sqlite_session) is None
        finally:
            event.remove(bind, "before_cursor_execute", record_sql)

        assert statements == []

    @pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
    def test_get_account_role_in_tenant_query_is_scoped(self, sqlite_session: Session):
        """The lookup must filter on BOTH tenant_id and account_id."""
        account_id = "11111111-1111-1111-1111-111111111111"
        tenant_id = "22222222-2222-2222-2222-222222222222"
        sqlite_session.add_all(
            [
                TenantAccountJoin(tenant_id=tenant_id, account_id=account_id, role=TenantAccountRole.NORMAL),
                TenantAccountJoin(tenant_id="other-tenant", account_id=account_id, role=TenantAccountRole.ADMIN),
                TenantAccountJoin(tenant_id=tenant_id, account_id="other-account", role=TenantAccountRole.OWNER),
            ]
        )
        sqlite_session.commit()

        assert (
            TenantService.get_account_role_in_tenant(account_id, tenant_id, session=sqlite_session)
            == TenantAccountRole.NORMAL
        )
        assert TenantService.get_account_role_in_tenant(account_id, "missing-tenant", session=sqlite_session) is None
        assert TenantService.get_account_role_in_tenant("missing-account", tenant_id, session=sqlite_session) is None

    # ==================== Tenant Creation Tests ====================

    @pytest.mark.parametrize(
        "sqlite_session",
        [(Tenant, TenantAccountJoin, TenantPluginAutoUpgradeStrategy)],
        indirect=True,
    )
    def test_create_owner_tenant_if_not_exist_new_user(
        self, sqlite_session: Session, mock_rsa_dependencies, mock_external_service_dependencies
    ):
        """Creating an owner workspace persists both the tenant and owner membership."""
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.is_allow_create_workspace = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_system_features.return_value.license.workspaces.is_available.return_value = True
        mock_rsa_dependencies.return_value = "mock_public_key"

        with (
            patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
            patch("services.account_service.tenant_was_created.send") as mock_tenant_was_created,
        ):
            TenantService.create_owner_tenant_if_not_exist(mock_account, session=sqlite_session)

        tenant = sqlite_session.scalar(select(Tenant).where(Tenant.name == "Test User's Workspace"))
        assert tenant is not None
        assert tenant.encrypt_public_key == "mock_public_key"

        tenant_account_join = sqlite_session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == tenant.id,
                TenantAccountJoin.account_id == "user-123",
            )
        )
        assert tenant_account_join is not None
        assert tenant_account_join.role == TenantAccountRole.OWNER
        assert mock_account.current_tenant == tenant
        mock_tenant_was_created.assert_called_once_with(tenant)
        mock_rsa_dependencies.assert_called_once_with(tenant.id)

    # ==================== Member Management Tests ====================

    @pytest.mark.parametrize("sqlite_session", [(Account, Tenant, TenantAccountJoin)], indirect=True)
    def test_create_tenant_member_success(self, sqlite_session: Session):
        """Creating a member persists and returns the tenant/account join row."""
        tenant = Tenant(name="Test Workspace")
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add_all([tenant, account])
        sqlite_session.commit()

        result = TenantService.create_tenant_member(tenant, account, sqlite_session, "normal")

        assert result.tenant_id == tenant.id
        assert result.account_id == account.id
        assert result.role == TenantAccountRole.NORMAL

        persisted_tenant_account_join = sqlite_session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == tenant.id,
                TenantAccountJoin.account_id == account.id,
            )
        )
        assert persisted_tenant_account_join is result

    # ==================== Member Removal Tests ====================

    @pytest.mark.parametrize("sqlite_session", [(Account, Tenant, TenantAccountJoin, App, Dataset)], indirect=True)
    def test_remove_pending_member_deletes_orphaned_account(self, sqlite_session: Session):
        """Test that removing a pending member with no other workspaces deletes the account."""
        tenant = Tenant(name="Test Workspace")
        operator = Account(name="Operator", email="operator@example.com")
        pending_member = Account(name="Pending Member", email="pending@example.com", status=AccountStatus.PENDING)
        sqlite_session.add_all([tenant, operator, pending_member])
        sqlite_session.flush()
        self._add_tenant_account_join(sqlite_session, tenant, operator.id, TenantAccountRole.OWNER)
        member_join = self._add_tenant_account_join(sqlite_session, tenant, pending_member.id, TenantAccountRole.NORMAL)
        sqlite_session.commit()

        with (
            patch("services.account_service.dify_config.BILLING_ENABLED", False),
            patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
        ):
            mock_sync.return_value = True

            TenantService.remove_member_from_tenant(tenant, pending_member, operator, session=sqlite_session)

            mock_sync.assert_called_once_with(
                workspace_id=tenant.id,
                member_id=pending_member.id,
                source="workspace_member_removed",
            )

        assert sqlite_session.get(TenantAccountJoin, member_join.id) is None
        assert sqlite_session.get(Account, pending_member.id) is None

    @pytest.mark.parametrize("sqlite_session", [(Account, Tenant, TenantAccountJoin, App, Dataset)], indirect=True)
    def test_remove_pending_member_keeps_account_with_other_workspaces(self, sqlite_session: Session):
        """Test that removing a pending member who belongs to other workspaces preserves the account."""
        tenant = Tenant(name="Test Workspace")
        other_tenant = Tenant(name="Other Workspace")
        operator = Account(name="Operator", email="operator@example.com")
        pending_member = Account(name="Pending Member", email="pending@example.com", status=AccountStatus.PENDING)
        sqlite_session.add_all([tenant, other_tenant, operator, pending_member])
        sqlite_session.flush()
        self._add_tenant_account_join(sqlite_session, tenant, operator.id, TenantAccountRole.OWNER)
        member_join = self._add_tenant_account_join(sqlite_session, tenant, pending_member.id, TenantAccountRole.NORMAL)
        self._add_tenant_account_join(sqlite_session, other_tenant, pending_member.id, TenantAccountRole.NORMAL)
        sqlite_session.commit()

        with (
            patch("services.account_service.dify_config.BILLING_ENABLED", False),
            patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
        ):
            mock_sync.return_value = True

            TenantService.remove_member_from_tenant(tenant, pending_member, operator, session=sqlite_session)

            mock_sync.assert_called_once_with(
                workspace_id=tenant.id,
                member_id=pending_member.id,
                source="workspace_member_removed",
            )

        assert sqlite_session.get(TenantAccountJoin, member_join.id) is None
        assert sqlite_session.get(Account, pending_member.id) is pending_member

    @pytest.mark.parametrize("sqlite_session", [(Account, Tenant, TenantAccountJoin, App, Dataset)], indirect=True)
    def test_remove_active_member_preserves_account(self, sqlite_session: Session):
        """Test that removing an active member never deletes the account, even with no other workspaces."""
        tenant = Tenant(name="Test Workspace")
        operator = Account(name="Operator", email="operator@example.com")
        active_member = Account(name="Active Member", email="active@example.com", status=AccountStatus.ACTIVE)
        sqlite_session.add_all([tenant, operator, active_member])
        sqlite_session.flush()
        self._add_tenant_account_join(sqlite_session, tenant, operator.id, TenantAccountRole.OWNER)
        member_join = self._add_tenant_account_join(sqlite_session, tenant, active_member.id, TenantAccountRole.NORMAL)
        sqlite_session.commit()

        with (
            patch("services.account_service.dify_config.BILLING_ENABLED", False),
            patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
        ):
            mock_sync.return_value = True

            TenantService.remove_member_from_tenant(tenant, active_member, operator, session=sqlite_session)

            mock_sync.assert_called_once_with(
                workspace_id=tenant.id,
                member_id=active_member.id,
                source="workspace_member_removed",
            )

        assert sqlite_session.get(TenantAccountJoin, member_join.id) is None
        assert sqlite_session.get(Account, active_member.id) is active_member

    # ==================== Tenant Switching Tests ====================

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_switch_tenant_success(self, sqlite_session: Session):
        """Test successful tenant switching."""
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        tenant = Tenant(name="Target Workspace")
        other_tenant = Tenant(name="Other Workspace")
        sqlite_session.add_all([tenant, other_tenant])
        sqlite_session.flush()
        tenant_join = self._add_tenant_account_join(
            sqlite_session, tenant, mock_account.id, TenantAccountRole.NORMAL, current=False
        )
        other_tenant_join = self._add_tenant_account_join(
            sqlite_session, other_tenant, mock_account.id, TenantAccountRole.NORMAL, current=True
        )
        sqlite_session.commit()

        with patch("services.account_service.naive_utc_now") as mock_naive_utc_now:
            mock_now = datetime(2026, 6, 5, 11, 0, 0)
            mock_naive_utc_now.return_value = mock_now

            TenantService.switch_tenant(mock_account, tenant.id, session=sqlite_session)

        assert tenant_join.current is True
        assert tenant_join.last_opened_at == mock_now
        assert other_tenant_join.current is False
        mock_account.set_tenant_id.assert_called_once_with(tenant.id)

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_switch_tenant_no_tenant_id(self, sqlite_session: Session):
        """Test tenant switching without providing tenant ID."""
        # Setup test data
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        # Execute test and verify exception
        self._assert_exception_raised(
            ValueError, TenantService.switch_tenant, mock_account, None, session=sqlite_session
        )

    # ==================== Role Management Tests ====================

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_update_member_role_success(self, sqlite_session: Session):
        """Test successful member role update."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        target_join = self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.NORMAL)
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.OWNER)
        sqlite_session.commit()

        TenantService.update_member_role(tenant, mock_member, "admin", mock_operator, session=sqlite_session)

        assert target_join.role == TenantAccountRole.ADMIN

    @pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
    def test_create_owner_tenant_if_not_exist_rbac_enabled_assigns_owner_role(
        self, sqlite_session: Session, mock_external_service_dependencies
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
            TenantService.create_owner_tenant_if_not_exist(mock_account, is_setup=True, session=sqlite_session)

        mock_rbac_service.MemberRoles.replace.assert_called_once_with(
            tenant_id="tenant-rbac",
            account_id="user-rbac",
            member_account_id="user-rbac",
            role_ids=["rbac-owner-id"],
            session=sqlite_session,
        )

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_admin_can_update_admin_member_role(self, sqlite_session: Session):
        """Test admin can update another non-owner member, including an admin."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        target_join = self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.ADMIN)
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
        sqlite_session.commit()

        TenantService.update_member_role(tenant, mock_member, "editor", mock_operator, session=sqlite_session)

        assert target_join.role == TenantAccountRole.EDITOR

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_admin_cannot_update_owner_member_role(self, sqlite_session: Session):
        """Test admin cannot update an owner member."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.OWNER)
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
        sqlite_session.commit()

        with pytest.raises(NoPermissionError):
            TenantService.update_member_role(tenant, mock_member, "editor", mock_operator, session=sqlite_session)

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_admin_cannot_promote_member_to_owner(self, sqlite_session: Session):
        """Test admin cannot promote a non-owner member to owner."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.ADMIN)
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
        sqlite_session.commit()

        with pytest.raises(NoPermissionError):
            TenantService.update_member_role(tenant, mock_member, "owner", mock_operator, session=sqlite_session)

    # ==================== Permission Check Tests ====================

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_check_member_permission_success(self, sqlite_session: Session):
        """Test successful member permission check."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.OWNER)
        sqlite_session.commit()

        TenantService.check_member_permission(tenant, mock_operator, mock_member, "add", session=sqlite_session)

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_check_member_permission_operate_self(self, sqlite_session: Session):
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
            session=sqlite_session,
        )

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_admin_can_remove_non_owner_member(self, sqlite_session: Session):
        """Test admin can remove a non-owner member."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
        self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.ADMIN)
        sqlite_session.commit()

        TenantService.check_member_permission(tenant, mock_operator, mock_member, "remove", session=sqlite_session)

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_admin_cannot_remove_owner_member(self, sqlite_session: Session):
        """Test admin cannot remove an owner member."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
        self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.OWNER)
        sqlite_session.commit()

        with pytest.raises(NoPermissionError):
            TenantService.check_member_permission(tenant, mock_operator, mock_member, "remove", session=sqlite_session)

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_rbac_member_can_remove_non_owner_member(self, sqlite_session: Session):
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
                mock_tenant, mock_operator, mock_member, "remove", session=sqlite_session
            )

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_rbac_member_cannot_remove_without_permission(self, sqlite_session: Session):
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
                    mock_tenant, mock_operator, mock_member, "remove", session=sqlite_session
                )

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_rbac_member_cannot_remove_owner_member(self, sqlite_session: Session):
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
                    mock_tenant, mock_operator, mock_member, "remove", session=sqlite_session
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
            owner_account_id = AccountService.get_rbac_workspace_owner_account_id(
                "tenant-1", "acct-1", session=MagicMock()
            )

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
    def sqlite_session(self, sqlite_engine) -> Iterator[Session]:
        """SQLite session with the account/workspace tables registration flows touch."""
        tables = [
            model.metadata.tables[model.__tablename__]
            for model in (
                Account,
                AccountIntegrate,
                Tenant,
                TenantAccountJoin,
                TenantPluginAutoUpgradeStrategy,
                DifySetup,
            )
        ]
        Account.metadata.create_all(sqlite_engine, tables=tables)
        with Session(sqlite_engine, expire_on_commit=False) as session:
            yield session

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

    def _assert_exception_raised(self, exception_type, callable_func, *args, **kwargs):
        """Helper method to verify that specific exception is raised."""
        with pytest.raises(exception_type):
            callable_func(*args, **kwargs)

    # ==================== Setup Tests ====================

    def test_setup_success(self, sqlite_session: Session, mock_external_service_dependencies):
        """Test successful system setup."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            with patch("services.account_service.TenantService.create_owner_tenant_if_not_exist") as mock_create_tenant:
                RegisterService.setup(
                    "admin@example.com",
                    "Admin User",
                    "password123",
                    "192.168.1.1",
                    "en-US",
                    session=sqlite_session,
                )

                mock_create_account.assert_called_once_with(
                    email="admin@example.com",
                    name="Admin User",
                    interface_language="en-US",
                    password="password123",
                    is_setup=True,
                    session=sqlite_session,
                )
                mock_create_tenant.assert_called_once_with(account=mock_account, is_setup=True, session=sqlite_session)
                assert sqlite_session.scalar(select(DifySetup)) is not None

    def test_setup_failure_rollback(self, sqlite_session: Session, mock_external_service_dependencies):
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
                session=sqlite_session,
            )

            assert sqlite_session.scalar(select(DifySetup)) is None

    # ==================== Registration Tests ====================

    def test_create_account_and_tenant_calls_default_workspace_join_when_enterprise_enabled(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                session=sqlite_session,
            )

            assert result == mock_account
            mock_create_workspace.assert_called_once_with(account=mock_account, session=sqlite_session)
            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_create_account_and_tenant_does_not_call_default_workspace_join_when_enterprise_disabled(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                session=sqlite_session,
            )

            mock_create_workspace.assert_called_once_with(account=mock_account, session=sqlite_session)
            mock_join_default_workspace.assert_not_called()

    def test_create_account_and_tenant_still_calls_default_workspace_join_when_workspace_creation_fails(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                    session=sqlite_session,
                )

            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_register_success(self, sqlite_session: Session, mock_external_service_dependencies):
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
                    session=sqlite_session,
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
                    session=sqlite_session,
                )
                mock_create_tenant.assert_called_once_with("Test User's Workspace", session=sqlite_session)
                mock_create_member.assert_called_once_with(mock_tenant, mock_account, sqlite_session, role="owner")
                mock_event.send.assert_called_once_with(mock_tenant)

    def test_register_calls_default_workspace_join_when_enterprise_enabled(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                session=sqlite_session,
            )

            assert result == mock_account
            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_register_does_not_call_default_workspace_join_when_enterprise_disabled(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                session=sqlite_session,
            )

            mock_join_default_workspace.assert_not_called()

    def test_register_still_calls_default_workspace_join_when_personal_workspace_creation_fails(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                    session=sqlite_session,
                )

            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_register_still_calls_default_workspace_join_when_workspace_limit_exceeded(
        self, sqlite_session: Session, mock_external_service_dependencies, monkeypatch: pytest.MonkeyPatch
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
                    session=sqlite_session,
                )

            mock_join_default_workspace.assert_called_once_with(str(mock_account.id))

    def test_register_with_oauth(self, sqlite_session: Session, mock_external_service_dependencies):
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
                    session=sqlite_session,
                )

                # Verify results
                assert result == mock_account
                mock_link_account.assert_called_once_with("google", "oauth123", mock_account, session=sqlite_session)

    def test_register_with_pending_status(self, sqlite_session: Session, mock_external_service_dependencies):
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
                    session=sqlite_session,
                )

                # Verify results
                assert result == mock_account
                assert result.status == "pending"

    def test_register_workspace_not_allowed(self, sqlite_session: Session, mock_external_service_dependencies):
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
                    session=sqlite_session,
                )

                assert sqlite_session.scalar(select(Account).where(Account.email == "test@example.com")) is None

    def test_register_general_exception(self, sqlite_session: Session, mock_external_service_dependencies):
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
                session=sqlite_session,
            )

            assert sqlite_session.scalar(select(Account).where(Account.email == "test@example.com")) is None

    # ==================== Member Invitation Tests ====================

    def test_invite_new_member_new_account(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
    ):
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
                        session=sqlite_session,
                    )

                    # Verify results
                    assert result == "invite-token-123"
                    mock_register.assert_called_once_with(
                        email="newuser@example.com",
                        name="newuser",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                        session=sqlite_session,
                    )
                    mock_lookup.assert_called_once_with("newuser@example.com", session=sqlite_session)

    def test_invite_new_member_normalizes_new_account_email(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
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
                        session=sqlite_session,
                    )

                    mock_register.assert_called_once_with(
                        email="invitee@example.com",
                        name="invitee",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                        session=sqlite_session,
                    )
                    mock_lookup.assert_called_once_with(mixed_email, session=sqlite_session)
                    mock_check_permission.assert_called_once_with(
                        mock_tenant,
                        mock_inviter,
                        None,
                        "add",
                        session=sqlite_session,
                    )
                    mock_create_member.assert_called_once_with(mock_tenant, mock_new_account, sqlite_session, "normal")
                    mock_switch_tenant.assert_called_once_with(mock_new_account, mock_tenant.id, session=sqlite_session)
                    mock_generate_token.assert_called_once_with(
                        mock_tenant, mock_new_account, "normal", requires_setup=True
                    )
                    mock_task_dependencies.delay.assert_called_once()

    def test_invite_new_member_existing_account(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
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
                    session=sqlite_session,
                )

                # Verify results
                assert result == "invite-token-123"
                mock_create_member.assert_called_once_with(mock_tenant, mock_existing_account, sqlite_session, "normal")
                mock_generate_token.assert_called_once_with(
                    mock_tenant, mock_existing_account, "normal", requires_setup=True
                )
                mock_task_dependencies.delay.assert_called_once()
                mock_lookup.assert_called_once_with("existing@example.com", session=sqlite_session)

    def test_invite_existing_active_account_requires_acceptance_before_joining(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
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
                    session=sqlite_session,
                )

                assert result == "invite-token-123"
                mock_check_permission.assert_called_once_with(
                    mock_tenant,
                    mock_inviter,
                    mock_existing_account,
                    "add",
                    session=sqlite_session,
                )
                mock_create_member.assert_not_called()
                mock_generate_token.assert_called_once_with(
                    mock_tenant, mock_existing_account, "admin", requires_setup=False
                )
                mock_task_dependencies.delay.assert_called_once()

    def test_invite_new_member_already_in_tenant(self, sqlite_session: Session, mock_redis_dependencies):
        """Test inviting a member who is already in the tenant."""
        # Setup test data
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="active"
        )

        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=mock_tenant.id,
                account_id=mock_existing_account.id,
                role=TenantAccountRole.NORMAL,
            )
        )
        sqlite_session.commit()

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
                session=sqlite_session,
            )
            mock_lookup.assert_called_once()

    def test_invite_new_member_no_inviter(self, sqlite_session: Session):
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
            session=sqlite_session,
        )

    # ==================== RBAC Member Invitation Tests ====================

    def test_invite_new_member_rbac_enabled_new_account(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
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
                    session=sqlite_session,
                )

                assert result == "rbac-token"
                mock_create_member.assert_called_once_with(
                    mock_tenant, mock_new_account, sqlite_session, TenantAccountRole.NORMAL.value
                )
                mock_rbac_service.MemberRoles.replace.assert_called_once_with(
                    tenant_id=str(mock_tenant.id),
                    account_id=mock_inviter.id,
                    member_account_id=mock_new_account.id,
                    role_ids=["rbac-role-id-123"],
                    session=sqlite_session,
                )

    def test_invite_new_member_rbac_enabled_existing_account(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
    ):
        """When RBAC is enabled and account exists, create the member join and replace RBAC member roles."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status="pending"
        )

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
                    session=sqlite_session,
                )

                assert result == "rbac-token"
                mock_create_member.assert_called_once_with(
                    mock_tenant,
                    mock_existing_account,
                    sqlite_session,
                    TenantAccountRole.NORMAL.value,
                )
                mock_rbac_service.MemberRoles.replace.assert_called_once_with(
                    tenant_id=str(mock_tenant.id),
                    account_id=mock_inviter.id,
                    member_account_id=mock_existing_account.id,
                    role_ids=["rbac-role-id-456"],
                    session=sqlite_session,
                )

    def test_invite_new_member_rbac_enabled_existing_active_account_adds_role_before_signin_response(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
    ):
        """Existing active accounts still need an RBAC membership before the API returns the signin URL."""
        mock_tenant = MagicMock()
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status=AccountStatus.ACTIVE
        )

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
                        session=sqlite_session,
                    )

                mock_create_member.assert_called_once_with(
                    mock_tenant,
                    mock_existing_account,
                    sqlite_session,
                    TenantAccountRole.NORMAL.value,
                )
                mock_rbac_service.MemberRoles.replace.assert_called_once_with(
                    tenant_id=str(mock_tenant.id),
                    account_id=mock_inviter.id,
                    member_account_id=mock_existing_account.id,
                    role_ids=["rbac-role-id-456"],
                    session=sqlite_session,
                )
                mock_task_dependencies.delay.assert_not_called()

    def test_invite_new_member_rbac_disabled_uses_legacy_role(
        self, sqlite_session: Session, mock_redis_dependencies, mock_task_dependencies
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
                    session=sqlite_session,
                )

                assert result == "legacy-token"
                mock_create_member.assert_called_once_with(mock_tenant, mock_new_account, sqlite_session, "editor")
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

    def test_get_invitation_if_token_valid_success(self, sqlite_session: Session, mock_redis_dependencies):
        """Test successful invitation validation."""
        tenant = Tenant(name="Test Workspace")
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add_all([tenant, account])
        sqlite_session.commit()

        with patch("services.account_service.RegisterService.get_invitation_by_token") as mock_get_invitation_by_token:
            invitation_data = {
                "account_id": account.id,
                "email": "test@example.com",
                "workspace_id": tenant.id,
            }
            mock_get_invitation_by_token.return_value = invitation_data

            result = RegisterService.get_invitation_if_token_valid(
                tenant.id, "test@example.com", "token-123", session=sqlite_session
            )

            assert result is not None
            assert result["account"] is account
            assert result["tenant"] is tenant
            assert result["data"] == invitation_data

    def test_get_invitation_if_token_valid_no_token_data(self, sqlite_session: Session, mock_redis_dependencies):
        """Test invitation validation with no token data."""
        # Setup mock
        mock_redis_dependencies.get.return_value = None

        # Execute test
        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=sqlite_session
        )

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_tenant_not_found(self, sqlite_session: Session, mock_redis_dependencies):
        """Test invitation validation when tenant is not found."""
        # Setup mock Redis data
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=sqlite_session
        )

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_account_not_found(self, sqlite_session: Session, mock_redis_dependencies):
        """Test invitation validation when account is not found."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.commit()

        # Mock Redis data
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": tenant.id,
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        result = RegisterService.get_invitation_if_token_valid(
            tenant.id, "test@example.com", "token-123", session=sqlite_session
        )

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_account_id_mismatch(self, sqlite_session: Session, mock_redis_dependencies):
        """Test invitation validation when account ID doesn't match."""
        tenant = Tenant(name="Test Workspace")
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add_all([tenant, account])
        sqlite_session.commit()

        # Mock Redis data with different account ID
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": tenant.id,
        }
        mock_redis_dependencies.get.return_value = json.dumps(invitation_data).encode()

        result = RegisterService.get_invitation_if_token_valid(
            tenant.id, "test@example.com", "token-123", session=sqlite_session
        )

        # Verify results
        assert result is None

    def test_get_invitation_with_case_fallback_returns_initial_match(self, sqlite_session: Session):
        """Fallback helper should return the initial invitation when present."""
        invitation = {"workspace_id": "tenant-456"}
        with patch(
            "services.account_service.RegisterService.get_invitation_if_token_valid", return_value=invitation
        ) as mock_get:
            result = RegisterService.get_invitation_with_case_fallback(
                "tenant-456", "User@Test.com", "token-123", session=sqlite_session
            )

        assert result == invitation
        mock_get.assert_called_once_with(
            "tenant-456", "User@Test.com", "token-123", session=mock_get.call_args.kwargs["session"]
        )

    def test_get_invitation_with_case_fallback_retries_with_lowercase(self, sqlite_session: Session):
        """Fallback helper should retry with lowercase email when needed."""
        invitation = {"workspace_id": "tenant-456"}
        with patch("services.account_service.RegisterService.get_invitation_if_token_valid") as mock_get:
            mock_get.side_effect = [None, invitation]
            result = RegisterService.get_invitation_with_case_fallback(
                "tenant-456", "User@Test.com", "token-123", session=sqlite_session
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
    proxy: callers (controllers) pass a session in. The tests use
    SQLite-backed rows so query filters and short-circuit behaviour are
    exercised without mocking SQLAlchemy's session API.
    """

    def _add_tenant_account_join(
        self,
        sqlite_session: Session,
        tenant: Tenant,
        account_id: str,
        role: TenantAccountRole,
        *,
        current: bool = False,
    ) -> TenantAccountJoin:
        tenant_account_join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account_id,
            role=role,
            current=current,
        )
        sqlite_session.add(tenant_account_join)
        return tenant_account_join

    @pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
    def test_get_account_by_id_uses_passed_session_no_side_effects(self, sqlite_session: Session):
        """``get_account_by_id`` must be a plain delegation to
        ``session.get(Account, ...)`` — no banned-status raise, no
        commit (those are the side-effects of ``load_user`` we
        explicitly want to skip).
        """
        account = Account(name="Alice", email="alice@example.com", status=AccountStatus.BANNED)
        sqlite_session.add(account)
        sqlite_session.commit()

        result = AccountService.get_account_by_id(account.id, session=sqlite_session)

        assert result is account
        assert account.status == AccountStatus.BANNED

    @pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
    def test_get_account_by_id_returns_none_for_unknown_account(self, sqlite_session: Session):
        assert AccountService.get_account_by_id("missing", session=sqlite_session) is None

    @pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
    def test_get_account_by_email_returns_scalar_or_none(self, sqlite_session: Session):
        """Plain getter — case-sensitive equality (callers needing the
        case-insensitive existence check use
        :meth:`has_active_account_with_email`).
        """
        account = Account(name="Alice", email="alice@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()

        assert AccountService.get_account_by_email("alice@example.com", session=sqlite_session) == account
        assert AccountService.get_account_by_email("ALICE@example.com", session=sqlite_session) is None
        assert AccountService.get_account_by_email("ghost@example.com", session=sqlite_session) is None

    @pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
    def test_account_belongs_to_tenant_short_circuits_on_falsy_account_id(self, sqlite_session: Session):
        """SSO bearers with no ``account_id`` (and any other falsy id)
        must collapse to ``False`` before touching membership storage.
        """
        assert TenantService.account_belongs_to_tenant(None, "tenant-1", session=sqlite_session) is False
        assert TenantService.account_belongs_to_tenant("", "tenant-1", session=sqlite_session) is False

    @pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
    def test_account_belongs_to_tenant_true_when_join_row_exists(self, sqlite_session: Session):
        sqlite_session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="user-1", role=TenantAccountRole.NORMAL))
        sqlite_session.commit()

        assert TenantService.account_belongs_to_tenant("user-1", "tenant-1", session=sqlite_session) is True
        assert TenantService.account_belongs_to_tenant("user-1", "other-tenant", session=sqlite_session) is False

    @pytest.mark.parametrize("sqlite_session", [(TenantAccountJoin,)], indirect=True)
    def test_account_belongs_to_tenant_false_when_no_join(self, sqlite_session: Session):
        assert TenantService.account_belongs_to_tenant("user-1", "tenant-1", session=sqlite_session) is False

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_get_account_memberships_returns_join_tenant_pairs(self, sqlite_session: Session):
        """Returns every ``(TenantAccountJoin, Tenant)`` pair for an account."""
        tenant = Tenant(name="Joined Workspace")
        other_tenant = Tenant(name="Other Workspace")
        sqlite_session.add_all([tenant, other_tenant])
        sqlite_session.flush()
        join = self._add_tenant_account_join(sqlite_session, tenant, "user-123", TenantAccountRole.NORMAL, current=True)
        self._add_tenant_account_join(sqlite_session, other_tenant, "other-user", TenantAccountRole.NORMAL)
        sqlite_session.commit()

        out = TenantService.get_account_memberships("user-123", session=sqlite_session)

        assert len(out) == 1
        assert out[0][0] is join
        assert out[0][1] is tenant

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_get_workspaces_for_account_uses_session_execute(self, sqlite_session: Session):
        """The list endpoint orders by ``Tenant.created_at``; the helper
        returns ``(Tenant, TenantAccountJoin)`` rows in that order.
        """
        newer_tenant = Tenant(name="Newer Workspace")
        older_tenant = Tenant(name="Older Workspace")
        sqlite_session.add_all([newer_tenant, older_tenant])
        sqlite_session.flush()
        newer_tenant.created_at = datetime(2026, 1, 2, 0, 0, 0)
        older_tenant.created_at = datetime(2026, 1, 1, 0, 0, 0)
        newer_join = self._add_tenant_account_join(sqlite_session, newer_tenant, "user-123", TenantAccountRole.ADMIN)
        older_join = self._add_tenant_account_join(sqlite_session, older_tenant, "user-123", TenantAccountRole.NORMAL)
        sqlite_session.commit()

        out = TenantService.get_workspaces_for_account("user-123", session=sqlite_session)

        assert [(row[0], row[1]) for row in out] == [(older_tenant, older_join), (newer_tenant, newer_join)]

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_get_tenant_by_id_is_plain_session_get(self, sqlite_session: Session):
        """``get_tenant_by_id`` must NOT apply a status filter — the
        openapi auth pipeline needs to map ``status == ARCHIVE`` to a
        403, distinct from a 404 for "missing".
        """
        tenant = Tenant(name="Archived Workspace", status=TenantStatus.ARCHIVE)
        sqlite_session.add(tenant)
        sqlite_session.commit()

        assert TenantService.get_tenant_by_id(tenant.id, session=sqlite_session) is tenant

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_get_tenant_by_id_returns_none_when_missing(self, sqlite_session: Session):
        assert TenantService.get_tenant_by_id("missing", session=sqlite_session) is None

    @pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
    def test_get_tenants_by_ids_short_circuits_on_empty_input(self, sqlite_session: Session):
        """Empty id list must return before touching tenant storage."""
        assert TenantService.get_tenants_by_ids([], session=sqlite_session) == []

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_get_tenants_by_ids_returns_scalars(self, sqlite_session: Session):
        tenant_1 = Tenant(name="Workspace 1")
        tenant_2 = Tenant(name="Workspace 2")
        tenant_3 = Tenant(name="Workspace 3")
        sqlite_session.add_all([tenant_1, tenant_2, tenant_3])
        sqlite_session.commit()

        tenants = TenantService.get_tenants_by_ids([tenant_1.id, tenant_3.id], session=sqlite_session)

        assert {tenant.id for tenant in tenants} == {tenant_1.id, tenant_3.id}

    @pytest.mark.parametrize("sqlite_session", [(Tenant,)], indirect=True)
    def test_get_tenant_name_returns_scalar_or_none(self, sqlite_session: Session):
        """Single-column lookup: ``session.execute(...).scalar_one_or_none()``
        — used by openapi list endpoints to denormalise
        ``workspace_name`` onto each row.
        """
        tenant = Tenant(name="Acme Inc.")
        sqlite_session.add(tenant)
        sqlite_session.commit()

        assert TenantService.get_tenant_name(tenant.id, session=sqlite_session) == "Acme Inc."
        assert TenantService.get_tenant_name("missing", session=sqlite_session) is None

    @pytest.mark.parametrize("sqlite_session", [(Tenant, TenantAccountJoin)], indirect=True)
    def test_find_workspace_for_account_returns_first_row_or_none(self, sqlite_session: Session):
        """Per-id read returns ``session.execute(...).first()`` directly;
        callers map ``None`` → 404 to avoid leaking workspace IDs across
        tenants.
        """
        tenant = Tenant(name="Workspace")
        other_tenant = Tenant(name="Other Workspace")
        sqlite_session.add_all([tenant, other_tenant])
        sqlite_session.flush()
        join = self._add_tenant_account_join(sqlite_session, tenant, "user-123", TenantAccountRole.NORMAL)
        self._add_tenant_account_join(sqlite_session, other_tenant, "other-user", TenantAccountRole.NORMAL)
        sqlite_session.commit()

        row = TenantService.find_workspace_for_account("user-123", tenant.id, session=sqlite_session)

        assert row is not None
        assert row[0] is tenant
        assert row[1] is join
        assert TenantService.find_workspace_for_account("user-123", other_tenant.id, session=sqlite_session) is None


@pytest.mark.parametrize("sqlite_session", [(Account,)], indirect=True)
def test_get_account_by_email_with_case_fallback_uses_lowercase(sqlite_session: Session) -> None:
    account = Account(name="Case User", email="case@test.com")
    sqlite_session.add(account)
    sqlite_session.commit()

    result = AccountService.get_account_by_email_with_case_fallback("Case@Test.com", session=sqlite_session)

    assert result is account
