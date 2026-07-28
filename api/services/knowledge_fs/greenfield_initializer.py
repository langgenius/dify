"""Automatic bootstrap for Workspaces that have never owned KnowledgeFS state."""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.account import Tenant, TenantAccountJoin, TenantAccountRole, TenantStatus
from models.knowledge_fs_cutover import KnowledgeFSWorkspaceCutoverLedger
from services.knowledge_fs.cutover import (
    KnowledgeFSCutoverGateBlockedError,
    KnowledgeFSWorkspaceCutoverService,
)


class KnowledgeFSWorkspaceGreenfieldInitializer:
    """Resolve the Workspace owner and delegate the auditable zero-state cutover."""

    def __init__(
        self,
        session_maker: sessionmaker[Session],
        *,
        cutover: KnowledgeFSWorkspaceCutoverService,
    ) -> None:
        self._session_maker = session_maker
        self._cutover = cutover

    def ensure_initialized(self, *, tenant_id: str) -> KnowledgeFSWorkspaceCutoverLedger:
        with self._session_maker() as session:
            tenant = session.scalar(
                sa.select(Tenant).where(
                    Tenant.id == tenant_id,
                    Tenant.status == TenantStatus.NORMAL,
                )
            )
            if tenant is None:
                raise KnowledgeFSCutoverGateBlockedError("KnowledgeFS Workspace is not active")
            owner_account_ids = tuple(
                session.scalars(
                    sa.select(TenantAccountJoin.account_id)
                    .where(
                        TenantAccountJoin.tenant_id == tenant_id,
                        TenantAccountJoin.role == TenantAccountRole.OWNER,
                    )
                    .order_by(TenantAccountJoin.account_id)
                ).all()
            )
        if len(owner_account_ids) != 1:
            raise KnowledgeFSCutoverGateBlockedError(
                "Automatic KnowledgeFS initialization requires exactly one Workspace owner"
            )
        return self._cutover.initialize_greenfield(
            tenant_id=tenant_id,
            owner_account_id=owner_account_ids[0],
        )


__all__ = ["KnowledgeFSWorkspaceGreenfieldInitializer"]
