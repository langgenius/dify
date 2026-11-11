"""First-installation compensation through the current account/workspace aggregate."""

from collections.abc import Callable
from typing import Never, override

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.account import Account, Tenant, TenantAccountJoin, TenantPluginAutoUpgradeStrategy
from models.model import DifySetup, TenantCreditPool
from repositories.installation_state_repository import InstallationStateRepository
from services.account.contracts import AccountCreation, SetupInput
from services.account.service import AccountSetupProvisioner
from services.entities.account_entities import AccountSnapshot
from services.workspace.contracts import CreatedWorkspace, WorkspaceCreation
from services.workspace.gateways import WorkspaceProvisioningEffectsGateway
from tests.helpers.unit.account_domain import AccountDomain


class _UnexpectedTelemetry:
    def report(self) -> None:
        pytest.fail("telemetry must not run for a failed setup")


def test_setup_marker_failure_can_retry_the_same_installation(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    class FailingOnceInstallation(InstallationStateRepository):
        fail_next = True

        @override
        def mark_setup(self, *, attempt_id: str) -> None:
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("setup marker unavailable")
            super().mark_setup(attempt_id=attempt_id)

    reported: list[bool] = []

    class Telemetry:
        def report(self) -> None:
            reported.append(True)

    installation = FailingOnceInstallation(session_factory=sqlite_session_factory)
    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=installation,
        telemetry=Telemetry(),
    )
    setup = SetupInput(
        email="owner@example.com",
        name="Owner",
        password="Valid123!",
        ip_address="127.0.0.1",
        language="en-US",
    )

    with pytest.raises(ValueError, match="Setup failed: setup marker unavailable"):
        provisioner.provision(setup)

    assert installation.get_setup_at() is None
    assert installation.has_tenants() is False
    with sqlite_session_factory() as session:
        assert session.scalar(select(Account.id)) is None

    provisioner.provision(setup)

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Account)) == 1
        assert session.scalar(select(func.count()).select_from(Tenant)) == 1
        assert session.scalar(select(func.count()).select_from(TenantAccountJoin)) == 1
        assert session.scalar(select(func.count()).select_from(DifySetup)) == 1
    assert reported == [True]


def test_post_commit_workspace_notification_failure_removes_the_committed_aggregate(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    effects = account_domain.provisioning._effects
    assert isinstance(effects, WorkspaceProvisioningEffectsGateway)

    def fail_after_commit(_workspace: CreatedWorkspace, *, owner_id: str | None) -> None:
        assert owner_id is not None
        with sqlite_session_factory() as session:
            assert session.scalar(select(Tenant.id)) is not None
            assert session.scalar(select(TenantAccountJoin.id)) is not None
        raise RuntimeError("post-commit tenant notification failed")

    monkeypatch.setattr(effects, "created", fail_after_commit)
    installation = InstallationStateRepository(session_factory=sqlite_session_factory)
    reported: list[bool] = []

    class Telemetry:
        def report(self) -> None:
            reported.append(True)

    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=installation,
        telemetry=Telemetry(),
    )

    setup = SetupInput(
        email="owner@example.com",
        name="Owner",
        password="Valid123!",
        ip_address="127.0.0.1",
        language="en-US",
    )
    with pytest.raises(ValueError, match="Setup failed: post-commit tenant notification failed"):
        provisioner.provision(setup)

    assert reported == []
    with sqlite_session_factory() as session:
        for model in (
            DifySetup,
            TenantAccountJoin,
            TenantPluginAutoUpgradeStrategy,
            TenantCreditPool,
            Tenant,
            Account,
        ):
            assert session.scalar(select(func.count()).select_from(model)) == 0

    def accept_notification(_workspace: CreatedWorkspace, *, owner_id: str | None) -> None:
        assert owner_id is not None

    monkeypatch.setattr(effects, "created", accept_notification)
    provisioner.provision(setup)

    assert reported == [True]
    with sqlite_session_factory() as session:
        for model in (DifySetup, TenantAccountJoin, TenantCreditPool, Tenant, Account):
            assert session.scalar(select(func.count()).select_from(model)) == 1


