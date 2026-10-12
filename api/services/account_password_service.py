"""Application service for changing a current account password."""

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError, CurrentAccountPasswordIncorrectError
from services.account_ports import AccountPasswordHasher, AccountRepository, AccountSessionReissuer
from services.entities.account_entities import AccountPasswordChange


class AccountPasswordService:
    def __init__(
        self,
        *,
        accounts: AccountRepository,
        passwords: AccountPasswordHasher,
        sessions: AccountSessionReissuer,
    ) -> None:
        self._accounts = accounts
        self._passwords = passwords
        self._sessions = sessions

    def change(
        self,
        context: RequestContext,
        *,
        current_password: str,
        new_password: str,
        refresh_token: str | None,
    ) -> AccountPasswordChange:
        """Revoke every session of the account, then replace the caller's own session.

        `refresh_token` is the caller's refresh credential, or None for clients without one,
        such as bearer and API-key callers. Only a credential the session store recognizes
        for the account earns a replacement, so an access token alone cannot become a
        refresh session by setting a password.
        """
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

        # Resolve before revocation; afterward no credential of the account is recognized.
        replaces_session = (
            refresh_token is not None and self._sessions.resolve_refresh_token(refresh_token) == context.account_id
        )
        password = self._passwords.hash(new_password)
        # Revoke before persistence for outages and afterward for sessions issued during the write.
        self._sessions.revoke_all(context.account_id)
        account = self._accounts.update_password(context.account_id, password)
        if account is None:
            raise AccountNotFoundError
        self._sessions.revoke_all(account.id)
        # Issue after the final revocation so the replacement belongs to the new session generation.
        session = self._sessions.issue(account.id) if replaces_session else None
        return AccountPasswordChange(account=account, session=session)
