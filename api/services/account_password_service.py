"""Application service for changing a current account password."""

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError, CurrentAccountPasswordIncorrectError
from services.account_ports import AccountPasswordHasher, AccountRepository, AccountSessionRevoker
from services.entities.account_entities import AccountSnapshot


class AccountPasswordService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        passwords: AccountPasswordHasher,
        sessions: AccountSessionRevoker,
    ) -> None:
        self._accounts = accounts
        self._passwords = passwords
        self._sessions = sessions

    def change(self, context: RequestContext, *, current_password: str, new_password: str) -> AccountSnapshot:
        credentials = self._accounts.get_credentials(context.account_id)
        if credentials is None:
            raise AccountNotFoundError

        if credentials.password_hash and (
            credentials.password_salt is None
            or not self._passwords.verify(
                current_password,
                password_hash=credentials.password_hash,
                password_salt=credentials.password_salt,
            )
        ):
            raise CurrentAccountPasswordIncorrectError

        password = self._passwords.hash(new_password)
        # Revoke before persistence for outages and afterward for sessions issued during the write.
        self._sessions.revoke_all(context.account_id)
        account = self._accounts.update_password(context.account_id, password)
        if account is None:
            raise AccountNotFoundError
        self._sessions.revoke_all(account.id)
        return account
