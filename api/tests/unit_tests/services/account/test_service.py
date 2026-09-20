"""Account lifecycle regressions through application ports and real SQLite Sessions."""

from collections.abc import Callable
from datetime import datetime
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.model import DifySetup
from repositories.installation_state_repository import InstallationStateRepository
from services.account.contracts import SetupInput
from services.account.service import AccountSetupProvisioner
from services.account_errors import (
    AccountEmailDomainSuspendedError,
    AccountLoginError,
    AccountNormalizedEmailAlreadyInUseError,
    AccountNotFoundError,
    AccountPasswordError,
    AccountRegisterError,
    SeatsLimitExceededError,
)
from services.entities.account_entities import AccountSessionTokens
from services.errors.workspace import WorkSpaceNotAllowedCreateError
from tests.unit_tests.account_domain import AccountDomain


def test_creation_hashes_password_and_keeps_registration_ip(
    account_domain: AccountDomain, sqlite_session: Session
) -> None:
    account = account_domain.accounts.create_account(
        "New@Example.com", "New", "en-US", password="Valid123!", ip_address="203.0.113.1"
    )
    stored = sqlite_session.get(Account, account.id)
    assert stored is not None
    assert stored.email == "New@Example.com"
    assert stored.normalized_email == "new@example.com"
    assert stored.password != "Valid123!"
    assert stored.last_login_ip == "203.0.113.1"
    assert account.status == "active"
    assert account.initialized_at is None
    assert account_domain.accounts.authenticate("New@Example.com", "Valid123!").id == account.id
    with pytest.raises(AccountPasswordError):
        account_domain.accounts.authenticate(account.email, "wrong")


@pytest.mark.parametrize(
    ("setting", "value", "error"),
    [
        pytest.param(
            lambda policy: policy.is_registration_allowed, False, AccountNotFoundError, id="registration_disabled"
        ),
        pytest.param(lambda policy: policy.has_account_capacity, False, SeatsLimitExceededError, id="seat_limit"),
        pytest.param(
            lambda policy: policy.get_email_freeze_type,
            "email_domain_suspended",
            AccountEmailDomainSuspendedError,
            id="domain_suspended",
        ),
        pytest.param(lambda policy: policy.get_email_freeze_type, "deleted", AccountRegisterError, id="deleted"),
    ],
)
def test_creation_policy_prevents_persistence(
    account_domain: AccountDomain,
    sqlite_session: Session,
    setting: Callable[[Mock], Mock],
    value: object,
    error: type[Exception],
) -> None:
    setting(account_domain.policy).return_value = value
    with pytest.raises(error):
        account_domain.accounts.create_account("new@example.com", "New", "en-US")
    assert sqlite_session.scalar(select(Account.id)) is None


def test_setup_bypasses_registration_but_not_seat_limit(account_domain: AccountDomain) -> None:
    account_domain.policy.is_registration_allowed.return_value = False
    account_domain.accounts.create_account("first@example.com", "First", "en-US", is_setup=True)
    account_domain.policy.has_account_capacity.return_value = False
    with pytest.raises(SeatsLimitExceededError):
        account_domain.accounts.create_account("second@example.com", "Second", "en-US", is_setup=True)


def test_email_collision_is_checked_before_capacity(account_domain: AccountDomain) -> None:
    account_domain.accounts.create_account("first@example.com", "First", "en-US")
    account_domain.policy.has_account_capacity.return_value = False
    with pytest.raises(AccountNormalizedEmailAlreadyInUseError):
        account_domain.accounts.create_account("First@example.com", "Second", "en-US", check_normalized_email=True)


@pytest.mark.parametrize("timezone", [None, "Asia/Singapore"])
def test_registration_initializes_and_creates_owner_membership(
    account_domain: AccountDomain, sqlite_session: Session, timezone: str | None
) -> None:
    account = account_domain.accounts.register("new@example.com", "New", language="zh-Hans", timezone=timezone)
    assert account.initialized_at == datetime(2026, 1, 1)
    assert account.timezone == (timezone or "Asia/Shanghai")
    memberships = list(sqlite_session.scalars(select(TenantAccountJoin)))
    assert len(memberships) == 1
    assert memberships[0].account_id == account.id
    assert memberships[0].role == TenantAccountRole.OWNER
    assert not memberships[0].current
    account_domain.policy.try_join_default_workspace.assert_called_once_with(account.id)


