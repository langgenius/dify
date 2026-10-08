import json
import operator
from unittest.mock import Mock, patch

import httpx
import pytest
from sqlalchemy.orm import Session

from core.tools.__base.tool_runtime import ToolRuntime
from core.tools.custom_tool.tool import ApiTool
from core.tools.entities.common_entities import I18nObject
from core.tools.entities.tool_bundle import ApiToolBundle
from core.tools.entities.tool_entities import (
    ToolEntity,
    ToolIdentity,
    ToolInvokeMessage,
)


def _get_message_by_type[T](msgs: list[ToolInvokeMessage], msg_type: type[T]) -> ToolInvokeMessage | None:
    return next((i for i in msgs if isinstance(i.message, msg_type)), None)


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
        self, mock_get: Mock, unbound_session: Session
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
        result_generator = self.api_tool._invoke(session=unbound_session, user_id="test_user", tool_parameters={})

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
        self, mock_get: Mock, test_case, unbound_session: Session
    ) -> None:
        """Test that when upstream returns a non-dict JSON, the output Text message contains JSON-serialized string."""
        # Explicit content also covers JSON null, which is distinct from no body.
        _, json_value = test_case
        mock_get.return_value = httpx.Response(
            200, content=json.dumps(json_value), headers={"content-type": "application/json"}
        )

        # Invoke the tool
        result_generator = self.api_tool._invoke(session=unbound_session, user_id="test_user", tool_parameters={})

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
        self, mock_get: Mock, unbound_session: Session
    ) -> None:
        """Test that when upstream returns plain text, the output Text message contains the original text."""
        # Plain text exercises the response's real JSON decoding failure.
        text_response_data = "This is a plain text response"
        mock_get.return_value = httpx.Response(200, text=text_response_data)

        # Invoke the tool
        result_generator = self.api_tool._invoke(session=unbound_session, user_id="test_user", tool_parameters={})

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
    def test_invoke_with_empty_response(self, mock_get: Mock, unbound_session: Session) -> None:
        """Test that empty responses are handled correctly."""
        mock_get.return_value = httpx.Response(200, content=b"", headers={"content-type": "application/json"})

        # Invoke the tool
        result_generator = self.api_tool._invoke(session=unbound_session, user_id="test_user", tool_parameters={})

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
    def test_invoke_with_error_response(self, mock_get: Mock, unbound_session: Session) -> None:
        """Test that error responses are handled correctly."""
        mock_get.return_value = httpx.Response(404, text="Not Found")

        result_generator = self.api_tool._invoke(session=unbound_session, user_id="test_user", tool_parameters={})

        # Invoke the tool and expect an error
        with pytest.raises(Exception) as exc_info:
            list(result_generator)  # Consume the generator to trigger the error

        # Verify the error message
        assert "Request failed with status code 404" in str(exc_info.value)
