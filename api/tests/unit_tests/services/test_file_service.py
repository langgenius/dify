import base64
import hashlib
import os
from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from configs import dify_config
from extensions.storage.storage_type import StorageType
from models.base import TypeBase
from models.enums import CreatorUserRole
from models.model import Account, EndUser, UploadFile
from services.errors.file import BlockedFileExtensionError, FileTooLargeError, UnsupportedFileTypeError
from services.file_service import FileService


class TestFileService:
    @pytest.fixture
    def sqlite_session_maker(self, sqlite_engine: Engine) -> sessionmaker[Session]:
        TypeBase.metadata.create_all(sqlite_engine, tables=[TypeBase.metadata.tables[UploadFile.__tablename__]])
        return sessionmaker(bind=sqlite_engine, expire_on_commit=False)

    @pytest.fixture
    def db_session(self, sqlite_session_maker: sessionmaker[Session]) -> Iterator[Session]:
        with sqlite_session_maker() as session:
            yield session

    @pytest.fixture
    def file_service(self, sqlite_session_maker: sessionmaker[Session]) -> FileService:
        return FileService(session_factory=sqlite_session_maker)

    @staticmethod
    def _persist_upload_file(
        session: Session,
        *,
        file_id: str = "file_id",
        tenant_id: str = "tenant_id",
        extension: str = "txt",
        mime_type: str = "text/plain",
        key: str = "key",
    ) -> UploadFile:
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key=key,
            name=f"test.{extension}",
            size=10,
            extension=extension,
            mime_type=mime_type,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user_id",
            created_at=datetime(2024, 1, 1, tzinfo=UTC),
            used=False,
        )
        upload_file.id = file_id
        session.add(upload_file)
        session.commit()
        return upload_file

    def test_init_with_engine(self, sqlite_engine: Engine):
        service = FileService(session_factory=sqlite_engine)
        assert isinstance(service._session_maker, sessionmaker)

    def test_init_with_sessionmaker(self, sqlite_session_maker: sessionmaker[Session]):
        service = FileService(session_factory=sqlite_session_maker)
        assert service._session_maker == sqlite_session_maker

    def test_init_invalid_factory(self):
        with pytest.raises(AssertionError, match="must be a sessionmaker or an Engine."):
            FileService(session_factory="invalid")

    @patch("services.file_service.storage")
    @patch("services.file_service.naive_utc_now")
    @patch("services.file_service.extract_tenant_id")
    @patch("services.file_service.file_helpers.get_signed_file_url")
    def test_upload_file_success(
        self, mock_get_url, mock_tenant_id, mock_now, mock_storage, file_service: FileService, db_session: Session
    ):
        # Setup
        mock_tenant_id.return_value = "tenant_id"
        mock_now.return_value = datetime(2024, 1, 1, tzinfo=UTC)
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
        persisted = db_session.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.hash == result.hash

    def test_upload_file_uses_explicit_resource_tenant(self, file_service: FileService):
        user = MagicMock(spec=Account)
        user.id = "user-id"

        with (
            patch("services.file_service.storage") as mock_storage,
            patch("services.file_service.extract_tenant_id") as mock_extract_tenant_id,
            patch("services.file_service.file_helpers.get_signed_file_url"),
        ):
            result = file_service.upload_file(
                filename="test.txt",
                content=b"test",
                mimetype="text/plain",
                user=user,
                tenant_id="resource-tenant-id",
            )

        assert result.tenant_id == "resource-tenant-id"
        assert mock_storage.save.call_args.args[0].startswith("upload_files/resource-tenant-id/")
        mock_extract_tenant_id.assert_not_called()

    def test_upload_file_invalid_characters(self, file_service):
        with pytest.raises(ValueError, match="Filename contains invalid characters"):
            file_service.upload_file(filename="invalid/file.txt", content=b"", mimetype="text/plain", user=MagicMock())

    def test_upload_file_long_filename(self, file_service: FileService, db_session: Session):
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
            assert db_session.get(UploadFile, result.id) is not None

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

    def test_upload_file_end_user(self, file_service: FileService, db_session: Session):
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
            assert db_session.get(UploadFile, result.id) is not None

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

    def test_get_file_base64_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session, key="test_key")

        with patch("services.file_service.storage") as mock_storage:
            mock_storage.load_once.return_value = b"test content"

            # Execute
            result = file_service.get_file_base64("file_id")

            # Assert
            assert result == base64.b64encode(b"test content").decode()
            mock_storage.load_once.assert_called_once_with("test_key")

    def test_get_file_base64_not_found(self, file_service: FileService):
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_base64("non_existent")

    def test_get_file_presigned_url_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(
            db_session,
            extension="png",
            mime_type="image/png",
            key="upload_files/tenant_id/icon.png",
        )

        with (
            patch.object(dify_config, "FILES_ACCESS_TIMEOUT", 300),
            patch("services.file_service.storage") as mock_storage,
        ):
            mock_storage.generate_presigned_url.return_value = "https://s3.example.com/icon.png?signature=test"

            result = file_service.get_file_presigned_url(file_id="file_id", tenant_id="tenant_id")

        assert result == "https://s3.example.com/icon.png?signature=test"
        mock_storage.generate_presigned_url.assert_called_once_with(
            "upload_files/tenant_id/icon.png",
            expires_in=300,
            content_type="image/png",
        )

    def test_get_file_presigned_url_not_found(self, file_service: FileService):
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_presigned_url(file_id="file_id", tenant_id="tenant_id")

    def test_upload_text_success(self, file_service: FileService, db_session: Session):
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
            assert db_session.get(UploadFile, result.id) is not None

    def test_upload_text_long_name(self, file_service: FileService, db_session: Session):
        long_name = "a" * 210
        with patch("services.file_service.storage"):
            result = file_service.upload_text("text", long_name, "user", "tenant")
            assert len(result.name) == 200
            assert db_session.get(UploadFile, result.id) is not None

    def test_get_file_preview_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session, extension="pdf", mime_type="application/pdf")

        with patch("services.file_service.ExtractProcessor.load_from_upload_file") as mock_extract:
            mock_extract.return_value = "Extracted text content"

            # Execute
            result = file_service.get_file_preview("file_id", "tenant_id")

            # Assert
            assert result == "Extracted text content"

    def test_get_file_preview_not_found(self, file_service: FileService):
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_preview("non_existent", "tenant_id")

    def test_get_file_preview_unsupported_type(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session, extension="exe", mime_type="application/octet-stream")
        with pytest.raises(UnsupportedFileTypeError):
            file_service.get_file_preview("file_id", "tenant_id")

    def test_get_image_preview_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session, extension="jpg", mime_type="image/jpeg")

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

    def test_get_image_preview_not_found(self, file_service: FileService):
        with patch("services.file_service.file_helpers.verify_image_signature") as mock_verify:
            mock_verify.return_value = True
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_image_preview("file_id", "ts", "nonce", "sign")

    def test_get_image_preview_unsupported_type(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session)
        with patch("services.file_service.file_helpers.verify_image_signature") as mock_verify:
            mock_verify.return_value = True
            with pytest.raises(UnsupportedFileTypeError):
                file_service.get_image_preview("file_id", "ts", "nonce", "sign")

    def test_get_file_generator_by_file_id_success(self, file_service: FileService, db_session: Session):
        upload_file = self._persist_upload_file(db_session)

        with (
            patch("services.file_service.file_helpers.verify_file_signature") as mock_verify,
            patch("services.file_service.storage") as mock_storage,
        ):
            mock_verify.return_value = True
            mock_storage.load.return_value = iter([b"chunk"])

            gen, file = file_service.get_file_generator_by_file_id("file_id", "ts", "nonce", "sign")
            assert list(gen) == [b"chunk"]
            assert file.id == upload_file.id
            assert file.key == upload_file.key

    def test_get_file_generator_by_file_id_invalid_sig(self, file_service):
        with patch("services.file_service.file_helpers.verify_file_signature") as mock_verify:
            mock_verify.return_value = False
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_file_generator_by_file_id("file_id", "ts", "nonce", "sign")

    def test_get_file_generator_by_file_id_not_found(self, file_service: FileService):
        with patch("services.file_service.file_helpers.verify_file_signature") as mock_verify:
            mock_verify.return_value = True
            with pytest.raises(NotFound, match="File not found or signature is invalid"):
                file_service.get_file_generator_by_file_id("file_id", "ts", "nonce", "sign")

    def test_get_public_image_preview_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session, extension="png", mime_type="image/png")

        with patch("services.file_service.storage") as mock_storage:
            mock_storage.load.return_value = b"image content"
            gen, mime = file_service.get_public_image_preview("file_id")
            assert gen == b"image content"
            assert mime == "image/png"

    def test_get_public_image_preview_not_found(self, file_service: FileService):
        with pytest.raises(NotFound, match="File not found or signature is invalid"):
            file_service.get_public_image_preview("file_id")

    def test_get_public_image_preview_unsupported_type(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session)
        with pytest.raises(UnsupportedFileTypeError):
            file_service.get_public_image_preview("file_id")

    def test_get_file_content_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session)

        with patch("services.file_service.storage") as mock_storage:
            mock_storage.load.return_value = b"hello world"
            result = file_service.get_file_content("file_id")
            assert result == "hello world"

    def test_get_file_content_not_found(self, file_service: FileService):
        with pytest.raises(NotFound, match="File not found"):
            file_service.get_file_content("file_id")

    def test_delete_file_success(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session)

        with patch("services.file_service.storage") as mock_storage:
            file_service.delete_file("file_id")
            mock_storage.delete.assert_called_once_with("key")
            db_session.expire_all()
            assert db_session.get(UploadFile, "file_id") is None

    def test_delete_file_not_found(self, file_service: FileService):
        file_service.delete_file("file_id")
        # Should return without doing anything

    def test_get_upload_files_by_ids_empty(self, db_session: Session):
        result = FileService.get_upload_files_by_ids("tenant_id", [], session=db_session)
        assert result == {}

    def test_get_upload_files_by_ids(self, db_session: Session):
        upload_file = self._persist_upload_file(db_session, file_id="550e8400-e29b-41d4-a716-446655440000")
        self._persist_upload_file(
            db_session,
            file_id="550e8400-e29b-41d4-a716-446655440001",
            tenant_id="other-tenant",
        )

        result = FileService.get_upload_files_by_ids(
            "tenant_id",
            ["550e8400-e29b-41d4-a716-446655440000", "550e8400-e29b-41d4-a716-446655440001"],
            session=db_session,
        )
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

    def test_build_upload_files_zip_tempfile(self, db_session: Session):
        upload_file = self._persist_upload_file(db_session)

        with (
            patch("services.file_service.storage") as mock_storage,
            patch("services.file_service.os.remove") as mock_remove,
        ):
            mock_storage.load.return_value = [b"chunk1", b"chunk2"]

            with FileService.build_upload_files_zip_tempfile(upload_files=[upload_file]) as tmp_path:
                assert os.path.exists(tmp_path)

            mock_remove.assert_called_once()
