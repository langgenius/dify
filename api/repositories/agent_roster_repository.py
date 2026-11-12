"""Tenant-scoped Agent roster queries and detached invite-option records."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from libs.helper import to_timestamp
from machinery.context import RequestContext
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    WorkflowAgentNodeBinding,
)
from models.workflow import Workflow
from repositories.agent_roster_queries import (
    build_roster_agents_stmt,
    load_published_workflows_by_agent_id,
    load_reference_counts_by_agent_id,
)
from services.agent.invite_options_store import (
    AgentInviteOption,
    AgentInviteOptionsPage,
    AgentInviteReference,
    AgentInviteSnapshot,
)


def _invite_snapshot(version: AgentConfigSnapshot | None) -> AgentInviteSnapshot | None:
    """Project a loaded snapshot into a detached directory value."""
    if version is None:
        return None
    return AgentInviteSnapshot(
        id=version.id,
        agent_id=version.agent_id,
        version=version.version,
        display_version=version.version,
        snapshot_version=version.version,
        summary=version.summary,
        version_note=version.version_note,
        created_by=version.created_by,
        created_at=to_timestamp(version.created_at),
    )


def _invite_option(
    agent: Agent,
    *,
    snapshot: AgentConfigSnapshot | None,
    references: tuple[AgentInviteReference, ...],
    active_config_is_published: bool,
    reference_count: int,
    node_ids: tuple[str, ...],
) -> AgentInviteOption:
    """Project loaded Agent data and workflow usage before its session closes."""
    return AgentInviteOption(
        id=agent.id,
        name=agent.name,
        description=agent.description,
        role=agent.role or "",
        icon_type=agent.icon_type.value if agent.icon_type else None,
        icon=agent.icon,
        icon_background=agent.icon_background,
        agent_kind=agent.agent_kind.value,
        scope=agent.scope.value,
        source=agent.source.value,
        app_id=agent.app_id,
        backing_app_id=agent.backing_app_id,
        hidden_app_backed=bool(agent.scope == AgentScope.WORKFLOW_ONLY and agent.backing_app_id),
        workflow_id=agent.workflow_id,
        workflow_node_id=agent.workflow_node_id,
        active_config_snapshot_id=agent.active_config_snapshot_id,
        active_config_snapshot=_invite_snapshot(snapshot),
        active_config_is_published=active_config_is_published,
        status=agent.status.value,
        created_by=agent.created_by,
        updated_by=agent.updated_by,
        archived_by=agent.archived_by,
        archived_at=to_timestamp(agent.archived_at),
        created_at=to_timestamp(agent.created_at),
        updated_at=to_timestamp(agent.updated_at),
        reference_count=reference_count,
        published_reference_count=len(references),
        published_node_reference_count=sum(len(reference.node_ids) for reference in references),
        published_references=references,
        is_in_current_workflow=bool(node_ids),
        in_current_workflow_count=len(node_ids),
        existing_node_ids=node_ids,
    )


def load_active_config_is_published_by_agent_id(*, tenant_id: str, agents: list[Agent]) -> dict[str, bool]:
    """Return the stored normal-draft publish state for already tenant-scoped Agents.

    The flag is maintained by write paths against the normal shared draft:
    saves compare the draft content with the active snapshot, while publish
    and version creation paths mark the new active snapshot clean.
    User-scoped debug drafts intentionally do not affect this state.
    """
    agents = [agent for agent in agents if agent.id]
    if not agents:
        return {}

    return {agent.id: bool(agent.active_config_snapshot_id and agent.active_config_is_published) for agent in agents}


def load_published_references_by_agent_id(
    session: Session, *, tenant_id: str, agent_ids: list[str]
) -> dict[str, tuple[AgentInviteReference, ...]]:
    """Detach published workflow references for the supplied tenant's Agents."""
    return {
        agent_id: tuple(
            AgentInviteReference(
                app_id=reference.app.id,
                app_name=reference.app.name,
                app_icon_type=reference.app.icon_type.value if reference.app.icon_type else None,
                app_icon=reference.app.icon,
                app_icon_background=reference.app.icon_background,
                app_mode=str(reference.app.mode),
                app_updated_at=to_timestamp(reference.app.updated_at),
                workflow_id=reference.workflow_id,
                workflow_version=reference.workflow_version,
                node_ids=reference.node_ids,
            )
            for reference in references
        )
        for agent_id, references in load_published_workflows_by_agent_id(
            session, tenant_id=tenant_id, agent_ids=agent_ids
        ).items()
    }


def load_versions_by_id(session: Session, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
    """Load the requested snapshots in the caller's session and index them by id."""
    if not version_ids:
        return {}
    versions = session.scalars(select(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(version_ids))).all()
    return {version.id: version for version in versions}


def list_invite_options_in_session(
    session: Session,
    *,
    tenant_id: str,
    page: int,
    limit: int,
    keyword: str | None,
    app_id: str | None,
    accessible_agent_ids: set[str] | None,
) -> AgentInviteOptionsPage:
    """Read and detach a page of callable Agents using the caller's tenant-scoped session."""
    stmt = build_roster_agents_stmt(tenant_id=tenant_id, keyword=keyword).where(
        Agent.active_config_has_model.is_(True), workflow_callable_active_snapshot_filter()
    )
    if accessible_agent_ids is not None:
        stmt = stmt.where(Agent.id.in_(accessible_agent_ids))
    total = session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    agents = list(session.scalars(stmt.offset((page - 1) * limit).limit(limit)).all())
    agent_ids = [agent.id for agent in agents]
    versions = load_versions_by_id(
        session, [agent.active_config_snapshot_id for agent in agents if agent.active_config_snapshot_id]
    )
    references = load_published_references_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
    counts = load_reference_counts_by_agent_id(session, tenant_id=tenant_id, agent_ids=agent_ids)
    published = load_active_config_is_published_by_agent_id(tenant_id=tenant_id, agents=agents)
    usage_by_agent_id: dict[str, list[str]] = {}
    if app_id and agent_ids:
        draft_workflow = session.scalar(
            select(Workflow)
            .where(
                Workflow.tenant_id == tenant_id, Workflow.app_id == app_id, Workflow.version == Workflow.VERSION_DRAFT
            )
            .limit(1)
        )
        if draft_workflow is not None:
            bindings = session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == tenant_id,
                    WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                    WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                )
            ).all()
            for binding in bindings:
                if binding.agent_id:
                    usage_by_agent_id.setdefault(binding.agent_id, []).append(binding.node_id)
    data = tuple(
        _invite_option(
            agent,
            snapshot=versions.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None,
            references=references.get(agent.id, ()),
            active_config_is_published=published.get(agent.id, False),
            reference_count=counts.get(agent.id, 0),
            node_ids=tuple(usage_by_agent_id.get(agent.id, ())),
        )
        for agent in agents
    )
    return AgentInviteOptionsPage(data=data, page=page, limit=limit, total=total, has_more=page * limit < total)


class SQLAlchemyAgentRosterRepository:
    """Load detached Agent directory records within a bounded read session."""

    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def list_invite_options(
        self,
        context: RequestContext,
        *,
        page: int,
        limit: int,
        keyword: str | None,
        app_id: str | None,
        accessible_agent_ids: set[str] | None,
    ) -> AgentInviteOptionsPage:
        """Return the admitted tenant's visible callable Agents after closing the session."""
        with self._session_factory() as session:
            return list_invite_options_in_session(
                session,
                tenant_id=context.active_workspace_id,
                page=page,
                limit=limit,
                keyword=keyword,
                app_id=app_id,
                accessible_agent_ids=accessible_agent_ids,
            )
