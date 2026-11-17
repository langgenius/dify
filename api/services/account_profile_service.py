"""Application service for reading and updating the current account profile."""

from typing import Protocol

from machinery.context import AccountRequestContext, RequestContext
from services.account_errors import AccountNotFoundError
from services.entities.account_entities import AccountProfile, AccountProfileChanges, AccountSnapshot


class AccountProfileStore(Protocol):
    def get_profile(self, account_id: str) -> AccountProfile | None:
        """Read the Account and its existing membership flags in one database snapshot."""
        ...

    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None: ...


class AccountProfileService:
    def __init__(self, *, accounts: AccountProfileStore) -> None:
        self._accounts = accounts

    def get(self, context: AccountRequestContext | RequestContext) -> AccountProfile:
        account = self._accounts.get_profile(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return account

    def update(
        self, context: AccountRequestContext | RequestContext, changes: AccountProfileChanges
    ) -> AccountSnapshot:
        """Apply submitted fields to the admitted Account, without requiring a workspace.

        Empty changes are a read-only no-op. A missing Account raises
        AccountNotFoundError and cannot cause creation or membership changes.
        """
        if changes.has_changes():
            account = self._accounts.update_profile(context.account_id, changes)
        else:
            account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return account
