"""Application service for resolving a current account avatar URL."""

from machinery.context import RequestContext
from services.account_errors import AvatarFileNotFoundError
from services.account_ports import AccountAvatarFileGateway


class AccountAvatarService:
    def __init__(self, *, files: AccountAvatarFileGateway) -> None:
        self._files = files

    def resolve(self, context: RequestContext, avatar: str) -> str:
        """Resolve the admitted account's avatar or raise if the account does not own the upload."""
        avatar_url = self.resolve_for_account(account_id=context.account_id, avatar=avatar)
        if avatar_url is None:
            raise AvatarFileNotFoundError
        return avatar_url

    def resolve_for_account(self, *, account_id: str, avatar: str) -> str | None:
        """Resolve an avatar for a server-admitted account, signing only uploads owned by that account."""
        if avatar.startswith(("http://", "https://")):
            return avatar

        return self._files.get_owned_signed_url(account_id=account_id, upload_file_id=avatar)
