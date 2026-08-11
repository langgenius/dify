"""Persistence ports used by account application services."""

from typing import Protocol

from services.entities.account_entities import AccountProfileChanges, AccountSnapshot


class AccountRepository(Protocol):
    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None: ...
