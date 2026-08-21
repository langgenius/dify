import json
from collections.abc import Callable, Iterator, Sequence
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import UUID

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Connection
from sqlalchemy.engine.interfaces import DBAPICursor, ExecutionContext
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from enums import DeploymentEdition
from models.account import (
    Account,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantStatus,
)
from models.model import DifySetup
from services.account_service import AccountService, RegisterService, TenantService
from services.enterprise.rbac_service import MembersInRole, Paginated
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountPasswordError,
    AccountRegisterError,
    EmailDomainSuspendedError,
    NoPermissionError,
)

type _MockDependencies = dict[str, MagicMock]


class TestAccountAssociatedDataFactory:
    """Factory class for creating test data and mock objects for account service tests."""

    @staticmethod
    def create_account_mock(
        account_id: str = "user-123",
        email: str = "test@example.com",
        name: str = "Test User",
        status: AccountStatus | str = AccountStatus.ACTIVE,
        password: str = "hashed_password",
        password_salt: str = "salt",
        interface_language: str = "en-US",
        interface_theme: str = "light",
        timezone: str = "UTC",
    ) -> Account:
        """Create an account with specified attributes."""
        account = Account(
            name=name,
            email=email,
            password=password,
            password_salt=password_salt,
            interface_language=interface_language,
            interface_theme=interface_theme,
            timezone=timezone,
            status=AccountStatus(status),
            initialized_at=None,
        )
        account.id = account_id
        # Set last_active_at to a datetime object that's older than 10 minutes
        account.last_active_at = datetime.now() - timedelta(minutes=15)
        return account


