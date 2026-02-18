import time
import uuid
from urllib.parse import urlencode

import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.workflow.node_factory import DifyNodeFactory
from core.workflow.entities import GraphInitParams
from core.workflow.enums import WorkflowNodeExecutionStatus
from core.workflow.graph import Graph
from core.workflow.nodes.http_request.node import HttpRequestNode
from core.workflow.runtime import GraphRuntimeState, VariablePool
from core.workflow.system_variable import SystemVariable
from models.enums import UserFrom
from tests.integration_tests.workflow.nodes.__mock.http import setup_http_mock


def init_http_node(config: dict):
    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "1",
            },
        ],
        "nodes": [{"data": {"type": "start", "title": "Start"}, "id": "start"}, config],
    }

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # construct variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["a", "args1"], 1)
    variable_pool.add(["a", "args2"], 2)

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node = HttpRequestNode(
        id=str(uuid.uuid4()),
        config=config,
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    return node


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_get(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "ak-xxx",
                        "header": "api-key",
                    },
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": None,
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert "?A=b" in data
    assert "X-Header: 123" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_no_auth(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "no-auth",
                    "config": None,
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": None,
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert "?A=b" in data
    assert "X-Header: 123" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_custom_authorization_header(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "custom",
                        "api_key": "Auth",
                        "header": "X-Auth",
                    },
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": None,
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert "?A=b" in data
    assert "X-Header: 123" in data
    # Custom authorization header should be set (may be masked)
    assert "X-Auth:" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_custom_auth_with_empty_api_key_raises_error(setup_http_mock):
    """Test: In custom authentication mode, when the api_key is empty, AuthorizationConfigError should be raised."""
    from core.workflow.nodes.http_request.entities import (
        HttpRequestNodeAuthorization,
        HttpRequestNodeData,
        HttpRequestNodeTimeout,
    )
    from core.workflow.nodes.http_request.exc import AuthorizationConfigError
    from core.workflow.nodes.http_request.executor import Executor
    from core.workflow.runtime import VariablePool
    from core.workflow.system_variable import SystemVariable

    # Create variable pool
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="test", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )

    # Create node data with custom auth and empty api_key
    node_data = HttpRequestNodeData(
        title="http",
        desc="",
        url="http://example.com",
        method="get",
        authorization=HttpRequestNodeAuthorization(
            type="api-key",
            config={
                "type": "custom",
                "api_key": "",  # Empty api_key
                "header": "X-Custom-Auth",
            },
        ),
        headers="",
        params="",
        body=None,
        ssl_verify=True,
    )

    # Create executor should raise AuthorizationConfigError
    with pytest.raises(AuthorizationConfigError, match="API key is required"):
        Executor(
            node_data=node_data,
            timeout=HttpRequestNodeTimeout(connect=10, read=30, write=10),
            variable_pool=variable_pool,
        )


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_bearer_authorization_with_custom_header_ignored(setup_http_mock):
    """
    Test that when switching from custom to bearer authorization,
    the custom header settings don't interfere with bearer token.
    This test verifies the fix for issue #23554.
    """
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "bearer",
                        "api_key": "test-token",
                        "header": "",  # Empty header - should default to Authorization
                    },
                },
                "headers": "",
                "params": "",
                "body": None,
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    # In bearer mode, should use Authorization header (value is masked with *)
    assert "Authorization: " in data
    # Should contain masked Bearer token
    assert "*" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_basic_authorization_with_custom_header_ignored(setup_http_mock):
    """
    Test that when switching from custom to basic authorization,
    the custom header settings don't interfere with basic auth.
    This test verifies the fix for issue #23554.
    """
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "user:pass",
                        "header": "",  # Empty header - should default to Authorization
                    },
                },
                "headers": "",
                "params": "",
                "body": None,
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    # In basic mode, should use Authorization header (value is masked with *)
    assert "Authorization: " in data
    # Should contain masked Basic credentials
    assert "*" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_custom_authorization_with_empty_api_key(setup_http_mock):
    """
    Test that custom authorization raises error when api_key is empty.
    This test verifies the fix for issue #21830.
    """

    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "custom",
                        "api_key": "",  # Empty api_key
                        "header": "X-Custom-Auth",
                    },
                },
                "headers": "",
                "params": "",
                "body": None,
            },
        }
    )

    result = node._run()
    # Should fail with AuthorizationConfigError
    assert result.status == WorkflowNodeExecutionStatus.FAILED
    assert "API key is required" in result.error
    assert result.error_type == "AuthorizationConfigError"


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_template(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com/{{#a.args2#}}",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "ak-xxx",
                        "header": "api-key",
                    },
                },
                "headers": "X-Header:123\nX-Header2:{{#a.args2#}}",
                "params": "A:b\nTemplate:{{#a.args2#}}",
                "body": None,
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert "?A=b" in data
    assert "Template=2" in data
    assert "X-Header: 123" in data
    assert "X-Header2: 2" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_json(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "post",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "ak-xxx",
                        "header": "api-key",
                    },
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": {
                    "type": "json",
                    "data": [
                        {
                            "key": "",
                            "type": "text",
                            "value": '{"a": "{{#a.args1#}}"}',
                        },
                    ],
                },
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert '{"a": "1"}' in data
    assert "X-Header: 123" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_x_www_form_urlencoded(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "post",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "ak-xxx",
                        "header": "api-key",
                    },
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": {
                    "type": "x-www-form-urlencoded",
                    "data": [
                        {
                            "key": "a",
                            "type": "text",
                            "value": "{{#a.args1#}}",
                        },
                        {
                            "key": "b",
                            "type": "text",
                            "value": "{{#a.args2#}}",
                        },
                    ],
                },
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert "a=1&b=2" in data
    assert "X-Header: 123" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_form_data(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "post",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "ak-xxx",
                        "header": "api-key",
                    },
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": {
                    "type": "form-data",
                    "data": [
                        {
                            "key": "a",
                            "type": "text",
                            "value": "{{#a.args1#}}",
                        },
                        {
                            "key": "b",
                            "type": "text",
                            "value": "{{#a.args2#}}",
                        },
                    ],
                },
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert 'form-data; name="a"' in data
    assert "1" in data
    assert 'form-data; name="b"' in data
    assert "2" in data
    assert "X-Header: 123" in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_none_data(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "post",
                "url": "http://example.com",
                "authorization": {
                    "type": "api-key",
                    "config": {
                        "type": "basic",
                        "api_key": "ak-xxx",
                        "header": "api-key",
                    },
                },
                "headers": "X-Header:123",
                "params": "A:b",
                "body": {"type": "none", "data": []},
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    assert "X-Header: 123" in data
    assert "123123123" not in data


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_mock_404(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://404.com",
                "authorization": {
                    "type": "no-auth",
                    "config": None,
                },
                "body": None,
                "params": "",
                "headers": "X-Header:123",
            },
        }
    )

    result = node._run()
    assert result.outputs is not None
    resp = result.outputs

    assert resp.get("status_code") == 404
    assert "Not Found" in resp.get("body", "")


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_multi_colons_parse(setup_http_mock):
    node = init_http_node(
        config={
            "id": "1",
            "data": {
                "type": "http-request",
                "title": "http",
                "desc": "",
                "method": "get",
                "url": "http://example.com",
                "authorization": {
                    "type": "no-auth",
                    "config": None,
                },
                "params": "Referer:http://example1.com\nRedirect:http://example2.com",
                "headers": "Referer:http://example3.com\nRedirect:http://example4.com",
                "body": {
                    "type": "form-data",
                    "data": [
                        {
                            "key": "Referer",
                            "type": "text",
                            "value": "http://example5.com",
                        },
                        {
                            "key": "Redirect",
                            "type": "text",
                            "value": "http://example6.com",
                        },
                    ],
                },
            },
        }
    )

    result = node._run()
    assert result.process_data is not None
    assert result.outputs is not None

    assert urlencode({"Redirect": "http://example2.com"}) in result.process_data.get("request", "")
    assert 'form-data; name="Redirect"\r\n\r\nhttp://example6.com' in result.process_data.get("request", "")
    # resp = result.outputs
    # assert "http://example3.com" == resp.get("headers", {}).get("referer")


