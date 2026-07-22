from __future__ import annotations

from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from sqlalchemy.orm import Session

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState
from repositories.knowledge_fs_control_space_repository import KnowledgeFSControlSpaceCASUpdate
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from services.knowledge_fs.control_space_lifecycle import (
    KnowledgeFSControlSpaceLifecycleService,
    KnowledgeFSControlSpaceVersionConflictError,
    KnowledgeFSInvalidLifecycleTransitionError,
    KnowledgeFSSpaceRegistrationConflictError,
    KnowledgeFSWorkspaceDeletionBlockedError,
)


@pytest.fixture
def repository(sqlite_session: Session) -> SQLAlchemyKnowledgeFSControlSpaceRepository:
    return SQLAlchemyKnowledgeFSControlSpaceRepository(sqlite_session)


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSControlSpace,)], indirect=True)
def test_repository_lookups_are_tenant_scoped(
    sqlite_session: Session,
    repository: SQLAlchemyKnowledgeFSControlSpaceRepository,
) -> None:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    sqlite_session.add(control_space)
    sqlite_session.commit()

    assert repository.get(tenant_id="tenant-1", control_space_id=control_space.id) is control_space
    assert repository.get(tenant_id="tenant-2", control_space_id=control_space.id) is None


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSControlSpace,)], indirect=True)
def test_lifecycle_service_uses_compare_and_set_resource_versions(
    sqlite_session: Session,
    repository: SQLAlchemyKnowledgeFSControlSpaceRepository,
) -> None:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    sqlite_session.add(control_space)
    sqlite_session.commit()
    metrics = MagicMock()
    service = KnowledgeFSControlSpaceLifecycleService(repository, metrics=metrics)

    transitioned = service.transition(
        tenant_id="tenant-1",
        control_space_id=control_space.id,
        expected_resource_version=0,
        new_state=KnowledgeFSControlSpaceState.ACTIVE,
        lifecycle_operation_id="operation-1",
        knowledge_space_id="knowledge-space-1",
    )

    assert transitioned.state is KnowledgeFSControlSpaceState.ACTIVE
    assert transitioned.resource_version == 1
    assert transitioned.knowledge_space_id == "knowledge-space-1"
    state_metric = metrics.record_control_space_state.call_args.args[0]
    assert state_metric.from_state == "provisioning"
    assert state_metric.to_state == "active"
    assert control_space.id not in str(state_metric)
    assert control_space.tenant_id not in str(state_metric)

    with pytest.raises(KnowledgeFSControlSpaceVersionConflictError):
        service.transition(
            tenant_id="tenant-1",
            control_space_id=control_space.id,
            expected_resource_version=0,
            new_state=KnowledgeFSControlSpaceState.DELETING,
            lifecycle_operation_id="operation-2",
        )

    with pytest.raises(KnowledgeFSSpaceRegistrationConflictError):
        service.transition(
            tenant_id="tenant-1",
            control_space_id=control_space.id,
            expected_resource_version=1,
            new_state=KnowledgeFSControlSpaceState.DELETING,
            lifecycle_operation_id="operation-3",
            knowledge_space_id="different-knowledge-space",
        )


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSControlSpace,)], indirect=True)
def test_lifecycle_service_rejects_invalid_transitions_and_fences_workspace_deletion(
    sqlite_session: Session,
    repository: SQLAlchemyKnowledgeFSControlSpaceRepository,
) -> None:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
    )
    sqlite_session.add(control_space)
    sqlite_session.commit()
    service = KnowledgeFSControlSpaceLifecycleService(repository)

    with pytest.raises(KnowledgeFSInvalidLifecycleTransitionError):
        service.transition(
            tenant_id="tenant-1",
            control_space_id=control_space.id,
            expected_resource_version=0,
            new_state=KnowledgeFSControlSpaceState.DELETED,
            lifecycle_operation_id="operation-1",
        )

    with pytest.raises(KnowledgeFSWorkspaceDeletionBlockedError) as exc_info:
        service.assert_workspace_deletion_allowed(tenant_id="tenant-1")
    assert exc_info.value.control_space_ids == (control_space.id,)

    control_space.state = KnowledgeFSControlSpaceState.DELETED
    sqlite_session.commit()
    service.assert_workspace_deletion_allowed(tenant_id="tenant-1")


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSControlSpace,)], indirect=True)
def test_remote_revision_is_monotonic_and_irreversible_deletion_blocks_recovery(
    sqlite_session: Session,
    repository: SQLAlchemyKnowledgeFSControlSpaceRepository,
) -> None:
    irreversible_at = datetime(2026, 7, 21, tzinfo=UTC)
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="knowledge-space-1",
        knowledge_space_revision=7,
        state=KnowledgeFSControlSpaceState.DELETING,
        lifecycle_operation_id="delete-1",
    )
    sqlite_session.add(control_space)
    sqlite_session.commit()

    assert (
        repository.compare_and_set_lifecycle(
            KnowledgeFSControlSpaceCASUpdate(
                tenant_id="tenant-1",
                control_space_id=control_space.id,
                expected_resource_version=0,
                expected_state=KnowledgeFSControlSpaceState.DELETING,
                new_state=KnowledgeFSControlSpaceState.ERROR,
                lifecycle_operation_id="delete-1",
                knowledge_space_revision=6,
            )
        )
        is False
    )
    assert repository.mark_deletion_irreversible(
        tenant_id="tenant-1",
        control_space_id=control_space.id,
        lifecycle_operation_id="delete-1",
        irreversible_at=irreversible_at,
    )
    assert repository.mark_deletion_irreversible(
        tenant_id="tenant-1",
        control_space_id=control_space.id,
        lifecycle_operation_id="delete-1",
        irreversible_at=irreversible_at,
    )

    service = KnowledgeFSControlSpaceLifecycleService(repository)
    with pytest.raises(KnowledgeFSInvalidLifecycleTransitionError, match="irreversible"):
        service.transition(
            tenant_id="tenant-1",
            control_space_id=control_space.id,
            expected_resource_version=0,
            new_state=KnowledgeFSControlSpaceState.ACTIVE,
            lifecycle_operation_id="recover-1",
        )
    refreshed = repository.get(tenant_id="tenant-1", control_space_id=control_space.id)
    assert refreshed is not None
    assert refreshed.deletion_irreversible_at == irreversible_at.replace(tzinfo=None)
    assert refreshed.resource_version == 0


@pytest.mark.parametrize("sqlite_session", [(KnowledgeFSControlSpace,)], indirect=True)
def test_repository_lists_by_tenant_and_remote_identity(
    sqlite_session: Session,
    repository: SQLAlchemyKnowledgeFSControlSpaceRepository,
) -> None:
    first = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    second = KnowledgeFSControlSpace(
        tenant_id="tenant-2",
        owner_account_id="account-2",
        provisioning_key="provision-2",
    )
    sqlite_session.add_all([first, second])
    sqlite_session.commit()

    assert repository.find_by_provisioning_key(provisioning_key="provision-1") is first
    assert repository.find_by_knowledge_space_id(tenant_id="tenant-1", knowledge_space_id="space-1") is first
    assert repository.find_by_knowledge_space_id(tenant_id="tenant-2", knowledge_space_id="space-1") is None
    assert repository.list_for_tenant(tenant_id="tenant-1") == (first,)
