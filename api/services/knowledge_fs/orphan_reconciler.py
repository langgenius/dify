"""Conservative local/remote reconciliation for KnowledgeFS control-spaces."""

from __future__ import annotations

import uuid
from typing import NamedTuple

from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import KnowledgeFSControlSpaceState
from repositories.sqlalchemy_knowledge_fs_control_space_repository import (
    SQLAlchemyKnowledgeFSControlSpaceRepository,
)
from services.knowledge_fs.control_space_commands import KnowledgeFSControlSpaceCommandService
from services.knowledge_fs.control_space_lifecycle import KnowledgeFSControlSpaceLifecycleService
from services.knowledge_fs.lifecycle_port import KnowledgeFSLifecycleRemotePort


class KnowledgeFSOrphanReport(NamedTuple):
    repaired_control_space_ids: tuple[str, ...]
    remote_orphan_space_ids: tuple[str, ...]
    local_missing_remote_ids: tuple[str, ...]
    cleanup_control_space_ids: tuple[str, ...]


class KnowledgeFSOrphanReconciler:
    """Repair identities proven by provisioning_key; report ambiguous drift fail-closed."""

    def __init__(self, session_maker: sessionmaker[Session], remote: KnowledgeFSLifecycleRemotePort):
        self._session_maker = session_maker
        self._remote = remote

    def reconcile(self, *, limit: int = 500, apply_repairs: bool = True) -> KnowledgeFSOrphanReport:
        with self._session_maker() as session:
            repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
            local_spaces = repository.list_for_reconciliation(limit=limit)
            control_space_by_tenant: dict[str, str] = {}
            for space in local_spaces:
                control_space_by_tenant.setdefault(space.tenant_id, space.id)
            local_keys = {
                space.provisioning_key
                for tenant_id in control_space_by_tenant
                for space in repository.list_for_tenant(tenant_id=tenant_id)
                if space.state is not KnowledgeFSControlSpaceState.DELETED
            }
        remote_spaces = tuple(
            space
            for tenant_id, control_space_id in sorted(control_space_by_tenant.items())
            for space in self._remote.list_spaces(
                namespace_id=tenant_id,
                control_space_id=control_space_id,
            )
        )
        remote_by_key = {space.provisioning_key: space for space in remote_spaces}
        repaired: list[str] = []
        local_missing: list[str] = []
        cleanup: list[str] = []

        for snapshot in local_spaces:
            remote_space = remote_by_key.get(snapshot.provisioning_key)
            if apply_repairs and (
                remote_space is not None
                and remote_space.namespace_id == snapshot.tenant_id
                and snapshot.state is KnowledgeFSControlSpaceState.PROVISIONING
                and snapshot.deletion_irreversible_at is None
            ):
                with self._session_maker.begin() as session:
                    repository = SQLAlchemyKnowledgeFSControlSpaceRepository(session)
                    current = repository.get(tenant_id=snapshot.tenant_id, control_space_id=snapshot.id)
                    if current is not None and current.resource_version == snapshot.resource_version:
                        KnowledgeFSControlSpaceLifecycleService(repository).transition(
                            tenant_id=snapshot.tenant_id,
                            control_space_id=snapshot.id,
                            expected_resource_version=snapshot.resource_version,
                            new_state=KnowledgeFSControlSpaceState.ACTIVE,
                            lifecycle_operation_id=snapshot.lifecycle_operation_id or "orphan-reconcile",
                            knowledge_space_id=remote_space.knowledge_space_id,
                            knowledge_space_revision=remote_space.revision,
                        )
                        repaired.append(snapshot.id)
                continue
            if apply_repairs and snapshot.state is KnowledgeFSControlSpaceState.DELETING:
                operation_id = str(
                    uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"dify-kfs-orphan-cleanup:{snapshot.tenant_id}:{snapshot.id}:{snapshot.resource_version}",
                    )
                )
                result = KnowledgeFSControlSpaceCommandService(self._session_maker).request_deletion(
                    tenant_id=snapshot.tenant_id,
                    control_space_id=snapshot.id,
                    operation_id=operation_id,
                    idempotency_key=f"orphan-cleanup:{snapshot.tenant_id}:{snapshot.id}",
                )
                if result.outbox is not None:
                    cleanup.append(snapshot.id)
                continue
            if snapshot.knowledge_space_id is not None and remote_space is None:
                local_missing.append(snapshot.id)

        remote_orphans = tuple(
            sorted(space.knowledge_space_id for space in remote_spaces if space.provisioning_key not in local_keys)
        )
        return KnowledgeFSOrphanReport(
            repaired_control_space_ids=tuple(sorted(repaired)),
            remote_orphan_space_ids=remote_orphans,
            local_missing_remote_ids=tuple(sorted(local_missing)),
            cleanup_control_space_ids=tuple(sorted(cleanup)),
        )


__all__ = ["KnowledgeFSOrphanReconciler", "KnowledgeFSOrphanReport"]
