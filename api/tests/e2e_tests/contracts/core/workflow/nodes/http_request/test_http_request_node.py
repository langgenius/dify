import time

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom, UserFrom
from core.helper.ssrf_proxy import graphon_ssrf_proxy
from core.workflow.graph_config import WorkflowGraphConfigDict
from core.workflow.http_request_default_config import HttpRequestDefaultBlockConfig
from core.workflow.node_runtime import DifyFileReferenceFactory, DifyToolFileManager
from core.workflow.system_variables import build_system_variables
from graphon.entities.graph_config import NodeConfigDict
from graphon.enums import BuiltinNodeTypes, WorkflowNodeExecutionStatus
from graphon.file.file_manager import file_manager
from graphon.http import HttpClientProtocol
from graphon.http.response import HttpResponse
from graphon.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNode, HttpRequestNodeConfig
from graphon.nodes.http_request.entities import (
    HttpRequestNodeAuthorization,
    HttpRequestNodeBody,
    HttpRequestNodeData,
    HttpRequestNodeTimeout,
    Response,
)
from graphon.nodes.protocols import FileManagerProtocol, ToolFileManagerProtocol
from graphon.nodes.start.entities import StartNodeData
from graphon.runtime import RuntimeState, VariablePool
from tests.workflow_test_utils import build_test_graph_init_params

HTTP_REQUEST_CONFIG = HttpRequestNodeConfig(
    max_connect_timeout=10,
    max_read_timeout=600,
    max_write_timeout=600,
    max_binary_size=10 * 1024 * 1024,
    max_text_size=1 * 1024 * 1024,
    ssl_verify=True,
    ssrf_default_max_retries=3,
)


def test_get_default_config_without_filters_uses_literal_defaults() -> None:
    default_config = HttpRequestDefaultBlockConfig.model_validate(HttpRequestNode.get_default_config())

    assert default_config.type == "http-request"
    assert default_config.config.timeout.connect == 10
    assert default_config.config.timeout.read == 600
    assert default_config.config.timeout.write == 600
    assert default_config.config.timeout.max_connect_timeout == 10
    assert default_config.config.timeout.max_read_timeout == 600
    assert default_config.config.timeout.max_write_timeout == 600
    assert default_config.config.ssl_verify is True
    assert default_config.retry_config.max_retries == 3


def test_get_default_config_uses_injected_http_request_config() -> None:
    custom_config = HttpRequestNodeConfig(
        max_connect_timeout=3,
        max_read_timeout=4,
        max_write_timeout=5,
        max_binary_size=1024,
        max_text_size=2048,
        ssl_verify=False,
        ssrf_default_max_retries=7,
    )

    default_config = HttpRequestDefaultBlockConfig.model_validate(
        HttpRequestNode.get_default_config(filters={HTTP_REQUEST_CONFIG_FILTER_KEY: custom_config})
    )

    assert default_config.config.timeout.connect == 3
    assert default_config.config.timeout.read == 4
    assert default_config.config.timeout.write == 5
    assert default_config.config.timeout.max_connect_timeout == 3
    assert default_config.config.timeout.max_read_timeout == 4
    assert default_config.config.timeout.max_write_timeout == 5
    assert default_config.config.ssl_verify is False
    assert default_config.retry_config.max_retries == 7


def test_get_default_config_with_malformed_http_request_config_raises_type_error() -> None:
    with pytest.raises(TypeError, match="http_request_config must be an HttpRequestNodeConfig instance"):
        HttpRequestNode.get_default_config(filters={HTTP_REQUEST_CONFIG_FILTER_KEY: "invalid"})


def _build_http_node(
    *, timeout: HttpRequestNodeTimeout | None = None, ssl_verify: bool | None = None
) -> HttpRequestNode:
    node_data = HttpRequestNodeData(
        title="HTTP request",
        method="get",
        url="http://example.com",
        authorization=HttpRequestNodeAuthorization(type="no-auth"),
        headers="",
        params="",
        body=HttpRequestNodeBody(type="none", data=[]),
        timeout=timeout,
        ssl_verify=ssl_verify,
    )

    graph_config = WorkflowGraphConfigDict(
        nodes=[
            NodeConfigDict(id="start", data=StartNodeData(type=BuiltinNodeTypes.START, title="Start")),
            NodeConfigDict(id="http-node", data=node_data),
        ],
        edges=[],
    )
    graph_init_params = build_test_graph_init_params(
        workflow_id="workflow",
        graph_config=graph_config,
        tenant_id="tenant",
        app_id="app",
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )
    # The node only stores this factory and calls it when it saves a downloaded file, which these tests never reach.

    def tool_file_manager_factory() -> ToolFileManagerProtocol:
        return DifyToolFileManager(graph_init_params.run_context)

    graph_runtime_state = RuntimeState(
        workflow_id="test-workflow",
        variable_pool=VariablePool.from_bootstrap(
            system_variables=build_system_variables(user_id="user", files=[]),
            user_inputs={},
        ),
        start_at=time.perf_counter(),
    )
    return HttpRequestNode(
        node_id="http-node",
        data=node_data,
        init_params=graph_init_params,
        runtime_state=graph_runtime_state,
        http_request_config=HTTP_REQUEST_CONFIG,
        http_client=graphon_ssrf_proxy,
        tool_file_manager_factory=tool_file_manager_factory,
        file_manager=file_manager,
        file_reference_factory=DifyFileReferenceFactory(graph_init_params.run_context),
    )


def test_get_request_timeout_returns_new_object_without_mutating_node_data() -> None:
    node = _build_http_node(timeout=HttpRequestNodeTimeout(connect=None, read=30, write=None))
    original_timeout = node.node_data.timeout

    assert original_timeout is not None
    resolved_timeout = node._get_request_timeout(node.node_data)

    assert resolved_timeout is not original_timeout
    assert original_timeout.connect is None
    assert original_timeout.read == 30
    assert original_timeout.write is None
    assert resolved_timeout == HttpRequestNodeTimeout(connect=10, read=30, write=600)


@pytest.mark.parametrize("ssl_verify", [None, False, True])
def test_run_passes_node_data_ssl_verify_to_executor(monkeypatch: pytest.MonkeyPatch, ssl_verify: bool | None) -> None:
    node = _build_http_node(ssl_verify=ssl_verify)
    captured: dict[str, bool | None] = {}

    class FakeExecutor:
        def __init__(
            self,
            *,
            node_data: HttpRequestNodeData,
            timeout: HttpRequestNodeTimeout,
            variable_pool: VariablePool,
            http_request_config: HttpRequestNodeConfig,
            max_retries: int | None = None,
            ssl_verify: bool | None = None,
            http_client: HttpClientProtocol,
            file_manager: FileManagerProtocol,
        ) -> None:
            del node_data, timeout, variable_pool, http_request_config, max_retries, http_client, file_manager
            captured["ssl_verify"] = ssl_verify
            self.url = "http://example.com"

        def to_log(self) -> str:
            return "request-log"

        def invoke(self) -> Response:
            return Response(
                HttpResponse(
                    status_code=200,
                    content=b"ok",
                    headers={"content-type": "text/plain"},
                    url="http://example.com",
                )
            )

    monkeypatch.setattr("graphon.nodes.http_request.node.Executor", FakeExecutor)

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert captured["ssl_verify"] is ssl_verify
