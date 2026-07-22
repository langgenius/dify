"""Fail-closed runtime admission for per-Workspace KnowledgeFS cutover."""

from __future__ import annotations

from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs_cutover import (
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError

_TRAFFIC_PHASES = frozenset(
    {
        KnowledgeFSWorkspaceCutoverPhase.CUTOVER,
        KnowledgeFSWorkspaceCutoverPhase.OBSERVING,
        KnowledgeFSWorkspaceCutoverPhase.READY_FOR_CLEANUP,
    }
)


class KnowledgeFSWorkspaceRuntimeGatePort(Protocol):
    """Workspace-scoped admission checked before product traffic or token issuance."""

    def require_product_routes(self, *, tenant_id: str) -> None: ...

    def require_capability_v2(self, *, tenant_id: str) -> None: ...


class SQLKnowledgeFSWorkspaceRuntimeGate:
    """Read the atomic cutover row and reject missing or partial rollout state."""

    def __init__(self, session_maker: sessionmaker[Session]) -> None:
        self._session_maker = session_maker

    def require_product_routes(self, *, tenant_id: str) -> None:
        self._require_complete_cutover(tenant_id=tenant_id)

    def require_capability_v2(self, *, tenant_id: str) -> None:
        self._require_complete_cutover(tenant_id=tenant_id)

    def _require_complete_cutover(self, *, tenant_id: str) -> None:
        with self._session_maker() as session:
            ledger = session.scalar(
                sa.select(KnowledgeFSWorkspaceCutoverLedger).where(
                    KnowledgeFSWorkspaceCutoverLedger.tenant_id == tenant_id
                )
            )
        if (
            ledger is None
            or ledger.phase not in _TRAFFIC_PHASES
            or ledger.cutover_at is None
            or ledger.rolled_back_at is not None
            or not ledger.product_routes_enabled
            or not ledger.capability_v2_enabled
            or not ledger.integrated_mode_enabled
            or not ledger.legacy_acl_read_only
        ):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workspace is not cut over for product traffic")


__all__ = ["KnowledgeFSWorkspaceRuntimeGatePort", "SQLKnowledgeFSWorkspaceRuntimeGate"]
