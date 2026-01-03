from types import SimpleNamespace

from core.app.apps.common.workflow_response_converter import WorkflowResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.queue_entities import QueueNodeStartedEvent
from core.app.entities.task_entities import NodeStartStreamResponse
from core.workflow.entities import AgentNodeStrategyInit
from core.workflow.enums import NodeType
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


def test_node_start_stream_response_carries_resumption_flag():
    converter = _build_converter()
    # Seed workflow run id for converter
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        is_resumption=False,
    )

    queue_event = QueueNodeStartedEvent(
        node_execution_id="exec-1",
        node_id="node-1",
        node_title="Title",
        node_type=NodeType.CODE,
        start_at=converter._workflow_started_at,  # type: ignore[attr-defined]
        agent_strategy=AgentNodeStrategyInit(name="test"),
        provider_type="",
        provider_id="",
        is_resumption=True,
    )

    resp = converter.workflow_node_start_to_stream_response(event=queue_event, task_id="task-1")
    assert isinstance(resp, NodeStartStreamResponse)
    assert resp.data.is_resumption is True


def test_node_start_stream_response_defaults_to_false():
    converter = _build_converter()
    converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        is_resumption=False,
    )

    queue_event = QueueNodeStartedEvent(
        node_execution_id="exec-2",
        node_id="node-2",
        node_title="Title",
        node_type=NodeType.CODE,
        start_at=converter._workflow_started_at,  # type: ignore[attr-defined]
        agent_strategy=None,
        provider_type="",
        provider_id="",
    )

    resp = converter.workflow_node_start_to_stream_response(event=queue_event, task_id="task-1")
    assert isinstance(resp, NodeStartStreamResponse)
    assert resp.data.is_resumption is False


def test_workflow_start_stream_response_carries_resumption_flag():
    converter = _build_converter()
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        is_resumption=True,
    )
    assert resp.data.is_resumption is True


def test_workflow_start_stream_response_defaults_to_false():
    converter = _build_converter()
    resp = converter.workflow_start_to_stream_response(
        task_id="task-1",
        workflow_run_id="run-1",
        workflow_id="wf-1",
        is_resumption=False,
    )
    assert resp.data.is_resumption is False
