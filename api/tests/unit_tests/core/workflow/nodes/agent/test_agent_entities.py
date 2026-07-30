from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom, build_dify_run_context
from core.workflow.node_factory import DifyNodeFactory
from core.workflow.nodes.agent.entities import AgentNodeData
from graphon.entities import GraphInitParams
from graphon.graph import Graph
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import GraphNodeEventBase, GraphRunSucceededEvent
from graphon.runtime import GraphRuntimeState, VariablePool


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
    graph_runtime_state = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    graph_init_params = GraphInitParams(
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
    engine = GraphEngine(
        workflow_id="workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(min_workers=1, max_workers=1),
    )

    events = list(engine.run())

    assert isinstance(events[-1], GraphRunSucceededEvent)
    assert not any(isinstance(event, GraphNodeEventBase) and event.node_id == "agent" for event in events)
