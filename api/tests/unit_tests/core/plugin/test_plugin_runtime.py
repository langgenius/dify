"""Comprehensive unit tests for Plugin Runtime functionality.

This test module covers all aspects of plugin runtime including:
- Plugin execution through the plugin daemon
- Sandbox isolation via HTTP communication
- Resource limits (timeout, memory constraints)
- Error handling for various failure scenarios
- Plugin communication (request/response patterns, streaming)

All tests use mocking to avoid external dependencies and ensure fast, reliable execution.
Tests follow the Arrange-Act-Assert pattern for clarity.
"""

import json
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
from pydantic import BaseModel

from core.model_runtime.errors.invoke import (
    InvokeAuthorizationError,
    InvokeBadRequestError,
    InvokeConnectionError,
    InvokeRateLimitError,
    InvokeServerUnavailableError,
)
from core.model_runtime.errors.validate import CredentialsValidateFailedError
from core.plugin.entities.plugin_daemon import (
    CredentialType,
    PluginDaemonInnerError,
)
from core.plugin.impl.base import BasePluginClient
from core.plugin.impl.exc import (
    PluginDaemonBadRequestError,
    PluginDaemonInternalServerError,
    PluginDaemonNotFoundError,
    PluginDaemonUnauthorizedError,
    PluginInvokeError,
    PluginNotFoundError,
    PluginPermissionDeniedError,
    PluginUniqueIdentifierError,
)
from core.plugin.impl.plugin import PluginInstaller
from core.plugin.impl.tool import PluginToolManager


class TestPluginRuntimeExecution:
    """Unit tests for plugin execution functionality.

    Tests cover:
    - Successful plugin invocation
    - Request preparation and headers
    - Response parsing
    - Streaming responses
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-api-key"),
        ):
            yield

    def test_request_preparation(self, plugin_client, mock_config):
        """Test that requests are properly prepared with correct headers and URL."""
        # Arrange
        path = "plugin/test-tenant/management/list"
        headers = {"Custom-Header": "value"}
        data = {"key": "value"}
        params = {"page": 1}

        # Act
        url, prepared_headers, prepared_data, prepared_params, files = plugin_client._prepare_request(
            path, headers, data, params, None
        )

        # Assert
        assert url == "http://127.0.0.1:5002/plugin/test-tenant/management/list"
        assert prepared_headers["X-Api-Key"] == "test-api-key"
        assert prepared_headers["Custom-Header"] == "value"
        assert prepared_headers["Accept-Encoding"] == "gzip, deflate, br"
        assert prepared_data == data
        assert prepared_params == params

    def test_request_with_json_content_type(self, plugin_client, mock_config):
        """Test request preparation with JSON content type."""
        # Arrange
        path = "plugin/test-tenant/management/install"
        headers = {"Content-Type": "application/json"}
        data = {"plugin_id": "test-plugin"}

        # Act
        url, prepared_headers, prepared_data, prepared_params, files = plugin_client._prepare_request(
            path, headers, data, None, None
        )

        # Assert
        assert prepared_headers["Content-Type"] == "application/json"
        assert prepared_data == json.dumps(data)

    def test_successful_request_execution(self, plugin_client, mock_config):
        """Test successful HTTP request execution."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"result": "success"}

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            response = plugin_client._request("GET", "plugin/test-tenant/management/list")

            # Assert
            assert response.status_code == 200
            mock_request.assert_called_once()
            call_kwargs = mock_request.call_args[1]
            assert call_kwargs["method"] == "GET"
            assert "http://127.0.0.1:5002/plugin/test-tenant/management/list" in call_kwargs["url"]
            assert call_kwargs["headers"]["X-Api-Key"] == "test-api-key"

    def test_request_with_timeout_configuration(self, plugin_client, mock_config):
        """Test that timeout configuration is properly applied."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("GET", "plugin/test-tenant/test")

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert "timeout" in call_kwargs

    def test_request_connection_error(self, plugin_client, mock_config):
        """Test handling of connection errors during request."""
        # Arrange
        with patch("httpx.request", side_effect=httpx.RequestError("Connection failed")):
            # Act & Assert
            with pytest.raises(PluginDaemonInnerError) as exc_info:
                plugin_client._request("GET", "plugin/test-tenant/test")
            assert exc_info.value.code == -500
            assert "Request to Plugin Daemon Service failed" in exc_info.value.message


class TestPluginRuntimeSandboxIsolation:
    """Unit tests for plugin sandbox isolation.

    Tests cover:
    - Isolated execution environment via HTTP
    - API key authentication
    - Request/response boundaries
    - Plugin daemon communication protocol
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "secure-api-key"),
        ):
            yield

    def test_api_key_authentication(self, plugin_client, mock_config):
        """Test that all requests include API key for authentication."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": True}

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("GET", "plugin/test-tenant/test")

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert call_kwargs["headers"]["X-Api-Key"] == "secure-api-key"

    def test_isolated_plugin_execution_via_http(self, plugin_client, mock_config):
        """Test that plugin execution is isolated via HTTP communication."""

        # Arrange
        class TestResponse(BaseModel):
            result: str

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": {"result": "isolated_execution"}}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = plugin_client._request_with_plugin_daemon_response(
                "POST", "plugin/test-tenant/dispatch/tool/invoke", TestResponse, data={"tool": "test"}
            )

            # Assert
            assert result.result == "isolated_execution"

    def test_plugin_daemon_unauthorized_error(self, plugin_client, mock_config):
        """Test handling of unauthorized access to plugin daemon."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps({"error_type": "PluginDaemonUnauthorizedError", "message": "Unauthorized access"})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonUnauthorizedError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
            assert "Unauthorized access" in exc_info.value.description

    def test_plugin_permission_denied(self, plugin_client, mock_config):
        """Test handling of permission denied errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps(
            {"error_type": "PluginPermissionDeniedError", "message": "Permission denied for this operation"}
        )
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginPermissionDeniedError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
            assert "Permission denied" in exc_info.value.description


class TestPluginRuntimeResourceLimits:
    """Unit tests for plugin resource limits.

    Tests cover:
    - Timeout enforcement
    - Memory constraints
    - Resource limit violations
    - Graceful degradation
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration with timeout."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
            patch("core.plugin.impl.base.plugin_daemon_request_timeout", httpx.Timeout(30.0)),
        ):
            yield

    def test_timeout_configuration_applied(self, plugin_client, mock_config):
        """Test that timeout configuration is properly applied to requests."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("GET", "plugin/test-tenant/test")

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert call_kwargs["timeout"] is not None

    def test_timeout_error_handling(self, plugin_client, mock_config):
        """Test handling of timeout errors."""
        # Arrange
        with patch("httpx.request", side_effect=httpx.TimeoutException("Request timeout")):
            # Act & Assert
            with pytest.raises(PluginDaemonInnerError) as exc_info:
                plugin_client._request("GET", "plugin/test-tenant/test")
            assert exc_info.value.code == -500

    def test_streaming_request_timeout(self, plugin_client, mock_config):
        """Test timeout handling for streaming requests."""
        # Arrange
        with patch("httpx.stream", side_effect=httpx.TimeoutException("Stream timeout")):
            # Act & Assert
            with pytest.raises(PluginDaemonInnerError) as exc_info:
                list(plugin_client._stream_request("POST", "plugin/test-tenant/stream"))
            assert exc_info.value.code == -500

    def test_resource_limit_error_from_daemon(self, plugin_client, mock_config):
        """Test handling of resource limit errors from plugin daemon."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps(
            {"error_type": "PluginDaemonInternalServerError", "message": "Resource limit exceeded"}
        )
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonInternalServerError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
            assert "Resource limit exceeded" in exc_info.value.description