def _tenant(session: Session | None = None) -> Tenant:
    tenant = Tenant(name="Test Workspace")
    if session is not None:
        session.add(tenant)
    return tenant


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
    def mock_password_dependencies(self) -> Iterator[_MockDependencies]:
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
    def mock_external_service_dependencies(self) -> Iterator[_MockDependencies]:
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

    # ==================== Authentication Tests ====================

    def test_authenticate_success(self, sqlite_session: Session, mock_password_dependencies: _MockDependencies) -> None:
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

    def test_authenticate_account_not_found(self, sqlite_session: Session) -> None:
        """Test authentication when account does not exist."""
        with pytest.raises(AccountPasswordError):
            AccountService.authenticate("notfound@example.com", "password", session=sqlite_session)

    def test_authenticate_account_banned(self, sqlite_session: Session) -> None:
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

        with pytest.raises(AccountLoginError):
            AccountService.authenticate("banned@example.com", "password", session=sqlite_session)

    def test_authenticate_password_error(
        self, sqlite_session: Session, mock_password_dependencies: _MockDependencies
    ) -> None:
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

        with pytest.raises(AccountPasswordError):
            AccountService.authenticate("test@example.com", "wrongpassword", session=sqlite_session)

    def test_authenticate_pending_account_activates(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_password_dependencies: _MockDependencies,
    ) -> None:
        """Test authentication for a pending account, which should activate on login."""
        with sqlite_session_factory() as service_session:
            account = Account(
                name="Pending User",
                email="pending@example.com",
                password="hashed_password",
                password_salt="salt",
                status=AccountStatus.PENDING,
            )
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            mock_password_dependencies["compare_password"].return_value = True

            result = AccountService.authenticate("pending@example.com", "password", session=service_session)
            assert result.id == account_id

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.status == AccountStatus.ACTIVE
            assert persisted_account.initialized_at is not None

    # ==================== Account Creation Tests ====================

    def test_create_account_success(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_password_dependencies: _MockDependencies,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        """Test successful account creation with all required parameters."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_password_dependencies["hash_password"].return_value = b"hashed_password"

        # Execute test
        with sqlite_session_factory() as service_session:
            result = AccountService.create_account(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                password="password123",
                interface_theme="light",
                ip_address="203.0.113.10",
                session=service_session,
            )
            account_id = result.id

            assert result.email == "test@example.com"
            assert result.name == "Test User"
            assert result.interface_language == "en-US"
            assert result.interface_theme == "light"
            assert result.password is not None
            assert result.password_salt is not None
            assert result.timezone == "America/New_York"
            assert result.last_login_ip == "203.0.113.10"

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.email == "test@example.com"
            assert persisted_account.name == "Test User"
            assert persisted_account.interface_language == "en-US"
            assert persisted_account.interface_theme == "light"
            assert persisted_account.password is not None
            assert persisted_account.password_salt is not None
            assert persisted_account.timezone == "America/New_York"
            assert persisted_account.last_login_ip == "203.0.113.10"

    def test_create_account_uses_explicit_timezone(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_password_dependencies: _MockDependencies,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        """Test account creation prefers explicit browser timezone."""
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_password_dependencies["hash_password"].return_value = b"hashed_password"

        with sqlite_session_factory() as service_session:
            result = AccountService.create_account(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                password="password123",
                timezone="Asia/Shanghai",
                session=service_session,
            )
            account_id = result.id
            assert result.timezone == "Asia/Shanghai"

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.timezone == "Asia/Shanghai"

    def test_create_account_registration_disabled(
        self, unbound_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test account creation when registration is disabled."""
        from controllers.console.error import AccountNotFound

        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = False

        # Execute test and verify exception
        with pytest.raises(AccountNotFound):
            AccountService.create_account(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                session=unbound_session,
            )

    def test_create_account_email_frozen(
        self, unbound_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test account creation with frozen email address."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True
        with patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD):
            with pytest.raises(AccountRegisterError):
                AccountService.create_account(
                    email="frozen@example.com",
                    name="Test User",
                    interface_language="en-US",
                    session=unbound_session,
                )

    def test_create_account_suspended_email_domain(
        self, unbound_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True
        mock_external_service_dependencies[
            "billing_service"
        ].get_email_freeze_type.return_value = "email_domain_suspended"

        with patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD):
            with pytest.raises(EmailDomainSuspendedError):
                AccountService.create_account(
                    email="user@suspended.example",
                    name="Test User",
                    interface_language="en-US",
                    session=unbound_session,
                )

    def test_get_user_through_email_rejects_suspended_email_domain(
        self, unbound_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = True
        mock_external_service_dependencies[
            "billing_service"
        ].get_email_freeze_type.return_value = "email_domain_suspended"

        with patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD):
            with pytest.raises(EmailDomainSuspendedError):
                AccountService.get_user_through_email("user@suspended.example", session=unbound_session)

    def test_get_account_freeze_type_is_enabled_only_for_cloud(
        self, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        mock_external_service_dependencies["billing_service"].get_email_freeze_type.return_value = "freeze"

        with patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD):
            assert AccountService.get_account_freeze_type("frozen@example.com") == "freeze"
        with patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY):
            assert AccountService.get_account_freeze_type("frozen@example.com") is None

        mock_external_service_dependencies["billing_service"].get_email_freeze_type.assert_called_once_with(
            "frozen@example.com"
        )

    def test_create_account_without_password(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        """Test account creation without password (for invite-based registration)."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Execute test
        with sqlite_session_factory() as service_session:
            result = AccountService.create_account(
                email="test@example.com",
                name="Test User",
                interface_language="zh-CN",
                password=None,
                interface_theme="dark",
                session=service_session,
            )
            account_id = result.id

            assert result.email == "test@example.com"
            assert result.name == "Test User"
            assert result.interface_language == "zh-CN"
            assert result.interface_theme == "dark"
            assert result.password is None
            assert result.password_salt is None
            assert result.timezone is not None
            assert result.last_login_ip is None

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.email == "test@example.com"
            assert persisted_account.name == "Test User"
            assert persisted_account.interface_language == "zh-CN"
            assert persisted_account.interface_theme == "dark"
            assert persisted_account.password is None
            assert persisted_account.password_salt is None
            assert persisted_account.timezone is not None
            assert persisted_account.last_login_ip is None

    def test_update_login_info_overwrites_initial_registration_ip(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        with sqlite_session_factory() as service_session:
            account = AccountService.create_account(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                ip_address="203.0.113.10",
                session=service_session,
            )
            account_id = account.id

            AccountService.update_login_info(account, service_session, ip_address="203.0.113.11")

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.last_login_ip == "203.0.113.11"
            assert persisted_account.last_login_at is not None

    # ==================== User Loading Tests ====================

    def test_load_user_success(self, sqlite_session: Session) -> None:
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

        with patch.object(AccountService, "_refresh_account_last_active") as mock_refresh_last_active:
            result = AccountService.load_user(account.id, sqlite_session)

            assert result is account
            assert result.current_tenant_id == tenant.id
            mock_refresh_last_active.assert_called_once_with(account, sqlite_session)

    def test_load_user_not_found(self, sqlite_session: Session) -> None:
        """Test user loading when user does not exist."""
        result = AccountService.load_user("non-existent-user", sqlite_session)

        assert result is None

    def test_load_user_banned(self, sqlite_session: Session) -> None:
        """Test user loading when user is banned."""
        from werkzeug.exceptions import Unauthorized

        account = Account(name="Banned User", email="banned@example.com", status=AccountStatus.BANNED)
        sqlite_session.add(account)
        sqlite_session.commit()

        with pytest.raises(Unauthorized):
            AccountService.load_user(account.id, sqlite_session)

    def test_load_user_no_current_tenant(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Test user loading when user has no current tenant but has available tenants."""
        with sqlite_session_factory() as service_session:
            account = Account(name="Test User", email="test@example.com")
            tenant = Tenant(name="Test Workspace")
            service_session.add_all([account, tenant])
            service_session.flush()
            available_tenant_join = TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.NORMAL,
                current=False,
            )
            service_session.add(available_tenant_join)
            service_session.commit()
            account_id = account.id
            tenant_id = tenant.id
            tenant_join_id = available_tenant_join.id

            mock_now = datetime(2026, 6, 5, 11, 0, 0)
            with (
                patch.object(Account, "set_tenant_id_with_session") as mock_set_tenant_id,
                patch("services.account_service.naive_utc_now", return_value=mock_now),
                patch.object(AccountService, "_refresh_account_last_active") as mock_refresh_last_active,
            ):
                result = AccountService.load_user(account_id, service_session)
                assert result is not None
                mock_set_tenant_id.assert_called_once_with(tenant_id, session=service_session)
                mock_refresh_last_active.assert_called_once_with(result, service_session)

        with sqlite_session_factory() as assertion_session:
            persisted_tenant_join = assertion_session.get(TenantAccountJoin, tenant_join_id)
            assert persisted_tenant_join is not None
            assert persisted_tenant_join.current is True
            assert persisted_tenant_join.last_opened_at == mock_now

    def test_load_user_switches_from_archived_current_tenant(self, sqlite_session: Session) -> None:
        account = Account(name="Test User", email="test@example.com")
        archived_tenant = Tenant(name="Archived Workspace", status=TenantStatus.ARCHIVE)
        available_tenant = Tenant(name="Available Workspace")
        sqlite_session.add_all([account, archived_tenant, available_tenant])
        sqlite_session.flush()
        archived_join = TenantAccountJoin(
            tenant_id=archived_tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=True,
        )
        available_join = TenantAccountJoin(
            tenant_id=available_tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=False,
        )
        sqlite_session.add_all([archived_join, available_join])
        sqlite_session.commit()

        with patch.object(AccountService, "_refresh_account_last_active"):
            result = AccountService.load_user(account.id, sqlite_session)

        assert result is account
        assert result.current_tenant_id == available_tenant.id
        assert archived_join.current is False
        assert available_join.current is True

    def test_load_user_returns_none_without_normal_tenant(self, sqlite_session: Session) -> None:
        account = Account(name="Test User", email="test@example.com")
        archived_tenant = Tenant(name="Archived Workspace", status=TenantStatus.ARCHIVE)
        sqlite_session.add_all([account, archived_tenant])
        sqlite_session.flush()
        archived_join = TenantAccountJoin(
            tenant_id=archived_tenant.id,
            account_id=account.id,
            role=TenantAccountRole.NORMAL,
            current=True,
        )
        sqlite_session.add(archived_join)
        sqlite_session.commit()

        result = AccountService.load_user(account.id, sqlite_session)

        assert result is None
        assert archived_join.current is False

    def test_load_user_keeps_tenant_accessible_with_expiring_session(self, sqlite_session: Session) -> None:
        account = Account(name="Test User", email="test@example.com")
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add_all([account, tenant])
        sqlite_session.flush()
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.NORMAL,
                current=False,
            )
        )
        sqlite_session.commit()
        account_id = account.id
        tenant_id = tenant.id

        with Session(sqlite_session.get_bind()) as expiring_session:
            with patch.object(AccountService, "_refresh_account_last_active"):
                result = AccountService.load_user(account_id, expiring_session)

        assert result is not None
        assert result.current_tenant_id == tenant_id

    def test_load_user_no_tenants(self, sqlite_session: Session) -> None:
        """Test user loading when user has no tenants at all."""
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()

        result = AccountService.load_user(account.id, sqlite_session)

        assert result is None

    def test_refresh_account_last_active_uses_redis_gate_and_conditional_update(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """Test last-active refresh is gated in Redis and conditionally written to DB."""
        now = datetime(2026, 6, 2, 2, 45, 49)
        with sqlite_session_factory() as service_session:
            account = Account(name="Test User", email="test@example.com")
            account.last_active_at = now - timedelta(minutes=15)
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            with (
                patch("services.account_service.naive_utc_now", return_value=now),
                patch("services.account_service.redis_client") as mock_redis_client,
            ):
                mock_redis_client.set.return_value = True

                AccountService._refresh_account_last_active(account, service_session)

        mock_redis_client.set.assert_called_once_with(
            f"account_last_active_refresh:{account_id}",
            1,
            ex=600,
            nx=True,
        )
        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.last_active_at == now

    def test_refresh_account_last_active_skips_db_when_redis_gate_exists(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """Test concurrent refresh attempts do not enqueue duplicate DB updates."""
        now = datetime(2026, 6, 2, 2, 45, 49)
        original_last_active_at = now - timedelta(minutes=15)
        with sqlite_session_factory() as service_session:
            account = Account(name="Test User", email="test@example.com")
            account.last_active_at = original_last_active_at
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            with (
                patch("services.account_service.naive_utc_now", return_value=now),
                patch("services.account_service.redis_client") as mock_redis_client,
            ):
                mock_redis_client.set.return_value = None

                AccountService._refresh_account_last_active(account, service_session)

        mock_redis_client.set.assert_called_once_with(
            f"account_last_active_refresh:{account_id}",
            1,
            ex=600,
            nx=True,
        )
        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.last_active_at == original_last_active_at

    def test_refresh_account_last_active_skips_recent_account(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """Test recent activity does not touch Redis or DB."""
        now = datetime(2026, 6, 2, 2, 45, 49)
        original_last_active_at = now - timedelta(minutes=5)
        with sqlite_session_factory() as service_session:
            account = Account(name="Test User", email="test@example.com")
            account.last_active_at = original_last_active_at
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            with (
                patch("services.account_service.naive_utc_now", return_value=now),
                patch("services.account_service.redis_client") as mock_redis_client,
            ):
                AccountService._refresh_account_last_active(account, service_session)

        mock_redis_client.set.assert_not_called()
        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.last_active_at == original_last_active_at


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
    def mock_rsa_dependencies(self) -> Iterator[MagicMock]:
        """Mock setup for RSA-related functions."""
        with patch("services.account_service.generate_key_pair") as mock_generate_key_pair:
            yield mock_generate_key_pair

    @pytest.fixture
    def mock_external_service_dependencies(self) -> Iterator[_MockDependencies]:
        """Mock setup for external service dependencies."""
        with (
            patch("services.account_service.FeatureService") as mock_feature_service,
            patch("services.account_service.BillingService") as mock_billing_service,
        ):
            yield {
                "feature_service": mock_feature_service,
                "billing_service": mock_billing_service,
            }

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

    def test_iter_member_account_id_batches_uses_offset_limit(self, sqlite_session: Session) -> None:
        tenant_id = "00000000-0000-0000-0000-000000000001"
        account_ids = [
            "00000000-0000-0000-0000-000000000011",
            "00000000-0000-0000-0000-000000000012",
            "00000000-0000-0000-0000-000000000013",
        ]
        joins = [
            TenantAccountJoin(
                tenant_id=tenant_id,
                account_id=account_id,
                role=TenantAccountRole.NORMAL,
                current=False,
            )
            for account_id in account_ids
        ]
        for index, join in enumerate(joins, start=21):
            join.id = f"00000000-0000-0000-0000-{index:012d}"
        sqlite_session.add_all(joins)
        sqlite_session.commit()

        pagination_parameters: list[tuple[int, int]] = []

        def record_sql(
            _conn: Connection,
            _cursor: DBAPICursor,
            statement: str,
            parameters: Sequence[object],
            _context: ExecutionContext | None,
            _executemany: bool,
        ) -> None:
            if "FROM tenant_account_joins" in statement:
                limit, offset = parameters[-2:]
                assert isinstance(limit, int)
                assert isinstance(offset, int)
                pagination_parameters.append((limit, offset))

        bind = sqlite_session.get_bind()
        event.listen(bind, "before_cursor_execute", record_sql)
        try:
            batches = list(TenantService.iter_member_account_id_batches(tenant_id, 2, session=sqlite_session))
        finally:
            event.remove(bind, "before_cursor_execute", record_sql)

        assert batches == [account_ids[:2], account_ids[2:]]
        assert pagination_parameters == [(2, 0), (2, 2), (2, 4)]

    # ==================== get_account_role_in_tenant Tests ====================
    # Backs the auth pipeline's `load_workspace_role`: None => non-member
    # (pipeline maps to 404), otherwise the caller's role (out-of-set role => 403).

    def test_get_account_role_in_tenant_returns_role_for_member(self, sqlite_session: Session) -> None:
        """A row in TenantAccountJoin yields the caller's role."""
        sqlite_session.add(
            TenantAccountJoin(tenant_id="tenant-1", account_id="account-1", role=TenantAccountRole.ADMIN)
        )
        sqlite_session.commit()

        role = TenantService.get_account_role_in_tenant("account-1", "tenant-1", session=sqlite_session)

        assert role == TenantAccountRole.ADMIN

    def test_get_account_role_in_tenant_returns_none_for_non_member(self, sqlite_session: Session) -> None:
        """No join row => None, so the gate cannot leak the workspace's existence."""
        role = TenantService.get_account_role_in_tenant("account-1", "tenant-1", session=sqlite_session)

        assert role is None

    def test_get_account_role_in_tenant_short_circuits_empty_account_id(self, unbound_session: Session) -> None:
        """None/empty account_id (SSO bearer, missing identity) returns None
        without ever touching the session."""
        assert TenantService.get_account_role_in_tenant(None, "tenant-1", session=unbound_session) is None

    def test_get_account_role_in_tenant_query_is_scoped(self, sqlite_session: Session) -> None:
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

    def test_create_owner_tenant_if_not_exist_new_user(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_rsa_dependencies: MagicMock,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        """Creating an owner workspace persists both the tenant and owner membership."""
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
        mock_rsa_dependencies.return_value = "mock_public_key"

        with (
            patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
            patch("services.account_service.tenant_was_created.send") as mock_tenant_was_created,
        ):
            with sqlite_session_factory() as service_session:
                TenantService.create_owner_tenant_if_not_exist(mock_account, session=service_session)
                tenant = service_session.scalar(select(Tenant).where(Tenant.name == "Test User's Workspace"))
                assert tenant is not None
                tenant_id = tenant.id
                assert mock_account.current_tenant_id == tenant.id
                mock_tenant_was_created.assert_called_once_with(tenant)

        mock_rsa_dependencies.assert_called_once_with(tenant_id)

        with sqlite_session_factory() as assertion_session:
            tenant = assertion_session.get(Tenant, tenant_id)
            assert tenant is not None
            assert tenant.encrypt_public_key == "mock_public_key"

            tenant_account_join = assertion_session.scalar(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id == "user-123",
                )
            )
            assert tenant_account_join is not None
            assert tenant_account_join.role == TenantAccountRole.OWNER

    # ==================== Member Management Tests ====================

    def test_create_tenant_member_success(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Creating a member persists and returns the tenant/account join row."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            account = Account(name="Test User", email="test@example.com")
            service_session.add_all([tenant, account])
            service_session.flush()
            tenant_id = tenant.id
            account_id = account.id
            service_session.commit()

            result = TenantService.create_tenant_member(tenant, account, service_session, "normal")
            tenant_account_join_id = result.id

        with sqlite_session_factory() as assertion_session:
            persisted_tenant_account_join = assertion_session.get(
                TenantAccountJoin,
                tenant_account_join_id,
            )
            assert persisted_tenant_account_join is not None
            assert persisted_tenant_account_join.tenant_id == tenant_id
            assert persisted_tenant_account_join.account_id == account_id
            assert persisted_tenant_account_join.role == TenantAccountRole.NORMAL

    # ==================== Member Removal Tests ====================

    def test_remove_pending_member_deletes_orphaned_account(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """Test that removing a pending member with no other workspaces deletes the account."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            operator = Account(name="Operator", email="operator@example.com")
            pending_member = Account(name="Pending Member", email="pending@example.com", status=AccountStatus.PENDING)
            service_session.add_all([tenant, operator, pending_member])
            service_session.flush()
            self._add_tenant_account_join(service_session, tenant, operator.id, TenantAccountRole.OWNER)
            member_join = self._add_tenant_account_join(
                service_session,
                tenant,
                pending_member.id,
                TenantAccountRole.NORMAL,
            )
            service_session.flush()
            tenant_id = tenant.id
            member_id = pending_member.id
            member_join_id = member_join.id
            service_session.commit()

            with (
                patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
                patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
            ):
                mock_sync.return_value = True

                TenantService.remove_member_from_tenant(
                    tenant,
                    pending_member,
                    operator,
                    session=service_session,
                )

                mock_sync.assert_called_once_with(
                    workspace_id=tenant_id,
                    member_id=member_id,
                    source="workspace_member_removed",
                )

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.get(TenantAccountJoin, member_join_id) is None
            assert assertion_session.get(Account, member_id) is None

    def test_remove_pending_member_keeps_account_with_other_workspaces(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """Test that removing a pending member who belongs to other workspaces preserves the account."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            other_tenant = Tenant(name="Other Workspace")
            operator = Account(name="Operator", email="operator@example.com")
            pending_member = Account(name="Pending Member", email="pending@example.com", status=AccountStatus.PENDING)
            service_session.add_all([tenant, other_tenant, operator, pending_member])
            service_session.flush()
            self._add_tenant_account_join(service_session, tenant, operator.id, TenantAccountRole.OWNER)
            member_join = self._add_tenant_account_join(
                service_session,
                tenant,
                pending_member.id,
                TenantAccountRole.NORMAL,
            )
            other_member_join = self._add_tenant_account_join(
                service_session,
                other_tenant,
                pending_member.id,
                TenantAccountRole.NORMAL,
            )
            service_session.flush()
            tenant_id = tenant.id
            member_id = pending_member.id
            member_join_id = member_join.id
            other_member_join_id = other_member_join.id
            service_session.commit()

            with (
                patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
                patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
            ):
                mock_sync.return_value = True

                TenantService.remove_member_from_tenant(
                    tenant,
                    pending_member,
                    operator,
                    session=service_session,
                )

                mock_sync.assert_called_once_with(
                    workspace_id=tenant_id,
                    member_id=member_id,
                    source="workspace_member_removed",
                )

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.get(TenantAccountJoin, member_join_id) is None
            assert assertion_session.get(TenantAccountJoin, other_member_join_id) is not None
            assert assertion_session.get(Account, member_id) is not None

    def test_remove_active_member_preserves_account(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Test that removing an active member never deletes the account, even with no other workspaces."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            operator = Account(name="Operator", email="operator@example.com")
            active_member = Account(name="Active Member", email="active@example.com", status=AccountStatus.ACTIVE)
            service_session.add_all([tenant, operator, active_member])
            service_session.flush()
            self._add_tenant_account_join(service_session, tenant, operator.id, TenantAccountRole.OWNER)
            member_join = self._add_tenant_account_join(
                service_session,
                tenant,
                active_member.id,
                TenantAccountRole.NORMAL,
            )
            service_session.flush()
            tenant_id = tenant.id
            member_id = active_member.id
            member_join_id = member_join.id
            service_session.commit()

            with (
                patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
                patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
            ):
                mock_sync.return_value = True

                TenantService.remove_member_from_tenant(
                    tenant,
                    active_member,
                    operator,
                    session=service_session,
                )

                mock_sync.assert_called_once_with(
                    workspace_id=tenant_id,
                    member_id=member_id,
                    source="workspace_member_removed",
                )

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.get(TenantAccountJoin, member_join_id) is None
            assert assertion_session.get(Account, member_id) is not None

    # ==================== Tenant Switching Tests ====================

    def test_switch_tenant_success(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Test successful tenant switching."""
        with sqlite_session_factory() as service_session:
            account = Account(name="Test User", email="test@example.com")
            tenant = Tenant(name="Target Workspace")
            other_tenant = Tenant(name="Other Workspace")
            service_session.add_all([account, tenant, other_tenant])
            service_session.flush()
            tenant_join = self._add_tenant_account_join(
                service_session, tenant, account.id, TenantAccountRole.NORMAL, current=False
            )
            other_tenant_join = self._add_tenant_account_join(
                service_session, other_tenant, account.id, TenantAccountRole.NORMAL, current=True
            )
            tenant_id = tenant.id
            tenant_join_id = tenant_join.id
            other_tenant_join_id = other_tenant_join.id
            service_session.commit()

            mock_now = datetime(2026, 6, 5, 11, 0, 0)
            with patch("services.account_service.naive_utc_now", return_value=mock_now):
                TenantService.switch_tenant(account, tenant_id, session=service_session)

            assert account.current_tenant_id == tenant_id

        with sqlite_session_factory() as assertion_session:
            tenant_join = assertion_session.get(TenantAccountJoin, tenant_join_id)
            other_tenant_join = assertion_session.get(TenantAccountJoin, other_tenant_join_id)
            assert tenant_join is not None
            assert tenant_join.current is True
            assert tenant_join.last_opened_at == mock_now
            assert other_tenant_join is not None
            assert other_tenant_join.current is False

    def test_switch_tenant_no_tenant_id(self, unbound_session: Session) -> None:
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        with pytest.raises(ValueError):
            TenantService.switch_tenant(mock_account, None, session=unbound_session)

    # ==================== Role Management Tests ====================

    def test_update_member_role_success(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Test successful member role update."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            service_session.add(tenant)
            service_session.flush()
            target_join = self._add_tenant_account_join(
                service_session,
                tenant,
                "member-789",
                TenantAccountRole.NORMAL,
            )
            self._add_tenant_account_join(
                service_session,
                tenant,
                "operator-123",
                TenantAccountRole.OWNER,
            )
            service_session.flush()
            target_join_id = target_join.id
            service_session.commit()

            mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
            mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")

            TenantService.update_member_role(
                tenant,
                mock_member,
                "admin",
                mock_operator,
                session=service_session,
            )

        with sqlite_session_factory() as assertion_session:
            persisted_target_join = assertion_session.get(TenantAccountJoin, target_join_id)
            assert persisted_target_join is not None
            assert persisted_target_join.role == TenantAccountRole.ADMIN

    def test_create_owner_tenant_rbac_enabled_assigns_owner_role(
        self, sqlite_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        mock_account = TestAccountAssociatedDataFactory.create_account_mock(account_id="user-rbac", name="RBAC User")
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True

        mock_tenant = Tenant(name="RBAC User's Workspace")
        mock_tenant.id = "tenant-rbac"
        sqlite_session.add(mock_tenant)
        sqlite_session.flush()

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.TenantService.create_tenant", return_value=mock_tenant),
            patch(
                "services.account_service.AccountService._resolve_legacy_role_id",
                return_value="rbac-owner-id",
            ),
            patch("services.account_service.RBACService") as mock_rbac_service,
            patch("services.account_service.tenant_was_created.send"),
        ):
            TenantService.create_owner_tenant(mock_account, is_setup=True, session=sqlite_session)

        mock_rbac_service.MemberRoles.replace.assert_called_once_with(
            tenant_id="tenant-rbac",
            account_id="user-rbac",
            member_account_id="user-rbac",
            role_ids=["rbac-owner-id"],
            session=sqlite_session,
        )

    def test_admin_can_update_admin_member_role(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Test admin can update another non-owner member, including an admin."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            service_session.add(tenant)
            service_session.flush()
            mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
            mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
            target_join = self._add_tenant_account_join(
                service_session, tenant, mock_member.id, TenantAccountRole.ADMIN
            )
            self._add_tenant_account_join(service_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
            service_session.flush()
            target_join_id = target_join.id
            service_session.commit()

            TenantService.update_member_role(
                tenant,
                mock_member,
                "editor",
                mock_operator,
                session=service_session,
            )

        with sqlite_session_factory() as assertion_session:
            persisted_target_join = assertion_session.get(TenantAccountJoin, target_join_id)
            assert persisted_target_join is not None
            assert persisted_target_join.role == TenantAccountRole.EDITOR

    def test_admin_cannot_update_owner_member_role(self, sqlite_session: Session) -> None:
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

    def test_admin_cannot_promote_member_to_owner(self, sqlite_session: Session) -> None:
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

    def test_check_member_permission_success(self, sqlite_session: Session) -> None:
        """Test successful member permission check."""
        tenant = Tenant(name="Test Workspace")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.OWNER)
        sqlite_session.commit()

        TenantService.check_member_permission(tenant, mock_operator, mock_member, "add", session=sqlite_session)

    def test_check_member_permission_operate_self(self, unbound_session: Session) -> None:
        """Test member permission check when operator tries to operate self."""
        # Setup test data
        mock_tenant = _tenant()
        mock_tenant.id = "tenant-456"
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")

        # Execute test and verify exception
        from services.errors.account import CannotOperateSelfError

        with pytest.raises(CannotOperateSelfError):
            TenantService.check_member_permission(
                mock_tenant,
                mock_operator,
                mock_operator,  # Same as operator
                "add",
                session=unbound_session,
            )

    def test_admin_can_remove_non_owner_member(self, sqlite_session: Session) -> None:
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

    def test_admin_cannot_remove_owner_member(self, sqlite_session: Session) -> None:
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

    def test_rbac_member_can_remove_non_owner_member(self, sqlite_session: Session) -> None:
        """Test RBAC workspace.member.manage allows removing a non-owner member."""
        mock_tenant = _tenant(sqlite_session)
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

    def test_rbac_member_cannot_remove_without_permission(self, sqlite_session: Session) -> None:
        """Test RBAC permission check rejects removal without workspace.member.manage."""
        mock_tenant = _tenant(sqlite_session)
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

    def test_rbac_member_cannot_remove_owner_member(self, sqlite_session: Session) -> None:
        """Test RBAC permission check rejects removing an owner member."""
        mock_tenant = _tenant(sqlite_session)
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

    def test_get_rbac_workspace_owner_account_id(self, sqlite_session: Session) -> None:
        mock_roles = Paginated[MembersInRole](data=[MembersInRole(account_id="owner-account")])
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
                "tenant-1", "acct-1", session=sqlite_session
            )

        assert owner_account_id == "owner-account"
        assert not sqlite_session.in_transaction()
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
    def mock_redis_dependencies(self) -> Iterator[MagicMock]:
        """Mock setup for Redis-related functions."""
        with patch("services.account_service.redis_client") as mock_redis:
            yield mock_redis

    @pytest.fixture
    def mock_external_service_dependencies(self) -> Iterator[_MockDependencies]:
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
    def mock_task_dependencies(self) -> Iterator[MagicMock]:
        """Mock setup for task dependencies."""
        with patch("services.account_service.send_invite_member_mail_task") as mock_send_mail:
            yield mock_send_mail

    # ==================== Setup Tests ====================

    def test_setup_success(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        """Test successful system setup."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            with (
                patch("services.account_service.TenantService.create_owner_tenant_if_not_exist") as mock_create_tenant,
                patch("services.account_service.CommunityTelemetryService.report_install") as mock_report_install,
            ):
                with sqlite_session_factory() as service_session:
                    RegisterService.setup(
                        "admin@example.com",
                        "Admin User",
                        "password123",
                        "192.168.1.1",
                        "en-US",
                        session=service_session,
                    )

                    mock_create_account.assert_called_once_with(
                        email="admin@example.com",
                        name="Admin User",
                        interface_language="en-US",
                        password="password123",
                        is_setup=True,
                        ip_address="192.168.1.1",
                        session=service_session,
                    )
                    mock_create_tenant.assert_called_once_with(
                        account=mock_account,
                        is_setup=True,
                        session=service_session,
                    )
                    mock_report_install.assert_called_once_with(session=service_session)

        with sqlite_session_factory() as assertion_session:
            dify_setup = assertion_session.scalar(select(DifySetup))
            assert dify_setup is not None
            assert dify_setup.instance_id is not None
            assert str(UUID(dify_setup.instance_id)) == dify_setup.instance_id
            assert dify_setup.install_reported_at is None
            assert dify_setup.last_heartbeat_at is None

    def test_setup_succeeds_when_telemetry_install_report_fails(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()

        with (
            patch("services.account_service.AccountService.create_account", return_value=mock_account),
            patch("services.account_service.TenantService.create_owner_tenant_if_not_exist"),
            patch(
                "services.account_service.CommunityTelemetryService.report_install",
                side_effect=RuntimeError("telemetry unavailable"),
            ),
        ):
            with sqlite_session_factory() as service_session:
                RegisterService.setup(
                    "admin@example.com",
                    "Admin User",
                    "password123",
                    "192.168.1.1",
                    "en-US",
                    session=service_session,
                )

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.scalar(select(DifySetup)) is not None

    def test_setup_failure_cleans_partially_persisted_account(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.seats.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        with patch(
            "services.account_service.TenantService.create_owner_tenant_if_not_exist",
            side_effect=RuntimeError("tenant creation failed"),
        ):
            with sqlite_session_factory() as service_session:
                with pytest.raises(ValueError, match="Setup failed: tenant creation failed"):
                    RegisterService.setup(
                        "admin@example.com",
                        "Admin User",
                        "password123",
                        "192.168.1.1",
                        "en-US",
                        session=service_session,
                    )

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.scalar(select(Account).where(Account.email == "admin@example.com")) is None
            assert assertion_session.scalar(select(DifySetup)) is None

    # ==================== Registration Tests ====================

    def test_create_account_and_tenant_calls_default_workspace_join_for_enterprise_edition(
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Enterprise-only side effect should be invoked for the ENTERPRISE edition."""
        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE, raising=False)

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
                ip_address="203.0.113.10",
                session=sqlite_session,
            )

            assert result == mock_account
            mock_create_account.assert_called_once_with(
                email="test@example.com",
                name="Test User",
                interface_language="en-US",
                password=None,
                timezone=None,
                ip_address="203.0.113.10",
                session=sqlite_session,
            )
            mock_create_workspace.assert_called_once_with(account=mock_account, session=sqlite_session)
            mock_join_default_workspace.assert_called_once_with(mock_account.id)

    def test_create_account_and_tenant_skips_default_workspace_join_for_community_edition(
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Enterprise-only side effect should not be invoked for the COMMUNITY edition."""
        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY, raising=False)

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
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Default workspace join should still be attempted when personal workspace creation fails."""
        from services.errors.workspace import WorkSpaceNotAllowedCreateError

        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE, raising=False)
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

            mock_join_default_workspace.assert_called_once_with(mock_account.id)

    def test_register_success(
        self, sqlite_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test successful account registration."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            with (
                patch("services.account_service.TenantService.create_owner_tenant") as mock_create_owner_tenant,
            ):
                # Execute test
                result = RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                    ip_address="203.0.113.10",
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
                    ip_address="203.0.113.10",
                    session=sqlite_session,
                )
                mock_create_owner_tenant.assert_called_once_with(mock_account, session=sqlite_session)

    def test_register_calls_default_workspace_join_for_enterprise_edition(
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Enterprise-only side effect should be invoked after successful register commit."""
        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE, raising=False)

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
            mock_join_default_workspace.assert_called_once_with(mock_account.id)

    def test_register_skips_default_workspace_join_for_community_edition(
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Enterprise-only side effect should not be invoked for the COMMUNITY edition."""
        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY, raising=False)

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
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Default workspace join should run even when personal workspace creation raises."""
        from services.errors.workspace import WorkSpaceNotAllowedCreateError

        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE, raising=False)
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
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

            mock_join_default_workspace.assert_called_once_with(mock_account.id)

    def test_register_still_calls_default_workspace_join_when_workspace_limit_exceeded(
        self,
        sqlite_session: Session,
        mock_external_service_dependencies: _MockDependencies,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """Default workspace join should run before propagating workspace-limit registration failure."""
        from services.errors.workspace import WorkspacesLimitExceededError

        monkeypatch.setattr(dify_config, "DEPLOYMENT_EDITION", DeploymentEdition.ENTERPRISE, raising=False)
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
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

            mock_join_default_workspace.assert_called_once_with(mock_account.id)

    def test_register_with_oauth(
        self, sqlite_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test account registration with OAuth integration."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
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
                mock_tenant = Tenant(name="Test User's Workspace")
                sqlite_session.add(mock_tenant)
                sqlite_session.flush()
                mock_create_tenant.return_value = mock_tenant
                mock_create_member.side_effect = lambda tenant, account, session, role: session.add(
                    TenantAccountJoin(
                        tenant_id=tenant.id,
                        account_id=account.id,
                        role=TenantAccountRole(role),
                    )
                )

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

    def test_register_with_pending_status(
        self, sqlite_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test account registration with pending status."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
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
                mock_tenant = Tenant(name="Test User's Workspace")
                sqlite_session.add(mock_tenant)
                sqlite_session.flush()
                mock_create_tenant.return_value = mock_tenant
                mock_create_member.side_effect = lambda tenant, account, session, role: session.add(
                    TenantAccountJoin(
                        tenant_id=tenant.id,
                        account_id=account.id,
                        role=TenantAccountRole(role),
                    )
                )

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

    def test_register_workspace_not_allowed(
        self, sqlite_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test registration when workspace creation is not allowed."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account
        mock_account = TestAccountAssociatedDataFactory.create_account_mock()
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.return_value = mock_account

            # Execute test and verify exception
            from services.errors.workspace import WorkSpaceNotAllowedCreateError

            with patch("services.account_service.TenantService.create_tenant") as mock_create_tenant:
                mock_create_tenant.side_effect = WorkSpaceNotAllowedCreateError()

                with pytest.raises(AccountRegisterError):
                    RegisterService.register(
                        email="test@example.com",
                        name="Test User",
                        password="password123",
                        language="en-US",
                        session=sqlite_session,
                    )

                assert sqlite_session.scalar(select(Account).where(Account.email == "test@example.com")) is None

    def test_register_general_exception(
        self, sqlite_session: Session, mock_external_service_dependencies: _MockDependencies
    ) -> None:
        """Test registration with general exception handling."""
        # Setup mocks
        mock_external_service_dependencies["feature_service"].get_system_features.return_value.is_allow_register = True
        mock_external_service_dependencies["billing_service"].is_email_in_freeze.return_value = False

        # Mock AccountService.create_account to raise exception
        with patch("services.account_service.AccountService.create_account") as mock_create_account:
            mock_create_account.side_effect = Exception("Unexpected error")

            # Execute test and verify exception
            with pytest.raises(AccountRegisterError):
                RegisterService.register(
                    email="test@example.com",
                    name="Test User",
                    password="password123",
                    language="en-US",
                    session=sqlite_session,
                )

            assert sqlite_session.scalar(select(Account).where(Account.email == "test@example.com")) is None

    # ==================== Member Invitation Tests ====================

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_new_account(self, sqlite_session: Session) -> None:
        """Test inviting a new member who doesn't have an account."""
        # Setup test data
        mock_tenant = _tenant(sqlite_session)
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
        self, sqlite_session: Session, mock_task_dependencies: MagicMock
    ) -> None:
        """Ensure inviting with mixed-case email normalizes before registering."""
        mock_tenant = _tenant(sqlite_session)
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
        self, sqlite_session: Session, mock_task_dependencies: MagicMock
    ) -> None:
        """Test inviting a pending account that is not in the tenant yet."""
        # Setup test data
        mock_tenant = _tenant(sqlite_session)
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
        self, sqlite_session: Session, mock_task_dependencies: MagicMock
    ) -> None:
        """Existing active accounts outside the tenant receive an invite without immediate membership."""
        mock_tenant = _tenant(sqlite_session)
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

    def test_invite_new_member_already_in_tenant(self, sqlite_session: Session) -> None:
        """Test inviting a member who is already in the tenant."""
        # Setup test data
        mock_tenant = _tenant(sqlite_session)
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
            with pytest.raises(AccountAlreadyInTenantError):
                RegisterService.invite_new_member(
                    tenant=mock_tenant,
                    email="existing@example.com",
                    language="en-US",
                    role="normal",
                    inviter=mock_inviter,
                    session=sqlite_session,
                )
            mock_lookup.assert_called_once()

    def test_invite_new_member_no_inviter(self, unbound_session: Session) -> None:
        """Test inviting a member without providing an inviter."""
        # Setup test data
        mock_tenant = _tenant()

        # Execute test and verify exception
        with pytest.raises(ValueError):
            RegisterService.invite_new_member(
                tenant=mock_tenant,
                email="test@example.com",
                language="en-US",
                role="normal",
                inviter=None,
                session=unbound_session,
            )

    # ==================== RBAC Member Invitation Tests ====================

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_rbac_enabled_new_account(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """When RBAC is enabled, create the member join and replace RBAC member roles."""
        config_overrides(RBAC_ENABLED=True)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = None

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
                    tenant_id=mock_tenant.id,
                    account_id=mock_inviter.id,
                    member_account_id=mock_new_account.id,
                    role_ids=["rbac-role-id-123"],
                    session=sqlite_session,
                )

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_rbac_enabled_existing_account(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """When RBAC is enabled and account exists, create the member join and replace RBAC member roles."""
        config_overrides(RBAC_ENABLED=True)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status="pending"
        )

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = mock_existing_account

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
                    tenant_id=mock_tenant.id,
                    account_id=mock_inviter.id,
                    member_account_id=mock_existing_account.id,
                    role_ids=["rbac-role-id-456"],
                    session=sqlite_session,
                )

    def test_invite_new_member_rbac_enabled_existing_active_account_adds_role_before_signin_response(
        self,
        sqlite_session: Session,
        mock_task_dependencies: MagicMock,
        config_overrides: Callable[..., None],
    ) -> None:
        """Existing active accounts still need an RBAC membership before the API returns the signin URL."""
        config_overrides(RBAC_ENABLED=True)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status=AccountStatus.ACTIVE
        )

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = mock_existing_account

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
                    tenant_id=mock_tenant.id,
                    account_id=mock_inviter.id,
                    member_account_id=mock_existing_account.id,
                    role_ids=["rbac-role-id-456"],
                    session=sqlite_session,
                )
                mock_task_dependencies.delay.assert_not_called()

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_rbac_disabled_uses_legacy_role(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """When RBAC is disabled, create_tenant_member should be called and MemberRoles.replace should NOT."""
        config_overrides(RBAC_ENABLED=False)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-legacy"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-789", name="Inviter")

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = None

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

    def test_generate_invite_token_success(self, mock_redis_dependencies: MagicMock) -> None:
        """Test successful invite token generation."""
        # Setup test data
        mock_tenant = _tenant()
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

    def test_is_valid_invite_token_valid(self, mock_redis_dependencies: MagicMock) -> None:
        """Test checking valid invite token."""
        # Setup mock
        mock_redis_dependencies.get.return_value = b'{"test": "data"}'

        # Execute test
        result = RegisterService.is_valid_invite_token("valid-token")

        # Verify results
        assert result is True
        mock_redis_dependencies.get.assert_called_once_with("member_invite:token:valid-token")

    def test_is_valid_invite_token_invalid(self, mock_redis_dependencies: MagicMock) -> None:
        """Test checking invalid invite token."""
        # Setup mock
        mock_redis_dependencies.get.return_value = None

        # Execute test
        result = RegisterService.is_valid_invite_token("invalid-token")

        # Verify results
        assert result is False
        mock_redis_dependencies.get.assert_called_once_with("member_invite:token:invalid-token")

    def test_revoke_token_with_workspace_and_email(self, mock_redis_dependencies: MagicMock) -> None:
        """Test revoking token with workspace ID and email."""
        # Execute test
        RegisterService.revoke_token("workspace-123", "test@example.com", "token-123")

        # Verify results
        mock_redis_dependencies.delete.assert_called_once()
        call_args = mock_redis_dependencies.delete.call_args
        assert "workspace-123" in call_args[0][0]
        # The email is hashed, so we check for the hash pattern instead
        assert "member_invite_token:" in call_args[0][0]

    def test_revoke_token_without_workspace_and_email(self, mock_redis_dependencies: MagicMock) -> None:
        """Test revoking token without workspace ID and email."""
        # Execute test
        RegisterService.revoke_token("", "", "token-123")

        # Verify results
        mock_redis_dependencies.delete.assert_called_once_with("member_invite:token:token-123")

    # ==================== Invitation Validation Tests ====================

    def test_get_invitation_if_token_valid_success(self, sqlite_session: Session) -> None:
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

    def test_get_invitation_if_token_valid_no_token_data(
        self, unbound_session: Session, mock_redis_dependencies: MagicMock
    ) -> None:
        """Test invitation validation with no token data."""
        # Setup mock
        mock_redis_dependencies.get.return_value = None

        # Execute test
        result = RegisterService.get_invitation_if_token_valid(
            "tenant-456", "test@example.com", "token-123", session=unbound_session
        )

        # Verify results
        assert result is None

    def test_get_invitation_if_token_valid_tenant_not_found(
        self, sqlite_session: Session, mock_redis_dependencies: MagicMock
    ) -> None:
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

    def test_get_invitation_if_token_valid_account_not_found(
        self, sqlite_session: Session, mock_redis_dependencies: MagicMock
    ) -> None:
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

    def test_get_invitation_if_token_valid_account_id_mismatch(
        self, sqlite_session: Session, mock_redis_dependencies: MagicMock
    ) -> None:
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

    def test_get_invitation_with_case_fallback_returns_initial_match(self, sqlite_session: Session) -> None:
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

    def test_get_invitation_with_case_fallback_retries_with_lowercase(self, sqlite_session: Session) -> None:
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

    def test_get_invitation_token_key(self) -> None:
        """Test the _get_invitation_token_key helper method."""
        # Execute test
        result = RegisterService._get_invitation_token_key("test-token")

        # Verify results
        assert result == "member_invite:token:test-token"

    def test_get_invitation_by_token_with_workspace_and_email(self, mock_redis_dependencies: MagicMock) -> None:
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

    def test_get_invitation_by_token_without_workspace_and_email(self, mock_redis_dependencies: MagicMock) -> None:
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

    def test_get_invitation_by_token_no_data(self, mock_redis_dependencies: MagicMock) -> None:
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

    def test_get_account_by_id_uses_passed_session_no_side_effects(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        """``get_account_by_id`` must be a plain delegation to
        ``session.get(Account, ...)`` — no banned-status raise, no
        commit (those are the side-effects of ``load_user`` we
        explicitly want to skip).
        """
        with sqlite_session_factory.begin() as arrange_session:
            account = Account(name="Alice", email="alice@example.com", status=AccountStatus.BANNED)
            arrange_session.add(account)
            arrange_session.flush()
            account_id = account.id

        with sqlite_session_factory() as service_session:
            result = AccountService.get_account_by_id(account_id, session=service_session)

            assert result is not None
            assert result.id == account_id
            assert result.status == AccountStatus.BANNED

    def test_get_account_by_id_returns_none_for_unknown_account(self, sqlite_session: Session) -> None:
        assert AccountService.get_account_by_id("missing", session=sqlite_session) is None

    def test_get_account_by_email_returns_scalar_or_none(self, sqlite_session: Session) -> None:
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

    def test_account_belongs_to_tenant_short_circuits_on_falsy_account_id(self, unbound_session: Session) -> None:
        """SSO bearers with no ``account_id`` (and any other falsy id)
        must collapse to ``False`` before touching membership storage.
        """
        assert TenantService.account_belongs_to_tenant(None, "tenant-1", session=unbound_session) is False
        assert TenantService.account_belongs_to_tenant("", "tenant-1", session=unbound_session) is False

    def test_account_belongs_to_tenant_true_when_join_row_exists(self, sqlite_session: Session) -> None:
        sqlite_session.add(TenantAccountJoin(tenant_id="tenant-1", account_id="user-1", role=TenantAccountRole.NORMAL))
        sqlite_session.commit()

        assert TenantService.account_belongs_to_tenant("user-1", "tenant-1", session=sqlite_session) is True
        assert TenantService.account_belongs_to_tenant("user-1", "other-tenant", session=sqlite_session) is False

    def test_account_belongs_to_tenant_false_when_no_join(self, sqlite_session: Session) -> None:
        assert TenantService.account_belongs_to_tenant("user-1", "tenant-1", session=sqlite_session) is False

    def test_get_account_memberships_returns_join_tenant_pairs(self, sqlite_session: Session) -> None:
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

    def test_get_workspaces_for_account_uses_session_execute(self, sqlite_session: Session) -> None:
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

    def test_get_tenant_by_id_is_plain_session_get(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """``get_tenant_by_id`` must NOT apply a status filter — the
        openapi auth pipeline needs to map ``status == ARCHIVE`` to a
        403, distinct from a 404 for "missing".
        """
        with sqlite_session_factory.begin() as arrange_session:
            tenant = Tenant(name="Archived Workspace", status=TenantStatus.ARCHIVE)
            arrange_session.add(tenant)
            arrange_session.flush()
            tenant_id = tenant.id

        with sqlite_session_factory() as service_session:
            result = TenantService.get_tenant_by_id(tenant_id, session=service_session)
            assert result is not None
            assert result.id == tenant_id
            assert result.status == TenantStatus.ARCHIVE

    def test_get_tenant_by_id_returns_none_when_missing(self, sqlite_session: Session) -> None:
        assert TenantService.get_tenant_by_id("missing", session=sqlite_session) is None

    def test_get_tenants_by_ids_short_circuits_on_empty_input(self, unbound_session: Session) -> None:
        """Empty id list must return before touching tenant storage."""
        assert TenantService.get_tenants_by_ids([], session=unbound_session) == []

    def test_get_tenants_by_ids_returns_scalars(self, sqlite_session: Session) -> None:
        tenant_1 = Tenant(name="Workspace 1")
        tenant_2 = Tenant(name="Workspace 2")
        tenant_3 = Tenant(name="Workspace 3")
        sqlite_session.add_all([tenant_1, tenant_2, tenant_3])
        sqlite_session.commit()

        tenants = TenantService.get_tenants_by_ids([tenant_1.id, tenant_3.id], session=sqlite_session)

        assert {tenant.id for tenant in tenants} == {tenant_1.id, tenant_3.id}

    def test_get_tenant_name_returns_scalar_or_none(self, sqlite_session: Session) -> None:
        """Single-column lookup: ``session.execute(...).scalar_one_or_none()``
        — used by openapi list endpoints to denormalise
        ``workspace_name`` onto each row.
        """
        tenant = Tenant(name="Acme Inc.")
        sqlite_session.add(tenant)
        sqlite_session.commit()

        assert TenantService.get_tenant_name(tenant.id, session=sqlite_session) == "Acme Inc."
        assert TenantService.get_tenant_name("missing", session=sqlite_session) is None

    def test_find_workspace_for_account_returns_first_row_or_none(self, sqlite_session: Session) -> None:
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


def test_get_account_by_email_with_case_fallback_uses_lowercase(sqlite_session: Session) -> None:
    account = Account(name="Case User", email="case@test.com")
    sqlite_session.add(account)
    sqlite_session.commit()

    result = AccountService.get_account_by_email_with_case_fallback("Case@Test.com", session=sqlite_session)

    assert result is account


class TestIsEmailSendIpLimit:
    """The 10-minute first-strike window must actually take effect (#39477)."""

    def _mock_redis(self, *, minute_count: int, hour_count: int | None, frozen: bool = False) -> MagicMock:
        values = {
            "email_send_ip_limit_freeze:1.2.3.4": "1" if frozen else None,
            "email_send_ip_limit_minute:1.2.3.4": str(minute_count),
            "email_send_ip_limit_hour:1.2.3.4": None if hour_count is None else str(hour_count),
        }
        redis_client = MagicMock()
        redis_client.get.side_effect = lambda key: values.get(key)
        return redis_client

    def test_frozen_ip_is_limited(self) -> None:
        redis_client = self._mock_redis(minute_count=0, hour_count=None, frozen=True)
        with patch("services.account_service.redis_client", redis_client):
            assert AccountService.is_email_send_ip_limit("1.2.3.4") is True

    def test_first_strike_sets_ten_minute_window(self) -> None:
        redis_client = self._mock_redis(minute_count=999, hour_count=None)
        redis_client.set.return_value = True
        with (
            patch("services.account_service.redis_client", redis_client),
            patch.object(dify_config, "EMAIL_SEND_IP_LIMIT_PER_MINUTE", 1),
        ):
            assert AccountService.is_email_send_ip_limit("1.2.3.4") is True

        redis_client.set.assert_called_once_with("email_send_ip_limit_hour:1.2.3.4", 1, ex=60 * 10, nx=True)
        # No non-atomic setex/incr/expire may widen or shrink the window.
        redis_client.setex.assert_not_called()
        redis_client.incr.assert_not_called()
        redis_client.expire.assert_not_called()

    def test_first_strike_lost_claim_freezes_immediately(self) -> None:
        redis_client = self._mock_redis(minute_count=999, hour_count=None)
        redis_client.set.return_value = None  # another worker claimed the strike first
        with (
            patch("services.account_service.redis_client", redis_client),
            patch.object(dify_config, "EMAIL_SEND_IP_LIMIT_PER_MINUTE", 1),
        ):
            assert AccountService.is_email_send_ip_limit("1.2.3.4") is True

        redis_client.setex.assert_called_once_with("email_send_ip_limit_freeze:1.2.3.4", 60 * 60, 1)

    def test_second_strike_inside_window_freezes_for_an_hour(self) -> None:
        redis_client = self._mock_redis(minute_count=999, hour_count=1)
        with (
            patch("services.account_service.redis_client", redis_client),
            patch.object(dify_config, "EMAIL_SEND_IP_LIMIT_PER_MINUTE", 1),
        ):
            assert AccountService.is_email_send_ip_limit("1.2.3.4") is True

        redis_client.setex.assert_called_once_with("email_send_ip_limit_freeze:1.2.3.4", 60 * 60, 1)

    def test_under_limit_not_limited(self) -> None:
        redis_client = self._mock_redis(minute_count=0, hour_count=None)
        with (
            patch("services.account_service.redis_client", redis_client),
            patch.object(dify_config, "EMAIL_SEND_IP_LIMIT_PER_MINUTE", 60),
        ):
            assert AccountService.is_email_send_ip_limit("1.2.3.4") is False
