from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_basic_chatflow():
    fixture_name = "basic_chatflow"
    mock_config = MockConfigBuilder().with_llm_response("mocked llm response").build()
    case = WorkflowTestCase(
        fixture_path=fixture_name,
        use_auto_mock=True,
        mock_config=mock_config,
        expected_outputs={"answer": "mocked llm response"},
        expected_event_sequence=[
            GraphRunStartedEvent,
            # START
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # LLM
            NodeRunStartedEvent,
        ]
        + [NodeRunStreamChunkEvent] * ("mocked llm response".count(" ") + 2)
        + [
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