class TestPluginRuntimeErrorHandling:
    """Unit tests for plugin runtime error handling.

    Tests cover:
    - Various error types (invoke, validation, connection)
    - Error propagation and transformation
    - User-friendly error messages
    - Error recovery mechanisms
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_plugin_invoke_rate_limit_error(self, plugin_client, mock_config):
        """Test handling of rate limit errors during plugin invocation."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        invoke_error = {
            "error_type": "InvokeRateLimitError",
            "message": "Rate limit exceeded",
            "args": {"description": "Rate limit exceeded"},
        }
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(InvokeRateLimitError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
            assert "Rate limit exceeded" in exc_info.value.description

    def test_plugin_invoke_authorization_error(self, plugin_client, mock_config):
        """Test handling of authorization errors during plugin invocation."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        invoke_error = {
            "error_type": "InvokeAuthorizationError",
            "message": "Invalid credentials",
            "args": {"description": "Invalid credentials"},
        }
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(InvokeAuthorizationError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
            assert "Invalid credentials" in exc_info.value.description

    def test_plugin_invoke_bad_request_error(self, plugin_client, mock_config):
        """Test handling of bad request errors during plugin invocation."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        invoke_error = {
            "error_type": "InvokeBadRequestError",
            "message": "Invalid parameters",
            "args": {"description": "Invalid parameters"},
        }
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(InvokeBadRequestError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
            assert "Invalid parameters" in exc_info.value.description

    def test_plugin_invoke_connection_error(self, plugin_client, mock_config):
        """Test handling of connection errors during plugin invocation."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        invoke_error = {
            "error_type": "InvokeConnectionError",
            "message": "Connection to external service failed",
            "args": {"description": "Connection to external service failed"},
        }
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(InvokeConnectionError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
            assert "Connection to external service failed" in exc_info.value.description

    def test_plugin_invoke_server_unavailable_error(self, plugin_client, mock_config):
        """Test handling of server unavailable errors during plugin invocation."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        invoke_error = {
            "error_type": "InvokeServerUnavailableError",
            "message": "Service temporarily unavailable",
            "args": {"description": "Service temporarily unavailable"},
        }
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(InvokeServerUnavailableError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
            assert "Service temporarily unavailable" in exc_info.value.description

    def test_credentials_validation_error(self, plugin_client, mock_config):
        """Test handling of credential validation errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        invoke_error = {
            "error_type": "CredentialsValidateFailedError",
            "message": "Invalid API key format",
        }
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": json.dumps(invoke_error)})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(CredentialsValidateFailedError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/validate", bool)
            assert "Invalid API key format" in str(exc_info.value)

    def test_plugin_not_found_error(self, plugin_client, mock_config):
        """Test handling of plugin not found errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps(
            {"error_type": "PluginNotFoundError", "message": "Plugin with ID 'test-plugin' not found"}
        )
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginNotFoundError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/get", bool)
            assert "Plugin with ID 'test-plugin' not found" in exc_info.value.description

    def test_plugin_unique_identifier_error(self, plugin_client, mock_config):
        """Test handling of unique identifier errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps(
            {"error_type": "PluginUniqueIdentifierError", "message": "Invalid plugin identifier format"}
        )
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginUniqueIdentifierError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/install", bool)
            assert "Invalid plugin identifier format" in exc_info.value.description

    def test_daemon_bad_request_error(self, plugin_client, mock_config):
        """Test handling of daemon bad request errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps(
            {"error_type": "PluginDaemonBadRequestError", "message": "Missing required parameter"}
        )
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonBadRequestError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
            assert "Missing required parameter" in exc_info.value.description

    def test_daemon_not_found_error(self, plugin_client, mock_config):
        """Test handling of daemon not found errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps({"error_type": "PluginDaemonNotFoundError", "message": "Resource not found"})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonNotFoundError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/resource", bool)
            assert "Resource not found" in exc_info.value.description

    def test_generic_plugin_invoke_error(self, plugin_client, mock_config):
        """Test handling of generic plugin invoke errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        # Create a proper nested JSON structure for PluginInvokeError
        invoke_error_message = json.dumps(
            {"error_type": "UnknownInvokeError", "message": "Generic plugin execution error"}
        )
        error_message = json.dumps({"error_type": "PluginInvokeError", "message": invoke_error_message})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginInvokeError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/invoke", bool)
            assert exc_info.value.description is not None

    def test_unknown_error_type(self, plugin_client, mock_config):
        """Test handling of unknown error types."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps({"error_type": "UnknownErrorType", "message": "Unknown error occurred"})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(Exception) as exc_info:
                plugin_client._request_with_plugin_daemon_response("POST", "plugin/test-tenant/test", bool)
            assert "got unknown error from plugin daemon" in str(exc_info.value)

    def test_http_status_error_handling(self, plugin_client, mock_config):
        """Test handling of HTTP status errors."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error", request=MagicMock(), response=mock_response
        )

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(httpx.HTTPStatusError):
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)

    def test_empty_data_response_error(self, plugin_client, mock_config):
        """Test handling of empty data in successful response."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(ValueError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
            assert "got empty data from plugin daemon" in str(exc_info.value)


class TestPluginRuntimeCommunication:
    """Unit tests for plugin communication patterns.

    Tests cover:
    - Request/response communication
    - Streaming responses
    - Data serialization/deserialization
    - Message formatting
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_request_response_communication(self, plugin_client, mock_config):
        """Test basic request/response communication pattern."""

        # Arrange
        class TestModel(BaseModel):
            value: str
            count: int

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": {"value": "test", "count": 42}}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = plugin_client._request_with_plugin_daemon_response(
                "POST", "plugin/test-tenant/test", TestModel, data={"input": "data"}
            )

            # Assert
            assert isinstance(result, TestModel)
            assert result.value == "test"
            assert result.count == 42

    def test_streaming_response_communication(self, plugin_client, mock_config):
        """Test streaming response communication pattern."""

        # Arrange
        class StreamModel(BaseModel):
            chunk: str

        stream_data = [
            'data: {"code": 0, "message": "", "data": {"chunk": "first"}}',
            'data: {"code": 0, "message": "", "data": {"chunk": "second"}}',
            'data: {"code": 0, "message": "", "data": {"chunk": "third"}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/stream", StreamModel
                )
            )

            # Assert
            assert len(results) == 3
            assert all(isinstance(r, StreamModel) for r in results)
            assert results[0].chunk == "first"
            assert results[1].chunk == "second"
            assert results[2].chunk == "third"

    def test_streaming_with_error_in_stream(self, plugin_client, mock_config):
        """Test error handling in streaming responses."""
        # Arrange
        # Create proper error structure for -500 code
        error_obj = json.dumps({"error_type": "PluginDaemonInnerError", "message": "Stream error occurred"})
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"chunk": "first"}}',
            f'data: {{"code": -500, "message": {json.dumps(error_obj)}, "data": null}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            class StreamModel(BaseModel):
                chunk: str

            results = plugin_client._request_with_plugin_daemon_response_stream(
                "POST", "plugin/test-tenant/stream", StreamModel
            )

            # Assert
            first_result = next(results)
            assert first_result.chunk == "first"

            with pytest.raises(PluginDaemonInnerError) as exc_info:
                next(results)
            assert exc_info.value.code == -500

    def test_streaming_connection_error(self, plugin_client, mock_config):
        """Test connection error during streaming."""
        # Arrange
        with patch("httpx.stream", side_effect=httpx.RequestError("Stream connection failed")):
            # Act & Assert
            with pytest.raises(PluginDaemonInnerError) as exc_info:
                list(plugin_client._stream_request("POST", "plugin/test-tenant/stream"))
            assert exc_info.value.code == -500

    def test_request_with_model_parsing(self, plugin_client, mock_config):
        """Test request with direct model parsing (without daemon response wrapper)."""

        # Arrange
        class DirectModel(BaseModel):
            status: str
            data: dict[str, Any]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"status": "success", "data": {"key": "value"}}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = plugin_client._request_with_model("GET", "plugin/test-tenant/direct", DirectModel)

            # Assert
            assert isinstance(result, DirectModel)
            assert result.status == "success"
            assert result.data == {"key": "value"}

    def test_streaming_with_model_parsing(self, plugin_client, mock_config):
        """Test streaming with direct model parsing."""

        # Arrange
        class StreamItem(BaseModel):
            id: int
            text: str

        stream_data = [
            '{"id": 1, "text": "first"}',
            '{"id": 2, "text": "second"}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(plugin_client._stream_request_with_model("POST", "plugin/test-tenant/stream", StreamItem))

            # Assert
            assert len(results) == 2
            assert results[0].id == 1
            assert results[0].text == "first"
            assert results[1].id == 2
            assert results[1].text == "second"

    def test_streaming_skips_empty_lines(self, plugin_client, mock_config):
        """Test that streaming properly skips empty lines."""

        # Arrange
        class StreamModel(BaseModel):
            value: str

        stream_data = [
            "",
            '{"code": 0, "message": "", "data": {"value": "first"}}',
            "",
            "",
            '{"code": 0, "message": "", "data": {"value": "second"}}',
            "",
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/stream", StreamModel
                )
            )

            # Assert
            assert len(results) == 2
            assert results[0].value == "first"
            assert results[1].value == "second"


