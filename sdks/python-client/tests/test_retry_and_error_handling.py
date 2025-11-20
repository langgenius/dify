"""Unit tests for retry mechanism and error handling."""

import unittest
from unittest.mock import Mock, patch, MagicMock
import httpx
from dify_client.client import DifyClient
from dify_client.exceptions import (
    APIError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
    NetworkError,
    TimeoutError,
    FileUploadError,
)


class TestRetryMechanism(unittest.TestCase):
    """Test cases for retry mechanism."""

    def setUp(self):
        self.api_key = "test_api_key"
        self.base_url = "https://api.dify.ai/v1"
        self.client = DifyClient(
            api_key=self.api_key,
            base_url=self.base_url,
            max_retries=3,
            retry_delay=0.1,  # Short delay for tests
            enable_logging=False,
        )

    @patch("httpx.Client.request")
    def test_successful_request_no_retry(self, mock_request):
        """Test that successful requests don't trigger retries."""
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.content = b'{"success": true}'
        mock_request.return_value = mock_response

        response = self.client._send_request("GET", "/test")

        self.assertEqual(response, mock_response)
        self.assertEqual(mock_request.call_count, 1)

    @patch("httpx.Client.request")
    @patch("time.sleep")
    def test_retry_on_network_error(self, mock_sleep, mock_request):
        """Test retry on network errors."""
        # First two calls raise network error, third succeeds
        mock_request.side_effect = [
            httpx.NetworkError("Connection failed"),
            httpx.NetworkError("Connection failed"),
            Mock(status_code=200, content=b'{"success": true}'),
        ]
        mock_response = Mock()
        mock_response.status_code = 200
        mock_response.content = b'{"success": true}'

        response = self.client._send_request("GET", "/test")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_request.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)

    @patch("httpx.Client.request")
    @patch("time.sleep")
    def test_retry_on_timeout_error(self, mock_sleep, mock_request):
        """Test retry on timeout errors."""
        mock_request.side_effect = [
            httpx.TimeoutException("Request timed out"),
            httpx.TimeoutException("Request timed out"),
            Mock(status_code=200, content=b'{"success": true}'),
        ]

        response = self.client._send_request("GET", "/test")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock_request.call_count, 3)
        self.assertEqual(mock_sleep.call_count, 2)

    @patch("httpx.Client.request")
    @patch("time.sleep")
    def test_max_retries_exceeded(self, mock_sleep, mock_request):
        """Test behavior when max retries are exceeded."""
        mock_request.side_effect = httpx.NetworkError("Persistent network error")

        with self.assertRaises(NetworkError):
            self.client._send_request("GET", "/test")

        self.assertEqual(mock_request.call_count, 4)  # 1 initial + 3 retries
        self.assertEqual(mock_sleep.call_count, 3)

    @patch("httpx.Client.request")
    def test_no_retry_on_client_error(self, mock_request):
        """Test that client errors (4xx) don't trigger retries."""
        mock_response = Mock()
        mock_response.status_code = 401
        mock_response.json.return_value = {"message": "Unauthorized"}
        mock_request.return_value = mock_response

        with self.assertRaises(AuthenticationError):
            self.client._send_request("GET", "/test")

        self.assertEqual(mock_request.call_count, 1)

    @patch("httpx.Client.request")
    def test_retry_on_server_error(self, mock_request):
        """Test that server errors (5xx) don't retry - they raise APIError immediately."""
        mock_response_500 = Mock()
        mock_response_500.status_code = 500
        mock_response_500.json.return_value = {"message": "Internal server error"}

        mock_request.return_value = mock_response_500

        with self.assertRaises(APIError) as context:
            self.client._send_request("GET", "/test")

        self.assertEqual(str(context.exception), "Internal server error")
        self.assertEqual(context.exception.status_code, 500)
        # Should not retry server errors
        self.assertEqual(mock_request.call_count, 1)

    @patch("httpx.Client.request")
    def test_exponential_backoff(self, mock_request):
        """Test exponential backoff timing."""
        mock_request.side_effect = [
            httpx.NetworkError("Connection failed"),
            httpx.NetworkError("Connection failed"),
            httpx.NetworkError("Connection failed"),
            httpx.NetworkError("Connection failed"),  # All attempts fail
        ]

        with patch("time.sleep") as mock_sleep:
            with self.assertRaises(NetworkError):
                self.client._send_request("GET", "/test")

            # Check exponential backoff: 0.1, 0.2, 0.4
            expected_calls = [0.1, 0.2, 0.4]
            actual_calls = [call[0][0] for call in mock_sleep.call_args_list]
            self.assertEqual(actual_calls, expected_calls)


