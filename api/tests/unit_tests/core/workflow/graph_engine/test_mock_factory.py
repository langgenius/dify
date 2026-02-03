"""
Mock node factory for testing workflows with third-party service dependencies.

This module provides a MockNodeFactory that automatically detects and mocks nodes
requiring external services (LLM, Agent, Tool, Knowledge Retrieval, HTTP Request).
"""

from typing import TYPE_CHECKING, Any, cast

from core.app.workflow.node_factory import DifyNodeFactory
from core.workflow.entities.base_node import BaseNodeData
from core.workflow.entities.graph_config import NodeConfigDict
from core.workflow.enums import NodeType
from core.workflow.nodes.base.node import Node

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


class MockNodeFactory:
    """
    A factory that creates mock nodes for testing purposes.

    This factory intercepts node creation and returns mock implementations
    for nodes that require third-party services, allowing tests to run
    without external dependencies.
    """

    def __init__(
        self,
        graph_init_params: "GraphInitParams | None",
        graph_runtime_state: "GraphRuntimeState | None",
        mock_config: "MockConfig | None" = None,
    ) -> None:
        """
        Initialize the mock node factory.

        :param graph_init_params: Graph initialization parameters
        :param graph_runtime_state: Graph runtime state
        :param mock_config: Optional mock configuration for customizing mock behavior
        """
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state
        self.mock_config = mock_config
        self._base_factory: DifyNodeFactory | None = None

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

    def _get_base_factory(self) -> DifyNodeFactory:
        if self._base_factory is not None:
            return self._base_factory

        if self.graph_init_params is None or self.graph_runtime_state is None:
            raise ValueError("MockNodeFactory requires graph_init_params and graph_runtime_state to create nodes")

        self._base_factory = DifyNodeFactory(self.graph_init_params, self.graph_runtime_state)
        return self._base_factory

    @staticmethod
    def _normalize_node_config(node_config: NodeConfigDict | dict[str, Any]) -> NodeConfigDict:
        """
        Normalize node config to the shape expected by DifyNodeFactory.

        DifyNodeFactory expects `node_config["data"]` to be a BaseNodeData instance. Test code may still pass
        `data` as a raw dict; nodes themselves can handle both, but the factory needs BaseNodeData for type/version.
        """
        raw = cast(dict[str, Any], dict(node_config))
        if "id" not in raw:
            raise ValueError("Node config missing id")
        if "data" not in raw:
            raise ValueError(f"node config for node {raw['id']} missing required 'data' field")

        data = raw["data"]
        if isinstance(data, dict):
            raw["data"] = BaseNodeData.model_validate(data)
        elif not isinstance(data, BaseNodeData):
            raise TypeError("node config 'data' field must be a dict or BaseNodeData instance")

        return cast(NodeConfigDict, raw)

    def create_node(self, node_config: NodeConfigDict | dict[str, Any]) -> Node:
        """
        Create a node instance, using mock implementations for third-party service nodes.

        :param node_config: Node configuration dictionary
        :return: Node instance (real or mocked)
        """
        normalized_config = self._normalize_node_config(node_config)
        node_type = normalized_config["data"].type

        # Check if this node type should be mocked
        if node_type in self._mock_node_types:
            node_id = normalized_config["id"]
            # Create mock node instance
            mock_class = self._mock_node_types[node_type]
            if node_type == NodeType.CODE:
                base_factory = self._get_base_factory()
                mock_instance = mock_class(
                    id=node_id,
                    config=normalized_config,
                    graph_init_params=base_factory.graph_init_params,
                    graph_runtime_state=base_factory.graph_runtime_state,
                    mock_config=self.mock_config,
                    code_executor=base_factory._code_executor,
                    code_providers=base_factory._code_providers,
                    code_limits=base_factory._code_limits,
                )
            elif node_type == NodeType.TEMPLATE_TRANSFORM:
                base_factory = self._get_base_factory()
                mock_instance = mock_class(
                    id=node_id,
                    config=normalized_config,
                    graph_init_params=base_factory.graph_init_params,
                    graph_runtime_state=base_factory.graph_runtime_state,
                    mock_config=self.mock_config,
                    template_renderer=base_factory._template_renderer,
                )
            elif node_type == NodeType.HTTP_REQUEST:
                base_factory = self._get_base_factory()
                mock_instance = mock_class(
                    id=node_id,
                    config=normalized_config,
                    graph_init_params=base_factory.graph_init_params,
                    graph_runtime_state=base_factory.graph_runtime_state,
                    mock_config=self.mock_config,
                    http_client=base_factory._http_request_http_client,
                    tool_file_manager_factory=base_factory._http_request_tool_file_manager_factory,
                    file_manager=base_factory._http_request_file_manager,
                )
            else:
                base_factory = self._get_base_factory()
                mock_instance = mock_class(
                    id=node_id,
                    config=normalized_config,
                    graph_init_params=base_factory.graph_init_params,
                    graph_runtime_state=base_factory.graph_runtime_state,
                    mock_config=self.mock_config,
                )

            return mock_instance

        # For non-mocked node types, use parent implementation
        return self._get_base_factory().create_node(normalized_config)

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
