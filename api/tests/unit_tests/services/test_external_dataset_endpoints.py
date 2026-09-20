"""external dataset endpoints tests."""

import json
from unittest.mock import MagicMock, patch

import pytest

from services.entities.external_knowledge_entities.external_knowledge_entities import (
    Authorization,
    AuthorizationConfig,
)
from services.external_knowledge_service import ExternalDatasetService
from tests.unit_tests.services._external_dataset_helpers import (
    ExternalDatasetServiceTestDataFactory,
)
from tests.unit_tests.services._external_dataset_helpers import (
    factory as factory,  # noqa: PLC0414 - register the shared pytest fixture
)


class TestExternalDatasetServiceCheckEndpoint:
    """Test check_endpoint_and_api_key operations - extensive coverage."""

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_success_https(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with HTTPS endpoint."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)
        mock_proxy.post.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_success_http(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test successful validation with HTTP endpoint."""
        # Arrange
        settings = {"endpoint": "http://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_sends_json_body(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Regression for #39402: the validation probe must POST a JSON body matching the
        External Knowledge API retrieval contract, not a body-less request that providers
        such as RAGFlow reject (empty POST -> 502 ERR_ZERO_SIZE_OBJECT)."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act
        ExternalDatasetService.check_endpoint_and_api_key(settings)

        # Assert - a non-empty JSON body is sent with the JSON content type
        mock_proxy.post.assert_called_once()
        _, call_kwargs = mock_proxy.post.call_args
        assert call_kwargs["headers"]["Content-Type"] == "application/json"
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-key"
        sent_body = json.loads(call_kwargs["data"])
        assert "knowledge_id" in sent_body
        assert "query" in sent_body
        assert sent_body["retrieval_setting"] == {"top_k": 1, "score_threshold": 0.0}

    def test_check_endpoint_missing_endpoint_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint key is missing."""
        # Arrange
        settings = {"api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_empty_endpoint_string(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is empty string."""
        # Arrange
        settings = {"endpoint": "", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="endpoint is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_whitespace_endpoint(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when endpoint is only whitespace."""
        # Arrange
        settings = {"endpoint": "   ", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_missing_api_key_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when api_key key is missing."""
        # Arrange
        settings = {"endpoint": "https://api.example.com"}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_empty_api_key_string(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails when api_key is empty string."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": ""}

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_no_scheme_url(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL without http:// or https://."""
        # Arrange
        settings = {"endpoint": "api.example.com", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint.*must start with http"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_invalid_scheme(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL with invalid scheme."""
        # Arrange
        settings = {"endpoint": "ftp://api.example.com", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_no_netloc(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for URL without network location."""
        # Arrange
        settings = {"endpoint": "http://", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    def test_check_endpoint_malformed_url(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails for malformed URL."""
        # Arrange
        settings = {"endpoint": "https:///invalid", "api_key": "test-key"}

        # Act & Assert
        with pytest.raises(ValueError, match="invalid endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_connection_timeout(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails on connection timeout."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}
        mock_proxy.post.side_effect = Exception("Connection timeout")

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_network_error(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails on network error."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}
        mock_proxy.post.side_effect = Exception("Network unreachable")

        # Act & Assert
        with pytest.raises(ValueError, match="failed to connect to the endpoint"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_502_bad_gateway(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 502 Bad Gateway."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 502
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Bad Gateway.*failed to connect"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_404_not_found(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 404 Not Found."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 404
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Not Found.*failed to connect"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_403_forbidden(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation fails with 403 Forbidden (auth failure)."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "wrong-key"}

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_proxy.post.return_value = mock_response

        # Act & Assert
        with pytest.raises(ValueError, match="Forbidden.*Authorization failed"):
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_403_message_does_not_echo_api_key(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Regression for #39888: the 403 error message must not contain the raw api_key.

        Before the fix, `external_knowledge_service.py:117` interpolated
        `api_key` into the `ValueError` message, so the credential round-tripped
        in the application log (via `current_app.logger.exception` in
        `api/libs/external_api.py:94`) and in the 400 response body
        (`{"code": "invalid_param", "message": str(e), ...}`). The 403 status
        from the upstream provider was the only signal that the key was bad;
        echoing it back is just a plaintext credential leak.
        """
        # Arrange -- a real-looking key with a prefix that would be a high-signal
        # substring to grep for in logs.
        api_key = "sk-abcdefghijklmnop1234567890ABCDEF"
        settings = {"endpoint": "https://api.example.com", "api_key": api_key}

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_proxy.post.return_value = mock_response

        # Act
        with pytest.raises(ValueError) as exc_info:
            ExternalDatasetService.check_endpoint_and_api_key(settings)

        # Assert -- the message names the failure but does not include the key.
        message = str(exc_info.value)
        assert "Forbidden" in message
        assert "Authorization failed" in message
        assert api_key not in message
        # Belt-and-braces: also check the prefix and a 6-char tail to catch
        # regressions that only echo part of the key.
        assert "sk-abcdef" not in message
        assert "CDEF" not in message

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_other_4xx_codes_pass(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that other 4xx codes don't raise exceptions."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        for status_code in [400, 401, 405, 429]:
            mock_response = MagicMock()
            mock_response.status_code = status_code
            mock_proxy.post.return_value = mock_response

            # Act & Assert - should not raise
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_5xx_codes_except_502_pass(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that 5xx codes except 502 don't raise exceptions."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key"}

        for status_code in [500, 501, 503, 504]:
            mock_response = MagicMock()
            mock_response.status_code = status_code
            mock_proxy.post.return_value = mock_response

            # Act & Assert - should not raise
            ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_with_port_number(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation with endpoint including port number."""
        # Arrange
        settings = {"endpoint": "https://api.example.com:8443", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_with_path(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test validation with endpoint including path."""
        # Arrange
        settings = {"endpoint": "https://api.example.com/v1/api", "api_key": "test-key"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act & Assert - should not raise
        ExternalDatasetService.check_endpoint_and_api_key(settings)
        # Verify /retrieval is appended
        call_args = mock_proxy.post.call_args
        assert "/retrieval" in call_args[0][0]

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_check_endpoint_authorization_header_format(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test that Authorization header is properly formatted."""
        # Arrange
        settings = {"endpoint": "https://api.example.com", "api_key": "test-key-123"}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_proxy.post.return_value = mock_response

        # Act
        ExternalDatasetService.check_endpoint_and_api_key(settings)

        # Assert
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "headers" in call_kwargs
        assert call_kwargs["headers"]["Authorization"] == "Bearer test-key-123"


class TestExternalDatasetServiceProcessAPI:
    """Test process_external_api operations - comprehensive HTTP method coverage."""

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_get_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing GET request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="get")

        mock_response = MagicMock()
        mock_proxy.get.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.get.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_post_request_with_data(
        self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory
    ):
        """Test processing POST request with data."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="post", params={"key": "value", "data": "test"})

        mock_response = MagicMock()
        mock_proxy.post.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.post.assert_called_once()
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "data" in call_kwargs

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_put_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing PUT request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="put")

        mock_response = MagicMock()
        mock_proxy.put.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.put.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_delete_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing DELETE request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="delete")

        mock_response = MagicMock()
        mock_proxy.delete.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.delete.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_patch_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing PATCH request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="patch")

        mock_response = MagicMock()
        mock_proxy.patch.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.patch.assert_called_once()

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_head_request(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing HEAD request."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="head")

        mock_response = MagicMock()
        mock_proxy.head.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, None)

        # Assert
        assert result == mock_response
        mock_proxy.head.assert_called_once()

    def test_process_external_api_invalid_method(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error for invalid HTTP method."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="INVALID")

        # Act & Assert
        with pytest.raises(Exception, match="Invalid http method"):
            ExternalDatasetService.process_external_api(settings, None)

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_with_files(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test processing request with file uploads."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="post")
        files = {"file": ("test.txt", b"file content")}

        mock_response = MagicMock()
        mock_proxy.post.return_value = mock_response

        # Act
        result = ExternalDatasetService.process_external_api(settings, files)

        # Assert
        assert result == mock_response
        call_kwargs = mock_proxy.post.call_args.kwargs
        assert "files" in call_kwargs
        assert call_kwargs["files"] == files

    @patch("services.external_knowledge_service.ssrf_proxy")
    def test_process_external_api_follow_redirects(self, mock_proxy, factory: ExternalDatasetServiceTestDataFactory):
        """Test that follow_redirects is enabled."""
        # Arrange
        settings = factory.create_api_setting_mock(request_method="get")

        mock_response = MagicMock()
        mock_proxy.get.return_value = mock_response

        # Act
        ExternalDatasetService.process_external_api(settings, None)

        # Assert
        call_kwargs = mock_proxy.get.call_args.kwargs
        assert call_kwargs["follow_redirects"] is True


class TestExternalDatasetServiceAssemblingHeaders:
    """Test assembling_headers operations - comprehensive authorization coverage."""

    def test_assembling_headers_bearer_token(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with Bearer token."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="secret-key-123")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["Authorization"] == "Bearer secret-key-123"

    def test_assembling_headers_basic_auth(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with Basic authentication."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="basic", api_key="credentials")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["Authorization"] == "Basic credentials"

    def test_assembling_headers_custom_auth(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with custom authentication."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="custom", api_key="custom-token")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["Authorization"] == "custom-token"

    def test_assembling_headers_custom_header_name(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with custom header name."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="key-123", header="X-API-Key")

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert result["X-API-Key"] == "Bearer key-123"
        assert "Authorization" not in result

    def test_assembling_headers_with_existing_headers(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers preserves existing headers."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="key")
        existing_headers = {
            "Content-Type": "application/json",
            "X-Custom": "value",
            "User-Agent": "TestAgent/1.0",
        }

        # Act
        result = ExternalDatasetService.assembling_headers(authorization, existing_headers)

        # Assert
        assert result["Authorization"] == "Bearer key"
        assert result["Content-Type"] == "application/json"
        assert result["X-Custom"] == "value"
        assert result["User-Agent"] == "TestAgent/1.0"

    def test_assembling_headers_empty_existing_headers(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test assembling headers with empty existing headers dict."""
        # Arrange
        authorization = factory.create_authorization_mock(token_type="bearer", api_key="key")
        existing_headers = {}

        # Act
        result = ExternalDatasetService.assembling_headers(authorization, existing_headers)

        # Assert
        assert result["Authorization"] == "Bearer key"
        assert len(result) == 1

    def test_assembling_headers_missing_api_key(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error when API key is missing."""
        # Arrange
        config = AuthorizationConfig(api_key=None, type="bearer", header="Authorization")
        authorization = Authorization(type="api-key", config=config)

        # Act & Assert
        with pytest.raises(ValueError, match="api_key is required"):
            ExternalDatasetService.assembling_headers(authorization)

    def test_assembling_headers_missing_config(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test error when config is missing."""
        # Arrange
        authorization = Authorization(type="api-key", config=None)

        # Act & Assert
        with pytest.raises(ValueError, match="authorization config is required"):
            ExternalDatasetService.assembling_headers(authorization)

    def test_assembling_headers_default_header_name(self, factory: ExternalDatasetServiceTestDataFactory):
        """Test that default header name is Authorization when not specified."""
        # Arrange
        config = AuthorizationConfig(api_key="key", type="bearer", header=None)
        authorization = Authorization(type="api-key", config=config)

        # Act
        result = ExternalDatasetService.assembling_headers(authorization)

        # Assert
        assert "Authorization" in result
