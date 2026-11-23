"""Application service for resolving a current account avatar URL."""

from collections.abc import Sequence

from machinery.context import RequestContext
from services.account_errors import AvatarFileNotFoundError
from services.account_ports import AccountAvatarFileGateway


class AccountAvatarService:
    def __init__(self, *, files: AccountAvatarFileGateway) -> None:
        self._files = files

    def resolve(self, context: RequestContext, avatar: str) -> str:
        """Resolve an upload preview for its owner, including before it is assigned as the account avatar."""
        if avatar.startswith(("http://", "https://")):
            return avatar
        avatar_url = self._files.get_owned_signed_url(account_id=context.account_id, upload_file_id=avatar)
        if avatar_url is None:
            raise AvatarFileNotFoundError
        return avatar_url

    def resolve_current_for_accounts(self, *, account_ids: Sequence[str]) -> dict[str, str]:
        """Return current eligible avatar URLs keyed by the supplied account IDs, omitting invalid or missing IDs."""
        return self._files.get_current_avatar_urls(account_ids=account_ids)
