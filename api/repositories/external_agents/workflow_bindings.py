"""Short, scoped External workflow binding transactions and legacy DSL bridges."""

import copy
import json
from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from libs.datetime_utils import naive_utc_now
from libs.uuid_utils import uuidv7
from machinery.context import RequestContext
from models.account import TenantAccountJoin
from models.agent import Agent, AgentKind, AgentScope, AgentStatus, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.external_agent import ExternalAgentHead
from models.model import App
from models.workflow import Workflow
from services.external_agents.contracts import (
    ExternalAgentConflictError,
    ExternalAgentForbiddenError,
    ExternalAgentNotFoundError,
)
from services.external_agents.workflow_binding_service import RebindResult
from services.external_agents.workflow_portability import (
    ExternalReference,
    iter_external_nodes,
    portable_node,
    rebind_graph,
    reference_value,
)
from services.external_agents.workflow_runtime import ExternalNodeJob


def _target(session: Session, tenant_id: str, agent_id: str) -> Agent | None:
    """Disabled remains a valid reference; archived/deleted/non-External never resolves."""
    return session.scalar(
        select(Agent)
        .join(ExternalAgentHead, ExternalAgentHead.agent_id == Agent.id)
        .where(
            Agent.tenant_id == tenant_id,
            Agent.id == agent_id,
            Agent.agent_kind == AgentKind.EXTERNAL_A2A,
            Agent.scope == AgentScope.ROSTER,
            Agent.status == AgentStatus.ACTIVE,
            ExternalAgentHead.tenant_id == tenant_id,
            ExternalAgentHead.deleted_at.is_(None),
            ExternalAgentHead.active_connection_revision_id.is_not(None),
        )
    )


def sync_external_bindings(
    *, session: Session, workflow: Workflow, account_id: str, node_ids: frozenset[str] | None = None
) -> None:
    """Synchronize External rows without consulting or creating a Native snapshot.

    Called by the already admitted draft owner within its transaction. Epochs
    come from persisted identity transitions, not caller-provided graph tokens.
    No-op edits/publish preserve the epoch; A→B→A creates two new generations.
    """
    nodes = {
        identifier: data
        for identifier, data in iter_external_nodes(workflow.graph_dict)
        if node_ids is None or identifier in node_ids
    }
    if not nodes:
        return
    existing = {
        row.node_id: row
        for row in session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == workflow.tenant_id,
                WorkflowAgentNodeBinding.app_id == workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == workflow.id,
                WorkflowAgentNodeBinding.workflow_version == workflow.version,
                WorkflowAgentNodeBinding.node_id.in_(list(nodes)),
            )
        )
    }
    prepared = []
    for node_id, data in nodes.items():
        payload = data.get("agent_binding") or {}
        if not isinstance(payload, dict):
            raise ValueError("External workflow binding must be an object.")
        identifier = payload.get("agent_id")
        if identifier is not None and (not isinstance(identifier, str) or not identifier):
            raise ValueError("External workflow asset identity is invalid.")
        agent = _target(session, workflow.tenant_id, identifier) if identifier else None
        previous = existing.get(node_id)
        if agent is None and previous is not None and previous.original_reference:
            payload = {**payload, "original_reference": previous.original_reference}
        reference = (
            reference_value(workspace_id=workflow.tenant_id, agent_id=agent.id, name=agent.name)
            if agent
            else ExternalReference.model_validate(payload["original_reference"]).model_dump(mode="json")
            if payload.get("original_reference")
            else None
        )
        job = {"schema_version": 1, **ExternalNodeJob.parse_graph(data).model_dump(mode="json", exclude_unset=True)}
        prepared.append((node_id, agent, reference, job))
    for node_id, agent, reference, job in prepared:
        binding = existing.get(node_id)
        if binding is None:
            binding = WorkflowAgentNodeBinding(
                tenant_id=workflow.tenant_id,
                app_id=workflow.app_id,
                workflow_id=workflow.id,
                workflow_version=workflow.version,
                node_id=node_id,
                binding_type=WorkflowAgentBindingType.ROSTER_AGENT,
                node_job_config=WorkflowNodeJobConfig(),
                created_by=account_id,
            )
            session.add(binding)
        identifier = agent.id if agent else None
        if identifier is None:
            binding.binding_epoch = None
        elif binding.agent_id != identifier or not binding.binding_epoch:
            binding.binding_epoch = str(uuidv7())
        binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
        binding.agent_id = identifier
        binding.current_snapshot_id = None
        binding.external_job_config = job
        binding.original_reference = reference
        binding.updated_by = account_id
    session.flush()


def project_external_bindings(
    *,
    session: Session,
    workflow: Workflow,
    graph: Mapping[str, Any],
    binding_version: str | None = None,
    portable: bool = False,
) -> dict[str, Any]:
    result = copy.deepcopy(dict(graph))
    nodes = dict(iter_external_nodes(result))
    if not nodes:
        return result
    rows = session.scalars(
        select(WorkflowAgentNodeBinding).where(
            WorkflowAgentNodeBinding.tenant_id == workflow.tenant_id,
            WorkflowAgentNodeBinding.app_id == workflow.app_id,
            WorkflowAgentNodeBinding.workflow_id == workflow.id,
            WorkflowAgentNodeBinding.workflow_version == (binding_version or workflow.version),
            WorkflowAgentNodeBinding.node_id.in_(list(nodes)),
        )
    )
    for row in rows:
        data = nodes[row.node_id]
        job = ExternalNodeJob.model_validate(row.external_job_config or {}).model_dump(mode="json", exclude_unset=True)
        job.pop("schema_version", None)
        data.update(job)
        data["agent_binding"] = {
            "binding_type": "roster_agent",
            "agent_id": row.agent_id,
            "binding_epoch": row.binding_epoch,
            "original_reference": row.original_reference,
        }
    if portable:
        for _identifier, data in iter_external_nodes(result):
            payload = data.get("agent_binding") or {}
            reference = payload.get("original_reference")
            safe = portable_node(data, reference=reference)
            data.clear()
            data.update(safe)
    return result


class ExternalWorkflowBindingRepository:
    def __init__(self, *, sessions: sessionmaker[Session]) -> None:
        self._sessions = sessions

    def rebind(
        self,
        *,
        context: RequestContext,
        app_id: str,
        node_id: str,
        target_agent_id: str,
        expected_hash: str,
        include_matching: bool,
        visible_ids: frozenset[str] | None,
    ) -> RebindResult:
        """Lock/preflight one draft and commit the complete selected binding set atomically."""
        with self._sessions.begin() as session:
            role = session.scalar(
                select(TenantAccountJoin.role)
                .where(
                    TenantAccountJoin.tenant_id == context.active_workspace_id,
                    TenantAccountJoin.account_id == context.account_id,
                )
                .with_for_update()
            )
            if role not in {"owner", "admin", "editor"}:
                raise ExternalAgentForbiddenError("Current workspace editor access is required.")
            app = session.scalar(select(App).where(App.id == app_id, App.tenant_id == context.active_workspace_id))
            if app is None:
                raise ExternalAgentNotFoundError("Workflow application not found.")
            workflow = session.scalar(
                select(Workflow)
                .where(
                    Workflow.tenant_id == context.active_workspace_id,
                    Workflow.app_id == app_id,
                    Workflow.version == Workflow.VERSION_DRAFT,
                )
                .with_for_update()
            )
            if workflow is None:
                raise ExternalAgentNotFoundError("Workflow draft not found.")
            if workflow.unique_hash != expected_hash:
                raise ExternalAgentConflictError("The workflow draft has changed.")
            if visible_ids is not None and target_agent_id not in visible_ids:
                raise ExternalAgentForbiddenError("The target External Agent is not accessible.")
            target = _target(session, context.active_workspace_id, target_agent_id)
            if target is None:
                raise ExternalAgentNotFoundError("The target External Agent is unavailable.")
            projected = project_external_bindings(session=session, workflow=workflow, graph=workflow.graph_dict)
            graph, selected = rebind_graph(
                projected,
                node_id=node_id,
                target=ExternalReference(
                    workspace_id=context.active_workspace_id, agent_id=target.id, display_name=target.name
                ),
                include_matching=include_matching,
                new_epoch=lambda: str(uuidv7()),
            )
            workflow.graph = json.dumps(graph)
            sync_external_bindings(
                session=session, workflow=workflow, account_id=context.account_id, node_ids=frozenset(selected)
            )
            # The DB identity transition, not an untrusted graph epoch, wins.
            workflow.graph = json.dumps(project_external_bindings(session=session, workflow=workflow, graph=graph))
            workflow.updated_by = context.account_id
            workflow.updated_at = naive_utc_now()
            epochs = {
                identifier: data["agent_binding"]["binding_epoch"]
                for identifier, data in iter_external_nodes(workflow.graph_dict)
                if identifier in selected
            }
            return RebindResult(workflow.id, workflow.unique_hash, selected, epochs)
