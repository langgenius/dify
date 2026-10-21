"""Internal provisioning policy and the existing tenant write path."""

from collections.abc import Callable
from datetime import datetime
from typing import cast
from unittest.mock import Mock, create_autospec

import pytest
from blinker import Signal
from sqlalchemy import Select, event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Mapper, ORMExecuteState, Session, sessionmaker

from enums import DeploymentEdition
from models import TenantCreditPool
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole, TenantPluginAutoUpgradeStrategy
from models.model import DifySetup
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account.contracts import AccountCreation
from services.account_errors import AccountNotFoundError
from services.entities.account_entities import AccountSnapshot
from services.entities.feature_entities import LicenseModel
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkspaceNotFoundError,
    WorkspaceOwnerNotFoundError,
    WorkspacesLimitExceededError,
)
from services.workspace import gateways
from services.workspace.contracts import (
    CreatedWorkspace,
    WorkspaceCreation,
    WorkspacePreparation,
    WorkspaceProvisioningCommitOutcome,
    WorkspaceProvisioningResult,
)
from services.workspace.gateways import WorkspaceProvisioningEffectsGateway
from services.workspace.provisioning_service import (
    WorkspaceCreationPolicy,
    WorkspaceMembershipQuery,
    WorkspaceMemberWriter,
    WorkspaceOwnerQuery,
    WorkspaceProvisioningEffects,
    WorkspaceProvisioningService,
    WorkspaceProvisioningStore,
)
from services.workspace.quota import DeploymentQuotaSnapshot
from tests.unit_tests.account_domain import AccountDomain

OWNER = AccountSnapshot(
    "account",
    "Owner",
    "owner@example.com",
    None,
    False,
    "en-US",
    "light",
    "UTC",
    None,
    None,
    "active",
    datetime(2026, 1, 1),
    datetime(2026, 1, 1),
)


def test_owner_lookup_is_exact_and_tolerates_duplicate_emails(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory() as session:
        first = Account(name="First", email="owner@example.com")
        second = Account(name="Second", email="owner@example.com")
        session.add_all([first, second])
        session.commit()
        owner_ids = {first.id, second.id}
    repository = SQLAlchemyAccountRepository(sqlite_session_factory)
    gateway = create_autospec(WorkspaceProvisioningStore, instance=True)
    service = _service(owners=repository, provisioning=gateway)
    service.create(name="Test", owner_email="owner@example.com")
    assert gateway.provision.call_args.kwargs["owner_id"] in owner_ids
    with pytest.raises(WorkspaceOwnerNotFoundError):
        service.create(name="Test", owner_email="OWNER@example.com")
    assert gateway.provision.call_count == 1


@pytest.mark.parametrize("role", ["owner", "unknown", "ADMIN"])
def test_invalid_roles_are_rejected_before_writes(role: str) -> None:
    gateway = create_autospec(WorkspaceProvisioningStore, instance=True)
    service = _service(owners=create_autospec(WorkspaceOwnerQuery, instance=True), provisioning=gateway)
    with pytest.raises(InvalidWorkspaceMemberRoleError):
        service.join_member(
            workspace_id="w", account_id="a", email="a@example.com", role=role, operator_account_id=None
        )
    cast(Mock, service._members).join_member.assert_not_called()


def test_member_operator_is_forwarded() -> None:
    gateway = create_autospec(WorkspaceProvisioningStore, instance=True)
    service = _service(owners=create_autospec(WorkspaceOwnerQuery, instance=True), provisioning=gateway)
    service.join_member(
        workspace_id="w", account_id="a", email="a@example.com", role="editor", operator_account_id="operator"
    )
    cast(Mock, service._members).join_member.assert_called_once_with(
        workspace_id="w",
        account_id="a",
        email="a@example.com",
        role=TenantAccountRole.EDITOR,
        operator_account_id="operator",
    )


def test_missing_owner_is_rejected_before_creation() -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    owners.find_first_by_email.return_value = None
    gateway = create_autospec(WorkspaceProvisioningStore, instance=True)
    service = _service(owners=owners, provisioning=gateway)
    with pytest.raises(WorkspaceOwnerNotFoundError):
        service.create(name="Test", owner_email="owner@example.com")
    gateway.provision.assert_not_called()


@pytest.mark.parametrize("owner_email", [None, "owner@example.com"])
def test_create_delegation(owner_email: str | None) -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    owners.find_first_by_email.return_value = OWNER
    gateway = create_autospec(WorkspaceProvisioningStore, instance=True)
    result = CreatedWorkspace("w", "Test", "sandbox", "normal", None, None, None, {})
    gateway.provision.return_value = WorkspaceProvisioningResult(
        WorkspaceProvisioningCommitOutcome.COMMITTED, workspace=result
    )
    service = _service(owners=owners, provisioning=gateway)
    assert service.create(name="Test", owner_email=owner_email) is result
    assert gateway.provision.call_args.kwargs["owner_id"] == (OWNER.id if owner_email else None)
    if owner_email is None:
        owners.find_first_by_email.assert_not_called()


@pytest.fixture
def gateway(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    config_overrides: Callable[..., None],
) -> tuple[WorkspaceProvisioningService, Signal]:
    config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, RBAC_ENABLED=False)
    monkeypatch.setattr(gateways.SystemFeatureService, "is_workspace_creation_allowed", lambda: True)
    monkeypatch.setattr(gateways.SystemFeatureService, "get_license", lambda: LicenseModel())
    monkeypatch.setattr(gateways, "generate_key_pair", lambda _workspace_id: "public-key")
    monkeypatch.setattr(gateways, "delete_key_pair", lambda _workspace_id: None)
    signal = Signal()
    monkeypatch.setattr(gateways, "tenant_was_created", signal)
    return _service(
        owners=SQLAlchemyAccountRepository(sqlite_session_factory),
        provisioning=WorkspaceRepository(sqlite_session_factory),
        effects=WorkspaceProvisioningEffectsGateway(),
    ), signal


