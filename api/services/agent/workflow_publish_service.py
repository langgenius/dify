from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from core.workflow.nodes.agent_v2.validators import WorkflowAgentNodeValidator
from models.agent import WorkflowAgentNodeBinding
from models.agent_config_entities import WorkflowNodeJobConfig
from models.workflow import Workflow


class WorkflowAgentPublishService:
    """Validate and freeze Workflow Agent v2 bindings during workflow publish."""

    @classmethod
    def validate_agent_nodes_for_publish(cls, *, session: Session, draft_workflow: Workflow) -> None:
        WorkflowAgentNodeValidator.validate_published_workflow(session=session, workflow=draft_workflow)

    @classmethod
    def validate_agent_nodes_for_draft_sync(cls, *, session: Session, draft_workflow: Workflow) -> None:
        WorkflowAgentNodeValidator.validate_draft_workflow(session=session, workflow=draft_workflow)

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

        for binding in bindings:
            copied = WorkflowAgentNodeBinding(
                tenant_id=binding.tenant_id,
                app_id=binding.app_id,
                workflow_id=published_workflow.id,
                workflow_version=published_workflow.version,
                node_id=binding.node_id,
                binding_type=binding.binding_type,
                agent_id=binding.agent_id,
                current_snapshot_id=binding.current_snapshot_id,
                node_job_config=WorkflowNodeJobConfig.model_validate(binding.node_job_config_dict),
                created_by=binding.created_by,
                updated_by=binding.updated_by,
            )
            session.add(copied)
