from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
)
from services.knowledge_fs import control_space_management as management_module
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceIntentConflictError
from services.knowledge_fs.control_space_management import (
    KnowledgeFSControlSpaceManagementService,
    KnowledgeFSControlSpaceRegistration,
)


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
        )
    ],
    indirect=True,
)
def test_registration_and_replay_ensure_one_owner_permission(sqlite_session: Session) -> None:
    session_maker = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    service = KnowledgeFSControlSpaceManagementService(session_maker)
    registration = KnowledgeFSControlSpaceRegistration(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        knowledge_space_revision=7,
    )

    created, replayed = service.register(registration)
    replay, was_replayed = service.register(registration)

    with session_maker() as session:
        permissions = tuple(session.scalars(select(KnowledgeFSControlSpacePermission)))
        revisions = tuple(session.scalars(select(KnowledgeFSAuthorizationRevision)))
    assert replayed is False
    assert was_replayed is True
    assert replay.id == created.id
    assert len(permissions) == 1
    assert permissions[0].control_space_id == created.id
    assert permissions[0].account_id == "account-1"
    assert permissions[0].role is KnowledgeFSControlSpacePermissionRole.OWNER
    assert len(revisions) == 1


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission, KnowledgeFSAuthorizationRevision)],
    indirect=True,
)
def test_dry_run_supports_global_and_tenant_scopes_and_counts_irreversible_rows(sqlite_session: Session) -> None:
    session_maker = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    service = KnowledgeFSControlSpaceManagementService(session_maker)
    first, _ = service.register(
        KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "provision-1", "space-1", 1)
    )
    _second, _ = service.register(
        KnowledgeFSControlSpaceRegistration("tenant-2", "account-2", "provision-2", "space-2", 1)
    )
    with session_maker.begin() as session:
        persisted = session.get(KnowledgeFSControlSpace, first.id)
        assert persisted is not None
        persisted.state = KnowledgeFSControlSpaceState.DELETING
        persisted.deletion_irreversible_at = datetime(2026, 7, 21)

    global_report = service.dry_run()
    tenant_report = service.dry_run(tenant_id="tenant-1")

    assert global_report.total == 2
    assert global_report.by_state == {"active": 1, "deleting": 1}
    assert global_report.irreversible_deletions == 1
    assert tenant_report.total == 1
    assert tenant_report.irreversible_deletions == 1


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSControlSpacePermission, KnowledgeFSAuthorizationRevision)],
    indirect=True,
)
def test_registration_rejects_reusing_either_remote_or_local_identity(sqlite_session: Session) -> None:
    session_maker = sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False)
    service = KnowledgeFSControlSpaceManagementService(session_maker)
    service.register(KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "provision-1", "space-1", 1))

    with pytest.raises(KnowledgeFSControlSpaceIntentConflictError, match="conflicts"):
        service.register(
            KnowledgeFSControlSpaceRegistration("tenant-1", "different-owner", "provision-1", "space-2", 1)
        )
    with pytest.raises(KnowledgeFSControlSpaceIntentConflictError, match="conflicts"):
        service.register(KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "different-key", "space-1", 1))


def test_backfill_is_dry_run_by_default_and_accounts_for_replays(monkeypatch: pytest.MonkeyPatch) -> None:
    service = KnowledgeFSControlSpaceManagementService(MagicMock())
    registrations = (
        KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "provision-1", "space-1", 1),
        KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "provision-2", "space-2", 1),
    )
    register = MagicMock(
        side_effect=(
            (SimpleNamespace(id="control-1"), False),
            (SimpleNamespace(id="control-2"), True),
        )
    )
    monkeypatch.setattr(service, "register", register)

    assert service.backfill(registrations, apply=False) == (2, 0, 0)
    register.assert_not_called()
    assert service.backfill(registrations, apply=True) == (2, 1, 1)
    assert register.call_count == 2


def test_repair_registration_delegates_an_active_cas_transition(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    transaction = MagicMock()
    transaction.__enter__.return_value = session
    session_maker = MagicMock()
    session_maker.begin.return_value = transaction
    repository = MagicMock()
    repository_factory = MagicMock(return_value=repository)
    lifecycle = MagicMock()
    lifecycle.transition.return_value = SimpleNamespace(id="control-1")
    lifecycle_factory = MagicMock(return_value=lifecycle)
    monkeypatch.setattr(management_module, "SQLAlchemyKnowledgeFSControlSpaceRepository", repository_factory)
    monkeypatch.setattr(management_module, "KnowledgeFSControlSpaceLifecycleService", lifecycle_factory)
    service = KnowledgeFSControlSpaceManagementService(session_maker)

    result = service.repair_registration(
        tenant_id="tenant-1",
        control_space_id="control-1",
        expected_resource_version=4,
        knowledge_space_id="space-1",
        knowledge_space_revision=9,
    )

    assert result.id == "control-1"
    lifecycle.transition.assert_called_once_with(
        tenant_id="tenant-1",
        control_space_id="control-1",
        expected_resource_version=4,
        new_state=KnowledgeFSControlSpaceState.ACTIVE,
        lifecycle_operation_id="management-repair",
        knowledge_space_id="space-1",
        knowledge_space_revision=9,
    )
