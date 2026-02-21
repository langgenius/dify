import time
from unittest.mock import MagicMock, patch

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.mcp.session_manager import McpSessionRegistry
from core.workflow.entities.graph_init_params import GraphInitParams
from core.workflow.entities.pause_reason import SchedulingPause
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine, GraphEngineConfig
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_engine.entities.commands import AbortCommand, PauseCommand
from core.workflow.graph_events import (
    GraphRunAbortedEvent,
    GraphRunPausedEvent,
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
)
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from models.enums import UserFrom


def _build_engine_with_workflow_id(
    workflow_execution_id: str, *, cleanup_mcp_sessions: bool = True
) -> tuple[GraphEngine, InMemoryChannel]:
    variable_pool = VariablePool()
    variable_pool.system_variables.workflow_execution_id = workflow_execution_id
    runtime_state = GraphRuntimeState(
        variable_pool=variable_pool,
        start_at=time.perf_counter(),
        cleanup_mcp_sessions=cleanup_mcp_sessions,
    )

    mock_graph = MagicMock(spec=Graph)
    mock_graph.nodes = {}
    mock_graph.edges = {}
    mock_graph.root_node = MagicMock()
    mock_graph.root_node.id = "start"

    start_node = StartNode(
        id="start",
        config={"id": "start", "data": {"title": "start", "variables": []}},
        graph_init_params=GraphInitParams(
            tenant_id="test_tenant",
            app_id="test_app",
            workflow_id="test_workflow",
            graph_config={},
            user_id="test_user",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
            call_depth=0,
        ),
        graph_runtime_state=runtime_state,
    )
    mock_graph.nodes["start"] = start_node
    mock_graph.get_outgoing_edges = MagicMock(return_value=[])
    mock_graph.get_incoming_edges = MagicMock(return_value=[])

    command_channel = InMemoryChannel()

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=mock_graph,
        graph_runtime_state=runtime_state,
        command_channel=command_channel,
        config=GraphEngineConfig(),
    )

    return engine, command_channel


@patch.object(McpSessionRegistry, "cleanup")
def test_cleanup_called_on_success(mock_cleanup: MagicMock) -> None:
    engine, _ = _build_engine_with_workflow_id("wf-success")

    events = list(engine.run())

    assert any(isinstance(e, GraphRunStartedEvent) for e in events)
    assert any(isinstance(e, GraphRunSucceededEvent) for e in events)
    mock_cleanup.assert_called_once_with("wf-success")


@patch.object(McpSessionRegistry, "cleanup")
def test_cleanup_called_on_abort(mock_cleanup: MagicMock) -> None:
    engine, command_channel = _build_engine_with_workflow_id("wf-abort")
    command_channel.send_command(AbortCommand(reason="testing abort"))

    events = list(engine.run())

    assert any(isinstance(e, GraphRunAbortedEvent) for e in events)
    mock_cleanup.assert_called_once_with("wf-abort")


@patch.object(McpSessionRegistry, "cleanup")
def test_cleanup_called_on_pause(mock_cleanup: MagicMock) -> None:
    engine, command_channel = _build_engine_with_workflow_id("wf-pause")
    command_channel.send_command(PauseCommand(reason="testing pause"))

    events = list(engine.run())

    assert any(isinstance(e, GraphRunPausedEvent) for e in events)
    graph_execution = engine.graph_runtime_state.graph_execution
    assert graph_execution.pause_reasons == [SchedulingPause(message="testing pause")]
    mock_cleanup.assert_called_once_with("wf-pause")


@patch.object(McpSessionRegistry, "cleanup")
def test_cleanup_called_on_failure(mock_cleanup: MagicMock) -> None:
    engine, _ = _build_engine_with_workflow_id("wf-fail")

    engine._start_execution = MagicMock(side_effect=RuntimeError("boom"))  # type: ignore[attr-defined]

    with pytest.raises(RuntimeError):
        list(engine.run())

    mock_cleanup.assert_called_once_with("wf-fail")


@patch.object(McpSessionRegistry, "cleanup")
def test_cleanup_skipped_when_disabled(mock_cleanup: MagicMock) -> None:
    engine, _ = _build_engine_with_workflow_id("wf-skip", cleanup_mcp_sessions=False)

    events = list(engine.run())

    assert any(isinstance(e, GraphRunSucceededEvent) for e in events)
    mock_cleanup.assert_not_called()
