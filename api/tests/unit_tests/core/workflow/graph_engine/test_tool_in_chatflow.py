from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import (
    GraphRunSucceededEvent,
    NodeRunStreamChunkEvent,
)

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner


def test_tool_in_chatflow():
    runner = TableTestRunner()

    # Load the workflow configuration
    fixture_data = runner.workflow_runner.load_fixture("chatflow_time_tool_static_output_workflow")

    # Create graph from fixture with auto-mock enabled
    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="1",
        use_mock_factory=True,
    )

    # Create and run the engine
    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    events = list(iter_dify_graph_engine_events(engine))

    # Check for successful completion
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]
    assert len(success_events) > 0, "Workflow should complete successfully"

    stream_chunk_events = [e for e in events if isinstance(e, NodeRunStreamChunkEvent)]
    assert len(stream_chunk_events) > 0
    assert "".join(event.chunk for event in stream_chunk_events) == "hello, dify!"
    assert stream_chunk_events[-1].is_final is True
    assert success_events[-1].outputs["answer"] == "hello, dify!"


def test_answer_can_render_llm_structured_output_in_chatflow():
    runner = TableTestRunner()

    fixture_data = runner.workflow_runner.load_fixture("basic_chatflow")
    nodes = fixture_data["workflow"]["graph"]["nodes"]
    answer_node = next(node for node in nodes if node["id"] == "answer")
    answer_node["data"]["answer"] = "{{#llm.structured_output#}}"

    mock_config = (
        MockConfigBuilder()
        .with_node_output(
            "llm",
            {
                "text": "plain text",
                "structured_output": {"type": "greeting"},
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .build()
    )

    graph, graph_runtime_state = runner.workflow_runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="hello",
        use_mock_factory=True,
        mock_config=mock_config,
    )

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )

    events = list(iter_dify_graph_engine_events(engine))
    success_events = [e for e in events if isinstance(e, GraphRunSucceededEvent)]

    assert success_events, "Workflow should complete successfully"
    assert success_events[-1].outputs["answer"] == '{\n  "type": "greeting"\n}'
