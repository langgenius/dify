"""
Mock node factory for testing workflows with third-party service dependencies.

This module provides a MockNodeFactory that automatically detects and mocks nodes
requiring external services (LLM, Agent, Tool, Knowledge Retrieval, HTTP Request).
"""

from typing import TYPE_CHECKING, Any

from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes, NodeType
from graphon.nodes.base.node import Node

from core.workflow.node_factory import DifyNodeFactory

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
    from graphon.entities import GraphInitParams
    from graphon.runtime import GraphRuntimeState

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
            BuiltinNodeTypes.LLM: MockLLMNode,
            BuiltinNodeTypes.AGENT: MockAgentNode,
            BuiltinNodeTypes.TOOL: MockToolNode,
            BuiltinNodeTypes.KNOWLEDGE_RETRIEVAL: MockKnowledgeRetrievalNode,
            BuiltinNodeTypes.HTTP_REQUEST: MockHttpRequestNode,
            BuiltinNodeTypes.QUESTION_CLASSIFIER: MockQuestionClassifierNode,
            BuiltinNodeTypes.PARAMETER_EXTRACTOR: MockParameterExtractorNode,
            BuiltinNodeTypes.DOCUMENT_EXTRACTOR: MockDocumentExtractorNode,
            BuiltinNodeTypes.ITERATION: MockIterationNode,
            BuiltinNodeTypes.LOOP: MockLoopNode,
            BuiltinNodeTypes.TEMPLATE_TRANSFORM: MockTemplateTransformNode,
            BuiltinNodeTypes.CODE: MockCodeNode,
        }

    def create_node(self, node_config: dict[str, Any] | NodeConfigDict) -> Node:
        """
        Create a node instance, using mock implementations for third-party service nodes.

        :param node_config: Node configuration dictionary
        :return: Node instance (real or mocked)
        """
        typed_node_config = NodeConfigDictAdapter.validate_python(node_config)
        node_data = typed_node_config["data"]
        node_type = node_data.type

        # Check if this node type should be mocked
        if node_type in self._mock_node_types:
            node_id = typed_node_config["id"]

            # Create mock node instance
            mock_class = self._mock_node_types[node_type]
            if node_type == BuiltinNodeTypes.CODE:
                mock_instance = mock_class(
                    id=node_id,
                    config=typed_node_config,
                    graph_init_params=self.graph_init_params,
                    graph_runtime_state=self.graph_runtime_state,
                    mock_config=self.mock_config,
                    code_executor=self._code_executor,
                    code_limits=self._code_limits,
                )
            elif node_type == BuiltinNodeTypes.HTTP_REQUEST:
                mock_instance = mock_class(
                    id=node_id,
                    config=typed_node_config,
                    graph_init_params=self.graph_init_params,
                    graph_runtime_state=self.graph_runtime_state,
                    mock_config=self.mock_config,
                    http_request_config=self._http_request_config,
                    http_client=self._http_request_http_client,
                    tool_file_manager_factory=self._bound_tool_file_manager_factory,
                    file_manager=self._http_request_file_manager,
                )
            elif node_type in {
                BuiltinNodeTypes.LLM,
                BuiltinNodeTypes.QUESTION_CLASSIFIER,
                BuiltinNodeTypes.PARAMETER_EXTRACTOR,
            }:
                mock_instance = mock_class(
                    id=node_id,
                    config=typed_node_config,
                    graph_init_params=self.graph_init_params,
                    graph_runtime_state=self.graph_runtime_state,
                    mock_config=self.mock_config,
                    credentials_provider=self._llm_credentials_provider,
                    model_factory=self._llm_model_factory,
                )
            else:
                mock_instance = mock_class(
                    id=node_id,
                    config=typed_node_config,
                    graph_init_params=self.graph_init_params,
                    graph_runtime_state=self.graph_runtime_state,
                    mock_config=self.mock_config,
                )

            return mock_instance

        # For non-mocked node types, use parent implementation
        return super().create_node(typed_node_config)

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