@pytest.mark.parametrize("setup_http_mock", [["none"]], indirect=True)
def test_nested_object_variable_selector(setup_http_mock):
    """Test variable selector functionality with nested object properties."""
    # Create independent test setup without affecting other tests
    graph_config = {
        "edges": [
            {
                "id": "start-source-next-target",
                "source": "start",
                "target": "1",
            },
        ],
        "nodes": [
            {"data": {"type": "start", "title": "Start"}, "id": "start"},
            {
                "id": "1",
                "data": {
                    "type": "http-request",
                    "title": "http",
                    "desc": "",
                    "method": "get",
                    "url": "http://example.com/{{#a.args2#}}/{{#a.args3.nested#}}",
                    "authorization": {
                        "type": "api-key",
                        "config": {
                            "type": "basic",
                            "api_key": "ak-xxx",
                            "header": "api-key",
                        },
                    },
                    "headers": "X-Header:{{#a.args3.nested#}}",
                    "params": "nested_param:{{#a.args3.nested#}}",
                    "body": None,
                },
            },
        ],
    }

    init_params = GraphInitParams(
        tenant_id="1",
        app_id="1",
        workflow_id="1",
        graph_config=graph_config,
        user_id="1",
        user_from=UserFrom.ACCOUNT,
        invoke_from=InvokeFrom.DEBUGGER,
        call_depth=0,
    )

    # Create independent variable pool for this test only
    variable_pool = VariablePool(
        system_variables=SystemVariable(user_id="aaa", files=[]),
        user_inputs={},
        environment_variables=[],
        conversation_variables=[],
    )
    variable_pool.add(["a", "args1"], 1)
    variable_pool.add(["a", "args2"], 2)
    variable_pool.add(["a", "args3"], {"nested": "nested_value"})  # Only for this test

    graph_runtime_state = GraphRuntimeState(variable_pool=variable_pool, start_at=time.perf_counter())

    # Create node factory
    node_factory = DifyNodeFactory(
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    graph = Graph.init(graph_config=graph_config, node_factory=node_factory)

    node = HttpRequestNode(
        id=str(uuid.uuid4()),
        config=graph_config["nodes"][1],
        graph_init_params=init_params,
        graph_runtime_state=graph_runtime_state,
    )

    result = node._run()
    assert result.process_data is not None
    data = result.process_data.get("request", "")

    # Verify nested object property is correctly resolved
    assert "/2/nested_value" in data  # URL path should contain resolved nested value
    assert "X-Header: nested_value" in data  # Header should contain nested value
    assert "nested_param=nested_value" in data  # Param should contain nested value
