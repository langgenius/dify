"""Application service for resolving a current account avatar URL."""

from machinery.context import RequestContext
from services.account_errors import AvatarFileNotFoundError
from services.account_ports import AccountAvatarFileGateway


class AccountAvatarService:
    def __init__(self, *, files: AccountAvatarFileGateway) -> None:
        self._files = files

    def resolve(self, context: RequestContext, avatar: str) -> str:
        if avatar.startswith(("http://", "https://")):
            return avatar

        avatar_url = self._files.get_owned_signed_url(account_id=context.account_id, upload_file_id=avatar)
        if avatar_url is None:
            raise AvatarFileNotFoundError
        return avatar_url
