"""Real-database barriers and recovery for durable workspace provisioning."""

from __future__ import annotations

from collections.abc import Callable, Generator
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event, current_thread
from typing import cast
from unittest.mock import Mock, create_autospec
from uuid import uuid4

import pytest
import sqlalchemy as sa
from sqlalchemy import delete, event, select
from sqlalchemy.engine import Connection, Engine, ExecutionContext
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models import WorkspaceProvisioningOperation
from models.account import Account, AccountStatus, Tenant, TenantAccountJoin, TenantPluginAutoUpgradeStrategy
from models.model import TenantCreditPool
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.workspace.contracts import (
    WorkspaceCreation,
    WorkspacePreparation,
    WorkspaceProvisioningCommitOutcome,
)
from services.workspace.provisioning_service import (
    WorkspaceCreationPolicy,
    WorkspaceMembershipQuery,
    WorkspaceMemberWriter,
    WorkspaceOwnerQuery,
    WorkspaceProvisioningEffects,
    WorkspaceProvisioningRecoveryService,
    WorkspaceProvisioningService,
)
from services.workspace.quota import DeploymentQuotaSnapshot

_UNLIMITED_QUOTA = DeploymentQuotaSnapshot(
    seat_limit=None,
    seat_usage=0,
    workspace_limit=None,
    workspace_usage=0,
)
_RECOVERY_TABLES = tuple(
    cast(sa.Table, model.__table__)
    for model in (
        Account,
        Tenant,
        TenantAccountJoin,
        TenantPluginAutoUpgradeStrategy,
        TenantCreditPool,
        WorkspaceProvisioningOperation,
    )
)


@pytest.fixture(params=("postgresql", "mysql"), scope="module")
def recovery_engine(request: pytest.FixtureRequest) -> Generator[Engine]:
    if request.param == "postgresql":
        testcontainers_postgres = pytest.importorskip("testcontainers.postgres")
        container = testcontainers_postgres.PostgresContainer("postgres:15-alpine")
    else:
        testcontainers_mysql = pytest.importorskip("testcontainers.mysql")
        container = testcontainers_mysql.MySqlContainer("mysql:8.0")

    container.start()
    engine = sa.create_engine(container.get_connection_url().replace("mysql://", "mysql+pymysql://", 1))
    WorkspaceProvisioningOperation.metadata.create_all(engine, tables=_RECOVERY_TABLES)
    try:
        yield engine
    finally:
        engine.dispose()
        container.stop()


@pytest.fixture
def recovery_sessions(recovery_engine: Engine) -> sessionmaker[Session]:
    with recovery_engine.begin() as connection:
        for table in reversed(_RECOVERY_TABLES):
            connection.execute(table.delete())
    return sessionmaker(bind=recovery_engine, expire_on_commit=False)


def _prepared_workspace(
    repository: WorkspaceRepository,
    sessions: sessionmaker[Session],
    *,
    owner_id: str | None,
    expired: bool,
) -> WorkspacePreparation:
    preparation = repository.start_preparation(owner_id=owner_id)
    assert repository.checkpoint_preparation(
        preparation,
        key_prepared=True,
        rbac_prepared=owner_id is not None,
        ready=True,
    )
    if expired:
        with sessions.begin() as session:
            operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
            operation.lease_expires_at = naive_utc_now() - timedelta(seconds=1)
    return preparation


def _creation(preparation: WorkspacePreparation) -> WorkspaceCreation:
    return WorkspaceCreation(
        id=preparation.workspace_id,
        name="Recovered workspace",
        encrypt_public_key="public-key",
        trial_credits=0,
        plugin_upgrade_time=0,
        plugin_upgrade_settings={},
    )


def _normalize_sql(statement: str) -> str:
    return " ".join(statement.lower().replace("`", "").replace('"', "").split())


