import logging
import mimetypes
from collections.abc import Callable, Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.helper.ssrf_proxy import ssrf_proxy
from core.tools.tool_file_manager import ToolFileManager
from core.variables.segments import ArrayFileSegment
from core.workflow.enums import NodeType, WorkflowNodeExecutionStatus
from core.workflow.file import File, FileTransferMethod
from core.workflow.file.file_manager import file_manager as default_file_manager
from core.workflow.node_events import NodeRunResult
from core.workflow.nodes.base import variable_template_parser
from core.workflow.nodes.base.entities import VariableSelector
from core.workflow.nodes.base.node import Node
from core.workflow.nodes.http_request.executor import Executor
from core.workflow.nodes.protocols import FileManagerProtocol, HttpClientProtocol
from factories import file_factory

from .config import build_http_request_config, resolve_http_request_config
from .entities import (
    HTTP_REQUEST_CONFIG_FILTER_KEY,
    HttpRequestNodeConfig,
    HttpRequestNodeData,
    HttpRequestNodeTimeout,
    Response,
)
from .exc import HttpRequestNodeError, RequestBodyError

logger = logging.getLogger(__name__)

if TYPE_CHECKING:
    from core.workflow.entities import GraphInitParams
    from core.workflow.runtime import GraphRuntimeState


