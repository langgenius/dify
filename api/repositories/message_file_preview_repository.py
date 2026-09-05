"""SQLAlchemy query adapter for app-scoped message file previews."""

from typing import override

from sqlalchemy import case, select
from sqlalchemy.orm import Session, sessionmaker

from models.model import Message, MessageFile, UploadFile
from services.message_file_preview_service import (
    MessageFilePreviewAccessDeniedError,
    MessageFilePreviewNotFoundError,
    MessageFilePreviewQuery,
    MessageFilePreviewRecord,
)


class MessageFilePreviewQueryRepository(MessageFilePreviewQuery):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_for_app(
        self,
        *,
        file_id: str,
        app_id: str,
        tenant_id: str,
    ) -> MessageFilePreviewRecord:
        stmt = (
            select(
                Message.app_id.label("message_app_id"),
                UploadFile.tenant_id.label("file_tenant_id"),
                UploadFile.key.label("file_key"),
                UploadFile.name.label("file_name"),
                UploadFile.size.label("file_size"),
                UploadFile.extension.label("file_extension"),
                UploadFile.mime_type.label("file_mime_type"),
            )
            .select_from(MessageFile)
            .outerjoin(Message, Message.id == MessageFile.message_id)
            .outerjoin(UploadFile, UploadFile.id == MessageFile.upload_file_id)
            .where(MessageFile.upload_file_id == file_id)
            # One upload may be linked to multiple messages; prefer a reference owned by this app.
            .order_by(case((Message.app_id == app_id, 0), else_=1), MessageFile.id)
            .limit(1)
        )

        with self._session_factory() as session:
            row = session.execute(stmt).one_or_none()

        if row is None:
            raise MessageFilePreviewNotFoundError
        if row.message_app_id != app_id:
            raise MessageFilePreviewAccessDeniedError
        if row.file_key is None:
            raise MessageFilePreviewNotFoundError
        if row.file_tenant_id != tenant_id:
            raise MessageFilePreviewAccessDeniedError

        return MessageFilePreviewRecord(
            key=row.file_key,
            name=row.file_name,
            size=row.file_size,
            extension=row.file_extension,
            mime_type=row.file_mime_type,
        )
