import base64
import hashlib
import os
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from configs import dify_config
from models.enums import CreatorUserRole
from models.model import Account, EndUser, UploadFile
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from services.file_service import FileService


class TestFileService:
    @pytest.fixture
    def mock_db_session(self):
        session = MagicMock(spec=Session)
        # Mock context manager behavior
        session.__enter__.return_value = session
        return session

    @pytest.fixture
    def mock_session_maker(self, mock_db_session):
        maker = MagicMock(spec=sessionmaker)
        maker.return_value = mock_db_session
        return maker

    @pytest.fixture
    def file_service(self, mock_session_maker):
        return FileService(session_factory=mock_session_maker)

    def test_init_with_engine(self):
        engine = MagicMock(spec=Engine)
        service = FileService(session_factory=engine)
        assert isinstance(service._session_maker, sessionmaker)

    def test_init_with_sessionmaker(self):
        maker = MagicMock(spec=sessionmaker)
        service = FileService(session_factory=maker)
        assert service._session_maker == maker

    def test_init_invalid_factory(self):
        with pytest.raises(AssertionError, match="must be a sessionmaker or an Engine."):
            FileService(session_factory="invalid")

    @patch("services.file_service.storage")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.file_helpers.get_signed_file_url")
    def test_upload_file_success(
        self, mock_get_url, mock_tenant_id, mock_now, mock_storage, file_service, mock_db_session
    ):
        # Setup
        mock_tenant_id.return_value = "tenant_id"
        mock_now.return_value = "2024-01-01"
        mock_get_url.return_value = "http://signed-url"

        user = MagicMock(spec=Account)
        user.id = "user_id"
        content = b"file content"
        filename = "test.jpg"
        mimetype = "image/jpeg"

        # Execute
        result = file_service.upload_file(filename=filename, content=content, mimetype=mimetype, user=user)

        # Assert
        assert isinstance(result, UploadFile)
        assert result.name == filename
        assert result.tenant_id == "tenant_id"
        assert result.size == len(content)
        assert result.extension == "jpg"
        assert result.mime_type == mimetype
        assert result.created_by_role == CreatorUserRole.ACCOUNT
        assert result.created_by == "user_id"
        assert result.hash == hashlib.sha3_256(content).hexdigest()
        assert result.source_url == "http://signed-url"

        mock_storage.save.assert_called_once()
        mock_db_session.add.assert_called_once_with(result)
        mock_db_session.commit.assert_called_once()

    def test_upload_file_invalid_characters(self, file_service):
        with pytest.raises(ValueError, match="Filename contains invalid characters"):
            file_service.upload_file(filename="invalid/file.txt", content=b"", mimetype="text/plain", user=MagicMock())

    def test_upload_file_long_filename(self, file_service, mock_db_session):
        # Setup
        long_name = "a" * 210 + ".txt"
        user = MagicMock(spec=Account)
        user.id = "user_id"

        with (
            patch("services.file_service.storage"),
            patch("services.file_service.extract_tenant_id") as mock_tenant,
            patch("services.file_service.file_helpers.get_signed_file_url"),
        ):
            mock_tenant.return_value = "tenant"
            result = file_service.upload_file(filename=long_name, content=b"test", mimetype="text/plain", user=user)
            assert len(result.name) <= 205  # 200 + . + extension
            assert result.name.endswith(".txt")

    def test_upload_file_blocked_extension(self, file_service):
        with patch.object(dify_config, "inner_UPLOAD_FILE_EXTENSION_BLACKLIST", "exe"):
            with pytest.raises(BlockedFileExtensionError):
                file_service.upload_file(
                    filename="test.exe", content=b"", mimetype="application/octet-stream", user=MagicMock()
                )

    def test_upload_file_unsupported_type_for_datasets(self, file_service):
        with pytest.raises(UnsupportedFileTypeError):
            file_service.upload_file(
                filename="test.jpg", content=b"", mimetype="image/jpeg", user=MagicMock(), source="datasets"
            )

    def test_upload_file_too_large(self, file_service):
        # 16MB file for an image with 15MB limit
        content = b"a" * (16 * 1024 * 1024)
        with patch.object(dify_config, "UPLOAD_IMAGE_FILE_SIZE_LIMIT", 15):
            with pytest.raises(FileTooLargeError):
                file_service.upload_file(filename="test.jpg", content=content, mimetype="image/jpeg", user=MagicMock())

    def test_upload_file_end_user(self, file_service, mock_db_session):
        user = MagicMock(spec=EndUser)
        user.id = "end_user_id"

        with (
            patch("services.file_service.storage"),
            patch("services.file_service.extract_tenant_id") as mock_tenant,
            patch("services.file_service.file_helpers.get_signed_file_url"),
        ):
            mock_tenant.return_value = "tenant"
            result = file_service.upload_file(filename="test.txt", content=b"test", mimetype="text/plain", user=user)
            assert result.created_by_role == CreatorUserRole.END_USER

    def test_is_file_size_within_limit(self):
        with (
            patch.object(dify_config, "UPLOAD_IMAGE_FILE_SIZE_LIMIT", 10),
            patch.object(dify_config, "UPLOAD_VIDEO_FILE_SIZE_LIMIT", 20),
            patch.object(dify_config, "UPLOAD_AUDIO_FILE_SIZE_LIMIT", 30),
            patch.object(dify_config, "UPLOAD_FILE_SIZE_LIMIT", 5),
        ):
            # Image
            assert FileService.is_file_size_within_limit(extension="jpg", file_size=10 * 1024 * 1024) is True
            assert FileService.is_file_size_within_limit(extension="png", file_size=11 * 1024 * 1024) is False

            # Video
            assert FileService.is_file_size_within_limit(extension="mp4", file_size=20 * 1024 * 1024) is True
            assert FileService.is_file_size_within_limit(extension="avi", file_size=21 * 1024 * 1024) is False

            # Audio
            assert FileService.is_file_size_within_limit(extension="mp3", file_size=30 * 1024 * 1024) is True
            assert FileService.is_file_size_within_limit(extension="wav", file_size=31 * 1024 * 1024) is False

            # Default
            assert FileService.is_file_size_within_limit(extension="txt", file_size=5 * 1024 * 1024) is True
            assert FileService.is_file_size_within_limit(extension="pdf", file_size=6 * 1024 * 1024) is False

    def test_get_file_base64_success(self, file_service, mock_db_session):
        # Setup
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.key = "test_key"
        mock_db_session.scalar.return_value = upload_file

        with patch("services.file_service.storage") as mock_storage:
            mock_storage.load_once.return_value = b"test content"

            # Execute
            result = file_service.get_file_base64("file_id")

            # Assert
            assert result == base64.b64encode(b"test content").decode()
            mock_storage.load_once.assert_called_once_with("test_key")

    def test_get_file_base64_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_base64("non_existent")

    def test_upload_text_success(self, file_service, mock_db_session):
        # Setup
        text = "sample text"
        text_name = "test.txt"
        user_id = "user_id"
        tenant_id = "tenant_id"

        with patch("services.file_service.storage") as mock_storage:
            # Execute
            result = file_service.upload_text(text, text_name, user_id, tenant_id)

            # Assert
            assert result.name == text_name
            assert result.size == len(text)
            assert result.tenant_id == tenant_id
            assert result.created_by == user_id
            assert result.used is True
            assert result.extension == "txt"
            mock_storage.save.assert_called_once()
            mock_db_session.add.assert_called_once()
            mock_db_session.commit.assert_called_once()

    def test_upload_text_long_name(self, file_service, mock_db_session):
        long_name = "a" * 210
        with patch("services.file_service.storage"):
            result = file_service.upload_text("text", long_name, "user", "tenant")
            assert len(result.name) == 200

    def test_get_file_preview_success(self, file_service, mock_db_session):
        # Setup
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.extension = "pdf"
        mock_db_session.scalar.return_value = upload_file

        with patch("services.file_service.ExtractProcessor.load_from_upload_file") as mock_extract:
            mock_extract.return_value = "Extracted text content"

            # Execute
            result = file_service.get_file_preview("file_id", "tenant_id")

            # Assert
            assert result == "Extracted text content"

    def test_get_file_preview_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_preview("non_existent", "tenant_id")

    def test_get_file_preview_unsupported_type(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.extension = "exe"
        mock_db_session.scalar.return_value = upload_file
        with pytest.raises(UnsupportedFileTypeError):
            file_service.get_file_preview("file_id", "tenant_id")

    def test_get_image_preview_success(self, file_service, mock_db_session):
        # Setup
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.extension = "jpg"
        upload_file.mime_type = "image/jpeg"
        upload_file.key = "key"
        mock_db_session.scalar.return_value = upload_file

        with (
            patch("services.file_service.file_helpers.verify_image_signature") as mock_verify,
            patch("services.file_service.storage") as mock_storage,
        ):
            mock_verify.return_value = True
            mock_storage.load.return_value = iter([b"chunk1"])

            # Execute
            gen, mime = file_service.get_image_preview("file_id", "ts", "nonce", "sign")

            # Assert
            assert list(gen) == [b"chunk1"]
            assert mime == "image/jpeg"

    def test_get_image_preview_invalid_sig(self, file_service):
        with patch("services.file_service.file_helpers.verify_image_signature") as mock_verify:
            mock_verify.return_value = False
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_image_preview("file_id", "ts", "nonce", "sign")

    def test_get_image_preview_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with patch("services.file_service.file_helpers.verify_image_signature") as mock_verify:
            mock_verify.return_value = True
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_image_preview("file_id", "ts", "nonce", "sign")

    def test_get_image_preview_unsupported_type(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.extension = "txt"
        mock_db_session.scalar.return_value = upload_file
        with patch("services.file_service.file_helpers.verify_image_signature") as mock_verify:
            mock_verify.return_value = True
            with pytest.raises(UnsupportedFileTypeError):
                file_service.get_image_preview("file_id", "ts", "nonce", "sign")

    def test_get_file_generator_by_file_id_success(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.key = "key"
        mock_db_session.scalar.return_value = upload_file

        with (
            patch("services.file_service.file_helpers.verify_file_signature") as mock_verify,
            patch("services.file_service.storage") as mock_storage,
        ):
            mock_verify.return_value = True
            mock_storage.load.return_value = iter([b"chunk"])

            gen, file = file_service.get_file_generator_by_file_id("file_id", "ts", "nonce", "sign")
            assert list(gen) == [b"chunk"]
            assert file == upload_file

    def test_get_file_generator_by_file_id_invalid_sig(self, file_service):
        with patch("services.file_service.file_helpers.verify_file_signature") as mock_verify:
            mock_verify.return_value = False
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_file_generator_by_file_id("file_id", "ts", "nonce", "sign")

    def test_get_file_generator_by_file_id_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with patch("services.file_service.file_helpers.verify_file_signature") as mock_verify:
            mock_verify.return_value = True
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_file_generator_by_file_id("file_id", "ts", "nonce", "sign")

    def test_get_public_image_preview_success(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.extension = "png"
        upload_file.mime_type = "image/png"
        upload_file.key = "key"
        mock_db_session.scalar.return_value = upload_file

        with patch("services.file_service.storage") as mock_storage:
            mock_storage.load.return_value = b"image content"
            gen, mime = file_service.get_public_image_preview("file_id")
            assert gen == b"image content"
            assert mime == "image/png"

    def test_get_public_image_preview_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            file_service.get_public_image_preview("file_id")

    def test_get_public_image_preview_unsupported_type(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.extension = "txt"
        mock_db_session.scalar.return_value = upload_file
        with pytest.raises(UnsupportedFileTypeError):
            file_service.get_public_image_preview("file_id")

    def test_get_file_content_success(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.key = "key"
        mock_db_session.scalar.return_value = upload_file

        with patch("services.file_service.storage") as mock_storage:
            mock_storage.load.return_value = b"hello world"
            result = file_service.get_file_content("file_id")
            assert result == "hello world"

    def test_get_file_content_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_content("file_id")

    def test_delete_file_success(self, file_service, mock_db_session):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "file_id"
        upload_file.key = "key"
        # For session.scalar(select(...))
        mock_db_session.scalar.return_value = upload_file

        with patch("services.file_service.storage") as mock_storage:
            file_service.delete_file("file_id")
            mock_storage.delete.assert_called_once_with("key")
            mock_db_session.delete.assert_called_once_with(upload_file)

    def test_delete_file_not_found(self, file_service, mock_db_session):
        mock_db_session.scalar.return_value = None
        file_service.delete_file("file_id")
        # Should return without doing anything

    @patch("services.file_service.db")
    def test_get_upload_files_by_ids_empty(self, mock_db):
        result = FileService.get_upload_files_by_ids("tenant_id", [])
        assert result == {}

    @patch("services.file_service.db")
    def test_get_upload_files_by_ids(self, mock_db):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.id = "550e8400-e29b-41d4-a716-446655440000"
        upload_file.tenant_id = "tenant_id"
        mock_db.session.scalars().all.return_value = [upload_file]

        result = FileService.get_upload_files_by_ids("tenant_id", ["550e8400-e29b-41d4-a716-446655440000"])
        assert result["550e8400-e29b-41d4-a716-446655440000"] == upload_file

    def test_sanitize_zip_entry_name(self):
        assert FileService._sanitize_zip_entry_name("path/to/file.txt") == "file.txt"
        assert FileService._sanitize_zip_entry_name("../../../etc/passwd") == "passwd"
        assert FileService._sanitize_zip_entry_name("   ") == "file"
        assert FileService._sanitize_zip_entry_name("a\\b") == "a_b"

    def test_dedupe_zip_entry_name(self):
        used = {"a.txt"}
        assert FileService._dedupe_zip_entry_name("b.txt", used) == "b.txt"
        assert FileService._dedupe_zip_entry_name("a.txt", used) == "a (1).txt"
        used.add("a (1).txt")
        assert FileService._dedupe_zip_entry_name("a.txt", used) == "a (2).txt"

    def test_build_upload_files_zip_tempfile(self):
        upload_file = MagicMock(spec=UploadFile)
        upload_file.name = "test.txt"
        upload_file.key = "key"

        with (
            patch("services.file_service.storage") as mock_storage,
            patch("services.file_service.os.remove") as mock_remove,
        ):
            mock_storage.load.return_value = [b"chunk1", b"chunk2"]

            with FileService.build_upload_files_zip_tempfile(upload_files=[upload_file]) as tmp_path:
                assert os.path.exists(tmp_path)

            mock_remove.assert_called_once()
