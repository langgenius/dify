"""Application service for resolving a current account avatar URL."""

from collections.abc import Callable, Sequence
from uuid import UUID

from machinery.context import RequestContext
from services.account_errors import AvatarFileNotFoundError
from services.account_ports import AccountAvatarQuery


def format_uploaded_avatar_url(*, console_api_url: str, account_id: str, file_id: str) -> str:
    """Format the stable Console URL for a validated account and upload ID."""
    return f"{console_api_url.rstrip('/')}/console/api/accounts/{account_id}/avatars/{file_id}"


class AccountAvatarService:
    def __init__(
        self, *, avatars: AccountAvatarQuery, sign_file_url: Callable[[str], str], console_api_url: str
    ) -> None:
        self._avatars = avatars
        self._sign_file_url = sign_file_url
        self._console_api_url = console_api_url

    def resolve(self, context: RequestContext, avatar: str) -> str:
        """Resolve an upload preview for its owner, including before it is assigned as the account avatar."""
        if avatar.startswith(("http://", "https://")):
            return avatar
        file_id = self._avatars.get_owned_avatar_file_id(account_id=context.account_id, upload_file_id=avatar)
        if file_id is None:
            raise AvatarFileNotFoundError
        return self._sign_file_url(file_id)

    def resolve_current_for_accounts(self, *, account_ids: Sequence[str]) -> dict[str, str]:
        """Return current eligible avatar URLs keyed by the supplied account IDs, omitting invalid or missing IDs."""
        return {
            account_id: avatar
            if avatar.startswith(("http://", "https://"))
            else format_uploaded_avatar_url(
                console_api_url=self._console_api_url, account_id=str(UUID(account_id)), file_id=avatar
            )
            for account_id, avatar in self._avatars.get_current_avatar_references(account_ids=account_ids).items()
        }
