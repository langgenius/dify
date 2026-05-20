from datetime import UTC, datetime

from graphon.entities.workflow_node_execution import WorkflowNodeExecution
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionMetadataKey, WorkflowNodeExecutionStatus
from models.enums import CreatorUserRole
from models.workflow import WorkflowNodeExecutionModel, WorkflowNodeExecutionTriggeredFrom
from tasks.workflow_node_execution_tasks import (
    _create_node_execution_from_domain,
    _update_node_execution_metadata,
)


def _execution() -> WorkflowNodeExecution:
    return WorkflowNodeExecution(
        id="exec-id",
        node_execution_id="node-exec-id",
        workflow_id="workflow-id",
        workflow_execution_id="run-id",
        index=1,
        node_id="node-id",
        node_type=BuiltinNodeTypes.LLM,
        title="LLM",
        inputs={"input": "value"},
        process_data={"process": "value"},
        outputs={"output": "value"},
        status=WorkflowNodeExecutionStatus.SUCCEEDED,
        metadata={WorkflowNodeExecutionMetadataKey.TOTAL_TOKENS: 10},
        created_at=datetime.now(UTC).replace(tzinfo=None),
        finished_at=datetime.now(UTC).replace(tzinfo=None),
    )


def test_create_node_execution_persists_metadata_without_data_payloads() -> None:
    db_model = _create_node_execution_from_domain(
        execution=_execution(),
        tenant_id="tenant-id",
        app_id="app-id",
        triggered_from=WorkflowNodeExecutionTriggeredFrom.WORKFLOW_RUN,
        creator_user_id="user-id",
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert db_model.inputs == "{}"
    assert db_model.process_data == "{}"
    assert db_model.outputs == "{}"
    assert db_model.execution_metadata == '{"total_tokens": 10}'


def test_update_node_execution_metadata_preserves_data_payloads() -> None:
    db_model = WorkflowNodeExecutionModel()
    db_model.inputs = '{"old_input": true}'
    db_model.process_data = '{"old_process": true}'
    db_model.outputs = '{"old_output": true}'

    _update_node_execution_metadata(db_model, _execution())

    assert db_model.inputs == '{"old_input": true}'
    assert db_model.process_data == '{"old_process": true}'
    assert db_model.outputs == '{"old_output": true}'
    assert db_model.status == WorkflowNodeExecutionStatus.SUCCEEDED
