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
from models.account import (
    Account,
    AccountStatus,
    Tenant,
    TenantAccountJoin,
    TenantAccountRole,
    TenantPluginAutoUpgradeStrategy,
    TenantStatus,
)
from repositories.account.repository import SQLAlchemyAccountRepository
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.account_errors import AccountNotFoundError
from services.entities.account_entities import AccountSnapshot
from services.entities.feature_entities import LicenseModel
from services.errors.workspace import (
    InvalidWorkspaceMemberRoleError,
    WorkSpaceNotAllowedCreateError,
    WorkspaceNotFoundError,
    WorkspaceOwnerNotFoundError,
)
from services.workspace import gateways
from services.workspace.contracts import CreatedWorkspace, WorkspaceCreation
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
from tests.helpers.unit.account_domain import AccountDomain

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
    gateway.provision.return_value = result
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


def test_initial_workspace_creation_is_idempotent(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session]
) -> None:
    account = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    account_domain.provisioning.ensure_owner_workspace(account.id)
    account_domain.provisioning.ensure_owner_workspace(account.id)

    with sqlite_session_factory() as session:
        assert len(session.scalars(select(Tenant.id)).all()) == 1
        assert len(session.scalars(select(TenantCreditPool.id)).all()) == 1


def test_competing_initial_workspace_skips_key_and_owner_binding(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.prepare.side_effect = [
        WorkspaceCreation("winner", "Owner's Workspace", "winner-key", 123, 0, {}),
        WorkspaceCreation("skipped", "Owner's Workspace", "orphan-key", 123, 0, {}),
    ]
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

    effects.prepare.assert_called_once_with("Owner's Workspace")
    effects.bind_owner.assert_called_once_with("winner", account.id)
    effects.created.assert_called_once()
    with sqlite_session_factory() as session:
        assert list(session.scalars(select(Tenant.id))) == ["winner"]
        assert list(session.scalars(select(TenantAccountJoin.tenant_id))) == ["winner"]
        assert list(session.scalars(select(TenantCreditPool.tenant_id))) == ["winner"]


def test_initial_workspace_locks_before_preparation_and_publishes_after_commit(
    account_domain: AccountDomain, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    account = account_domain.accounts.create_account("owner@example.com", "Owner", "en-US")
    phases: list[str] = []
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)

    def record_lock(execution: ORMExecuteState) -> None:
        # SQLite exercises persistence; compile the actual ORM statement for
        # PostgreSQL to verify the row-lock clause that SQLite cannot execute.
        statement = execution.statement
        if isinstance(statement, Select) and "FOR UPDATE" in str(statement.compile(dialect=postgresql.dialect())):
            phases.append("lock")

    def prepare(_name: str) -> WorkspaceCreation:
        phases.append("prepare")
        return WorkspaceCreation("workspace", "Owner's Workspace", "key", 123, 0, {})

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

    assert phases == ["lock", "prepare", "bind", "commit", "publish"]


def _service(
    *,
    owners: WorkspaceOwnerQuery,
    provisioning: WorkspaceProvisioningStore,
    effects: WorkspaceProvisioningEffects | None = None,
    policies: WorkspaceCreationPolicy | None = None,
) -> WorkspaceProvisioningService:
    """Use the supplied effects, or prepare autospecced effects when omitted or None."""
    if policies is None:
        policy = create_autospec(WorkspaceCreationPolicy, instance=True)
        policy.has_workspace_capacity.return_value = True
        policy.is_workspace_creation_allowed.return_value = True
    else:
        policy = policies
    if effects is None:
        prepared = create_autospec(WorkspaceProvisioningEffects, instance=True)
        prepared.prepare.return_value = WorkspaceCreation("w", "Test", "key", 123, 0, {})
        effects = cast(WorkspaceProvisioningEffects, prepared)
    return WorkspaceProvisioningService(
        effects=effects,
        owners=owners,
        provisioning=provisioning,
        policies=policy,
        memberships=create_autospec(WorkspaceMembershipQuery, instance=True),
        members=create_autospec(WorkspaceMemberWriter, instance=True),
    )


def test_activation_starts_at_workspace_commit_and_retries_reuse_membership(
    gateway: tuple[WorkspaceProvisioningService, Signal], sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, signal = gateway
    policy = create_autospec(WorkspaceCreationPolicy, instance=True)
    service = _service(
        owners=SQLAlchemyAccountRepository(sqlite_session_factory),
        provisioning=WorkspaceRepository(sqlite_session_factory),
        effects=WorkspaceProvisioningEffectsGateway(),
        policies=policy,
    )
    with sqlite_session_factory.begin() as session:
        account = Account(name="End User", email="consumer@example.com", status=AccountStatus.UNINITIALIZED)
        account.created_at = datetime(2020, 1, 1)
        session.add(account)
        account_id = account.id
    emitted = []

    def observe(workspace: CreatedWorkspace) -> None:
        with sqlite_session_factory() as session:
            owner = session.get(Account, account_id)
            assert owner is not None
            assert owner.first_workspace_created_at == workspace.created_at
            assert owner.initialized_at == workspace.created_at
            assert owner.status == AccountStatus.ACTIVE
        emitted.append(workspace.id)

    signal.connect(observe)
    result = service.activate(account_id, name="First workspace")
    policy.is_workspace_creation_allowed.return_value = False
    repeated = service.activate(account_id, name="Ignored retry name")

    assert result == repeated
    assert result.workspace_id is not None
    assert result.first_workspace_created_at is not None
    assert result.first_workspace_created_at > datetime(2020, 1, 1)
    assert emitted == [result.workspace_id]
    with sqlite_session_factory() as session:
        owner = session.get(Account, account_id)
        assert owner is not None
        assert owner.initialized_at == owner.first_workspace_created_at
        assert owner.status == AccountStatus.ACTIVE
        assert session.scalars(select(Tenant.id)).all() == [result.workspace_id]


@pytest.mark.parametrize("status", [AccountStatus.PENDING, AccountStatus.BANNED, AccountStatus.CLOSED])
def test_activation_keeps_non_uninitialized_account_lifecycles(
    gateway: tuple[WorkspaceProvisioningService, Signal],
    sqlite_session_factory: sessionmaker[Session],
    status: AccountStatus,
) -> None:
    service, _ = gateway
    with sqlite_session_factory.begin() as session:
        account = Account(name="Existing", email="existing@example.com", status=status)
        session.add(account)
        account_id = account.id

    result = service.activate(account_id, name="First workspace")

    assert result.workspace_id is not None
    with sqlite_session_factory() as session:
        owner = session.get(Account, account_id)
        assert owner is not None
        assert owner.status == status
        assert owner.initialized_at is None


def test_invited_membership_does_not_create_a_personal_workspace_or_start_activation(
    gateway: tuple[WorkspaceProvisioningService, Signal], sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, _ = gateway
    with sqlite_session_factory.begin() as session:
        account = Account(name="Invited", email="invited@example.com")
        workspace = Tenant(name="Team")
        session.add_all([account, workspace])
        session.add(TenantAccountJoin(account_id=account.id, tenant_id=workspace.id, role=TenantAccountRole.NORMAL))
        account_id, workspace_id = account.id, workspace.id

    result = service.activate(account_id, name="Ignored")

    assert result.workspace_id == workspace_id
    assert result.first_workspace_created_at is None
    with sqlite_session_factory() as session:
        assert session.scalars(select(Tenant.id)).all() == [workspace_id]


def test_removed_workspace_does_not_reset_builder_origin(
    gateway: tuple[WorkspaceProvisioningService, Signal], sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, _ = gateway
    first_created_at = datetime(2020, 1, 1)
    with sqlite_session_factory.begin() as session:
        account = Account(name="Builder", email="builder@example.com", first_workspace_created_at=first_created_at)
        session.add(account)
        account_id = account.id

    result = service.activate(account_id, name="Restored")

    assert result.workspace_id is not None
    assert result.first_workspace_created_at == first_created_at


@pytest.mark.parametrize("status", [TenantStatus.NORMAL, TenantStatus.ARCHIVE])
def test_activation_preserves_recorded_origin_with_existing_workspace(
    gateway: tuple[WorkspaceProvisioningService, Signal],
    sqlite_session_factory: sessionmaker[Session],
    status: TenantStatus,
) -> None:
    service, _ = gateway
    recorded_at = datetime(2019, 1, 1)
    historical_created_at = datetime(2020, 1, 1)
    with sqlite_session_factory.begin() as session:
        account = Account(name="Builder", email="builder@example.com", first_workspace_created_at=recorded_at)
        historical = Tenant(name="Historical", status=status)
        historical.created_at = historical_created_at
        session.add_all([account, historical])
        session.add(TenantAccountJoin(account_id=account.id, tenant_id=historical.id, role=TenantAccountRole.OWNER))
        account_id, historical_id = account.id, historical.id

    result = service.activate(account_id, name="Restored")
    repeated = service.activate(account_id, name="Repeated")

    assert result == repeated
    assert result.first_workspace_created_at == recorded_at
    assert (result.workspace_id == historical_id) is (status == TenantStatus.NORMAL)
    with sqlite_session_factory() as session:
        persisted = session.get(Account, account_id)
        assert persisted is not None
        assert persisted.first_workspace_created_at == recorded_at
        assert persisted.initialized_at is None


def test_activation_policy_failure_rolls_back_without_starting_builder_lifecycle(
    gateway: tuple[WorkspaceProvisioningService, Signal], sqlite_session_factory: sessionmaker[Session]
) -> None:
    service, _ = gateway
    policy = create_autospec(WorkspaceCreationPolicy, instance=True)
    service = _service(
        owners=SQLAlchemyAccountRepository(sqlite_session_factory),
        provisioning=WorkspaceRepository(sqlite_session_factory),
        effects=WorkspaceProvisioningEffectsGateway(),
        policies=policy,
    )
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="user@example.com")
        session.add(account)
        account_id = account.id
    policy.is_workspace_creation_allowed.return_value = False

    with pytest.raises(WorkSpaceNotAllowedCreateError):
        service.activate(account_id, name="Blocked")

    with sqlite_session_factory() as session:
        owner = session.get(Account, account_id)
        assert owner is not None
        assert owner.first_workspace_created_at is None
        assert session.scalar(select(Tenant.id)) is None


def test_activation_prepare_failure_rolls_back_membership_and_first_creation_time(
    gateway: tuple[WorkspaceProvisioningService, Signal],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, _ = gateway
    with sqlite_session_factory.begin() as session:
        account = Account(name="User", email="user@example.com")
        session.add(account)
        account_id = account.id

    def fail_binding(workspace_id: str, account_id: str) -> None:
        assert workspace_id
        assert account_id
        raise RuntimeError("Binding unavailable")

    monkeypatch.setattr(service._effects, "bind_owner", fail_binding)
    with pytest.raises(RuntimeError, match="Binding unavailable"):
        service.activate(account_id, name="Interrupted")

    with sqlite_session_factory() as session:
        owner = session.get(Account, account_id)
        assert owner is not None
        assert owner.first_workspace_created_at is None
        assert session.scalar(select(Tenant.id)) is None
        assert session.scalar(select(TenantAccountJoin.id)) is None
