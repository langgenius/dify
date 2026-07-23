"""Local compensation for newly created physical resources."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ResourceCreationCompensation:
    key: str
    callback: Callable[[], None]
    _resolved: bool = False

    def compensate(self) -> None:
        if self._resolved:
            return
        self._resolved = True
        try:
            self.callback()
        except Exception:
            logger.exception("Failed to compensate physical resource creation", extra={"resource_key": self.key})

    def release(self) -> None:
        self._resolved = True


@dataclass(slots=True)
class ResourceCreationCompensations:
    _items: list[ResourceCreationCompensation] = field(default_factory=list)

    def register(self, *, key: str, compensate: Callable[[], None]) -> None:
        self._items.append(ResourceCreationCompensation(key=key, callback=compensate))

    def compensate(self) -> None:
        for item in reversed(self._items):
            item.compensate()

    def release(self) -> None:
        for item in self._items:
            item.release()


@contextmanager
def resource_creation_compensation() -> Iterator[ResourceCreationCompensations]:
    """Compensate resources when the current block fails, without owning a DB transaction."""

    compensations = ResourceCreationCompensations()
    try:
        yield compensations
    except BaseException:
        compensations.compensate()
        raise
    else:
        compensations.release()


@contextmanager
def resource_creation_transaction(session: Session) -> Iterator[ResourceCreationCompensations]:
    """Run a use case transaction with safe pre-commit resource compensation.

    Once the final flush succeeds, a later commit error has an unknown outcome. In
    that case physical resources are deliberately preserved for reconciliation.
    """

    compensations = ResourceCreationCompensations()
    final_flush_succeeded = False
    try:
        with session.begin():
            yield compensations
            session.flush()
            final_flush_succeeded = True
    except BaseException:
        if not final_flush_succeeded:
            compensations.compensate()
        raise
    else:
        compensations.release()


__all__ = [
    "ResourceCreationCompensation",
    "ResourceCreationCompensations",
    "resource_creation_compensation",
    "resource_creation_transaction",
]
