import time
from typing import Any

import httpx
import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.nodes.http_request import HTTP_REQUEST_CONFIG_FILTER_KEY, HttpRequestNode, HttpRequestNodeConfig
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


def test_get_default_config_without_filters_uses_literal_defaults():
    default_config = HttpRequestNode.get_default_config()
    timeout = default_config["config"]["timeout"]

    assert default_config["type"] == "http-request"
    assert timeout["connect"] == 10
    assert timeout["read"] == 600
    assert timeout["write"] == 600
    assert timeout["max_connect_timeout"] == 10
    assert timeout["max_read_timeout"] == 600
    assert timeout["max_write_timeout"] == 600
    assert default_config["config"]["ssl_verify"] is True
    assert default_config["retry_config"]["max_retries"] == 3


def test_get_default_config_uses_injected_http_request_config():
    custom_config = HttpRequestNodeConfig(
        max_connect_timeout=3,
        max_read_timeout=4,
        max_write_timeout=5,
        max_binary_size=1024,
        max_text_size=2048,
        ssl_verify=False,
        ssrf_default_max_retries=7,
    )

    default_config = HttpRequestNode.get_default_config(filters={HTTP_REQUEST_CONFIG_FILTER_KEY: custom_config})
    timeout = default_config["config"]["timeout"]

    assert timeout["connect"] == 3
    assert timeout["read"] == 4
    assert timeout["write"] == 5
    assert timeout["max_connect_timeout"] == 3
    assert timeout["max_read_timeout"] == 4
    assert timeout["max_write_timeout"] == 5
    assert default_config["config"]["ssl_verify"] is False
    assert default_config["retry_config"]["max_retries"] == 7


def test_get_default_config_with_malformed_http_request_config_raises_value_error():
    with pytest.raises(ValueError, match="http_request_config must be an HttpRequestNodeConfig instance"):
        HttpRequestNode.get_default_config(filters={HTTP_REQUEST_CONFIG_FILTER_KEY: "invalid"})


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