@pytest.mark.parametrize("with_owner", [False, True])
def test_creation_reuses_defaults_and_emits_one_event(
    gateway: tuple[WorkspaceProvisioningService, Signal],
    sqlite_session_factory: sessionmaker[Session],
    with_owner: bool,
    config_overrides: Callable[..., None],
) -> None:
    adapter, signal = gateway
    config_overrides(HOSTED_POOL_CREDITS=123)
    with sqlite_session_factory() as session:
        account = Account(name="Owner", email="owner@example.com")
        session.add(account)
        session.commit()
        account_id = account.id
    emitted = []

    def record(tenant: CreatedWorkspace) -> None:
        with sqlite_session_factory() as session:
            assert session.get(Tenant, tenant.id) is not None
        emitted.append(tenant.id)

    signal.connect(record)
    result = adapter.create(name="Created", owner_email="owner@example.com" if with_owner else None)
    assert result.name == "Created"
    assert result.encrypt_public_key == "public-key"
    assert emitted == [result.id]
    with sqlite_session_factory() as session:
        tenant = session.get(Tenant, result.id)
        assert tenant is not None
        assert tenant.name == "Created"
        pool = session.scalar(select(TenantCreditPool).where(TenantCreditPool.tenant_id == result.id))
        assert pool is not None
        assert pool.quota_limit == 123
        assert pool.quota_used == 0
        assert pool.pool_type == "trial"
        strategies = session.scalars(
            select(TenantPluginAutoUpgradeStrategy).where(TenantPluginAutoUpgradeStrategy.tenant_id == result.id)
        ).all()
        assert len(strategies) == len(gateways.TenantPluginAutoUpgradeCategory)
        for strategy in strategies:
            assert strategy.strategy_setting == gateways.PluginAutoUpgradeService.default_strategy_setting_for_category(
                strategy.category
            )
            assert strategy.upgrade_time_of_day == gateways.PluginAutoUpgradeService.default_upgrade_time_of_day(
                result.id
            )
        membership = session.scalar(select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == result.id))
        if with_owner:
            assert membership is not None
            assert membership.account_id == account_id
            assert membership.role == TenantAccountRole.OWNER
        else:
            assert membership is None


def test_missing_owner_cannot_create_or_emit(
    gateway: tuple[WorkspaceProvisioningService, Signal], sqlite_session_factory: sessionmaker[Session]
) -> None:
    adapter, signal = gateway
    emitted = []

    def record(tenant: CreatedWorkspace) -> None:
        emitted.append(tenant.id)

    signal.connect(record)
    with pytest.raises(WorkspaceOwnerNotFoundError):
        adapter.create(name="Absent", owner_email="missing@example.com")
    with sqlite_session_factory() as session:
        assert session.scalar(select(Tenant.id)) is None
    assert emitted == []


