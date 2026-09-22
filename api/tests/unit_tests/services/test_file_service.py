import base64
import hashlib
import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker

from enums import DeploymentEdition
from extensions.storage.storage_type import StorageType
from models.base import TypeBase
from models.enums import CreatorUserRole
from models.model import UploadFile
from repositories.file_repository import SQLAlchemyFileRepository
from services.errors.file import (
    BlockedFileExtensionError,
    FileNotExistsError,
    FileTooLargeError,
    UnsupportedFileTypeError,
)
from services.file_service import FileArchiveEntry, FileService, FileStorage
from services.file_upload_service import FileUploadActor, FileUploadResult
from tests.file_service_test_utils import make_file_service


def _account() -> FileUploadActor:
    return FileUploadActor(id="user_id", creator_role=CreatorUserRole.ACCOUNT)


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
    def file_storage(self) -> MagicMock:
        return MagicMock(spec=FileStorage)

    @pytest.fixture
    def sign_file_url(self) -> MagicMock:
        return MagicMock(return_value="http://signed-url")

    @pytest.fixture
    def extract_text(self) -> MagicMock:
        return MagicMock(return_value="Extracted text content")

    @pytest.fixture
    def file_service(
        self,
        sqlite_session_maker: sessionmaker[Session],
        file_storage: MagicMock,
        sign_file_url: MagicMock,
        extract_text: MagicMock,
    ) -> FileService:
        return make_file_service(
            session_factory=sqlite_session_maker,
            storage=file_storage,
            sign_file_url=sign_file_url,
            extract_text=extract_text,
        )

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

    def test_upload_file_success(self, file_service: FileService, file_storage: MagicMock, db_session: Session):
        content = b"file content"
        result = file_service.upload_file(
            filename="test.jpg", content=content, mimetype="image/jpeg", user=_account(), tenant_id="tenant_id"
        )

        assert isinstance(result, FileUploadResult)
        assert result.name == "test.jpg"
        assert result.tenant_id == "tenant_id"
        assert result.size == len(content)
        assert result.extension == "jpg"
        assert result.mime_type == "image/jpeg"
        assert result.created_by_role == CreatorUserRole.ACCOUNT
        assert result.created_by == "user_id"
        assert result.hash == hashlib.sha3_256(content).hexdigest()
        assert result.source_url == "http://signed-url"
        file_storage.save.assert_called_once_with(result.key, content)
        persisted = db_session.get(UploadFile, result.id)
        assert persisted is not None
        assert persisted.hash == result.hash

    @pytest.mark.parametrize("text", ["ASCII text", "包含多字节 UTF-8 文本 🚀"])
    def test_upload_text_uses_utf8_byte_length(self, text: str, file_service: FileService, file_storage: MagicMock):
        result = file_service.upload_text(text=text, text_name="test.txt", user_id="user_id", tenant_id="tenant_id")
        expected_content = text.encode("utf-8")
        assert result.size == len(expected_content)
        file_storage.save.assert_called_once_with(result.key, expected_content)

    def test_upload_file_uses_explicit_resource_tenant(self, file_service: FileService, file_storage: MagicMock):
        result = file_service.upload_file(
            filename="test.txt",
            content=b"test",
            mimetype="text/plain",
            user=_account(),
            tenant_id="resource-tenant-id",
        )
        assert result.tenant_id == "resource-tenant-id"
        assert file_storage.save.call_args.args[0].startswith("upload_files/resource-tenant-id/")

    def test_upload_file_invalid_characters(self, file_service):
        with pytest.raises(ValueError, match="Filename contains invalid characters"):
            file_service.upload_file(
                filename="invalid/file.txt", content=b"", mimetype="text/plain", user=_account(), tenant_id="tenant_id"
            )

    def test_upload_file_long_filename(self, file_service: FileService, db_session: Session):
        result = file_service.upload_file(
            filename="a" * 210 + ".txt",
            content=b"test",
            mimetype="text/plain",
            user=_account(),
            tenant_id="tenant",
        )
        assert len(result.name) <= 205
        assert result.name.endswith(".txt")
        assert db_session.get(UploadFile, result.id) is not None

    def test_upload_file_blocked_extension(self, file_service, config_overrides: Callable[..., None]):
        config_overrides(inner_UPLOAD_FILE_EXTENSION_BLACKLIST="exe")
        with pytest.raises(BlockedFileExtensionError):
            file_service.upload_file(
                filename="test.exe",
                content=b"",
                mimetype="application/octet-stream",
                user=_account(),
                tenant_id="tenant_id",
            )

    def test_upload_file_unsupported_type_for_datasets(self, file_service):
        with pytest.raises(UnsupportedFileTypeError):
            file_service.upload_file(
                filename="test.jpg",
                content=b"",
                mimetype="image/jpeg",
                user=_account(),
                tenant_id="tenant_id",
                source="datasets",
            )

    def test_upload_file_too_large(self, file_service, config_overrides: Callable[..., None]):
        # 16MB file for an image with 15MB limit
        content = b"a" * (16 * 1024 * 1024)
        config_overrides(UPLOAD_IMAGE_FILE_SIZE_LIMIT=15)
        with pytest.raises(FileTooLargeError):
            file_service.upload_file(
                filename="test.jpg", content=content, mimetype="image/jpeg", user=_account(), tenant_id="tenant_id"
            )

    def test_upload_file_end_user(self, file_service: FileService, db_session: Session):
        user = FileUploadActor(id="end_user_id", creator_role=CreatorUserRole.END_USER)
        result = file_service.upload_file(
            filename="test.txt", content=b"test", mimetype="text/plain", user=user, tenant_id="tenant"
        )
        assert result.created_by_role == CreatorUserRole.END_USER
        assert db_session.get(UploadFile, result.id) is not None

    def test_is_file_size_within_limit(self, config_overrides: Callable[..., None]):
        config_overrides(
            UPLOAD_IMAGE_FILE_SIZE_LIMIT=10,
            UPLOAD_VIDEO_FILE_SIZE_LIMIT=20,
            UPLOAD_AUDIO_FILE_SIZE_LIMIT=30,
            UPLOAD_FILE_SIZE_LIMIT=5,
        )
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
        assert FileService.is_file_size_within_limit(extension="txt", file_size=0, default_file_size_limit=0) is True
        assert FileService.is_file_size_within_limit(extension="txt", file_size=1, default_file_size_limit=0) is False
        assert (
            FileService.is_file_size_within_limit(
                extension="pdf",
                file_size=6 * 1024 * 1024,
                default_file_size_limit=7,
            )
            is True
        )
        assert (
            FileService.is_file_size_within_limit(
                extension="pdf",
                file_size=8 * 1024 * 1024,
                default_file_size_limit=7,
            )
            is False
        )

        # Media-specific limits are not affected by the knowledge document override.
        assert (
            FileService.is_file_size_within_limit(
                extension="jpg",
                file_size=11 * 1024 * 1024,
                default_file_size_limit=100,
            )
            is False
        )

    def test_file_size_limit(self, config_overrides: Callable[..., None]):
        config_overrides(
            UPLOAD_IMAGE_FILE_SIZE_LIMIT=10,
            UPLOAD_VIDEO_FILE_SIZE_LIMIT=20,
            UPLOAD_AUDIO_FILE_SIZE_LIMIT=30,
            UPLOAD_FILE_SIZE_LIMIT=5,
        )

        assert FileService.file_size_limit(extension="jpg") == 10 * 1024 * 1024
        assert FileService.file_size_limit(extension="mp4") == 20 * 1024 * 1024
        assert FileService.file_size_limit(extension="mp3") == 30 * 1024 * 1024
        assert FileService.file_size_limit(extension="txt") == 5 * 1024 * 1024
        assert FileService.file_size_limit(extension="txt", default_file_size_limit=None) == 5 * 1024 * 1024
        assert FileService.file_size_limit(extension="txt", default_file_size_limit=0) == 0
        assert FileService.file_size_limit(extension="jpg", default_file_size_limit=0) == 10 * 1024 * 1024
        assert FileService.file_size_limit(extension="txt", default_file_size_limit=7) == 7 * 1024 * 1024

    def test_get_file_base64_success(self, file_service: FileService, file_storage: MagicMock, db_session: Session):
        self._persist_upload_file(db_session, key="test_key")
        file_storage.load_once.return_value = b"test content"
        assert file_service.get_file_base64("file_id") == base64.b64encode(b"test content").decode()
        file_storage.load_once.assert_called_once_with("test_key")

    def test_get_file_base64_not_found(self, file_service: FileService):
        with pytest.raises(FileNotExistsError, match="File not found"):
            file_service.get_file_base64("non_existent")

    def test_get_file_presigned_url_success(
        self,
        file_service: FileService,
        file_storage: MagicMock,
        db_session: Session,
        config_overrides: Callable[..., None],
    ):
        config_overrides(FILES_ACCESS_TIMEOUT=300)
        self._persist_upload_file(
            db_session, extension="png", mime_type="image/png", key="upload_files/tenant_id/icon.png"
        )
        file_storage.generate_presigned_url.return_value = "https://s3.example.com/icon.png?signature=test"
        result = file_service.get_file_presigned_url(file_id="file_id", tenant_id="tenant_id")
        assert result == "https://s3.example.com/icon.png?signature=test"
        file_storage.generate_presigned_url.assert_called_once_with(
            "upload_files/tenant_id/icon.png",
            expires_in=300,
            content_type="image/png",
        )

    def test_get_file_presigned_url_not_found(self, file_service: FileService):
        with pytest.raises(FileNotExistsError, match="File not found"):
            file_service.get_file_presigned_url(file_id="file_id", tenant_id="tenant_id")

    def test_get_icon_url_uses_direct_storage_url_for_cloud_s3(
        self, file_service: FileService, config_overrides: Callable[..., None]
    ):
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        file_service._storage_type = StorageType.S3
        with patch.object(file_service, "get_file_presigned_url", return_value="direct-url") as get_presigned_url:
            result = file_service.get_icon_url("file_id", "tenant_id")

        assert result == "direct-url"
        get_presigned_url.assert_called_once_with(file_id="file_id", tenant_id="tenant_id")

    def test_get_icon_url_maps_missing_cloud_file_to_service_error(
        self, file_service: FileService, config_overrides: Callable[..., None]
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.CLOUD)
        file_service._storage_type = StorageType.S3
        with (
            patch.object(file_service, "get_file_presigned_url", side_effect=FileNotExistsError("File not found")),
            pytest.raises(FileNotExistsError, match="File reference not found"),
        ):
            file_service.get_icon_url("file_id", "tenant_id")

    @pytest.mark.parametrize(
        ("deployment_edition", "storage_type"),
        [
            (DeploymentEdition.COMMUNITY, StorageType.S3),
            (DeploymentEdition.CLOUD, StorageType.LOCAL),
        ],
    )
    def test_get_icon_url_uses_preview_url_outside_cloud_s3(
        self,
        file_service: FileService,
        db_session: Session,
        deployment_edition: DeploymentEdition,
        storage_type: StorageType,
        sign_file_url: MagicMock,
        config_overrides: Callable[..., None],
    ):
        self._persist_upload_file(db_session)
        config_overrides(DEPLOYMENT_EDITION=deployment_edition)
        file_service._storage_type = storage_type
        sign_file_url.return_value = "preview-url"
        result = file_service.get_icon_url("file_id", "tenant_id")
        assert result == "preview-url"
        sign_file_url.assert_called_once_with(upload_file_id="file_id")

    @pytest.mark.parametrize(
        ("deployment_edition", "storage_type"),
        [
            (DeploymentEdition.COMMUNITY, StorageType.S3),
            (DeploymentEdition.CLOUD, StorageType.LOCAL),
        ],
    )
    def test_get_icon_url_rejects_missing_file_outside_cloud_s3(
        self,
        file_service: FileService,
        deployment_edition: DeploymentEdition,
        storage_type: StorageType,
        config_overrides: Callable[..., None],
    ) -> None:
        config_overrides(DEPLOYMENT_EDITION=deployment_edition)
        file_service._storage_type = storage_type

        with pytest.raises(FileNotExistsError, match="File reference not found"):
            file_service.get_icon_url("file_id", "tenant_id")

    def test_get_icon_url_rejects_cross_tenant_file_outside_cloud_s3(
        self,
        file_service: FileService,
        db_session: Session,
        config_overrides: Callable[..., None],
    ) -> None:
        self._persist_upload_file(db_session, tenant_id="other_tenant_id")
        config_overrides(DEPLOYMENT_EDITION=DeploymentEdition.COMMUNITY, STORAGE_TYPE=StorageType.LOCAL)

        with pytest.raises(FileNotExistsError, match="File reference not found"):
            file_service.get_icon_url("file_id", "tenant_id")

    def test_upload_text_success(self, file_service: FileService, file_storage: MagicMock, db_session: Session):
        result = file_service.upload_text("sample text", "test.txt", "user_id", "tenant_id")
        assert isinstance(result, FileUploadResult)
        assert result.name == "test.txt"
        assert result.size == len(b"sample text")
        assert result.tenant_id == "tenant_id"
        assert result.created_by == "user_id"
        assert result.used is True
        assert result.extension == "txt"
        file_storage.save.assert_called_once_with(result.key, b"sample text")
        assert db_session.get(UploadFile, result.id) is not None

    def test_upload_text_long_name(self, file_service: FileService, db_session: Session):
        result = file_service.upload_text("text", "a" * 210, "user", "tenant")
        assert len(result.name) == 200
        assert db_session.get(UploadFile, result.id) is not None

    def test_get_file_preview_success(self, file_service: FileService, extract_text: MagicMock, db_session: Session):
        self._persist_upload_file(db_session, extension="pdf", mime_type="application/pdf")
        assert file_service.get_file_preview("file_id", "tenant_id") == "Extracted text content"
        extract_text.assert_called_once()
        assert extract_text.call_args.kwargs["file"].id == "file_id"

    def test_get_file_preview_not_found(self, file_service: FileService):
        with pytest.raises(FileNotExistsError, match="File not found"):
            file_service.get_file_preview("non_existent", "tenant_id")

    def test_get_file_preview_unsupported_type(self, file_service: FileService, db_session: Session):
        self._persist_upload_file(db_session, extension="exe", mime_type="application/octet-stream")
        with pytest.raises(UnsupportedFileTypeError):
            file_service.get_file_preview("file_id", "tenant_id")

    def test_get_file_content_success(self, file_service: FileService, file_storage: MagicMock, db_session: Session):
        self._persist_upload_file(db_session)
        file_storage.load_once.return_value = b"hello world"
        assert file_service.get_file_content("file_id") == "hello world"

    def test_get_file_content_not_found(self, file_service: FileService):
        with pytest.raises(FileNotExistsError, match="File not found"):
            file_service.get_file_content("file_id")

    def test_delete_file_success(self, file_service: FileService, file_storage: MagicMock, db_session: Session):
        self._persist_upload_file(db_session)
        file_service.delete_file("file_id")
        file_storage.delete.assert_called_once_with("key")
        db_session.expire_all()
        assert db_session.get(UploadFile, "file_id") is None

    def test_delete_file_not_found(self, file_service: FileService):
        file_service.delete_file("file_id")
        # Should return without doing anything

    def test_get_upload_files_by_ids_empty(self, db_session: Session):
        result = SQLAlchemyFileRepository.get_upload_files_by_ids("tenant_id", [], session=db_session)
        assert result == {}

    def test_get_upload_file_by_id_scopes_to_tenant(
        self, db_session: Session, sqlite_session_maker: sessionmaker[Session]
    ) -> None:
        upload_file = self._persist_upload_file(db_session)
        repository = SQLAlchemyFileRepository(session_factory=sqlite_session_maker)

        result = repository.get(file_id="file_id", tenant_id="tenant_id")
        assert result is not None
        assert result.id == upload_file.id
        assert repository.get(file_id="file_id", tenant_id="other_tenant_id") is None

    def test_get_upload_files_by_ids(self, db_session: Session):
        upload_file = self._persist_upload_file(db_session, file_id="550e8400-e29b-41d4-a716-446655440000")
        self._persist_upload_file(
            db_session,
            file_id="550e8400-e29b-41d4-a716-446655440001",
            tenant_id="other-tenant",
        )

        result = SQLAlchemyFileRepository.get_upload_files_by_ids(
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

    def test_build_upload_files_zip_tempfile(
        self, file_service: FileService, file_storage: MagicMock, db_session: Session
    ):
        upload_file = self._persist_upload_file(db_session)
        file_storage.load_stream.return_value = (chunk for chunk in [b"chunk1", b"chunk2"])
        with file_service.build_upload_files_zip_tempfile(
            upload_files=[FileArchiveEntry(name=upload_file.name, key=upload_file.key)]
        ) as tmp_path:
            assert os.path.exists(tmp_path)
        assert not os.path.exists(tmp_path)
