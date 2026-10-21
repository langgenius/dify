"""Translate between queued workflow data and the legacy execution model."""

from models.workflow import Workflow, WorkflowType, resolve_workflow_kind
from services.rag_pipeline.entities import RagPipelineWorkflowSnapshot


def capture_workflow(workflow: Workflow) -> RagPipelineWorkflowSnapshot:
    workflow_type = workflow.type.value if isinstance(workflow.type, WorkflowType) else workflow.type
    workflow_kind = workflow.kind.value if hasattr(workflow.kind, "value") else workflow.kind
    return RagPipelineWorkflowSnapshot(
        id=workflow.id,
        tenant_id=workflow.tenant_id,
        app_id=workflow.app_id,
        type=workflow_type,
        kind=workflow_kind,
        version=workflow.version,
        version_number=workflow.version_number,
        marked_name=workflow.marked_name,
        marked_comment=workflow.marked_comment,
        graph=workflow.graph,
        features=workflow._features,
        created_by=workflow.created_by,
        created_at=workflow.created_at,
        updated_by=workflow.updated_by,
        updated_at=workflow.updated_at,
        environment_variables=workflow._environment_variables,
        conversation_variables=workflow._conversation_variables,
        rag_pipeline_variables=workflow._rag_pipeline_variables,
    )


def restore_workflow(snapshot: RagPipelineWorkflowSnapshot) -> Workflow:
    """Restore a detached ORM value object for the existing execution engine."""
    workflow = Workflow()
    workflow.id = snapshot.id
    workflow.tenant_id = snapshot.tenant_id
    workflow.app_id = snapshot.app_id
    workflow.type = WorkflowType(snapshot.type)
    workflow.kind = resolve_workflow_kind(snapshot.kind)
    workflow.version = snapshot.version
    workflow.version_number = snapshot.version_number
    workflow.marked_name = snapshot.marked_name
    workflow.marked_comment = snapshot.marked_comment
    workflow.graph = snapshot.graph
    workflow._features = snapshot.features
    workflow.created_by = snapshot.created_by
    workflow.created_at = snapshot.created_at
    workflow.updated_by = snapshot.updated_by
    workflow.updated_at = snapshot.updated_at
    workflow._environment_variables = snapshot.environment_variables
    workflow._conversation_variables = snapshot.conversation_variables
    workflow._rag_pipeline_variables = snapshot.rag_pipeline_variables
    return workflow
