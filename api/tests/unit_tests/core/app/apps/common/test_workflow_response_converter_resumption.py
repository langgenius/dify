from types import SimpleNamespace

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities.workflow_start_reason import WorkflowStartReason
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable


def _build_converter() -> WorkflowResponseConverter:
    """Construct a minimal WorkflowResponseConverter for testing."""
    system_variables = SystemVariable(
        files=[],
        user_id="user-1",
        app_id="app-1",
        workflow_id="wf-1",
        workflow_execution_id="run-1",
    )
    runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0.0)
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


def test_workflow_start_stream_response_carries_resumption_reason():
    converter = _build_converter()
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.RESUMPTION,
    )
    assert resp.data.reason is WorkflowStartReason.RESUMPTION


def test_workflow_start_stream_response_carries_initial_reason():
    converter = _build_converter()
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )
    assert resp.data.reason is WorkflowStartReason.INITIAL