class TestPluginToolManagerIntegration:
    """Integration tests for PluginToolManager.

    Tests cover:
    - Tool invocation
    - Credential validation
    - Runtime parameter retrieval
    - Tool provider management
    """

    @pytest.fixture
    def tool_manager(self):
        """Create a PluginToolManager instance for testing."""
        return PluginToolManager()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_tool_invocation_success(self, tool_manager, mock_config):
        """Test successful tool invocation."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"type": "text", "message": {"text": "Result"}}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                tool_manager.invoke(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    tool_provider="langgenius/test-plugin/test-provider",
                    tool_name="test-tool",
                    credentials={"api_key": "test-key"},
                    credential_type=CredentialType.API_KEY,
                    tool_parameters={"param1": "value1"},
                )
            )

            # Assert
            assert len(results) > 0
            assert results[0].type == "text"

    def test_validate_provider_credentials_success(self, tool_manager, mock_config):
        """Test successful provider credential validation."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"result": true}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            result = tool_manager.validate_provider_credentials(
                tenant_id="test-tenant",
                user_id="test-user",
                provider="langgenius/test-plugin/test-provider",
                credentials={"api_key": "valid-key"},
            )

            # Assert
            assert result is True

    def test_validate_provider_credentials_failure(self, tool_manager, mock_config):
        """Test failed provider credential validation."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"result": false}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            result = tool_manager.validate_provider_credentials(
                tenant_id="test-tenant",
                user_id="test-user",
                provider="langgenius/test-plugin/test-provider",
                credentials={"api_key": "invalid-key"},
            )

            # Assert
            assert result is False

    def test_validate_datasource_credentials_success(self, tool_manager, mock_config):
        """Test successful datasource credential validation."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"result": true}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            result = tool_manager.validate_datasource_credentials(
                tenant_id="test-tenant",
                user_id="test-user",
                provider="langgenius/test-plugin/test-datasource",
                credentials={"connection_string": "valid"},
            )

            # Assert
            assert result is True