def test_account_commit_with_lost_ack_is_reconciled_by_stable_account_id(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_create = account_domain.accounts.create_account

    def create_then_lose_ack(
        email: str,
        name: str,
        interface_language: str,
        password: str | None = None,
        interface_theme: str = "light",
        is_setup: bool = False,
        timezone: str | None = None,
        ip_address: str | None = None,
        check_normalized_email: bool = False,
        *,
        status: str = "active",
        initialized: bool = False,
        account_id: str | None = None,
    ) -> Never:
        account: AccountSnapshot = original_create(
            email,
            name,
            interface_language,
            password,
            interface_theme,
            is_setup,
            timezone,
            ip_address,
            check_normalized_email,
            status=status,
            initialized=initialized,
            account_id=account_id,
        )
        with sqlite_session_factory() as session:
            assert session.get(Account, account.id) is not None
        raise RuntimeError("account commit acknowledgement lost")

    monkeypatch.setattr(account_domain.accounts, "create_account", create_then_lose_ack)
    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=InstallationStateRepository(session_factory=sqlite_session_factory),
        telemetry=_UnexpectedTelemetry(),
    )

    with pytest.raises(ValueError, match="account commit acknowledgement lost"):
        provisioner.provision(SetupInput("owner@example.com", "Owner", "Valid123!", "127.0.0.1", "en-US"))

    with sqlite_session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Account)) == 0


def test_workspace_commit_with_lost_ack_is_reconciled_from_attempt_account(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_provision = account_domain.workspaces.provision

    def provision_then_lose_ack(
        prepare: Callable[[], WorkspaceCreation],
        *,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
        before_commit: Callable[[], None],
    ) -> Never:
        workspace = original_provision(
            prepare,
            owner_id=owner_id,
            account=account,
            only_if_no_active_workspace=only_if_no_active_workspace,
            before_commit=before_commit,
        )
        assert workspace is not None
        with sqlite_session_factory() as session:
            assert session.get(Tenant, workspace.id) is not None
        raise RuntimeError("workspace commit acknowledgement lost")

    monkeypatch.setattr(account_domain.workspaces, "provision", provision_then_lose_ack)
    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=InstallationStateRepository(session_factory=sqlite_session_factory),
        telemetry=_UnexpectedTelemetry(),
    )

    with pytest.raises(ValueError, match="workspace commit acknowledgement lost"):
        provisioner.provision(SetupInput("owner@example.com", "Owner", "Valid123!", "127.0.0.1", "en-US"))

    with sqlite_session_factory() as session:
        for model in (TenantAccountJoin, TenantCreditPool, Tenant, Account):
            assert session.scalar(select(func.count()).select_from(model)) == 0


def test_setup_marker_commit_with_lost_ack_removes_only_the_attempt_marker(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    class CommitThenLoseAckInstallation(InstallationStateRepository):
        @override
        def mark_setup(self, *, attempt_id: str) -> None:
            super().mark_setup(attempt_id=attempt_id)
            with sqlite_session_factory() as session:
                assert session.scalar(select(DifySetup.instance_id)) == attempt_id
            raise RuntimeError("setup marker commit acknowledgement lost")

    provisioner = AccountSetupProvisioner(
        accounts=account_domain.accounts,
        workspaces=account_domain.provisioning,
        installation=CommitThenLoseAckInstallation(session_factory=sqlite_session_factory),
        telemetry=_UnexpectedTelemetry(),
    )

    with pytest.raises(ValueError, match="setup marker commit acknowledgement lost"):
        provisioner.provision(SetupInput("owner@example.com", "Owner", "Valid123!", "127.0.0.1", "en-US"))

    with sqlite_session_factory() as session:
        for model in (DifySetup, TenantAccountJoin, TenantCreditPool, Tenant, Account):
            assert session.scalar(select(func.count()).select_from(model)) == 0
