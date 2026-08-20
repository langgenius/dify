import json
from collections.abc import Callable, Generator, Iterator
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta
from threading import Barrier
from unittest.mock import ANY, MagicMock, call, patch
from uuid import UUID

import pytest
from redis.crc import key_slot
from sqlalchemy import event, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import Conflict

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
from services import account_service as account_service_module
from services.account_service import AccountService, InvitationData, RegisterService, TenantService, _invitation_lock
from services.enterprise.rbac_service import MembersInRole, Paginated
from services.errors.account import (
    AccountAlreadyInTenantError,
    AccountLoginError,
    AccountPasswordError,
    AccountRegisterError,
    CurrentPasswordIncorrectError,
    MemberNotInTenantError,
    NoPermissionError,
    SeatsLimitExceededError,
    WorkspaceMembersLimitExceededError,
)
from services.errors.enterprise import EnterpriseAPIError
from services.workspace_member_query_service import WorkspaceInvitationRecord

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


def _deletable_account(session: Session, *roles: TenantAccountRole) -> tuple[Account, list[str]]:
    account = Account(name="Delete Me", email="delete@example.com")
    tenants = [Tenant(name=f"Workspace {index}") for index in range(len(roles))]
    session.add_all([account, *tenants])
    session.flush()
    session.add_all(
        TenantAccountJoin(tenant_id=tenant.id, account_id=account.id, role=role)
        for tenant, role in zip(tenants, roles, strict=True)
    )
    session.commit()
    return account, sorted(tenant.id for tenant in tenants)


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

    def test_delete_account_queues_snapshot_then_task_before_closing(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        events: list[str] = []

        @contextmanager
        def tracked_account_lock(_account_id: str) -> Generator[None]:
            events.append("account lock")
            yield

        @contextmanager
        def tracked_workspace_locks(_workspace_ids: list[str]) -> Generator[None]:
            events.append("workspace locks")
            yield

        with sqlite_session_factory() as session:
            account, workspace_ids = _deletable_account(
                session,
                TenantAccountRole.NORMAL,
                TenantAccountRole.ADMIN,
            )
            with (
                patch("services.account_service.account_membership_mutation_lock", tracked_account_lock),
                patch("services.account_service.workspace_membership_mutation_locks", tracked_workspace_locks),
                patch(
                    "services.enterprise.account_deletion_sync.sync_account_deletion",
                    side_effect=lambda **_kwargs: events.append("cleanup") or True,
                ) as sync_account_deletion,
                patch.object(
                    account_service_module.delete_account_task,
                    "delay",
                    side_effect=lambda _account_id: events.append("delete task"),
                ) as delete_account,
            ):
                AccountService.delete_account(account, session=session)
            account_id = account.id

        sync_account_deletion.assert_called_once_with(
            account_id=account_id,
            workspace_ids=workspace_ids,
            source="account_deleted",
        )
        delete_account.assert_called_once_with(account_id)
        assert events == ["account lock", "workspace locks", "cleanup", "delete task"]
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.CLOSED

    def test_delete_account_aborts_when_cleanup_cannot_be_queued(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            account, _ = _deletable_account(session, TenantAccountRole.NORMAL)
            account_id = account.id
            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_locks", return_value=nullcontext()),
                patch("services.enterprise.account_deletion_sync.sync_account_deletion", return_value=False),
                patch.object(account_service_module.delete_account_task, "delay") as delete_account,
                pytest.raises(RuntimeError, match="Failed to queue enterprise account cleanup"),
            ):
                AccountService.delete_account(account, session=session)

        delete_account.assert_not_called()
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.ACTIVE

    def test_delete_account_rejects_workspace_owner_before_queueing(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            account, _ = _deletable_account(session, TenantAccountRole.NORMAL)
            account_id = account.id

            @contextmanager
            def transfer_ownership_while_waiting(_workspace_ids: list[str]) -> Generator[None]:
                membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.account_id == account_id))
                assert membership is not None
                membership.role = TenantAccountRole.OWNER
                session.flush()
                yield

            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch(
                    "services.account_service.workspace_membership_mutation_locks",
                    side_effect=transfer_ownership_while_waiting,
                ),
                patch("services.enterprise.account_deletion_sync.sync_account_deletion") as queue_cleanup,
                patch.object(account_service_module.delete_account_task, "delay") as delete_account,
                pytest.raises(Conflict, match="Transfer workspace ownership"),
            ):
                AccountService.delete_account(account, session=session)

        queue_cleanup.assert_not_called()
        delete_account.assert_not_called()
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.ACTIVE

    def test_delete_account_rejects_remote_rbac_owner_before_queueing(
        self,
        sqlite_session_factory: sessionmaker[Session],
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(RBAC_ENABLED=True)
        with sqlite_session_factory() as session:
            account, workspace_ids = _deletable_account(
                session,
                TenantAccountRole.NORMAL,
                TenantAccountRole.NORMAL,
            )
            account_id = account.id
            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_locks", return_value=nullcontext()),
                patch.object(
                    AccountService,
                    "get_rbac_workspace_owner_account_id",
                    side_effect=["other-owner", account_id],
                ) as get_owner,
                patch("services.enterprise.account_deletion_sync.sync_account_deletion") as queue_cleanup,
                patch.object(account_service_module.delete_account_task, "delay") as delete_account,
                pytest.raises(Conflict, match="Transfer workspace ownership"),
            ):
                AccountService.delete_account(account, session=session)

        assert get_owner.call_args_list == [call(workspace_id) for workspace_id in sorted(workspace_ids)]
        queue_cleanup.assert_not_called()
        delete_account.assert_not_called()
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.ACTIVE

    def test_delete_account_checks_workspace_owners_concurrently(
        self,
        sqlite_session_factory: sessionmaker[Session],
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(RBAC_ENABLED=True)
        barrier = Barrier(2)
        with sqlite_session_factory() as session:
            account, workspace_ids = _deletable_account(
                session,
                TenantAccountRole.NORMAL,
                TenantAccountRole.NORMAL,
            )

            def get_owner(_workspace_id: str) -> str:
                barrier.wait(timeout=2)
                return "other-owner"

            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_locks", return_value=nullcontext()),
                patch.object(AccountService, "get_rbac_workspace_owner_account_id", side_effect=get_owner),
                patch("services.enterprise.account_deletion_sync.sync_account_deletion", return_value=True),
                patch.object(account_service_module.delete_account_task, "delay"),
            ):
                AccountService.delete_account(account, session=session)

        assert len(workspace_ids) == 2

    def test_delete_account_fails_closed_when_rbac_owner_resolution_fails(
        self,
        sqlite_session_factory: sessionmaker[Session],
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(RBAC_ENABLED=True)
        with sqlite_session_factory() as session:
            account, workspace_ids = _deletable_account(session, TenantAccountRole.NORMAL)
            account_id = account.id
            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_locks", return_value=nullcontext()),
                patch.object(
                    AccountService,
                    "get_rbac_workspace_owner_account_id",
                    side_effect=RuntimeError("owner unavailable"),
                ) as get_owner,
                patch("services.enterprise.account_deletion_sync.sync_account_deletion") as queue_cleanup,
                patch.object(account_service_module.delete_account_task, "delay") as delete_account,
                pytest.raises(RuntimeError, match="owner unavailable"),
            ):
                AccountService.delete_account(account, session=session)

        get_owner.assert_called_once_with(workspace_ids[0])
        queue_cleanup.assert_not_called()
        delete_account.assert_not_called()
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.ACTIVE

    def test_delete_account_broker_failure_does_not_close_account(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            account, _ = _deletable_account(session, TenantAccountRole.NORMAL)
            account_id = account.id
            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_locks", return_value=nullcontext()),
                patch("services.enterprise.account_deletion_sync.sync_account_deletion", return_value=True),
                patch.object(account_service_module.delete_account_task, "delay", side_effect=RuntimeError("broker")),
                pytest.raises(RuntimeError, match="broker"),
            ):
                AccountService.delete_account(account, session=session)

        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.ACTIVE

    def test_delete_account_commit_failure_rolls_back_after_scheduling(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            account, _ = _deletable_account(session, TenantAccountRole.NORMAL)
            account_id = account.id
            with (
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_locks", return_value=nullcontext()),
                patch("services.enterprise.account_deletion_sync.sync_account_deletion", return_value=True),
                patch.object(account_service_module.delete_account_task, "delay") as delete_account,
                patch.object(session, "commit", side_effect=RuntimeError("database")),
                pytest.raises(RuntimeError, match="database"),
            ):
                AccountService.delete_account(account, session=session)

        delete_account.assert_called_once_with(account_id)
        with sqlite_session_factory() as session:
            assert session.scalar(select(Account.status).where(Account.id == account_id)) == AccountStatus.ACTIVE

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

    @pytest.mark.parametrize("status", [AccountStatus.CLOSED, AccountStatus.UNINITIALIZED])
    def test_authenticate_rejects_inactive_account(self, sqlite_session: Session, status: AccountStatus) -> None:
        account = Account(
            name="Inactive User",
            email="inactive@example.com",
            password="hashed_password",
            password_salt="salt",
            status=status,
        )
        sqlite_session.add(account)
        sqlite_session.commit()

        with pytest.raises(AccountLoginError, match="not active"):
            AccountService.authenticate(account.email, "password", "invite-token", session=sqlite_session)

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

    def test_activate_pending_account_does_not_revive_concurrently_closed_account(
        self,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        with sqlite_session_factory() as service_session:
            account = Account(name="Pending User", email="closing@example.com", status=AccountStatus.PENDING)
            service_session.add(account)
            service_session.commit()
            account_id = account.id
            service_session.get(Account, account_id)

            with sqlite_session_factory() as deletion_session:
                persisted_account = deletion_session.get(Account, account_id)
                assert persisted_account is not None
                persisted_account.status = AccountStatus.CLOSED
                deletion_session.commit()

            with pytest.raises(AccountLoginError, match="not active"):
                AccountService.activate_pending_account(account_id, session=service_session)

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.status == AccountStatus.CLOSED

    def test_update_account_does_not_revive_concurrently_closed_account(
        self,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        with sqlite_session_factory() as stale_session:
            stale_account = Account(name="Original", email="closing@example.com")
            stale_session.add(stale_account)
            stale_session.commit()
            account_id = stale_account.id

        with sqlite_session_factory() as deletion_session:
            persisted_account = deletion_session.get(Account, account_id)
            assert persisted_account is not None
            persisted_account.status = AccountStatus.CLOSED
            deletion_session.commit()

        with (
            sqlite_session_factory() as update_session,
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
            pytest.raises(AccountLoginError, match="not active"),
        ):
            AccountService.update_account(stale_account, name="Stale update", session=update_session)

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.status == AccountStatus.CLOSED
            assert persisted_account.name == "Original"

    def test_update_account_rejects_non_profile_fields(self, unbound_session: Session) -> None:
        account = Account(name="Test User", email="test@example.com")

        with pytest.raises(AttributeError, match="Invalid field: status"):
            AccountService.update_account(account, status=AccountStatus.CLOSED, session=unbound_session)

    def test_authenticate_pending_invitee_stays_pending_until_activation(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_password_dependencies: _MockDependencies,
    ) -> None:
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

            AccountService.authenticate(
                "pending@example.com",
                "password",
                "current-invite-token",
                session=service_session,
            )

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.status == AccountStatus.PENDING
            assert persisted_account.initialized_at is None

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

    # ==================== Password Management Tests ====================

    def test_update_account_password_success(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_password_dependencies: _MockDependencies,
    ) -> None:
        """Test successful password update with correct current password and valid new password."""
        with sqlite_session_factory() as service_session:
            account = Account(
                name="Test User",
                email="test@example.com",
                password="hashed_password",
                password_salt="salt",
            )
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            mock_password_dependencies["compare_password"].return_value = True
            mock_password_dependencies["valid_password"].return_value = None
            mock_password_dependencies["hash_password"].return_value = b"new_hashed_password"

            result = AccountService.update_account_password(
                account,
                "old_password",
                "new_password123",
                session=service_session,
            )
            assert result is account

        mock_password_dependencies["compare_password"].assert_called_once_with(
            "old_password", "hashed_password", "salt"
        )
        mock_password_dependencies["valid_password"].assert_called_once_with("new_password123")

        with sqlite_session_factory() as assertion_session:
            persisted_account = assertion_session.get(Account, account_id)
            assert persisted_account is not None
            assert persisted_account.password is not None
            assert persisted_account.password != "hashed_password"
            assert persisted_account.password_salt is not None
            assert persisted_account.password_salt != "salt"

    def test_update_account_password_current_password_incorrect(
        self, unbound_session: Session, mock_password_dependencies: _MockDependencies
    ) -> None:
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
        with pytest.raises(CurrentPasswordIncorrectError):
            AccountService.update_account_password(
                mock_account,
                "wrong_password",
                "new_password123",
                session=unbound_session,
            )

        # Verify password comparison was called
        mock_password_dependencies["compare_password"].assert_called_once_with(
            "wrong_password", "hashed_password", "salt"
        )

    def test_update_account_password_invalid_new_password(
        self, unbound_session: Session, mock_password_dependencies: _MockDependencies
    ) -> None:
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
        with pytest.raises(ValueError):
            AccountService.update_account_password(
                mock_account,
                "old_password",
                "short",
                session=unbound_session,
            )

        # Verify password validation was called
        mock_password_dependencies["valid_password"].assert_called_once_with("short")

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

    @pytest.mark.parametrize("status", [AccountStatus.BANNED, AccountStatus.CLOSED, AccountStatus.UNINITIALIZED])
    def test_load_user_rejects_inactive_status(self, sqlite_session: Session, status: AccountStatus) -> None:
        from werkzeug.exceptions import Unauthorized

        account = Account(name="Inactive User", email="inactive@example.com", status=status)
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

    def test_load_user_authenticates_account_without_normal_tenant(self, sqlite_session: Session) -> None:
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

        with patch.object(AccountService, "_refresh_account_last_active"):
            result = AccountService.load_user(account.id, sqlite_session)

        assert result is account
        assert result.current_tenant_id is None
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

    def test_load_user_authenticates_account_without_tenants(self, sqlite_session: Session) -> None:
        account = Account(name="Test User", email="test@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()

        with patch.object(AccountService, "_refresh_account_last_active"):
            result = AccountService.load_user(account.id, sqlite_session)

        assert result is account
        assert result.current_tenant_id is None

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

    def test_stage_tenant_provisions_key_before_database_transaction(
        self,
        sqlite_session: Session,
        mock_rsa_dependencies: MagicMock,
    ) -> None:
        def generate_key_pair(_tenant_id: str) -> str:
            assert not sqlite_session.in_transaction()
            return "mock_public_key"

        mock_rsa_dependencies.side_effect = generate_key_pair
        with patch("services.credit_pool_service.CreditPoolService.create_default_pool"):
            tenant = TenantService._stage_tenant("Test Workspace", TenantStatus.PROVISIONING, session=sqlite_session)

        assert tenant.encrypt_public_key == "mock_public_key"
        assert sqlite_session.in_transaction()

    def test_create_owner_tenant_if_not_exist_new_user(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_rsa_dependencies: MagicMock,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        """Creating an owner workspace persists both the tenant and owner membership."""
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True
        mock_rsa_dependencies.return_value = "mock_public_key"

        with (
            patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.tenant_was_created.send") as mock_tenant_was_created,
        ):
            with sqlite_session_factory() as service_session:
                account = Account(name="Test User", email="test@example.com")
                service_session.add(account)
                service_session.commit()
                account_id = account.id
                TenantService.create_owner_tenant_if_not_exist(account, session=service_session)
                tenant = service_session.scalar(select(Tenant).where(Tenant.name == "Test User's Workspace"))
                assert tenant is not None
                tenant_id = tenant.id
                assert account.current_tenant_id == tenant.id
                assert mock_tenant_was_created.call_count == 1
                assert mock_tenant_was_created.call_args.args[0].id == tenant.id

        mock_rsa_dependencies.assert_called_once_with(tenant_id)

        with sqlite_session_factory() as assertion_session:
            tenant = assertion_session.get(Tenant, tenant_id)
            assert tenant is not None
            assert tenant.encrypt_public_key == "mock_public_key"

            tenant_account_join = assertion_session.scalar(
                select(TenantAccountJoin).where(
                    TenantAccountJoin.tenant_id == tenant_id,
                    TenantAccountJoin.account_id == account_id,
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

            with patch(
                "services.account_service.account_workspace_membership_mutation_lock",
                return_value=nullcontext(),
            ):
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
            operator_id = operator.id
            member_join_id = member_join.id
            service_session.commit()

            with (
                patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
                patch.object(
                    account_service_module,
                    "account_workspace_membership_mutation_lock",
                    return_value=nullcontext(),
                ) as mutation_lock,
                patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
            ):
                mock_sync.return_value = True

                TenantService.remove_member_from_tenant(
                    tenant_id,
                    member_id,
                    operator_id,
                )

                mutation_lock.assert_called_once_with(member_id, tenant_id)
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
            operator_id = operator.id
            member_join_id = member_join.id
            other_member_join_id = other_member_join.id
            service_session.commit()

            with (
                patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
                patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
            ):
                mock_sync.return_value = True

                TenantService.remove_member_from_tenant(
                    tenant_id,
                    member_id,
                    operator_id,
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

    def test_remove_pending_member_keeps_account_invited_to_another_workspace(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            operator = Account(name="Operator", email="operator-invite@example.com")
            pending_member = Account(
                name="Pending Member",
                email="pending-elsewhere@example.com",
                status=AccountStatus.PENDING,
            )
            service_session.add_all([tenant, operator, pending_member])
            service_session.flush()
            self._add_tenant_account_join(service_session, tenant, operator.id, TenantAccountRole.OWNER)
            member_join = self._add_tenant_account_join(
                service_session,
                tenant,
                pending_member.id,
                TenantAccountRole.NORMAL,
            )
            service_session.commit()
            tenant_id = tenant.id
            operator_id = operator.id
            member_id = pending_member.id
            member_join_id = member_join.id

        with (
            patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
            patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal", return_value=True),
            patch.object(RegisterService, "has_other_current_invitation", return_value=True),
        ):
            TenantService.remove_member_from_tenant(tenant_id, member_id, operator_id)

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.get(TenantAccountJoin, member_join_id) is None
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
            operator_id = operator.id
            member_join_id = member_join.id
            service_session.commit()

            with (
                patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.COMMUNITY),
                patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as mock_sync,
            ):
                mock_sync.return_value = True

                TenantService.remove_member_from_tenant(
                    tenant_id,
                    member_id,
                    operator_id,
                )

                mock_sync.assert_called_once_with(
                    workspace_id=tenant_id,
                    member_id=member_id,
                    source="workspace_member_removed",
                )

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.get(TenantAccountJoin, member_join_id) is None
            assert assertion_session.get(Account, member_id) is not None

    def test_remove_pending_invitation_without_membership_deletes_orphan_account(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            operator = Account(name="Owner", email="owner@example.com")
            pending = Account(name="Pending", email="pending-invite@example.com", status=AccountStatus.PENDING)
            session.add_all([tenant, operator, pending])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            session.commit()
            tenant_id = tenant.id
            operator_id = operator.id
            pending_id = pending.id

        invitation: InvitationData = {
            "account_id": pending_id,
            "email": pending.email,
            "workspace_id": tenant_id,
            "role": "normal",
            "inviter_id": operator_id,
        }
        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch.object(RegisterService, "_current_invitation_token", return_value="token"),
            patch.object(RegisterService, "get_invitation_by_token", return_value=invitation),
            patch.object(RegisterService, "has_other_current_invitation", return_value=False),
            patch.object(RegisterService, "invalidate_member_invitation") as invalidate,
            patch("services.enterprise.account_deletion_sync.sync_workspace_member_removal") as queue_cleanup,
        ):
            TenantService.remove_member_from_tenant(tenant_id, pending_id, operator_id)

        invalidate.assert_called_once_with(tenant_id, pending_id)
        queue_cleanup.assert_not_called()
        with sqlite_session_factory() as session:
            assert session.get(Account, pending_id) is None

    def test_remove_pending_invitation_preserves_account_invited_elsewhere(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            operator = Account(name="Owner", email="owner-2@example.com")
            pending = Account(name="Pending", email="pending-2@example.com", status=AccountStatus.PENDING)
            session.add_all([tenant, operator, pending])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            session.commit()
            tenant_id = tenant.id
            operator_id = operator.id
            pending_id = pending.id

        invitation: InvitationData = {
            "account_id": pending_id,
            "email": pending.email,
            "workspace_id": tenant_id,
            "role": "normal",
            "inviter_id": operator_id,
        }
        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch.object(RegisterService, "_current_invitation_token", return_value="token"),
            patch.object(RegisterService, "get_invitation_by_token", return_value=invitation),
            patch.object(RegisterService, "has_other_current_invitation", return_value=True),
            patch.object(RegisterService, "invalidate_member_invitation"),
        ):
            TenantService.remove_member_from_tenant(tenant_id, pending_id, operator_id)

        with sqlite_session_factory() as session:
            assert session.get(Account, pending_id) is not None

    def test_remove_pending_rbac_invitation_cleans_orphan_remote_binding(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            operator = Account(name="Owner", email="rbac-invite-owner@example.com")
            pending = Account(name="Pending", email="rbac-pending@example.com", status=AccountStatus.PENDING)
            session.add_all([tenant, operator, pending])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            session.commit()
            tenant_id, operator_id, pending_id = tenant.id, operator.id, pending.id

        invitation: InvitationData = {
            "account_id": pending_id,
            "email": pending.email,
            "workspace_id": tenant_id,
            "role": "normal",
            "inviter_id": operator_id,
        }
        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch.object(RegisterService, "_current_invitation_token", return_value="token"),
            patch.object(RegisterService, "get_invitation_by_token", return_value=invitation),
            patch.object(RegisterService, "has_other_current_invitation", return_value=False),
            patch.object(RegisterService, "invalidate_member_invitation"),
            patch("services.account_service.require_tenant_members") as require_members,
            patch(
                "services.account_service.AccountService.get_workspace_permission_keys",
                return_value={"workspace.member.manage"},
            ),
            patch("services.account_service.RBACService.MemberRoles.delete_rbac_bindings") as delete_bindings,
        ):
            TenantService.remove_member_from_tenant(tenant_id, pending_id, operator_id)

        require_members.assert_called_once_with(tenant_id, [operator_id])
        delete_bindings.assert_called_once_with(tenant_id, operator_id, pending_id)

    def test_remove_member_aborts_when_enterprise_cleanup_cannot_be_queued(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Test Workspace")
            operator = Account(name="Operator", email="operator@example.com")
            member = Account(name="Member", email="member@example.com")
            session.add_all([tenant, operator, member])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            membership = self._add_tenant_account_join(session, tenant, member.id, TenantAccountRole.NORMAL)
            tenant_id = tenant.id
            operator_id = operator.id
            member_id = member.id
            membership_id = membership.id
            session.commit()

        lock_held = False

        @contextmanager
        def tracked_lock(_account_id: str, _tenant_id: str) -> Generator[None]:
            nonlocal lock_held
            lock_held = True
            try:
                yield
            finally:
                lock_held = False

        events: list[str] = []

        def invalidate_invitation(*_args) -> None:
            assert lock_held
            events.append("invalidate")

        def reject_cleanup(**_kwargs) -> bool:
            assert lock_held
            events.append("queue")
            return False

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch("services.account_service.account_workspace_membership_mutation_lock", side_effect=tracked_lock),
            patch.object(RegisterService, "invalidate_member_invitation", side_effect=invalidate_invitation),
            patch(
                "services.enterprise.account_deletion_sync.sync_workspace_member_removal",
                side_effect=reject_cleanup,
            ),
            pytest.raises(RuntimeError, match="Failed to queue enterprise workspace member cleanup"),
        ):
            TenantService.remove_member_from_tenant(tenant_id, member_id, operator_id)

        with sqlite_session_factory() as assertion_session:
            assert assertion_session.get(TenantAccountJoin, membership_id) is not None
            assert assertion_session.get(Account, member_id) is not None
        assert events == ["queue"]

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

    def test_legacy_owner_transfer_uses_membership_lock(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
            operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
            service_session.add_all([tenant, member, operator])
            service_session.flush()
            target_join = self._add_tenant_account_join(
                service_session,
                tenant,
                member.id,
                TenantAccountRole.NORMAL,
            )
            owner_join = self._add_tenant_account_join(
                service_session,
                tenant,
                operator.id,
                TenantAccountRole.OWNER,
            )
            service_session.flush()
            tenant_id = tenant.id
            member_id = member.id
            operator_id = operator.id
            target_join_id = target_join.id
            owner_join_id = owner_join.id
            service_session.commit()

        with patch.object(
            account_service_module,
            "workspace_membership_mutation_lock",
            return_value=nullcontext(),
        ) as mutation_lock:
            TenantService.update_member_role(
                tenant_id,
                member_id,
                "owner",
                operator_id,
                allow_owner_transfer=True,
            )

        mutation_lock.assert_called_once_with(tenant_id)

        with sqlite_session_factory() as assertion_session:
            persisted_target_join = assertion_session.get(TenantAccountJoin, target_join_id)
            persisted_owner_join = assertion_session.get(TenantAccountJoin, owner_join_id)
            assert persisted_target_join is not None
            assert persisted_owner_join is not None
            assert persisted_target_join.role == TenantAccountRole.OWNER
            assert persisted_owner_join.role == TenantAccountRole.ADMIN

    def test_create_owner_tenant_rbac_enabled_assigns_owner_role(
        self,
        sqlite_session: Session,
        mock_rsa_dependencies: MagicMock,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        account = Account(name="RBAC User", email="rbac@example.com")
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True

        sqlite_session.add(account)
        sqlite_session.commit()
        account_id = account.id

        caller_session = Session(bind=sqlite_session.get_bind(), expire_on_commit=True)
        account = caller_session.get(Account, account_id)
        assert account is not None
        assert caller_session.in_transaction()

        def generate_key(_tenant_id: str) -> str:
            assert not caller_session.in_transaction()
            return "mock_public_key"

        def bootstrap_owner(*_args: str) -> None:
            assert not caller_session.in_transaction()

        mock_rsa_dependencies.side_effect = generate_key

        with (
            patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.RBACService") as mock_rbac_service,
            patch("services.account_service.tenant_was_created.send"),
        ):
            mock_rbac_service.MemberRoles.bootstrap_owner.side_effect = bootstrap_owner
            tenant = TenantService.create_owner_tenant(account, is_setup=True, session=caller_session)

        mock_rbac_service.MemberRoles.bootstrap_owner.assert_called_once_with(tenant.id, account_id)
        assert tenant.status == TenantStatus.NORMAL
        membership = sqlite_session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == tenant.id,
                TenantAccountJoin.account_id == account_id,
            )
        )
        assert membership is not None
        assert membership.role == TenantAccountRole.OWNER
        assert membership.current is True
        caller_session.close()

    @pytest.mark.parametrize("method_name", ["create_owner_tenant", "create_owner_tenant_if_not_exist"])
    def test_owner_tenant_creation_resumes_provisioning_after_rbac_failure(
        self,
        method_name: str,
        sqlite_session_factory: sessionmaker[Session],
        mock_rsa_dependencies: MagicMock,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        mock_rsa_dependencies.return_value = "mock_public_key"
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True

        with sqlite_session_factory() as service_session:
            account = Account(name="RBAC User", email=f"rbac-retry-{method_name}@example.com")
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            bootstrap_tenant_ids: list[str] = []

            def bootstrap_owner(tenant_id: str, _account_id: str) -> None:
                assert not service_session.in_transaction()
                bootstrap_tenant_ids.append(tenant_id)
                if len(bootstrap_tenant_ids) == 1:
                    raise EnterpriseAPIError("unavailable", status_code=503)

            with (
                patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
                patch("services.account_service.dify_config.RBAC_ENABLED", True),
                patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                patch("services.account_service.workspace_membership_mutation_lock", return_value=nullcontext()),
                patch(
                    "services.account_service.RBACService.MemberRoles.bootstrap_owner",
                    side_effect=bootstrap_owner,
                ),
                patch("services.account_service.tenant_was_created.send") as tenant_created,
            ):
                create = getattr(TenantService, method_name)
                with pytest.raises(EnterpriseAPIError, match="unavailable"):
                    create(account, is_setup=True, session=service_session)

                with sqlite_session_factory() as assertion_session:
                    provisioning_tenant = assertion_session.scalar(
                        select(Tenant)
                        .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                        .where(TenantAccountJoin.account_id == account_id)
                    )
                    assert provisioning_tenant is not None
                    assert provisioning_tenant.status == TenantStatus.PROVISIONING
                    provisioning_tenant_id = provisioning_tenant.id

                tenant = create(account, is_setup=True, session=service_session)

            assert tenant.id == provisioning_tenant_id
            assert tenant.status == TenantStatus.NORMAL
            assert bootstrap_tenant_ids == [provisioning_tenant_id, provisioning_tenant_id]
            assert tenant_created.call_count == 1
            assert tenant_created.call_args.args[0].id == tenant.id

        with sqlite_session_factory() as assertion_session:
            memberships = assertion_session.scalars(
                select(TenantAccountJoin).where(TenantAccountJoin.account_id == account_id)
            ).all()
            assert len(memberships) == 1
            assert memberships[0].tenant_id == provisioning_tenant_id
            assert memberships[0].role == TenantAccountRole.OWNER
            assert memberships[0].current is True

    def test_owner_tenant_creation_retries_activation_commit_on_same_tenant(
        self,
        sqlite_session_factory: sessionmaker[Session],
        mock_rsa_dependencies: MagicMock,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        mock_rsa_dependencies.return_value = "mock_public_key"
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True

        with sqlite_session_factory() as service_session:
            account = Account(name="Commit Retry", email="commit-retry@example.com")
            service_session.add(account)
            service_session.commit()
            account_id = account.id

            failed = False

            def fail_first_activation(commit_session: Session) -> None:
                nonlocal failed
                activating = any(
                    isinstance(value, Tenant) and value.status == TenantStatus.NORMAL for value in commit_session.dirty
                )
                if activating and not failed:
                    failed = True
                    raise RuntimeError("commit failed")

            event.listen(sqlite_session_factory.class_, "before_commit", fail_first_activation)
            try:
                with (
                    patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
                    patch("services.account_service.dify_config.RBAC_ENABLED", True),
                    patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
                    patch("services.account_service.workspace_membership_mutation_lock", return_value=nullcontext()),
                    patch("services.account_service.RBACService.MemberRoles.bootstrap_owner") as bootstrap_owner,
                    patch("services.account_service.tenant_was_created.send") as tenant_created,
                ):
                    with pytest.raises(RuntimeError, match="commit failed"):
                        TenantService.create_owner_tenant(account, is_setup=True, session=service_session)

                    with sqlite_session_factory() as assertion_session:
                        provisioning_tenant = assertion_session.scalar(
                            select(Tenant)
                            .join(TenantAccountJoin, TenantAccountJoin.tenant_id == Tenant.id)
                            .where(TenantAccountJoin.account_id == account_id)
                        )
                        assert provisioning_tenant is not None
                        assert provisioning_tenant.status == TenantStatus.PROVISIONING
                        provisioning_tenant_id = provisioning_tenant.id

                    tenant = TenantService.create_owner_tenant(account, is_setup=True, session=service_session)
            finally:
                event.remove(sqlite_session_factory.class_, "before_commit", fail_first_activation)

            assert tenant.id == provisioning_tenant_id
            assert tenant.status == TenantStatus.NORMAL
            assert bootstrap_owner.call_args_list == [
                call(provisioning_tenant_id, account_id),
                call(provisioning_tenant_id, account_id),
            ]
            assert tenant_created.call_count == 1
            assert tenant_created.call_args.args[0].id == tenant.id

    def test_create_owner_tenant_if_not_exist_repairs_existing_normal_owner(
        self,
        sqlite_session: Session,
    ) -> None:
        account = Account(name="Existing Owner", email="existing-owner@example.com")
        tenant = Tenant(name="Existing Workspace")
        sqlite_session.add_all([account, tenant])
        sqlite_session.flush()
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
                current=True,
            )
        )
        sqlite_session.commit()

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.RBACService.MemberRoles.bootstrap_owner") as bootstrap_owner,
        ):
            result = TenantService.create_owner_tenant_if_not_exist(account, session=sqlite_session)

        assert result.id == tenant.id
        bootstrap_owner.assert_called_once_with(tenant.id, account.id)
        assert sqlite_session.scalar(select(Tenant).where(Tenant.id != tenant.id)) is None

    def test_create_owner_tenant_if_not_exist_refreshes_stale_caller_snapshot(
        self,
        sqlite_session: Session,
    ) -> None:
        account = Account(name="Concurrent Owner", email="concurrent-owner@example.com")
        tenant = Tenant(name="Concurrent Workspace")
        sqlite_session.add_all([account, tenant])
        sqlite_session.flush()
        sqlite_session.add(
            TenantAccountJoin(
                tenant_id=tenant.id,
                account_id=account.id,
                role=TenantAccountRole.OWNER,
                current=True,
            )
        )
        sqlite_session.commit()
        caller_session = MagicMock(spec=Session)
        caller_session.get.side_effect = [None, tenant]

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
        ):
            result = TenantService.create_owner_tenant_if_not_exist(account, session=caller_session)

        assert result is tenant
        caller_session.commit.assert_called_once_with()
        assert caller_session.get.call_count == 2

    def test_owner_tenant_creation_ignores_post_commit_notification_failure(
        self,
        sqlite_session: Session,
        mock_rsa_dependencies: MagicMock,
        mock_external_service_dependencies: _MockDependencies,
    ) -> None:
        account = Account(name="Signal Failure", email="signal-failure@example.com")
        sqlite_session.add(account)
        sqlite_session.commit()
        mock_rsa_dependencies.return_value = "mock_public_key"
        mock_external_service_dependencies["feature_service"].is_workspace_creation_allowed.return_value = True
        mock_external_service_dependencies[
            "feature_service"
        ].get_license.return_value.workspaces.is_available.return_value = True

        with (
            patch("services.credit_pool_service.CreditPoolService.create_default_pool"),
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.tenant_was_created.send", side_effect=RuntimeError("queue unavailable")),
        ):
            tenant = TenantService.create_owner_tenant(account, is_setup=True, session=sqlite_session)
            retried_tenant = TenantService.create_owner_tenant_if_not_exist(account, session=sqlite_session)

        assert tenant.status == TenantStatus.NORMAL
        assert retried_tenant.id == tenant.id

    def test_ensure_member_capacity_counts_members_and_pending_candidates(
        self,
        sqlite_session_factory: sessionmaker[Session],
    ) -> None:
        with sqlite_session_factory.begin() as session:
            tenant = Tenant(name="Workspace")
            member = Account(name="Member", email="capacity-member@example.com")
            pending_one = Account(
                name="Pending One",
                email="capacity-pending-1@example.com",
                status=AccountStatus.PENDING,
            )
            pending_two = Account(
                name="Pending Two",
                email="capacity-pending-2@example.com",
                status=AccountStatus.PENDING,
            )
            closed = Account(
                name="Closed",
                email="capacity-closed@example.com",
                status=AccountStatus.CLOSED,
            )
            session.add_all([tenant, member, pending_one, pending_two, closed])
            session.flush()
            session.add(
                TenantAccountJoin(
                    tenant_id=tenant.id,
                    account_id=member.id,
                    role=TenantAccountRole.NORMAL,
                )
            )
            tenant_id = tenant.id
            pending_one_candidate = {pending_one.id: pending_one.email}
            pending_two_candidate = {pending_two.id: pending_two.email}
            closed_candidate = {closed.id: closed.email}

        features = MagicMock()
        features.members.limit = 2
        with (
            patch("services.account_service.dify_config.DEPLOYMENT_EDITION", DeploymentEdition.CLOUD),
            patch("services.account_service.FeatureService.get_features", return_value=features),
        ):
            TenantService.ensure_member_capacity(tenant_id, pending_one_candidate | closed_candidate)
            with pytest.raises(WorkspaceMembersLimitExceededError):
                TenantService.ensure_member_capacity(tenant_id, pending_one_candidate | pending_two_candidate)

    def test_admin_can_update_admin_member_role(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        """Test admin can update another non-owner member, including an admin."""
        with sqlite_session_factory() as service_session:
            tenant = Tenant(name="Test Workspace")
            mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
            mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
            service_session.add_all([tenant, mock_member, mock_operator])
            service_session.flush()
            target_join = self._add_tenant_account_join(
                service_session, tenant, mock_member.id, TenantAccountRole.ADMIN
            )
            self._add_tenant_account_join(service_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
            service_session.flush()
            tenant_id = tenant.id
            member_id = mock_member.id
            operator_id = mock_operator.id
            target_join_id = target_join.id
            service_session.commit()

        TenantService.update_member_role(tenant_id, member_id, "editor", operator_id)

        with sqlite_session_factory() as assertion_session:
            persisted_target_join = assertion_session.get(TenantAccountJoin, target_join_id)
            assert persisted_target_join is not None
            assert persisted_target_join.role == TenantAccountRole.EDITOR

    def test_admin_cannot_update_owner_member_role(self, sqlite_session: Session) -> None:
        """Test admin cannot update an owner member."""
        tenant = Tenant(name="Test Workspace")
        mock_member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        mock_operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        sqlite_session.add_all([tenant, mock_member, mock_operator])
        sqlite_session.flush()
        self._add_tenant_account_join(sqlite_session, tenant, mock_member.id, TenantAccountRole.OWNER)
        self._add_tenant_account_join(sqlite_session, tenant, mock_operator.id, TenantAccountRole.ADMIN)
        sqlite_session.commit()

        with pytest.raises(NoPermissionError):
            TenantService.update_member_role(tenant.id, mock_member.id, "editor", mock_operator.id)

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
            TenantService.update_member_role(tenant.id, mock_member.id, "owner", mock_operator.id)

    def test_rbac_update_resolves_requested_role(self, sqlite_session: Session) -> None:
        tenant = Tenant(name="Test Workspace")
        member = TestAccountAssociatedDataFactory.create_account_mock(account_id="member-789")
        operator = TestAccountAssociatedDataFactory.create_account_mock(account_id="operator-123")
        sqlite_session.add(tenant)
        sqlite_session.flush()
        self._add_tenant_account_join(sqlite_session, tenant, member.id, TenantAccountRole.NORMAL)
        self._add_tenant_account_join(sqlite_session, tenant, operator.id, TenantAccountRole.OWNER)
        sqlite_session.commit()

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.TenantService.check_member_permission"),
            patch(
                "services.account_service.AccountService._resolve_legacy_role_id",
                return_value="editor-role",
            ) as mock_resolve,
            patch("services.account_service.RBACService.MemberRoles.replace_user_roles") as mock_replace,
        ):
            TenantService.update_member_role(tenant.id, member.id, "editor", operator.id)

        mock_resolve.assert_called_once_with(
            tenant_id=tenant.id,
            account_id=operator.id,
            role=TenantAccountRole.EDITOR,
        )
        mock_replace.assert_called_once_with(
            tenant_id=tenant.id,
            account_id=operator.id,
            member_account_id=member.id,
            role_ids=["editor-role"],
        )

    def test_rbac_owner_transfer_projects_local_owner_and_is_retryable(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            old_owner = TestAccountAssociatedDataFactory.create_account_mock(account_id="old-owner")
            new_owner = TestAccountAssociatedDataFactory.create_account_mock(account_id="new-owner")
            session.add_all([tenant, old_owner, new_owner])
            session.flush()
            old_join = self._add_tenant_account_join(session, tenant, old_owner.id, TenantAccountRole.OWNER)
            new_join = self._add_tenant_account_join(session, tenant, new_owner.id, TenantAccountRole.ADMIN)
            session.commit()
            tenant_id = tenant.id
            old_join_id = old_join.id
            new_join_id = new_join.id

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch(
                "services.account_service.account_workspace_membership_mutation_locks",
                return_value=nullcontext(),
            ),
            patch("services.account_service.RBACService.MemberRoles.transfer_owner") as transfer_owner,
        ):
            for _ in range(2):
                TenantService.update_member_role(
                    tenant_id,
                    "new-owner",
                    "owner",
                    "old-owner",
                    allow_owner_transfer=True,
                )

        assert transfer_owner.call_args_list == [
            call(tenant_id, "old-owner", "new-owner"),
            call(tenant_id, "old-owner", "new-owner"),
        ]
        with sqlite_session_factory() as session:
            assert (
                session.scalar(select(TenantAccountJoin.role).where(TenantAccountJoin.id == old_join_id))
                == TenantAccountRole.NORMAL
            )
            assert (
                session.scalar(select(TenantAccountJoin.role).where(TenantAccountJoin.id == new_join_id))
                == TenantAccountRole.OWNER
            )

    def test_rbac_owner_transfer_remote_failure_keeps_local_owner(
        self, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            old_owner = TestAccountAssociatedDataFactory.create_account_mock(account_id="old-owner")
            new_owner = TestAccountAssociatedDataFactory.create_account_mock(account_id="new-owner")
            session.add_all([tenant, old_owner, new_owner])
            session.flush()
            old_join = self._add_tenant_account_join(session, tenant, old_owner.id, TenantAccountRole.OWNER)
            new_join = self._add_tenant_account_join(session, tenant, new_owner.id, TenantAccountRole.NORMAL)
            session.commit()
            tenant_id = tenant.id
            old_join_id = old_join.id
            new_join_id = new_join.id

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch(
                "services.account_service.account_workspace_membership_mutation_locks",
                return_value=nullcontext(),
            ),
            patch(
                "services.account_service.RBACService.MemberRoles.transfer_owner",
                side_effect=EnterpriseAPIError("unavailable", status_code=503),
            ),
            pytest.raises(EnterpriseAPIError),
        ):
            TenantService.update_member_role(
                tenant_id,
                "new-owner",
                "owner",
                "old-owner",
                allow_owner_transfer=True,
            )

        with sqlite_session_factory() as session:
            assert (
                session.scalar(select(TenantAccountJoin.role).where(TenantAccountJoin.id == old_join_id))
                == TenantAccountRole.OWNER
            )
            assert (
                session.scalar(select(TenantAccountJoin.role).where(TenantAccountJoin.id == new_join_id))
                == TenantAccountRole.NORMAL
            )

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

    def test_rbac_member_can_remove_non_owner_member(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        events: list[str] = []

        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            operator = Account(name="Owner", email="rbac-owner@example.com")
            member = Account(name="Member", email="rbac-member@example.com")
            session.add_all([tenant, operator, member])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            self._add_tenant_account_join(session, tenant, member.id, TenantAccountRole.NORMAL)
            session.commit()
            tenant_id, operator_id, member_id = tenant.id, operator.id, member.id

        def fail_delete_bindings(*_args) -> None:
            events.append("delete_bindings")
            raise RuntimeError("authorized")

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.account_workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.require_tenant_members"),
            patch(
                "services.account_service.AccountService.get_workspace_permission_keys",
                return_value={"workspace.member.manage"},
            ),
            patch(
                "services.account_service.AccountService.get_rbac_workspace_owner_account_id",
                return_value=operator_id,
            ),
            patch.object(
                RegisterService,
                "invalidate_member_invitation",
                side_effect=lambda *_args: events.append("invalidate"),
            ),
            patch(
                "services.account_service.RBACService.MemberRoles.delete_rbac_bindings",
                side_effect=fail_delete_bindings,
            ) as delete_bindings,
            pytest.raises(RuntimeError, match="authorized"),
        ):
            TenantService.remove_member_from_tenant(tenant_id, member_id, operator_id)

        delete_bindings.assert_called_once_with(tenant_id, operator_id, member_id)
        assert events == ["invalidate", "delete_bindings"]

    def test_rbac_member_cannot_remove_without_permission(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            operator = Account(name="Owner", email="rbac-owner-2@example.com")
            member = Account(name="Member", email="rbac-member-2@example.com")
            session.add_all([tenant, operator, member])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            self._add_tenant_account_join(session, tenant, member.id, TenantAccountRole.NORMAL)
            session.commit()
            tenant_id, operator_id, member_id = tenant.id, operator.id, member.id

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.account_workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.require_tenant_members"),
            patch(
                "services.account_service.AccountService.get_workspace_permission_keys",
                return_value={"workspace.role.manage"},
            ),
            patch("services.account_service.RBACService.MemberRoles.delete_rbac_bindings") as delete_bindings,
            pytest.raises(NoPermissionError),
        ):
            TenantService.remove_member_from_tenant(tenant_id, member_id, operator_id)

        delete_bindings.assert_not_called()

    def test_rbac_member_cannot_remove_owner_member(self, sqlite_session_factory: sessionmaker[Session]) -> None:
        with sqlite_session_factory() as session:
            tenant = Tenant(name="Workspace")
            operator = Account(name="Owner", email="rbac-owner-3@example.com")
            member = Account(name="Member", email="rbac-member-3@example.com")
            session.add_all([tenant, operator, member])
            session.flush()
            self._add_tenant_account_join(session, tenant, operator.id, TenantAccountRole.OWNER)
            self._add_tenant_account_join(session, tenant, member.id, TenantAccountRole.NORMAL)
            session.commit()
            tenant_id, operator_id, member_id = tenant.id, operator.id, member.id

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch("services.account_service.account_workspace_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.require_tenant_members"),
            patch(
                "services.account_service.AccountService.get_workspace_permission_keys",
                return_value={"workspace.member.manage"},
            ),
            patch(
                "services.account_service.AccountService.get_rbac_workspace_owner_account_id",
                return_value=member_id,
            ),
            patch("services.account_service.RBACService.MemberRoles.delete_rbac_bindings") as delete_bindings,
            pytest.raises(NoPermissionError),
        ):
            TenantService.remove_member_from_tenant(tenant_id, member_id, operator_id)

        delete_bindings.assert_not_called()

    def test_get_rbac_workspace_owner_account_id(self, sqlite_session: Session) -> None:
        sqlite_session.add(
            TenantAccountJoin(tenant_id="tenant-1", account_id="owner-account", role=TenantAccountRole.OWNER)
        )
        sqlite_session.commit()
        remote_owners = Paginated[MembersInRole](data=[MembersInRole(account_id="owner-account")])

        with (
            patch(
                "services.account_service.AccountService._resolve_legacy_role_id",
                return_value="owner-role",
            ),
            patch("services.account_service.RBACService.Roles.members", return_value=remote_owners) as mock_members,
        ):
            owner_account_id = AccountService.get_rbac_workspace_owner_account_id("tenant-1")

        assert owner_account_id == "owner-account"
        assert not sqlite_session.in_transaction()
        call = mock_members.call_args.kwargs
        assert call["tenant_id"] == "tenant-1"
        assert call["account_id"] is None
        assert call["role_id"] == "owner-role"
        assert call["options"].results_per_page == 2


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

    @staticmethod
    def _persist_on_register(account: Account) -> Callable[..., Account]:
        def register(*_args: object, session: Session, **_kwargs: object) -> Account:
            session.add(account)
            session.commit()
            return account

        return register

    def test_invitation_lock_rejects_concurrent_invitation(self) -> None:
        lock = MagicMock()
        lock.acquire.return_value = False
        with (
            patch("services.account_service.redis_client.lock", return_value=lock) as create_lock,
            pytest.raises(Conflict),
        ):
            with _invitation_lock("invite:test", timeout=123):
                pass

        create_lock.assert_called_once_with("invite:test", timeout=123)
        lock.acquire.assert_called_once_with(
            blocking=True,
            blocking_timeout=dify_config.ENTERPRISE_REQUEST_TIMEOUT,
        )
        lock.release.assert_not_called()

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
            patch("services.account_service.TenantService.create_owner_tenant") as mock_create_tenant,
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
            patch("services.account_service.TenantService.create_owner_tenant") as mock_create_tenant,
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
            patch("services.account_service.TenantService.create_owner_tenant") as mock_create_workspace,
        ):
            mock_create_account.return_value = mock_account
            mock_create_workspace.return_value = Tenant(name="Test User's Workspace")

            result = RegisterService.register(
                email="test@example.com",
                name="Test User",
                password=None,
                open_id="oauth123",
                provider="google",
                language="en-US",
                session=sqlite_session,
            )

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
        with (
            patch("services.account_service.AccountService.create_account") as mock_create_account,
            patch("services.account_service.TenantService.create_owner_tenant") as mock_create_workspace,
        ):
            mock_create_account.return_value = mock_account
            mock_create_workspace.return_value = Tenant(name="Test User's Workspace")

            result = RegisterService.register(
                email="test@example.com",
                name="Test User",
                password="password123",
                language="en-US",
                status=AccountStatus.PENDING,
                session=sqlite_session,
            )

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

            with patch("services.account_service.TenantService.create_owner_tenant") as mock_create_tenant:
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

    def test_invite_new_member_normalizes_new_account_email(
        self, sqlite_session: Session, mock_task_dependencies: MagicMock
    ) -> None:
        """Ensure inviting with mixed-case email normalizes before registering."""
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()
        mixed_email = "Invitee@Example.com"

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = None

            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="new-user-789", email="invitee@example.com", name="invitee", status="pending"
            )
            with patch(
                "services.account_service.RegisterService.register",
                side_effect=self._persist_on_register(mock_new_account),
            ) as mock_register:
                with (
                    patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                    patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
                ):
                    mock_generate_token.return_value = "invite-token-abc"

                    result = RegisterService.invite_new_member(
                        tenant_id=mock_tenant.id,
                        email=mixed_email,
                        language="en-US",
                        role="normal",
                        inviter_id=mock_inviter.id,
                    )

                    assert result == "invite-token-abc"
                    mock_register.assert_called_once_with(
                        email="invitee@example.com",
                        name="invitee",
                        language="en-US",
                        status=AccountStatus.PENDING,
                        is_setup=True,
                        create_workspace_required=False,
                        auto_join_default_workspace=False,
                        session=ANY,
                    )
                    assert mock_lookup.call_count == 2
                    assert mock_check_permission.call_count == 2
                    mock_generate_token.assert_called_once_with(
                        tenant_id=mock_tenant.id,
                        account_id=mock_new_account.id,
                        email=mock_new_account.email,
                        role="normal",
                        rbac_role_id=None,
                        inviter_id=mock_inviter.id,
                    )
                    mock_task_dependencies.delay.assert_called_once()
                    assert sqlite_session.scalar(select(TenantAccountJoin)) is None

    def test_invite_new_member_existing_account(
        self, sqlite_session: Session, mock_task_dependencies: MagicMock
    ) -> None:
        """Test inviting a pending account that is not in the tenant yet."""
        # Setup test data
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test Workspace"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="pending"
        )
        sqlite_session.add(mock_existing_account)
        sqlite_session.commit()

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
        ):
            mock_lookup.return_value = mock_existing_account

            # Mock TenantService methods
            with (
                patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
            ):
                mock_generate_token.return_value = "invite-token-123"

                # Execute test
                result = RegisterService.invite_new_member(
                    tenant_id=mock_tenant.id,
                    email="existing@example.com",
                    language="en-US",
                    role="normal",
                    inviter_id=mock_inviter.id,
                )

                # Verify results
                assert result == "invite-token-123"
                mock_generate_token.assert_called_once_with(
                    tenant_id=mock_tenant.id,
                    account_id=mock_existing_account.id,
                    email=mock_existing_account.email,
                    role="normal",
                    rbac_role_id=None,
                    inviter_id=mock_inviter.id,
                )
                mock_task_dependencies.delay.assert_called_once()
                mock_lookup.assert_called_once_with("existing@example.com", session=ANY)
                assert sqlite_session.scalar(select(TenantAccountJoin)) is None

    def test_invite_existing_active_account_requires_acceptance_before_joining(
        self, sqlite_session: Session, mock_task_dependencies: MagicMock
    ) -> None:
        """Existing active accounts outside the tenant receive an invite without immediate membership."""
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-456"
        mock_tenant.name = "Test Workspace"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="active"
        )
        sqlite_session.add(mock_existing_account)
        sqlite_session.commit()

        with patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup:
            mock_lookup.return_value = mock_existing_account

            with (
                patch("services.account_service.TenantService.check_member_permission") as mock_check_permission,
                patch("services.account_service.RegisterService.generate_invite_token") as mock_generate_token,
            ):
                mock_generate_token.return_value = "invite-token-123"

                result = RegisterService.invite_new_member(
                    tenant_id=mock_tenant.id,
                    email="existing@example.com",
                    language="en-US",
                    role="admin",
                    inviter_id=mock_inviter.id,
                )

                assert result == "invite-token-123"
                assert mock_check_permission.call_count == 2
                mock_generate_token.assert_called_once_with(
                    tenant_id=mock_tenant.id,
                    account_id=mock_existing_account.id,
                    email=mock_existing_account.email,
                    role="admin",
                    rbac_role_id=None,
                    inviter_id=mock_inviter.id,
                )
                mock_task_dependencies.delay.assert_called_once()
                assert sqlite_session.scalar(select(TenantAccountJoin)) is None

    @pytest.mark.parametrize(
        "account_status",
        [AccountStatus.BANNED, AccountStatus.CLOSED, AccountStatus.UNINITIALIZED],
    )
    def test_invite_rejects_non_activatable_account_before_side_effects(
        self,
        sqlite_session: Session,
        mock_task_dependencies: MagicMock,
        config_overrides: Callable[..., None],
        account_status: AccountStatus,
    ) -> None:
        config_overrides(
            RBAC_ENABLED=False,
            ENTERPRISE_RBAC_REQUEST_TIMEOUT=5,
            ENTERPRISE_REQUEST_TIMEOUT=7,
        )
        tenant = _tenant(sqlite_session)
        tenant.id = "tenant-456"
        inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="ineligible-user",
            email="ineligible@example.com",
            status=account_status,
        )
        sqlite_session.add_all([inviter, account])
        sqlite_session.commit()

        with (
            patch("libs.workspace_permission.check_workspace_member_invite_permission"),
            patch("services.account_service._invitation_lock", return_value=nullcontext()) as invitation_lock,
            patch(
                "services.account_service.AccountService.get_account_by_email_with_case_fallback",
                return_value=account,
            ),
            patch("services.account_service.TenantService.check_member_permission"),
            patch("services.account_service.RegisterService.generate_invite_token") as generate_token,
            pytest.raises(AccountRegisterError, match="not eligible"),
        ):
            RegisterService.invite_new_member(
                tenant_id=tenant.id,
                email=account.email,
                language="en-US",
                inviter_id=inviter.id,
            )

        generate_token.assert_not_called()
        mock_task_dependencies.delay.assert_not_called()
        invitation_lock.assert_called_once_with(ANY, timeout=2 * 5 + 7 + 60)
        assert sqlite_session.scalar(select(TenantAccountJoin)) is None

    def test_invite_new_member_already_in_tenant(self, sqlite_session: Session) -> None:
        """Test inviting a member who is already in the tenant."""
        # Setup test data
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-456"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-123", name="Inviter")
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-user-456", email="existing@example.com", status="active"
        )

        sqlite_session.add_all(
            [
                mock_inviter,
                mock_existing_account,
                TenantAccountJoin(
                    tenant_id=mock_tenant.id,
                    account_id=mock_existing_account.id,
                    role=TenantAccountRole.NORMAL,
                ),
            ]
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
                    tenant_id=mock_tenant.id,
                    email="existing@example.com",
                    language="en-US",
                    role="normal",
                    inviter_id=mock_inviter.id,
                )
            mock_lookup.assert_called_once()

    def test_invite_new_member_no_inviter(self) -> None:
        """Test inviting a member without providing an inviter."""
        # Setup test data
        mock_tenant = _tenant()

        # Execute test and verify exception
        with pytest.raises(ValueError):
            RegisterService.invite_new_member(
                tenant_id=mock_tenant.id,
                email="test@example.com",
                language="en-US",
                role="normal",
                inviter_id=None,
            )

    def test_enterprise_invite_rechecks_local_account_count_inside_creation_lock(self, sqlite_session: Session) -> None:
        tenant = _tenant(sqlite_session)
        tenant.id = "tenant-789"
        inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456")
        sqlite_session.add(inviter)
        sqlite_session.commit()
        seats = MagicMock(enabled=True, limit=1, size=0)
        license = MagicMock(seats=seats)

        with (
            patch("libs.workspace_permission.check_workspace_member_invite_permission"),
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch(
                "services.account_service.dify_config.DEPLOYMENT_EDITION",
                DeploymentEdition.ENTERPRISE,
            ),
            patch("services.account_service.FeatureService.get_license", return_value=license),
            patch("services.account_service.TenantService.check_member_permission"),
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback", return_value=None),
            patch(
                "services.account_service._invitation_lock",
                side_effect=lambda *_args, **_kwargs: nullcontext(),
            ),
            patch("services.account_service.RegisterService.register") as register,
            pytest.raises(SeatsLimitExceededError),
        ):
            RegisterService.invite_new_member(
                tenant_id=tenant.id,
                email="new@example.com",
                language="en-US",
                inviter_id=inviter.id,
            )

        register.assert_not_called()

    def test_legacy_invite_removes_created_pending_account_when_second_permission_check_fails(
        self, sqlite_session: Session
    ) -> None:
        tenant = _tenant(sqlite_session)
        tenant.id = "tenant-789"
        inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456")
        sqlite_session.add(inviter)
        sqlite_session.commit()
        account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="new-user",
            email="new@example.com",
            status=AccountStatus.PENDING,
        )

        with (
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch(
                "services.account_service.dify_config.DEPLOYMENT_EDITION",
                DeploymentEdition.COMMUNITY,
            ),
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback", return_value=None),
            patch(
                "services.account_service.RegisterService.register",
                side_effect=self._persist_on_register(account),
            ),
            patch(
                "services.account_service.TenantService.check_member_permission",
                side_effect=[None, NoPermissionError("permission changed")],
            ),
            patch(
                "services.account_service._invitation_lock",
                side_effect=lambda *_args, **_kwargs: nullcontext(),
            ),
            patch("services.account_service.account_membership_mutation_lock", return_value=nullcontext()),
            patch("services.account_service.RegisterService.generate_invite_token") as generate_token,
            pytest.raises(NoPermissionError, match="permission changed"),
        ):
            RegisterService.invite_new_member(
                tenant_id=tenant.id,
                email=account.email,
                language="en-US",
                inviter_id=inviter.id,
            )

        sqlite_session.expire_all()
        assert sqlite_session.get(Account, account.id) is None
        generate_token.assert_not_called()

    def test_invite_rbac_requires_role_manage_before_account_lookup(self) -> None:
        with (
            patch("libs.workspace_permission.check_workspace_member_invite_permission"),
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch(
                "services.account_service.AccountService.get_workspace_permission_keys",
                return_value={"workspace.member.manage"},
            ),
            patch("services.account_service.require_tenant_members") as mock_require,
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            patch("services.account_service.RBACService.MemberRoles.ensure_role_assignable") as mock_roles,
            pytest.raises(NoPermissionError),
        ):
            RegisterService.invite_new_member(
                tenant_id="tenant-789",
                email="rbac@example.com",
                language="en-US",
                role="rbac-role-id",
                inviter_id="inviter-456",
            )

        mock_require.assert_called_once_with("tenant-789", ["inviter-456"])
        mock_lookup.assert_not_called()
        mock_roles.assert_not_called()

    def test_invite_rbac_rejects_nonmember_inviter_before_permission_lookup(self) -> None:
        with (
            patch("libs.workspace_permission.check_workspace_member_invite_permission"),
            patch("services.account_service.dify_config.RBAC_ENABLED", True),
            patch(
                "services.account_service.require_tenant_members",
                side_effect=MemberNotInTenantError("Member not in tenant."),
            ),
            patch("services.account_service.AccountService.get_workspace_permission_keys") as mock_permissions,
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup,
            pytest.raises(MemberNotInTenantError),
        ):
            RegisterService.invite_new_member(
                tenant_id="tenant-789",
                email="rbac@example.com",
                language="en-US",
                role="rbac-role-id",
                inviter_id="foreign-account",
            )

        mock_permissions.assert_not_called()
        mock_lookup.assert_not_called()

    # ==================== RBAC Member Invitation Tests ====================

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_rbac_enabled_new_account(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """RBAC invitations defer membership and role assignment until activation."""
        config_overrides(RBAC_ENABLED=True)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()
        with patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup:
            mock_lookup.return_value = None

            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="new-user-rbac", email="rbac@example.com", name="rbacuser", status="pending"
            )
            with (
                patch(
                    "services.account_service.RegisterService.register",
                    side_effect=self._persist_on_register(mock_new_account),
                ) as mock_register,
                patch(
                    "services.account_service.RegisterService.generate_invite_token",
                    return_value="rbac-token",
                ) as generate_token,
                patch(
                    "services.account_service.AccountService.get_workspace_permission_keys",
                    return_value={"workspace.member.manage", "workspace.role.manage"},
                ),
                patch("services.account_service.require_tenant_members"),
                patch("services.account_service.RBACService.MemberRoles.ensure_role_assignable"),
                patch(
                    "services.account_service._invitation_lock",
                    side_effect=lambda *_args, **_kwargs: nullcontext(),
                ),
            ):
                result = RegisterService.invite_new_member(
                    tenant_id=mock_tenant.id,
                    email="rbac@example.com",
                    language="en-US",
                    role="rbac-role-id-123",
                    inviter_id=mock_inviter.id,
                )

                assert result == "rbac-token"
                generate_token.assert_called_once_with(
                    tenant_id=mock_tenant.id,
                    account_id=mock_new_account.id,
                    email=mock_new_account.email,
                    role="rbac-role-id-123",
                    rbac_role_id="rbac-role-id-123",
                    inviter_id=mock_inviter.id,
                )
                assert sqlite_session.scalar(select(TenantAccountJoin)) is None
                mock_register.assert_called_once_with(
                    email="rbac@example.com",
                    name="rbac",
                    language="en-US",
                    status=AccountStatus.PENDING,
                    is_setup=True,
                    create_workspace_required=False,
                    auto_join_default_workspace=False,
                    session=ANY,
                )

    def test_invite_mail_failure_revokes_token_and_removes_new_pending_account(
        self,
        sqlite_session: Session,
        config_overrides: Callable[..., None],
        mock_task_dependencies: MagicMock,
    ) -> None:
        config_overrides(RBAC_ENABLED=True)
        tenant = _tenant(sqlite_session)
        tenant.id = "tenant-789"
        inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        sqlite_session.add(inviter)
        sqlite_session.commit()
        account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="new-user-rbac",
            email="rbac@example.com",
            status=AccountStatus.PENDING,
        )
        mock_task_dependencies.delay.side_effect = RuntimeError("mail unavailable")
        invitation_lock_held = False

        @contextmanager
        def tracked_invitation_lock(*_args, **_kwargs) -> Generator[None]:
            nonlocal invitation_lock_held
            invitation_lock_held = True
            try:
                yield
            finally:
                invitation_lock_held = False

        @contextmanager
        def cleanup_account_lock(*_args, **_kwargs) -> Generator[None]:
            assert invitation_lock_held
            yield

        with (
            patch("services.account_service.AccountService.get_account_by_email_with_case_fallback", return_value=None),
            patch(
                "services.account_service.RegisterService.register",
                side_effect=self._persist_on_register(account),
            ),
            patch(
                "services.account_service.AccountService.get_workspace_permission_keys",
                return_value={"workspace.member.manage", "workspace.role.manage"},
            ),
            patch("services.account_service.require_tenant_members"),
            patch("services.account_service.RBACService.MemberRoles.ensure_role_assignable"),
            patch(
                "services.account_service._invitation_lock",
                side_effect=tracked_invitation_lock,
            ),
            patch("services.account_service.account_membership_mutation_lock", side_effect=cleanup_account_lock),
            patch(
                "services.account_service.RegisterService.generate_invite_token",
                return_value="rbac-token",
            ),
            patch("services.account_service.RegisterService.revoke_token") as revoke_token,
            pytest.raises(RuntimeError, match="mail unavailable"),
        ):
            RegisterService.invite_new_member(
                tenant_id=tenant.id,
                email=account.email,
                language="en-US",
                role="rbac-role-id-123",
                inviter_id=inviter.id,
            )

        sqlite_session.expire_all()
        assert sqlite_session.get(Account, "new-user-rbac") is None
        assert not invitation_lock_held
        revoke_token.assert_called_once_with("rbac-token")

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_rbac_enabled_existing_account(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """A pending pre-existing membership can be re-invited without mutation."""
        config_overrides(RBAC_ENABLED=True)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status="pending"
        )
        membership = TenantAccountJoin(
            tenant_id=mock_tenant.id,
            account_id=mock_existing_account.id,
            role=TenantAccountRole.NORMAL,
            invited_by="original-inviter",
        )
        sqlite_session.add_all([mock_existing_account, membership])
        sqlite_session.commit()

        with patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup:
            mock_lookup.return_value = mock_existing_account

            with (
                patch(
                    "services.account_service.RegisterService.generate_invite_token",
                    return_value="rbac-token",
                ) as generate_token,
                patch(
                    "services.account_service.AccountService.get_workspace_permission_keys",
                    return_value={"workspace.member.manage", "workspace.role.manage"},
                ),
                patch("services.account_service.require_tenant_members"),
                patch("services.account_service.RBACService.MemberRoles.ensure_role_assignable"),
                patch(
                    "services.account_service._invitation_lock",
                    side_effect=lambda *_args, **_kwargs: nullcontext(),
                ),
            ):
                result = RegisterService.invite_new_member(
                    tenant_id=mock_tenant.id,
                    email="existing-rbac@example.com",
                    language="en-US",
                    role="rbac-role-id-456",
                    inviter_id=mock_inviter.id,
                )

                assert result == "rbac-token"
                generate_token.assert_called_once_with(
                    tenant_id=mock_tenant.id,
                    account_id=mock_existing_account.id,
                    email=mock_existing_account.email,
                    role="rbac-role-id-456",
                    rbac_role_id="rbac-role-id-456",
                    inviter_id=mock_inviter.id,
                )
                sqlite_session.refresh(membership)
                assert membership.role == TenantAccountRole.NORMAL
                assert membership.invited_by == "original-inviter"

    def test_invite_new_member_rbac_enabled_existing_active_account_defers_join_until_acceptance(
        self,
        sqlite_session: Session,
        mock_task_dependencies: MagicMock,
        config_overrides: Callable[..., None],
    ) -> None:
        """Active accounts receive a token carrying the role but no membership before acceptance."""
        config_overrides(RBAC_ENABLED=True)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-789"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-456", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()
        mock_existing_account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="existing-rbac", email="existing-rbac@example.com", status=AccountStatus.ACTIVE
        )
        sqlite_session.add(mock_existing_account)
        sqlite_session.commit()

        with patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup:
            mock_lookup.return_value = mock_existing_account

            with (
                patch(
                    "services.account_service.AccountService.get_workspace_permission_keys",
                    return_value={"workspace.member.manage", "workspace.role.manage"},
                ),
                patch("services.account_service.require_tenant_members"),
                patch("services.account_service.RBACService.MemberRoles.ensure_role_assignable"),
                patch(
                    "services.account_service.RegisterService.generate_invite_token",
                    return_value="rbac-token",
                ) as mock_generate_token,
            ):
                result = RegisterService.invite_new_member(
                    tenant_id=mock_tenant.id,
                    email="existing-rbac@example.com",
                    language="en-US",
                    role="rbac-role-id-456",
                    inviter_id=mock_inviter.id,
                )

                assert result == "rbac-token"
                mock_generate_token.assert_called_once_with(
                    tenant_id=mock_tenant.id,
                    account_id=mock_existing_account.id,
                    email=mock_existing_account.email,
                    role="rbac-role-id-456",
                    rbac_role_id="rbac-role-id-456",
                    inviter_id=mock_inviter.id,
                )
                mock_task_dependencies.delay.assert_called_once()

    @pytest.mark.usefixtures("mock_task_dependencies")
    def test_invite_new_member_rbac_disabled_uses_legacy_role(
        self, sqlite_session: Session, config_overrides: Callable[..., None]
    ) -> None:
        """Legacy invitations persist the requested role only in the token."""
        config_overrides(RBAC_ENABLED=False)
        mock_tenant = _tenant(sqlite_session)
        mock_tenant.id = "tenant-legacy"
        mock_inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-789", name="Inviter")
        sqlite_session.add(mock_inviter)
        sqlite_session.commit()

        with patch("services.account_service.AccountService.get_account_by_email_with_case_fallback") as mock_lookup:
            mock_lookup.return_value = None

            mock_new_account = TestAccountAssociatedDataFactory.create_account_mock(
                account_id="legacy-user", email="legacy@example.com", name="legacyuser", status="pending"
            )
            with (
                patch(
                    "services.account_service.RegisterService.register",
                    side_effect=self._persist_on_register(mock_new_account),
                ) as mock_register,
                patch("services.account_service.TenantService.check_member_permission"),
                patch(
                    "services.account_service.RegisterService.generate_invite_token",
                    return_value="legacy-token",
                ) as generate_token,
            ):
                result = RegisterService.invite_new_member(
                    tenant_id=mock_tenant.id,
                    email="legacy@example.com",
                    language="en-US",
                    role="editor",
                    inviter_id=mock_inviter.id,
                )

                assert result == "legacy-token"
                generate_token.assert_called_once_with(
                    tenant_id=mock_tenant.id,
                    account_id=mock_new_account.id,
                    email=mock_new_account.email,
                    role="editor",
                    rbac_role_id=None,
                    inviter_id=mock_inviter.id,
                )
                assert mock_lookup.call_count == 2
                mock_register.assert_called_once_with(
                    email="legacy@example.com",
                    name="legacy",
                    language="en-US",
                    status=AccountStatus.PENDING,
                    is_setup=True,
                    create_workspace_required=False,
                    auto_join_default_workspace=False,
                    session=ANY,
                )
                assert sqlite_session.scalar(select(TenantAccountJoin)) is None

    # ==================== Token Management Tests ====================

    def test_generate_invite_token_success(self, mock_redis_dependencies: MagicMock) -> None:
        """Test successful invite token generation."""
        account = TestAccountAssociatedDataFactory.create_account_mock(account_id="user-123")
        inviter = TestAccountAssociatedDataFactory.create_account_mock(account_id="inviter-789")
        tenant = Tenant(name="Test Workspace")
        tenant.id = "tenant-456"
        session = MagicMock(spec=Session)
        session.get.return_value = tenant
        with (
            patch("services.account_service.uuid.uuid4") as mock_uuid,
            patch("services.account_service.dify_config.RBAC_ENABLED", False),
            patch(
                "services.account_service.account_workspace_membership_mutation_lock",
                return_value=nullcontext(),
            ) as lock,
            patch("services.account_service.session_factory.create_session", return_value=nullcontext(session)),
            patch(
                "services.account_service.TenantService.get_membership_eligible_account",
                side_effect=[account, inviter],
            ),
            patch("services.account_service.TenantService.check_member_permission"),
            patch("services.account_service.TenantService.account_belongs_to_tenant", return_value=False),
            patch.object(
                RegisterService,
                "list_for_workspace",
                return_value=(
                    WorkspaceInvitationRecord(
                        account_id="already-invited",
                        email="pending@example.com",
                        legacy_role="normal",
                    ),
                ),
            ),
            patch("services.account_service.TenantService.ensure_member_capacity") as ensure_capacity,
        ):
            mock_uuid.return_value = "test-uuid-123"
            mock_redis_dependencies.get.return_value = None

            result = RegisterService.generate_invite_token(
                tenant_id="tenant-456",
                account_id="user-123",
                email="test@example.com",
                role="admin",
                rbac_role_id="role-456",
                inviter_id="inviter-789",
            )

            # Verify results
            assert result == "test-uuid-123"
            lock.assert_called_once_with("user-123", "tenant-456")
            ensure_capacity.assert_called_once_with(
                "tenant-456",
                {
                    "already-invited": "pending@example.com",
                    "user-123": "test@example.com",
                },
            )
            mock_redis_dependencies.pipeline.assert_called_once_with(transaction=True)
            pipeline = mock_redis_dependencies.pipeline.return_value
            assert pipeline.setex.call_count == 2

            # Verify the stored data
            call_args = pipeline.setex.call_args_list[0]
            assert call_args[0][0] == "member_invite:{invitation}:token:test-uuid-123"
            stored_data = json.loads(call_args[0][2])
            assert stored_data["account_id"] == "user-123"
            assert stored_data["email"] == "test@example.com"
            assert stored_data["workspace_id"] == "tenant-456"
            assert stored_data["role"] == "admin"
            assert stored_data["rbac_role_id"] == "role-456"
            assert stored_data["inviter_id"] == "inviter-789"
            pipeline.setex.assert_has_calls(
                [
                    call(
                        "member_invite:{invitation}:current:tenant-456:user-123",
                        dify_config.INVITE_EXPIRY_HOURS * 60 * 60,
                        "test-uuid-123",
                    )
                ]
            )
            pipeline.hset.assert_has_calls(
                [
                    call("member_invite:{invitation}:workspace:tenant-456", "user-123", "test-uuid-123"),
                    call("member_invite:{invitation}:account:user-123", "tenant-456", "test-uuid-123"),
                ]
            )
            assert pipeline.expire.call_count == 2
            pipeline.execute.assert_called_once_with()
            assert key_slot(call_args[0][0].encode()) == key_slot(
                b"member_invite:{invitation}:current:tenant-456:user-123"
            )
            assert key_slot(call_args[0][0].encode()) == key_slot(b"member_invite:{invitation}:workspace:tenant-456")

    def test_revoke_token_atomically_deletes_authoritative_invitation(self, mock_redis_dependencies: MagicMock) -> None:
        mock_redis_dependencies.get.return_value = json.dumps(
            {
                "account_id": "account-123",
                "email": "invitee@example.com",
                "workspace_id": "workspace-123",
                "role": "normal",
                "inviter_id": "inviter-123",
            }
        )
        mock_redis_dependencies.eval.return_value = 1

        RegisterService.revoke_token("token-123")

        mock_redis_dependencies.eval.assert_called_once()
        assert mock_redis_dependencies.eval.call_args.args[1:6] == (
            4,
            "member_invite:{invitation}:current:workspace-123:account-123",
            "member_invite:{invitation}:token:token-123",
            "member_invite:{invitation}:workspace:workspace-123",
            "member_invite:{invitation}:account:account-123",
        )
        mock_redis_dependencies.delete.assert_not_called()

    def test_invalidate_member_invitation_deletes_token_pointer_and_indexes(
        self, mock_redis_dependencies: MagicMock
    ) -> None:
        mock_redis_dependencies.get.return_value = b"token-123"
        mock_redis_dependencies.eval.return_value = 1

        RegisterService.invalidate_member_invitation("workspace-123", "account-123")

        mock_redis_dependencies.eval.assert_called_once()

    def test_list_for_workspace_returns_current_invitations_and_cleans_stale_index(
        self, mock_redis_dependencies: MagicMock
    ) -> None:
        mock_redis_dependencies.hgetall.return_value = {
            b"account-123": b"current-token",
            b"stale-account": b"stale-token",
        }
        invitation: InvitationData = {
            "account_id": "account-123",
            "email": "invitee@example.com",
            "workspace_id": "workspace-123",
            "role": "admin",
            "inviter_id": "inviter-123",
        }
        with patch.object(RegisterService, "get_invitation_by_token", side_effect=[invitation, None]):
            result = RegisterService.list_for_workspace("workspace-123")

        assert result == (
            WorkspaceInvitationRecord(
                account_id="account-123",
                email="invitee@example.com",
                legacy_role="admin",
            ),
        )
        mock_redis_dependencies.eval.assert_called_once()

    def test_current_invitation_rejects_superseded_pointer(self) -> None:
        invitation: InvitationData = {
            "account_id": "account-123",
            "email": "invitee@example.com",
            "workspace_id": "workspace-123",
            "role": "normal",
            "inviter_id": "inviter-123",
        }
        account = TestAccountAssociatedDataFactory.create_account_mock(
            account_id="account-123",
            email="invitee@example.com",
        )
        tenant = Tenant(name="Test Workspace")
        tenant.id = "workspace-123"
        session = MagicMock(spec=Session)
        session.get.return_value = tenant
        with (
            patch(
                "services.account_service.account_workspace_membership_mutation_lock",
                return_value=nullcontext(),
            ) as lock,
            patch("services.account_service.session_factory.create_session", return_value=nullcontext(session)),
            patch(
                "services.account_service.TenantService.get_membership_eligible_account",
                return_value=account,
            ),
            patch.object(RegisterService, "get_invitation_by_token", return_value=None) as lookup,
            RegisterService.current_invitation("old-token", invitation) as is_current,
        ):
            assert is_current is False

        lock.assert_called_once_with("account-123", "workspace-123")
        lookup.assert_called_once_with("old-token")

    def test_current_invitation_rejects_closed_account_after_lock(self) -> None:
        invitation: InvitationData = {
            "account_id": "account-123",
            "email": "invitee@example.com",
            "workspace_id": "workspace-123",
            "role": "normal",
            "inviter_id": "inviter-123",
        }
        session = MagicMock(spec=Session)
        session.get.return_value = Tenant(name="Test Workspace")
        locked = False

        @contextmanager
        def tracked_lock(*_ids: str) -> Generator[None]:
            nonlocal locked
            locked = True
            yield

        def closed_account(*_args, **_kwargs) -> None:
            assert locked

        with (
            patch("services.account_service.account_workspace_membership_mutation_lock", tracked_lock),
            patch("services.account_service.session_factory.create_session", return_value=nullcontext(session)),
            patch(
                "services.account_service.TenantService.get_membership_eligible_account",
                side_effect=closed_account,
            ),
            patch.object(RegisterService, "get_invitation_by_token") as lookup,
            RegisterService.current_invitation("token", invitation) as is_current,
        ):
            assert is_current is False

        lookup.assert_not_called()

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
                tenant.id, "Test@Example.com", "token-123", session=sqlite_session
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

    @pytest.mark.parametrize(
        ("workspace_id", "email"),
        [("other-tenant", "test@example.com"), ("tenant-456", "other@example.com")],
    )
    def test_get_invitation_if_token_valid_rejects_context_mismatch(
        self,
        unbound_session: Session,
        workspace_id: str,
        email: str,
    ) -> None:
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
            "role": "normal",
            "inviter_id": "inviter-789",
        }
        with patch(
            "services.account_service.RegisterService.get_invitation_by_token",
            return_value=invitation_data,
        ):
            result = RegisterService.get_invitation_if_token_valid(
                workspace_id,
                email,
                "token-123",
                session=unbound_session,
            )

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
            "role": "normal",
            "inviter_id": "inviter-789",
        }
        mock_redis_dependencies.get.side_effect = [json.dumps(invitation_data).encode(), b"token-123"]

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
            "role": "normal",
            "inviter_id": "inviter-789",
        }
        mock_redis_dependencies.get.side_effect = [json.dumps(invitation_data).encode(), b"token-123"]

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
            "role": "normal",
            "inviter_id": "inviter-789",
        }
        mock_redis_dependencies.get.side_effect = [json.dumps(invitation_data).encode(), b"token-123"]

        result = RegisterService.get_invitation_if_token_valid(
            tenant.id, "test@example.com", "token-123", session=sqlite_session
        )

        # Verify results
        assert result is None

    @pytest.mark.parametrize(
        "status",
        [AccountStatus.BANNED, AccountStatus.CLOSED, AccountStatus.UNINITIALIZED],
    )
    def test_get_invitation_if_token_valid_rejects_ineligible_account_status(
        self,
        sqlite_session: Session,
        status: AccountStatus,
    ) -> None:
        tenant = Tenant(name="Test Workspace")
        account = Account(name="Test User", email="test@example.com", status=status)
        sqlite_session.add_all([tenant, account])
        sqlite_session.commit()
        invitation_data = {
            "account_id": account.id,
            "email": account.email,
            "workspace_id": tenant.id,
        }

        with patch(
            "services.account_service.RegisterService.get_invitation_by_token",
            return_value=invitation_data,
        ):
            result = RegisterService.get_invitation_if_token_valid(
                tenant.id,
                account.email,
                "token-123",
                session=sqlite_session,
            )

        assert result is None

    def test_get_invitation_by_token_requires_current_pointer(self, mock_redis_dependencies: MagicMock) -> None:
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
            "role": "normal",
            "inviter_id": "inviter-789",
        }
        mock_redis_dependencies.get.side_effect = [json.dumps(invitation_data).encode(), b"token-123"]

        result = RegisterService.get_invitation_by_token("token-123")

        assert result == invitation_data

    def test_get_invitation_by_token_rejects_superseded_token(self, mock_redis_dependencies: MagicMock) -> None:
        invitation_data = {
            "account_id": "user-123",
            "email": "test@example.com",
            "workspace_id": "tenant-456",
            "role": "normal",
            "inviter_id": "inviter-789",
        }
        mock_redis_dependencies.get.side_effect = [json.dumps(invitation_data).encode(), b"newer-token"]

        assert RegisterService.get_invitation_by_token("old-token") is None

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
