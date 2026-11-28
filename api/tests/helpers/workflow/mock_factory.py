"""Mock node factory for third-party-service workflow tests.

The factory follows the same config adaptation path as production
`DifyNodeFactory.create_node()`, but swaps selected node classes for mock
implementations before instantiation.

`DifyNodeFactory` is declared `@final`, so this factory *composes* a production
factory instead of extending it: `MockNodeFactory` itself satisfies the graphon
`NodeFactory` protocol that `Graph.init()` accepts, and delegates every call it
does not intercept to the wrapped `DifyNodeFactory`. The invariant maintained
here is that a node type outside `_mock_node_types` behaves exactly as it would
under the production factory, while a mocked node type is built from the same
validated node data with the mock class substituted.
"""

import copy
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, override

from core.workflow.human_input_adapter import adapt_node_config_for_graph
from core.workflow.node_factory import DifyNodeFactory
from graphon.entities.base_node_data import BaseNodeData
from graphon.entities.graph_config import NodeConfigDict, NodeConfigDictAdapter
from graphon.enums import BuiltinNodeTypes, NodeExecutionType, NodeType
from graphon.graph import NodeFactory
from graphon.nodes.base.node import Node
from tests.helpers.workflow.mock_nodes import (
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
    from graphon.runtime import InitParams, RuntimeState
    from tests.helpers.workflow.mock_config import MockConfig

type MockNodeClass = (
    type[MockLLMNode]
    | type[MockAgentNode]
    | type[MockToolNode]
    | type[MockKnowledgeRetrievalNode]
    | type[MockHttpRequestNode]
    | type[MockQuestionClassifierNode]
    | type[MockParameterExtractorNode]
    | type[MockDocumentExtractorNode]
    | type[MockIterationNode]
    | type[MockLoopNode]
    | type[MockTemplateTransformNode]
    | type[MockCodeNode]
)

type MockNode = (
    MockLLMNode
    | MockAgentNode
    | MockToolNode
    | MockKnowledgeRetrievalNode
    | MockHttpRequestNode
    | MockQuestionClassifierNode
    | MockParameterExtractorNode
    | MockDocumentExtractorNode
    | MockIterationNode
    | MockLoopNode
    | MockTemplateTransformNode
    | MockCodeNode
)

_DEFAULT_MOCK_NODE_TYPES: dict[NodeType, MockNodeClass] = {
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


class MockNodeFactory(NodeFactory):
    """
    A factory that creates mock nodes for testing purposes.

    This factory intercepts node creation and returns mock implementations
    for nodes that require third-party services, allowing tests to run
    without external dependencies.
    """

    def __init__(
        self,
        init_params: "InitParams",
        runtime_state: "RuntimeState",
        mock_config: "MockConfig | None" = None,
    ) -> None:
        """
        Initialize the mock node factory.

        :param init_params: Graph initialization parameters
        :param runtime_state: Graph runtime state
        :param mock_config: Optional mock configuration for customizing mock behavior
        """
        self._delegate = DifyNodeFactory(init_params=init_params, runtime_state=runtime_state)
        self.mock_config = mock_config

        # Map of node types that should be mocked
        self._mock_node_types: dict[NodeType, MockNodeClass] = dict(_DEFAULT_MOCK_NODE_TYPES)

    @property
    def init_params(self) -> "InitParams":
        return self._delegate.init_params

    @property
    def runtime_state(self) -> "RuntimeState":
        return self._delegate.runtime_state

    @override
    def with_runtime_state(self, runtime_state: "RuntimeState") -> "MockNodeFactory":
        return MockNodeFactory(
            init_params=self.init_params,
            runtime_state=runtime_state,
            mock_config=self.mock_config,
        )

    @override
    def with_graph_config(self, graph_config: Mapping[str, Any]) -> "MockNodeFactory":
        factory = copy.copy(self)
        factory._delegate = self._delegate.with_graph_config(graph_config)
        return factory

    @override
    def validate_node(self, node_config: NodeConfigDict) -> NodeExecutionType:
        # Every mock class subclasses the production node it replaces, so it inherits
        # the same `validate_node_data` contract and `execution_type` declaration.
        # Validation therefore produces identical results through the delegate.
        return self._delegate.validate_node(node_config)

    @override
    def create_node(self, node_config: dict[str, Any] | NodeConfigDict) -> MockNode | Node[BaseNodeData]:
        """
        Create a node instance, using mock implementations for third-party service nodes.

        :param node_config: Node configuration dictionary
        :return: Node instance (real or mocked)
        """
        typed_node_config = NodeConfigDictAdapter.validate_python(adapt_node_config_for_graph(node_config))
        node_id = typed_node_config["id"]
        node_data = typed_node_config["data"]
        node_type = node_data.type

        # Check if this node type should be mocked
        mock_class = self._mock_node_types.get(node_type)
        if mock_class is not None:
            # Create mock node instance
            resolved_node_data = DifyNodeFactory._validate_resolved_node_data(mock_class, node_data)
            if node_type == BuiltinNodeTypes.CODE:
                return mock_class(
                    node_id=node_id,
                    data=resolved_node_data,
                    init_params=self.init_params,
                    runtime_state=self.runtime_state,
                    mock_config=self.mock_config,
                    code_executor=self._delegate._code_executor,
                    code_limits=self._delegate._code_limits,
                )
            if node_type == BuiltinNodeTypes.HTTP_REQUEST:
                return mock_class(
                    node_id=node_id,
                    data=resolved_node_data,
                    init_params=self.init_params,
                    runtime_state=self.runtime_state,
                    mock_config=self.mock_config,
                    http_request_config=self._delegate._http_request_config,
                    http_client=self._delegate._http_request_http_client,
                    tool_file_manager_factory=self._delegate._bound_tool_file_manager_factory,
                    file_manager=self._delegate._http_request_file_manager,
                )
            if node_type in {
                BuiltinNodeTypes.LLM,
                BuiltinNodeTypes.QUESTION_CLASSIFIER,
                BuiltinNodeTypes.PARAMETER_EXTRACTOR,
            }:
                return mock_class(
                    node_id=node_id,
                    data=resolved_node_data,
                    init_params=self.init_params,
                    runtime_state=self.runtime_state,
                    mock_config=self.mock_config,
                    credentials_provider=self._delegate._llm_credentials_provider,
                    model_factory=self._delegate._llm_model_factory,
                )
            return mock_class(
                node_id=node_id,
                data=resolved_node_data,
                init_params=self.init_params,
                runtime_state=self.runtime_state,
                mock_config=self.mock_config,
            )

        # For non-mocked node types, use the production factory
        return self._delegate.create_node(node_config)

    def should_mock_node(self, node_type: NodeType) -> bool:
        """
        Check if a node type should be mocked.

        :param node_type: The node type to check
        :return: True if the node should be mocked, False otherwise
        """
        return node_type in self._mock_node_types

    def register_mock_node_type(self, node_type: NodeType, mock_class: MockNodeClass) -> None:
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
