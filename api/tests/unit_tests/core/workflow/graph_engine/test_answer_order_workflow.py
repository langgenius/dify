from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase

LLM_NODE_ID = "1759052580454"


def test_answer_nodes_emit_in_order() -> None:
    mock_config = (
        MockConfigBuilder()
        .with_llm_response("unused default")
        .with_node_output(LLM_NODE_ID, {"text": "mocked llm text"})
        .build()
    )

    expected_answer = "--- answer 1 ---\n\nfoo\n--- answer 2 ---\n\nmocked llm text\n"

    case = WorkflowTestCase(
        fixture_path="test-answer-order",
        query="",
        expected_outputs={"answer": expected_answer},
        use_auto_mock=True,
        mock_config=mock_config,
    )

    runner = TableTestRunner()
    result = runner.run_test_case(case)

    assert result.success, result.error