def test_workspace_quota_snapshot_is_forwarded_to_the_write_transaction() -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    provisioning = create_autospec(WorkspaceProvisioningStore, instance=True)
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.return_value = WorkspaceCreation("w", "Test", "key", 123, 0, {})
    service = _service(owners=owners, provisioning=provisioning, effects=effects)
    policy = cast(Mock, service._policies)
    quota = DeploymentQuotaSnapshot(2, 1, 3, 2)
    policy.quota_snapshot.return_value = quota
    provisioning.provision.return_value = WorkspaceProvisioningResult(
        WorkspaceProvisioningCommitOutcome.COMMITTED,
        workspace=CreatedWorkspace("w", "Test", "sandbox", "normal", None, None, None, {}),
    )
    service.create(name="Test")
    policy.quota_snapshot.assert_called_once_with()
    assert provisioning.provision.call_args.kwargs["quota"] == quota


def test_membership_uses_explicit_session_and_preserves_current(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    adapter = account_domain.members
    with sqlite_session_factory() as session:
        account = Account(name="Member", email="member@example.com")
        tenant = Tenant(name="Target")
        session.add_all([account, tenant])
        session.commit()
        account_id, workspace_id = (account.id, tenant.id)
    for role in (TenantAccountRole.NORMAL, TenantAccountRole.EDITOR):
        result = adapter.join_member(
            workspace_id=workspace_id,
            account_id=account_id,
            email="member@example.com",
            role=role,
            operator_account_id=None,
        )
        assert result.role == role.value
    with sqlite_session_factory() as session:
        membership = session.scalar(select(TenantAccountJoin))
        assert membership is not None
        assert membership.role == TenantAccountRole.EDITOR
        assert not membership.current
    with pytest.raises(AccountNotFoundError):
        adapter.join_member(
            workspace_id=workspace_id,
            account_id=account_id,
            email="wrong@example.com",
            role=TenantAccountRole.NORMAL,
            operator_account_id=None,
        )
    with pytest.raises(WorkspaceNotFoundError):
        adapter.join_member(
            workspace_id="absent",
            account_id=account_id,
            email="member@example.com",
            role=TenantAccountRole.NORMAL,
            operator_account_id=None,
        )


def test_provisioning_rolls_back_the_entire_aggregate_when_defaults_fail(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    emitted: list[str] = []
    signal = Signal()
    monkeypatch.setattr(gateways, "tenant_was_created", signal)

    def record(tenant: CreatedWorkspace) -> None:
        emitted.append(tenant.id)

    def reject_pool(_mapper: Mapper[TenantCreditPool], _connection: Connection, _pool: TenantCreditPool) -> None:
        raise RuntimeError("Pool write failed")

    signal.connect(record)
    event.listen(TenantCreditPool, "before_insert", reject_pool)
    try:
        with pytest.raises(RuntimeError, match="Pool write failed"):
            account_domain.provisioning.create_with_owner_workspace(
                email="new@example.com", name="New", interface_language="en-US", timezone="UTC", ip_address="127.0.0.1"
            )
    finally:
        event.remove(TenantCreditPool, "before_insert", reject_pool)

    with sqlite_session_factory() as session:
        for model in (Account, Tenant, TenantAccountJoin, TenantPluginAutoUpgradeStrategy, TenantCreditPool):
            assert session.scalar(select(model.id)) is None
    assert emitted == []


def test_combined_account_workspace_provisioning_checks_quota_before_either_insert(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session]
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all([DifySetup(version="test-version"), Tenant(name="Existing")])
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(10, 0, 1, 0)

    with pytest.raises(WorkspacesLimitExceededError):
        account_domain.provisioning.create_with_owner_workspace(
            email="new@example.com",
            name="New",
            interface_language="en-US",
            timezone="UTC",
            ip_address="127.0.0.1",
        )

    with sqlite_session_factory() as session:
        assert session.scalar(select(Account.id)) is None
        assert len(session.scalars(select(Tenant.id)).all()) == 1


def test_initial_workspace_creation_is_idempotent(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    with sqlite_session_factory.begin() as session:
        session.add(DifySetup(version="test-version"))
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(None, 0, 1, 0)
    account_domain.provisioning.ensure_owner_workspace(account.id)
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)
    account_domain.provisioning.ensure_owner_workspace(account.id)

    effects.prepare.assert_not_called()
    effects.bind_owner.assert_not_called()

    with sqlite_session_factory() as session:
        assert len(session.scalars(select(Tenant.id)).all()) == 1
        assert len(session.scalars(select(TenantCreditPool.id)).all()) == 1


def test_competing_initial_workspace_compensates_losing_owner_binding(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    prepared_ids: list[str] = []

    def prepare(workspace_id: str, name: str) -> WorkspaceCreation:
        prepared_ids.append(workspace_id)
        return WorkspaceCreation(workspace_id, name, "key", 123, 0, {})

    effects.prepare.side_effect = prepare
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)
    competing_repository = WorkspaceRepository(sqlite_session_factory)
    competing_service = WorkspaceProvisioningService(
        owners=account_domain.repository,
        provisioning=competing_repository,
        effects=effects,
        policies=account_domain.policy,
        memberships=competing_repository,
        members=account_domain.members,
    )
    has_active_workspace = account_domain.workspaces.has_active_for_account

    def finish_competing_request_after_precheck(account_id: str) -> bool:
        # Both requests see no workspace. The winner commits before the losing
        # request reaches its locked recheck in the real repository.
        observed = has_active_workspace(account_id)
        assert not observed
        competing_service.ensure_owner_workspace(account_id)
        return observed

    monkeypatch.setattr(account_domain.workspaces, "has_active_for_account", finish_competing_request_after_precheck)
    account_domain.provisioning.ensure_owner_workspace(account.id)

    assert effects.prepare.call_count == 2
    winner_id, skipped_id = prepared_ids
    effects.bind_owner.assert_any_call(winner_id, account.id)
    effects.bind_owner.assert_any_call(skipped_id, account.id)
    effects.unbind_owner.assert_called_once_with(skipped_id, account.id)
    effects.discard_key.assert_called_once_with(skipped_id)
    effects.created.assert_called_once()
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(Tenant.id))) == [winner_id]
        assert list(session.scalars(select(TenantAccountJoin.tenant_id))) == [winner_id]
        assert list(session.scalars(select(TenantCreditPool.tenant_id))) == [winner_id]


