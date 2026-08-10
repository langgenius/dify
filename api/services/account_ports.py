"""Persistence ports used by account application services."""

from types import TracebackType
from typing import Protocol, Self

from services.entities.account_entities import AccountProfileChanges, AccountSnapshot


class AccountRepository(Protocol):
    def get(self, account_id: str) -> AccountSnapshot | None: ...

    def update_profile(self, account_id: str, changes: AccountProfileChanges) -> AccountSnapshot | None: ...


class AccountUnitOfWork(Protocol):
    @property
    def accounts(self) -> AccountRepository: ...

    def __enter__(self) -> Self: ...

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> bool | None: ...

    def commit(self) -> None: ...

    def rollback(self) -> None: ...


class AccountUnitOfWorkFactory(Protocol):
    def __call__(self) -> AccountUnitOfWork: ...