class TestPluginInstallerIntegration:
    """Integration tests for PluginInstaller.

    Tests cover:
    - Plugin installation
    - Plugin listing
    - Plugin uninstallation
    - Package upload
    """

    @pytest.fixture
    def installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_list_plugins_success(self, installer, mock_config):
        """Test successful plugin listing."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": 0,
            "message": "",
            "data": {
                "list": [],
                "total": 0,
            },
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.list_plugins("test-tenant")

            # Assert
            assert isinstance(result, list)

    def test_uninstall_plugin_success(self, installer, mock_config):
        """Test successful plugin uninstallation."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": True}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.uninstall("test-tenant", "plugin-installation-id")

            # Assert
            assert result is True

    def test_fetch_plugin_by_identifier_success(self, installer, mock_config):
        """Test successful plugin fetch by identifier."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": True}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.fetch_plugin_by_identifier("test-tenant", "plugin-identifier")

            # Assert
            assert result is True


class TestPluginRuntimeEdgeCases:
    """Tests for edge cases and corner scenarios in plugin runtime.

    Tests cover:
    - Malformed responses
    - Unexpected data types
    - Concurrent requests
    - Large payloads
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_malformed_json_response(self, plugin_client, mock_config):
        """Test handling of malformed JSON responses."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.side_effect = json.JSONDecodeError("Invalid JSON", "", 0)

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(ValueError):
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)

    def test_invalid_response_structure(self, plugin_client, mock_config):
        """Test handling of invalid response structure."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        # Missing required fields in response
        mock_response.json.return_value = {"invalid": "structure"}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(ValueError):
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)

    def test_streaming_with_invalid_json_line(self, plugin_client, mock_config):
        """Test streaming with invalid JSON in one line."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"value": "valid"}}',
            "data: {invalid json}",
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            class StreamModel(BaseModel):
                value: str

            results = plugin_client._request_with_plugin_daemon_response_stream(
                "POST", "plugin/test-tenant/stream", StreamModel
            )

            # Assert
            first_result = next(results)
            assert first_result.value == "valid"

            with pytest.raises(ValueError):
                next(results)

    def test_request_with_bytes_data(self, plugin_client, mock_config):
        """Test request with bytes data."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("POST", "plugin/test-tenant/upload", data=b"binary data")

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert call_kwargs["content"] == b"binary data"

    def test_request_with_files(self, plugin_client, mock_config):
        """Test request with file upload."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200

        files = {"file": ("test.txt", b"file content", "text/plain")}

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("POST", "plugin/test-tenant/upload", files=files)

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert call_kwargs["files"] == files

    def test_streaming_empty_response(self, plugin_client, mock_config):
        """Test streaming with empty response."""
        # Arrange
        mock_response = MagicMock()
        mock_response.iter_lines.return_value = []

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(plugin_client._stream_request("POST", "plugin/test-tenant/stream"))

            # Assert
            assert len(results) == 0

    def test_daemon_inner_error_with_code_500(self, plugin_client, mock_config):
        """Test handling of daemon inner error with code -500 in stream."""
        # Arrange
        error_obj = json.dumps({"error_type": "PluginDaemonInnerError", "message": "Internal error"})
        stream_data = [
            f'data: {{"code": -500, "message": {json.dumps(error_obj)}, "data": null}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act & Assert
            class StreamModel(BaseModel):
                data: str

            results = plugin_client._request_with_plugin_daemon_response_stream(
                "POST", "plugin/test-tenant/stream", StreamModel
            )
            with pytest.raises(PluginDaemonInnerError) as exc_info:
                next(results)
            assert exc_info.value.code == -500

    def test_non_json_error_message(self, plugin_client, mock_config):
        """Test handling of non-JSON error message."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": -1, "message": "Plain text error message", "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(ValueError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
            assert "Plain text error message" in str(exc_info.value)


