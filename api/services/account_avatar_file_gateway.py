"""File-domain adapter used by the account avatar application service."""

from typing import override

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from graphon.file import helpers as file_helpers
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.account_ports import AccountAvatarFileGateway


class SQLAlchemyAccountAvatarFileGateway(AccountAvatarFileGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_owned_signed_url(self, *, account_id: str, upload_file_id: str) -> str | None:
        with self._session_factory() as session:
            owned_file_id = session.scalar(
                select(UploadFile.id)
                .where(
                    UploadFile.id == upload_file_id,
                    UploadFile.created_by_role == CreatorUserRole.ACCOUNT,
                    UploadFile.created_by == account_id,
                )
                .limit(1)
            )

        if owned_file_id is None:
            return None
        return file_helpers.get_signed_file_url(upload_file_id=owned_file_id)