def _observe_recovery_lock(
    attempted: Event,
) -> Callable[[Connection, object, str, object, ExecutionContext, bool], None]:
    def observe(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        sql = _normalize_sql(statement)
        if (
            current_thread().name.startswith("workspace-recovery")
            and "from workspace_provisioning_operations" in sql
            and "for update" in sql
        ):
            attempted.set()

    return observe


def test_unlimited_quota_recovery_waits_for_original_commit_then_retains_resources(
    recovery_engine: Engine,
    recovery_sessions: sessionmaker[Session],
) -> None:
    engine, sessions = recovery_engine, recovery_sessions
    repository = WorkspaceRepository(sessions)
    preparation = _prepared_workspace(repository, sessions, owner_id=None, expired=True)
    provision_holds_mutex = Event()
    allow_commit = Event()
    recovery_attempted_mutex = Event()

    def hold_before_commit(_session: Session) -> None:
        if current_thread().name.startswith("workspace-provision"):
            provision_holds_mutex.set()
            assert allow_commit.wait(timeout=20)

    observe_recovery_lock = _observe_recovery_lock(recovery_attempted_mutex)
    event.listen(sessions.class_, "before_commit", hold_before_commit)
    event.listen(engine, "before_cursor_execute", observe_recovery_lock)
    try:
        with (
            ThreadPoolExecutor(max_workers=1, thread_name_prefix="workspace-provision") as provision_executor,
            ThreadPoolExecutor(max_workers=1, thread_name_prefix="workspace-recovery") as recovery_executor,
        ):
            provision_future = provision_executor.submit(
                repository.provision,
                _creation(preparation),
                preparation=preparation,
                owner_id=None,
                quota=_UNLIMITED_QUOTA,
            )
            try:
                assert provision_holds_mutex.wait(timeout=20)
                recovery_future = recovery_executor.submit(repository.resolve_preparation, preparation.workspace_id)
                assert recovery_attempted_mutex.wait(timeout=20)
                assert not recovery_future.done()
            finally:
                allow_commit.set()

            provisioned = provision_future.result(timeout=30)
            compensation = recovery_future.result(timeout=30)
    finally:
        allow_commit.set()
        event.remove(engine, "before_cursor_execute", observe_recovery_lock)
        event.remove(sessions.class_, "before_commit", hold_before_commit)

    assert provisioned.outcome is WorkspaceProvisioningCommitOutcome.COMMITTED
    assert compensation is None
    with sessions() as session:
        assert session.get(Tenant, preparation.workspace_id) is not None
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "committed"


def test_unlimited_quota_recovery_waits_for_original_rollback_then_compensates(
    recovery_engine: Engine,
    recovery_sessions: sessionmaker[Session],
) -> None:
    engine, sessions = recovery_engine, recovery_sessions
    repository = WorkspaceRepository(sessions)
    preparation = _prepared_workspace(repository, sessions, owner_id=None, expired=True)
    provision_holds_mutex = Event()
    allow_rollback = Event()
    recovery_attempted_mutex = Event()

    def reject_provision_flush(_session: Session, _context: object, _instances: object) -> None:
        if current_thread().name.startswith("workspace-provision"):
            provision_holds_mutex.set()
            assert allow_rollback.wait(timeout=20)
            raise RuntimeError("aggregate flush failed")

    observe_recovery_lock = _observe_recovery_lock(recovery_attempted_mutex)
    event.listen(sessions.class_, "before_flush", reject_provision_flush)
    event.listen(engine, "before_cursor_execute", observe_recovery_lock)
    try:
        with (
            ThreadPoolExecutor(max_workers=1, thread_name_prefix="workspace-provision") as provision_executor,
            ThreadPoolExecutor(max_workers=1, thread_name_prefix="workspace-recovery") as recovery_executor,
        ):
            provision_future = provision_executor.submit(
                repository.provision,
                _creation(preparation),
                preparation=preparation,
                owner_id=None,
                quota=_UNLIMITED_QUOTA,
            )
            try:
                assert provision_holds_mutex.wait(timeout=20)
                recovery_future = recovery_executor.submit(repository.resolve_preparation, preparation.workspace_id)
                assert recovery_attempted_mutex.wait(timeout=20)
                assert not recovery_future.done()
            finally:
                allow_rollback.set()

            provisioned = provision_future.result(timeout=30)
            compensation = recovery_future.result(timeout=30)
    finally:
        allow_rollback.set()
        event.remove(engine, "before_cursor_execute", observe_recovery_lock)
        event.remove(sessions.class_, "before_flush", reject_provision_flush)

    assert provisioned.outcome is WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT
    assert isinstance(provisioned.error, RuntimeError)
    assert compensation is not None
    assert compensation.workspace_id == preparation.workspace_id
    assert compensation.owner_id is None
    with sessions() as session:
        assert session.get(Tenant, preparation.workspace_id) is None
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "compensation_pending"


def test_commit_ack_loss_returns_typed_unknown_and_preserves_committed_workspace(
    recovery_sessions: sessionmaker[Session],
) -> None:
    sessions = recovery_sessions
    repository = WorkspaceRepository(sessions)
    preparation = _prepared_workspace(repository, sessions, owner_id=None, expired=False)

    def lose_commit_ack(_session: Session) -> None:
        raise RuntimeError("commit acknowledgement lost")

    event.listen(sessions.class_, "after_commit", lose_commit_ack)
    try:
        result = repository.provision(
            _creation(preparation),
            preparation=preparation,
            owner_id=None,
            quota=_UNLIMITED_QUOTA,
        )
    finally:
        event.remove(sessions.class_, "after_commit", lose_commit_ack)

    assert result.outcome is WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN
    assert isinstance(result.error, RuntimeError)
    repository.record_commit_unknown(preparation, error="commit acknowledgement lost")

    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    assert WorkspaceProvisioningRecoveryService(preparations=repository, effects=effects).recover() == 0
    effects.unbind_owner.assert_not_called()
    effects.discard_key.assert_not_called()
    with sessions() as session:
        assert session.get(Tenant, preparation.workspace_id) is not None
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "committed"


def test_removed_membership_does_not_turn_committed_workspace_into_key_compensation(
    recovery_sessions: sessionmaker[Session],
) -> None:
    sessions = recovery_sessions
    owner_id = str(uuid4())
    with sessions.begin() as session:
        owner = Account(
            email=f"{uuid4()}@example.com",
            name="Former owner",
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        owner.id = owner_id
        session.add(owner)

    repository = WorkspaceRepository(sessions)
    preparation = _prepared_workspace(repository, sessions, owner_id=owner_id, expired=False)
    result = repository.provision(
        _creation(preparation),
        preparation=preparation,
        owner_id=owner_id,
        quota=_UNLIMITED_QUOTA,
    )
    assert result.outcome is WorkspaceProvisioningCommitOutcome.COMMITTED
    with sessions.begin() as session:
        session.execute(
            delete(TenantAccountJoin).where(
                TenantAccountJoin.tenant_id == preparation.workspace_id,
                TenantAccountJoin.account_id == owner_id,
            )
        )
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        operation.status = "commit_unknown"
        operation.finished_at = None
        operation.last_error = "durable commit acknowledgement was lost"

    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    assert WorkspaceProvisioningRecoveryService(preparations=repository, effects=effects).recover() == 0
    effects.unbind_owner.assert_not_called()
    effects.discard_key.assert_not_called()
    with sessions() as session:
        assert session.get(Tenant, preparation.workspace_id) is not None
        assert (
            session.scalar(select(TenantAccountJoin.id).where(TenantAccountJoin.tenant_id == preparation.workspace_id))
            is None
        )
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "committed"


def test_database_unavailable_during_current_read_preserves_recovery_resources(
    recovery_engine: Engine,
    recovery_sessions: sessionmaker[Session],
) -> None:
    engine, sessions = recovery_engine, recovery_sessions
    repository = WorkspaceRepository(sessions)
    preparation = _prepared_workspace(repository, sessions, owner_id=str(uuid4()), expired=False)
    repository.record_commit_unknown(preparation, error="commit response lost")
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)

    def reject_locked_current_read(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: ExecutionContext,
        _executemany: bool,
    ) -> None:
        sql = _normalize_sql(statement)
        if "from workspace_provisioning_operations" in sql and "for update" in sql:
            raise OperationalError(statement, None, RuntimeError("database unavailable"))

    event.listen(engine, "before_cursor_execute", reject_locked_current_read)
    try:
        with pytest.raises(OperationalError, match="database unavailable"):
            WorkspaceProvisioningRecoveryService(preparations=repository, effects=effects).recover()
    finally:
        event.remove(engine, "before_cursor_execute", reject_locked_current_read)

    effects.unbind_owner.assert_not_called()
    effects.discard_key.assert_not_called()
    with sessions() as session:
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "commit_unknown"
        assert operation.compensation_attempts == 0


def test_setup_marker_failure_compensation_retries_after_process_restart(
    recovery_sessions: sessionmaker[Session],
) -> None:
    sessions = recovery_sessions
    owner_id = str(uuid4())
    with sessions.begin() as session:
        owner = Account(
            email=f"{uuid4()}@example.com",
            name="Setup owner",
            interface_language="en-US",
            status=AccountStatus.ACTIVE,
        )
        owner.id = owner_id
        session.add(owner)

    repository = WorkspaceRepository(sessions)
    preparation = _prepared_workspace(repository, sessions, owner_id=owner_id, expired=False)
    provisioned = repository.provision(
        _creation(preparation),
        preparation=preparation,
        owner_id=owner_id,
        quota=_UNLIMITED_QUOTA,
    )
    assert provisioned.outcome is WorkspaceProvisioningCommitOutcome.COMMITTED

    first_effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    first_effects.discard_key.side_effect = RuntimeError("provider unavailable")
    workspace_service = WorkspaceProvisioningService(
        owners=create_autospec(WorkspaceOwnerQuery, instance=True),
        provisioning=repository,
        effects=first_effects,
        policies=create_autospec(WorkspaceCreationPolicy, instance=True),
        memberships=create_autospec(WorkspaceMembershipQuery, instance=True),
        members=create_autospec(WorkspaceMemberWriter, instance=True),
    )
    workspace_service.cancel_setup_workspace(workspace_id=preparation.workspace_id, owner_id=owner_id)

    first_effects.unbind_owner.assert_called_once_with(preparation.workspace_id, owner_id)
    first_effects.discard_key.assert_called_once_with(preparation.workspace_id)
    with sessions() as session:
        assert session.get(Tenant, preparation.workspace_id) is None
        assert session.get(Account, owner_id) is not None
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "compensation_failed"
        assert operation.compensation_attempts == 1

    restarted_repository = WorkspaceRepository(sessions)
    restarted_effects: Mock = create_autospec(WorkspaceProvisioningEffects, instance=True)
    restarted = WorkspaceProvisioningRecoveryService(
        preparations=restarted_repository,
        effects=restarted_effects,
    )
    assert restarted.recover() == 1
    restarted_effects.unbind_owner.assert_called_once_with(preparation.workspace_id, owner_id)
    restarted_effects.discard_key.assert_called_once_with(preparation.workspace_id)
    with sessions() as session:
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation.status == "compensation_watch"
        assert operation.compensation_attempts == 2
