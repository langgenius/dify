"""Tenant-scoped Workflow and Snippet Composer queries in the caller's transaction."""

from typing import TypedDict

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from models.agent import AgentConfigSnapshot, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.snippet import CustomizedSnippet


class WorkflowAgentReference(TypedDict):
    app_id: str
    workflow_id: str
    node_id: str


class WorkflowAgentImpact(TypedDict):
    current_snapshot_id: str | None
    workflow_node_count: int
    bindings: list[WorkflowAgentReference]


def find_composer_snippet_id(session: Session, *, tenant_id: str, snippet_id: str) -> str | None:
    """Return the snippet ID if it belongs to the tenant, with no writes."""
    return session.scalar(
        select(CustomizedSnippet.id).where(CustomizedSnippet.tenant_id == tenant_id, CustomizedSnippet.id == snippet_id)
    )


def read_workflow_agent_impact(
    session: Session, *, tenant_id: str, current_snapshot_id: str | None
) -> WorkflowAgentImpact:
    """Return detached references to the snapshot or its roster Agent in the given tenant.

    A missing snapshot selection has no impact. Use the caller's transaction so a
    Composer save can also report bindings it has flushed but has yet to commit.
    """
    if current_snapshot_id is None:
        return {"current_snapshot_id": None, "workflow_node_count": 0, "bindings": []}

    agent_id = session.scalar(
        select(AgentConfigSnapshot.agent_id)
        .where(AgentConfigSnapshot.tenant_id == tenant_id, AgentConfigSnapshot.id == current_snapshot_id)
        .limit(1)
    )
    predicates = [WorkflowAgentNodeBinding.current_snapshot_id == current_snapshot_id]
    if agent_id:
        predicates.append(
            (WorkflowAgentNodeBinding.agent_id == agent_id)
            & (WorkflowAgentNodeBinding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT)
        )
    rows = session.execute(
        select(
            WorkflowAgentNodeBinding.app_id, WorkflowAgentNodeBinding.workflow_id, WorkflowAgentNodeBinding.node_id
        ).where(WorkflowAgentNodeBinding.tenant_id == tenant_id, or_(*predicates))
    )
    bindings: list[WorkflowAgentReference] = [
        {"app_id": app_id, "workflow_id": workflow_id, "node_id": node_id} for app_id, workflow_id, node_id in rows
    ]
    return {
        "current_snapshot_id": current_snapshot_id,
        "workflow_node_count": len(bindings),
        "bindings": bindings,
    }