def test_workspace_preparation_finishes_before_quota_lock_and_publish_follows_commit(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    with sqlite_session_factory.begin() as session:
        session.add(DifySetup(version="test-version"))
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(None, 0, 1, 0)
    phases: list[str] = []
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)

    def record_lock(execution: ORMExecuteState) -> None:
        # SQLite exercises persistence; compile the actual ORM statement for
        # PostgreSQL to verify the row-lock clause that SQLite cannot execute.
        statement = execution.statement
        compiled = str(statement.compile(dialect=postgresql.dialect())) if isinstance(statement, Select) else ""
        if "FROM dify_setups" in compiled and "FOR UPDATE" in compiled:
            phases.append("quota-lock")

    def prepare(workspace_id: str, _name: str) -> WorkspaceCreation:
        phases.append("prepare")
        return WorkspaceCreation(workspace_id, "Owner's Workspace", "key", 123, 0, {})

    def bind_owner(_workspace_id: str, _account_id: str) -> None:
        phases.append("bind")

    def committed(_session: Session) -> None:
        phases.append("commit")

    def published(_workspace: CreatedWorkspace, *, owner_id: str | None) -> None:
        assert owner_id == account.id
        phases.append("publish")

    effects.prepare.side_effect = prepare
    effects.bind_owner.side_effect = bind_owner
    effects.created.side_effect = published
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)
    event.listen(sqlite_session_factory, "do_orm_execute", record_lock)
    event.listen(sqlite_session_factory, "after_commit", committed)
    try:
        account_domain.provisioning.ensure_owner_workspace(account.id)
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", record_lock)
        event.remove(sqlite_session_factory, "after_commit", committed)

    assert phases.index("prepare") < phases.index("bind") < phases.index("quota-lock") < phases.index("publish")


def test_slow_owner_binding_can_interleave_a_competing_quota_writer(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    slow_account = account_domain.accounts.create_account("slow@example.com", "Slow", "en-US")
    account_domain.accounts.create_account("fast@example.com", "Fast", "en-US")
    with sqlite_session_factory.begin() as session:
        session.add(DifySetup(version="test-version"))
    account_domain.policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(None, 0, 1, 0)
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    prepared: dict[str, str] = {}

    def prepare(workspace_id: str, name: str) -> WorkspaceCreation:
        prepared[name] = workspace_id
        return WorkspaceCreation(workspace_id, name, "key", 123, 0, {})

    effects.prepare.side_effect = prepare

    def bind_owner(workspace_id: str, _account_id: str) -> None:
        if workspace_id == prepared["Slow"]:
            # Simulate a slow RPC callback. The competing request commits while
            # this request has not yet acquired the deployment quota mutex.
            account_domain.provisioning.create(name="Fast", owner_email="fast@example.com")

    effects.bind_owner.side_effect = bind_owner
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)

    with pytest.raises(WorkspacesLimitExceededError):
        account_domain.provisioning.create(name="Slow", owner_email="slow@example.com")

    effects.unbind_owner.assert_called_once_with(prepared["Slow"], slow_account.id)
    effects.discard_key.assert_called_once_with(prepared["Slow"])
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(Tenant.id))) == [prepared["Fast"]]


