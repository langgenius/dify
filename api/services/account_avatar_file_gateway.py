"""File-domain adapter used by the account avatar application service."""

from collections.abc import Sequence
from typing import override
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.app.file_access.controller import require_scoped_upload_file_access
from core.tools.signature import bind_file_uri
from libs.account_avatar import sign_avatar_preview_uri
from models.account import Account
from models.model import UploadFile
from repositories.account.avatar import eligible_avatar_file_conditions, owned_avatar_file_conditions
from services.account_ports import AccountAvatarFileGateway

_file_access = DatabaseFileAccessController()


def _normalized_uuid(value: str) -> str | None:
    """Return the canonical UUID string for every accepted UUID spelling, or None for malformed input."""
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _scoped_avatar_ids(*, upload_file_id: str, account_id: str) -> tuple[str, str] | None:
    """Normalize valid IDs and require file access when a scope is active."""
    file_id = _normalized_uuid(upload_file_id)
    owner_id = _normalized_uuid(account_id)
    if file_id is None or owner_id is None:
        return None
    require_scoped_upload_file_access(file_id, _file_access)
    return file_id, owner_id


def get_signed_avatar_url(*, upload_file_id: str, account_id: str) -> str | None:
    """Sign UUID references for upload previews after checking any active file scope."""
    ids = _scoped_avatar_ids(upload_file_id=upload_file_id, account_id=account_id)
    if ids is None:
        return None
    file_id, owner_id = ids
    return bind_file_uri(sign_avatar_preview_uri(upload_file_id=file_id, account_id=owner_id), dify_config.FILES_URL)


def _format_account_avatar_url(*, file_id: str, account_id: str) -> str:
    """Format a stable URL after the caller has normalized and authorized both IDs."""
    return f"{dify_config.CONSOLE_API_URL.rstrip('/')}/console/api/accounts/{account_id}/avatars/{file_id}"


def build_account_avatar_url(*, avatar: str | None, account_id: str) -> str | None:
    """Keep external avatars and build a stable console URL for uploaded account avatars."""
    if not avatar:
        return None
    if avatar.startswith(("http://", "https://")):
        return avatar
    ids = _scoped_avatar_ids(upload_file_id=avatar, account_id=account_id)
    if ids is None:
        return None
    file_id, owner_id = ids
    return _format_account_avatar_url(file_id=file_id, account_id=owner_id)


class SQLAlchemyAccountAvatarFileGateway(AccountAvatarFileGateway):
    def __init__(self, *, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    @override
    def get_owned_signed_url(self, *, account_id: str, upload_file_id: str) -> str | None:
        owned_file_id = self._get_owned_file_id(account_id=account_id, upload_file_id=upload_file_id)
        if owned_file_id is None:
            return None
        return get_signed_avatar_url(upload_file_id=owned_file_id, account_id=account_id)

    @override
    def get_current_avatar_urls(self, *, account_ids: Sequence[str]) -> dict[str, str]:
        """Read current profiles and return only external or owned raster avatar URLs in at most two batch queries."""
        canonical_by_input = {
            account_id: canonical_id
            for account_id in dict.fromkeys(account_ids)
            if (canonical_id := _normalized_uuid(account_id)) is not None
        }
        if not canonical_by_input:
            return {}

        with self._session_factory() as session:
            profile_rows = session.execute(
                select(Account.id, Account.avatar).where(Account.id.in_(set(canonical_by_input.values())))
            ).all()
            avatars_by_account = {str(account_id): avatar for account_id, avatar in profile_rows if avatar}
            external_urls = {
                account_id: avatar
                for account_id, avatar in avatars_by_account.items()
                if avatar.startswith(("http://", "https://"))
            }
            local_avatar_ids = {
                account_id: file_id
                for account_id, avatar in avatars_by_account.items()
                if not avatar.startswith(("http://", "https://"))
                if (file_id := _normalized_uuid(avatar)) is not None
            }
            eligible_pairs: set[tuple[str, str]] = set()
            if local_avatar_ids:
                eligible_statement = _file_access.apply_upload_file_filters(
                    select(UploadFile).where(
                        UploadFile.id.in_(set(local_avatar_ids.values())),
                        UploadFile.created_by.in_(set(local_avatar_ids)),
                        *eligible_avatar_file_conditions(allow_legacy=True),
                    )
                )
                eligible_files = session.scalars(eligible_statement).all()
                eligible_pairs = {(str(file.id), str(file.created_by)) for file in eligible_files}

        urls_by_account = dict(external_urls)
        for account_id, file_id in local_avatar_ids.items():
            if (file_id, account_id) in eligible_pairs:
                urls_by_account[account_id] = _format_account_avatar_url(file_id=file_id, account_id=account_id)

        return {
            input_id: urls_by_account[canonical_id]
            for input_id, canonical_id in canonical_by_input.items()
            if canonical_id in urls_by_account
        }

    def _get_owned_file_id(self, *, account_id: str, upload_file_id: str) -> str | None:
        """Return an eligible raster upload ID only when the given account owns it."""
        normalized_file_id = _normalized_uuid(upload_file_id)
        normalized_account_id = _normalized_uuid(account_id)
        if normalized_file_id is None or normalized_account_id is None:
            return None

        with self._session_factory() as session:
            return session.scalar(
                select(UploadFile.id)
                .where(
                    *owned_avatar_file_conditions(
                        file_id=normalized_file_id, account_id=normalized_account_id, allow_legacy=True
                    )
                )
                .limit(1)
            )
