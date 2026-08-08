from types import SimpleNamespace

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import WorkflowAppBlockingResponse
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.runtime import GraphRuntimeState, VariablePool


def _build_converter() -> WorkflowResponseConverter:
    """Construct a minimal WorkflowResponseConverter for testing."""
    system_variables = build_system_variables(
        files=[],
        user_id="user-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_execution_id="run-1",
    )
    app_entity = SimpleNamespace(
        task_id="task-1",
        app_config=SimpleNamespace(app_id="app-1", tenant_id="tenant-1"),
        invoke_from=InvokeFrom.EXPLORE,
        files=[],
        inputs={},
        workflow_execution_id="run-1",
        call_depth=0,
    )
    account = SimpleNamespace(id="acc-1", name="tester", email="tester@example.com")
    return WorkflowResponseConverter(
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
    )


def test_workflow_finish_response_exposes_prompt_and_completion_tokens():
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(),
        start_at=0.0,
        total_tokens=12,
        llm_usage=LLMUsage.from_metadata(
            {"prompt_tokens": 7, "completion_tokens": 5, "total_tokens": 12},
        ),
    )

    resp = converter.workflow_finish_to_stream_response(
        task_id="task-1",
        workflow_id="wf-1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        graph_runtime_state=runtime_state,
    )

    assert resp.data.total_tokens == 12
    assert resp.data.prompt_tokens == 7
    assert resp.data.completion_tokens == 5


def test_workflow_finish_response_defaults_tokens_to_zero_without_llm_usage():
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )

    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)

    resp = converter.workflow_finish_to_stream_response(
        task_id="task-1",
        workflow_id="wf-1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        graph_runtime_state=runtime_state,
    )

    assert resp.data.total_tokens == 0
    assert resp.data.prompt_tokens == 0
    assert resp.data.completion_tokens == 0


def test_blocking_workflow_response_serializes_prompt_and_completion_tokens():
    blocking = WorkflowAppBlockingResponse(
        task_id="task-1",
        workflow_run_id="run-1",
        data=WorkflowAppBlockingResponse.Data(
            id="run-1",
            workflow_id="wf-1",
            status=WorkflowExecutionStatus.SUCCEEDED,
            outputs={},
            error=None,
            elapsed_time=1.0,
            total_tokens=12,
            prompt_tokens=7,
            completion_tokens=5,
            total_steps=1,
            created_at=1,
            finished_at=2,
        ),
    )

    dumped = WorkflowAppGenerateResponseConverter.convert_blocking_full_response(blocking)

    assert dumped["data"]["total_tokens"] == 12
    assert dumped["data"]["prompt_tokens"] == 7
    assert dumped["data"]["completion_tokens"] == 5
