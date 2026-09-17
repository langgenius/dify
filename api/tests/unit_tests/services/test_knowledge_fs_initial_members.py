from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from models import TenantAccountJoin
from models.knowledge_fs import (
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOutbox,
)
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)
from services.knowledge_fs.control_space_commands import (
    KnowledgeFSControlSpaceCommandService,
    KnowledgeFSControlSpaceIntentConflictError,
    KnowledgeFSProvisionIntent,
)
from services.knowledge_fs.product_dto import KnowledgeFSSpaceCreatePayload
from services.knowledge_fs.workspace_members import KnowledgeFSControlPlaneInvariantError


def _intent() -> KnowledgeFSProvisionIntent:
    return KnowledgeFSProvisionIntent(
        tenant_id="tenant-1",
        owner_account_id="owner-1",
        provisioning_key="provision-1",
        operation_id="operation-1",
        idempotency_key="create-1",
        name="Selected members",
        slug="selected-members",
        icon=None,
        description=None,
        model_intent=None,
        profile_intent=None,
        visibility=KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS,
        member_account_ids=("member-2", "member-1"),
    )


def _seed_members(session: Session) -> None:
    session.add_all(
        [
            TenantAccountJoin(tenant_id="tenant-1", account_id="member-1"),
            TenantAccountJoin(tenant_id="tenant-1", account_id="member-2"),
            TenantAccountJoin(tenant_id="other-tenant", account_id="outsider"),
        ]
    )
    session.commit()


def _assert_no_creation(session: Session) -> None:
    for model in (
        KnowledgeFSControlSpace,
        KnowledgeFSControlSpacePermission,
        KnowledgeFSAuthorizationRevision,
        KnowledgeFSExternalAccessPolicy,
        KnowledgeFSLifecycleOutbox,
    ):
        assert session.scalar(select(func.count()).select_from(model)) == 0


def test_partial_members_create_dto_accepts_viewers_and_preserves_default_creation() -> None:
    payload = KnowledgeFSSpaceCreatePayload.model_validate(
        {
            "name": "Selected members",
            "slug": "selected-members",
            "visibility": "partial_members",
            "members": [{"account_id": "member-1", "role": "viewer"}],
        }
    )
    assert payload.members[0].account_id == "member-1"
    assert payload.members[0].role == "viewer"
    assert KnowledgeFSSpaceCreatePayload(name="Private", slug="private").members == []
    assert KnowledgeFSSpaceCreatePayload(name="Team", slug="team", visibility="all_team_members").members == []


