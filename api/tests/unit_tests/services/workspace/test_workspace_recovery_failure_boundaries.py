"""Durable workspace recovery behavior at claim and commit failure boundaries."""

from datetime import timedelta
from unittest.mock import create_autospec

import pytest
from sqlalchemy import event, select
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from models import (
    WorkspaceOwnerTransferNotification as WorkspaceOwnerTransferNotificationModel,
)
from models import (
    WorkspaceOwnerTransferOperation,
    WorkspaceProvisioningOperation,
)
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from services.workspace.contracts import (
    WorkspaceCreation,
    WorkspaceOwnerTransfer,
    WorkspaceOwnerTransferNotification,
    WorkspaceOwnerTransferNotificationDetails,
    WorkspacePreparation,
    WorkspaceProvisioningCommitOutcome,
)
from services.workspace.member_service import (
    OwnerTransferNotificationGateway,
    WorkspaceOwnerTransferNotificationService,
    WorkspaceOwnerTransferRecoveryService,
)
from services.workspace.provisioning_service import (
    WorkspaceProvisioningEffects,
    WorkspaceProvisioningRecoveryService,
)
from services.workspace.quota import DeploymentQuotaSnapshot
from tests.unit_tests.account_domain import AccountDomain


@pytest.fixture
def workspace_members(sqlite_session: Session) -> tuple[str, str, str]:
    owner = Account(name="Owner", email="owner@example.com")
    member = Account(name="Member", email="member@example.com")
    workspace = Tenant(name="Workspace")
    sqlite_session.add_all(
        [
            owner,
            member,
            workspace,
            TenantAccountJoin(
                account_id=owner.id,
                tenant_id=workspace.id,
                role=TenantAccountRole.OWNER,
                current=True,
            ),
            TenantAccountJoin(
                account_id=member.id,
                tenant_id=workspace.id,
                role=TenantAccountRole.NORMAL,
            ),
        ]
    )
    sqlite_session.commit()
    return workspace.id, owner.id, member.id


def _notification_details() -> WorkspaceOwnerTransferNotificationDetails:
    return WorkspaceOwnerTransferNotificationDetails(
        old_owner_email="owner@example.com",
        old_owner_language="en-US",
        new_owner_email="member@example.com",
        new_owner_language="en-US",
        workspace_name="Workspace",
    )


def _transfer_with_notifications(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
) -> WorkspaceOwnerTransfer:
    workspace_id, owner_id, member_id = workspace_members
    return account_domain.members.transfer_owner(
        workspace_id,
        member_id,
        owner_id,
        notification=_notification_details(),
    )


