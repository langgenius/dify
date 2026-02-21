from __future__ import annotations

from types import SimpleNamespace

import httpx
import pytest

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.custom_tool.tool import ApiTool, ParsedResponse
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import ToolEntity, ToolIdentity, ToolInvokeMessage
from core.tools.errors import ToolInvokeError, ToolParameterValidationError, ToolProviderCredentialValidationError


def _build_tool(*, openapi: dict | None = None) -> ApiTool:
    entity = ToolEntity(
        identity=ToolIdentity(
            author="author",
            name="tool-a",
            label=I18nObject(en_US="tool-a"),
            provider="provider-a",
        ),
        parameters=[],
    )
    bundle = ApiToolBundle(
        server_url="https://api.example.com/items/{id}",
        method="GET",
        summary="summary",
        operation_id="op-id",
        parameters=[],
        author="author",
        openapi=openapi or {"parameters": []},
    )
    runtime = ToolRuntime(
        tenant_id="tenant-1",
        invoke_from=InvokeFrom.DEBUGGER,
        credentials={"auth_type": "api_key_header", "api_key_value": "k"},
    )
    return ApiTool(entity=entity, api_bundle=bundle, runtime=runtime, provider_id="provider-id")


def test_parsed_response_to_string():
    assert ParsedResponse({"a": 1}, True).to_string() == '{"a": 1}'
    assert ParsedResponse("ok", False).to_string() == "ok"


def test_api_tool_fork_runtime_and_validate_credentials(monkeypatch):
    tool = _build_tool()
    forked = tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2"))
    assert isinstance(forked, ApiTool)
    assert forked.runtime.tenant_id == "tenant-2"

    tool.api_bundle = None  # type: ignore[assignment]
    with pytest.raises(ValueError, match="api_bundle is required"):
        tool.fork_tool_runtime(ToolRuntime(tenant_id="tenant-2"))

    tool = _build_tool()
    assert tool.validate_credentials(credentials={}, parameters={}, format_only=True) == ""
    monkeypatch.setattr(tool, "assembling_request", lambda parameters: {"Authorization": "Bearer x"})
    monkeypatch.setattr(
        tool,
        "do_http_request",
        lambda url, method, headers, parameters: httpx.Response(200, json={"ok": True}),
    )
    result = tool.validate_credentials(credentials={}, parameters={"a": 1}, format_only=False)
    assert result == '{"ok": true}'


def test_assembling_request_auth_header_assembly():
    tool = _build_tool()

    headers = tool.assembling_request(parameters={})
    assert headers["Authorization"] == "k"

    tool.runtime.credentials = {
        "auth_type": "api_key_header",
        "api_key_header_prefix": "bearer",
        "api_key_value": "abc",
    }
    headers = tool.assembling_request(parameters={})
    assert headers["Authorization"] == "Bearer abc"

    tool.runtime.credentials = {"auth_type": "api_key_header", "api_key_header_prefix": "basic", "api_key_value": "abc"}
    headers = tool.assembling_request(parameters={})
    assert headers["Authorization"] == "Basic abc"

    tool.runtime.credentials = {"auth_type": "api_key_query", "api_key_value": "abc"}
    assert tool.assembling_request(parameters={}) == {}


def test_assembling_request_runtime_auth_errors():
    tool = _build_tool()

    tool.runtime = None
    with pytest.raises(ToolProviderCredentialValidationError, match="runtime not initialized"):
        tool.assembling_request(parameters={})

    tool.runtime = ToolRuntime(tenant_id="tenant", credentials={})
    with pytest.raises(ToolProviderCredentialValidationError, match="Missing auth_type"):
        tool.assembling_request(parameters={})

    tool.runtime.credentials = {"auth_type": "api_key_header"}
    with pytest.raises(ToolProviderCredentialValidationError, match="Missing api_key_value"):
        tool.assembling_request(parameters={})

    tool.runtime.credentials = {"auth_type": "api_key_header", "api_key_value": 123}
    with pytest.raises(ToolProviderCredentialValidationError, match="must be a string"):
        tool.assembling_request(parameters={})


