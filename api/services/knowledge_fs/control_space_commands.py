"""Durable product entrypoints for KnowledgeFS provision and deletion intent."""

from __future__ import annotations

import uuid
from typing import NamedTuple

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    AppKnowledgeFSSpaceJoin,
    KnowledgeFSApiCredential,
    KnowledgeFSAuthorizationRevision,
    KnowledgeFSCapabilityIssuanceAudit,
    KnowledgeFSCapabilityIssuanceReservation,
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpacePermission,
    KnowledgeFSControlSpacePermissionRole,
    KnowledgeFSControlSpaceState,
    KnowledgeFSDeleteCommandPayload,
    KnowledgeFSExternalAccessPolicy,
    KnowledgeFSLifecycleOperation,
    KnowledgeFSLifecycleOutbox,
    KnowledgeFSLifecycleOutboxStatus,
    KnowledgeFSModelSelectionIntentPayload,
    KnowledgeFSProvisionCommandPayload,
    KnowledgeFSRetrievalProfileIntentPayload,
)
from repositories.knowledge_fs_control_space_repository import KnowledgeFSControlSpaceCASUpdate
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from repositories.sqlalchemy_knowledge_fs_lifecycle_outbox_repository import (
    SQLAlchemyKnowledgeFSLifecycleOutboxRepository,
)
from services.knowledge_fs.control_space_lifecycle import (
    KnowledgeFSControlSpaceLifecycleService,
    KnowledgeFSControlSpaceNotFoundError,
    KnowledgeFSControlSpaceVersionConflictError,
    KnowledgeFSWorkspaceDeletionBlockedError,
)


class KnowledgeFSProvisionIntent(NamedTuple):
    tenant_id: str
    owner_account_id: str
    provisioning_key: str
    operation_id: str
    idempotency_key: str
    name: str
    slug: str
    icon: str | None
    description: str | None
    model_intent: KnowledgeFSModelSelectionIntentPayload
    profile_intent: KnowledgeFSRetrievalProfileIntentPayload


class KnowledgeFSProvisionIntentResult(NamedTuple):
    control_space: KnowledgeFSControlSpace
    outbox: KnowledgeFSLifecycleOutbox


class KnowledgeFSDeletionIntentResult(NamedTuple):
    control_space: KnowledgeFSControlSpace
    outbox: KnowledgeFSLifecycleOutbox | None


class KnowledgeFSControlSpaceIntentConflictError(RuntimeError):
    """An idempotency identity was reused for a different lifecycle intent."""


