"""File-domain adapter used by the account avatar application service."""

from typing import override
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.app.file_access.controller import require_scoped_upload_file_access
from core.tools.signature import bind_file_uri
from libs.account_avatar import sign_avatar_preview_uri
from models.model import UploadFile
from repositories.account.avatar import owned_avatar_file_conditions
from services.account_ports import AccountAvatarFileGateway

_file_access = DatabaseFileAccessController()


def get_signed_avatar_url(*, upload_file_id: str, account_id: str) -> str | None:
    """Sign UUID references after checking any active file scope. Malformed IDs have no avatar URL."""
    try:
        file_id = str(UUID(upload_file_id))
        owner_id = str(UUID(account_id))
    except ValueError:
        return None
    require_scoped_upload_file_access(file_id, _file_access)
    return bind_file_uri(sign_avatar_preview_uri(upload_file_id=file_id, account_id=owner_id), dify_config.FILES_URL)


def build_account_avatar_url(*, avatar: str | None, account_id: str) -> str | None:
    """Keep external avatar URLs and scope uploaded avatar references to their account."""
    if not avatar:
        return None
    if avatar.startswith(("http://", "https://")):
        return avatar
    return get_signed_avatar_url(upload_file_id=avatar, account_id=account_id)


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
