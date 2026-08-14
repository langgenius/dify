"""Port for account data needed by Console application services."""

from typing import Protocol

from services.entities.account_entities import AccountProfile


class AccountQuery(Protocol):
    def get_profile(self, account_id: str) -> AccountProfile | None: ...