def test_assembling_request_parameter_validation_and_defaults():
    tool = _build_tool()

    tool.runtime.credentials = {"auth_type": "api_key_header", "api_key_value": "x"}
    tool.api_bundle.parameters = [
        SimpleNamespace(required=True, name="required_param", default=None),
    ]
    with pytest.raises(ToolParameterValidationError, match="Missing required parameter required_param"):
        tool.assembling_request(parameters={})

    tool.api_bundle.parameters = [
        SimpleNamespace(required=True, name="required_param", default="d"),
    ]
    params = {}
    tool.assembling_request(parameters=params)
    assert params["required_param"] == "d"


def test_validate_and_parse_response_branches():
    tool = _build_tool()

    with pytest.raises(ToolInvokeError, match="status code 500"):
        tool.validate_and_parse_response(httpx.Response(500, text="boom"))

    empty = tool.validate_and_parse_response(httpx.Response(200, content=b""))
    assert empty.is_json is False
    assert "Empty response from the tool" in str(empty.content)

    json_resp = tool.validate_and_parse_response(
        httpx.Response(200, json={"a": 1}, headers={"content-type": "application/json"})
    )
    assert json_resp.is_json is True
    assert json_resp.content == {"a": 1}

    non_json_type = tool.validate_and_parse_response(
        httpx.Response(200, text='{"a": 1}', headers={"content-type": "text/plain"})
    )
    assert non_json_type.is_json is False
    assert non_json_type.content == '{"a": 1}'

    plain_resp = tool.validate_and_parse_response(httpx.Response(200, text="plain"))
    assert plain_resp.is_json is False
    assert plain_resp.content == "plain"

    with pytest.raises(ValueError, match="Invalid response type"):
        tool.validate_and_parse_response("invalid")  # type: ignore[arg-type]


def test_get_parameter_value_and_type_conversion_helpers():
    tool = _build_tool()

    assert tool.get_parameter_value({"name": "x"}, {"x": 1}) == 1
    assert tool.get_parameter_value({"name": "x", "required": False, "schema": {"default": "d"}}, {}) == "d"
    with pytest.raises(ToolParameterValidationError, match="Missing required parameter x"):
        tool.get_parameter_value({"name": "x", "required": True}, {})

    assert tool._convert_body_property_any_of({}, "12", [{"type": "integer"}]) == 12
    assert tool._convert_body_property_any_of({}, "1.5", [{"type": "number"}]) == 1.5
    assert tool._convert_body_property_any_of({}, "true", [{"type": "boolean"}]) is True
    assert tool._convert_body_property_any_of({}, "", [{"type": "null"}]) is None
    assert tool._convert_body_property_any_of({}, "x", [{"anyOf": [{"type": "string"}]}]) == "x"

    assert tool._convert_body_property_type({"type": "integer"}, "1") == 1
    assert tool._convert_body_property_type({"type": "number"}, "1.2") == 1.2
    assert tool._convert_body_property_type({"type": "string"}, 1) == "1"
    assert tool._convert_body_property_type({"type": "boolean"}, 1) is True
    assert tool._convert_body_property_type({"type": "null"}, None) is None
    assert tool._convert_body_property_type({"type": "object"}, '{"a":1}') == {"a": 1}
    assert tool._convert_body_property_type({"type": "array"}, "[1,2]") == [1, 2]
    assert tool._convert_body_property_type({"type": "invalid"}, "v") == "v"
    assert tool._convert_body_property_type({"anyOf": [{"type": "integer"}]}, "2") == 2


