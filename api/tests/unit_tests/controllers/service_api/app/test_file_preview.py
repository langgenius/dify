"""Unit tests for the Service API file-preview endpoint.

Ownership checks run against persisted message, file, app, and upload rows so the
tests exercise the same SQLAlchemy statements and tenant boundary as production.
Storage remains mocked because it is the external I/O boundary of the endpoint.
"""

import logging
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Protocol, cast
from unittest.mock import Mock, patch
from uuid import uuid4

import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from controllers.service_api.app.error import FileAccessDeniedError, FileNotFoundError
from controllers.service_api.app.file_preview import FilePreviewApi
from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import App, AppMode, Message, MessageFile, UploadFile


class _FilePreviewLogRecord(Protocol):
    file_id: str
    app_id: str
    error: str


@dataclass(frozen=True)
class _Database:
    """Expose the real test session through the interface used by the controller."""

    session: Session


@dataclass(frozen=True)
class _PreviewRecords:
    app: App
    message: Message
    message_file: MessageFile
    upload_file: UploadFile


@pytest.fixture
def database(sqlite_engine: Engine) -> Iterator[_Database]:
    """Create only the tables required by file ownership validation."""

    models = (App, Message, MessageFile, UploadFile)
    tables = [TypeBase.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    with Session(sqlite_engine, expire_on_commit=False) as session:
        yield _Database(session)


@pytest.fixture
def file_preview_api() -> FilePreviewApi:
    """Create the resource instance under test."""

    return FilePreviewApi()


def _upload_file(*, tenant_id: str, file_id: str | None = None) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="storage/key/test_file.jpg",
        name="test_file.jpg",
        size=1024,
        extension="jpg",
        mime_type="image/jpeg",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    if file_id is not None:
        upload_file.id = file_id
    return upload_file


def _persist_preview_records(
    session: Session,
    *,
    app_id: str | None = None,
    app_tenant_id: str | None = None,
    upload_tenant_id: str | None = None,
) -> _PreviewRecords:
    app_id = app_id or str(uuid4())
    app_tenant_id = app_tenant_id or str(uuid4())
    upload_file = _upload_file(tenant_id=upload_tenant_id or app_tenant_id)
    app = App(
        id=app_id,
        tenant_id=app_tenant_id,
        name="Preview app",
        description="",
        mode=AppMode.CHAT,
        icon_type=None,
        icon="",
        icon_background=None,
        enable_site=True,
        enable_api=True,
    )
    message = Message(
        id=str(uuid4()),
        app_id=app_id,
        conversation_id=str(uuid4()),
        _inputs={},
        query="preview",
        message={},
        message_unit_price=Decimal(0),
        answer="answer",
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.API,
    )
    message_file = MessageFile(
        message_id=message.id,
        type=FileType.IMAGE,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by=str(uuid4()),
        upload_file_id=upload_file.id,
    )
    session.add_all([app, message, message_file, upload_file])
    session.commit()
    return _PreviewRecords(app=app, message=message, message_file=message_file, upload_file=upload_file)


class TestFilePreviewApi:
    """Exercise ownership validation and response construction."""

    def test_validate_file_ownership_success(self, file_preview_api: FilePreviewApi, database: _Database):
        records = _persist_preview_records(database.session)

        with patch("controllers.service_api.app.file_preview.db", database):
            message_file, upload_file = file_preview_api._validate_file_ownership(
                records.upload_file.id, records.app.id
            )

        assert message_file.id == records.message_file.id
        assert upload_file.id == records.upload_file.id
        assert upload_file.tenant_id == records.app.tenant_id

    def test_validate_file_ownership_file_not_found(self, file_preview_api: FilePreviewApi, database: _Database):
        with patch("controllers.service_api.app.file_preview.db", database):
            with pytest.raises(FileNotFoundError, match="File not found in message context"):
                file_preview_api._validate_file_ownership(str(uuid4()), str(uuid4()))

    def test_validate_file_ownership_access_denied(self, file_preview_api: FilePreviewApi, database: _Database):
        records = _persist_preview_records(database.session)

        with patch("controllers.service_api.app.file_preview.db", database):
            with pytest.raises(FileAccessDeniedError, match="not owned by requesting app"):
                file_preview_api._validate_file_ownership(records.upload_file.id, str(uuid4()))

    def test_validate_file_ownership_upload_file_not_found(self, file_preview_api: FilePreviewApi, database: _Database):
        records = _persist_preview_records(database.session)
        database.session.delete(records.upload_file)
        database.session.commit()

        with patch("controllers.service_api.app.file_preview.db", database):
            with pytest.raises(FileNotFoundError, match="Upload file record not found"):
                file_preview_api._validate_file_ownership(records.upload_file.id, records.app.id)

    def test_validate_file_ownership_tenant_mismatch(self, file_preview_api: FilePreviewApi, database: _Database):
        records = _persist_preview_records(database.session, upload_tenant_id=str(uuid4()))

        with patch("controllers.service_api.app.file_preview.db", database):
            with pytest.raises(FileAccessDeniedError, match="tenant mismatch"):
                file_preview_api._validate_file_ownership(records.upload_file.id, records.app.id)

    def test_validate_file_ownership_invalid_input(self, file_preview_api: FilePreviewApi):
        with pytest.raises(FileAccessDeniedError, match="Invalid file or app identifier"):
            file_preview_api._validate_file_ownership("", "app_id")

        with pytest.raises(FileAccessDeniedError, match="Invalid file or app identifier"):
            file_preview_api._validate_file_ownership("file_id", "")

    @pytest.mark.parametrize(
        ("as_attachment", "mime_type", "name", "extension", "size"),
        [
            (False, "image/jpeg", "test_file.jpg", "jpg", 1024),
            (True, "image/jpeg", "test_file.jpg", "jpg", 1024),
            (False, "text/html", "unsafe.html", "html", 1024),
            (False, "video/mp4", "test_file.mp4", "mp4", 1024),
            (False, "image/jpeg", "test_file.jpg", "jpg", 0),
        ],
    )
    def test_build_file_response(
        self,
        file_preview_api: FilePreviewApi,
        as_attachment: bool,
        mime_type: str,
        name: str,
        extension: str,
        size: int,
    ):
        upload_file = _upload_file(tenant_id=str(uuid4()))
        upload_file.mime_type = mime_type
        upload_file.name = name
        upload_file.extension = extension
        upload_file.size = size

        response = file_preview_api._build_file_response(Mock(), upload_file, as_attachment)

        assert response.direct_passthrough is True
        assert "Cache-Control" in response.headers
        assert ("Content-Length" in response.headers) is bool(size)
        if as_attachment or mime_type == "text/html":
            assert "attachment" in response.headers["Content-Disposition"]
            assert response.headers["Content-Type"] == "application/octet-stream"
        else:
            assert response.mimetype == mime_type
        if mime_type == "text/html":
            assert response.headers["X-Content-Type-Options"] == "nosniff"
        if mime_type.startswith("video/"):
            assert response.headers["Accept-Ranges"] == "bytes"

    @patch("controllers.service_api.app.file_preview.storage")
    def test_components_use_validated_file(
        self, mock_storage: Mock, file_preview_api: FilePreviewApi, database: _Database
    ):
        records = _persist_preview_records(database.session)
        generator = Mock()

        with patch("controllers.service_api.app.file_preview.db", database):
            message_file, upload_file = file_preview_api._validate_file_ownership(
                records.upload_file.id, records.app.id
            )
            response = file_preview_api._build_file_response(generator, upload_file, False)

        assert message_file.id == records.message_file.id
        assert response.mimetype == "image/jpeg"
        mock_storage.load.assert_not_called()

    @patch("controllers.service_api.app.file_preview.storage")
    def test_storage_error_remains_external(
        self, mock_storage: Mock, file_preview_api: FilePreviewApi, database: _Database
    ):
        records = _persist_preview_records(database.session)
        mock_storage.load.side_effect = OSError("Storage error")

        with patch("controllers.service_api.app.file_preview.db", database):
            _, upload_file = file_preview_api._validate_file_ownership(records.upload_file.id, records.app.id)

        with pytest.raises(OSError, match="Storage error"):
            mock_storage.load(upload_file.key, stream=True)

    def test_validate_file_ownership_unexpected_error_logging(
        self,
        file_preview_api: FilePreviewApi,
        database: _Database,
        sqlite_engine: Engine,
        caplog: pytest.LogCaptureFixture,
    ):
        file_id = str(uuid4())
        app_id = str(uuid4())

        def fail_statement(*_args: object) -> None:
            raise RuntimeError("Unexpected database error")

        event.listen(sqlite_engine, "before_cursor_execute", fail_statement)
        try:
            with patch("controllers.service_api.app.file_preview.db", database):
                with caplog.at_level(logging.ERROR, logger="controllers.service_api.app.file_preview"):
                    with pytest.raises(FileAccessDeniedError, match="File access validation failed"):
                        file_preview_api._validate_file_ownership(file_id, app_id)
        finally:
            event.remove(sqlite_engine, "before_cursor_execute", fail_statement)

        assert len(caplog.records) == 1
        log_record = caplog.records[0]
        assert log_record.getMessage() == "Unexpected error during file ownership validation"
        record = cast(_FilePreviewLogRecord, log_record)
        assert record.file_id == file_id
        assert record.app_id == app_id
        assert record.error == "Unexpected database error"
