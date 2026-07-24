import base64
import hashlib
import hmac
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core.datasource.datasource_file_manager import DatasourceFileManager
from models.model import MessageFile, UploadFile
from models.tools import ToolFile


class TestDatasourceFileManager:
    @patch("core.datasource.datasource_file_manager.time.time")
    @patch("core.datasource.datasource_file_manager.os.urandom")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_sign_file(self, mock_config, mock_urandom, mock_time):
        # Setup
        mock_config.FILES_URL = "http://localhost:5001"
        mock_config.SECRET_KEY = "test_secret"
        mock_time.return_value = 1700000000
        mock_urandom.return_value = b"1234567890abcdef"  # 16 bytes

        datasource_file_id = "file_id_123"
        extension = ".png"

        # Execute
        signed_url = DatasourceFileManager.sign_file(datasource_file_id, extension)

        # Verify
        assert signed_url.startswith("http://localhost:5001/files/datasources/file_id_123.png?")
        assert "timestamp=1700000000" in signed_url
        assert f"nonce={mock_urandom.return_value.hex()}" in signed_url
        assert "sign=" in signed_url

    @patch("core.datasource.datasource_file_manager.time.time")
    @patch("core.datasource.datasource_file_manager.os.urandom")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_sign_file_empty_secret(self, mock_config, mock_urandom, mock_time):
        # Setup
        mock_config.FILES_URL = "http://localhost:5001"
        mock_config.SECRET_KEY = None  # Empty secret
        mock_time.return_value = 1700000000
        mock_urandom.return_value = b"1234567890abcdef"

        # Execute
        signed_url = DatasourceFileManager.sign_file("file_id", ".png")
        assert "sign=" in signed_url

    @patch("core.datasource.datasource_file_manager.time.time")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_verify_file(self, mock_config, mock_time):
        # Setup
        mock_config.SECRET_KEY = "test_secret"
        mock_config.FILES_ACCESS_TIMEOUT = 300
        mock_time.return_value = 1700000000

        datasource_file_id = "file_id_123"
        timestamp = "1699999800"  # 200 seconds ago
        nonce = "some_nonce"

        # Manually calculate sign
        data_to_sign = f"file-preview|{datasource_file_id}|{timestamp}|{nonce}"
        secret_key = b"test_secret"
        sign = hmac.new(secret_key, data_to_sign.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        # Execute & Verify Success
        assert DatasourceFileManager.verify_file(datasource_file_id, timestamp, nonce, encoded_sign) is True

        # Verify Failure - Wrong Sign
        assert DatasourceFileManager.verify_file(datasource_file_id, timestamp, nonce, "wrong_sign") is False

        # Verify Failure - Timeout
        mock_time.return_value = 1700000500  # 700 seconds after timestamp (300 is timeout)
        assert DatasourceFileManager.verify_file(datasource_file_id, timestamp, nonce, encoded_sign) is False

    @patch("core.datasource.datasource_file_manager.time.time")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_verify_file_empty_secret(self, mock_config, mock_time):
        # Setup
        mock_config.SECRET_KEY = ""  # Empty string secret
        mock_config.FILES_ACCESS_TIMEOUT = 300
        mock_time.return_value = 1700000000

        datasource_file_id = "file_id_123"
        timestamp = "1699999800"
        nonce = "some_nonce"

        # Calculate with empty secret
        data_to_sign = f"file-preview|{datasource_file_id}|{timestamp}|{nonce}"
        sign = hmac.new(b"", data_to_sign.encode(), hashlib.sha256).digest()
        encoded_sign = base64.urlsafe_b64encode(sign).decode()

        assert DatasourceFileManager.verify_file(datasource_file_id, timestamp, nonce, encoded_sign) is True

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_create_file_by_raw(self, mock_config, mock_uuid, mock_storage, mock_db):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_config.STORAGE_TYPE = "local"

        user_id = "user_123"
        tenant_id = "tenant_456"
        file_binary = b"fake binary data"
        mimetype = "image/png"

        # Execute
        upload_file = DatasourceFileManager.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=file_binary,
            mimetype=mimetype,
            filename="test.png",
        )

        # Verify
        assert upload_file.tenant_id == tenant_id
        assert upload_file.name == "test.png"
        assert upload_file.size == len(file_binary)
        assert upload_file.mime_type == mimetype
        assert upload_file.key == f"datasources/{tenant_id}/unique_hex.png"

        mock_storage.save.assert_called_once_with(upload_file.key, file_binary)
        mock_db.session.add.assert_called_once()
        mock_db.session.commit.assert_called_once()

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_create_file_by_raw_filename_no_extension(self, mock_config, mock_uuid, mock_storage, mock_db):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_config.STORAGE_TYPE = "local"

        user_id = "user_123"
        tenant_id = "tenant_456"
        file_binary = b"fake binary data"
        mimetype = "image/png"

        # Execute
        upload_file = DatasourceFileManager.create_file_by_raw(
            user_id=user_id,
            tenant_id=tenant_id,
            conversation_id=None,
            file_binary=file_binary,
            mimetype=mimetype,
            filename="test",  # No extension
        )

        # Verify
        assert upload_file.name == "test.png"  # Should append extension

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    @patch("core.datasource.datasource_file_manager.guess_extension")
    def test_create_file_by_raw_unknown_extension(self, mock_guess_ext, mock_config, mock_uuid, mock_storage, mock_db):
        # Setup
        mock_guess_ext.return_value = None  # Cannot guess
        mock_uuid.return_value = MagicMock(hex="unique_hex")

        # Execute
        upload_file = DatasourceFileManager.create_file_by_raw(
            user_id="user",
            tenant_id="tenant",
            conversation_id=None,
            file_binary=b"data",
            mimetype="application/x-unknown",
        )

        # Verify
        assert upload_file.extension == ".bin"
        assert upload_file.name == "unique_hex.bin"

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_create_file_by_raw_no_filename(self, mock_config, mock_uuid, mock_storage, mock_db):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_config.STORAGE_TYPE = "local"

        # Execute
        upload_file = DatasourceFileManager.create_file_by_raw(
            user_id="user_123",
            tenant_id="tenant_456",
            conversation_id=None,
            file_binary=b"data",
            mimetype="application/pdf",
        )

        # Verify
        assert upload_file.name == "unique_hex.pdf"
        assert upload_file.extension == ".pdf"

    @patch("core.datasource.datasource_file_manager.ssrf_proxy")
    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    def test_create_file_by_url_mimetype_from_guess(self, mock_uuid, mock_storage, mock_db, mock_ssrf):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_response = MagicMock()
        mock_response.content = b"bits"
        mock_response.headers = {}  # No content-type in headers
        mock_ssrf.get.return_value = mock_response

        # Execute
        tool_file = DatasourceFileManager.create_file_by_url(
            user_id="user_123", tenant_id="tenant_456", file_url="https://example.com/photo.png"
        )

        # Verify
        assert tool_file.mimetype == "image/png"  # Guessed from .png in URL

    @patch("core.datasource.datasource_file_manager.ssrf_proxy")
    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    def test_create_file_by_url_mimetype_default(self, mock_uuid, mock_storage, mock_db, mock_ssrf):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_response = MagicMock()
        mock_response.content = b"bits"
        mock_response.headers = {}
        mock_ssrf.get.return_value = mock_response

        # Execute
        tool_file = DatasourceFileManager.create_file_by_url(
            user_id="user_123",
            tenant_id="tenant_456",
            file_url="https://example.com/unknown",  # No extension, no headers
        )

        # Verify
        assert tool_file.mimetype == "application/octet-stream"

    @patch("core.datasource.datasource_file_manager.ssrf_proxy")
    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    def test_create_file_by_url_success(self, mock_uuid, mock_storage, mock_db, mock_ssrf):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_response = MagicMock()
        mock_response.content = b"downloaded bits"
        mock_response.headers = {"Content-Type": "image/jpeg"}
        mock_ssrf.get.return_value = mock_response

        # Execute
        tool_file = DatasourceFileManager.create_file_by_url(
            user_id="user_123", tenant_id="tenant_456", file_url="https://example.com/photo.jpg"
        )

        # Verify
        assert tool_file.mimetype == "image/jpeg"
        assert tool_file.size == len(b"downloaded bits")
        assert tool_file.file_key == "tools/tenant_456/unique_hex.jpg"
        mock_storage.save.assert_called_once()

    @patch("core.datasource.datasource_file_manager.ssrf_proxy")
    def test_create_file_by_url_timeout(self, mock_ssrf):
        # Setup
        mock_ssrf.get.side_effect = httpx.TimeoutException("Timeout")

        # Execute & Verify
        with pytest.raises(ValueError, match="timeout when downloading file"):
            DatasourceFileManager.create_file_by_url(
                user_id="user_123", tenant_id="tenant_456", file_url="https://example.com/large.file"
            )

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary(self, mock_storage, mock_db):
        # Setup
        mock_upload_file = MagicMock(spec=UploadFile)
        mock_upload_file.key = "some_key"
        mock_upload_file.mime_type = "image/png"

        mock_query = mock_db.session.query.return_value
        mock_where = mock_query.where.return_value
        mock_where.first.return_value = mock_upload_file

        mock_storage.load_once.return_value = b"file content"

        # Execute
        result = DatasourceFileManager.get_file_binary("file_id")

        # Verify
        assert result == (b"file content", "image/png")

        # Case: Not found
        mock_where.first.return_value = None
        assert DatasourceFileManager.get_file_binary("unknown") is None

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary_by_message_file_id(self, mock_storage, mock_db):
        # Setup
        mock_message_file = MagicMock(spec=MessageFile)
        mock_message_file.url = "http://localhost/files/tools/tool_id.png"

        mock_tool_file = MagicMock(spec=ToolFile)
        mock_tool_file.file_key = "tool_key"
        mock_tool_file.mimetype = "image/png"

        # Mock query sequence
        def mock_query(model):
            m = MagicMock()
            if model == MessageFile:
                m.where.return_value.first.return_value = mock_message_file
            elif model == ToolFile:
                m.where.return_value.first.return_value = mock_tool_file
            return m

        mock_db.session.query.side_effect = mock_query
        mock_storage.load_once.return_value = b"tool content"

        # Execute
        result = DatasourceFileManager.get_file_binary_by_message_file_id("msg_file_id")

        # Verify
        assert result == (b"tool content", "image/png")

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary_by_message_file_id_with_extension(self, mock_storage, mock_db):
        # Test that it correctly parses tool_id even with extension in URL
        mock_message_file = MagicMock(spec=MessageFile)
        mock_message_file.url = "http://localhost/files/tools/abcdef.png"

        mock_tool_file = MagicMock(spec=ToolFile)
        mock_tool_file.id = "abcdef"
        mock_tool_file.file_key = "tk"
        mock_tool_file.mimetype = "image/png"

        def mock_query(model):
            m = MagicMock()
            if model == MessageFile:
                m.where.return_value.first.return_value = mock_message_file
            else:
                m.where.return_value.first.return_value = mock_tool_file
            return m

        mock_db.session.query.side_effect = mock_query
        mock_storage.load_once.return_value = b"bits"

        result = DatasourceFileManager.get_file_binary_by_message_file_id("m")
        assert result == (b"bits", "image/png")

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary_by_message_file_id_failures(self, mock_storage, mock_db):
        # Setup common mock
        mock_query_obj = MagicMock()
        mock_db.session.query.return_value = mock_query_obj
        mock_query_obj.where.return_value.first.return_value = None

        # Case 1: Message file not found
        assert DatasourceFileManager.get_file_binary_by_message_file_id("none") is None

        # Case 2: Message file found but tool file not found
        mock_message_file = MagicMock(spec=MessageFile)
        mock_message_file.url = None

        def mock_query_v2(model):
            m = MagicMock()
            if model == MessageFile:
                m.where.return_value.first.return_value = mock_message_file
            else:
                m.where.return_value.first.return_value = None
            return m

        mock_db.session.query.side_effect = mock_query_v2
        assert DatasourceFileManager.get_file_binary_by_message_file_id("msg_id") is None

    @patch("core.datasource.datasource_file_manager.db")
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_generator_by_upload_file_id(self, mock_storage, mock_db):
        # Setup
        mock_upload_file = MagicMock(spec=UploadFile)
        mock_upload_file.key = "upload_key"
        mock_upload_file.mime_type = "text/plain"

        mock_db.session.query.return_value.where.return_value.first.return_value = mock_upload_file

        mock_storage.load_stream.return_value = iter([b"chunk1", b"chunk2"])

        # Execute
        stream, mimetype = DatasourceFileManager.get_file_generator_by_upload_file_id("upload_id")

        # Verify
        assert mimetype == "text/plain"
        assert list(stream) == [b"chunk1", b"chunk2"]

        # Case: Not found
        mock_db.session.query.return_value.where.return_value.first.return_value = None
        stream, mimetype = DatasourceFileManager.get_file_generator_by_upload_file_id("none")
        assert stream is None
        assert mimetype is None
