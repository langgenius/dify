import time
from collections.abc import Mapping

from core.model_runtime.entities.llm_entities import LLMMode
from core.model_runtime.entities.message_entities import PromptMessageRole
from core.workflow.entities import GraphInitParams
from core.workflow.enums import NodeState
from core.workflow.graph import Graph
from core.workflow.graph_engine.graph_state_manager import GraphStateManager
from core.workflow.graph_engine.ready_queue import InMemoryReadyQueue
from core.workflow.nodes.end.end_node import EndNode
from core.workflow.nodes.end.entities import EndNodeData
from core.workflow.nodes.llm.entities import (
    ContextConfig,
    LLMNodeChatModelMessage,
    LLMNodeData,
    ModelConfig,
    VisionConfig,
)
from core.workflow.nodes.start.entities import StartNodeData
from core.workflow.nodes.start.start_node import StartNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable

from .test_mock_config import MockConfig
from .test_mock_nodes import MockLLMNode


def _build_runtime_state() -> GraphRuntimeState:
    variable_pool = VariablePool(
        system_variables=SystemVariable(
            user_id="user",
            app_id="app",
            workflow_id="workflow",
            workflow_execution_id="exec-1",
        ),
        user_inputs={},
        conversation_variables=[],
    )
    return GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())


def _build_llm_node(
    *,
    node_id: str,
    runtime_state: GraphRuntimeState,
    graph_init_params: GraphInitParams,
    mock_config: MockConfig,
) -> MockLLMNode:
    llm_data = LLMNodeData(
        title=f"LLM {node_id}",
        model=ModelConfig(provider="openai", name="gpt-3.5-turbo", mode=LLMMode.CHAT, completion_params={}),
        prompt_template=[
            LLMNodeChatModelMessage(
                text=f"Prompt {node_id}",
                role=PromptMessageRole.USER,
                edition_type="basic",
            )
        ],
        context=ContextConfig(enabled=False, variable_selector=None),
        vision=VisionConfig(enabled=False),
        reasoning_format="tagged",
    )
    llm_config = {"id": node_id, "data": llm_data.model_dump()}
    return MockLLMNode(
        id=llm_config["id"],
        config=llm_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
        mock_config=mock_config,
    )


def _build_graph(runtime_state: GraphRuntimeState) -> Graph:
    graph_config: dict[str, object] = {"nodes": [], "edges": []}
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from="account",
        invoke_from="debugger",
        call_depth=0,
    )

    start_config = {"id": "start", "data": StartNodeData(title="Start", variables=[]).model_dump()}
    start_node = StartNode(
        id=start_config["id"],
        config=start_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    mock_config = MockConfig()
    llm_a = _build_llm_node(
        node_id="llm_a",
        runtime_state=runtime_state,
        graph_init_params=graph_init_params,
        mock_config=mock_config,
    )
    llm_b = _build_llm_node(
        node_id="llm_b",
        runtime_state=runtime_state,
        graph_init_params=graph_init_params,
        mock_config=mock_config,
    )

    end_data = EndNodeData(title="End", outputs=[], desc=None)
    end_config = {"id": "end", "data": end_data.model_dump()}
    end_node = EndNode(
        id=end_config["id"],
        config=end_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=runtime_state,
    )

    builder = (
        Graph.new()
        .add_root(start_node)
        .add_node(llm_a, from_node_id="start")
        .add_node(llm_b, from_node_id="start")
        .add_node(end_node, from_node_id="llm_a")
    )
    return builder.connect(tail="llm_b", head="end").build()


def _edge_state_map(graph: Graph) -> Mapping[tuple[str, str, str], NodeState]:
    return {(edge.tail, edge.head, edge.source_handle): edge.state for edge in graph.edges.values()}


def test_runtime_state_snapshot_restores_graph_states() -> None:
    runtime_state = _build_runtime_state()
    graph = _build_graph(runtime_state)
    runtime_state.attach_graph(graph)

    graph.nodes["llm_a"].state = NodeState.TAKEN
    graph.nodes["llm_b"].state = NodeState.SKIPPED

    for edge in graph.edges.values():
        if edge.tail == "start" and edge.head == "llm_a":
            edge.state = NodeState.TAKEN
        elif edge.tail == "start" and edge.head == "llm_b":
            edge.state = NodeState.SKIPPED
        elif edge.head == "end" and edge.tail == "llm_a":
            edge.state = NodeState.TAKEN
        elif edge.head == "end" and edge.tail == "llm_b":
            edge.state = NodeState.SKIPPED

    snapshot = runtime_state.dumps()

    resumed_state = GraphRuntimeState.from_snapshot(snapshot)
    resumed_graph = _build_graph(resumed_state)
    resumed_state.attach_graph(resumed_graph)

    assert resumed_graph.nodes["llm_a"].state == NodeState.TAKEN
    assert resumed_graph.nodes["llm_b"].state == NodeState.SKIPPED
    assert _edge_state_map(resumed_graph) == _edge_state_map(graph)


def test_join_readiness_uses_restored_edge_states() -> None:
    runtime_state = _build_runtime_state()
    graph = _build_graph(runtime_state)
    runtime_state.attach_graph(graph)

    ready_queue = InMemoryReadyQueue()
    state_manager = GraphStateManager(graph, ready_queue)

    for edge in graph.get_incoming_edges("end"):
        if edge.tail == "llm_a":
            edge.state = NodeState.TAKEN
        if edge.tail == "llm_b":
            edge.state = NodeState.UNKNOWN

    assert state_manager.is_node_ready("end") is False

    for edge in graph.get_incoming_edges("end"):
        if edge.tail == "llm_b":
            edge.state = NodeState.TAKEN

    assert state_manager.is_node_ready("end") is True

    snapshot = runtime_state.dumps()
    resumed_state = GraphRuntimeState.from_snapshot(snapshot)
    resumed_graph = _build_graph(resumed_state)
    resumed_state.attach_graph(resumed_graph)

    resumed_state_manager = GraphStateManager(resumed_graph, InMemoryReadyQueue())
    assert resumed_state_manager.is_node_ready("end") is True
