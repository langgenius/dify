from datetime import datetime
from types import SimpleNamespace

import pytest

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
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


def test_resumed_finish_reports_logical_wall_clock_and_handoff_duration(
    monkeypatch: pytest.MonkeyPatch,
):
    converter = _build_converter()
    logical_started_at = datetime(2026, 7, 28, 12, 0, 0)
    finished_at = datetime(2026, 7, 28, 12, 10, 0)
    runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(),
        start_at=73.0,
        llm_usage=LLMUsage.empty_usage().model_copy(update={"total_tokens": 12}),
        node_run_steps=3,
    )

    monkeypatch.setattr(
        "core.app.apps.common.workflow_response_converter.naive_utc_now",
        lambda: finished_at,
    )
    start = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        reason=WorkflowStartReason.RESUMPTION,
        logical_started_at=logical_started_at,
        handoff_duration=125.5,
    )
    finish = converter.workflow_finish_to_stream_response(
        task_id="task-1",
        workflow_id="wf-1",
        status=WorkflowExecutionStatus.SUCCEEDED,
        graph_runtime_state=runtime_state,
    )

    assert start.data.created_at == int(logical_started_at.timestamp())
    assert finish.data.created_at == int(logical_started_at.timestamp())
    assert finish.data.elapsed_time == 600.0
    assert finish.data.handoff_duration == 125.5
    assert finish.data.total_tokens == 12
    # Public timing must not rewrite Graphon's execution clock, which owns
    # timeout and execution-only accounting.
    assert runtime_state.start_at == 73.0
