import time

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams, GraphRuntimeState, VariablePool
from core.workflow.graph import Graph
from core.workflow.graph_engine import GraphEngine
from core.workflow.graph_engine.command_channels import InMemoryChannel
from core.workflow.graph_events import (
    GraphRunSucceededEvent,
    NodeRunStreamChunkEvent,
)
from core.workflow.nodes.node_factory import DifyNodeFactory
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom

from .test_graph_engine import TableTestRunner


def create_test_graph_engine(graph_config: dict, system_query: str):
    """Helper method to create a graph engine instance for testing"""
    # Create graph initialization parameters
    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="test_user",
            files=[],
            query=system_query,
        ),
    )

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())
    node_factory = DifyNodeFactory(init_params, graph_runtime_state)
    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    return GraphEngine(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
        graph=graph,
        graph_config=graph_config,
        graph_runtime_state=graph_runtime_state,
        max_execution_steps=500,
        max_execution_time=30,
        command_channel=InMemoryChannel(),
    )


def test_tool_in_chatflow():
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("test_tool_in_chatflow")
    graph_config = fixture_data.get("workflow", {}).get("graph", {})
    engine = create_test_graph_engine(graph_config, "1")

    events = list(engine.run())

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    # Check for streaming events
    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    stream_chunk_count = len(stream_chunk_events)

    assert stream_chunk_count == 1, f"Expected 1 streaming events, but got {stream_chunk_count}"
    assert stream_chunk_events[0].chunk == "hello, dify!", (
        f"Expected chunk to be 'hello, dify!', but got {stream_chunk_events[0].chunk}"
    )
