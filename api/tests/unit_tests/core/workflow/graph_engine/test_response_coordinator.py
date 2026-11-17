"""Reachability, bounded graph traversal, and checkpoint compatibility regressions."""

import json
import random
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import ClassVar, cast

import pytest

from dify_graph.enums import BuiltinNodeTypes, NodeExecutionType, NodeState, NodeType
from dify_graph.graph import Edge
from dify_graph.graph_engine.response_coordinator import ResponseStreamCoordinator
from dify_graph.graph_events import NodeRunStreamChunkEvent
from dify_graph.nodes.base.template import Template, TextSegment, VariableSegment
from dify_graph.runtime import GraphRuntimeState, VariablePool
from dify_graph.runtime.graph_runtime_state import EdgeProtocol, NodeProtocol


@dataclass
class StubNode:
    id: str
    execution_type: NodeExecutionType = NodeExecutionType.EXECUTABLE
    state: NodeState = NodeState.UNKNOWN
    template: Template = field(default_factory=lambda: Template(segments=[TextSegment(text="answer")]))
    assigned_selector: tuple[str, ...] = ()
    node_type: ClassVar[NodeType] = BuiltinNodeTypes.ANSWER

    def get_streaming_template(self) -> Template:
        return self.template

    def blocks_variable_output(self, variable_selectors: set[tuple[str, ...]]) -> bool:
        return self.assigned_selector in variable_selectors


class StubGraph:
    nodes: Mapping[str, NodeProtocol]
    edges: Mapping[str, EdgeProtocol]
    root_node: NodeProtocol
    outgoing: dict[str, list[Edge]]
    adjacency_calls: int
    call_budget: int | None

    def __init__(self, nodes: Sequence[StubNode], edges: Sequence[Edge]) -> None:
        self.nodes = {node.id: node for node in nodes}
        self.edges = {edge.id: edge for edge in edges}
        self.root_node = nodes[0]
        self.outgoing = {node.id: [] for node in nodes}
        for edge in edges:
            self.outgoing[edge.tail].append(edge)
        self.adjacency_calls = 0
        self.call_budget = None

    def get_outgoing_edges(self, node_id: str) -> Sequence[EdgeProtocol]:
        self.adjacency_calls += 1
        if self.call_budget is not None:
            assert self.adjacency_calls <= self.call_budget, "Graph traversal exceeded its linear budget"
        return self.outgoing[node_id]


@pytest.mark.parametrize("stages", [12, 24, 41])
def test_reconverging_branches_do_not_enumerate_paths(stages: int) -> None:
    """Parallel handles create 2**stages paths; abort old DFS without a timing assertion."""
    nodes = [StubNode(str(i), NodeExecutionType.BRANCH) for i in range(stages)]
    nodes.append(StubNode(str(stages), NodeExecutionType.RESPONSE))
    edges = [
        Edge(id=f"{i}-{handle}", tail=str(i), head=str(i + 1), source_handle=handle)
        for i in range(stages)
        for handle in ("yes", "no")
    ]
    graph = StubGraph(nodes, edges)
    graph.call_budget = 2 * len(nodes)
    coordinator = ResponseStreamCoordinator(VariablePool(), graph)

    coordinator.register(str(stages))
    assert len(coordinator.dumps()) < 1024 * (len(nodes) + len(edges))
    for i in range(stages):
        graph.adjacency_calls = 0
        events = coordinator.on_edge_taken(f"{i}-yes")
        assert [event.chunk for event in events] == (["answer"] if i == stages - 1 else [])
        assert len(coordinator.dumps()) < 1024 * (len(nodes) + len(edges))


def _enumerate_blocking_paths(graph: StubGraph, response: StubNode) -> list[set[str]]:
    """Small-graph oracle preserving the original complete-path enumeration semantics."""
    selectors = {
        tuple(segment.selector[:2]) for segment in response.template.segments if isinstance(segment, VariableSegment)
    }
    paths: list[set[str]] = []

    def visit(node_id: str, visited: set[str], blocking_edges: set[str]) -> None:
        if node_id == response.id:
            paths.append(blocking_edges)
            return
        node = graph.nodes[node_id]
        blocks = node.execution_type in {
            NodeExecutionType.BRANCH,
            NodeExecutionType.CONTAINER,
            NodeExecutionType.RESPONSE,
        } or node.blocks_variable_output(selectors)
        for edge in graph.outgoing[node_id]:
            if edge.head not in visited:
                visit(edge.head, visited | {edge.head}, blocking_edges | ({edge.id} if blocks else set()))

    visit(graph.root_node.id, {graph.root_node.id}, set())
    return paths


@pytest.mark.parametrize("seed", range(24))
def test_activation_matches_complete_path_oracle(seed: int) -> None:
    """Cover cycles, disconnected nodes, dead branches, alternate routes, and event order."""
    rng = random.Random(seed)  # noqa: S311 -- Reproducible graph fixtures.
    nodes = [StubNode(str(i), rng.choice(list(NodeExecutionType))) for i in range(7)]
    nodes[-1].execution_type = NodeExecutionType.RESPONSE
    edges = [
        Edge(id=f"{tail.id}-{head.id}", tail=tail.id, head=head.id)
        for tail in nodes
        for head in nodes
        if tail is not head and rng.random() < 0.25
    ]
    graph = StubGraph(nodes, edges)
    paths = _enumerate_blocking_paths(graph, nodes[-1])
    coordinator = ResponseStreamCoordinator(VariablePool(), graph)
    coordinator.register(nodes[-1].id)
    coordinator.register(nodes[-1].id)
    rng.shuffle(edges)
    emitted = False
    taken: set[str] = set()

    for edge_id in ["unrelated", *(edge.id for edge in edges), *(edge.id for edge in edges)]:
        taken.add(edge_id)
        reachable = any(path <= taken for path in paths)
        events = coordinator.on_edge_taken(edge_id)
        assert [event.chunk for event in events] == (["answer"] if reachable and not emitted else [])
        emitted |= reachable


