from types import SimpleNamespace

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.system_variables import build_system_variables
from graphon.entities import WorkflowStartReason
from graphon.runtime import GraphRuntimeState, VariablePool
from models.account import Account
from services.workflow.execution.adapters.response_converter import WorkflowResponseConverter


def _build_converter(*, workflow_contexts, tool_providers) -> WorkflowResponseConverter:
    """Construct a minimal WorkflowResponseConverter for testing."""
    system_variables = build_system_variables(
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
    account = Account(name="tester", email="tester@example.com")
    account.id = "acc-1"
    return WorkflowResponseConverter(
        contexts=workflow_contexts,
        application_generate_entity=app_entity,
        user=account,
        system_variables=system_variables,
        tool_providers=tool_providers,
    )


def test_workflow_start_stream_response_carries_resumption_reason(*, workflow_contexts, tool_providers):
    converter = _build_converter(workflow_contexts=workflow_contexts, tool_providers=tool_providers)
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.RESUMPTION,
    )
    assert resp.data.reason is WorkflowStartReason.RESUMPTION


def test_workflow_start_stream_response_carries_initial_reason(*, workflow_contexts, tool_providers):
    converter = _build_converter(workflow_contexts=workflow_contexts, tool_providers=tool_providers)
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.INITIAL,
    )
    assert resp.data.reason is WorkflowStartReason.INITIAL
