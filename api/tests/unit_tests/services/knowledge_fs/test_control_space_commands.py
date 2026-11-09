from __future__ import annotations

from typing import cast
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from models import TenantAccountJoin
from models.enums import ApiTokenBindingResourceType, ApiTokenType
from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpacePermissionStatus,
    KnowledgeFSControlSpaceState,
    KnowledgeFSControlSpaceVisibility,
    KnowledgeFSDeleteCommandPayload,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSProvisionCommandPayload,
)
from models.model import ApiToken, DatasetApiTokenBinding
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)
from services.api_token_service import ApiTokenCache
from services.knowledge_fs.control_space_commands import (
    KnowledgeFSControlSpaceCommandService,
    KnowledgeFSControlSpaceIntentConflictError,
    KnowledgeFSProvisionIntent,
)
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSWorkspaceDeletionBlockedError
from services.knowledge_fs.product_dto import KnowledgeFSSpaceCreatePayload
from services.knowledge_fs.workspace_members import KnowledgeFSControlPlaneInvariantError
from tests.helpers.unit.services.knowledge_fs_fakes import provision_payload, reservation_summary


def _service(sqlite_session: Session) -> KnowledgeFSControlSpaceCommandService:
    return KnowledgeFSControlSpaceCommandService(sessionmaker(bind=sqlite_session.get_bind(), expire_on_commit=False))


