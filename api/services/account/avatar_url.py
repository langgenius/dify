"""Resolve links for serialized account avatar references."""

from uuid import UUID

from configs import dify_config
from core.app.file_access import DatabaseFileAccessController
from core.app.file_access.controller import require_scoped_upload_file_access
from services.account_avatar_service import format_uploaded_avatar_url

_file_access = DatabaseFileAccessController()


def build_account_avatar_url(*, avatar: str | None, account_id: str) -> str | None:
    """Preserve external links and generate stable Console URLs for valid, in-scope uploads."""
    if not avatar:
        return None
    if avatar.startswith(("http://", "https://")):
        return avatar
    try:
        file_id = str(UUID(avatar))
        owner_id = str(UUID(account_id))
    except ValueError:
        return None

    require_scoped_upload_file_access(file_id, _file_access)
    return format_uploaded_avatar_url(console_api_url=dify_config.CONSOLE_API_URL, account_id=owner_id, file_id=file_id)
