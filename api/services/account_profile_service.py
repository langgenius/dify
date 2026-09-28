"""Application service for reading and updating the current account profile."""

from machinery.context import RequestContext
from services.account_errors import AccountNotFoundError
from services.account_ports import AccountRepository
from services.entities.account_entities import AccountProfileChanges, AccountSnapshot


class AccountProfileService:
    def __init__(self, *, accounts: AccountRepository) -> None:
        self._accounts = accounts

    def get(self, context: RequestContext) -> AccountSnapshot:
        account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return account

    def update(self, context: RequestContext, changes: AccountProfileChanges) -> AccountSnapshot:
        if changes.has_changes():
            account = self._accounts.update_profile(context.account_id, changes)
        else:
            account = self._accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return account
