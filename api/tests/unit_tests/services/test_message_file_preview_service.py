from decimal import Decimal
from pathlib import Path

import pytest
from pytest_mock import MockerFixture
from sqlalchemy.orm import Session, sessionmaker

from extensions.ext_storage import Storage
from extensions.storage.opendal_storage import OpenDALStorage
from graphon.file import FileTransferMethod, FileType
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import MessageFile
from repositories.message_file_preview_repository import MessageFilePreviewQueryRepository
from services.message_file_preview_service import (
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
    MessageFilePreviewRecord,
    MessageFilePreviewService,
)
from tests.unit_tests.model_factories import make_message, make_upload_file


def _record() -> MessageFilePreviewRecord:
    return MessageFilePreviewRecord(
        key="upload_files/tenant/file.pdf",
        name="file.pdf",
        size=42,
        extension="pdf",
        mime_type="application/pdf",
    )


@pytest.fixture
def files(sqlite_session_factory: sessionmaker[Session]) -> MessageFilePreviewQueryRepository:
    file = _record()
    with sqlite_session_factory.begin() as session:
        message = make_message(
            message_id="message-id",
            app_id="app-id",
            inputs={},
            query="preview",
            message={},
            answer="answer",
            message_unit_price=Decimal(0),
            answer_unit_price=Decimal(0),
            currency="USD",
            from_source=ConversationFromSource.API,
        )
        session.add_all(
            [
                message,
                make_upload_file(
                    file_id="file-id",
                    tenant_id="tenant-id",
                    key=file.key,
                    name=file.name,
                    size=file.size,
                    extension=file.extension,
                    mime_type="application/pdf",
                ),
                MessageFile(
                    message_id=message.id,
                    upload_file_id="file-id",
                    type=FileType.DOCUMENT,
                    transfer_method=FileTransferMethod.LOCAL_FILE,
                    created_by_role=CreatorUserRole.ACCOUNT,
                    created_by="account-1",
                ),
            ]
        )
    return MessageFilePreviewQueryRepository(session_factory=sqlite_session_factory)


@pytest.fixture
def storage(tmp_path: Path) -> Storage:
    storage = Storage()
    storage.storage_runner = OpenDALStorage(scheme="fs", root=str(tmp_path))
    storage.save(_record().key, b"content")
    return storage


def test_get_preview_loads_the_authorized_file_stream(
    files: MessageFilePreviewQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    lookup = mocker.spy(files, "get_for_app")
    load_stream = mocker.spy(storage, "load_stream")
    service = MessageFilePreviewService(files=files, storage=storage)

    preview = service.get_preview(file_id="file-id", app_id="app-id", tenant_id="tenant-id")

    lookup.assert_called_once_with(file_id="file-id", app_id="app-id", tenant_id="tenant-id")
    load_stream.assert_called_once_with(_record().key)
    assert preview.file == _record()
    assert b"".join(preview.content) == b"content"


@pytest.mark.parametrize(
    ("file_id", "app_id", "tenant_id", "error"),
    [
        ("missing", "app-id", "tenant-id", MessageFilePreviewNotFoundError),
        ("file-id", "other-app", "tenant-id", MessageFilePreviewAccessDeniedError),
        ("file-id", "app-id", "other-tenant", MessageFilePreviewAccessDeniedError),
    ],
)
def test_get_preview_does_not_load_denied_or_missing_files(
    files: MessageFilePreviewQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
    file_id: str,
    app_id: str,
    tenant_id: str,
    error: type[Exception],
) -> None:
    load_stream = mocker.spy(storage, "load_stream")
    service = MessageFilePreviewService(files=files, storage=storage)

    with pytest.raises(error):
        service.get_preview(file_id=file_id, app_id=app_id, tenant_id=tenant_id)

    load_stream.assert_not_called()


def test_get_preview_does_not_mask_storage_errors(
    files: MessageFilePreviewQueryRepository,
    storage: Storage,
    mocker: MockerFixture,
) -> None:
    mocker.patch.object(storage.storage_runner, "load_stream", side_effect=OSError("storage down"))
    service = MessageFilePreviewService(files=files, storage=storage)

    with pytest.raises(OSError, match="storage down"):
        service.get_preview(file_id="file-id", app_id="app-id", tenant_id="tenant-id")
