from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_answer_end_with_text():
    fixture_name = "answer_end_with_text"
    case = WorkflowTestCase(
        fixture_name,
        query="Hello, AI!",
        expected_outputs={"answer": "prefixHello, AI!suffix"},
        expected_event_sequence=[
            GraphRunStartedEvent,
            # Start
            NodeRunStartedEvent,
            # The chunks are now emitted as the Answer node processes them
            # since sys.query is a special selector that gets attributed to
            # the active response node
            NodeRunStreamChunkEvent,  # prefix
            NodeRunStreamChunkEvent,  # sys.query
            NodeRunStreamChunkEvent,  # suffix
            NodeRunSucceededEvent,
            # Answer
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            GraphRunSucceededEvent,
        ],
    )
    runner = TableTestRunner()
    result = runner.run_test_case(case)
    assert result.success, f"Test failed: {result.error}"
