from collections.abc import Callable, Sequence
from typing import TYPE_CHECKING, final

from typing_extensions import override

from configs import dify_config
from core.file import file_manager
from core.helper import ssrf_proxy
from core.helper.code_executor.code_executor import CodeExecutor
from core.helper.code_executor.code_node_provider import CodeNodeProvider
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.enums import NodeType
from core.workflow.graph import NodeFactory
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.code.code_node import CodeNode
from core.workflow.nodes.code.limits import CodeNodeLimits
from core.workflow.nodes.http_request.node import HttpRequestNode
from core.workflow.nodes.node_mapping import LATEST_VERSION, NODE_TYPE_CLASSES_MAPPING
from core.workflow.nodes.protocols import FileManagerProtocol, HttpClientProtocol
from core.workflow.nodes.template_transform.template_renderer import (
    CodeExecutorJinja2TemplateRenderer,
    Jinja2TemplateRenderer,
)
from core.workflow.nodes.template_transform.template_transform_node import TemplateTransformNode
from libs.typing import is_str, is_str_dict

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
        *,
        code_executor: type[CodeExecutor] | None = None,
        code_providers: Sequence[type[CodeNodeProvider]] | None = None,
        code_limits: CodeNodeLimits | None = None,
        template_renderer: Jinja2TemplateRenderer | None = None,
        http_request_http_client: HttpClientProtocol = ssrf_proxy,
        http_request_tool_file_manager_factory: Callable[[], ToolFileManager] = ToolFileManager,
        http_request_file_manager: FileManagerProtocol = file_manager,
    ) -> None:
        self.graph_init_params = graph_init_params
        self.graph_runtime_state = graph_runtime_state
        self._code_executor: type[CodeExecutor] = code_executor or CodeExecutor
        self._code_providers: tuple[type[CodeNodeProvider], ...] = (
            tuple(code_providers) if code_providers else CodeNode.default_code_providers()
        )
        self._code_limits = code_limits or CodeNodeLimits(
            max_string_length=dify_config.CODE_MAX_STRING_LENGTH,
            max_number=dify_config.CODE_MAX_NUMBER,
            min_number=dify_config.CODE_MIN_NUMBER,
            max_precision=dify_config.CODE_MAX_PRECISION,
            max_depth=dify_config.CODE_MAX_DEPTH,
            max_number_array_length=dify_config.CODE_MAX_NUMBER_ARRAY_LENGTH,
            max_string_array_length=dify_config.CODE_MAX_STRING_ARRAY_LENGTH,
            max_object_array_length=dify_config.CODE_MAX_OBJECT_ARRAY_LENGTH,
        )
        self._template_renderer = template_renderer or CodeExecutorJinja2TemplateRenderer()
        self._http_request_http_client = http_request_http_client
        self._http_request_tool_file_manager_factory = http_request_tool_file_manager_factory
        self._http_request_file_manager = http_request_file_manager

    @override
    def create_node(self, node_config: dict[str, object]) -> Node:
        """
        Create a Node instance from node configuration data using the traditional mapping.

        :param node_config: node configuration dictionary containing type and other data
        :return: initialized Node instance
        :raises ValueError: if node type is unknown or configuration is invalid
        """
        # Get node_id from config
        node_id = node_config.get("id")
        if not is_str(node_id):
            raise ValueError("Node config missing id")

        # Get node type from config
        node_data = node_config.get("data", {})
        if not is_str_dict(node_data):
            raise ValueError(f"Node {node_id} missing data information")

        node_type_str = node_data.get("type")
        if not is_str(node_type_str):
            raise ValueError(f"Node {node_id} missing or invalid type information")

        try:
            node_type = NodeType(node_type_str)
        except ValueError:
            raise ValueError(f"Unknown node type: {node_type_str}")

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
            )

        if node_type == NodeType.HTTP_REQUEST:
            return HttpRequestNode(
                id=node_id,
                config=node_config,
                graph_init_params=self.graph_init_params,
                graph_runtime_state=self.graph_runtime_state,
                http_client=self._http_request_http_client,
                tool_file_manager_factory=self._http_request_tool_file_manager_factory,
                file_manager=self._http_request_file_manager,
            )

        return node_class(
            id=node_id,
            config=node_config,
            graph_init_params=self.graph_init_params,
            graph_runtime_state=self.graph_runtime_state,
        )