class TestPluginRuntimeAdvancedScenarios:
    """Advanced test scenarios for plugin runtime.

    Tests cover:
    - Complex error recovery
    - Concurrent request handling
    - Plugin state management
    - Advanced streaming patterns
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_multiple_sequential_requests(self, plugin_client, mock_config):
        """Test multiple sequential requests to the same endpoint."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": True}

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            for i in range(5):
                result = plugin_client._request_with_plugin_daemon_response("GET", f"plugin/test-tenant/test/{i}", bool)
                assert result is True

            # Assert
            assert mock_request.call_count == 5

    def test_request_with_complex_nested_data(self, plugin_client, mock_config):
        """Test request with complex nested data structures."""

        # Arrange
        class ComplexModel(BaseModel):
            nested: dict[str, Any]
            items: list[dict[str, Any]]

        complex_data = {
            "nested": {"level1": {"level2": {"level3": "deep_value"}}},
            "items": [
                {"id": 1, "name": "item1"},
                {"id": 2, "name": "item2"},
            ],
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": complex_data}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = plugin_client._request_with_plugin_daemon_response(
                "POST", "plugin/test-tenant/complex", ComplexModel
            )

            # Assert
            assert result.nested["level1"]["level2"]["level3"] == "deep_value"
            assert len(result.items) == 2
            assert result.items[0]["id"] == 1

    def test_streaming_with_multiple_chunk_types(self, plugin_client, mock_config):
        """Test streaming with different chunk types in sequence."""

        # Arrange
        class MultiTypeModel(BaseModel):
            type: str
            data: dict[str, Any]

        stream_data = [
            '{"code": 0, "message": "", "data": {"type": "start", "data": {"status": "initializing"}}}',
            '{"code": 0, "message": "", "data": {"type": "progress", "data": {"percent": 50}}}',
            '{"code": 0, "message": "", "data": {"type": "complete", "data": {"result": "success"}}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/multi-stream", MultiTypeModel
                )
            )

            # Assert
            assert len(results) == 3
            assert results[0].type == "start"
            assert results[1].type == "progress"
            assert results[2].type == "complete"
            assert results[1].data["percent"] == 50

    def test_error_recovery_with_retry_pattern(self, plugin_client, mock_config):
        """Test error recovery pattern (simulated retry logic)."""
        # Arrange
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise httpx.RequestError("Temporary failure")
            mock_response = MagicMock()
            mock_response.status_code = 200
            return mock_response

        with patch("httpx.request", side_effect=side_effect):
            # Act & Assert - First two calls should fail
            with pytest.raises(PluginDaemonInnerError):
                plugin_client._request("GET", "plugin/test-tenant/test")

            with pytest.raises(PluginDaemonInnerError):
                plugin_client._request("GET", "plugin/test-tenant/test")

            # Third call should succeed
            response = plugin_client._request("GET", "plugin/test-tenant/test")
            assert response.status_code == 200

    def test_request_with_custom_headers_preservation(self, plugin_client, mock_config):
        """Test that custom headers are preserved through request pipeline."""
        # Arrange
        custom_headers = {
            "X-Custom-Header": "custom-value",
            "X-Request-ID": "req-123",
            "X-Tenant-ID": "tenant-456",
        }

        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("GET", "plugin/test-tenant/test", headers=custom_headers)

            # Assert
            call_kwargs = mock_request.call_args[1]
            for key, value in custom_headers.items():
                assert call_kwargs["headers"][key] == value

    def test_streaming_with_large_chunks(self, plugin_client, mock_config):
        """Test streaming with large data chunks."""

        # Arrange
        class LargeChunkModel(BaseModel):
            chunk_id: int
            data: str

        # Create large chunks (simulating large data transfer)
        large_data = "x" * 10000  # 10KB of data
        stream_data = [
            f'{{"code": 0, "message": "", "data": {{"chunk_id": {i}, "data": "{large_data}"}}}}' for i in range(10)
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/large-stream", LargeChunkModel
                )
            )

            # Assert
            assert len(results) == 10
            for i, result in enumerate(results):
                assert result.chunk_id == i
                assert len(result.data) == 10000


