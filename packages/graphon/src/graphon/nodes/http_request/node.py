from __future__ import annotations

import logging
import mimetypes
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, assert_never, cast, override

from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.file.enums import FileTransferMethod
from graphon.file.models import File
from graphon.http import HttpClientProtocol, HttpxHttpClient
from graphon.node_events.base import NodeRunResult
from graphon.nodes.base import variable_template_parser
from graphon.nodes.base.entities import VariableSelector
from graphon.nodes.base.node import Node
from graphon.nodes.http_request.executor import Executor
from graphon.nodes.protocols import (
    FileManagerProtocol,
    FileReferenceFactoryProtocol,
    ToolFileManagerProtocol,
)
from graphon.runtime.init_params import InitParams
from graphon.runtime.runtime_state import RuntimeState
from graphon.variables.segments import ArrayFileSegment

from .config import build_http_request_config, resolve_http_request_config
from .entities import (
    HTTP_REQUEST_CONFIG_FILTER_KEY,
    BodyData,
    HttpRequestNodeConfig,
    HttpRequestNodeData,
    HttpRequestNodeTimeout,
    Response,
)
from .exc import HttpRequestNodeError, RequestBodyError

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class HttpRequestNodeDependencies:
    """Runtime collaborators required by ``HttpRequestNode``."""

    tool_file_manager_factory: Callable[[], ToolFileManagerProtocol]
    file_manager: FileManagerProtocol
    file_reference_factory: FileReferenceFactoryProtocol
    http_client: HttpClientProtocol | None = None


