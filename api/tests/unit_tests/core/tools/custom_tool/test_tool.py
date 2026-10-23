from __future__ import annotations

import json
import operator
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import Mock, patch

import httpx
import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from core.app.entities.app_invoke_entities import InvokeFrom
from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.custom_tool.tool import ApiTool, ParsedResponse
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
)
from core.tools.errors import ToolInvokeError, ToolParameterValidationError, ToolProviderCredentialValidationError

pytest_plugins = ("tests.helpers.unit.core.tools.custom_tool.api_tool_http_fixture",)


tool_bundle: dict[str, object] = {
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


class TestApiToolRequestAssemblyCases:
    @staticmethod
    @pytest.mark.usefixtures("setup_http_mock")
    def test_api_tool() -> None:
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


def _build_tool(*, openapi: dict[str, Any] | None = None) -> ApiTool:
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


class TestCustomToolCases:
    @staticmethod
    def test_parsed_response_to_string():
        assert ParsedResponse({"a": 1}, True).to_string() == '{"a": 1}'
        assert ParsedResponse("ok", False).to_string() == "ok"

    @staticmethod
    def test_api_tool_fork_runtime_and_validate_credentials(monkeypatch: pytest.MonkeyPatch):
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

    @staticmethod
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

        tool.runtime.credentials = {
            "auth_type": "api_key_header",
            "api_key_header_prefix": "basic",
            "api_key_value": "abc",
        }
        headers = tool.assembling_request(parameters={})
        assert headers["Authorization"] == "Basic abc"
        assert tool.runtime.credentials["api_key_value"] == "abc"

        headers = tool.assembling_request(parameters={})
        assert headers["Authorization"] == "Basic abc"

        tool.runtime.credentials = {"auth_type": "api_key_query", "api_key_value": "abc"}
        assert tool.assembling_request(parameters={}) == {}

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
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

    @staticmethod
    def test_do_http_request_builds_arguments_and_handles_invalid_method(monkeypatch: pytest.MonkeyPatch):
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

    @staticmethod
    def test_do_http_request_handles_file_upload_and_invoke_paths(
        monkeypatch: pytest.MonkeyPatch, sqlite_session: Session
    ):
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
        messages = list(tool.invoke(session=sqlite_session, user_id="u1", tool_parameters={}))
        assert [m.type for m in messages] == [ToolInvokeMessage.MessageType.JSON, ToolInvokeMessage.MessageType.TEXT]

        # _invoke text path
        monkeypatch.setattr(tool, "validate_and_parse_response", lambda _: ParsedResponse("plain", False))
        messages = list(tool.invoke(session=sqlite_session, user_id="u1", tool_parameters={}))
        assert len(messages) == 1
        assert messages[0].message.text == "plain"


def _get_message_by_type[T](msgs: list[ToolInvokeMessage], msg_type: type[T]) -> ToolInvokeMessage | None:
    return next((i for i in msgs if isinstance(i.message, msg_type)), None)


class TestApiToolCases:
    @staticmethod
    @pytest.fixture
    def database_session(sqlite_engine: Engine) -> Iterator[Session]:
        """Yield the live ORM session required by the shared tool invocation contract."""
        with Session(sqlite_engine) as session:
            yield session

    class TestApiToolInvoke:
        """Test suite for ApiTool._invoke method to ensure JSON responses are properly serialized."""

        def setup_method(self):
            """Setup test fixtures."""
            # Create a mock tool entity
            self.mock_tool_identity = ToolIdentity(
                author="test",
                name="test_api_tool",
                label=I18nObject(en_US="Test API Tool", zh_Hans="测试API工具"),
                provider="test_provider",
            )
            self.mock_tool_entity = ToolEntity(identity=self.mock_tool_identity)

            # Create a mock API bundle
            self.mock_api_bundle = ApiToolBundle(
                server_url="https://api.example.com/test",
                method="GET",
                openapi={},
                operation_id="test_operation",
                parameters=[],
                author="test_author",
            )

            self.runtime = ToolRuntime(tenant_id="test_tenant", credentials={"auth_type": "none"})

            # Create the ApiTool instance
            self.api_tool = ApiTool(
                entity=self.mock_tool_entity,
                api_bundle=self.mock_api_bundle,
                runtime=self.runtime,
                provider_id="test_provider",
            )

        @patch("core.tools.custom_tool.tool.ssrf_proxy.get")
        def test_invoke_with_json_response_creates_text_message_with_serialized_json(
            self, mock_get: Mock, database_session: Session
        ) -> None:
            """Test that when upstream returns JSON, the output Text message contains JSON-serialized string."""
            # Use the response's real JSON parsing and content decoding.
            json_response_data = {
                "key": "value",
                "number": 123,
                "nested": {"inner": "data"},
            }
            mock_get.return_value = httpx.Response(200, json=json_response_data)

            # Invoke the tool
            result_generator = self.api_tool._invoke(session=database_session, user_id="test_user", tool_parameters={})

            # Get the result from the generator
            result = list(result_generator)
            assert len(result) == 2

            # Verify _invoke yields text message
            text_message = _get_message_by_type(result, ToolInvokeMessage.TextMessage)
            assert text_message is not None, "_invoke should yield a text message"
            assert isinstance(text_message, ToolInvokeMessage)
            assert text_message.type == ToolInvokeMessage.MessageType.TEXT
            assert text_message.message is not None
            # Verify the text contains the JSON-serialized string
            # Check if message is a TextMessage
            assert isinstance(text_message.message, ToolInvokeMessage.TextMessage)
            # Verify it's a valid JSON string and equals to the mock response
            parsed_back = json.loads(text_message.message.text)
            assert parsed_back == json_response_data

            # Verify _invoke yields json message
            json_message = _get_message_by_type(result, ToolInvokeMessage.JsonMessage)
            assert json_message is not None, "_invoke should yield a JSON message"
            assert isinstance(json_message, ToolInvokeMessage)
            assert json_message.type == ToolInvokeMessage.MessageType.JSON
            assert json_message.message is not None

            assert isinstance(json_message.message, ToolInvokeMessage.JsonMessage)
            assert json_message.message.json_object == json_response_data

        @patch("core.tools.custom_tool.tool.ssrf_proxy.get")
        @pytest.mark.parametrize(
            "test_case",
            [
                (
                    "array",
                    [
                        {"id": 1, "name": "Item 1", "active": True},
                        {"id": 2, "name": "Item 2", "active": False},
                        {"id": 3, "name": "项目 3", "active": True},
                    ],
                ),
                (
                    "string",
                    "string",
                ),
                (
                    "number",
                    123.456,
                ),
                (
                    "boolean",
                    True,
                ),
                (
                    "null",
                    None,
                ),
            ],
            ids=operator.itemgetter(0),
        )
        def test_invoke_with_non_dict_json_response_creates_text_message_with_serialized_json(
            self, mock_get: Mock, test_case, database_session: Session
        ) -> None:
            """Test that when upstream returns a non-dict JSON,
            the output Text message contains JSON-serialized string.
            """
            # Explicit content also covers JSON null, which is distinct from no body.
            _, json_value = test_case
            mock_get.return_value = httpx.Response(
                200, content=json.dumps(json_value), headers={"content-type": "application/json"}
            )

            # Invoke the tool
            result_generator = self.api_tool._invoke(session=database_session, user_id="test_user", tool_parameters={})

            # Get the result from the generator
            result = list(result_generator)
            assert len(result) == 1

            # Verify  _invoke yields a text message
            text_message = _get_message_by_type(result, ToolInvokeMessage.TextMessage)
            assert text_message is not None, "_invoke should yield a text message containing the serialized JSON."
            assert isinstance(text_message, ToolInvokeMessage)
            assert text_message.type == ToolInvokeMessage.MessageType.TEXT
            assert text_message.message is not None
            # Verify the text contains the JSON-serialized string
            # Check if message is a TextMessage
            assert isinstance(text_message.message, ToolInvokeMessage.TextMessage)
            # Verify it's a valid JSON string
            parsed_back = json.loads(text_message.message.text)
            assert parsed_back == json_value

            # Verify _invoke yields json message
            json_message = _get_message_by_type(result, ToolInvokeMessage.JsonMessage)
            assert json_message is None, "_invoke should not yield a JSON message for JSON array response"

        @patch("core.tools.custom_tool.tool.ssrf_proxy.get")
        def test_invoke_with_text_response_creates_text_message_with_original_text(
            self, mock_get: Mock, database_session: Session
        ) -> None:
            """Test that when upstream returns plain text, the output Text message contains the original text."""
            # Plain text exercises the response's real JSON decoding failure.
            text_response_data = "This is a plain text response"
            mock_get.return_value = httpx.Response(200, text=text_response_data)

            # Invoke the tool
            result_generator = self.api_tool._invoke(session=database_session, user_id="test_user", tool_parameters={})

            # Get the result from the generator
            result = list(result_generator)
            assert len(result) == 1

            # Verify it's a text message with the original text
            message = result[0]
            assert isinstance(message, ToolInvokeMessage)
            assert message.type == ToolInvokeMessage.MessageType.TEXT
            assert message.message is not None
            # Check if message is a TextMessage
            assert isinstance(message.message, ToolInvokeMessage.TextMessage)
            assert message.message.text == text_response_data

        @patch("core.tools.custom_tool.tool.ssrf_proxy.get")
        def test_invoke_with_empty_response(self, mock_get: Mock, database_session: Session) -> None:
            """Test that empty responses are handled correctly."""
            mock_get.return_value = httpx.Response(200, content=b"", headers={"content-type": "application/json"})

            # Invoke the tool
            result_generator = self.api_tool._invoke(session=database_session, user_id="test_user", tool_parameters={})

            # Get the result from the generator
            result = list(result_generator)
            assert len(result) == 1

            # Verify it's a text message with the empty response message
            message = result[0]
            assert isinstance(message, ToolInvokeMessage)
            assert message.type == ToolInvokeMessage.MessageType.TEXT
            assert message.message is not None
            # Check if message is a TextMessage
            assert isinstance(message.message, ToolInvokeMessage.TextMessage)
            assert "Empty response from the tool" in message.message.text

        @patch("core.tools.custom_tool.tool.ssrf_proxy.get")
        def test_invoke_with_error_response(self, mock_get: Mock, database_session: Session) -> None:
            """Test that error responses are handled correctly."""
            mock_get.return_value = httpx.Response(404, text="Not Found")

            result_generator = self.api_tool._invoke(session=database_session, user_id="test_user", tool_parameters={})

            # Invoke the tool and expect an error
            with pytest.raises(Exception, match="Request failed with status code 404 and Not Found") as exc_info:
                list(result_generator)  # Consume the generator to trigger the error

            # Verify the error message
            assert "Request failed with status code 404" in str(exc_info.value)