@pytest.mark.parametrize(
    "updates",
    [
        {"visibility": "partial_members"},
        {"visibility": "partial_members", "members": []},
        {"visibility": "partial_members", "members": None},
        {"members": [{"account_id": "member-1", "role": "viewer"}]},
        {"visibility": "all_team_members", "members": [{"account_id": "member-1", "role": "viewer"}]},
        {"visibility": "partial_members", "members": [{"account_id": "member-1", "role": "owner"}]},
        {"visibility": "partial_members", "members": [{"account_id": "member-1", "role": "editor"}]},
        {"visibility": "partial_members", "members": [{"account_id": "member-1"}]},
        {"visibility": "partial_members", "members": [{"account_id": "", "role": "viewer"}]},
        {
            "visibility": "partial_members",
            "members": [{"account_id": "member-1", "role": "viewer"}] * 2,
        },
        {
            "visibility": "partial_members",
            "members": [{"account_id": f"member-{i}", "role": "viewer"} for i in range(1_001)],
        },
    ],
)
def test_partial_members_create_dto_rejects_invalid_or_privileged_members(updates: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        KnowledgeFSSpaceCreatePayload.model_validate({"name": "Space", "slug": "space", **updates})


def test_initial_members_and_visibility_are_committed_with_the_space_and_outbox(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _seed_members(sqlite_session)
    service = KnowledgeFSControlSpaceCommandService(sqlite_session_factory)

    result = service.create_provision_intent(_intent())
    replay = service.create_provision_intent(_intent()._replace(member_account_ids=("member-1", "member-2")))

    assert result.control_space.visibility is KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS
    assert replay.control_space.id == result.control_space.id
    assert replay.outbox.id == result.outbox.id
    assert result.outbox.expected_control_space_version == result.control_space.resource_version == 0
    assert result.outbox.command_payload["initial_visibility"] == "partial_members"
    assert result.outbox.command_payload["initial_member_account_ids"] == ["member-1", "member-2"]
    permissions = list(sqlite_session.scalars(select(KnowledgeFSControlSpacePermission)))
    assert {permission.account_id: permission.role for permission in permissions} == {
        "owner-1": KnowledgeFSControlSpacePermissionRole.OWNER,
        "member-1": KnowledgeFSControlSpacePermissionRole.VIEWER,
        "member-2": KnowledgeFSControlSpacePermissionRole.VIEWER,
    }
    assert all(permission.granted_by_account_id == "owner-1" for permission in permissions)
    assert sqlite_session.scalar(select(func.count()).select_from(KnowledgeFSLifecycleOutbox)) == 1
    assert sqlite_session.scalar(select(func.count()).select_from(KnowledgeFSAuthorizationRevision)) == 1
    assert sqlite_session.scalar(select(func.count()).select_from(KnowledgeFSExternalAccessPolicy)) == 1


@pytest.mark.parametrize("member_ids", [(), ("owner-1",), ("member-1", "member-1"), ("outsider",), ("missing",)])
def test_initial_member_validation_precedes_any_creation(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], member_ids: tuple[str, ...]
) -> None:
    _seed_members(sqlite_session)
    service = KnowledgeFSControlSpaceCommandService(sqlite_session_factory)

    with pytest.raises(KnowledgeFSControlPlaneInvariantError):
        service.create_provision_intent(_intent()._replace(member_account_ids=member_ids))

    _assert_no_creation(sqlite_session)


def test_initial_members_roll_back_if_the_outbox_write_fails(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _seed_members(sqlite_session)
    original_add = SQLAlchemyKnowledgeFSLifecycleOutboxRepository.add

    def fail_after_flush(
        repository: SQLAlchemyKnowledgeFSLifecycleOutboxRepository, command: KnowledgeFSLifecycleOutbox
    ) -> KnowledgeFSLifecycleOutbox:
        original_add(repository, command)
        raise RuntimeError("outbox write interrupted")

    monkeypatch.setattr(SQLAlchemyKnowledgeFSLifecycleOutboxRepository, "add", fail_after_flush)

    with pytest.raises(RuntimeError, match="outbox write interrupted"):
        KnowledgeFSControlSpaceCommandService(sqlite_session_factory).create_provision_intent(_intent())

    _assert_no_creation(sqlite_session)


def test_creation_replay_does_not_restore_revoked_members_or_initial_visibility(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _seed_members(sqlite_session)
    service = KnowledgeFSControlSpaceCommandService(sqlite_session_factory)
    result = service.create_provision_intent(_intent())
    space = sqlite_session.get(KnowledgeFSControlSpace, result.control_space.id)
    assert space is not None
    space.visibility = KnowledgeFSControlSpaceVisibility.ONLY_ME
    member = sqlite_session.scalar(
        select(KnowledgeFSControlSpacePermission).where(KnowledgeFSControlSpacePermission.account_id == "member-1")
    )
    assert member is not None
    member.status = KnowledgeFSControlSpacePermissionStatus.REVOKED
    sqlite_session.execute(delete(TenantAccountJoin).where(TenantAccountJoin.account_id == "member-1"))
    sqlite_session.commit()

    replay = service.create_provision_intent(_intent())

    assert replay.control_space.visibility is KnowledgeFSControlSpaceVisibility.ONLY_ME
    assert replay.outbox.id == result.outbox.id
    sqlite_session.refresh(member)
    assert member.status is KnowledgeFSControlSpacePermissionStatus.REVOKED


@pytest.mark.parametrize(
    "changes",
    [
        {"member_account_ids": ("member-1",)},
        {"visibility": KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS, "member_account_ids": ()},
        {"visibility": KnowledgeFSControlSpaceVisibility.ONLY_ME, "member_account_ids": ()},
    ],
)
def test_creation_replay_cannot_change_initial_access(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session], changes: dict[str, object]
) -> None:
    _seed_members(sqlite_session)
    service = KnowledgeFSControlSpaceCommandService(sqlite_session_factory)
    service.create_provision_intent(_intent())

    with pytest.raises(KnowledgeFSControlSpaceIntentConflictError, match="different initial access"):
        service.create_provision_intent(_intent()._replace(**changes))

    assert sqlite_session.scalar(select(func.count()).select_from(KnowledgeFSControlSpacePermission)) == 3
    assert sqlite_session.scalar(select(func.count()).select_from(KnowledgeFSLifecycleOutbox)) == 1


def test_legacy_creation_replay_keeps_current_access_and_rejects_added_members(
    sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
) -> None:
    _seed_members(sqlite_session)
    service = KnowledgeFSControlSpaceCommandService(sqlite_session_factory)
    private_intent = _intent()._replace(visibility=KnowledgeFSControlSpaceVisibility.ONLY_ME, member_account_ids=())
    result = service.create_provision_intent(private_intent)
    command = sqlite_session.get(KnowledgeFSLifecycleOutbox, result.outbox.id)
    assert command is not None
    command.command_payload = {
        key: value
        for key, value in command.command_payload.items()
        if key not in {"initial_visibility", "initial_member_account_ids"}
    }
    sqlite_session.commit()

    replay = service.create_provision_intent(
        private_intent._replace(visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS)
    )

    assert replay.control_space.visibility is KnowledgeFSControlSpaceVisibility.ONLY_ME
    assert replay.outbox.id == result.outbox.id
    with pytest.raises(KnowledgeFSControlSpaceIntentConflictError):
        service.create_provision_intent(_intent())
