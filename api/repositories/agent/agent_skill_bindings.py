"""Stage Agent skill binding changes in a caller-owned transaction."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.skill import AgentSkillBinding, AgentSkillBindingSnapshot


def publish_agent_bindings(session: Session, *, tenant_id: str, agent_id: str, snapshot_id: str, user_id: str) -> None:
    """Stage the tenant-scoped skill bindings; the caller owns commit and rollback."""
    draft_bindings = list(
        session.scalars(
            select(AgentSkillBinding)
            .where(
                AgentSkillBinding.tenant_id == tenant_id,
                AgentSkillBinding.agent_id == agent_id,
            )
            .order_by(AgentSkillBinding.priority, AgentSkillBinding.created_at, AgentSkillBinding.id)
        )
    )
    session.query(AgentSkillBindingSnapshot).filter(
        AgentSkillBindingSnapshot.tenant_id == tenant_id,
        AgentSkillBindingSnapshot.agent_id == agent_id,
        AgentSkillBindingSnapshot.config_snapshot_id == snapshot_id,
    ).delete(synchronize_session=False)
    for binding in draft_bindings:
        session.add(
            AgentSkillBindingSnapshot(
                tenant_id=tenant_id,
                agent_id=agent_id,
                config_snapshot_id=snapshot_id,
                skill_id=binding.skill_id,
                priority=binding.priority,
                created_by=user_id,
            )
        )
    session.flush()


def copy_agent_bindings(
    session: Session,
    *,
    tenant_id: str,
    source_agent_id: str,
    source_snapshot_id: str,
    target_agent_id: str,
    user_id: str,
    target_snapshot_id: str | None = None,
    source_include_draft: bool = False,
) -> None:
    """Stage the tenant-scoped skill bindings; the caller owns commit and rollback."""
    if source_include_draft:
        source_bindings = list(
            session.scalars(
                select(AgentSkillBinding)
                .where(
                    AgentSkillBinding.tenant_id == tenant_id,
                    AgentSkillBinding.agent_id == source_agent_id,
                )
                .order_by(AgentSkillBinding.priority, AgentSkillBinding.created_at)
            )
        )
    else:
        source_bindings = list(
            session.scalars(
                select(AgentSkillBindingSnapshot)
                .where(
                    AgentSkillBindingSnapshot.tenant_id == tenant_id,
                    AgentSkillBindingSnapshot.agent_id == source_agent_id,
                    AgentSkillBindingSnapshot.config_snapshot_id == source_snapshot_id,
                )
                .order_by(AgentSkillBindingSnapshot.priority, AgentSkillBindingSnapshot.created_at)
            )
        )
        # Older installations may have published Agents without the
        # binding snapshot table populated yet. Preserve their current
        # binding set until the migration/backfill has run.
        if not source_bindings:
            source_bindings = list(
                session.scalars(
                    select(AgentSkillBinding)
                    .where(
                        AgentSkillBinding.tenant_id == tenant_id,
                        AgentSkillBinding.agent_id == source_agent_id,
                    )
                    .order_by(AgentSkillBinding.priority, AgentSkillBinding.created_at)
                )
            )
    session.query(AgentSkillBinding).filter(
        AgentSkillBinding.tenant_id == tenant_id,
        AgentSkillBinding.agent_id == target_agent_id,
    ).delete(synchronize_session=False)
    if target_snapshot_id is not None:
        session.query(AgentSkillBindingSnapshot).filter(
            AgentSkillBindingSnapshot.tenant_id == tenant_id,
            AgentSkillBindingSnapshot.agent_id == target_agent_id,
            AgentSkillBindingSnapshot.config_snapshot_id == target_snapshot_id,
        ).delete(synchronize_session=False)

    for priority, binding in enumerate(source_bindings):
        session.add(
            AgentSkillBinding(
                tenant_id=tenant_id,
                agent_id=target_agent_id,
                skill_id=binding.skill_id,
                priority=priority,
                created_by=user_id,
            )
        )
        if target_snapshot_id is not None:
            session.add(
                AgentSkillBindingSnapshot(
                    tenant_id=tenant_id,
                    agent_id=target_agent_id,
                    config_snapshot_id=target_snapshot_id,
                    skill_id=binding.skill_id,
                    priority=priority,
                    created_by=user_id,
                )
            )
    session.flush()
