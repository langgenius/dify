from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.agent.entities import AgentNodeData
from graphon.engine import Engine
from graphon.engine.command import InMemoryChannel
from graphon.engine_events import GraphRunSucceededEvent, NodeEvent
from graphon.entities import InitParams
from graphon.graph import Graph
from graphon.runtime import RuntimeState, VariablePool


def test_agent_node_data_unconfigured_defaults() -> None:
    data = AgentNodeData.model_validate({"title": "Agent"})

    assert data.agent_strategy_provider_name == ""
    assert data.agent_strategy_name == ""
    assert data.agent_strategy_label == ""
    assert not data.agent_parameters


def test_unconfigured_disconnected_agent_does_not_block_workflow() -> None:
    graph_config: dict[str, object] = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start", "variables": []}},
            {"id": "agent", "data": {"type": "agent", "title": "Agent", "tool_node_version": "2"}},
        ],
        "edges": [],
    }
    graph_runtime_state = RuntimeState(workflow_id="test-workflow", variable_pool=VariablePool(), start_at=0)
    graph_init_params = InitParams(
        workflow_id="workflow",
        graph_config=graph_config,
        run_context=build_dify_run_context(
            tenant_id="tenant",
            app_id="app",
            user_id="user",
            user_from=UserFrom.ACCOUNT,
            invoke_from=InvokeFrom.DEBUGGER,
        ),
        call_depth=0,
    )
    graph = Graph.init(
        graph_config=graph_config,
        node_factory=DifyNodeFactory(graph_init_params, graph_runtime_state),
        root_node_id="start",
    )
    engine = Engine(
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        workers=1,
    )

    events = list(engine.run())

    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert not any(isinstance(event, NodeEvent) and event.node_id == "agent" for event in events)
