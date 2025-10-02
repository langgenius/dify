"""
Configuration system for mock nodes in testing.

This module provides a flexible configuration system for customizing
the behavior of mock nodes during testing.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from core.workflow.enums import NodeType


@dataclass
class NodeMockConfig:
    """Configuration for a specific node mock."""

    node_id: str
    outputs: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    delay: float = 0.0  # Simulated execution delay in seconds
    custom_handler: Callable[..., dict[str, Any]] | None = None


@dataclass
class MockConfig:
    """
    Global configuration for mock nodes in a test.

    This configuration allows tests to customize the behavior of mock nodes,
    including their outputs, errors, and execution characteristics.
    """

    # Node-specific configurations by node ID
    node_configs: dict[str, NodeMockConfig] = field(default_factory=dict)

    # Default configurations by node type
    default_configs: dict[NodeType, dict[str, Any]] = field(default_factory=dict)

    # Global settings
    enable_auto_mock: bool = True
    simulate_delays: bool = False
    default_llm_response: str = "This is a mocked LLM response"
    default_agent_response: str = "This is a mocked agent response"
    default_tool_response: dict[str, Any] = field(default_factory=lambda: {"result": "mocked tool output"})
    default_retrieval_response: str = "This is mocked retrieval content"
    default_http_response: dict[str, Any] = field(
        default_factory=lambda: {"status_code": 200, "body": "mocked response", "headers": {}}
    )
    default_template_transform_response: str = "This is mocked template transform output"
    default_code_response: dict[str, Any] = field(default_factory=lambda: {"result": "mocked code execution result"})

    def get_node_config(self, node_id: str) -> NodeMockConfig | None:
        """Get configuration for a specific node."""
        return self.node_configs.get(node_id)

    def set_node_config(self, node_id: str, config: NodeMockConfig) -> None:
        """Set configuration for a specific node."""
        self.node_configs[node_id] = config

    def set_node_outputs(self, node_id: str, outputs: dict[str, Any]) -> None:
        """Set expected outputs for a specific node."""
        if node_id not in self.node_configs:
            self.node_configs[node_id] = NodeMockConfig(node_id=node_id)
        self.node_configs[node_id].outputs = outputs

    def set_node_error(self, node_id: str, error: str) -> None:
        """Set an error for a specific node to simulate failure."""
        if node_id not in self.node_configs:
            self.node_configs[node_id] = NodeMockConfig(node_id=node_id)
        self.node_configs[node_id].error = error

    def get_default_config(self, node_type: NodeType) -> dict[str, Any]:
        """Get default configuration for a node type."""
        return self.default_configs.get(node_type, {})

    def set_default_config(self, node_type: NodeType, config: dict[str, Any]) -> None:
        """Set default configuration for a node type."""
        self.default_configs[node_type] = config


class MockConfigBuilder:
    """
    Builder for creating MockConfig instances with a fluent interface.

    Example:
        config = (MockConfigBuilder()
                  .with_llm_response("Custom LLM response")
                  .with_node_output("node_123", {"text": "specific output"})
                  .with_node_error("node_456", "Simulated error")
                  .build())
    """

    def __init__(self) -> None:
        self._config = MockConfig()

    def with_auto_mock(self, enabled: bool = True) -> "MockConfigBuilder":
        """Enable or disable auto-mocking."""
        self._config.enable_auto_mock = enabled
        return self

    def with_delays(self, enabled: bool = True) -> "MockConfigBuilder":
        """Enable or disable simulated execution delays."""
        self._config.simulate_delays = enabled
        return self

    def with_llm_response(self, response: str) -> "MockConfigBuilder":
        """Set default LLM response."""
        self._config.default_llm_response = response
        return self

    def with_agent_response(self, response: str) -> "MockConfigBuilder":
        """Set default agent response."""
        self._config.default_agent_response = response
        return self

    def with_tool_response(self, response: dict[str, Any]) -> "MockConfigBuilder":
        """Set default tool response."""
        self._config.default_tool_response = response
        return self

    def with_retrieval_response(self, response: str) -> "MockConfigBuilder":
        """Set default retrieval response."""
        self._config.default_retrieval_response = response
        return self

    def with_http_response(self, response: dict[str, Any]) -> "MockConfigBuilder":
        """Set default HTTP response."""
        self._config.default_http_response = response
        return self

    def with_template_transform_response(self, response: str) -> "MockConfigBuilder":
        """Set default template transform response."""
        self._config.default_template_transform_response = response
        return self

    def with_code_response(self, response: dict[str, Any]) -> "MockConfigBuilder":
        """Set default code execution response."""
        self._config.default_code_response = response
        return self

    def with_node_output(self, node_id: str, outputs: dict[str, Any]) -> "MockConfigBuilder":
        """Set outputs for a specific node."""
        self._config.set_node_outputs(node_id, outputs)
        return self

    def with_node_error(self, node_id: str, error: str) -> "MockConfigBuilder":
        """Set error for a specific node."""
        self._config.set_node_error(node_id, error)
        return self

    def with_node_config(self, config: NodeMockConfig) -> "MockConfigBuilder":
        """Add a node-specific configuration."""
        self._config.set_node_config(config.node_id, config)
        return self

    def with_default_config(self, node_type: NodeType, config: dict[str, Any]) -> "MockConfigBuilder":
        """Set default configuration for a node type."""
        self._config.set_default_config(node_type, config)
        return self

    def build(self) -> MockConfig:
        """Build and return the MockConfig instance."""
        return self._config
