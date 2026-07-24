"""
Example demonstrating the auto-mock system for testing workflows.

This example shows how to test workflows with third-party service nodes
without making actual API calls.
"""

from .test_mock_config import MockConfigBuilder
from .test_table_runner import TableTestRunner, WorkflowTestCase


def example_test_llm_workflow():
    """
    Example: Testing a workflow with an LLM node.

    This demonstrates how to test a workflow that uses an LLM service
    without making actual API calls to OpenAI, Anthropic, etc.
    """
    print("\n=== Example: Testing LLM Workflow ===\n")

    # Initialize the test runner
    runner = TableTestRunner()

    # Configure mock responses
    mock_config = MockConfigBuilder().with_llm_response("I'm a helpful AI assistant. How can I help you today?").build()

    # Define the test case
    test_case = WorkflowTestCase(
        fixture_path="llm-simple",
        inputs={"query": "Hello, AI!"},
        expected_outputs={"answer": "I'm a helpful AI assistant. How can I help you today?"},
        description="Testing LLM workflow with mocked response",
        use_auto_mock=True,  # Enable auto-mocking
        mock_config=mock_config,
    )

    # Run the test
    result = runner.run_test_case(test_case)

    if result.success:
        print("✅ Test passed!")
        print(f"   Input: {test_case.inputs['query']}")
        print(f"   Output: {result.actual_outputs['answer']}")
        print(f"   Execution time: {result.execution_time:.2f}s")
    else:
        print(f"❌ Test failed: {result.error}")

    return result.success


def example_test_with_custom_outputs():
    """
    Example: Testing with custom outputs for specific nodes.

    This shows how to provide different mock outputs for specific node IDs,
    useful when testing complex workflows with multiple LLM/tool nodes.
    """
    print("\n=== Example: Custom Node Outputs ===\n")

    runner = TableTestRunner()

    # Configure mock with specific outputs for different nodes
    mock_config = MockConfigBuilder().build()

    # Set custom output for a specific LLM node
    mock_config.set_node_outputs(
        "llm_node",
        {
            "text": "This is a custom response for the specific LLM node",
            "usage": {
                "prompt_tokens": 50,
                "completion_tokens": 20,
                "total_tokens": 70,
            },
            "finish_reason": "stop",
        },
    )

    test_case = WorkflowTestCase(
        fixture_path="llm-simple",
        inputs={"query": "Tell me about custom outputs"},
        expected_outputs={"answer": "This is a custom response for the specific LLM node"},
        description="Testing with custom node outputs",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    if result.success:
        print("✅ Test with custom outputs passed!")
        print(f"   Custom output: {result.actual_outputs['answer']}")
    else:
        print(f"❌ Test failed: {result.error}")

    return result.success


def example_test_http_and_tool_workflow():
    """
    Example: Testing a workflow with HTTP request and tool nodes.

    This demonstrates mocking external HTTP calls and tool executions.
    """
    print("\n=== Example: HTTP and Tool Workflow ===\n")

    runner = TableTestRunner()

    # Configure mocks for HTTP and Tool nodes
    mock_config = MockConfigBuilder().build()

    # Mock HTTP response
    mock_config.set_node_outputs(
        "http_node",
        {
            "status_code": 200,
            "body": '{"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]}',
            "headers": {"content-type": "application/json"},
        },
    )

    # Mock tool response (e.g., JSON parser)
    mock_config.set_node_outputs(
        "tool_node",
        {
            "result": {"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]},
        },
    )

    test_case = WorkflowTestCase(
        fixture_path="http-tool-workflow",
        inputs={"url": "https://api.example.com/users"},
        expected_outputs={
            "status_code": 200,
            "parsed_data": {"users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}]},
        },
        description="Testing HTTP and Tool workflow",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    if result.success:
        print("✅ HTTP and Tool workflow test passed!")
        print(f"   HTTP Status: {result.actual_outputs['status_code']}")
        print(f"   Parsed Data: {result.actual_outputs['parsed_data']}")
    else:
        print(f"❌ Test failed: {result.error}")

    return result.success


def example_test_error_simulation():
    """
    Example: Simulating errors in specific nodes.

    This shows how to test error handling in workflows by simulating
    failures in specific nodes.
    """
    print("\n=== Example: Error Simulation ===\n")

    runner = TableTestRunner()

    # Configure mock to simulate an error
    mock_config = MockConfigBuilder().build()
    mock_config.set_node_error("llm_node", "API rate limit exceeded")

    test_case = WorkflowTestCase(
        fixture_path="llm-simple",
        inputs={"query": "This will fail"},
        expected_outputs={},  # We expect failure
        description="Testing error handling",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    if not result.success:
        print("✅ Error simulation worked as expected!")
        print(f"   Simulated error: {result.error}")
    else:
        print("❌ Expected failure but test succeeded")

    return not result.success  # Success means we got the expected error


def example_test_with_delays():
    """
    Example: Testing with simulated execution delays.

    This demonstrates how to simulate realistic execution times
    for performance testing.
    """
    print("\n=== Example: Simulated Delays ===\n")

    runner = TableTestRunner()

    # Configure mock with delays
    mock_config = (
        MockConfigBuilder()
        .with_delays(True)  # Enable delay simulation
        .with_llm_response("Response after delay")
        .build()
    )

    # Add specific delay for the LLM node
    from .test_mock_config import NodeMockConfig

    node_config = NodeMockConfig(
        node_id="llm_node",
        outputs={"text": "Response after delay"},
        delay=0.5,  # 500ms delay
    )
    mock_config.set_node_config("llm_node", node_config)

    test_case = WorkflowTestCase(
        fixture_path="llm-simple",
        inputs={"query": "Test with delay"},
        expected_outputs={"answer": "Response after delay"},
        description="Testing with simulated delays",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    if result.success:
        print("✅ Delay simulation test passed!")
        print(f"   Execution time: {result.execution_time:.2f}s")
        print("   (Should be >= 0.5s due to simulated delay)")
    else:
        print(f"❌ Test failed: {result.error}")

    return result.success and result.execution_time >= 0.5


def run_all_examples():
    """Run all example tests."""
    print("\n" + "=" * 50)
    print("AUTO-MOCK SYSTEM EXAMPLES")
    print("=" * 50)

    examples = [
        example_test_llm_workflow,
        example_test_with_custom_outputs,
        example_test_http_and_tool_workflow,
        example_test_error_simulation,
        example_test_with_delays,
    ]

    results = []
    for example in examples:
        try:
            results.append(example())
        except Exception as e:
            print(f"\n❌ Example failed with exception: {e}")
            results.append(False)

    print("\n" + "=" * 50)
    print("SUMMARY")
    print("=" * 50)

    passed = sum(results)
    total = len(results)
    print(f"\n✅ Passed: {passed}/{total}")

    if passed == total:
        print("\n🎉 All examples passed successfully!")
    else:
        print(f"\n⚠️  {total - passed} example(s) failed")

    return passed == total


if __name__ == "__main__":
    import sys

    success = run_all_examples()
    sys.exit(0 if success else 1)