class TestErrorHandling(unittest.TestCase):
    """Test cases for error handling."""

    def setUp(self):
        self.client = DifyClient(api_key="test_api_key", enable_logging=False)

    @patch("httpx.Client.request")
    def test_authentication_error(self, mock_request):
        """Test AuthenticationError handling."""
        mock_response = Mock()
        mock_response.status_code = 401
        mock_response.json.return_value = {"message": "Invalid API key"}
        mock_request.return_value = mock_response

        with self.assertRaises(AuthenticationError) as context:
            self.client._send_request("GET", "/test")

        self.assertEqual(str(context.exception), "Invalid API key")
        self.assertEqual(context.exception.status_code, 401)

    @patch("httpx.Client.request")
    def test_rate_limit_error(self, mock_request):
        """Test RateLimitError handling."""
        mock_response = Mock()
        mock_response.status_code = 429
        mock_response.json.return_value = {"message": "Rate limit exceeded"}
        mock_response.headers = {"Retry-After": "60"}
        mock_request.return_value = mock_response

        with self.assertRaises(RateLimitError) as context:
            self.client._send_request("GET", "/test")

        self.assertEqual(str(context.exception), "Rate limit exceeded")
        self.assertEqual(context.exception.retry_after, "60")

    @patch("httpx.Client.request")
    def test_validation_error(self, mock_request):
        """Test ValidationError handling."""
        mock_response = Mock()
        mock_response.status_code = 422
        mock_response.json.return_value = {"message": "Invalid parameters"}
        mock_request.return_value = mock_response

        with self.assertRaises(ValidationError) as context:
            self.client._send_request("GET", "/test")

        self.assertEqual(str(context.exception), "Invalid parameters")
        self.assertEqual(context.exception.status_code, 422)

    @patch("httpx.Client.request")
    def test_api_error(self, mock_request):
        """Test general APIError handling."""
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.json.return_value = {"message": "Internal server error"}
        mock_request.return_value = mock_response

        with self.assertRaises(APIError) as context:
            self.client._send_request("GET", "/test")

        self.assertEqual(str(context.exception), "Internal server error")
        self.assertEqual(context.exception.status_code, 500)

    @patch("httpx.Client.request")
    def test_error_response_without_json(self, mock_request):
        """Test error handling when response doesn't contain valid JSON."""
        mock_response = Mock()
        mock_response.status_code = 500
        mock_response.content = b"Internal Server Error"
        mock_response.json.side_effect = ValueError("No JSON object could be decoded")
        mock_request.return_value = mock_response

        with self.assertRaises(APIError) as context:
            self.client._send_request("GET", "/test")

        self.assertEqual(str(context.exception), "HTTP 500")

    @patch("httpx.Client.request")
    def test_file_upload_error(self, mock_request):
        """Test FileUploadError handling."""
        mock_response = Mock()
        mock_response.status_code = 400
        mock_response.json.return_value = {"message": "File upload failed"}
        mock_request.return_value = mock_response

        with self.assertRaises(FileUploadError) as context:
            self.client._send_request_with_files("POST", "/upload", {}, {})

        self.assertEqual(str(context.exception), "File upload failed")
        self.assertEqual(context.exception.status_code, 400)


class TestParameterValidation(unittest.TestCase):
    """Test cases for parameter validation."""

    def setUp(self):
        self.client = DifyClient(api_key="test_api_key", enable_logging=False)

    def test_empty_string_validation(self):
        """Test validation of empty strings."""
        with self.assertRaises(ValidationError):
            self.client._validate_params(empty_string="")

    def test_whitespace_only_string_validation(self):
        """Test validation of whitespace-only strings."""
        with self.assertRaises(ValidationError):
            self.client._validate_params(whitespace_string="   ")

    def test_long_string_validation(self):
        """Test validation of overly long strings."""
        long_string = "a" * 10001  # Exceeds 10000 character limit
        with self.assertRaises(ValidationError):
            self.client._validate_params(long_string=long_string)

    def test_large_list_validation(self):
        """Test validation of overly large lists."""
        large_list = list(range(1001))  # Exceeds 1000 item limit
        with self.assertRaises(ValidationError):
            self.client._validate_params(large_list=large_list)

    def test_large_dict_validation(self):
        """Test validation of overly large dictionaries."""
        large_dict = {f"key_{i}": i for i in range(101)}  # Exceeds 100 item limit
        with self.assertRaises(ValidationError):
            self.client._validate_params(large_dict=large_dict)

    def test_valid_parameters_pass(self):
        """Test that valid parameters pass validation."""
        # Should not raise any exception
        self.client._validate_params(
            valid_string="Hello, World!",
            valid_list=[1, 2, 3],
            valid_dict={"key": "value"},
            none_value=None,
        )

    def test_message_feedback_validation(self):
        """Test validation in message_feedback method."""
        with self.assertRaises(ValidationError):
            self.client.message_feedback("msg_id", "invalid_rating", "user")

    def test_completion_message_validation(self):
        """Test validation in create_completion_message method."""
        from dify_client.client import CompletionClient

        client = CompletionClient("test_api_key")

        with self.assertRaises(ValidationError):
            client.create_completion_message(
                inputs="not_a_dict",  # Should be a dict
                response_mode="invalid_mode",  # Should be 'blocking' or 'streaming'
                user="test_user",
            )

    def test_chat_message_validation(self):
        """Test validation in create_chat_message method."""
        from dify_client.client import ChatClient

        client = ChatClient("test_api_key")

        with self.assertRaises(ValidationError):
            client.create_chat_message(
                inputs="not_a_dict",  # Should be a dict
                query="",  # Should not be empty
                user="test_user",
                response_mode="invalid_mode",  # Should be 'blocking' or 'streaming'
            )


if __name__ == "__main__":
    unittest.main()
