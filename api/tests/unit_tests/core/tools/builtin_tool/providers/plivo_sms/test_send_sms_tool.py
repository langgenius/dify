"""
Unit tests for Plivo SMS send_sms tool.

This module tests the send_sms tool functionality including:
- Parameter validation
- SMS sending via Plivo API
- Error handling for various failure scenarios
- Response message generation
"""

from unittest.mock import MagicMock, patch

import pytest


def _create_mock_entity():
    """Helper to create a mock ToolEntity."""
    entity = MagicMock()
    entity.model_copy.return_value = entity
    return entity


def _create_mock_runtime(credentials=None):
    """Helper to create a mock ToolRuntime."""
    runtime = MagicMock()
    if credentials is None:
        runtime.credentials = {
            "auth_id": "test_auth_id",
            "auth_token": "test_auth_token",
        }
    else:
        runtime.credentials = credentials
    runtime.runtime_parameters = {}
    return runtime


def _create_tool_with_runtime(credentials=None):
    """Helper to create a SendSmsTool with mock runtime."""
    from core.tools.builtin_tool.providers.plivo_sms.tools.send_sms import SendSmsTool

    entity = _create_mock_entity()
    runtime = _create_mock_runtime(credentials)

    tool = SendSmsTool(provider="plivo_sms", entity=entity, runtime=runtime)
    return tool


class TestSendSmsToolParameterValidation:
    """Test send_sms tool parameter validation."""

    def _create_tool_with_runtime(self, credentials=None):
        """Helper to create a SendSmsTool with mock runtime."""
        return _create_tool_with_runtime(credentials)

    def test_invoke_raises_error_when_to_missing(self):
        """Test invocation raises error when destination number is missing."""
        from core.tools.errors import ToolInvokeError

        tool = self._create_tool_with_runtime()
        params = {
            "to": "",
            "from_number": "+15555550000",
            "message": "Hello",
        }

        with pytest.raises(ToolInvokeError, match="Destination phone number"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    def test_invoke_raises_error_when_from_missing(self):
        """Test invocation raises error when source number is missing."""
        from core.tools.errors import ToolInvokeError

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "",
            "message": "Hello",
        }

        with pytest.raises(ToolInvokeError, match="Source phone number"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    def test_invoke_raises_error_when_message_missing(self):
        """Test invocation raises error when message content is missing."""
        from core.tools.errors import ToolInvokeError

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "",
        }

        with pytest.raises(ToolInvokeError, match="Message content is required"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    def test_invoke_raises_error_when_runtime_not_configured(self):
        """Test invocation raises error when runtime is not configured."""
        from core.tools.errors import ToolInvokeError

        tool = _create_tool_with_runtime()
        tool.runtime = None
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Hello",
        }

        with pytest.raises(ToolInvokeError, match="Tool runtime credentials are not configured"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    def test_invoke_raises_error_when_credentials_missing(self):
        """Test invocation raises error when credentials are missing."""
        from core.tools.errors import ToolInvokeError

        # Empty dict is falsy, so it triggers "credentials not configured" error
        tool = self._create_tool_with_runtime(credentials={})
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Hello",
        }

        with pytest.raises(ToolInvokeError, match="Tool runtime credentials are not configured"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))


class TestSendSmsToolInvocation:
    """Test send_sms tool invocation and SMS sending."""

    def _create_tool_with_runtime(self, credentials=None):
        """Helper to create a SendSmsTool with mock runtime."""
        return _create_tool_with_runtime(credentials)

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_success(self, mock_plivo):
        """Test successful SMS sending."""
        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-123"]
        mock_client.messages.create.return_value = mock_response

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Hello World",
        }

        messages = list(tool._invoke(user_id="user-123", tool_parameters=params))

        # Should return two messages: text and JSON
        assert len(messages) == 2

        # Verify Plivo client was created with correct credentials
        mock_plivo.RestClient.assert_called_once_with(
            auth_id="test_auth_id", auth_token="test_auth_token"
        )

        # Verify SMS was sent with correct parameters
        mock_client.messages.create.assert_called_once_with(
            src="+15555550000",
            dst="+14155551234",
            text="Hello World",
        )

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_returns_correct_text_message(self, mock_plivo):
        """Test invocation returns correct text message."""
        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-456"]
        mock_client.messages.create.return_value = mock_response

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Test message",
        }

        messages = list(tool._invoke(user_id="user-123", tool_parameters=params))

        # First message should be text with success info
        text_message = messages[0]
        assert "SMS sent successfully" in str(text_message)
        assert "+14155551234" in str(text_message)
        assert "msg-uuid-456" in str(text_message)

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_handles_empty_message_uuid(self, mock_plivo):
        """Test invocation handles empty message UUID gracefully."""
        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        mock_response = MagicMock()
        mock_response.message_uuid = []  # Empty UUID list
        mock_client.messages.create.return_value = mock_response

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Test message",
        }

        messages = list(tool._invoke(user_id="user-123", tool_parameters=params))

        assert len(messages) == 2
        # Should use "unknown" for missing UUID
        assert "unknown" in str(messages[0])


