"""Persistence contract for irreversible KnowledgeFS cleanup authorization."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from models.knowledge_fs_cleanup import (
    KnowledgeFSCleanupAuthorization,
    KnowledgeFSCleanupAuthorizationStatus,
)


@dataclass(frozen=True, slots=True)
class KnowledgeFSCleanupAuthorizationCASUpdate:
    tenant_id: str
    ledger_id: str
    request_id: str
    expected_status: KnowledgeFSCleanupAuthorizationStatus
    expected_row_version: int
    new_status: KnowledgeFSCleanupAuthorizationStatus
    approved_by_account_id: str | None = None
    approved_at: datetime | None = None
    approval_expires_at: datetime | None = None
    approved_ledger_cas_version: int | None = None
    started_by_account_id: str | None = None
    started_at: datetime | None = None
    started_ledger_cas_version: int | None = None
    completed_by_account_id: str | None = None
    completed_at: datetime | None = None
    completion_evidence: dict[str, object] | None = None
    completed_ledger_cas_version: int | None = None


class KnowledgeFSCleanupAuthorizationRepository(Protocol):
    def add(self, authorization: KnowledgeFSCleanupAuthorization) -> KnowledgeFSCleanupAuthorization: ...

    def get(
        self,
        *,
        tenant_id: str,
        ledger_id: str,
        request_id: str,
    ) -> KnowledgeFSCleanupAuthorization | None: ...

    def compare_and_set(self, update_values: KnowledgeFSCleanupAuthorizationCASUpdate) -> bool: ...


__all__ = [
    "KnowledgeFSCleanupAuthorizationCASUpdate",
    "KnowledgeFSCleanupAuthorizationRepository",
]