def _provision_intent() -> KnowledgeFSProvisionIntent:
    return KnowledgeFSProvisionIntent(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        operation_id="operation-1",
        idempotency_key="provision-idempotency-1",
        name="Technical space",
        slug="technical-space",
        icon=None,
        description=None,
        model_intent={"pluginId": "langgenius/openai", "provider": "openai", "model": "text-embedding-3-small"},
        profile_intent={
            "defaultMode": "fast",
            "reasoningModel": {"pluginId": "langgenius/openai", "provider": "openai", "model": "gpt-4.1-mini"},
            "rerank": {
                "enabled": True,
                "model": {"pluginId": "langgenius/cohere", "provider": "cohere", "model": "rerank-v3"},
            },
            "scoreThreshold": {"enabled": False, "stage": "rerank"},
            "topK": 10,
        },
    )


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_create_provision_intent_persists_default_access_revision_and_outbox_atomically(
    sqlite_session: Session,
) -> None:
    service = _service(sqlite_session)

    result = service.create_provision_intent(_provision_intent())
    replay = service.create_provision_intent(_provision_intent())

    with Session(sqlite_session.get_bind()) as session:
        control_spaces = tuple(session.scalars(select(KnowledgeFSControlSpace)))
        permissions = tuple(session.scalars(select(KnowledgeFSControlSpacePermission)))
        external_access_policies = tuple(session.scalars(select(KnowledgeFSExternalAccessPolicy)))
        revisions = tuple(session.scalars(select(KnowledgeFSAuthorizationRevision)))
        commands = tuple(session.scalars(select(KnowledgeFSLifecycleOutbox)))
    assert replay.control_space.id == result.control_space.id
    assert len(control_spaces) == len(revisions) == len(commands) == 1
    assert len(permissions) == 1
    assert permissions[0].account_id == "account-1"
    assert permissions[0].role.value == "owner"
    assert len(external_access_policies) == 1
    assert external_access_policies[0].control_space_id == result.control_space.id
    assert external_access_policies[0].service_api_enabled is True
    assert external_access_policies[0].agent_enabled is True
    assert external_access_policies[0].workflow_enabled is True
    assert external_access_policies[0].mcp_enabled is False
    assert external_access_policies[0].updated_by_account_id == "account-1"
    assert commands[0].operation is KnowledgeFSLifecycleOperation.PROVISION
    assert commands[0].expected_control_space_version == 0
    assert commands[0].command_payload["idempotency_key"] == "provision-idempotency-1"
    assert result.model_setup_required is False
    assert provision_payload(commands[0])["model_intent"] == {
        "pluginId": "langgenius/openai",
        "provider": "openai",
        "model": "text-embedding-3-small",
    }
    assert provision_payload(commands[0])["profile_intent"]["defaultMode"] == "fast"


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_create_provision_intent_omits_unconfigured_models(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    intent = _provision_intent()._replace(model_intent=None, profile_intent=None)

    result = service.create_provision_intent(intent)
    replay = service.create_provision_intent(_provision_intent())

    assert "model_intent" not in result.outbox.command_payload
    assert "profile_intent" not in result.outbox.command_payload
    assert result.model_setup_required is True
    assert replay.model_setup_required is True
    assert replay.outbox.id == result.outbox.id


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_create_provision_intent_requires_an_enabled_rerank_model(sqlite_session: Session) -> None:
    service = _service(sqlite_session)
    original_profile = _provision_intent().profile_intent
    assert original_profile is not None
    profile_intent = original_profile.copy()
    profile_intent["rerank"] = {"enabled": False}
    intent = _provision_intent()._replace(profile_intent=profile_intent)

    result = service.create_provision_intent(intent)
    replay = service.create_provision_intent(_provision_intent())

    assert result.model_setup_required is True
    assert replay.model_setup_required is True
    assert replay.outbox.id == result.outbox.id


@pytest.mark.parametrize(
    "sqlite_session",
    [(KnowledgeFSControlSpace, KnowledgeFSLifecycleOutbox)],
    indirect=True,
)
def test_single_and_workspace_deletion_use_the_same_durable_entrypoint(sqlite_session: Session) -> None:
    first = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-1",
        knowledge_space_id="space-1",
        knowledge_space_revision=3,
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    second = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-2",
        knowledge_space_id="space-2",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add_all([first, second])
    sqlite_session.commit()
    service = _service(sqlite_session)

    single = service.request_deletion(
        tenant_id="tenant-1",
        control_space_id=first.id,
        operation_id="delete-1",
        idempotency_key="delete-idempotency-1",
    )
    replay = service.request_deletion(
        tenant_id="tenant-1",
        control_space_id=first.id,
        operation_id="delete-1",
        idempotency_key="delete-idempotency-1",
    )
    workspace_commands = service.request_workspace_cleanup(tenant_id="tenant-1")

    assert replay.outbox is not None
    assert single.outbox is not None
    assert replay.outbox is not None
    assert single.outbox is not None
    assert replay.outbox.id == single.outbox.id
    assert single.control_space.state is KnowledgeFSControlSpaceState.DELETING
    assert single.outbox.expected_control_space_version == 1
    assert single.outbox.operation is KnowledgeFSLifecycleOperation.DELETE
    delete_payload = cast(KnowledgeFSDeleteCommandPayload, single.outbox.command_payload)
    assert delete_payload["knowledge_space_id"] == "space-1"
    assert {command.control_space.id for command in workspace_commands} == {first.id, second.id}
    for command in workspace_commands:
        assert command.outbox is not None
        assert command.outbox.operation is KnowledgeFSLifecycleOperation.DELETE


@pytest.mark.parametrize(
    "sqlite_session",
    [
        (
            KnowledgeFSControlSpace,
            KnowledgeFSControlSpacePermission,
            KnowledgeFSExternalAccessPolicy,
            KnowledgeFSApiCredential,
            AppKnowledgeFSSpaceJoin,
            KnowledgeFSAuthorizationRevision,
            KnowledgeFSCapabilityIssuanceAudit,
            KnowledgeFSCapabilityIssuanceReservation,
            KnowledgeFSLifecycleOutbox,
        )
    ],
    indirect=True,
)
def test_workspace_finalizer_cannot_bypass_remote_deletion_and_purges_only_deleted_control_plane(
    sqlite_session: Session,
) -> None:
    control_space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="provision-finalize",
        knowledge_space_id="space-finalize",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    sqlite_session.add(control_space)
    sqlite_session.commit()
    service = _service(sqlite_session)

    with pytest.raises(KnowledgeFSWorkspaceDeletionBlockedError):
        service.finalize_workspace_deletion(tenant_id="tenant-1")

    control_space.state = KnowledgeFSControlSpaceState.DELETED
    sqlite_session.add_all(
        [
            KnowledgeFSControlSpacePermission(
                tenant_id="tenant-1",
                control_space_id=control_space.id,
                account_id="account-1",
                role=KnowledgeFSControlSpacePermissionRole.OWNER,
            ),
            KnowledgeFSAuthorizationRevision(
                tenant_id="tenant-1",
                control_space_id=control_space.id,
            ),
            KnowledgeFSCapabilityIssuanceReservation(
                tenant_id="tenant-1",
                control_space_id=control_space.id,
                grant_id="20000000-0000-4000-8000-000000000001",
                trace_id="trace-finalize",
                subject="dify-account:account-1",
                caller_kind="interactive",
                request_summary=reservation_summary(
                    tenant_id="tenant-1",
                    control_space_id=control_space.id,
                    caller_kind="interactive",
                    grant_id="20000000-0000-4000-8000-000000000001",
                    subject="dify-account:account-1",
                ),
            ),
            KnowledgeFSLifecycleOutbox(
                tenant_id="tenant-1",
                control_space_id=control_space.id,
                operation_id="delete-finalize",
                idempotency_key="delete-finalize",
                operation=KnowledgeFSLifecycleOperation.DELETE,
                command_payload={
                    "schema_version": 1,
                    "idempotency_key": "delete-finalize",
                    "expected_revision": 1,
                    "knowledge_space_id": "space-finalize",
                    "provisioning_key": "provision-finalize",
                },
                expected_control_space_version=1,
            ),
        ]
    )
    sqlite_session.commit()

    assert service.finalize_workspace_deletion(tenant_id="tenant-1") == 1
    with Session(sqlite_session.get_bind()) as session:
        assert session.scalar(select(func.count()).select_from(KnowledgeFSControlSpace)) == 0
        assert session.scalar(select(func.count()).select_from(KnowledgeFSControlSpacePermission)) == 0
        assert session.scalar(select(func.count()).select_from(KnowledgeFSAuthorizationRevision)) == 0
        assert session.scalar(select(func.count()).select_from(KnowledgeFSCapabilityIssuanceReservation)) == 0
        assert session.scalar(select(func.count()).select_from(KnowledgeFSLifecycleOutbox)) == 0


def test_deletion_invalidates_token_cache_after_commit(sqlite_session: Session) -> None:
    space = KnowledgeFSControlSpace(
        tenant_id="tenant-1",
        owner_account_id="account-1",
        provisioning_key="cache-delete",
        knowledge_space_id="space-1",
        state=KnowledgeFSControlSpaceState.ACTIVE,
    )
    token = ApiToken(tenant_id="tenant-1", type=ApiTokenType.DATASET, token="dataset-cache-delete")
    sqlite_session.add_all([space, token])
    sqlite_session.flush()
    sqlite_session.add(
        DatasetApiTokenBinding(
            api_token_id=token.id,
            resource_type=ApiTokenBindingResourceType.KNOWLEDGE_FS_SPACE,
            control_space_id=space.id,
        )
    )
    sqlite_session.commit()

    def invalidate(tenant_id: str) -> bool:
        assert tenant_id == "tenant-1"
        with Session(sqlite_session.get_bind()) as session:
            assert session.get(ApiToken, token.id) is None
            assert (
                session.scalar(select(DatasetApiTokenBinding).where(DatasetApiTokenBinding.api_token_id == token.id))
                is None
            )
        return True

    with patch.object(ApiTokenCache, "invalidate_by_tenant", side_effect=invalidate) as eviction:
        _service(sqlite_session).request_deletion(
            tenant_id="tenant-1",
            control_space_id=space.id,
            operation_id="cache-delete",
            idempotency_key="cache-delete",
        )
    eviction.assert_called_once_with("tenant-1")


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


def _provision_payload(outbox: KnowledgeFSLifecycleOutbox) -> KnowledgeFSProvisionCommandPayload:
    assert outbox.operation is KnowledgeFSLifecycleOperation.PROVISION
    return cast(KnowledgeFSProvisionCommandPayload, outbox.command_payload)


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
    command_payload = _provision_payload(result.outbox)
    assert command_payload["initial_visibility"] == "partial_members"
    assert command_payload["initial_member_account_ids"] == ["member-1", "member-2"]
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
    ("visibility", "member_account_ids"),
    [
        (KnowledgeFSControlSpaceVisibility.PARTIAL_MEMBERS, ("member-1",)),
        (KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS, ()),
        (KnowledgeFSControlSpaceVisibility.ONLY_ME, ()),
    ],
)
def test_creation_replay_cannot_change_initial_access(
    sqlite_session: Session,
    sqlite_session_factory: sessionmaker[Session],
    visibility: KnowledgeFSControlSpaceVisibility,
    member_account_ids: tuple[str, ...],
) -> None:
    _seed_members(sqlite_session)
    service = KnowledgeFSControlSpaceCommandService(sqlite_session_factory)
    service.create_provision_intent(_intent())

    with pytest.raises(KnowledgeFSControlSpaceIntentConflictError, match="different initial access"):
        service.create_provision_intent(
            _intent()._replace(visibility=visibility, member_account_ids=member_account_ids)
        )

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
    legacy_payload = _provision_payload(command).copy()
    del legacy_payload["initial_visibility"]
    del legacy_payload["initial_member_account_ids"]
    command.command_payload = legacy_payload
    sqlite_session.commit()

    replay = service.create_provision_intent(
        private_intent._replace(visibility=KnowledgeFSControlSpaceVisibility.ALL_TEAM_MEMBERS)
    )

    assert replay.control_space.visibility is KnowledgeFSControlSpaceVisibility.ONLY_ME
    assert replay.outbox.id == result.outbox.id
    with pytest.raises(KnowledgeFSControlSpaceIntentConflictError):
        service.create_provision_intent(_intent())
