"""Tests for exists() in AwsS3Storage and OracleOCIStorage.

Verifies that:
  1. True is returned when head_object succeeds (file exists).
  2. False is returned only for genuine "not found" responses (404 / NoSuchKey).
  3. All other ClientErrors (403 Forbidden, 429 Throttling, 5xx, etc.) propagate
     rather than being silently swallowed as False.
  4. Non-ClientError exceptions (network, unexpected) also propagate.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "test"}}, "HeadObject")


# ---------------------------------------------------------------------------
# AwsS3Storage
# ---------------------------------------------------------------------------

class TestAwsS3StorageExists:
    """exists() on AwsS3Storage should distinguish 'not found' from real errors."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        with patch("extensions.storage.aws_s3_storage.dify_config") as cfg:
            cfg.S3_USE_AWS_MANAGED_IAM = False
            cfg.S3_SECRET_KEY = "secret"
            cfg.S3_ACCESS_KEY = "access"
            cfg.S3_ENDPOINT = "http://localhost:9000"
            cfg.S3_REGION = "us-east-1"
            cfg.S3_ADDRESS_STYLE = "path"
            cfg.S3_BUCKET_NAME = "test-bucket"

            with patch("extensions.storage.aws_s3_storage.boto3") as mock_boto3:
                mock_client = MagicMock()
                mock_boto3.client.return_value = mock_client
                # suppress head_bucket during __init__
                mock_client.head_bucket.return_value = {}

                from extensions.storage.aws_s3_storage import AwsS3Storage
                self.storage = AwsS3Storage()
                self.mock_client = mock_client

    def test_returns_true_when_file_exists(self):
        self.mock_client.head_object.return_value = {"ContentLength": 42}
        assert self.storage.exists("path/to/file.txt") is True

    def test_returns_false_on_404(self):
        self.mock_client.head_object.side_effect = _client_error("404")
        assert self.storage.exists("path/to/missing.txt") is False

    def test_returns_false_on_no_such_key(self):
        self.mock_client.head_object.side_effect = _client_error("NoSuchKey")
        assert self.storage.exists("path/to/missing.txt") is False

    def test_raises_on_403_forbidden(self):
        self.mock_client.head_object.side_effect = _client_error("403")
        with pytest.raises(ClientError) as exc_info:
            self.storage.exists("path/to/file.txt")
        assert exc_info.value.response["Error"]["Code"] == "403"

    def test_raises_on_throttling(self):
        self.mock_client.head_object.side_effect = _client_error("SlowDown")
        with pytest.raises(ClientError):
            self.storage.exists("path/to/file.txt")

    def test_raises_on_internal_server_error(self):
        self.mock_client.head_object.side_effect = _client_error("500")
        with pytest.raises(ClientError):
            self.storage.exists("path/to/file.txt")

    def test_raises_on_non_client_error(self):
        self.mock_client.head_object.side_effect = ConnectionError("network failure")
        with pytest.raises(ConnectionError):
            self.storage.exists("path/to/file.txt")

    def test_raises_keyboard_interrupt(self):
        self.mock_client.head_object.side_effect = KeyboardInterrupt
        with pytest.raises(KeyboardInterrupt):
            self.storage.exists("path/to/file.txt")


# ---------------------------------------------------------------------------
# OracleOCIStorage
# ---------------------------------------------------------------------------

class TestOracleOCIStorageExists:
    """exists() on OracleOCIStorage should distinguish 'not found' from real errors."""

    @pytest.fixture(autouse=True)
    def _setup(self):
        with patch("extensions.storage.oracle_oci_storage.dify_config") as cfg:
            cfg.OCI_BUCKET_NAME = "test-bucket"
            cfg.OCI_SECRET_KEY = "secret"
            cfg.OCI_ACCESS_KEY = "access"
            cfg.OCI_ENDPOINT = "https://oci.example.com"
            cfg.OCI_REGION = "us-ashburn-1"

            with patch("extensions.storage.oracle_oci_storage.boto3") as mock_boto3:
                mock_client = MagicMock()
                mock_boto3.client.return_value = mock_client

                from extensions.storage.oracle_oci_storage import OracleOCIStorage
                self.storage = OracleOCIStorage()
                self.mock_client = mock_client

    def test_returns_true_when_file_exists(self):
        self.mock_client.head_object.return_value = {"ContentLength": 99}
        assert self.storage.exists("some/file.bin") is True

    def test_returns_false_on_404(self):
        self.mock_client.head_object.side_effect = _client_error("404")
        assert self.storage.exists("some/missing.bin") is False

    def test_returns_false_on_no_such_key(self):
        self.mock_client.head_object.side_effect = _client_error("NoSuchKey")
        assert self.storage.exists("some/missing.bin") is False

    def test_raises_on_403_forbidden(self):
        self.mock_client.head_object.side_effect = _client_error("403")
        with pytest.raises(ClientError) as exc_info:
            self.storage.exists("some/file.bin")
        assert exc_info.value.response["Error"]["Code"] == "403"

    def test_raises_on_throttling(self):
        self.mock_client.head_object.side_effect = _client_error("SlowDown")
        with pytest.raises(ClientError):
            self.storage.exists("some/file.bin")

    def test_raises_on_internal_server_error(self):
        self.mock_client.head_object.side_effect = _client_error("500")
        with pytest.raises(ClientError):
            self.storage.exists("some/file.bin")

    def test_raises_on_non_client_error(self):
        self.mock_client.head_object.side_effect = ConnectionError("network failure")
        with pytest.raises(ConnectionError):
            self.storage.exists("some/file.bin")

    def test_raises_keyboard_interrupt(self):
        self.mock_client.head_object.side_effect = KeyboardInterrupt
        with pytest.raises(KeyboardInterrupt):
            self.storage.exists("some/file.bin")
