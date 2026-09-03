from datetime import datetime
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from extensions.storage.storage_type import StorageType
from graphon.file import FileTransferMethod, FileType
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole
from models.model import Message, MessageFile, UploadFile
from repositories.message_file_preview_repository import MessageFilePreviewQueryRepository
from services.message_file_preview_service import (
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
    MessageFilePreviewRecord,
)


@pytest.fixture
def repository(
    sqlite_engine: Engine,
    sqlite_session_factory: sessionmaker[Session],
) -> MessageFilePreviewQueryRepository:
    models = (Message, MessageFile, UploadFile)
    tables = [TypeBase.metadata.tables[model.__tablename__] for model in models]
    TypeBase.metadata.create_all(sqlite_engine, tables=tables)
    return MessageFilePreviewQueryRepository(session_factory=sqlite_session_factory)


def _upload_file(*, file_id: str, tenant_id: str) -> UploadFile:
    upload_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key="upload_files/tenant/file.pdf",
        name="file.pdf",
        size=42,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()),
        created_at=datetime(2026, 1, 1),
        used=True,
    )
    upload_file.id = file_id
    return upload_file


def _message(*, app_id: str) -> Message:
    return Message(
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


def _message_file(*, message_id: str, file_id: str) -> MessageFile:
    return MessageFile(
        message_id=message_id,
        type=FileType.DOCUMENT,
        transfer_method=FileTransferMethod.LOCAL_FILE,
        created_by_role=CreatorUserRole.END_USER,
        created_by=str(uuid4()),
        upload_file_id=file_id,
    )


def _persist_message_file(
    session: Session,
    *,
    app_id: str,
    file_id: str,
) -> MessageFile:
    message = _message(app_id=app_id)
    message_file = _message_file(message_id=message.id, file_id=file_id)
    session.add_all([message, message_file])
    return message_file


def test_get_for_app_returns_detached_file_metadata(
    repository: MessageFilePreviewQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    app_id = str(uuid4())
    tenant_id = str(uuid4())
    sqlite_session.add(_upload_file(file_id=file_id, tenant_id=tenant_id))
    _persist_message_file(sqlite_session, app_id=app_id, file_id=file_id)
    sqlite_session.commit()

    result = repository.get_for_app(file_id=file_id, app_id=app_id, tenant_id=tenant_id)

    assert result == MessageFilePreviewRecord(
        key="upload_files/tenant/file.pdf",
        name="file.pdf",
        size=42,
        extension="pdf",
        mime_type="application/pdf",
    )


def test_get_for_app_rejects_file_without_message_reference(
    repository: MessageFilePreviewQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    tenant_id = str(uuid4())
    sqlite_session.add(_upload_file(file_id=file_id, tenant_id=tenant_id))
    sqlite_session.commit()

    with pytest.raises(MessageFilePreviewNotFoundError):
        repository.get_for_app(file_id=file_id, app_id=str(uuid4()), tenant_id=tenant_id)


def test_get_for_app_enforces_app_isolation(
    repository: MessageFilePreviewQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    tenant_id = str(uuid4())
    sqlite_session.add(_upload_file(file_id=file_id, tenant_id=tenant_id))
    _persist_message_file(sqlite_session, app_id=str(uuid4()), file_id=file_id)
    sqlite_session.commit()

    with pytest.raises(MessageFilePreviewAccessDeniedError):
        repository.get_for_app(file_id=file_id, app_id=str(uuid4()), tenant_id=tenant_id)


def test_get_for_app_rejects_missing_upload_file(
    repository: MessageFilePreviewQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    app_id = str(uuid4())
    _persist_message_file(sqlite_session, app_id=app_id, file_id=file_id)
    sqlite_session.commit()

    with pytest.raises(MessageFilePreviewNotFoundError):
        repository.get_for_app(file_id=file_id, app_id=app_id, tenant_id=str(uuid4()))


def test_get_for_app_enforces_tenant_isolation(
    repository: MessageFilePreviewQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    app_id = str(uuid4())
    sqlite_session.add(_upload_file(file_id=file_id, tenant_id=str(uuid4())))
    _persist_message_file(sqlite_session, app_id=app_id, file_id=file_id)
    sqlite_session.commit()

    with pytest.raises(MessageFilePreviewAccessDeniedError):
        repository.get_for_app(file_id=file_id, app_id=app_id, tenant_id=str(uuid4()))


def test_get_for_app_accepts_any_message_reference_owned_by_the_app(
    repository: MessageFilePreviewQueryRepository,
    sqlite_session: Session,
) -> None:
    file_id = str(uuid4())
    app_id = str(uuid4())
    tenant_id = str(uuid4())
    sqlite_session.add(_upload_file(file_id=file_id, tenant_id=tenant_id))
    _persist_message_file(sqlite_session, app_id=str(uuid4()), file_id=file_id)
    _persist_message_file(sqlite_session, app_id=app_id, file_id=file_id)
    sqlite_session.commit()

    result = repository.get_for_app(file_id=file_id, app_id=app_id, tenant_id=tenant_id)

    assert result.key == "upload_files/tenant/file.pdf"
