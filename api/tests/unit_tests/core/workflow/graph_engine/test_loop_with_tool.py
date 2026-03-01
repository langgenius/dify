from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunLoopNextEvent,
    NodeRunLoopStartedEvent,
    NodeRunLoopSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_loop_with_tool():
    fixture_name = "search_dify_from_2023_to_2025"
    mock_config = (
        MockConfigBuilder()
        .with_tool_response(
            {
                "text": "mocked search result",
            }
        )
        .build()
    )
    case = WorkflowTestCase(
        fixture_path=fixture_name,
        use_auto_mock=True,
        mock_config=mock_config,
        expected_outputs={
            "answer": """- mocked search result
- mocked search result"""
        },
        expected_event_sequence=[
            GraphRunStartedEvent,
            # START
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # LOOP START
            NodeRunStartedEvent,
            NodeRunLoopStartedEvent,
            # 2023
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            NodeRunLoopNextEvent,
            # 2024
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # LOOP END
            NodeRunLoopSucceededEvent,
            NodeRunStreamChunkEvent,  # loop.res
            NodeRunSucceededEvent,
            # ANSWER
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            GraphRunSucceededEvent,
        ],
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)
    assert result.success, f"Test failed: {result.error}"