class TestSendSmsToolErrorHandling:
    """Test send_sms tool error handling."""

    def _create_tool_with_runtime(self, credentials=None):
        """Helper to create a SendSmsTool with mock runtime."""
        return _create_tool_with_runtime(credentials)

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_handles_authentication_error(self, mock_plivo):
        """Test invocation handles authentication error."""
        from core.tools.errors import ToolInvokeError

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        # Create a mock AuthenticationError
        mock_plivo.exceptions.AuthenticationError = type(
            "AuthenticationError", (Exception,), {}
        )
        mock_client.messages.create.side_effect = mock_plivo.exceptions.AuthenticationError(
            "Invalid credentials"
        )

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Test",
        }

        with pytest.raises(ToolInvokeError, match="Plivo authentication failed"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_handles_validation_error(self, mock_plivo):
        """Test invocation handles validation error."""
        from core.tools.errors import ToolInvokeError

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        # Create a mock ValidationError
        mock_plivo.exceptions.AuthenticationError = type(
            "AuthenticationError", (Exception,), {}
        )
        mock_plivo.exceptions.ValidationError = type("ValidationError", (Exception,), {})
        mock_client.messages.create.side_effect = mock_plivo.exceptions.ValidationError(
            "Invalid phone number"
        )

        tool = self._create_tool_with_runtime()
        params = {
            "to": "invalid",
            "from_number": "+15555550000",
            "message": "Test",
        }

        with pytest.raises(ToolInvokeError, match="Invalid request parameters"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_handles_plivo_rest_error(self, mock_plivo):
        """Test invocation handles Plivo REST API error."""
        from core.tools.errors import ToolInvokeError

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        # Create mock exceptions
        mock_plivo.exceptions.AuthenticationError = type(
            "AuthenticationError", (Exception,), {}
        )
        mock_plivo.exceptions.ValidationError = type("ValidationError", (Exception,), {})
        mock_plivo.exceptions.PlivoRestError = type("PlivoRestError", (Exception,), {})
        mock_client.messages.create.side_effect = mock_plivo.exceptions.PlivoRestError(
            "Rate limit exceeded"
        )

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Test",
        }

        with pytest.raises(ToolInvokeError, match="Plivo API error"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_handles_generic_error(self, mock_plivo):
        """Test invocation handles generic error."""
        from core.tools.errors import ToolInvokeError

        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        # Create mock exceptions
        mock_plivo.exceptions.AuthenticationError = type(
            "AuthenticationError", (Exception,), {}
        )
        mock_plivo.exceptions.ValidationError = type("ValidationError", (Exception,), {})
        mock_plivo.exceptions.PlivoRestError = type("PlivoRestError", (Exception,), {})
        mock_client.messages.create.side_effect = Exception("Network error")

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Test",
        }

        with pytest.raises(ToolInvokeError, match="Failed to send SMS"):
            list(tool._invoke(user_id="user-123", tool_parameters=params))


class TestSendSmsToolEdgeCases:
    """Test send_sms tool edge cases."""

    def _create_tool_with_runtime(self, credentials=None):
        """Helper to create a SendSmsTool with mock runtime."""
        return _create_tool_with_runtime(credentials)

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_with_whitespace_parameters(self, mock_plivo):
        """Test invocation strips whitespace from parameters."""
        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-123"]
        mock_client.messages.create.return_value = mock_response

        tool = self._create_tool_with_runtime()
        params = {
            "to": "  +14155551234  ",
            "from_number": "  +15555550000  ",
            "message": "  Hello World  ",
        }

        list(tool._invoke(user_id="user-123", tool_parameters=params))

        # Verify whitespace was stripped
        mock_client.messages.create.assert_called_once_with(
            src="+15555550000",
            dst="+14155551234",
            text="Hello World",
        )

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_with_unicode_message(self, mock_plivo):
        """Test invocation handles Unicode characters in message."""
        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-123"]
        mock_client.messages.create.return_value = mock_response

        tool = self._create_tool_with_runtime()
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": "Hello World! \U0001F64B",  # Unicode emoji
        }

        messages = list(tool._invoke(user_id="user-123", tool_parameters=params))

        assert len(messages) == 2
        mock_client.messages.create.assert_called_once()

    @patch("core.tools.builtin_tool.providers.plivo_sms.tools.send_sms.plivo")
    def test_invoke_with_long_message(self, mock_plivo):
        """Test invocation handles long messages."""
        mock_client = MagicMock()
        mock_plivo.RestClient.return_value = mock_client

        mock_response = MagicMock()
        mock_response.message_uuid = ["msg-uuid-123"]
        mock_client.messages.create.return_value = mock_response

        tool = self._create_tool_with_runtime()
        long_message = "A" * 1000  # 1000 character message
        params = {
            "to": "+14155551234",
            "from_number": "+15555550000",
            "message": long_message,
        }

        messages = list(tool._invoke(user_id="user-123", tool_parameters=params))

        assert len(messages) == 2
        mock_client.messages.create.assert_called_once_with(
            src="+15555550000",
            dst="+14155551234",
            text=long_message,
        )