class HttpRequestNode(Node[HttpRequestNodeData]):
    node_type = BuiltinNodeTypes.HTTP_REQUEST

    @override
    def __init__(
        self,
        node_id: str,
        data: HttpRequestNodeData,
        *,
        init_params: InitParams,
        runtime_state: RuntimeState,
        http_request_config: HttpRequestNodeConfig,
        dependencies: HttpRequestNodeDependencies | None = None,
        http_client: HttpClientProtocol | None = None,
        tool_file_manager_factory: Callable[[], ToolFileManagerProtocol] | None = None,
        file_manager: FileManagerProtocol | None = None,
        file_reference_factory: FileReferenceFactoryProtocol | None = None,
    ) -> None:
        super().__init__(
            node_id=node_id,
            data=data,
            init_params=init_params,
            runtime_state=runtime_state,
        )
        resolved_dependencies = self._resolve_dependencies(
            dependencies=dependencies,
            http_client=http_client,
            tool_file_manager_factory=tool_file_manager_factory,
            file_manager=file_manager,
            file_reference_factory=file_reference_factory,
        )
        self._http_request_config = http_request_config
        self._http_client = (
            resolved_dependencies.http_client
            if resolved_dependencies.http_client is not None
            else HttpxHttpClient()
        )
        self._tool_file_manager_factory = (
            resolved_dependencies.tool_file_manager_factory
        )
        self._file_manager = resolved_dependencies.file_manager
        self._file_reference_factory = resolved_dependencies.file_reference_factory

    @staticmethod
    def _resolve_dependencies(
        *,
        dependencies: HttpRequestNodeDependencies | None,
        http_client: HttpClientProtocol | None,
        tool_file_manager_factory: Callable[[], ToolFileManagerProtocol] | None,
        file_manager: FileManagerProtocol | None,
        file_reference_factory: FileReferenceFactoryProtocol | None,
    ) -> HttpRequestNodeDependencies:
        legacy_dependencies = {
            "http_client": http_client,
            "tool_file_manager_factory": tool_file_manager_factory,
            "file_manager": file_manager,
            "file_reference_factory": file_reference_factory,
        }
        if dependencies is not None:
            mixed_inputs = sorted(
                name for name, value in legacy_dependencies.items() if value is not None
            )
            if mixed_inputs:
                msg = (
                    "HttpRequestNode accepts either dependencies=... or legacy "
                    f"dependency keywords, not both: {', '.join(mixed_inputs)}"
                )
                raise TypeError(msg)
            return dependencies

        missing_dependencies = [
            name
            for name, value in legacy_dependencies.items()
            if name != "http_client" and value is None
        ]
        if missing_dependencies:
            msg = (
                "HttpRequestNode requires dependencies=... or legacy dependency "
                f"keywords for: {', '.join(missing_dependencies)}"
            )
            raise TypeError(msg)

        return HttpRequestNodeDependencies(
            tool_file_manager_factory=cast(
                Callable[[], ToolFileManagerProtocol],
                tool_file_manager_factory,
            ),
            file_manager=cast(FileManagerProtocol, file_manager),
            file_reference_factory=cast(
                FileReferenceFactoryProtocol,
                file_reference_factory,
            ),
            http_client=http_client,
        )

    @property
    def http_client(self) -> HttpClientProtocol:
        """Return the HTTP client used by this node."""
        return self._http_client

    @classmethod
    @override
    def get_default_config(
        cls,
        filters: Mapping[str, object] | None = None,
    ) -> Mapping[str, object]:
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
    @override
    def version(cls) -> str:
        return "1"

    @override
    def _run(self) -> NodeRunResult:
        process_data = {}
        try:
            http_executor = Executor(
                node_data=self.node_data,
                timeout=self._get_request_timeout(self.node_data),
                variable_pool=self.runtime_state.variable_pool,
                http_request_config=self._http_request_config,
                # Must be 0 to disable executor-level retries,
                # as the engine handles them.
                # This is critical to prevent nested retries.
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

    def _get_request_timeout(
        self,
        node_data: HttpRequestNodeData,
    ) -> HttpRequestNodeTimeout:
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
    @override
    def _extract_variable_selector_to_variable_mapping(
        cls,
        *,
        graph_config: Mapping[str, Any],
        node_id: str,
        node_data: HttpRequestNodeData,
    ) -> Mapping[str, Sequence[str]]:
        _ = graph_config
        selectors = cls._extract_template_selectors(
            node_data.url,
            node_data.headers,
            node_data.params,
        )
        selectors.extend(cls._extract_body_selectors(node_data))
        return {
            node_id + "." + selector.variable: selector.value_selector
            for selector in selectors
        }

    @staticmethod
    def _extract_template_selectors(*templates: str) -> list[VariableSelector]:
        selectors: list[VariableSelector] = []
        for template in templates:
            selectors.extend(
                variable_template_parser.extract_selectors_from_template(template),
            )
        return selectors

    @classmethod
    def _extract_body_selectors(
        cls,
        node_data: HttpRequestNodeData,
    ) -> list[VariableSelector]:
        if node_data.body is None or node_data.body.type == "none":
            return []
        body_type = node_data.body.type
        match body_type:
            case "binary":
                selectors = cls._extract_binary_body_selectors(node_data.body.data)
            case "json" | "raw-text":
                selectors = cls._extract_template_body_selectors(node_data.body.data)
            case "x-www-form-urlencoded":
                selectors = cls._extract_key_value_body_selectors(node_data.body.data)
            case "form-data":
                selectors = cls._extract_form_data_body_selectors(node_data.body.data)
            case _:
                assert_never(body_type)
        return selectors

    @staticmethod
    def _build_file_selector(selector: Sequence[str]) -> VariableSelector:
        return VariableSelector(
            variable="#" + ".".join(selector) + "#",
            value_selector=selector,
        )

    @classmethod
    def _extract_binary_body_selectors(
        cls,
        data: Sequence[BodyData],
    ) -> list[VariableSelector]:
        if len(data) != 1:
            msg = "invalid body data, should have only one item"
            raise RequestBodyError(msg)
        return [cls._build_file_selector(data[0].file)]

    @classmethod
    def _extract_template_body_selectors(
        cls,
        data: Sequence[BodyData],
    ) -> list[VariableSelector]:
        if len(data) != 1:
            msg = "invalid body data, should have only one item"
            raise RequestBodyError(msg)
        return cls._extract_template_selectors(data[0].key, data[0].value)

    @classmethod
    def _extract_key_value_body_selectors(
        cls,
        data: Sequence[BodyData],
    ) -> list[VariableSelector]:
        selectors: list[VariableSelector] = []
        for item in data:
            selectors.extend(cls._extract_template_selectors(item.key, item.value))
        return selectors

    @classmethod
    def _extract_form_data_body_selectors(
        cls,
        data: Sequence[BodyData],
    ) -> list[VariableSelector]:
        selectors: list[VariableSelector] = []
        for item in data:
            selectors.extend(cls._extract_template_selectors(item.key))
            if item.type == "text":
                selectors.extend(cls._extract_template_selectors(item.value))
                continue
            selectors.append(cls._build_file_selector(item.file))
        return selectors

    def extract_files(self, url: str, response: Response) -> ArrayFileSegment:
        """Extract files from response by checking both Content-Type header and URL"""
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
                # If filename is available from content-disposition,
                # use it to guess the content type
                content_disposition_type = mimetypes.guess_type(
                    content_disposition_filename,
                )[0]

        # Guess file extension from URL or Content-Type header
        filename = url.split("?", maxsplit=1)[0].rsplit("/", maxsplit=1)[-1] or ""
        mime_type = (
            content_disposition_type
            or content_type
            or mimetypes.guess_type(filename)[0]
            or "application/octet-stream"
        )
        tool_file_manager = self._tool_file_manager_factory()

        tool_file = tool_file_manager.create_file_by_raw(
            file_binary=content,
            mimetype=mime_type,
        )

        file = self._file_reference_factory.build_from_mapping(
            mapping={
                "tool_file_id": tool_file.id,
                "transfer_method": FileTransferMethod.TOOL_FILE,
            },
        )
        files.append(file)

        return ArrayFileSegment(value=files)

    @property
    def retry(self) -> bool:
        return self.node_data.retry_config.retry_enabled
