"""Application service for reading and updating the current account profile."""

from machinery.context import RequestContext
from services.account_ports import AccountUnitOfWorkFactory
from services.entities.account_entities import AccountProfileChanges, AccountSnapshot


class AccountNotFoundError(Exception):
    """The admitted account no longer exists."""


class EmptyAccountProfileChangesError(ValueError):
    """A profile update did not contain a supported field."""


class AccountProfileService:
    def __init__(self, *, unit_of_work: AccountUnitOfWorkFactory) -> None:
        self._unit_of_work = unit_of_work

    def get(self, context: RequestContext) -> AccountSnapshot:
        with self._unit_of_work() as unit_of_work:
            account = unit_of_work.accounts.get(context.account_id)
        if account is None:
            raise AccountNotFoundError
        return account

    def update(self, context: RequestContext, changes: AccountProfileChanges) -> AccountSnapshot:
        if not changes.has_changes():
            raise EmptyAccountProfileChangesError

        with self._unit_of_work() as unit_of_work:
            account = unit_of_work.accounts.update_profile(context.account_id, changes)
            if account is None:
                raise AccountNotFoundError
            unit_of_work.commit()
        return account