def test_do_http_request_builds_arguments_and_handles_invalid_method(monkeypatch):
    openapi = {
        "parameters": [
            {"name": "id", "in": "path", "required": True, "schema": {"type": "string"}},
            {"name": "q", "in": "query", "required": False, "schema": {"default": ""}},
            {"name": "X-Extra", "in": "header", "required": False, "schema": {"default": "x"}},
            {"name": "sid", "in": "cookie", "required": False, "schema": {"default": "cookie1"}},
        ],
        "requestBody": {
            "content": {
                "application/json": {
                    "schema": {
                        "type": "object",
                        "required": ["count"],
                        "properties": {
                            "count": {"type": "integer"},
                            "name": {"type": "string", "default": "n"},
                        },
                    }
                }
            }
        },
    }
    tool = _build_tool(openapi=openapi)
    tool.runtime.credentials = {"auth_type": "api_key_query", "api_key_query_param": "key", "api_key_value": "v"}
    headers = {}
    captured = {}

    def _fake_get(url, **kwargs):
        captured["url"] = url
        captured["kwargs"] = kwargs
        return httpx.Response(200, text="ok")

    monkeypatch.setattr("core.tools.custom_tool.tool.ssrf_proxy.get", _fake_get)
    response = tool.do_http_request(
        "https://api.example.com/items/{id}",
        "GET",
        headers=headers,
        parameters={"id": "123", "count": "2", "q": "search"},
    )

    assert isinstance(response, httpx.Response)
    assert captured["url"].endswith("/items/123")
    assert captured["kwargs"]["params"]["q"] == "search"
    assert captured["kwargs"]["params"]["key"] == "v"
    assert captured["kwargs"]["headers"]["Content-Type"] == "application/json"

    invalid_method_tool = _build_tool(openapi={"parameters": []})
    with pytest.raises(ValueError, match="Invalid http method"):
        invalid_method_tool.do_http_request("https://api.example.com", "TRACE", headers={}, parameters={})


def test_do_http_request_handles_file_upload_and_invoke_paths(monkeypatch):
    openapi = {
        "parameters": [],
        "requestBody": {
            "content": {
                "multipart/form-data": {
                    "schema": {
                        "type": "object",
                        "properties": {"file": {"format": "binary"}},
                    }
                }
            }
        },
    }
    tool = _build_tool(openapi=openapi)
    tool.runtime.credentials = {"auth_type": "api_key_header", "api_key_value": "k"}
    fake_file = SimpleNamespace(filename="a.txt", mime_type="text/plain")
    captured = {}

    def _fake_post(url, **kwargs):
        captured["headers"] = kwargs["headers"]
        captured["files"] = kwargs["files"]
        return httpx.Response(200, text="ok")

    monkeypatch.setattr("core.tools.custom_tool.tool.download", lambda _: b"file-bytes")
    monkeypatch.setattr("core.tools.custom_tool.tool.ssrf_proxy.post", _fake_post)
    response = tool.do_http_request(
        "https://api.example.com/upload",
        "POST",
        headers={},
        parameters={"file": fake_file},
    )
    assert isinstance(response, httpx.Response)
    assert "Content-Type" not in captured["headers"]
    assert captured["files"][0][0] == "file"

    # _invoke JSON path
    monkeypatch.setattr(tool, "assembling_request", lambda parameters: {})
    monkeypatch.setattr(tool, "do_http_request", lambda *args, **kwargs: httpx.Response(200, text='{"a":1}'))
    monkeypatch.setattr(tool, "validate_and_parse_response", lambda _: ParsedResponse({"a": 1}, True))
    messages = list(tool.invoke(user_id="u1", tool_parameters={}))
    assert [m.type for m in messages] == [ToolInvokeMessage.MessageType.JSON, ToolInvokeMessage.MessageType.TEXT]

    # _invoke text path
    monkeypatch.setattr(tool, "validate_and_parse_response", lambda _: ParsedResponse("plain", False))
    messages = list(tool.invoke(user_id="u1", tool_parameters={}))
    assert len(messages) == 1
    assert messages[0].message.text == "plain"
