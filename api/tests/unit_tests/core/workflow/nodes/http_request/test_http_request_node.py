import time
from typing import Any

import httpx
import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.http_request import HttpRequestNode, HttpRequestNodeConfig
from core.workflow.nodes.http_request.entities import HttpRequestNodeTimeout, Response
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom

HTTP_REQUEST_CONFIG = HttpRequestNodeConfig(
    max_connect_timeout=10,
    max_read_timeout=600,
    max_write_timeout=600,
    max_binary_size=10 * 1024 * 1024,
    max_text_size=1 * 1024 * 1024,
    ssl_verify=True,
    ssrf_default_max_retries=3,
)


def _build_http_node(
    *, timeout: dict[str, int | None] | None = None, ssl_verify: bool | None = None
) -> HttpRequestNode:
    node_data: dict[str, Any] = {
        "type": "http-request",
        "title": "HTTP request",
        "method": "get",
        "url": "http://example.com",
        "authorization": {"type": "no-auth"},
        "headers": "",
        "params": "",
        "body": {"type": "none", "data": []},
    }
    if timeout is not None:
        node_data["timeout"] = timeout
    node_data["ssl_verify"] = ssl_verify

    node_config: dict[str, Any] = {
        "id": "http-node",
        "data": node_data,
    }
    graph_config = {
        "nodes": [
            {"id": "start", "data": {"type": "start", "title": "Start"}},
            node_config,
        ],
        "edges": [],
    }
    graph_init_params = GraphInitParams(
        tenant_id="tenant",
        app_id="app",
        workflow_id="workflow",
        graph_config=graph_config,
        user_id="user",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )
    graph_runtime_state = GraphRuntimeState(
        variable_pool=VariablePool(system_variables=SystemVariable(user_id="user", files=[]), user_inputs={}),
        start_at=time.perf_counter(),
    )
    return HttpRequestNode(
        id="http-node",
        config=node_config,
        graph_init_params=graph_init_params,
        graph_runtime_state=graph_runtime_state,
        http_request_config=HTTP_REQUEST_CONFIG,
    )


def test_get_request_timeout_returns_new_object_without_mutating_node_data():
    node = _build_http_node(timeout={"connect": None, "read": 30, "write": None})
    original_timeout = node.node_data.timeout

    assert original_timeout is not None
    resolved_timeout = node._get_request_timeout(node.node_data)

    assert resolved_timeout is not original_timeout
    assert original_timeout.connect is None
    assert original_timeout.read == 30
    assert original_timeout.write is None
    assert resolved_timeout == HttpRequestNodeTimeout(connect=10, read=30, write=600)


@pytest.mark.parametrize("ssl_verify", [None, False, True])
def test_run_passes_node_data_ssl_verify_to_executor(monkeypatch: pytest.MonkeyPatch, ssl_verify: bool | None):
    node = _build_http_node(ssl_verify=ssl_verify)
    captured: dict[str, bool | None] = {}

    class FakeExecutor:
        def __init__(self, *, ssl_verify: bool | None, **kwargs: Any):
            captured["ssl_verify"] = ssl_verify
            self.url = "http://example.com"

        def to_log(self) -> str:
            return "request-log"

        def invoke(self) -> Response:
            return Response(
                httpx.Response(
                    status_code=200,
                    content=b"ok",
                    headers={"content-type": "text/plain"},
                    request=httpx.Request("GET", "http://example.com"),
                )
            )

    monkeypatch.setattr("core.workflow.nodes.http_request.node.Executor", FakeExecutor)

    result = node._run()

    assert result.status == WorkflowNodeExecutionStatus.SUCCEEDED
    assert captured["ssl_verify"] is ssl_verify
