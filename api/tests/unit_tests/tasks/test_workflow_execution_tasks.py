import json
from uuid import uuid4

from core.workflow.entities.workflow_execution import WorkflowExecution
from core.workflow.enums import WorkflowExecutionStatus, WorkflowType
from libs.datetime_utils import naive_utc_now
from models.enums import CreatorUserRole, WorkflowRunTriggeredFrom
from tasks.workflow_execution_tasks import _create_workflow_run_from_execution, _update_workflow_run_from_execution


def _build_execution() -> WorkflowExecution:
    execution = WorkflowExecution.new(
        id_=str(uuid4()),
        workflow_id=str(uuid4()),
        workflow_type=WorkflowType.WORKFLOW,
        workflow_version="draft",
        graph={"nodes": [], "edges": []},
        inputs={"query": "hello"},
        started_at=naive_utc_now(),
    )
    execution.status = WorkflowExecutionStatus.SUCCEEDED
    execution.outputs = {"answer": "done"}
    execution.result_replay = {
        "text": "done",
        "llm_generation_items": [
            {
                "type": "tool",
                "tool_name": "bash",
                "tool_arguments": "{\"command\": \"pwd\"}",
                "tool_output": "/workspace",
            },
        ],
        "files": [],
    }
    execution.finished_at = naive_utc_now()
    return execution


def test_create_workflow_run_from_execution_persists_result_replay() -> None:
    execution = _build_execution()

    workflow_run = _create_workflow_run_from_execution(
        execution=execution,
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        creator_user_id=str(uuid4()),
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    assert json.loads(workflow_run.result_replay or "{}") == execution.result_replay
    assert workflow_run.result_replay_dict == execution.result_replay


def test_update_workflow_run_from_execution_preserves_existing_replay_until_new_value_arrives() -> None:
    execution = _build_execution()
    workflow_run = _create_workflow_run_from_execution(
        execution=execution,
        tenant_id=str(uuid4()),
        app_id=str(uuid4()),
        triggered_from=WorkflowRunTriggeredFrom.DEBUGGING,
        creator_user_id=str(uuid4()),
        creator_user_role=CreatorUserRole.ACCOUNT,
    )

    previous_result_replay = workflow_run.result_replay
    execution.result_replay = None
    _update_workflow_run_from_execution(workflow_run, execution)

    assert workflow_run.result_replay == previous_result_replay

    execution.result_replay = {
        "text": "updated",
        "llm_generation_items": [],
        "files": [],
    }
    _update_workflow_run_from_execution(workflow_run, execution)

    assert workflow_run.result_replay_dict == execution.result_replay