@pytest.mark.parametrize("failure_phase", ["bind", "database"])
def test_failed_provisioning_compensates_the_request_owner_binding(failure_phase: str) -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    owners.find_first_by_email.return_value = OWNER
    provisioning = create_autospec(WorkspaceProvisioningStore, instance=True)
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.return_value = WorkspaceCreation("failed", "Test", "key", 123, 0, {})
    failure = RuntimeError(f"{failure_phase} failed")
    if failure_phase == "bind":
        effects.bind_owner.side_effect = failure
    else:
        provisioning.provision.return_value = WorkspaceProvisioningResult(
            WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT,
            error=failure,
        )
    service = _service(owners=owners, provisioning=provisioning, effects=effects)

    with pytest.raises(RuntimeError, match=f"{failure_phase} failed"):
        service.create(name="Test", owner_email=OWNER.email)

    effects.unbind_owner.assert_called_once_with("failed", OWNER.id)
    effects.discard_key.assert_called_once_with("failed")
    if failure_phase == "bind":
        provisioning.provision.assert_not_called()


def test_commit_ack_loss_preserves_the_committed_workspace_owner_binding(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.side_effect = lambda workspace_id, name: WorkspaceCreation(workspace_id, name, "key", 123, 0, {})
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)
    provision = account_domain.workspaces.provision

    def commit_then_lose_ack(
        creation: WorkspaceCreation,
        *,
        preparation: WorkspacePreparation,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
        quota: DeploymentQuotaSnapshot,
    ) -> WorkspaceProvisioningResult:
        committed = provision(
            creation,
            preparation=preparation,
            owner_id=owner_id,
            account=account,
            only_if_no_active_workspace=only_if_no_active_workspace,
            quota=quota,
        )
        assert committed.outcome == WorkspaceProvisioningCommitOutcome.COMMITTED
        return WorkspaceProvisioningResult(
            WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN,
            error=RuntimeError("commit acknowledgement lost"),
        )

    monkeypatch.setattr(account_domain.workspaces, "provision", commit_then_lose_ack)

    with pytest.raises(RuntimeError, match="commit acknowledgement lost"):
        account_domain.provisioning.create(name="Test", owner_email=owner.email)

    effects.unbind_owner.assert_not_called()
    effects.discard_key.assert_not_called()
    with sqlite_session_factory() as session:
        workspace_id = effects.prepare.call_args.args[0]
        assert session.get(Tenant, workspace_id) is not None
        membership = session.scalar(
            select(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == workspace_id, TenantAccountJoin.account_id == owner.id
            )
        )
        assert membership is not None


