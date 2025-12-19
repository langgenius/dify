from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity
from tests.integration_tests.tools.__mock.http import setup_http_mock

tool_bundle = {
    "server_url": "http://www.example.com/{path_param}",
    "method": "post",
    "author": "",
    "openapi": {
        "parameters": [
            {"in": "path", "name": "path_param"},
            {"in": "query", "name": "query_param"},
            {"in": "cookie", "name": "cookie_param"},
            {"in": "header", "name": "header_param"},
        ],
        "requestBody": {
            "content": {"application/json": {"schema": {"properties": {"body_param": {"type": "string"}}}}}
        },
    },
    "parameters": [],
}
parameters = {
    "path_param": "p_param",
    "query_param": "q_param",
    "cookie_param": "c_param",
    "header_param": "h_param",
    "body_param": "b_param",
}


def test_api_tool(setup_http_mock):
    tool = ApiTool(
        entity=ToolEntity(
            identity=ToolIdentity(provider="", author="", name="", label=I18nObject(en_US="test tool")),
        ),
        api_bundle=ApiToolBundle.model_validate(tool_bundle),
        runtime=ToolRuntime(tenant_id="", credentials={"auth_type": "none"}),
        provider_id="test_tool",
    )
    headers = tool.assembling_request(parameters)
    response = tool.do_http_request(tool.api_bundle.server_url, tool.api_bundle.method, headers, parameters)

    assert response.status_code == 200
    assert response.request.url.path == "/p_param"
    assert response.request.url.query == b"query_param=q_param"
    assert response.request.headers.get("header_param") == "h_param"
    assert response.request.headers.get("content-type") == "application/json"
    assert response.request.headers.get("cookie") == "cookie_param=c_param"
    assert "b_param" in response.content.decode()
