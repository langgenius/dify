from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import httpx
import pytest
from sqlalchemy.orm import Session

from core.datasource.datasource_file_manager import DatasourceFileManager
from extensions.storage.storage_type import StorageType
from models.enums import CreatorUserRole
from models.model import MessageFile, UploadFile
from models.tools import ToolFile


def _upload_file(id: str, *, key: str, mime_type: str) -> UploadFile:
    upload_file = UploadFile(
        tenant_id="tenant-1",
        storage_type=StorageType.LOCAL,
        key=key,
        name="file.png",
        size=4,
        extension=".png",
        mime_type=mime_type,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=False,
    )
    upload_file.id = id
    return upload_file


def _tool_file(id: str, *, key: str = "tool_key", mimetype: str = "image/png") -> ToolFile:
    tool_file = ToolFile(
        tenant_id="tenant-1",
        user_id="user-1",
        conversation_id=None,
        file_key=key,
        mimetype=mimetype,
        name="tool.png",
        size=4,
    )
    tool_file.id = id
    return tool_file


def _message_file(id: str, *, url: str | None) -> MessageFile:
    message_file = MessageFile(
        message_id="message-1",
        type="image",
        transfer_method="remote_url",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="user-1",
        url=url,
    )
    message_file.id = id
    return message_file


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

    @pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_create_file_by_raw(self, mock_config, mock_uuid, mock_storage, sqlite_session: Session):
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
            session=sqlite_session,
        )

        # Verify
        assert upload_file.tenant_id == tenant_id
        assert upload_file.name == "test.png"
        assert upload_file.size == len(file_binary)
        assert upload_file.mime_type == mimetype
        assert upload_file.key == f"datasources/{tenant_id}/unique_hex.png"

        mock_storage.save.assert_called_once_with(upload_file.key, file_binary)
        assert sqlite_session.get(UploadFile, upload_file.id) is upload_file

    @pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_create_file_by_raw_filename_no_extension(
        self, mock_config, mock_uuid, mock_storage, sqlite_session: Session
    ):
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
            session=sqlite_session,
        )

        # Verify
        assert upload_file.name == "test.png"  # Should append extension

    @pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    @patch("core.datasource.datasource_file_manager.guess_extension")
    def test_create_file_by_raw_unknown_extension(
        self, mock_guess_ext, mock_config, mock_uuid, mock_storage, sqlite_session: Session
    ):
        # Setup
        mock_guess_ext.return_value = None  # Cannot guess
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_config.STORAGE_TYPE = "local"

        # Execute
        upload_file = DatasourceFileManager.create_file_by_raw(
            user_id="user",
            tenant_id="tenant",
            conversation_id=None,
            file_binary=b"data",
            mimetype="application/x-unknown",
            session=sqlite_session,
        )

        # Verify
        assert upload_file.extension == ".bin"
        assert upload_file.name == "unique_hex.bin"

    @pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    @patch("core.datasource.datasource_file_manager.dify_config")
    def test_create_file_by_raw_no_filename(self, mock_config, mock_uuid, mock_storage, sqlite_session: Session):
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
            session=sqlite_session,
        )

        # Verify
        assert upload_file.name == "unique_hex.pdf"
        assert upload_file.extension == ".pdf"

    @patch("core.datasource.datasource_file_manager.remote_fetcher")
    @pytest.mark.parametrize("sqlite_session", [(ToolFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    def test_create_file_by_url_mimetype_from_guess(self, mock_uuid, mock_storage, mock_ssrf, sqlite_session: Session):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_response = MagicMock()
        mock_response.content = b"bits"
        mock_response.headers = {}  # No content-type in headers
        mock_ssrf.make_request.return_value = mock_response

        # Execute
        tool_file = DatasourceFileManager.create_file_by_url(
            user_id="user_123",
            tenant_id="tenant_456",
            file_url="https://example.com/photo.png",
            session=sqlite_session,
        )

        # Verify
        assert tool_file.mimetype == "image/png"  # Guessed from .png in URL

    @patch("core.datasource.datasource_file_manager.remote_fetcher")
    @pytest.mark.parametrize("sqlite_session", [(ToolFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    def test_create_file_by_url_mimetype_default(self, mock_uuid, mock_storage, mock_ssrf, sqlite_session: Session):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_response = MagicMock()
        mock_response.content = b"bits"
        mock_response.headers = {}
        mock_ssrf.make_request.return_value = mock_response

        # Execute
        tool_file = DatasourceFileManager.create_file_by_url(
            user_id="user_123",
            tenant_id="tenant_456",
            file_url="https://example.com/unknown",  # No extension, no headers
            session=sqlite_session,
        )

        # Verify
        assert tool_file.mimetype == "application/octet-stream"

    @patch("core.datasource.datasource_file_manager.remote_fetcher")
    @pytest.mark.parametrize("sqlite_session", [(ToolFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    @patch("core.datasource.datasource_file_manager.uuid4")
    def test_create_file_by_url_success(self, mock_uuid, mock_storage, mock_ssrf, sqlite_session: Session):
        # Setup
        mock_uuid.return_value = MagicMock(hex="unique_hex")
        mock_response = MagicMock()
        mock_response.content = b"downloaded bits"
        mock_response.headers = {"Content-Type": "image/jpeg"}
        mock_ssrf.make_request.return_value = mock_response

        # Execute
        tool_file = DatasourceFileManager.create_file_by_url(
            user_id="user_123",
            tenant_id="tenant_456",
            file_url="https://example.com/photo.jpg",
            session=sqlite_session,
        )

        # Verify
        assert tool_file.mimetype == "image/jpeg"
        assert tool_file.size == len(b"downloaded bits")
        assert tool_file.file_key == "tools/tenant_456/unique_hex.jpg"
        mock_storage.save.assert_called_once()

    @patch("core.datasource.datasource_file_manager.remote_fetcher")
    def test_create_file_by_url_timeout(self, mock_ssrf):
        # Setup
        mock_ssrf.make_request.side_effect = httpx.TimeoutException("Timeout")

        # Execute & Verify
        with pytest.raises(ValueError, match="timeout when downloading file"):
            DatasourceFileManager.create_file_by_url(
                user_id="user_123", tenant_id="tenant_456", file_url="https://example.com/large.file"
            )

    @pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary(self, mock_storage, sqlite_session: Session):
        sqlite_session.add(_upload_file("file_id", key="some_key", mime_type="image/png"))
        sqlite_session.commit()

        mock_storage.load_once.return_value = b"file content"

        result = DatasourceFileManager.get_file_binary("file_id", session=sqlite_session)

        # Verify
        assert result == (b"file content", "image/png")

        assert DatasourceFileManager.get_file_binary("unknown", session=sqlite_session) is None

    @pytest.mark.parametrize("sqlite_session", [(MessageFile, ToolFile)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary_by_message_file_id(self, mock_storage, sqlite_session: Session):
        sqlite_session.add_all(
            [
                _message_file("msg_file_id", url="http://localhost/files/tools/tool_id.png"),
                _tool_file("tool_id"),
            ]
        )
        sqlite_session.commit()
        mock_storage.load_once.return_value = b"tool content"

        result = DatasourceFileManager.get_file_binary_by_message_file_id("msg_file_id", session=sqlite_session)

        # Verify
        assert result == (b"tool content", "image/png")

    @pytest.mark.parametrize("sqlite_session", [(MessageFile, ToolFile)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary_by_message_file_id_with_extension(self, mock_storage, sqlite_session: Session):
        sqlite_session.add_all(
            [_message_file("m", url="http://localhost/files/tools/abcdef.png"), _tool_file("abcdef", key="tk")]
        )
        sqlite_session.commit()
        mock_storage.load_once.return_value = b"bits"

        result = DatasourceFileManager.get_file_binary_by_message_file_id("m", session=sqlite_session)
        assert result == (b"bits", "image/png")

    @pytest.mark.parametrize("sqlite_session", [(MessageFile, ToolFile)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_binary_by_message_file_id_failures(self, mock_storage, sqlite_session: Session):
        assert DatasourceFileManager.get_file_binary_by_message_file_id("none", session=sqlite_session) is None

        sqlite_session.add(_message_file("msg_id", url=None))
        sqlite_session.commit()
        assert DatasourceFileManager.get_file_binary_by_message_file_id("msg_id", session=sqlite_session) is None

    @pytest.mark.parametrize("sqlite_session", [(UploadFile,)], indirect=True)
    @patch("core.datasource.datasource_file_manager.storage")
    def test_get_file_generator_by_upload_file_id(self, mock_storage, sqlite_session: Session):
        sqlite_session.add(_upload_file("upload_id", key="upload_key", mime_type="text/plain"))
        sqlite_session.commit()

        mock_storage.load_stream.return_value = iter([b"chunk1", b"chunk2"])

        # Execute
        stream, mimetype = DatasourceFileManager.get_file_generator_by_upload_file_id(
            "upload_id", session=sqlite_session
        )

        # Verify
        assert mimetype == "text/plain"
        assert list(stream) == [b"chunk1", b"chunk2"]

        stream, mimetype = DatasourceFileManager.get_file_generator_by_upload_file_id("none", session=sqlite_session)
        assert stream is None
        assert mimetype is None