class KnowledgeFSControlSpaceCommandService:
    """Write control state and its outbox command in one database transaction."""

    def __init__(self, session_maker: sessionmaker[Session]):
        self._session_maker = session_maker

    def create_provision_intent(self, intent: KnowledgeFSProvisionIntent) -> KnowledgeFSProvisionIntentResult:
        with self._session_maker.begin() as session:
            control_repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            existing = control_repository.find_by_provisioning_key(provisioning_key=intent.provisioning_key)
            if existing is not None:
                command = outbox_repository.get_by_operation_id(
                    tenant_id=intent.tenant_id,
                    operation_id=intent.operation_id,
                )
                if (
                    existing.tenant_id != intent.tenant_id
                    or existing.owner_account_id != intent.owner_account_id
                    or command is None
                    or command.control_space_id != existing.id
                    or command.idempotency_key != intent.idempotency_key
                ):
                    raise KnowledgeFSControlSpaceIntentConflictError(
                        "KnowledgeFS provisioning key was reused for a different intent"
                    )
                return KnowledgeFSProvisionIntentResult(existing, command)

            control_space = control_repository.add(
                KnowledgeFSControlSpace(
                    tenant_id=intent.tenant_id,
                    owner_account_id=intent.owner_account_id,
                    provisioning_key=intent.provisioning_key,
                    lifecycle_operation_id=intent.operation_id,
                )
            )
            session.add(
                KnowledgeFSAuthorizationRevision(
                    tenant_id=intent.tenant_id,
                    control_space_id=control_space.id,
                )
            )
            session.add(
                KnowledgeFSControlSpacePermission(
                    tenant_id=intent.tenant_id,
                    control_space_id=control_space.id,
                    account_id=intent.owner_account_id,
                    role=KnowledgeFSControlSpacePermissionRole.OWNER,
                    granted_by_account_id=intent.owner_account_id,
                )
            )
            payload = KnowledgeFSProvisionCommandPayload(
                schema_version=1,
                idempotency_key=intent.idempotency_key,
                expected_revision=0,
                provisioning_key=intent.provisioning_key,
                name=intent.name,
                icon=intent.icon,
                description=intent.description,
                slug=intent.slug,
                model_intent=KnowledgeFSModelSelectionIntentPayload(**intent.model_intent),
                profile_intent=KnowledgeFSRetrievalProfileIntentPayload(**intent.profile_intent),
            )
            command = outbox_repository.add(
                KnowledgeFSLifecycleOutbox(
                    tenant_id=intent.tenant_id,
                    control_space_id=control_space.id,
                    operation_id=intent.operation_id,
                    idempotency_key=intent.idempotency_key,
                    operation=KnowledgeFSLifecycleOperation.PROVISION,
                    command_payload=payload,
                    expected_control_space_version=control_space.resource_version,
                    expected_knowledge_space_revision=0,
                )
            )
            return KnowledgeFSProvisionIntentResult(control_space, command)

    def request_deletion(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        operation_id: str,
        idempotency_key: str,
    ) -> KnowledgeFSDeletionIntentResult:
        """Use the same durable path for single, batch, and workspace cleanup."""

        with self._session_maker.begin() as session:
            control_repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            outbox_repository = SQLAlchemyKnowledgeFSLifecycleOutboxRepository(session)
            control_space = control_repository.get(tenant_id=tenant_id, control_space_id=control_space_id)
            if control_space is None:
                raise KnowledgeFSControlSpaceNotFoundError("KnowledgeFS control-space was not found in this tenant")
            if control_space.state is KnowledgeFSControlSpaceState.DELETED:
                return KnowledgeFSDeletionIntentResult(control_space, None)

            replay = outbox_repository.get_by_operation_id(tenant_id=tenant_id, operation_id=operation_id)
            if replay is not None:
                if replay.control_space_id != control_space_id or replay.idempotency_key != idempotency_key:
                    raise KnowledgeFSControlSpaceIntentConflictError(
                        "KnowledgeFS deletion operation was reused for a different intent"
                    )
                if (
                    replay.operation is KnowledgeFSLifecycleOperation.DELETE
                    and replay.status is KnowledgeFSLifecycleOutboxStatus.DEAD_LETTER
                ):
                    if not outbox_repository.reactivate_dead_letter(outbox_id=replay.id):
                        raise KnowledgeFSControlSpaceVersionConflictError(
                            "KnowledgeFS permanent cleanup command changed before reactivation"
                        )
                    replay = outbox_repository.get(outbox_id=replay.id)
                    if replay is None:
                        raise KnowledgeFSControlSpaceNotFoundError("KnowledgeFS cleanup command disappeared")
                return KnowledgeFSDeletionIntentResult(control_space, replay)
            open_command = outbox_repository.find_open_for_control_space(
                tenant_id=tenant_id,
                control_space_id=control_space_id,
                operation=KnowledgeFSLifecycleOperation.DELETE,
            )
            if open_command is not None:
                return KnowledgeFSDeletionIntentResult(control_space, open_command)

            if control_space.state is KnowledgeFSControlSpaceState.DELETING:
                changed = control_repository.compare_and_set_lifecycle(
                    KnowledgeFSControlSpaceCASUpdate(
                        tenant_id=tenant_id,
                        control_space_id=control_space_id,
                        expected_resource_version=control_space.resource_version,
                        expected_state=KnowledgeFSControlSpaceState.DELETING,
                        new_state=KnowledgeFSControlSpaceState.DELETING,
                        lifecycle_operation_id=operation_id,
                    )
                )
                if not changed:
                    raise KnowledgeFSControlSpaceVersionConflictError(
                        "KnowledgeFS control-space changed while restoring permanent cleanup"
                    )
                transitioned = control_repository.get(tenant_id=tenant_id, control_space_id=control_space_id)
                if transitioned is None:
                    raise KnowledgeFSControlSpaceNotFoundError("KnowledgeFS control-space disappeared")
            else:
                transitioned = KnowledgeFSControlSpaceLifecycleService(control_repository).transition(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    expected_resource_version=control_space.resource_version,
                    new_state=KnowledgeFSControlSpaceState.DELETING,
                    lifecycle_operation_id=operation_id,
                )

            payload = KnowledgeFSDeleteCommandPayload(
                schema_version=1,
                idempotency_key=idempotency_key,
                expected_revision=transitioned.knowledge_space_revision,
                knowledge_space_id=transitioned.knowledge_space_id,
                provisioning_key=transitioned.provisioning_key,
            )
            command = outbox_repository.add(
                KnowledgeFSLifecycleOutbox(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    operation_id=operation_id,
                    idempotency_key=idempotency_key,
                    operation=KnowledgeFSLifecycleOperation.DELETE,
                    command_payload=payload,
                    expected_control_space_version=transitioned.resource_version,
                    expected_knowledge_space_revision=transitioned.knowledge_space_revision,
                )
            )
            return KnowledgeFSDeletionIntentResult(transitioned, command)

    def request_workspace_cleanup(self, *, tenant_id: str) -> tuple[KnowledgeFSDeletionIntentResult, ...]:
        """Enumerate independent control-spaces; never hard-delete them with the workspace."""

        with self._session_maker() as session:
            control_spaces = SQLAlchemyKnowledgeFSControlSpaceRepository(session).list_for_tenant(tenant_id=tenant_id)
            control_space_ids = tuple(
                control_space.id
                for control_space in control_spaces
                if control_space.state is not KnowledgeFSControlSpaceState.DELETED
            )
        commands: list[KnowledgeFSDeletionIntentResult] = []
        for control_space_id in control_space_ids:
            operation_id = str(
                uuid.uuid5(uuid.NAMESPACE_URL, f"dify-kfs-workspace-cleanup:{tenant_id}:{control_space_id}")
            )
            commands.append(
                self.request_deletion(
                    tenant_id=tenant_id,
                    control_space_id=control_space_id,
                    operation_id=operation_id,
                    idempotency_key=f"workspace-cleanup:{tenant_id}:{control_space_id}",
                )
            )
        return tuple(commands)

    def assert_workspace_deletion_allowed(self, *, tenant_id: str) -> None:
        with self._session_maker() as session:
            repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            KnowledgeFSControlSpaceLifecycleService(repository).assert_workspace_deletion_allowed(tenant_id=tenant_id)

    def finalize_workspace_deletion(self, *, tenant_id: str) -> int:
        """Remove local control-plane rows only after every remote Space is durably deleted.

        The control-space Workspace FK remains ``RESTRICT`` until this explicit finalizer
        succeeds, so a caller cannot hard-delete the Workspace and strand remote resources.
        """

        with self._session_maker.begin() as session:
            control_spaces = tuple(
                session.scalars(
                    sa.select(KnowledgeFSControlSpace)
                    .where(KnowledgeFSControlSpace.tenant_id == tenant_id)
                    .order_by(KnowledgeFSControlSpace.created_at, KnowledgeFSControlSpace.id)
                    .with_for_update()
                )
            )
            blocking_ids = tuple(
                control_space.id
                for control_space in control_spaces
                if control_space.state is not KnowledgeFSControlSpaceState.DELETED
            )
            if blocking_ids:
                raise KnowledgeFSWorkspaceDeletionBlockedError(blocking_ids)

            for model in (
                KnowledgeFSLifecycleOutbox,
                KnowledgeFSCapabilityIssuanceAudit,
                KnowledgeFSCapabilityIssuanceReservation,
                KnowledgeFSAuthorizationRevision,
                AppKnowledgeFSSpaceJoin,
                KnowledgeFSApiCredential,
                KnowledgeFSExternalAccessPolicy,
                KnowledgeFSControlSpacePermission,
            ):
                session.execute(sa.delete(model).where(model.tenant_id == tenant_id))
            session.execute(sa.delete(KnowledgeFSControlSpace).where(KnowledgeFSControlSpace.tenant_id == tenant_id))
            return len(control_spaces)


__all__ = [
    "KnowledgeFSControlSpaceCommandService",
    "KnowledgeFSControlSpaceIntentConflictError",
    "KnowledgeFSDeletionIntentResult",
    "KnowledgeFSProvisionIntent",
    "KnowledgeFSProvisionIntentResult",
]
