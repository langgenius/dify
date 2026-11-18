"""Shared roster queries that run within the caller's session."""

from dataclasses import dataclass

from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from libs.helper import escape_like_pattern, to_timestamp
from models.agent import Agent, AgentScope, AgentStatus, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.enums import AppStatus
from models.model import App
from models.workflow import Workflow


@dataclass(frozen=True)
class PublishedWorkflowReference:
    """A current published workflow and its referencing nodes for one roster Agent."""

    app: App
    workflow_id: str
    workflow_version: str
    node_ids: tuple[str, ...]


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


def load_published_workflows_by_agent_id(
    session: Session, *, tenant_id: str, agent_ids: list[str]
) -> dict[str, tuple[PublishedWorkflowReference, ...]]:
    """Group current published workflow references within a tenant and the caller's session.

    The caller projects the loaded Apps before closing its session. Each workflow
    appears once per Agent, with unique, sorted node IDs.
    """
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

    grouped: dict[str, dict[tuple[str, str], tuple[App, str, list[str]]]] = {}
    for binding in bindings:
        app = apps.get(binding.app_id)
        if binding.agent_id and app is not None and app.workflow_id == binding.workflow_id:
            by_workflow = grouped.setdefault(binding.agent_id, {})
            key = (binding.app_id, binding.workflow_id)
            _, _, node_ids = by_workflow.setdefault(key, (app, binding.workflow_version, []))
            node_ids.append(binding.node_id)

    result: dict[str, tuple[PublishedWorkflowReference, ...]] = {}
    for agent_id, by_workflow in grouped.items():
        references = [
            PublishedWorkflowReference(
                app=app,
                workflow_id=workflow_id,
                workflow_version=workflow_version,
                node_ids=tuple(sorted(set(node_ids))),
            )
            for (_, workflow_id), (app, workflow_version, node_ids) in by_workflow.items()
        ]
        references.sort(key=lambda item: (-(to_timestamp(item.app.updated_at) or 0), item.app.name.lower()))
        result[agent_id] = tuple(references)
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
