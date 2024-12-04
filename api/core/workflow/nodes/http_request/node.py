import logging
from collections.abc import Mapping, Sequence
from typing import Any

from configs import dify_config
from core.file import File, FileTransferMethod
from core.tools.tool_file_manager import ToolFileManager
from core.workflow.entities.node_entities import NodeRunResult
from core.workflow.entities.variable_entities import VariableSelector
from core.workflow.nodes.base import BaseNode
from core.workflow.nodes.enums import NodeType
from core.workflow.nodes.http_request.executor import Executor
from core.workflow.utils import variable_template_parser
from factories import file_factory
from models.workflow import WorkflowNodeExecutionStatus

from .entities import (
    HttpRequestNodeData,
    HttpRequestNodeTimeout,
    Response,
)
from .exc import HttpRequestNodeError

HTTP_REQUEST_DEFAULT_TIMEOUT = HttpRequestNodeTimeout(
    connect=dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
    read=dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
    write=dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
)

logger = logging.getLogger(__name__)


class HttpRequestNode(BaseNode[HttpRequestNodeData]):
    _node_data_cls = HttpRequestNodeData
    _node_type = NodeType.HTTP_REQUEST

    @classmethod
    def get_default_config(cls, filters: dict | None = None) -> dict:
        return {
            "type": "http-request",
            "config": {
                "method": "get",
                "authorization": {
                    "type": "no-auth",
                },
                "body": {"type": "none"},
                "timeout": {
                    **HTTP_REQUEST_DEFAULT_TIMEOUT.model_dump(),
                    "max_connect_timeout": dify_config.HTTP_REQUEST_MAX_CONNECT_TIMEOUT,
                    "max_read_timeout": dify_config.HTTP_REQUEST_MAX_READ_TIMEOUT,
                    "max_write_timeout": dify_config.HTTP_REQUEST_MAX_WRITE_TIMEOUT,
                },
            },
        }

    def _run(self) -> NodeRunResult:
        process_data = {}
        try:
            http_executor = Executor(
                node_data=self.node_data,
                timeout=self._get_request_timeout(self.node_data),
                variable_pool=self.graph_runtime_state.variable_pool,
            )
            process_data["request"] = http_executor.to_log()

            response = http_executor.invoke()
            files = self.extract_files(url=http_executor.url, response=response)
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.SUCCEEDED,
                outputs={
                    "status_code": response.status_code,
                    "body": response.text if not files else "",
                    "headers": response.headers,
                    "files": files,
                },
                process_data={
                    "request": http_executor.to_log(),
                },
            )
        except HttpRequestNodeError as e:
            logger.warning(f"http request node {self.node_id} failed to run: {e}")
            return NodeRunResult(
                status=WorkflowNodeExecutionStatus.FAILED,
                error=str(e),
                process_data=process_data,
            )

    @staticmethod
    def _get_request_timeout(node_data: HttpRequestNodeData) -> HttpRequestNodeTimeout:
        timeout = node_data.timeout
        if timeout is None:
            return HTTP_REQUEST_DEFAULT_TIMEOUT

        timeout.connect = timeout.connect or HTTP_REQUEST_DEFAULT_TIMEOUT.connect
        timeout.read = timeout.read or HTTP_REQUEST_DEFAULT_TIMEOUT.read
        timeout.write = timeout.write or HTTP_REQUEST_DEFAULT_TIMEOUT.write
        return timeout

    @classmethod
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: HttpRequestNodeData,
    ) -> Mapping[str, Sequence[str]]:
        selectors: list[VariableSelector] = []
        selectors += variable_template_parser.extract_selectors_from_template(node_data.url)
        selectors += variable_template_parser.extract_selectors_from_template(node_data.headers)
        selectors += variable_template_parser.extract_selectors_from_template(node_data.params)
        if node_data.body:
            body_type = node_data.body.type
            data = node_data.body.data
            match body_type:
                case "binary":
                    selector = data[0].file
                    selectors.append(VariableSelector(variable="#" + ".".join(selector) + "#", value_selector=selector))
                case "json" | "raw-text":
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
        for selector in selectors:
            mapping[node_id + "." + selector.variable] = selector.value_selector

        return mapping

    def extract_files(self, url: str, response: Response) -> list[File]:
        """
        Extract files from response
        """
        files = []
        is_file = response.is_file
        content_type = response.content_type
        content = response.content

        if is_file and content_type:
            tool_file = ToolFileManager.create_file_by_raw(
                user_id=self.user_id,
                tenant_id=self.tenant_id,
                conversation_id=None,
                file_binary=content,
                mimetype=content_type,
            )

            mapping = {
                "tool_file_id": tool_file.id,
                "transfer_method": FileTransferMethod.TOOL_FILE.value,
            }
            file = file_factory.build_from_mapping(
                mapping=mapping,
                tenant_id=self.tenant_id,
            )
            files.append(file)

        return files
