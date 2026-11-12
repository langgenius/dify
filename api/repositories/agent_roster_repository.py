"""Session-scoped Agent roster queries shared with legacy transaction callers."""

from pydantic import TypeAdapter
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, sessionmaker

from core.agent.publish_visibility import workflow_callable_active_snapshot_filter
from libs.helper import escape_like_pattern, to_timestamp
from machinery.context import RequestContext
from models.agent import (
    Agent,
    AgentConfigSnapshot,
    AgentScope,
    AgentStatus,
    WorkflowAgentBindingType,
    WorkflowAgentNodeBinding,
)
from models.enums import AppStatus
from models.model import App
from models.workflow import Workflow
from services.agent.invite_options_store import AgentInviteOptionsPage
from services.app.agent_app_contracts import AgentReferencingWorkflow


def serialize_agent(
    agent: Agent,
    active_version: AgentConfigSnapshot | None = None,
    published_references: list[AgentReferencingWorkflow] | None = None,
    active_config_is_published: bool | None = None,
    reference_count: int | None = None,
) -> dict[str, object]:
    """Project one loaded Agent and its related values without further database access."""
    published_references = published_references or []
    return {
        "id": agent.id,
        "name": agent.name,
        "description": agent.description,
        "role": agent.role or "",
        "icon_type": agent.icon_type.value if agent.icon_type else None,
        "icon": agent.icon,
        "icon_background": agent.icon_background,
        "agent_kind": agent.agent_kind.value,
        "scope": agent.scope.value,
        "source": agent.source.value,
        "app_id": agent.app_id,
        "backing_app_id": agent.backing_app_id,
        "hidden_app_backed": bool(agent.scope == AgentScope.WORKFLOW_ONLY and agent.backing_app_id),
        "debug_conversation_id": None,
        "workflow_id": agent.workflow_id,
        "workflow_node_id": agent.workflow_node_id,
        "active_config_snapshot_id": agent.active_config_snapshot_id,
        "active_config_snapshot": serialize_version(active_version) if active_version else None,
        "active_config_is_published": agent.active_config_is_published
        if active_config_is_published is None
        else active_config_is_published,
        "status": agent.status.value,
        "created_by": agent.created_by,
        "updated_by": agent.updated_by,
        "archived_by": agent.archived_by,
        "archived_at": to_timestamp(agent.archived_at),
        "created_at": to_timestamp(agent.created_at),
        "updated_at": to_timestamp(agent.updated_at),
        "reference_count": len(published_references) if reference_count is None else reference_count,
        "published_reference_count": len(published_references),
        "published_node_reference_count": sum(len(item["node_ids"]) for item in published_references),
        "published_references": published_references,
    }


def serialize_version(version: AgentConfigSnapshot | None) -> dict[str, object] | None:
    """Project a loaded snapshot, or return None when the snapshot is absent."""
    if version is None:
        return None
    return {
        "id": version.id,
        "agent_id": version.agent_id,
        "version": version.version,
        "display_version": version.version,
        "snapshot_version": version.version,
        "summary": version.summary,
        "version_note": version.version_note,
        "created_by": version.created_by,
        "created_at": to_timestamp(version.created_at),
    }


def build_roster_agents_stmt(*, tenant_id: str, keyword: str | None = None) -> Select[tuple[Agent]]:
    """Build the active roster query for one tenant, optionally filtered by name."""
    stmt = select(Agent).where(
        Agent.tenant_id == tenant_id,
        Agent.scope == AgentScope.ROSTER,
        Agent.status == AgentStatus.ACTIVE,
    )
    if keyword:
        escaped_keyword = escape_like_pattern(keyword)
        stmt = stmt.where(Agent.name.ilike(f"%{escaped_keyword}%", escape="\\"))
    return stmt.order_by(Agent.updated_at.desc())


