"""Integration coverage for Dify's ResponseStreamFilter boundary behavior."""

from core.workflow.workflow_entry import iter_dify_graph_engine_events
from graphon.graph_engine import GraphEngine, GraphEngineConfig
from graphon.graph_engine.command_channels import InMemoryChannel
from graphon.graph_events import GraphRunSucceededEvent, NodeRunStreamChunkEvent
from tests.unit_tests.core.workflow.graph_engine.test_mock_config import MockConfigBuilder
from tests.unit_tests.core.workflow.graph_engine.test_table_runner import WorkflowRunner


def _build_issue_170_mock_config():
    runner = WorkflowRunner()
    mock_config = (
        MockConfigBuilder()
        .with_node_output(
            "llm",
            {
                "text": "Quiet Night Thought",
                "usage": {
                    "prompt_tokens": 10,
                    "completion_tokens": 5,
                    "total_tokens": 15,
                },
                "finish_reason": "stop",
            },
        )
        .with_node_output(
            "dufu",
            {
                "text": "Spring View",
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

    return runner, mock_config


def test_dify_response_stream_filter_handles_issue_170_shape() -> None:
    runner, mock_config = _build_issue_170_mock_config()
    fixture_data = runner.load_fixture("response_stream_filter_issue_170_workflow")
    graph, graph_runtime_state = runner.create_graph_from_fixture(
        fixture_data=fixture_data,
        query="1",
        use_mock_factory=True,
        mock_config=mock_config,
    )

    expected_answer = "# Du Fu\n\nSpring View\n\n# Li Bai\n\nQuiet Night Thought"

    engine = GraphEngine(
        workflow_id="test_workflow",
        graph=graph,
        graph_runtime_state=graph_runtime_state,
        command_channel=InMemoryChannel(),
        config=GraphEngineConfig(),
    )
    events = list(iter_dify_graph_engine_events(engine))

    stream_chunk_events = [event for event in events if isinstance(event, NodeRunStreamChunkEvent)]
    success_events = [event for event in events if isinstance(event, GraphRunSucceededEvent)]

    assert success_events
    assert stream_chunk_events
    actual_answer = "".join(event.chunk for event in stream_chunk_events)
    assert actual_answer.strip() == expected_answer
    assert stream_chunk_events[-1].is_final is True
    assert success_events[-1].outputs["answer"].strip() == expected_answer
    assert actual_answer.strip() == success_events[-1].outputs["answer"].strip()
