import uuid
from collections.abc import Generator
from datetime import datetime, timezone

from core.workflow.entities.variable_pool import VariablePool
from core.workflow.enums import SystemVariableKey
from core.workflow.graph_engine.entities.event import (
    GraphEngineEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)
from core.workflow.graph_engine.entities.graph import Graph
from core.workflow.graph_engine.entities.runtime_route_state import RouteNodeState
from core.workflow.nodes.answer.answer_stream_processor import AnswerStreamProcessor
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.start.entities import StartNodeData


def _recursive_process(graph: Graph, next_node_id: str) -> Generator[GraphEngineEvent, None, None]:
    if next_node_id == "start":
        yield from _publish_events(graph, next_node_id)

    for edge in graph.edge_mapping.get(next_node_id, []):
        yield from _publish_events(graph, edge.target_node_id)

    for edge in graph.edge_mapping.get(next_node_id, []):
        yield from _recursive_process(graph, edge.target_node_id)


def _publish_events(graph: Graph, next_node_id: str) -> Generator[GraphEngineEvent, None, None]:
    route_node_state = RouteNodeState(node_id=next_node_id, start_at=datetime.now(timezone.utc).replace(tzinfo=None))

    parallel_id = graph.node_parallel_mapping.get(next_node_id)
    parallel_start_node_id = None
    if parallel_id:
        parallel = graph.parallel_mapping.get(parallel_id)
        parallel_start_node_id = parallel.start_from_node_id if parallel else None

    node_execution_id = str(uuid.uuid4())
    node_config = graph.node_id_config_mapping[next_node_id]
    node_type = NodeType(node_config.get("data", {}).get("type"))
    mock_node_data = StartNodeData(**{"title": "demo", "variables": []})

    yield NodeRunStartedEvent(
        id=node_execution_id,
        node_id=next_node_id,
        node_type=node_type,
        node_data=mock_node_data,
        route_node_state=route_node_state,
        parallel_id=graph.node_parallel_mapping.get(next_node_id),
        parallel_start_node_id=parallel_start_node_id,
    )

    if "llm" in next_node_id:
        length = int(next_node_id[-1])
        for i in range(0, length):
            yield NodeRunStreamChunkEvent(
                id=node_execution_id,
                node_id=next_node_id,
                node_type=node_type,
                node_data=mock_node_data,
                chunk_content=str(i),
                route_node_state=route_node_state,
                from_variable_selector=[next_node_id, "text"],
                parallel_id=parallel_id,
                parallel_start_node_id=parallel_start_node_id,
            )

    route_node_state.status = RouteNodeState.Status.SUCCESS
    route_node_state.finished_at = datetime.now(timezone.utc).replace(tzinfo=None)
    yield NodeRunSucceededEvent(
        id=node_execution_id,
        node_id=next_node_id,
        node_type=node_type,
        node_data=mock_node_data,
        route_node_state=route_node_state,
        parallel_id=parallel_id,
        parallel_start_node_id=parallel_start_node_id,
    )


def test_process():
    graph_config = {
        "edges": [
            {
                "id": "start-source-llm1-target",
                "source": "start",
                "target": "llm1",
            },
            {
                "id": "start-source-llm2-target",
                "source": "start",
                "target": "llm2",
            },
            {
                "id": "start-source-llm3-target",
                "source": "start",
                "target": "llm3",
            },
            {
                "id": "llm3-source-llm4-target",
                "source": "llm3",
                "target": "llm4",
            },
            {
                "id": "llm3-source-llm5-target",
                "source": "llm3",
                "target": "llm5",
            },
            {
                "id": "llm4-source-answer2-target",
                "source": "llm4",
                "target": "answer2",
            },
            {
                "id": "llm5-source-answer-target",
                "source": "llm5",
                "target": "answer",
            },
            {
                "id": "answer2-source-answer-target",
                "source": "answer2",
                "target": "answer",
            },
            {
                "id": "llm2-source-answer-target",
                "source": "llm2",
                "target": "answer",
            },
            {
                "id": "llm1-source-answer-target",
                "source": "llm1",
                "target": "answer",
            },
        ],
        "nodes": [
            {"data": {"type": "start"}, "id": "start"},
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm1",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm2",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm3",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm4",
            },
            {
                "data": {
                    "type": "llm",
                },
                "id": "llm5",
            },
            {
                "data": {"type": "answer", "title": "answer", "answer": "a{{#llm2.text#}}b"},
                "id": "answer",
            },
            {
                "data": {"type": "answer", "title": "answer2", "answer": "c{{#llm3.text#}}d"},
                "id": "answer2",
            },
        ],
    }

    graph = Graph.init(graph_config=graph_config)

    variable_pool = VariablePool(
        system_variables={
            SystemVariableKey.QUERY: "what's the weather in SF",
            SystemVariableKey.FILES: [],
            SystemVariableKey.CONVERSATION_ID: "abababa",
            SystemVariableKey.USER_ID: "aaa",
        },
        user_inputs={},
    )

    answer_stream_processor = AnswerStreamProcessor(graph=graph, variable_pool=variable_pool)

    def graph_generator() -> Generator[GraphEngineEvent, None, None]:
        # print("")
        for event in _recursive_process(graph, "start"):
            # print("[ORIGIN]", event.__class__.__name__ + ":", event.route_node_state.node_id,
            #       " " + (event.chunk_content if isinstance(event, NodeRunStreamChunkEvent) else ""))
            if isinstance(event, NodeRunSucceededEvent):
                if "llm" in event.route_node_state.node_id:
                    variable_pool.add(
                        [event.route_node_state.node_id, "text"],
                        "".join(str(i) for i in range(0, int(event.route_node_state.node_id[-1]))),
                    )
            yield event

    result_generator = answer_stream_processor.process(graph_generator())
    stream_contents = ""
    for event in result_generator:
        # print("[ANSWER]", event.__class__.__name__ + ":", event.route_node_state.node_id,
        #       " " + (event.chunk_content if isinstance(event, NodeRunStreamChunkEvent) else ""))
        if isinstance(event, NodeRunStreamChunkEvent):
            stream_contents += event.chunk_content
        pass

    assert stream_contents == "c012da01b"
