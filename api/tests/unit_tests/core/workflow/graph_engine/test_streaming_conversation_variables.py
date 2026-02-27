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


def test_streaming_conversation_variables_v1_overwrite_waits_for_assignment():
    fixture_name = "test_streaming_conversation_variables_v1_overwrite"
    input_query = "overwrite-value"

    case = WorkflowTestCase(
        fixture_path=fixture_name,
        use_auto_mock=False,
        mock_config=MockConfigBuilder().build(),
        query=input_query,
        inputs={},
        expected_outputs={"answer": f"Current Value Of `conv_var` is:{input_query}"},
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)
    assert result.success, f"Test failed: {result.error}"

    events = result.events
    conv_var_chunk_events = [
        event
        for event in events
        if isinstance(event, NodeRunStreamChunkEvent) and tuple(event.selector) == ("conversation", "conv_var")
    ]

    assert conv_var_chunk_events, "Expected conversation variable chunk events to be emitted"
    assert all(event.chunk == input_query for event in conv_var_chunk_events), (
        "Expected streamed conversation variable value to match the input query"
    )
