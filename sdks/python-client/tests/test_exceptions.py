"""Tests for custom exceptions."""

import unittest
from dify_client.exceptions import (
    DifyClientError,
    APIError,
    AuthenticationError,
    RateLimitError,
    ValidationError,
    NetworkError,
    TimeoutError,
    FileUploadError,
    DatasetError,
    WorkflowError,
)


class TestExceptions(unittest.TestCase):
    """Test custom exception classes."""

    def test_base_exception(self):
        """Test base DifyClientError."""
        error = DifyClientError("Test message", 500, {"error": "details"})
        self.assertEqual(str(error), "Test message")
        self.assertEqual(error.status_code, 500)
        self.assertEqual(error.response, {"error": "details"})

    def test_api_error(self):
        """Test APIError."""
        error = APIError("API failed", 400)
        self.assertEqual(error.status_code, 400)
        self.assertEqual(error.message, "API failed")

    def test_authentication_error(self):
        """Test AuthenticationError."""
        error = AuthenticationError("Invalid API key")
        self.assertEqual(str(error), "Invalid API key")

    def test_rate_limit_error(self):
        """Test RateLimitError."""
        error = RateLimitError("Rate limited", retry_after=60)
        self.assertEqual(error.retry_after, 60)

        error_default = RateLimitError()
        self.assertEqual(error_default.retry_after, None)

    def test_validation_error(self):
        """Test ValidationError."""
        error = ValidationError("Invalid parameter")
        self.assertEqual(str(error), "Invalid parameter")

    def test_network_error(self):
        """Test NetworkError."""
        error = NetworkError("Connection failed")
        self.assertEqual(str(error), "Connection failed")

    def test_timeout_error(self):
        """Test TimeoutError."""
        error = TimeoutError("Request timed out")
        self.assertEqual(str(error), "Request timed out")

    def test_file_upload_error(self):
        """Test FileUploadError."""
        error = FileUploadError("Upload failed")
        self.assertEqual(str(error), "Upload failed")

    def test_dataset_error(self):
        """Test DatasetError."""
        error = DatasetError("Dataset operation failed")
        self.assertEqual(str(error), "Dataset operation failed")

    def test_workflow_error(self):
        """Test WorkflowError."""
        error = WorkflowError("Workflow failed")
        self.assertEqual(str(error), "Workflow failed")


if __name__ == "__main__":
    unittest.main()
