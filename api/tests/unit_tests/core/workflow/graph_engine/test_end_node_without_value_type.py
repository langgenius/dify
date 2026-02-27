"""
Test case for end node without value_type field (backward compatibility).

This test validates that end nodes work correctly even when the value_type
field is missing from the output configuration, ensuring backward compatibility
with older workflow definitions.
"""

from core.workflow.graph_events import (
    GraphRunStartedEvent,
    GraphRunSucceededEvent,
    NodeRunStartedEvent,
    NodeRunStreamChunkEvent,
    NodeRunSucceededEvent,
)

from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_end_node_without_value_type_field():
    """
    Test that end node works without explicit value_type field.

    The fixture implements a simple workflow that:
    1. Takes a query input from start node
    2. Passes it directly to end node
    3. End node outputs the value without specifying value_type
    4. Should correctly infer the type and output the value

    This ensures backward compatibility with workflow definitions
    created before value_type became a required field.
    """
    fixture_name = "end_node_without_value_type_field_workflow"

    case = WorkflowTestCase(
        fixture_path=fixture_name,
        inputs={"query": "test query"},
        expected_outputs={"query": "test query"},
        expected_event_sequence=[
            # Graph start
            GraphRunStartedEvent,
            # Start node
            NodeRunStartedEvent,
            NodeRunStreamChunkEvent,  # Start node streams the input value
            NodeRunSucceededEvent,
            # End node
            NodeRunStartedEvent,
            NodeRunSucceededEvent,
            # Graph end
            GraphRunSucceededEvent,
        ],
        description="End node without value_type field should work correctly",
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)
    assert result.success, f"Test failed: {result.error}"
    assert result.actual_outputs == {"query": "test query"}, (
        f"Expected output to be {{'query': 'test query'}}, got {result.actual_outputs}"
    )