class TestPluginRuntimeSecurityAndValidation:
    """Tests for security and validation aspects of plugin runtime.

    Tests cover:
    - Input validation
    - Security headers
    - Authentication failures
    - Authorization checks
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "secure-key-123"),
        ):
            yield

    def test_api_key_header_always_present(self, plugin_client, mock_config):
        """Test that API key header is always included in requests."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request("GET", "plugin/test-tenant/test")

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert "X-Api-Key" in call_kwargs["headers"]
            assert call_kwargs["headers"]["X-Api-Key"] == "secure-key-123"

    def test_request_with_sensitive_data_in_body(self, plugin_client, mock_config):
        """Test handling of sensitive data in request body."""
        # Arrange
        sensitive_data = {
            "api_key": "secret-api-key",
            "password": "secret-password",
            "credentials": {"token": "secret-token"},
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": True}

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request_with_plugin_daemon_response(
                "POST",
                "plugin/test-tenant/validate",
                bool,
                data=sensitive_data,
                headers={"Content-Type": "application/json"},
            )

            # Assert - Verify data was sent
            call_kwargs = mock_request.call_args[1]
            assert "content" in call_kwargs or "data" in call_kwargs

    def test_unauthorized_access_with_invalid_key(self, plugin_client, mock_config):
        """Test handling of unauthorized access with invalid API key."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps({"error_type": "PluginDaemonUnauthorizedError", "message": "Invalid API key"})
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonUnauthorizedError) as exc_info:
                plugin_client._request_with_plugin_daemon_response("GET", "plugin/test-tenant/test", bool)
            assert "Invalid API key" in exc_info.value.description

    def test_request_parameter_validation(self, plugin_client, mock_config):
        """Test validation of request parameters."""
        # Arrange
        invalid_params = {
            "page": -1,  # Invalid negative page
            "limit": 0,  # Invalid zero limit
        }

        mock_response = MagicMock()
        mock_response.status_code = 200
        error_message = json.dumps(
            {"error_type": "PluginDaemonBadRequestError", "message": "Invalid parameters: page must be positive"}
        )
        mock_response.json.return_value = {"code": -1, "message": error_message, "data": None}

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert
            with pytest.raises(PluginDaemonBadRequestError) as exc_info:
                plugin_client._request_with_plugin_daemon_response(
                    "GET", "plugin/test-tenant/list", list, params=invalid_params
                )
            assert "Invalid parameters" in exc_info.value.description

    def test_content_type_header_validation(self, plugin_client, mock_config):
        """Test that Content-Type header is properly set for JSON requests."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200

        with patch("httpx.request", return_value=mock_response) as mock_request:
            # Act
            plugin_client._request(
                "POST", "plugin/test-tenant/test", headers={"Content-Type": "application/json"}, data={"key": "value"}
            )

            # Assert
            call_kwargs = mock_request.call_args[1]
            assert call_kwargs["headers"]["Content-Type"] == "application/json"


class TestPluginRuntimePerformanceScenarios:
    """Tests for performance-related scenarios in plugin runtime.

    Tests cover:
    - High-volume streaming
    - Concurrent operations simulation
    - Memory-efficient processing
    - Timeout handling under load
    """

    @pytest.fixture
    def plugin_client(self):
        """Create a BasePluginClient instance for testing."""
        return BasePluginClient()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_high_volume_streaming(self, plugin_client, mock_config):
        """Test streaming with high volume of chunks."""

        # Arrange
        class StreamChunk(BaseModel):
            index: int
            value: str

        # Generate 100 chunks
        stream_data = [
            f'{{"code": 0, "message": "", "data": {{"index": {i}, "value": "chunk_{i}"}}}}' for i in range(100)
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                plugin_client._request_with_plugin_daemon_response_stream(
                    "POST", "plugin/test-tenant/high-volume", StreamChunk
                )
            )

            # Assert
            assert len(results) == 100
            assert results[0].index == 0
            assert results[99].index == 99
            assert results[50].value == "chunk_50"

    def test_streaming_memory_efficiency(self, plugin_client, mock_config):
        """Test that streaming processes chunks one at a time (memory efficient)."""

        # Arrange
        class ChunkModel(BaseModel):
            data: str

        processed_chunks = []

        def process_chunk(chunk):
            """Simulate processing each chunk individually."""
            processed_chunks.append(chunk.data)
            return chunk

        stream_data = [f'{{"code": 0, "message": "", "data": {{"data": "chunk_{i}"}}}}' for i in range(10)]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act - Process chunks one by one
            for chunk in plugin_client._request_with_plugin_daemon_response_stream(
                "POST", "plugin/test-tenant/stream", ChunkModel
            ):
                process_chunk(chunk)

            # Assert
            assert len(processed_chunks) == 10

    def test_timeout_with_slow_response(self, plugin_client, mock_config):
        """Test timeout handling with slow response simulation."""
        # Arrange
        with patch("httpx.request", side_effect=httpx.TimeoutException("Request timed out after 30s")):
            # Act & Assert
            with pytest.raises(PluginDaemonInnerError) as exc_info:
                plugin_client._request("GET", "plugin/test-tenant/slow-endpoint")
            assert exc_info.value.code == -500

    def test_concurrent_request_simulation(self, plugin_client, mock_config):
        """Test simulation of concurrent requests (sequential execution in test)."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": True}

        request_results = []

        with patch("httpx.request", return_value=mock_response):
            # Act - Simulate 10 concurrent requests
            for i in range(10):
                result = plugin_client._request_with_plugin_daemon_response(
                    "GET", f"plugin/test-tenant/concurrent/{i}", bool
                )
                request_results.append(result)

            # Assert
            assert len(request_results) == 10
            assert all(result is True for result in request_results)


class TestPluginToolManagerAdvanced:
    """Advanced tests for PluginToolManager functionality.

    Tests cover:
    - Complex tool invocations
    - Runtime parameter handling
    - Tool provider discovery
    - Advanced credential scenarios
    """

    @pytest.fixture
    def tool_manager(self):
        """Create a PluginToolManager instance for testing."""
        return PluginToolManager()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_tool_invocation_with_complex_parameters(self, tool_manager, mock_config):
        """Test tool invocation with complex parameter structures."""
        # Arrange
        complex_params = {
            "simple_string": "value",
            "number": 42,
            "boolean": True,
            "nested_object": {"key1": "value1", "key2": ["item1", "item2"]},
            "array": [1, 2, 3, 4, 5],
        }

        stream_data = [
            (
                'data: {"code": 0, "message": "", "data": {"type": "text", '
                '"message": {"text": "Complex params processed"}}}'
            ),
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                tool_manager.invoke(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    tool_provider="langgenius/test-plugin/test-provider",
                    tool_name="complex-tool",
                    credentials={"api_key": "test-key"},
                    credential_type=CredentialType.API_KEY,
                    tool_parameters=complex_params,
                )
            )

            # Assert
            assert len(results) > 0

    def test_tool_invocation_with_conversation_context(self, tool_manager, mock_config):
        """Test tool invocation with conversation context."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"type": "text", "message": {"text": "Context-aware result"}}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            results = list(
                tool_manager.invoke(
                    tenant_id="test-tenant",
                    user_id="test-user",
                    tool_provider="langgenius/test-plugin/test-provider",
                    tool_name="test-tool",
                    credentials={"api_key": "test-key"},
                    credential_type=CredentialType.API_KEY,
                    tool_parameters={"query": "test"},
                    conversation_id="conv-123",
                    app_id="app-456",
                    message_id="msg-789",
                )
            )

            # Assert
            assert len(results) > 0

    def test_get_runtime_parameters_success(self, tool_manager, mock_config):
        """Test successful retrieval of runtime parameters."""
        # Arrange
        stream_data = [
            'data: {"code": 0, "message": "", "data": {"parameters": []}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            result = tool_manager.get_runtime_parameters(
                tenant_id="test-tenant",
                user_id="test-user",
                provider="langgenius/test-plugin/test-provider",
                credentials={"api_key": "test-key"},
                tool="test-tool",
            )

            # Assert
            assert isinstance(result, list)

    def test_validate_credentials_with_oauth(self, tool_manager, mock_config):
        """Test credential validation with OAuth credentials."""
        # Arrange
        oauth_credentials = {
            "access_token": "oauth-token-123",
            "refresh_token": "refresh-token-456",
            "expires_at": 1234567890,
        }

        stream_data = [
            'data: {"code": 0, "message": "", "data": {"result": true}}',
        ]

        mock_response = MagicMock()
        mock_response.iter_lines.return_value = [line.encode("utf-8") for line in stream_data]

        with patch("httpx.stream") as mock_stream:
            mock_stream.return_value.__enter__.return_value = mock_response

            # Act
            result = tool_manager.validate_provider_credentials(
                tenant_id="test-tenant",
                user_id="test-user",
                provider="langgenius/test-plugin/oauth-provider",
                credentials=oauth_credentials,
            )

            # Assert
            assert result is True


