"""
Mock node factory for testing workflows with third-party service dependencies.

This module provides a MockNodeFactory that automatically detects and mocks nodes
requiring external services (LLM, Agent, Tool, Knowledge Retrieval, HTTP Request).
"""

from typing import TYPE_CHECKING, Any

from core.workflow.enums import NodeType
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.node_factory import DifyNodeFactory

from .test_mock_nodes import (
    MockAgentNode,
    MockCodeNode,
    MockDocumentExtractorNode,
    MockHttpRequestNode,
    MockIterationNode,
    MockKnowledgeRetrievalNode,
    MockLLMNode,
    MockLoopNode,
    MockParameterExtractorNode,
    MockQuestionClassifierNode,
    MockTemplateTransformNode,
    MockToolNode,
)

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState

    from .test_mock_config import MockConfig


class MockNodeFactory(DifyNodeFactory):
    """
    A factory that creates mock nodes for testing purposes.

    This factory intercepts node creation and returns mock implementations
    for nodes that require third-party services, allowing tests to run
    without external dependencies.
    """

    def __init__(
        self,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        mock_config: "MockConfig | None" = None,
    ) -> None:
        """
        Initialize the mock node factory.

        :param graph_init_params: Graph initialization parameters
        :param graph_runtime_state: Graph runtime state
        :param mock_config: Optional mock configuration for customizing mock behavior
        """
        super().__init__(graph_init_params, graph_runtime_state)
        self.mock_config = mock_config

        # Map of node types that should be mocked
        self._mock_node_types = {
            NodeType.LLM: MockLLMNode,
            NodeType.AGENT: MockAgentNode,
            NodeType.TOOL: MockToolNode,
            NodeType.KNOWLEDGE_RETRIEVAL: MockKnowledgeRetrievalNode,
            NodeType.HTTP_REQUEST: MockHttpRequestNode,
            NodeType.QUESTION_CLASSIFIER: MockQuestionClassifierNode,
            NodeType.PARAMETER_EXTRACTOR: MockParameterExtractorNode,
            NodeType.DOCUMENT_EXTRACTOR: MockDocumentExtractorNode,
            NodeType.ITERATION: MockIterationNode,
            NodeType.LOOP: MockLoopNode,
            NodeType.TEMPLATE_TRANSFORM: MockTemplateTransformNode,
            NodeType.CODE: MockCodeNode,
        }

    def create_node(self, node_config: dict[str, Any]) -> Node:
        """
        Create a node instance, using mock implementations for third-party service nodes.

        :param node_config: Node configuration dictionary
        :return: Node instance (real or mocked)
        """
        # Get node type from config
        node_data = node_config.get("data", {})
        node_type_str = node_data.get("type")

        if not node_type_str:
            # Fall back to parent implementation for nodes without type
            return super().create_node(node_config)

        try:
            node_type = NodeType(node_type_str)
        except ValueError:
            # Unknown node type, use parent implementation
            return super().create_node(node_config)

        # Check if this node type should be mocked
        if node_type in self._mock_node_types:
            node_id = node_config.get("id")
            if not node_id:
                raise ValueError("Node config missing id")

            # Create mock node instance
            mock_class = self._mock_node_types[node_type]
            mock_instance = mock_class(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                mock_config=self.mock_config,
            )

            # Initialize node with provided data
            mock_instance.init_node_data(node_data)

            return mock_instance

        # For non-mocked node types, use parent implementation
        return super().create_node(node_config)

    def should_mock_node(self, node_type: NodeType) -> bool:
        """
        Check if a node type should be mocked.

        :param node_type: The node type to check
        :return: True if the node should be mocked, False otherwise
        """
        return node_type in self._mock_node_types

    def register_mock_node_type(self, node_type: NodeType, mock_class: type[Node]) -> None:
        """
        Register a custom mock implementation for a node type.

        :param node_type: The node type to mock
        :param mock_class: The mock class to use for this node type
        """
        self._mock_node_types[node_type] = mock_class

    def unregister_mock_node_type(self, node_type: NodeType) -> None:
        """
        Remove a mock implementation for a node type.

        :param node_type: The node type to stop mocking
        """
        if node_type in self._mock_node_types:
            del self._mock_node_types[node_type]
