"""KnowledgeFS Agent bindings managed within a caller-owned transaction."""

from collections.abc import Callable
from typing import Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.knowledge_fs import AppKnowledgeFSSpaceJoin, KnowledgeFSAppSpaceJoinType


class KnowledgeFSAgentBindingStager(Protocol):
    def stage_authorized_agent_bindings(
        self,
        *,
        session: Session,
        tenant_id: str,
        actor_account_id: str,
        app_id: str,
        control_space_ids: list[str],
    ) -> None:
        """Reconcile authorized Agent bindings without committing the caller's transaction."""
        ...


def has_agent_app_bindings(session: Session, *, tenant_id: str, app_id: str) -> bool:
    """Check for any Agent binding rows for the tenant and App in the supplied session."""
    return (
        session.scalar(
            select(AppKnowledgeFSSpaceJoin.id)
            .where(
                AppKnowledgeFSSpaceJoin.tenant_id == tenant_id,
                AppKnowledgeFSSpaceJoin.app_id == app_id,
                AppKnowledgeFSSpaceJoin.join_type == KnowledgeFSAppSpaceJoinType.AGENT,
            )
            .limit(1)
        )
        is not None
    )


def stage_published_agent_knowledge_bindings(
    session: Session,
    *,
    tenant_id: str,
    account_id: str,
    app_id: str,
    control_space_ids: list[str],
    load_stager: Callable[[], KnowledgeFSAgentBindingStager],
) -> None:
    """Stage previously authorized bindings using the open publication transaction.

    An empty target list clears existing Agent bindings. With no targets and no
    existing bindings, return without loading KnowledgeFS. The caller commits.
    """
    if control_space_ids or has_agent_app_bindings(session, tenant_id=tenant_id, app_id=app_id):
        load_stager().stage_authorized_agent_bindings(
            session=session,
            tenant_id=tenant_id,
            actor_account_id=account_id,
            app_id=app_id,
            control_space_ids=control_space_ids,
        )