def _prepare_owner_watch(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> WorkspaceOwnerTransfer:
    workspace_id, owner_id, member_id = workspace_members
    transfer = account_domain.workspaces.prepare_owner_transfer(
        workspace_id=workspace_id,
        actor_account_id=owner_id,
        account_id=member_id,
    )
    claimed = account_domain.workspaces.claim_owner_transfer_execution(transfer)
    assert claimed is not None
    assert account_domain.workspaces.complete_owner_transfer(claimed)
    with sqlite_session_factory.begin() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
        operation.next_reconcile_at = naive_utc_now() - timedelta(seconds=1)
    return transfer


def _notification_service(account_domain: AccountDomain) -> WorkspaceOwnerTransferNotificationService:
    return WorkspaceOwnerTransferNotificationService(
        workspaces=account_domain.workspaces,
        gateway=create_autospec(OwnerTransferNotificationGateway, instance=True),
    )


def _provision_setup_workspace(account_domain: AccountDomain, owner_id: str) -> WorkspacePreparation:
    preparation = account_domain.workspaces.start_preparation(owner_id=owner_id)
    assert account_domain.workspaces.checkpoint_preparation(
        preparation,
        key_prepared=True,
        rbac_prepared=True,
        ready=True,
    )
    result = account_domain.workspaces.provision(
        WorkspaceCreation(preparation.workspace_id, "Setup workspace", "public-key", 0, 0, {}),
        preparation=preparation,
        owner_id=owner_id,
        quota=DeploymentQuotaSnapshot(None, 0, None, 0),
    )
    assert result.outcome == WorkspaceProvisioningCommitOutcome.COMMITTED
    return preparation


def test_notification_recovery_skips_a_claim_won_by_another_dispatcher(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transfer = _transfer_with_notifications(account_domain, workspace_members)
    list_pending = account_domain.workspaces.list_pending_owner_transfer_notifications
    competing_claims: list[WorkspaceOwnerTransferNotification] = []

    def list_after_competing_claim(
        *, operation_id: str | None = None, limit: int = 100
    ) -> tuple[WorkspaceOwnerTransferNotification, ...]:
        notifications = list_pending(operation_id=operation_id, limit=limit)
        competing_claim = account_domain.workspaces.claim_owner_transfer_notification(notifications[0])
        assert competing_claim is not None
        competing_claims.append(competing_claim)
        return notifications

    monkeypatch.setattr(
        account_domain.workspaces,
        "list_pending_owner_transfer_notifications",
        list_after_competing_claim,
    )
    gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    delivery = WorkspaceOwnerTransferNotificationService(workspaces=account_domain.workspaces, gateway=gateway)

    assert delivery.deliver_operation(transfer.operation_id) == 1
    assert gateway.notify.call_count == 1
    assert competing_claims
    with sqlite_session_factory() as session:
        claimed_row = session.get_one(
            WorkspaceOwnerTransferNotificationModel,
            competing_claims[0].notification_id,
        )
        statuses = set(session.scalars(select(WorkspaceOwnerTransferNotificationModel.status)))
    assert claimed_row.status == "pending"
    assert claimed_row.claim_id == competing_claims[0].claim_id
    assert statuses == {"pending", "sent"}


def test_notification_ack_does_not_complete_after_an_expired_claim_is_reacquired(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    transfer = _transfer_with_notifications(account_domain, workspace_members)
    competing_claims: list[WorkspaceOwnerTransferNotification] = []

    def expire_and_reacquire(notification: WorkspaceOwnerTransferNotification) -> None:
        with sqlite_session_factory.begin() as session:
            row = session.get_one(WorkspaceOwnerTransferNotificationModel, notification.notification_id)
            row.lease_expires_at = naive_utc_now() - timedelta(seconds=1)
        competing_claim = account_domain.workspaces.claim_owner_transfer_notification(notification)
        assert competing_claim is not None
        assert competing_claim.claim_id != notification.claim_id
        competing_claims.append(competing_claim)

    gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    gateway.notify.side_effect = expire_and_reacquire
    delivery = WorkspaceOwnerTransferNotificationService(workspaces=account_domain.workspaces, gateway=gateway)

    assert delivery.deliver_operation(transfer.operation_id) == 0
    assert len(competing_claims) == 2
    with sqlite_session_factory() as session:
        rows = tuple(session.scalars(select(WorkspaceOwnerTransferNotificationModel)))
    assert {row.status for row in rows} == {"pending"}
    assert {row.claim_id for row in rows} == {claim.claim_id for claim in competing_claims}
    assert {row.attempts for row in rows} == {2}


def test_notification_broker_and_error_ack_failures_preserve_claims_for_recovery(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    transfer = _transfer_with_notifications(account_domain, workspace_members)
    gateway = create_autospec(OwnerTransferNotificationGateway, instance=True)
    fail_next_commit = False

    def fail_broker(_notification: WorkspaceOwnerTransferNotification) -> None:
        nonlocal fail_next_commit
        fail_next_commit = True
        raise RuntimeError("broker unavailable")

    def fail_armed_commit(_connection: Connection) -> None:
        nonlocal fail_next_commit
        if fail_next_commit:
            fail_next_commit = False
            raise RuntimeError("notification error ACK failed")

    gateway.notify.side_effect = fail_broker
    engine = sqlite_session_factory.kw["bind"]
    event.listen(engine, "commit", fail_armed_commit)
    try:
        with pytest.raises(RuntimeError, match="broker unavailable"):
            WorkspaceOwnerTransferNotificationService(
                workspaces=account_domain.workspaces,
                gateway=gateway,
            ).deliver_operation(transfer.operation_id)
    finally:
        event.remove(engine, "commit", fail_armed_commit)

    assert gateway.notify.call_count == 2
    with sqlite_session_factory() as session:
        rows = tuple(session.scalars(select(WorkspaceOwnerTransferNotificationModel)))
    assert {row.status for row in rows} == {"pending"}
    assert all(row.claim_id is not None for row in rows)
    assert {row.last_error for row in rows} == {None}


def test_owner_transfer_recovery_survives_failure_to_record_rbac_error(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, owner_id, member_id = workspace_members
    transfer = account_domain.workspaces.prepare_owner_transfer(
        workspace_id=workspace_id,
        actor_account_id=owner_id,
        account_id=member_id,
    )
    account_domain.access.rbac_enabled = True
    fail_next_commit = False

    def fail_rbac(*_args: object, **_kwargs: object) -> None:
        nonlocal fail_next_commit
        fail_next_commit = True
        raise RuntimeError("RBAC unavailable")

    def fail_armed_commit(_connection: Connection) -> None:
        nonlocal fail_next_commit
        if fail_next_commit:
            fail_next_commit = False
            raise RuntimeError("transfer error ACK failed")

    account_domain.access.reconcile_owner.side_effect = fail_rbac
    engine = sqlite_session_factory.kw["bind"]
    event.listen(engine, "commit", fail_armed_commit)
    try:
        recovered = WorkspaceOwnerTransferRecoveryService(
            workspaces=account_domain.workspaces,
            access=account_domain.access,
            notifications=_notification_service(account_domain),
        ).recover()
    finally:
        event.remove(engine, "commit", fail_armed_commit)

    assert recovered == 0
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
    assert operation.operation_id == transfer.operation_id
    assert operation.status == "pending"
    assert operation.execution_id is not None
    assert operation.last_error is None


def test_owner_transfer_watch_remains_pending_while_rbac_is_disabled(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, _, _ = workspace_members
    transfer = _prepare_owner_watch(account_domain, workspace_members, sqlite_session_factory)
    account_domain.access.rbac_enabled = False

    assert (
        WorkspaceOwnerTransferRecoveryService(
            workspaces=account_domain.workspaces,
            access=account_domain.access,
            notifications=_notification_service(account_domain),
        ).recover()
        == 0
    )
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
    assert operation.operation_id == transfer.operation_id
    assert operation.status == "watch"
    assert operation.execution_id is None
    account_domain.access.reconcile_owner.assert_not_called()


def test_owner_transfer_watch_does_not_complete_after_local_owner_changes(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    workspace_id, old_owner_id, new_owner_id = workspace_members
    _prepare_owner_watch(account_domain, workspace_members, sqlite_session_factory)
    account_domain.access.rbac_enabled = True

    def change_local_owner(*_args: object, **_kwargs: object) -> None:
        with sqlite_session_factory.begin() as session:
            memberships = {
                membership.account_id: membership
                for membership in session.scalars(
                    select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == workspace_id)
                )
            }
            memberships[old_owner_id].role = TenantAccountRole.OWNER
            memberships[new_owner_id].role = TenantAccountRole.NORMAL

    account_domain.access.reconcile_owner.side_effect = change_local_owner
    recovered = WorkspaceOwnerTransferRecoveryService(
        workspaces=account_domain.workspaces,
        access=account_domain.access,
        notifications=_notification_service(account_domain),
    ).recover()

    assert recovered == 0
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceOwnerTransferOperation, workspace_id)
    assert operation.status == "watch"
    assert operation.execution_id is None
    assert operation.last_error == "Local owner changed while the RBAC watch was executing."


def test_provisioning_recovery_persists_all_external_compensation_failures(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    preparation = account_domain.workspaces.start_preparation(owner_id="owner-account")
    with sqlite_session_factory.begin() as session:
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        operation.lease_expires_at = naive_utc_now() - timedelta(seconds=1)

    effects = create_autospec(WorkspaceProvisioningEffects, instance=True)
    effects.unbind_owner.side_effect = RuntimeError("RBAC cleanup unavailable")
    effects.discard_key.side_effect = RuntimeError("key cleanup unavailable")
    recovery = WorkspaceProvisioningRecoveryService(preparations=account_domain.workspaces, effects=effects)

    assert recovery.recover() == 0
    effects.unbind_owner.assert_called_once_with(preparation.workspace_id, "owner-account")
    effects.discard_key.assert_called_once_with(preparation.workspace_id)
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
    assert operation.status == "compensation_failed"
    assert operation.compensation_attempts == 1
    assert operation.last_error == "RBAC cleanup unavailable; key cleanup unavailable"


def test_provisioning_repository_fences_active_and_stale_attempts(
    account_domain: AccountDomain,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    preparation = account_domain.workspaces.start_preparation(owner_id="missing-owner")

    assert account_domain.workspaces.resolve_preparation(preparation.workspace_id) is None
    stale_preparation = WorkspacePreparation(preparation.workspace_id, "superseded-lease")
    assert not account_domain.workspaces.request_compensation(stale_preparation, error="stale caller")
    assert account_domain.workspaces.checkpoint_preparation(preparation, key_prepared=True, ready=True)

    mismatched = account_domain.workspaces.provision(
        WorkspaceCreation("different-workspace", "Workspace", "key", 0, 0, {}),
        preparation=preparation,
        owner_id=None,
        quota=DeploymentQuotaSnapshot(None, 0, None, 0),
    )
    stale = account_domain.workspaces.provision(
        WorkspaceCreation(preparation.workspace_id, "Workspace", "key", 0, 0, {}),
        preparation=stale_preparation,
        owner_id=None,
        quota=DeploymentQuotaSnapshot(None, 0, None, 0),
    )
    missing_owner = account_domain.workspaces.provision(
        WorkspaceCreation(preparation.workspace_id, "Workspace", "key", 0, 0, {}),
        preparation=preparation,
        owner_id="missing-owner",
        quota=DeploymentQuotaSnapshot(None, 0, None, 0),
    )

    assert mismatched.outcome == WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT
    assert isinstance(mismatched.error, ValueError)
    assert stale.outcome == WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT
    assert isinstance(stale.error, RuntimeError)
    assert missing_owner.outcome == WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT
    assert missing_owner.error is not None
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
    assert operation.status == "prepared"
    assert operation.lease_id == preparation.lease_id


def test_setup_cancellation_rejects_a_changed_aggregate_without_deleting_it(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, owner_id, member_id = workspace_members
    preparation = _provision_setup_workspace(account_domain, owner_id)
    with sqlite_session_factory.begin() as session:
        session.add(
            TenantAccountJoin(
                tenant_id=preparation.workspace_id,
                account_id=member_id,
                role=TenantAccountRole.NORMAL,
            )
        )

    result = account_domain.workspaces.cancel_setup_workspace(
        workspace_id=preparation.workspace_id,
        owner_id=owner_id,
    )

    assert result.outcome == WorkspaceProvisioningCommitOutcome.ROLLED_BACK_BEFORE_COMMIT
    assert isinstance(result.error, RuntimeError)
    assert str(result.error) == "setup workspace membership changed before cleanup"
    with sqlite_session_factory() as session:
        assert session.get(Tenant, preparation.workspace_id) is not None
        memberships = tuple(
            session.scalars(select(TenantAccountJoin).where(TenantAccountJoin.tenant_id == preparation.workspace_id))
        )
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
    assert len(memberships) == 2
    assert operation.status == "committed"


def test_setup_cancellation_reports_unknown_commit_and_preserves_recovery_state(
    account_domain: AccountDomain,
    workspace_members: tuple[str, str, str],
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    _, owner_id, _ = workspace_members
    preparation = _provision_setup_workspace(account_domain, owner_id)
    engine = sqlite_session_factory.kw["bind"]

    def fail_commit(_connection: Connection) -> None:
        raise ConnectionError("database acknowledgement lost")

    event.listen(engine, "commit", fail_commit)
    try:
        result = account_domain.workspaces.cancel_setup_workspace(
            workspace_id=preparation.workspace_id,
            owner_id=owner_id,
        )
    finally:
        event.remove(engine, "commit", fail_commit)

    assert result.outcome == WorkspaceProvisioningCommitOutcome.COMMIT_UNKNOWN
    assert isinstance(result.error, ConnectionError)
    with sqlite_session_factory() as session:
        operation = session.get_one(WorkspaceProvisioningOperation, preparation.workspace_id)
        tenant = session.get(Tenant, preparation.workspace_id)
    assert operation.status == "compensation_pending"
    assert tenant is None
