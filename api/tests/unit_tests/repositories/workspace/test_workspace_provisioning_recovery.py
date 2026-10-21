"""Persistent workspace provisioning outcomes and compensation recovery."""

from datetime import timedelta
from unittest.mock import create_autospec

import pytest
from sqlalchemy import Select, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import ORMExecuteState, Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models import WorkspaceProvisioningOperation
from models.account import Tenant
from repositories.workspace.workspace_repository import WorkspaceRepository
from services.workspace.contracts import (
    WorkspaceCreation,
    WorkspaceProvisioningCommitOutcome,
)
from services.workspace.provisioning_service import (
    WorkspaceCreationPolicy,
    WorkspaceMembershipQuery,
    WorkspaceMemberWriter,
    WorkspaceOwnerQuery,
    WorkspacePreparationCancelledError,
    WorkspaceProvisioningEffects,
    WorkspaceProvisioningRecoveryService,
    WorkspaceProvisioningService,
)
from services.workspace.quota import DeploymentQuotaSnapshot


def test_unknown_resolution_uses_workspace_identity_without_membership(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkspaceRepository(sqlite_session_factory)
    preparation = repository.start_preparation(owner_id="owner")
    assert repository.checkpoint_preparation(preparation, key_prepared=True, rbac_prepared=True, ready=True)
    repository.record_commit_unknown(preparation, error="commit response lost")

    compensation = repository.resolve_preparation(preparation.workspace_id)

    assert compensation is not None
    assert compensation.workspace_id == preparation.workspace_id
    assert compensation.owner_id == "owner"


def test_unknown_resolution_retains_resources_when_tenant_exists(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkspaceRepository(sqlite_session_factory)
    preparation = repository.start_preparation(owner_id="former-owner")
    repository.record_commit_unknown(preparation, error="commit response lost")
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Committed")
        tenant.id = preparation.workspace_id
        session.add(tenant)

    assert repository.resolve_preparation(preparation.workspace_id) is None
    with sqlite_session_factory() as session:
        operation = session.get(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation is not None
        assert operation.status == "committed"


def test_compensation_request_rechecks_tenant_before_reopening_cleanup(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkspaceRepository(sqlite_session_factory)
    preparation = repository.start_preparation(owner_id="owner")
    repository.record_commit_unknown(preparation, error="commit response lost")
    with sqlite_session_factory.begin() as session:
        tenant = Tenant(name="Committed")
        tenant.id = preparation.workspace_id
        session.add(tenant)

    assert not repository.request_compensation(preparation, error="late provider completion")
    with sqlite_session_factory() as session:
        operation = session.get(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation is not None
        assert operation.status == "committed"


def test_recovery_isolates_expired_preparer_and_retries_failed_compensation(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkspaceRepository(sqlite_session_factory)
    preparation = repository.start_preparation(owner_id="owner")
    with sqlite_session_factory.begin() as session:
        operation = session.get(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation is not None
        operation.lease_expires_at = naive_utc_now() - timedelta(seconds=1)

    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.discard_key.side_effect = [RuntimeError("provider unavailable"), None]
    recovery = WorkspaceProvisioningRecoveryService(preparations=repository, effects=effects)

    assert recovery.recover() == 0
    with sqlite_session_factory() as session:
        operation = session.get(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation is not None
        assert operation.status == "compensation_failed"
        assert operation.lease_id is None
    assert recovery.recover() == 1
    with sqlite_session_factory() as session:
        operation = session.get(WorkspaceProvisioningOperation, preparation.workspace_id)
        assert operation is not None
        assert operation.status == "compensation_watch"
        assert operation.compensation_attempts == 2


def test_late_provider_completion_reopens_compensation_and_keeps_a_durable_watch(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkspaceRepository(sqlite_session_factory)
    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    recovery = WorkspaceProvisioningRecoveryService(preparations=repository, effects=effects)
    policy = create_autospec(WorkspaceCreationPolicy, instance=True)
    policy.quota_snapshot.return_value = DeploymentQuotaSnapshot(None, 0, None, 0)
    service = WorkspaceProvisioningService(
        owners=create_autospec(WorkspaceOwnerQuery, instance=True),
        provisioning=repository,
        effects=effects,
        policies=policy,
        memberships=create_autospec(WorkspaceMembershipQuery, instance=True),
        members=create_autospec(WorkspaceMemberWriter, instance=True),
    )

    def finish_key_after_recovery(workspace_id: str, name: str) -> WorkspaceCreation:
        with sqlite_session_factory.begin() as session:
            operation = session.get(WorkspaceProvisioningOperation, workspace_id)
            assert operation is not None
            operation.lease_expires_at = naive_utc_now() - timedelta(seconds=1)
        # The recovery delete returns while the original provider call is still
        # in flight; returning below represents the key appearing afterwards.
        assert recovery.recover() == 1
        return WorkspaceCreation(workspace_id, name, "late-key", 0, 0, {})

    effects.prepare.side_effect = finish_key_after_recovery

    with pytest.raises(WorkspacePreparationCancelledError):
        service.create(name="Late provider")

    # The live caller observes its canceled lease and reopens compensation, so
    # the late key is deleted instead of treating the first cleanup as final.
    assert effects.discard_key.call_count == 2
    workspace_id = effects.prepare.call_args.args[0]
    with sqlite_session_factory.begin() as session:
        operation = session.get(WorkspaceProvisioningOperation, workspace_id)
        assert operation is not None
        assert operation.status == "compensation_watch"
        assert operation.compensation_attempts == 2
        # A process could die after the provider returns and before it reopens
        # compensation. Age the tombstone to exercise its durable fallback.
        operation.updated_at = naive_utc_now() - timedelta(minutes=6)

    assert recovery.recover() == 1
    assert effects.discard_key.call_count == 3
    with sqlite_session_factory() as session:
        operation = session.get(WorkspaceProvisioningOperation, workspace_id)
        assert operation is not None
        assert operation.status == "compensation_watch"
        assert operation.compensation_attempts == 3


def test_provision_locks_operation_before_quota_or_aggregate_reads(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    repository = WorkspaceRepository(sqlite_session_factory)
    preparation = repository.start_preparation(owner_id=None)
    assert repository.checkpoint_preparation(preparation, key_prepared=True, ready=True)
    statements: list[str] = []

    def record_statement(execution: ORMExecuteState) -> None:
        if isinstance(execution.statement, Select):
            statements.append(str(execution.statement.compile(dialect=postgresql.dialect())))

    event.listen(sqlite_session_factory, "do_orm_execute", record_statement)
    try:
        result = repository.provision(
            WorkspaceCreation(preparation.workspace_id, "Workspace", "key", 0, 0, {}),
            preparation=preparation,
            owner_id=None,
            quota=DeploymentQuotaSnapshot(None, 0, None, 0),
        )
    finally:
        event.remove(sqlite_session_factory, "do_orm_execute", record_statement)

    assert result.outcome == WorkspaceProvisioningCommitOutcome.COMMITTED
    assert statements
    assert "FROM workspace_provisioning_operations" in statements[0]
    assert "FOR UPDATE" in statements[0]
