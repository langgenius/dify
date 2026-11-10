"""Application service for changing a current account password."""

from typing import Protocol

from machinery.context import AccountRequestContext, RequestContext
from services.account_errors import AccountNotFoundError, CurrentAccountPasswordIncorrectError
from services.account_ports import AccountPasswordHasher
from services.entities.account_entities import AccountCredentials, AccountPasswordDigest, AccountSnapshot


class AccountPasswordStore(Protocol):
    def get_credentials(self, account_id: str) -> AccountCredentials | None: ...

    def change_password(
        self, account_id: str, *, expected: AccountCredentials, password: AccountPasswordDigest
    ) -> AccountSnapshot | None:
        """Atomically replace credentials only if both stored digest fields still match.

        Scope the conditional write by Account ID and expected credentials in one
        transaction. Return None for a deleted Account; a concurrent credential
        change raises CurrentAccountPasswordIncorrectError without overwriting it.
        """
        ...


class AccountPasswordService:
    def __init__(
        self,
        *,
        accounts: AccountPasswordStore,
        passwords: AccountPasswordHasher,
    ) -> None:
        self._accounts = accounts
        self._passwords = passwords

    def change(
        self, context: AccountRequestContext | RequestContext, *, current_password: str, new_password: str
    ) -> AccountSnapshot:
        """Set or change only the admitted Account's password, without workspace scope.

        Existing credentials require current-password verification; an unset
        password does not. Invalid input, missing Accounts and concurrent changes
        fail without overwriting credentials. Hashing occurs outside transactions.
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

        password = self._passwords.hash(new_password)
        account = self._accounts.change_password(context.account_id, expected=credentials, password=password)
        if account is None:
            raise AccountNotFoundError
        return account
