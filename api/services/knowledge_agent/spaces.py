"""The member's current view of Agent Knowledge Bases, for knowledge-agent connections."""

from __future__ import annotations

from collections.abc import Iterable

import sqlalchemy as sa
from sqlalchemy.orm import Session, sessionmaker

from models.knowledge_fs import (
    KnowledgeFSControlSpace,
    KnowledgeFSControlSpaceState,
    KnowledgeFSExternalAccessPolicy,
)
from services.knowledge_fs.product_authorization import (
    DifyKnowledgeFSProductRBACPort,
    KnowledgeFSProductRBACPort,
    effective_product_permissions,
    resolve_local_roles,
    visible_control_space_statement,
)
from services.knowledge_fs.product_operations import KnowledgeFSProductPermission

_MAX_IDS = 500


class SQLKnowledgeAgentSpacePort:
    """Same visibility, local roles and enterprise RBAC as the knowledge list in the Console."""

    def __init__(self, session_maker: sessionmaker[Session], rbac: KnowledgeFSProductRBACPort | None = None) -> None:
        self._sessions = session_maker
        self._rbac = rbac or DifyKnowledgeFSProductRBACPort()

    def readable(self, *, tenant_id: str, account_id: str, control_space_ids: Iterable[str]) -> set[str]:
        ids = list(dict.fromkeys(control_space_ids))[:_MAX_IDS]
        if not ids:
            return set()
        with self._sessions() as session:
            candidates = tuple(
                session.scalars(
                    visible_control_space_statement(tenant_id=tenant_id, account_id=account_id).where(
                        KnowledgeFSControlSpace.id.in_(ids),
                        KnowledgeFSControlSpace.state == KnowledgeFSControlSpaceState.ACTIVE,
                        KnowledgeFSControlSpace.knowledge_space_id.is_not(None),
                    )
                )
            )
            roles = resolve_local_roles(session, control_spaces=candidates, account_id=account_id)
            rbac = self._rbac.permission_keys_by_control_space(
                session=session,
                tenant_id=tenant_id,
                account_id=account_id,
                control_space_ids=[space.id for space in candidates],
            )
            return {
                space.id
                for space in candidates
                if KnowledgeFSProductPermission.READ
                in effective_product_permissions(roles.get(space.id), rbac.get(space.id, frozenset()))
            }

    def blocked(self, *, tenant_id: str, control_space_ids: Iterable[str] | None = None) -> set[str]:
        statement = sa.select(KnowledgeFSExternalAccessPolicy.control_space_id).where(
            KnowledgeFSExternalAccessPolicy.tenant_id == tenant_id,
            KnowledgeFSExternalAccessPolicy.personal_agent_enabled.is_(False),
        )
        if control_space_ids is not None:
            ids = list(control_space_ids)
            if not ids:
                return set()
            statement = statement.where(KnowledgeFSExternalAccessPolicy.control_space_id.in_(ids))
        with self._sessions() as session:
            return set(session.scalars(statement).all())
