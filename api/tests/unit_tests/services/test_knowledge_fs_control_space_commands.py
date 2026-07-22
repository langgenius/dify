from __future__ import annotations

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
)
from services.knowledge_fs.control_space_commands import (
    KnowledgeFSControlSpaceCommandService,
    KnowledgeFSProvisionIntent,
)
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSWorkspaceDeletionBlockedError


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
            "rerank": {"enabled": False},
            "scoreThreshold": {"enabled": False, "stage": "mode-final"},
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
def test_create_provision_intent_persists_control_revision_and_outbox_atomically(
    sqlite_session: Session,
) -> None:
    service = _service(sqlite_session)

    result = service.create_provision_intent(_provision_intent())
    replay = service.create_provision_intent(_provision_intent())

    with Session(sqlite_session.get_bind()) as session:
        control_spaces = tuple(session.scalars(select(KnowledgeFSControlSpace)))
        permissions = tuple(session.scalars(select(KnowledgeFSControlSpacePermission)))
        revisions = tuple(session.scalars(select(KnowledgeFSAuthorizationRevision)))
        commands = tuple(session.scalars(select(KnowledgeFSLifecycleOutbox)))
    assert replay.control_space.id == result.control_space.id
    assert len(control_spaces) == len(revisions) == len(commands) == 1
    assert len(permissions) == 1
    assert permissions[0].account_id == "account-1"
    assert permissions[0].role.value == "owner"
    assert commands[0].operation is KnowledgeFSLifecycleOperation.PROVISION
    assert commands[0].expected_control_space_version == 0
    assert commands[0].command_payload["idempotency_key"] == "provision-idempotency-1"
    assert commands[0].command_payload["model_intent"] == {
        "pluginId": "langgenius/openai",
        "provider": "openai",
        "model": "text-embedding-3-small",
    }
    assert commands[0].command_payload["profile_intent"]["defaultMode"] == "fast"


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

    assert replay.outbox.id == single.outbox.id
    assert single.control_space.state is KnowledgeFSControlSpaceState.DELETING
    assert single.outbox.expected_control_space_version == 1
    assert single.outbox.command_payload["knowledge_space_id"] == "space-1"
    assert {command.control_space.id for command in workspace_commands} == {first.id, second.id}
    assert all(command.outbox.operation is KnowledgeFSLifecycleOperation.DELETE for command in workspace_commands)


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
                role="owner",
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
                request_summary={
                    "caller_kind": "interactive",
                    "grant_id": "20000000-0000-4000-8000-000000000001",
                    "subject": "dify-account:account-1",
                },
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
