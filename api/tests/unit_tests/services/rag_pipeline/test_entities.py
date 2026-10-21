from datetime import datetime

from models.workflow import Workflow, WorkflowKind, WorkflowType
from services.rag_pipeline.entities import RagPipelineInvokeBatch, RagPipelineInvokeEntity
from services.rag_pipeline.workflow_snapshot import capture_workflow, restore_workflow


def _workflow() -> Workflow:
    now = datetime(2026, 1, 2, 3, 4, 5)
    workflow = Workflow()
    workflow.id = "workflow-1"
    workflow.tenant_id = "tenant-1"
    workflow.app_id = "pipeline-1"
    workflow.type = WorkflowType.RAG_PIPELINE
    workflow.kind = WorkflowKind.STANDARD
    workflow.version = "published"
    workflow.version_number = 7
    workflow.marked_name = "Version seven"
    workflow.marked_comment = "Stable"
    workflow.graph = '{"nodes": [], "edges": []}'
    workflow._features = "{}"
    workflow.created_by = "user-1"
    workflow.created_at = now
    workflow.updated_by = "user-2"
    workflow.updated_at = now
    workflow._environment_variables = "[]"
    workflow._conversation_variables = "[]"
    workflow._rag_pipeline_variables = "[]"
    return workflow


def test_invoke_entity_defaults_and_snapshot_round_trip() -> None:
    snapshot = capture_workflow(_workflow())
    entity = RagPipelineInvokeEntity(
        pipeline_id="pipeline-1",
        application_generate_entity={"foo": "bar"},
        user_id="user-1",
        tenant_id="tenant-1",
        workflow_id="workflow-1",
        workflow_snapshot=snapshot,
        streaming=True,
    )

    restored = RagPipelineInvokeEntity.model_validate_json(entity.model_dump_json())
    workflow = restore_workflow(restored.workflow_snapshot) if restored.workflow_snapshot else None

    assert restored.workflow_execution_id is None
    assert restored.workflow_thread_pool_id is None
    assert restored.streaming is True
    assert workflow is not None
    assert workflow.id == "workflow-1"
    assert workflow.version_number == 7
    assert workflow.graph_dict == {"nodes": [], "edges": []}


def test_batch_snapshot_round_trip_when_nullable_workflow_fields_are_absent() -> None:
    snapshot = capture_workflow(_workflow()).model_copy(
        update={"kind": None, "version_number": None, "updated_by": None}
    )
    batch = RagPipelineInvokeBatch(
        workflow_snapshot=snapshot,
        invoke_entities=[
            RagPipelineInvokeEntity(
                pipeline_id="pipeline-1",
                application_generate_entity={"foo": "bar"},
                user_id="user-1",
                tenant_id="tenant-1",
                workflow_id="workflow-1",
                streaming=False,
            )
        ],
    )

    restored = RagPipelineInvokeBatch.model_validate_json(batch.model_dump_json(exclude_none=True))

    assert restored.workflow_snapshot.kind is None
    assert restored.workflow_snapshot.version_number is None
    assert restored.workflow_snapshot.updated_by is None
