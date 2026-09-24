import base64
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
    FileNotExistsError,
    UnsupportedFileTypeError,
)
from services.file_service import FileArchiveEntry, FileService, FileStorage
from tests.file_service_test_utils import make_file_service


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
