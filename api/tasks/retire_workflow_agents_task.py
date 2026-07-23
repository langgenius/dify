"""Retire Workflow-owned Agents and Workspaces outside request execution."""

from __future__ import annotations

from celery import shared_task
from sqlalchemy import select

from core.db.session_factory import session_factory
from core.workflow.nodes.agent_v2.session_store import WorkflowAgentWorkspaceStore
from models.agent import AgentWorkingResourceStatus, AgentWorkspaceBinding
from services.agent.home_snapshot_service import AgentHomeSnapshotService
from services.agent.retirement_service import WorkflowAgentRetirementService
from services.agent.workspace_service import AgentWorkspaceService


@shared_task(queue="workflow_storage")
def retire_workflow_agent_workspaces(*, tenant_id: str, app_id: str, workflow_run_id: str) -> None:
    """Retire and collect one Workflow Run's Workspaces using a fresh database session."""

    WorkflowAgentWorkspaceStore().retire_workflow_run(
        tenant_id=tenant_id,
        app_id=app_id,
        workflow_run_id=workflow_run_id,
    )


@shared_task(queue="workflow_storage")
def retire_workflow_agents_if_unowned(
    *,
    tenant_id: str,
    agent_ids: list[str],
    account_id: str | None,
) -> None:
    retired_bindings: list[str] = []
    retired_snapshots: list[str] = []
    with session_factory.create_session() as session:
        retired_agent_ids = WorkflowAgentRetirementService.archive_unowned(
            session=session,
            tenant_id=tenant_id,
            agent_ids=agent_ids,
            account_id=account_id,
        )
        for agent_id in retired_agent_ids:
            bindings = session.scalars(
                select(AgentWorkspaceBinding).where(
                    AgentWorkspaceBinding.tenant_id == tenant_id,
                    AgentWorkspaceBinding.agent_id == agent_id,
                    AgentWorkspaceBinding.status == AgentWorkingResourceStatus.ACTIVE,
                )
            ).all()
            for binding in bindings:
                binding_id = AgentWorkspaceService.retire_binding(
                    session=session,
                    tenant_id=tenant_id,
                    binding_id=binding.id,
                )
                if binding_id is not None:
                    retired_bindings.append(binding_id)
            retired_snapshots.extend(
                AgentHomeSnapshotService.retire_all_for_agent(
                    session=session,
                    tenant_id=tenant_id,
                    agent_id=agent_id,
                )
            )
        session.commit()
    for binding_id in retired_bindings:
        AgentWorkspaceService.collect_retired_binding(tenant_id=tenant_id, binding_id=binding_id)
    for home_snapshot_id in retired_snapshots:
        AgentHomeSnapshotService.collect_retired_home_snapshot(
            tenant_id=tenant_id,
            home_snapshot_id=home_snapshot_id,
        )
