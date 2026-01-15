"""
Test case for loop with inner answer output error scenario.

This test validates the behavior of a loop containing an answer node
inside the loop that may produce output errors.
"""

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


def test_loop_contains_answer():
    """
    Test loop with inner answer node that may have output errors.

    The fixture implements a loop that:
    1. Iterates 4 times (index 0-3)
    2. Contains an inner answer node that outputs index and item values
    3. Has a break condition when index equals 4
    4. Tests error handling for answer nodes within loops
    """
    fixture_name = "loop_contains_answer"
    mock_config = MockConfigBuilder().build()

    case = WorkflowTestCase(
        fixture_path=fixture_name,
        use_auto_mock=True,
        mock_config=mock_config,
        query="1",
        expected_outputs={"answer": "1\n2\n1 + 2"},
        expected_event_sequence=[
            # Graph start
            GraphRunStartedEvent,
            # Start
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Loop start
            NodeRunStartedEvent,
            NodeRunLoopStartedEvent,
            # Variable assigner
            NodeRunStartedEvent,
            NodeRunStreamChunkEvent,  # 1
            NodeRunStreamChunkEvent,  # \n
            NodeRunSucceededEvent,
            # Answer
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Loop next
            NodeRunLoopNextEvent,
            # Variable assigner
            NodeRunStartedEvent,
            NodeRunStreamChunkEvent,  # 2
            NodeRunStreamChunkEvent,  # \n
            NodeRunSucceededEvent,
            # Answer
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Loop end
            NodeRunLoopSucceededEvent,
            NodeRunStreamChunkEvent,  # 1
            NodeRunStreamChunkEvent,  # +
            NodeRunStreamChunkEvent,  # 2
            NodeRunSucceededEvent,
            # Answer
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Graph end
            GraphRunSucceededEvent,
        ],
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)
    assert result.success, f"Test failed: {result.error}"
