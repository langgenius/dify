from datetime import UTC, datetime

from graphon.entities import WorkflowNodeExecution
from models.workflow import WorkflowNodeExecutionModel
from tasks.workflow_node_execution_tasks import _update_node_execution_from_domain


def test_celery_update_preserves_workflow_agent_binding_identity() -> None:
    stored = WorkflowNodeExecutionModel(
        process_data='{"workflow_agent_binding_id": "workflow-binding-1"}',
    )
    incoming = WorkflowNodeExecution(
        id="execution-1",
        workflow_id="workflow-1",
        node_id="node-1",
        node_type="agent",
        title="Agent",
        index=1,
        created_at=datetime.now(UTC),
        process_data={"retry": True},
    )

    _update_node_execution_from_domain(stored, incoming)

    assert stored.process_data_dict == {
        "retry": True,
        "workflow_agent_binding_id": "workflow-binding-1",
    }