def load_active_config_is_published_by_agent_id(*, tenant_id: str, agents: list[Agent]) -> dict[str, bool]:
    """Return each Agent's stored normal-draft publish state.

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
) -> dict[str, list[AgentReferencingWorkflow]]:
    """Return current published workflow references for the supplied tenant's Agents."""
    if not agent_ids:
        return {}

    bindings = list(
        session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
                WorkflowAgentNodeBinding.workflow_version != Workflow.VERSION_DRAFT,
            )
        ).all()
    )
    if not bindings:
        return {}

    app_ids = {binding.app_id for binding in bindings}
    apps = {
        app.id: app
        for app in session.scalars(
            select(App).where(
                App.tenant_id == tenant_id,
                App.id.in_(app_ids),
                App.status == AppStatus.NORMAL,
            )
        ).all()
    }

    grouped: dict[str, dict[tuple[str, str], AgentReferencingWorkflow]] = {}
    for binding in bindings:
        app = apps.get(binding.app_id)
        if binding.agent_id and app is not None and app.workflow_id == binding.workflow_id:
            by_workflow = grouped.setdefault(binding.agent_id, {})
            key = (binding.app_id, binding.workflow_id)
            item = by_workflow.setdefault(
                key,
                AgentReferencingWorkflow(
                    app_id=binding.app_id,
                    app_name=app.name,
                    app_icon_type=app.icon_type.value if app.icon_type else None,
                    app_icon=app.icon,
                    app_icon_background=app.icon_background,
                    app_mode=str(app.mode),
                    app_updated_at=to_timestamp(app.updated_at),
                    workflow_id=binding.workflow_id,
                    workflow_version=binding.workflow_version,
                    node_ids=[],
                ),
            )
            item["node_ids"].append(binding.node_id)

    result: dict[str, list[AgentReferencingWorkflow]] = {}
    for agent_id, by_workflow in grouped.items():
        references = list(by_workflow.values())
        for reference in references:
            reference["node_ids"] = sorted(set(reference["node_ids"]))
        references.sort(key=lambda item: (-(item["app_updated_at"] or 0), item["app_name"].lower()))
        result[agent_id] = references
    return result


def load_reference_counts_by_agent_id(session: Session, *, tenant_id: str, agent_ids: list[str]) -> dict[str, int]:
    """Count distinct current draft or published workflow Apps referencing each Agent."""
    if not agent_ids:
        return {}

    bindings = list(
        session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == tenant_id,
                WorkflowAgentNodeBinding.agent_id.in_(agent_ids),
                WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT,
            )
        ).all()
    )
    if not bindings:
        return {}

    app_ids = {binding.app_id for binding in bindings}
    apps = {
        app.id: app
        for app in session.scalars(
            select(App).where(
                App.tenant_id == tenant_id,
                App.id.in_(app_ids),
                App.status == AppStatus.NORMAL,
            )
        ).all()
    }
    workflow_ids = {binding.workflow_id for binding in bindings}
    workflows = {
        workflow.id: workflow
        for workflow in session.scalars(
            select(Workflow).where(
                Workflow.tenant_id == tenant_id,
                Workflow.id.in_(workflow_ids),
            )
        ).all()
    }

    referenced_app_ids_by_agent_id: dict[str, set[str]] = {}
    for binding in bindings:
        app = apps.get(binding.app_id)
        workflow = workflows.get(binding.workflow_id)
        if (
            binding.agent_id
            and app is not None
            and workflow is not None
            and workflow.app_id == binding.app_id
            and workflow.version == binding.workflow_version
            and (workflow.version == Workflow.VERSION_DRAFT or app.workflow_id == workflow.id)
        ):
            referenced_app_ids_by_agent_id.setdefault(binding.agent_id, set()).add(binding.app_id)

    return {agent_id: len(app_ids) for agent_id, app_ids in referenced_app_ids_by_agent_id.items()}


def load_versions_by_id(session: Session, version_ids: list[str]) -> dict[str, AgentConfigSnapshot]:
    """Load the requested snapshots in the caller's session and index them by id."""
    if not version_ids:
        return {}
    versions = session.scalars(select(AgentConfigSnapshot).where(AgentConfigSnapshot.id.in_(version_ids))).all()
    return {version.id: version for version in versions}


_PAGE_ADAPTER = TypeAdapter(AgentInviteOptionsPage)


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
    data: list[dict[str, object]] = []
    for agent in agents:
        item = serialize_agent(
            agent,
            versions.get(agent.active_config_snapshot_id) if agent.active_config_snapshot_id else None,
            references.get(agent.id, []),
            published.get(agent.id, False),
            counts.get(agent.id, 0),
        )
        node_ids = usage_by_agent_id.get(agent.id, [])
        item.update(
            is_in_current_workflow=bool(node_ids), in_current_workflow_count=len(node_ids), existing_node_ids=node_ids
        )
        data.append(item)
    return _PAGE_ADAPTER.validate_python(
        {"data": data, "page": page, "limit": limit, "total": total, "has_more": page * limit < total}
    )


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
