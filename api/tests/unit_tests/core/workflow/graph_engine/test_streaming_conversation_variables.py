from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_streaming_conversation_variables():
    fixture_name = "test_streaming_conversation_variables"

    # The test expects the workflow to output the input query
    # Since the workflow assigns sys.query to conversation variable "str" and then answers with it
    input_query = "Hello, this is my test query"

    mock_config = MockConfigBuilder().build()

    case = WorkflowTestCase(
        fixture_path=fixture_name,
        use_auto_mock=False,  # Don't use auto mock since we want to test actual variable assignment
        mock_config=mock_config,
        query=input_query,  # Pass query as the sys.query value
        inputs={},  # No additional inputs needed
        expected_outputs={"answer": input_query},  # Expecting the input query to be output
        expected_event_sequence=[
            GraphRunStartedEvent,
            # START node
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Variable Assigner node
            NodeRunStartedEvent,
            NodeRunStreamChunkEvent,
            NodeRunSucceededEvent,
            # ANSWER node
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            GraphRunSucceededEvent,
        ],
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)
    assert result.success, f"Test failed: {result.error}"
