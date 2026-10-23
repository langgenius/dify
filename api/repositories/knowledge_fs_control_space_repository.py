"""Persistence boundary for tenant-scoped KnowledgeFS lifecycle operations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from models.knowledge_fs import KnowledgeFSControlSpace, KnowledgeFSControlSpaceState


@dataclass(frozen=True, slots=True)
class KnowledgeFSControlSpaceCASUpdate:
    """Values applied only when the stored state and resource version match."""

    tenant_id: str
    control_space_id: str
    expected_resource_version: int
    expected_state: KnowledgeFSControlSpaceState
    new_state: KnowledgeFSControlSpaceState
    lifecycle_operation_id: str
    knowledge_space_id: str | None = None
    knowledge_space_revision: int | None = None
    attempted_at: datetime | None = None
    last_error_code: str | None = None
    last_error_message: str | None = None


class KnowledgeFSControlSpaceRepository(Protocol):
    """Repository operations that always include the owning Dify tenant."""

    def add(self, control_space: KnowledgeFSControlSpace) -> KnowledgeFSControlSpace: ...

    def get(self, *, tenant_id: str, control_space_id: str) -> KnowledgeFSControlSpace | None: ...

    def find_by_provisioning_key(self, *, provisioning_key: str) -> KnowledgeFSControlSpace | None: ...

    def find_by_knowledge_space_id(
        self, *, tenant_id: str, knowledge_space_id: str
    ) -> KnowledgeFSControlSpace | None: ...

    def list_for_tenant(self, *, tenant_id: str) -> tuple[KnowledgeFSControlSpace, ...]: ...

    def list_for_reconciliation(self, *, limit: int) -> tuple[KnowledgeFSControlSpace, ...]: ...

    def compare_and_set_lifecycle(self, update_values: KnowledgeFSControlSpaceCASUpdate) -> bool: ...

    def mark_deletion_irreversible(
        self,
        *,
        tenant_id: str,
        control_space_id: str,
        lifecycle_operation_id: str,
        irreversible_at: datetime,
    ) -> bool: ...

    def list_workspace_deletion_blockers(self, *, tenant_id: str) -> tuple[str, ...]: ...


__all__ = ["KnowledgeFSControlSpaceCASUpdate", "KnowledgeFSControlSpaceRepository"]
