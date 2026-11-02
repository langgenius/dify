from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

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


def _control_space(control_space_id: str) -> KnowledgeFSControlSpace:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key=f"provision-{control_space_id}",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    control_space.id = control_space_id
    return control_space


@dataclass
class _QueuedRegister:
    """Replays queued registration outcomes and records each registration it receives."""

    outcomes: list[tuple[KnowledgeFSControlSpace, bool]]
    calls: list[KnowledgeFSControlSpaceRegistration] = field(default_factory=list)

    def __call__(self, registration: KnowledgeFSControlSpaceRegistration) -> tuple[KnowledgeFSControlSpace, bool]:
        self.calls.append(registration)
        return self.outcomes.pop(0)


@dataclass
class _RecordingRepositoryFactory:
    sessions: list[Session] = field(default_factory=list)

    def __call__(self, session: Session) -> object:
        self.sessions.append(session)
        return self


@dataclass
class _RecordingLifecycle:
    result: KnowledgeFSControlSpace
    repositories: list[object] = field(default_factory=list)
    transitions: list[dict[str, object]] = field(default_factory=list)

    def __call__(self, repository: object) -> _RecordingLifecycle:
        self.repositories.append(repository)
        return self

    def transition(self, **kwargs: object) -> KnowledgeFSControlSpace:
        self.transitions.append(kwargs)
        return self.result


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
    service = KnowledgeFSControlSpaceManagementService(sessionmaker())
    registrations = (
        KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "provision-1", "space-1", 1),
        KnowledgeFSControlSpaceRegistration("tenant-1", "account-1", "provision-2", "space-2", 1),
    )
    register = _QueuedRegister(
        outcomes=[
            (_control_space("control-1"), False),
            (_control_space("control-2"), True),
        ]
    )
    monkeypatch.setattr(service, "register", register)

    assert service.backfill(registrations, apply=False) == (2, 0, 0)
    assert register.calls == []
    assert service.backfill(registrations, apply=True) == (2, 1, 1)
    assert len(register.calls) == 2


def test_repair_registration_delegates_an_active_cas_transition(monkeypatch: pytest.MonkeyPatch) -> None:
    repository_factory = _RecordingRepositoryFactory()
    lifecycle = _RecordingLifecycle(result=_control_space("control-1"))
    monkeypatch.setattr(management_module, "SQLAlchemyKnowledgeFSControlSpaceRepository", repository_factory)
    monkeypatch.setattr(management_module, "KnowledgeFSControlSpaceLifecycleService", lifecycle)
    service = KnowledgeFSControlSpaceManagementService(sessionmaker())

    result = service.repair_registration(
        tenant_id="tenant-1",
        control_space_id="control-1",
        expected_resource_version=4,
        knowledge_space_id="space-1",
        knowledge_space_revision=9,
    )

    assert result.id == "control-1"
    assert len(repository_factory.sessions) == 1
    assert lifecycle.repositories == [repository_factory]
    assert lifecycle.transitions == [
        {
            "tenant_id": "tenant-1",
            "control_space_id": "control-1",
            "expected_resource_version": 4,
            "new_state": KnowledgeFSControlSpaceState.ACTIVE,
            "lifecycle_operation_id": "management-repair",
            "knowledge_space_id": "space-1",
            "knowledge_space_revision": 9,
        }
    ]