def test_uncertain_commit_status_preserves_owner_binding_without_membership_inference(
    account_domain: AccountDomain,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    owner = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.side_effect = lambda workspace_id, name: WorkspaceCreation(workspace_id, name, "key", 123, 0, {})
    monkeypatch.setattr(account_domain.provisioning, "_effects", effects)

    def fail_provision(
        _creation: WorkspaceCreation,
        *,
        preparation: WorkspacePreparation,
        owner_id: str | None,
        account: AccountCreation | None = None,
        only_if_no_active_workspace: bool = False,
        quota: DeploymentQuotaSnapshot,
    ) -> WorkspaceProvisioningResult:
        del preparation, owner_id, account, only_if_no_active_workspace, quota
        return WorkspaceProvisioningResult(
            WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN,
            error=RuntimeError("database response lost"),
        )

    monkeypatch.setattr(account_domain.workspaces, "provision", fail_provision)

    with pytest.raises(RuntimeError, match="database response lost"):
        account_domain.provisioning.create(name="Test", owner_email=owner.email)

    effects.unbind_owner.assert_not_called()
    effects.discard_key.assert_not_called()
    assert "preserving prepared key/RBAC" in caplog.text


def test_ownerless_workspace_quota_rejection_preserves_error_when_key_cleanup_fails(
    caplog: pytest.LogCaptureFixture,
) -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    provisioning = create_autospec(WorkspaceProvisioningStore, instance=True)
    provisioning.provision.return_value = WorkspaceProvisioningResult(
        WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT,
        error=WorkspacesLimitExceededError(),
    )
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.return_value = WorkspaceCreation("rejected", "Test", "key", 123, 0, {})
    effects.discard_key.side_effect = RuntimeError("key cleanup failed")
    service = _service(owners=owners, provisioning=provisioning, effects=effects)

    with pytest.raises(WorkspacesLimitExceededError):
        service.create(name="Test")

    effects.discard_key.assert_called_once_with("rejected")
    effects.unbind_owner.assert_not_called()
    assert "workspace_id=rejected" in caplog.text


def test_ownerless_database_failure_with_unknown_commit_preserves_key(
    caplog: pytest.LogCaptureFixture,
) -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    provisioning = create_autospec(WorkspaceProvisioningStore, instance=True)
    provisioning.provision.return_value = WorkspaceProvisioningResult(
        WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN,
        error=RuntimeError("database response lost"),
    )
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.return_value = WorkspaceCreation("uncertain-ownerless", "Test", "key", 123, 0, {})
    service = _service(owners=owners, provisioning=provisioning, effects=effects)

    with pytest.raises(RuntimeError, match="database response lost"):
        service.create(name="Test")

    effects.discard_key.assert_not_called()
    effects.unbind_owner.assert_not_called()
    assert "preserving prepared key/RBAC" in caplog.text


def test_owner_unbind_failure_does_not_replace_quota_error(caplog: pytest.LogCaptureFixture) -> None:
    owners = create_autospec(WorkspaceOwnerQuery, instance=True)
    owners.find_first_by_email.return_value = OWNER
    provisioning = create_autospec(WorkspaceProvisioningStore, instance=True)
    provisioning.provision.return_value = WorkspaceProvisioningResult(
        WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT,
        error=WorkspacesLimitExceededError("quota full"),
    )
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.return_value = WorkspaceCreation("quota-rejected", "Test", "key", 123, 0, {})
    effects.unbind_owner.side_effect = RuntimeError("RBAC unavailable")
    service = _service(owners=owners, provisioning=provisioning, effects=effects)

    with pytest.raises(WorkspacesLimitExceededError, match="quota full"):
        service.create(name="Test", owner_email=OWNER.email)

    effects.unbind_owner.assert_called_once_with("quota-rejected", OWNER.id)
    effects.discard_key.assert_called_once_with("quota-rejected")
    assert "workspace_id=quota-rejected" in caplog.text


def _service(
    *,
    owners: WorkspaceOwnerQuery,
    provisioning: WorkspaceProvisioningStore,
    effects: WorkspaceProvisioningEffects | None = None,
) -> WorkspaceProvisioningService:
    """Use the supplied effects, or prepare autospecced effects when omitted or None."""
    policy = create_autospec(WorkspaceCreationPolicy, instance=True)
    policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(None, 0, None, 0)
    if effects is None:
        prepared = create_autospec(WorkspaceProvisioningEffects, instance=True)
        prepared.prepare.return_value = WorkspaceCreation("w", "Test", "key", 123, 0, {})
        effects = cast(WorkspaceProvisioningEffects, prepared)
    if hasattr(provisioning, "mock_calls"):
        provisioning = cast(Mock, provisioning)
        creation = cast(Mock, effects).prepare.return_value
        workspace_id = creation.id if isinstance(creation, WorkspaceCreation) else "w"
        provisioning.start_preparation.return_value = WorkspacePreparation(workspace_id, "lease")
        provisioning.checkpoint_preparation.return_value = True
        provisioning.request_compensation.return_value = True
        current_result = provisioning.provision.return_value
        if not isinstance(current_result, WorkspaceProvisioningResult):
            workspace = (
                current_result
                if isinstance(current_result, CreatedWorkspace)
                else CreatedWorkspace(workspace_id, "Test", "sandbox", "normal", None, None, None, {})
            )
            provisioning.provision.return_value = WorkspaceProvisioningResult(
                WorkspaceProvisioningCommitOutcome.COMMITTED,
                workspace=workspace,
            )
    return WorkspaceProvisioningService(
        effects=effects,
        owners=owners,
        provisioning=provisioning,
        policies=policy,
        memberships=create_autospec(WorkspaceMembershipQuery, instance=True),
        members=create_autospec(WorkspaceMemberWriter, instance=True),
    )
