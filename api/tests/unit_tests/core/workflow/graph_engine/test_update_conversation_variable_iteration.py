"""Validate conversation variable updates inside an iteration workflow.

This test uses the ``update-conversation-variable-in-iteration`` fixture, which
routes ``sys.query`` into the conversation variable ``answer`` from within an
iteration container. The workflow should surface that updated conversation
variable in the final answer output.

Code nodes in the fixture are mocked because their concrete outputs are not
relevant to verifying variable propagation semantics.
"""

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_update_conversation_variable_in_iteration():
    fixture_name = "update-conversation-variable-in-iteration"
    user_query = "ensure conversation variable syncs"

    mock_config = (
        MockConfigBuilder()
        .with_node_output("1759032363865", {"result": [1]})
        .with_node_output("1759032476318", {"result": ""})
        .build()
    )

    case = WorkflowTestCase(
        fixture_path=fixture_name,
        use_auto_mock=True,
        mock_config=mock_config,
        query=user_query,
        expected_outputs={"answer": user_query},
        description="Conversation variable updated within iteration should flow to answer output.",
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)

    assert result.success, f"Workflow execution failed: {result.error}"
    assert result.actual_outputs is not None
    assert result.actual_outputs.get("answer") == user_query
