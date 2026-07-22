from __future__ import annotations

import pytest
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState, KnowledgeFSLifecycleOutbox
from services.knowledge_fs.lifecycle_port import (
    KnowledgeFSCapabilityGrantRevokeAck,
    KnowledgeFSCapabilityGrantRevokeRequest,
    KnowledgeFSDeletionProgress,
    KnowledgeFSIntegratedDeletionRequest,
    KnowledgeFSIntegratedProvisionRequest,
    KnowledgeFSRemoteSpace,
)
from services.knowledge_fs.orphan_reconciler import KnowledgeFSOrphanReconciler


class FakeRemote:
    def __init__(self, spaces: tuple[KnowledgeFSRemoteSpace, ...]):
        self.spaces = spaces
        self.list_requests: list[tuple[str, str]] = []

    def provision_integrated_space(self, request: KnowledgeFSIntegratedProvisionRequest) -> KnowledgeFSRemoteSpace:
        raise AssertionError("not used")

    def request_integrated_deletion(self, request: KnowledgeFSIntegratedDeletionRequest) -> KnowledgeFSDeletionProgress:
        raise AssertionError("not used")

    def revoke_capability_grant(
        self, request: KnowledgeFSCapabilityGrantRevokeRequest
    ) -> KnowledgeFSCapabilityGrantRevokeAck:
        raise AssertionError(request)

    def find_by_provisioning_key(
        self,
        *,
        provisioning_key: str,
        control_space_id: str,
    ) -> KnowledgeFSRemoteSpace | None:
        del control_space_id
        return next((space for space in self.spaces if space.provisioning_key == provisioning_key), None)

    def list_spaces(
        self,
        *,
        namespace_id: str,
        control_space_id: str,
    ) -> tuple[KnowledgeFSRemoteSpace, ...]:
        self.list_requests.append((namespace_id, control_space_id))
        return tuple(space for space in self.spaces if namespace_id == space.namespace_id)


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_reconciler_repairs_proven_identity_and_only_reports_unknown_remote_orphan(sqlite_session: Session) -> None:
    local = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        lifecycle_operation_id="operation-1",
    )
    sqlite_session.add(local)
    sqlite_session.commit()
    remote = FakeRemote(
        (
            KnowledgeFSRemoteSpace("tenant-1", "space-1", "provision-1", 2),
            KnowledgeFSRemoteSpace("tenant-1", "space-orphan", "provision-orphan", 1),
        )
    )

    report = KnowledgeFSOrphanReconciler(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), remote
    ).reconcile()

    with Session(sqlite_session.get_bind()) as session:
        persisted = session.get(KnowledgeFSControlSpace, local.id)
    assert report.repaired_control_space_ids == (local.id,)
    assert report.remote_orphan_space_ids == ("space-orphan",)
    assert persisted is not None
    assert persisted.state is KnowledgeFSControlSpaceState.ACTIVE
    assert persisted.knowledge_space_revision == 2
    assert remote.list_requests == [("tenant-1", local.id)]


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_reconciler_does_not_report_locals_outside_repair_limit_as_remote_orphans(sqlite_session: Session) -> None:
    locals_ = (
        KnowledgeFSControlSpace(
            tenant_id="tenant-1",
            owner_account_id="account-1",
            provisioning_key="provision-1",
        ),
        KnowledgeFSControlSpace(
            tenant_id="tenant-1",
            owner_account_id="account-1",
            provisioning_key="provision-2",
        ),
    )
    sqlite_session.add_all(locals_)
    sqlite_session.commit()
    remote = FakeRemote(
        (
            KnowledgeFSRemoteSpace("tenant-1", "space-1", "provision-1", 1),
            KnowledgeFSRemoteSpace("tenant-1", "space-2", "provision-2", 1),
        )
    )

    report = KnowledgeFSOrphanReconciler(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), remote
    ).reconcile(limit=1, apply_repairs=False)

    assert report.remote_orphan_space_ids == ()
    assert len(remote.list_requests) == 1
    assert remote.list_requests[0][0] == "tenant-1"
    assert remote.list_requests[0][1] in {space.id for space in locals_}


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_reconciler_does_not_reactivate_ambiguous_error_state(sqlite_session: Session) -> None:
    local = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-error",
        lifecycle_operation_id="delete-operation",
        state=KnowledgeFSControlSpaceState.ERROR,
    )
    sqlite_session.add(local)
    sqlite_session.commit()
    remote = FakeRemote((KnowledgeFSRemoteSpace("tenant-1", "space-error", "provision-error", 2),))

    report = KnowledgeFSOrphanReconciler(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), remote
    ).reconcile()

    with Session(sqlite_session.get_bind()) as session:
        persisted = session.get(KnowledgeFSControlSpace, local.id)
    assert report.repaired_control_space_ids == ()
    assert persisted is not None
    assert persisted.state is KnowledgeFSControlSpaceState.ERROR
    assert persisted.knowledge_space_id is None


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_reconciler_prioritizes_stuck_lifecycle_state_over_older_active_rows(sqlite_session: Session) -> None:
    old_active = (
        KnowledgeFSControlSpace(
            tenant_id="tenant-1",
            owner_account_id="account-1",
            provisioning_key="active-1",
            knowledge_space_id="active-space-1",
            state=KnowledgeFSControlSpaceState.ACTIVE,
        ),
        KnowledgeFSControlSpace(
            tenant_id="tenant-1",
            owner_account_id="account-1",
            provisioning_key="active-2",
            knowledge_space_id="active-space-2",
            state=KnowledgeFSControlSpaceState.ACTIVE,
        ),
    )
    stuck = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="stuck-provision",
        lifecycle_operation_id="provision-operation",
    )
    sqlite_session.add_all((*old_active, stuck))
    sqlite_session.flush()
    for active in old_active:
        active.updated_at = active.updated_at.replace(year=2025)
    stuck.updated_at = stuck.updated_at.replace(year=2026)
    sqlite_session.commit()
    remote = FakeRemote(
        (
            KnowledgeFSRemoteSpace("tenant-1", "active-space-1", "active-1", 1),
            KnowledgeFSRemoteSpace("tenant-1", "active-space-2", "active-2", 1),
            KnowledgeFSRemoteSpace("tenant-1", "recovered-space", "stuck-provision", 2),
        )
    )

    report = KnowledgeFSOrphanReconciler(
        sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False), remote
    ).reconcile(limit=1)

    with Session(sqlite_session.get_bind()) as session:
        persisted = session.get(KnowledgeFSControlSpace, stuck.id)
    assert report.repaired_control_space_ids == (stuck.id,)
    assert persisted is not None
    assert persisted.state is KnowledgeFSControlSpaceState.ACTIVE
    assert persisted.knowledge_space_id == "recovered-space"
