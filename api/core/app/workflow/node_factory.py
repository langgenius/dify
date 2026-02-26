from typing import TYPE_CHECKING, final

from typing_extensions import override

from configs import dify_config
from core.helper.code_executor.code_executor import CodeExecutor
from core.helper.code_executor.code_node_provider import CodeNodeProvider
from core.helper.ssrf_proxy import ssrf_proxy
from core.rag.retrieval.dataset_retrieval import DatasetRetrieval
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.entities.graph_config import NodeConfigDict
from core.workflow.enums import NodeType
from core.workflow.file.file_manager import file_manager
from core.workflow.graph.graph import NodeFactory
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.code.limits import CodeNodeLimits
from core.workflow.nodes.document_extractor import DocumentExtractorNode, UnstructuredApiConfig
from core.workflow.nodes.http_request import HttpRequestNode, build_http_request_config
from core.workflow.nodes.knowledge_retrieval.knowledge_retrieval_node import KnowledgeRetrievalNode
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from core.workflow.nodes.template_transform.template_renderer import CodeExecutorJinja2TemplateRenderer
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState


@final
class DifyNodeFactory(NodeFactory):
    """
    Default implementation of NodeFactory that uses the traditional node mapping.

    This factory creates nodes by looking up their types in NODE_TYPE_CLASSES_MAPPING
    and instantiating the appropriate node class.
    """

    def __init__(
        self,
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
    ) -> None:
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state
        self._code_executor: type[CodeExecutor] = CodeExecutor
        self._code_providers: tuple[type[CodeNodeProvider], ...] = CodeNode.default_code_providers()
        self._code_limits = CodeNodeLimits(
            max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
            max_number=dify_config.CODE_MAX_NUMBER,
            min_number=dify_config.CODE_MIN_NUMBER,
            max_precision=dify_config.CODE_MAX_PRECISION,
            max_depth=dify_config.CODE_MAX_DEPTH,
            max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
            max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
            max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
        )
        self._template_renderer = CodeExecutorJinja2TemplateRenderer()
        self._template_transform_max_output_length = dify_config.TEMPLATE_TRANSFORM_MAX_LENGTH
        self._http_request_http_client = ssrf_proxy
        self._http_request_tool_file_manager_factory = ToolFileManager
        self._http_request_file_manager = file_manager
        self._rag_retrieval = DatasetRetrieval()
        self._document_extractor_unstructured_api_config = UnstructuredApiConfig(
            api_url=dify_config.UNSTRUCTURED_API_URL,
            api_key=dify_config.UNSTRUCTURED_API_KEY or "",
        )
        self._http_request_config = build_http_request_config(
            max_connect_timeout=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
            max_read_timeout=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
            max_write_timeout=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
            max_binary_size=dify_config.HTTP_REQUEST_NODE_MAX_BINARY_SIZE,
            max_text_size=dify_config.HTTP_REQUEST_NODE_MAX_TEXT_SIZE,
            ssl_verify=dify_config.HTTP_REQUEST_NODE_SSL_VERIFY,
            ssrf_default_max_retries=dify_config.SSRF_DEFAULT_MAX_RETRIES,
        )

    @override
    def create_node(self, node_config: NodeConfigDict) -> Node:
        """
        Create a Node instance from node configuration data using the traditional mapping.

        :param node_config: node configuration dictionary containing type and other data
        :return: initialized Node instance
        :raises ValueError: if node type is unknown or configuration is invalid
        """
        # Get node_id from config
        node_id = node_config["id"]

        # Get node type from config
        node_data = node_config["data"]
        try:
            node_type = NodeType(node_data["type"])
        except ValueError:
            raise ValueError(f"Unknown node type: {node_data['type']}")

        # Get node class
        node_mapping = NODE_TYPE_CLASSES_MAPPING.get(node_type)
        if not node_mapping:
            raise ValueError(f"No class mapping found for node type: {node_type}")

        latest_node_class = node_mapping.get(LATEST_VERSION)
        node_version = str(node_data.get("version", "1"))
        matched_node_class = node_mapping.get(node_version)
        node_class = matched_node_class or latest_node_class
        if not node_class:
            raise ValueError(f"No latest version class found for node type: {node_type}")

        # Create node instance
        if node_type == NodeType.CODE:
            return CodeNode(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                code_executor=self._code_executor,
                code_providers=self._code_providers,
                code_limits=self._code_limits,
            )

        if node_type == NodeType.TEMPLATE_TRANSFORM:
            return TemplateTransformNode(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                template_renderer=self._template_renderer,
                max_output_length=self._template_transform_max_output_length,
            )

        if node_type == NodeType.HTTP_REQUEST:
            return HttpRequestNode(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                http_request_config=self._http_request_config,
                http_client=self._http_request_http_client,
                tool_file_manager_factory=self._http_request_tool_file_manager_factory,
                file_manager=self._http_request_file_manager,
            )

        if node_type == NodeType.KNOWLEDGE_RETRIEVAL:
            return KnowledgeRetrievalNode(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                rag_retrieval=self._rag_retrieval,
            )

        if node_type == NodeType.DOCUMENT_EXTRACTOR:
            return DocumentExtractorNode(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                unstructured_api_config=self._document_extractor_unstructured_api_config,
            )

        return node_class(
            id=node_id,
            config=node_config,
            graph_init_params=self.graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
        )
