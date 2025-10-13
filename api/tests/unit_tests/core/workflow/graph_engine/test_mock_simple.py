"""
Simple test to validate the auto-mock system without external dependencies.
"""

import sys
from pathlib import Path

# Add api directory to path
api_dir = Path(__file__).parent.parent.parent.parent.parent.parent
sys.path.insert(0, str(api_dir))

from core.workflow.enums import NodeType
from tests.unit_tests.core.workflow.graph_engine.test_mock_config import MockConfig, MockConfigBuilder, NodeMockConfig
from tests.unit_tests.core.workflow.graph_engine.test_mock_factory import MockNodeFactory


def test_mock_config_builder():
    """Test the MockConfigBuilder fluent interface."""
    print("Testing MockConfigBuilder...")

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

    print("✓ MockConfigBuilder test passed")


def test_mock_config_operations():
    """Test MockConfig operations."""
    print("Testing MockConfig operations...")

    config = MockConfig()

    # Test setting node outputs
    config.set_node_outputs("test_node", {"result": "test_value"})
    node_config = config.get_node_config("test_node")
    assert node_config is not None
    assert node_config.outputs == {"result": "test_value"}

    # Test setting node error
    config.set_node_error("error_node", "Test error")
    error_config = config.get_node_config("error_node")
    assert error_config is not None
    assert error_config.error == "Test error"

    # Test default configs by node type
    config.set_default_config(NodeType.LLM, {"temperature": 0.7})
    llm_config = config.get_default_config(NodeType.LLM)
    assert llm_config == {"temperature": 0.7}

    print("✓ MockConfig operations test passed")


def test_node_mock_config():
    """Test NodeMockConfig."""
    print("Testing NodeMockConfig...")

    # Test with custom handler
    def custom_handler(node):
        return {"custom": "output"}

    node_config = NodeMockConfig(
        node_id="test_node", outputs={"text": "test"}, error=None, delay=0.5, custom_handler=custom_handler
    )

    assert node_config.node_id == "test_node"
    assert node_config.outputs == {"text": "test"}
    assert node_config.delay == 0.5
    assert node_config.custom_handler is not None

    # Test custom handler
    result = node_config.custom_handler(None)
    assert result == {"custom": "output"}

    print("✓ NodeMockConfig test passed")


def test_mock_factory_detection():
    """Test MockNodeFactory node type detection."""
    print("Testing MockNodeFactory detection...")

    factory = MockNodeFactory(
        graph_init_params=None,
        graph_runtime_state=None,
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

    print("✓ MockNodeFactory detection test passed")


def test_mock_factory_registration():
    """Test registering and unregistering mock node types."""
    print("Testing MockNodeFactory registration...")

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

    # Register custom mock (using a dummy class for testing)
    class DummyMockNode:
        pass

    factory.register_mock_node_type(NodeType.TEMPLATE_TRANSFORM, DummyMockNode)
    assert factory.should_mock_node(NodeType.TEMPLATE_TRANSFORM)

    print("✓ MockNodeFactory registration test passed")


def run_all_tests():
    """Run all tests."""
    print("\n=== Running Auto-Mock System Tests ===\n")

    try:
        test_mock_config_builder()
        test_mock_config_operations()
        test_node_mock_config()
        test_mock_factory_detection()
        test_mock_factory_registration()

        print("\n=== All tests passed! ✅ ===\n")
        return True
    except AssertionError as e:
        print(f"\n❌ Test failed: {e}")
        return False
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback

        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
