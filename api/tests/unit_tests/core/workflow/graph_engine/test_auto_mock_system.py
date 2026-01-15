"""
Tests for the auto-mock system.

This module contains tests that validate the auto-mock functionality
for workflows containing nodes that require third-party services.
"""

import pytest

from core.workflow.enums import NodeType

from .test_mock_config import MockConfig, MockConfigBuilder, NodeMockConfig
from .test_table_runner import TableTestRunner, WorkflowTestCase


def test_simple_llm_workflow_with_auto_mock():
    """Test that a simple LLM workflow runs successfully with auto-mocking."""
    runner = TableTestRunner()

    # Create mock configuration
    mock_config = MockConfigBuilder().with_llm_response("This is a test response from mocked LLM").build()

    test_case = WorkflowTestCase(
        fixture_path="basic_llm_chat_workflow",
        inputs={"query": "Hello, how are you?"},
        expected_outputs={"answer": "This is a test response from mocked LLM"},
        description="Simple LLM workflow with auto-mock",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed: {result.error}"
    assert result.actual_outputs is not None
    assert "answer" in result.actual_outputs
    assert result.actual_outputs["answer"] == "This is a test response from mocked LLM"


def test_llm_workflow_with_custom_node_output():
    """Test LLM workflow with custom output for specific node."""
    runner = TableTestRunner()

    # Create mock configuration with custom output for specific node
    mock_config = MockConfig()
    mock_config.set_node_outputs(
        "llm_node",
        {
            "text": "Custom response for this specific node",
            "usage": {
                "prompt_tokens": 20,
                "completion_tokens": 10,
                "total_tokens": 30,
            },
            "finish_reason": "stop",
        },
    )

    test_case = WorkflowTestCase(
        fixture_path="basic_llm_chat_workflow",
        inputs={"query": "Test query"},
        expected_outputs={"answer": "Custom response for this specific node"},
        description="LLM workflow with custom node output",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed: {result.error}"
    assert result.actual_outputs is not None
    assert result.actual_outputs["answer"] == "Custom response for this specific node"


def test_http_tool_workflow_with_auto_mock():
    """Test workflow with HTTP request and tool nodes using auto-mock."""
    runner = TableTestRunner()

    # Create mock configuration
    mock_config = MockConfig()
    mock_config.set_node_outputs(
        "http_node",
        {
            "status_code": 200,
            "body": '{"key": "value", "number": 42}',
            "headers": {"content-type": "application/json"},
        },
    )
    mock_config.set_node_outputs(
        "tool_node",
        {
            "result": {"key": "value", "number": 42},
        },
    )

    test_case = WorkflowTestCase(
        fixture_path="http_request_with_json_tool_workflow",
        inputs={"url": "https://api.example.com/data"},
        expected_outputs={
            "status_code": 200,
            "parsed_data": {"key": "value", "number": 42},
        },
        description="HTTP and Tool workflow with auto-mock",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed: {result.error}"
    assert result.actual_outputs is not None
    assert result.actual_outputs["status_code"] == 200
    assert result.actual_outputs["parsed_data"] == {"key": "value", "number": 42}


def test_workflow_with_simulated_node_error():
    """Test that workflows handle simulated node errors correctly."""
    runner = TableTestRunner()

    # Create mock configuration with error
    mock_config = MockConfig()
    mock_config.set_node_error("llm_node", "Simulated LLM API error")

    test_case = WorkflowTestCase(
        fixture_path="basic_llm_chat_workflow",
        inputs={"query": "This should fail"},
        expected_outputs={},  # We expect failure, so no outputs
        description="LLM workflow with simulated error",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    # The workflow should fail due to the simulated error
    assert not result.success
    assert result.error is not None


def test_workflow_with_mock_delays():
    """Test that mock delays work correctly."""
    runner = TableTestRunner()

    # Create mock configuration with delays
    mock_config = MockConfig(simulate_delays=True)
    node_config = NodeMockConfig(
        node_id="llm_node",
        outputs={"text": "Response after delay"},
        delay=0.1,  # 100ms delay
    )
    mock_config.set_node_config("llm_node", node_config)

    test_case = WorkflowTestCase(
        fixture_path="basic_llm_chat_workflow",
        inputs={"query": "Test with delay"},
        expected_outputs={"answer": "Response after delay"},
        description="LLM workflow with simulated delay",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed: {result.error}"
    # Execution time should be at least the delay
    assert result.execution_time >= 0.1


def test_mock_config_builder():
    """Test the MockConfigBuilder fluent interface."""
    config = (
        MockConfigBuilder()
        .with_llm_response("LLM response")
        .with_agent_response("Agent response")
        .with_tool_response({"tool": "output"})
        .with_retrieval_response("Retrieval content")
        .with_http_response({"status_code": 201, "body": "created"})
        .with_node_output("node1", {"output": "value"})
        .with_node_error("node2", "error message")
        .with_delays(True)
        .build()
    )

    assert config.default_llm_response == "LLM response"
    assert config.default_agent_response == "Agent response"
    assert config.default_tool_response == {"tool": "output"}
    assert config.default_retrieval_response == "Retrieval content"
    assert config.default_http_response == {"status_code": 201, "body": "created"}
    assert config.simulate_delays is True

    node1_config = config.get_node_config("node1")
    assert node1_config is not None
    assert node1_config.outputs == {"output": "value"}

    node2_config = config.get_node_config("node2")
    assert node2_config is not None
    assert node2_config.error == "error message"


def test_mock_factory_node_type_detection():
    """Test that MockNodeFactory correctly identifies nodes to mock."""
    from .test_mock_factory import MockNodeFactory

    factory = MockNodeFactory(
        graph_init_params=None,  # Will be set by test
        graph_runtime_state=None,  # Will be set by test
        mock_config=None,
    )

    # Test that third-party service nodes are identified for mocking
    assert factory.should_mock_node(NodeType.LLM)
    assert factory.should_mock_node(NodeType.AGENT)
    assert factory.should_mock_node(NodeType.TOOL)
    assert factory.should_mock_node(NodeType.KNOWLEDGE_RETRIEVAL)
    assert factory.should_mock_node(NodeType.HTTP_REQUEST)
    assert factory.should_mock_node(NodeType.PARAMETER_EXTRACTOR)
    assert factory.should_mock_node(NodeType.DOCUMENT_EXTRACTOR)

    # Test that CODE and TEMPLATE_TRANSFORM are mocked (they require SSRF proxy)
    assert factory.should_mock_node(NodeType.CODE)
    assert factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)

    # Test that non-service nodes are not mocked
    assert not factory.should_mock_node(NodeType.START)
    assert not factory.should_mock_node(NodeType.END)
    assert not factory.should_mock_node(NodeType.IF_ELSE)
    assert not factory.should_mock_node(NodeType.VARIABLE_AGGREGATOR)


def test_custom_mock_handler():
    """Test using a custom handler function for mock outputs."""
    runner = TableTestRunner()

    # Custom handler that modifies output based on input
    def custom_llm_handler(node) -> dict:
        # In a real scenario, we could access node.graph_runtime_state.variable_pool
        # to get the actual inputs
        return {
            "text": "Custom handler response",
            "usage": {
                "prompt_tokens": 5,
                "completion_tokens": 3,
                "total_tokens": 8,
            },
            "finish_reason": "stop",
        }

    mock_config = MockConfig()
    node_config = NodeMockConfig(
        node_id="llm_node",
        custom_handler=custom_llm_handler,
    )
    mock_config.set_node_config("llm_node", node_config)

    test_case = WorkflowTestCase(
        fixture_path="basic_llm_chat_workflow",
        inputs={"query": "Test custom handler"},
        expected_outputs={"answer": "Custom handler response"},
        description="LLM workflow with custom handler",
        use_auto_mock=True,
        mock_config=mock_config,
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed: {result.error}"
    assert result.actual_outputs["answer"] == "Custom handler response"


def test_workflow_without_auto_mock():
    """Test that workflows work normally without auto-mock enabled."""
    runner = TableTestRunner()

    # This test uses the echo workflow which doesn't need external services
    test_case = WorkflowTestCase(
        fixture_path="simple_passthrough_workflow",
        inputs={"query": "Test without mock"},
        expected_outputs={"query": "Test without mock"},
        description="Echo workflow without auto-mock",
        use_auto_mock=False,  # Auto-mock disabled
    )

    result = runner.run_test_case(test_case)

    assert result.success, f"Workflow failed: {result.error}"
    assert result.actual_outputs["query"] == "Test without mock"


def test_register_custom_mock_node():
    """Test registering a custom mock implementation for a node type."""
    from core.workflow.nodes.template_transform import TemplateTransformNode

    from .test_mock_factory import MockNodeFactory

    # Create a custom mock for TemplateTransformNode
    class MockTemplateTransformNode(TemplateTransformNode):
        def _run(self):
            # Custom mock implementation
            pass

    factory = MockNodeFactory(
        graph_init_params=None,
        graph_runtime_state=None,
        mock_config=None,
    )

    # TEMPLATE_TRANSFORM is mocked by default (requires SSRF proxy)
    assert factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)

    # Unregister mock
    factory.unregister_mock_node_type(NodeType.TEMPLATE_TRANSFORM)
    assert not factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)

    # Re-register custom mock
    factory.register_mock_node_type(NodeType.TEMPLATE_TRANSFORM, MockTemplateTransformNode)
    assert factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)


def test_default_config_by_node_type():
    """Test setting default configurations by node type."""
    mock_config = MockConfig()

    # Set default config for all LLM nodes
    mock_config.set_default_config(
        NodeType.LLM,
        {
            "default_response": "Default LLM response for all nodes",
            "temperature": 0.7,
        },
    )

    # Set default config for all HTTP nodes
    mock_config.set_default_config(
        NodeType.HTTP_REQUEST,
        {
            "default_status": 200,
            "default_timeout": 30,
        },
    )

    llm_config = mock_config.get_default_config(NodeType.LLM)
    assert llm_config["default_response"] == "Default LLM response for all nodes"
    assert llm_config["temperature"] == 0.7

    http_config = mock_config.get_default_config(NodeType.HTTP_REQUEST)
    assert http_config["default_status"] == 200
    assert http_config["default_timeout"] == 30

    # Non-configured node type should return empty dict
    tool_config = mock_config.get_default_config(NodeType.TOOL)
    assert tool_config == {}


if __name__ == "__main__":
    # Run all tests
    pytest.main([__file__, "-v"])
