"""File-domain adapter used by the account avatar application service."""

from typing import override
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from core.app.workflow.file_runtime import get_signed_avatar_url
from models.model import UploadFile
from repositories.account.avatar import owned_avatar_file_conditions
from services.account_ports import AccountAvatarFileGateway


class SQLAlchemyAccountAvatarFileGateway(AccountAvatarFileGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_owned_signed_url(self, *, account_id: str, upload_file_id: str) -> str | None:
        try:
            upload_file_id = str(UUID(upload_file_id))
        except ValueError:
            return None

        with self._session_factory() as session:
            owned_file_id = session.scalar(
                select(UploadFile.id)
                .where(*owned_avatar_file_conditions(file_id=upload_file_id, account_id=account_id, allow_legacy=True))
                .limit(1)
            )

        if owned_file_id is None:
            return None
        return get_signed_avatar_url(upload_file_id=owned_file_id, account_id=account_id)