@pytest.mark.parametrize("execution_type", list(NodeExecutionType))
@pytest.mark.parametrize("uses_assigned_variable", [False, True])
def test_blocking_depends_on_node_type_and_response_selectors(
    execution_type: NodeExecutionType, uses_assigned_variable: bool
) -> None:
    gate = StubNode("gate", execution_type, assigned_selector=("conversation", "value"))
    response = StubNode("answer", NodeExecutionType.RESPONSE)
    if uses_assigned_variable:
        response.template = Template(segments=[VariableSegment(selector=["conversation", "value", "nested"])])
    graph = StubGraph(
        [StubNode("start"), gate, response],
        [Edge(id="enter", tail="start", head="gate"), Edge(id="leave", tail="gate", head="answer")],
    )
    pool = VariablePool()
    pool.add(("conversation", "value"), {"nested": "answer"})
    coordinator = ResponseStreamCoordinator(pool, graph)
    coordinator.register("answer")
    blocks = (
        execution_type
        in {
            NodeExecutionType.BRANCH,
            NodeExecutionType.CONTAINER,
            NodeExecutionType.RESPONSE,
        }
        or uses_assigned_variable
    )

    assert [event.chunk for event in coordinator.on_edge_taken("enter")] == ([] if blocks else ["answer"])
    assert [event.chunk for event in coordinator.on_edge_taken("leave")] == (["answer"] if blocks else [])


def test_root_response_and_sequential_responses() -> None:
    first = StubNode("first", NodeExecutionType.RESPONSE)
    second = StubNode("second", NodeExecutionType.RESPONSE)
    graph = StubGraph([first, second], [Edge(id="next", tail="first", head="second")])
    coordinator = ResponseStreamCoordinator(VariablePool(), graph)
    coordinator.register("first")
    coordinator.register("second")

    assert [event.node_id for event in coordinator.on_edge_taken("unrelated")] == ["first"]
    assert [event.node_id for event in coordinator.on_edge_taken("next")] == ["second"]
    assert coordinator.on_edge_taken("next") == []


@pytest.mark.parametrize("attach_before_load", [False, True])
@pytest.mark.parametrize("edge_state", list(NodeState))
def test_checkpoint_preserves_taken_edges_and_buffered_output(attach_before_load: bool, edge_state: NodeState) -> None:
    response = StubNode(
        "answer",
        NodeExecutionType.RESPONSE,
        template=Template(segments=[TextSegment(text="prefix"), VariableSegment(selector=["source", "text"])]),
    )
    graph = StubGraph(
        [
            StubNode("first", NodeExecutionType.BRANCH),
            StubNode("second", NodeExecutionType.BRANCH),
            response,
            StubNode("source"),
        ],
        [Edge(id="first", tail="first", head="second"), Edge(id="second", tail="second", head="answer")],
    )
    pool = VariablePool()
    for edge in graph.edges.values():
        edge.state = edge_state
    coordinator = ResponseStreamCoordinator(pool, graph)
    runtime = GraphRuntimeState(variable_pool=pool, start_at=0, graph=graph, response_coordinator=coordinator)
    coordinator.register("answer")
    coordinator.track_node_execution("answer", "response-execution")
    chunk = NodeRunStreamChunkEvent(
        id="source-execution",
        node_id="source",
        node_type=BuiltinNodeTypes.LLM,
        selector=["source", "text"],
        chunk="buffered",
        is_final=True,
    )
    assert coordinator.intercept_event(chunk) == []
    assert coordinator.on_edge_taken("first") == []
    snapshot = runtime.dumps()

    restored = GraphRuntimeState(variable_pool=VariablePool(), start_at=0)
    if attach_before_load:
        restored.attach_graph(graph)
    restored.loads(snapshot)
    if not attach_before_load:
        restored.attach_graph(graph)
    resumed = cast(ResponseStreamCoordinator, restored.response_coordinator)
    resumed.register("answer")

    assert resumed.on_edge_taken("first") == []
    assert resumed.on_edge_taken("second") == [
        NodeRunStreamChunkEvent(
            id="response-execution",
            node_id="answer",
            node_type=BuiltinNodeTypes.ANSWER,
            selector=["answer", "answer"],
            chunk="prefix",
            is_final=False,
        ),
        chunk,
    ]
    assert resumed.on_edge_taken("second") == []


def test_legacy_checkpoint_keeps_remaining_path_conditions() -> None:
    graph = StubGraph(
        [
            StubNode("first", NodeExecutionType.BRANCH),
            StubNode("second", NodeExecutionType.BRANCH),
            StubNode("answer", NodeExecutionType.RESPONSE),
        ],
        [Edge(id="first", tail="first", head="second"), Edge(id="second", tail="second", head="answer")],
    )
    snapshot = json.dumps(
        {
            "type": "ResponseStreamCoordinator",
            "version": "1.0",
            "response_nodes": ["answer"],
            "pending_sessions": [{"node_id": "answer", "index": 0}],
            "paths_map": {"answer": [["second"]]},
        }
    )
    coordinator = ResponseStreamCoordinator(VariablePool(), graph)
    coordinator.loads(snapshot)
    # Re-saving an old pause must preserve consumed decisions absent from live edge states.
    resumed = ResponseStreamCoordinator(VariablePool(), graph)
    resumed.loads(coordinator.dumps())
    resumed.register("answer")

    assert resumed.on_edge_taken("unrelated") == []
    assert [event.chunk for event in resumed.on_edge_taken("second")] == ["answer"]
    assert resumed.on_edge_taken("second") == []