class TestPluginInstallerAdvanced:
    """Advanced tests for PluginInstaller functionality.

    Tests cover:
    - Plugin package upload
    - Bundle installation
    - Plugin upgrade scenarios
    - Dependency management
    """

    @pytest.fixture
    def installer(self):
        """Create a PluginInstaller instance for testing."""
        return PluginInstaller()

    @pytest.fixture
    def mock_config(self):
        """Mock plugin daemon configuration."""
        with (
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_URL", "http://127.0.0.1:5002"),
            patch("core.plugin.impl.base.dify_config.PLUGIN_DAEMON_KEY", "test-key"),
        ):
            yield

    def test_upload_plugin_package_success(self, installer, mock_config):
        """Test successful plugin package upload."""
        # Arrange
        plugin_package = b"fake-plugin-package-data"
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": 0,
            "message": "",
            "data": {
                "unique_identifier": "test-org/test-plugin",
                "manifest": {
                    "version": "1.0.0",
                    "author": "test-org",
                    "name": "test-plugin",
                    "description": {"en_US": "Test plugin"},
                    "icon": "icon.png",
                    "label": {"en_US": "Test Plugin"},
                    "created_at": "2024-01-01T00:00:00Z",
                    "resource": {"memory": 256},
                    "plugins": {},
                    "meta": {},
                },
                "verification": None,
            },
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.upload_pkg("test-tenant", plugin_package, verify_signature=False)

            # Assert
            assert result.unique_identifier == "test-org/test-plugin"

    def test_fetch_plugin_readme_success(self, installer, mock_config):
        """Test successful plugin readme fetch."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": 0,
            "message": "",
            "data": {"content": "# Plugin README\n\nThis is a test plugin.", "language": "en"},
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.fetch_plugin_readme("test-tenant", "test-org/test-plugin", "en")

            # Assert
            assert "Plugin README" in result
            assert "test plugin" in result

    def test_fetch_plugin_readme_not_found(self, installer, mock_config):
        """Test plugin readme fetch when readme doesn't exist."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 404

        def raise_for_status():
            raise httpx.HTTPStatusError("Not Found", request=MagicMock(), response=mock_response)

        mock_response.raise_for_status = raise_for_status

        with patch("httpx.request", return_value=mock_response):
            # Act & Assert - Should raise HTTPStatusError for 404
            with pytest.raises(httpx.HTTPStatusError):
                installer.fetch_plugin_readme("test-tenant", "test-org/test-plugin", "en")

    def test_list_plugins_with_pagination(self, installer, mock_config):
        """Test plugin listing with pagination."""
        # Arrange
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "code": 0,
            "message": "",
            "data": {
                "list": [],
                "total": 50,
            },
        }

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.list_plugins_with_total("test-tenant", page=2, page_size=20)

            # Assert
            assert result.total == 50
            assert isinstance(result.list, list)

    def test_check_tools_existence(self, installer, mock_config):
        """Test checking existence of multiple tools."""
        # Arrange
        from models.provider_ids import GenericProviderID

        provider_ids = [
            GenericProviderID("langgenius/plugin1/provider1"),
            GenericProviderID("langgenius/plugin2/provider2"),
        ]

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"code": 0, "message": "", "data": [True, False]}

        with patch("httpx.request", return_value=mock_response):
            # Act
            result = installer.check_tools_existence("test-tenant", provider_ids)

            # Assert
            assert len(result) == 2
            assert result[0] is True
            assert result[1] is False
