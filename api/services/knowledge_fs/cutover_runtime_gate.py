"""Fail-closed runtime admission for per-Workspace KnowledgeFS cutover."""

from __future__ import annotations

import logging
from typing import Protocol

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs_cutover import (
    KnowledgeFSWorkspaceCutoverLedger,
    KnowledgeFSWorkspaceCutoverPhase,
)
from services.knowledge_fs.product_remote import KnowledgeFSOperationUnavailableError

logger = logging.getLogger(__name__)

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


class KnowledgeFSWorkspaceInitializerPort(Protocol):
    """Lazily establish a fail-closed greenfield cutover for one Workspace."""

    def ensure_initialized(self, *, tenant_id: str) -> KnowledgeFSWorkspaceCutoverLedger: ...


class SQLKnowledgeFSWorkspaceRuntimeGate:
    """Read the atomic cutover row, lazily bootstrap greenfield, and fail closed."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        initializer: KnowledgeFSWorkspaceInitializerPort | None = None,
    ) -> None:
        self._session_maker = session_maker
        self._initializer = initializer

    def require_product_routes(self, *, tenant_id: str) -> None:
        self._require_complete_cutover(tenant_id=tenant_id)

    def require_capability_v2(self, *, tenant_id: str) -> None:
        self._require_complete_cutover(tenant_id=tenant_id)

    def _require_complete_cutover(self, *, tenant_id: str) -> None:
        ledger = self._read_ledger(tenant_id=tenant_id)
        if not _is_complete_cutover(ledger) and self._initializer is not None:
            try:
                self._initializer.ensure_initialized(tenant_id=tenant_id)
            except Exception as exc:
                logger.warning(
                    "KnowledgeFS automatic Workspace initialization failed",
                    extra={"tenant_id": tenant_id},
                    exc_info=True,
                )
                raise KnowledgeFSOperationUnavailableError(
                    "KnowledgeFS Workspace is not cut over for product traffic"
                ) from exc
            ledger = self._read_ledger(tenant_id=tenant_id)
        if not _is_complete_cutover(ledger):
            raise KnowledgeFSOperationUnavailableError("KnowledgeFS Workspace is not cut over for product traffic")

    def _read_ledger(self, *, tenant_id: str) -> KnowledgeFSWorkspaceCutoverLedger | None:
        with self._session_maker() as session:
            return session.scalar(
                sa.select(KnowledgeFSWorkspaceCutoverLedger).where(
                    KnowledgeFSWorkspaceCutoverLedger.tenant_id == tenant_id
                )
            )


def _is_complete_cutover(ledger: KnowledgeFSWorkspaceCutoverLedger | None) -> bool:
    return bool(
        ledger is not None
        and ledger.phase in _TRAFFIC_PHASES
        and ledger.cutover_at is not None
        and ledger.rolled_back_at is None
        and ledger.product_routes_enabled
        and ledger.capability_v2_enabled
        and ledger.integrated_mode_enabled
        and ledger.legacy_acl_read_only
    )


__all__ = [
    "KnowledgeFSWorkspaceInitializerPort",
    "KnowledgeFSWorkspaceRuntimeGatePort",
    "SQLKnowledgeFSWorkspaceRuntimeGate",
]
