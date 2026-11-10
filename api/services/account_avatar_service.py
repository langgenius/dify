"""Application service for resolving a current account avatar URL."""

from machinery.context import AccountRequestContext, RequestContext
from services.account_errors import AvatarFileNotFoundError
from services.account_ports import AccountAvatarFileGateway
from services.entities.account_entities import AccountAvatarUpload


class AccountAvatarService:
    def __init__(self, *, files: AccountAvatarFileGateway) -> None:
        self._files = files

    def resolve(self, context: AccountRequestContext | RequestContext, avatar: str) -> str:
        """Resolve an external URL or an owned upload; missing or foreign files are rejected."""
        if avatar.startswith(("http://", "https://")):
            return avatar

        avatar_url = self._files.get_owned_signed_url(account_id=context.account_id, upload_file_id=avatar)
        if avatar_url is None:
            raise AvatarFileNotFoundError
        return avatar_url

    def upload(self, context: AccountRequestContext, *, filename: str, content: bytes) -> AccountAvatarUpload:
        """Upload an admitted Account's image without selecting or creating a workspace.

        Return its ID and signed URL for a subsequent profile patch. Invalid images
        or file-policy failures do not change the Account or its memberships.
        """
        return self._files.upload(account_id=context.account_id, filename=filename, content=content)