class HttpRequestNode(Node[HttpRequestNodeData]):
    node_type = NodeType.HTTP_REQUEST

    def __init__(
        self,
        id: str,
        config: Mapping[str, Any],
        graph_init_params: "GraphInitParams",
        graph_runtime_state: "GraphRuntimeState",
        *,
        http_request_config: HttpRequestNodeConfig,
        http_client: HttpClientProtocol | None = None,
        tool_file_manager_factory: Callable[[], ToolFileManager] = ToolFileManager,
        file_manager: FileManagerProtocol | None = None,
    ) -> None:
        super().__init__(
            id=id,
            config=config,
            graph_init_params=graph_init_params,
            graph_runtime_state=graph_runtime_state,
        )
        self._http_request_config = http_request_config
        self._http_client = http_client or ssrf_proxy
        self._tool_file_manager_factory = tool_file_manager_factory
        self._file_manager = file_manager or default_file_manager

    @classmethod
    def get_default_config(cls, filters: Mapping[str, object] | None = None) -> Mapping[str, object]:
        if not filters or HTTP_REQUEST_CONFIG_FILTER_KEY not in filters:
            http_request_config = build_http_request_config()
        else:
            http_request_config = resolve_http_request_config(filters)
        default_timeout = http_request_config.default_timeout()
        return {
            "type": "http-request",
            "config": {
                "method": "get",
                "authorization": {
                    "type": "no-auth",
                },
                "body": {"type": "none"},
                "timeout": {
                    **default_timeout.model_dump(),
                    "max_connect_timeout": http_request_config.max_connect_timeout,
                    "max_read_timeout": http_request_config.max_read_timeout,
                    "max_write_timeout": http_request_config.max_write_timeout,
                },
                "ssl_verify": http_request_config.ssl_verify,
            },
            "retry_config": {
                "max_retries": http_request_config.ssrf_default_max_retries,
                "retry_interval": 0.5 * (2**2),
                "retry_enabled": True,
            },
        }

    @classmethod
    def version(cls) -> str:
        return "1"

    def _run(self) -> NodeRunResult:
        process_data = {}
        try:
            http_executor = Executor(
                node_data=self.node_data,
                timeout=self._get_request_timeout(self.node_data),
                variable_pool=self.graph_runtime_state.variable_pool,
                http_request_config=self._http_request_config,
                max_retries=0,
                ssl_verify=self.node_data.ssl_verify,
                http_client=self._http_client,
                file_manager=self._file_manager,
            )
            process_data["request"] = http_executor.to_log()

            response = http_executor.invoke()
            files = self.extract_files(url=http_executor.url, response=response)
            if not response.response.is_success and (self.error_strategy or self.retry):
                return NodeRunResult(
                    status=WorkflowNodeExecutionStatus.FAILED,
                    outputs={
                        "status_code": response.status_code,
                        "body": response.text if not files.value else "",
                        "headers": response.headers,
                        "files": files,
                    },
                    process_data={
                        "request": http_executor.to_log(),
                    },
                    error=f"Request failed with status code {response.status_code}",
                    error_type="HTTPResponseCodeError",
                )
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    "status_code": response.status_code,
                    "body": response.text if not files.value else "",
                    "headers": response.headers,
                    "files": files,
                },
                process_data={
                    "request": http_executor.to_log(),
                },
            )
        except HttpRequestNodeError as e:
            logger.warning("http request node %s failed to run: %s", self._node_id, e)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                process_data=process_data,
                error_type=type(e).__name__,
            )

    def _get_request_timeout(self, node_data: HttpRequestNodeData) -> HttpRequestNodeTimeout:
        default_timeout = self._http_request_config.default_timeout()
        timeout = node_data.timeout
        if timeout is None:
            return default_timeout

        return HttpRequestNodeTimeout(
            connect=timeout.connect or default_timeout.connect,
            read=timeout.read or default_timeout.read,
            write=timeout.write or default_timeout.write,
        )

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: Mapping[str, Any],
    ) -> Mapping[str, Sequence[str]]:
        # Create typed NodeData from dict
        typed_node_data = HttpRequestNodeData.model_validate(node_data)

        selectors: list[VariableSelector] = []
        selectors += variable_template_parser.extract_selectors_from_template(typed_node_data.url)
        selectors += variable_template_parser.extract_selectors_from_template(typed_node_data.headers)
        selectors += variable_template_parser.extract_selectors_from_template(typed_node_data.params)
        if typed_node_data.body:
            body_type = typed_node_data.body.type
            data = typed_node_data.body.data
            match body_type:
                case "none":
                    pass
                case "binary":
                    if len(data) != 1:
                        raise RequestBodyError("invalid body data, should have only one item")
                    selector = data[0].file
                    selectors.append(VariableSelector(variable="#" + ".".join(selector) + "#", value_selector=selector))
                case "json" | "raw-text":
                    if len(data) != 1:
                        raise RequestBodyError("invalid body data, should have only one item")
                    selectors += variable_template_parser.extract_selectors_from_template(data[0].key)
                    selectors += variable_template_parser.extract_selectors_from_template(data[0].value)
                case "x-www-form-urlencoded":
                    for item in data:
                        selectors += variable_template_parser.extract_selectors_from_template(item.key)
                        selectors += variable_template_parser.extract_selectors_from_template(item.value)
                case "form-data":
                    for item in data:
                        selectors += variable_template_parser.extract_selectors_from_template(item.key)
                        if item.type == "text":
                            selectors += variable_template_parser.extract_selectors_from_template(item.value)
                        elif item.type == "file":
                            selectors.append(
                                VariableSelector(variable="#" + ".".join(item.file) + "#", value_selector=item.file)
                            )

        mapping = {}
        for selector_iter in selectors:
            mapping[node_id + "." + selector_iter.variable] = selector_iter.value_selector

        return mapping

    def extract_files(self, url: str, response: Response) -> ArrayFileSegment:
        """
        Extract files from response by checking both Content-Type header and URL
        """
        files: list[File] = []
        is_file = response.is_file
        content_type = response.content_type
        content = response.content
        parsed_content_disposition = response.parsed_content_disposition
        content_disposition_type = None

        if not is_file:
            return ArrayFileSegment(value=[])

        if parsed_content_disposition:
            content_disposition_filename = parsed_content_disposition.get_filename()
            if content_disposition_filename:
                # If filename is available from content-disposition, use it to guess the content type
                content_disposition_type = mimetypes.guess_type(content_disposition_filename)[0]

        # Guess file extension from URL or Content-Type header
        filename = url.split("?")[0].split("/")[-1] or ""
        mime_type = (
            content_disposition_type or content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        )
        tool_file_manager = self._tool_file_manager_factory()

        tool_file = tool_file_manager.create_file_by_raw(
            user_id=self.user_id,
            tenant_id=self.tenant_id,
            conversation_id=None,
            file_binary=content,
            mimetype=mime_type,
        )

        mapping = {
            "tool_file_id": tool_file.id,
            "transfer_method": FileTransferMethod.TOOL_FILE,
        }
        file = file_factory.build_from_mapping(
            mapping=mapping,
            tenant_id=self.tenant_id,
        )
        files.append(file)

        return ArrayFileSegment(value=files)

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled
