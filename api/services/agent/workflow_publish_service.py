from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
from models.agent import Agent, AgentScope, AgentStatus, WorkflowAgentBindingType, WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.workflow import Workflow


class WorkflowAgentPublishService:
    """Validate and freeze Workflow Agent v2 bindings during workflow publish."""

    _DRAFT_WORKFLOW_VERSION = Workflow.VERSION_DRAFT
    _AGENT_BINDING_KEY = "agent_binding"

    @classmethod
    def validate_agent_nodes_for_publish(cls, *, session: Session, draft_workflow: Workflow) -> None:
        WorkflowAgentNodeValidator.validate_published_workflow(session=session, workflow=draft_workflow)

    @classmethod
    def validate_agent_nodes_for_draft_sync(cls, *, session: Session, draft_workflow: Workflow) -> None:
        WorkflowAgentNodeValidator.validate_draft_workflow(session=session, workflow=draft_workflow)

    @classmethod
    def sync_roster_agent_bindings_for_draft(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        account_id: str,
    ) -> None:
        agent_nodes = dict(WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict))
        existing_bindings = list(
            session.scalars(
                select(WorkflowAgentNodeBinding).where(
                    WorkflowAgentNodeBinding.tenant_id == draft_workflow.tenant_id,
                    WorkflowAgentNodeBinding.app_id == draft_workflow.app_id,
                    WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                    WorkflowAgentNodeBinding.workflow_version == cls._DRAFT_WORKFLOW_VERSION,
                )
            ).all()
        )
        existing_by_node_id = {binding.node_id: binding for binding in existing_bindings}

        for binding in existing_bindings:
            if binding.node_id not in agent_nodes:
                session.delete(binding)

        for node_id, node_data in agent_nodes.items():
            binding_payload = node_data.get(cls._AGENT_BINDING_KEY)
            if binding_payload is None:
                continue
            if not isinstance(binding_payload, Mapping):
                raise ValueError(f"Workflow Agent node {node_id} has invalid agent_binding.")
            cls._sync_roster_agent_binding_for_node(
                session=session,
                draft_workflow=draft_workflow,
                node_id=node_id,
                node_binding=binding_payload,
                existing_binding=existing_by_node_id.get(node_id),
                account_id=account_id,
            )
        session.flush()

    @classmethod
    def _sync_roster_agent_binding_for_node(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        node_id: str,
        node_binding: Mapping[str, Any],
        existing_binding: WorkflowAgentNodeBinding | None,
        account_id: str,
    ) -> None:
        binding_type = node_binding.get("binding_type")
        if binding_type != WorkflowAgentBindingType.ROSTER_AGENT.value:
            raise ValueError(f"Workflow Agent node {node_id} only supports roster_agent graph binding.")
        agent_id = node_binding.get("agent_id")
        if not isinstance(agent_id, str) or not agent_id:
            raise ValueError(f"Workflow Agent node {node_id} roster_agent binding requires agent_id.")

        agent = session.scalar(
            select(Agent)
            .where(
                Agent.tenant_id == draft_workflow.tenant_id,
                Agent.id == agent_id,
                Agent.scope == AgentScope.ROSTER,
                Agent.status == AgentStatus.ACTIVE,
            )
            .limit(1)
        )
        if agent is None:
            raise ValueError(f"Workflow Agent node {node_id} references an unavailable roster agent.")
        if not agent.active_config_snapshot_id:
            raise ValueError(f"Workflow Agent node {node_id} roster agent has no active config snapshot.")

        binding = existing_binding
        if binding is None:
            binding = WorkflowAgentNodeBinding(
                tenant_id=draft_workflow.tenant_id,
                app_id=draft_workflow.app_id,
                workflow_id=draft_workflow.id,
                workflow_version=cls._DRAFT_WORKFLOW_VERSION,
                node_id=node_id,
                node_job_config=WorkflowNodeJobConfig(),
                created_by=account_id,
            )
            session.add(binding)
        elif not binding.node_job_config:
            binding.node_job_config = WorkflowNodeJobConfig()

        binding.binding_type = WorkflowAgentBindingType.ROSTER_AGENT
        binding.agent_id = agent.id
        binding.current_snapshot_id = agent.active_config_snapshot_id
        binding.updated_by = account_id

    @classmethod
    def copy_agent_node_bindings_to_published(
        cls,
        *,
        session: Session,
        draft_workflow: Workflow,
        published_workflow: Workflow,
    ) -> None:
        node_ids = {
            node_id for node_id, _node_data in WorkflowAgentNodeValidator.iter_agent_v2_nodes(draft_workflow.graph_dict)
        }
        if not node_ids:
            return

        bindings = session.scalars(
            select(WorkflowAgentNodeBinding).where(
                WorkflowAgentNodeBinding.tenant_id == draft_workflow.tenant_id,
                WorkflowAgentNodeBinding.app_id == draft_workflow.app_id,
                WorkflowAgentNodeBinding.workflow_id == draft_workflow.id,
                WorkflowAgentNodeBinding.workflow_version == draft_workflow.version,
                WorkflowAgentNodeBinding.node_id.in_(node_ids),
            )
        ).all()
        if not bindings:
            return

        agents_by_id = {
            agent.id: agent
            for agent in session.scalars(
                select(Agent).where(
                    Agent.tenant_id == draft_workflow.tenant_id,
                    Agent.id.in_({binding.agent_id for binding in bindings if binding.agent_id}),
                )
            ).all()
        }

        for binding in bindings:
            agent = agents_by_id.get(binding.agent_id) if binding.agent_id else None
            current_snapshot_id = (
                agent.active_config_snapshot_id
                if agent is not None and binding.binding_type == WorkflowAgentBindingType.ROSTER_AGENT
                else binding.current_snapshot_id
            )
            copied = WorkflowAgentNodeBinding(
                tenant_id=binding.tenant_id,
                app_id=binding.app_id,
                workflow_id=published_workflow.id,
                workflow_version=published_workflow.version,
                node_id=binding.node_id,
                binding_type=binding.binding_type,
                agent_id=binding.agent_id,
                current_snapshot_id=current_snapshot_id,
                node_job_config=WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict),
                created_by=binding.created_by,
                updated_by=binding.updated_by,
            )
            session.add(copied)