@pytest.mark.parametrize(
    "setting",
    [
        pytest.param(lambda policy: policy.is_workspace_creation_allowed, id="creation_disabled"),
        pytest.param(lambda policy: policy.has_workspace_capacity, id="workspace_limit"),
    ],
)
def test_registration_without_personal_workspace_still_joins_default(
    account_domain: AccountDomain, sqlite_session: Session, setting: Callable[[Mock], Mock]
) -> None:
    setting(account_domain.policy).return_value = False
    account = account_domain.accounts.register("new@example.com", "New", status="pending")
    assert account.status == "pending"
    assert sqlite_session.scalar(select(Tenant.id)) is None
    account_domain.policy.try_join_default_workspace.assert_called_once_with(account.id)


def test_personal_workspace_failure_still_attempts_enterprise_join(account_domain: AccountDomain) -> None:
    account_domain.policy.is_workspace_creation_allowed.return_value = False
    with pytest.raises(WorkSpaceNotAllowedCreateError):
        account_domain.accounts.create_account_and_tenant("new@example.com", "New", "en-US")
    account_domain.policy.try_join_default_workspace.assert_called_once()


def test_existing_archived_membership_prevents_implicit_workspace_creation(
    account_domain: AccountDomain, sqlite_session: Session
) -> None:
    account = account_domain.accounts.create_account("a@example.com", "A", "en-US")
    tenant = Tenant(name="Archived", status=TenantStatus.ARCHIVE)
    sqlite_session.add_all(
        [tenant, TenantAccountJoin(account_id=account.id, tenant_id=tenant.id, role=TenantAccountRole.NORMAL)]
    )
    sqlite_session.commit()
    account_domain.provisioning.create_owner_workspace(account.id, if_missing=True)
    assert list(sqlite_session.scalars(select(Tenant.id))) == [tenant.id]


def test_login_activates_pending_and_issues_tokens_after_commit(
    account_domain: AccountDomain, sqlite_session: Session
) -> None:
    account = account_domain.accounts.create_account("a@example.com", "A", "en-US", status="pending")
    pair = AccountSessionTokens("access", "refresh", "csrf")

    def issue(account_id: str) -> AccountSessionTokens:
        stored = sqlite_session.get(Account, account_id)
        assert stored is not None
        assert stored.status == AccountStatus.ACTIVE
        assert stored.last_login_ip == "203.0.113.2"
        return pair

    account_domain.sessions.issue.side_effect = issue
    assert account_domain.accounts.login(account.id, ip_address="203.0.113.2") == pair
    with pytest.raises(AccountNotFoundError):
        account_domain.accounts.login("missing", ip_address="203.0.113.2")


def test_authentication_rejects_banned_account(account_domain: AccountDomain) -> None:
    account_domain.accounts.create_account("b@example.com", "B", "en-US", password="Valid123!", status="banned")
    with pytest.raises(AccountLoginError):
        account_domain.accounts.authenticate("b@example.com", "Valid123!")


def test_setup_cleans_partial_state_on_failure(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], sqlite_session: Session
) -> None:
    class Telemetry:
        def report(self) -> None:
            pytest.fail("Failed setup cannot report success")

    installation = InstallationStateRepository(session_factory=sqlite_session_factory)
    account_domain.policy.has_workspace_capacity.return_value = False
    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=installation,
        telemetry=Telemetry(),
    )
    with pytest.raises(ValueError, match="Setup failed"):
        provisioner.provision(
            SetupInput(email="a@example.com", name="A", password="Valid123!", ip_address="127.0.0.1", language="en-US")
        )
    assert sqlite_session.scalar(select(Account.id)) is None
    assert sqlite_session.scalar(select(Tenant.id)) is None
    assert sqlite_session.scalar(select(DifySetup.version)) is None


def test_setup_persists_initialized_owner_before_telemetry(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session]
) -> None:
    reported: list[str] = []

    class Telemetry:
        def report(self) -> None:
            with sqlite_session_factory() as session:
                account = session.scalar(select(Account))
                assert account is not None
                assert account.initialized_at == datetime(2026, 1, 1)
                assert session.scalar(select(DifySetup.version)) is not None
                owner = session.scalar(select(TenantAccountJoin))
                assert owner is not None
                assert owner.account_id == account.id
                assert owner.role == TenantAccountRole.OWNER
                reported.append(account.id)

    account_domain.policy.is_registration_allowed.return_value = False
    account_domain.policy.is_workspace_creation_allowed.return_value = False
    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=InstallationStateRepository(session_factory=sqlite_session_factory),
        telemetry=Telemetry(),
    )
    provisioner.provision(
        SetupInput(email="a@example.com", name="A", password="Valid123!", ip_address="127.0.0.1", language="en-US")
    )
    assert len(reported) == 1
