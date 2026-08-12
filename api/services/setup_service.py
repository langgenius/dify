"""Application service for first-time Dify setup."""

from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True, slots=True)
class SetupInput:
    email: str
    name: str
    password: str
    ip_address: str
    language: str | None


@dataclass(frozen=True, slots=True)
class SetupStatus:
    completed: bool
    setup_at: datetime | None = None


class SetupState(Protocol):
    def get_setup_at(self) -> datetime | None: ...

    def has_tenants(self) -> bool: ...


class SetupAccountProvisioner(Protocol):
    def provision(self, setup: SetupInput) -> None: ...


class SetupLock(Protocol):
    def acquire(self) -> AbstractContextManager[None]: ...


class SetupAlreadyCompletedError(Exception):
    """Raised when setup has already created persistent installation state."""


class InitializationValidationRequiredError(Exception):
    """Raised when initialization-password validation has not completed."""


class SetupService:
    def __init__(
        self,
        *,
        state: SetupState,
        accounts: SetupAccountProvisioner,
        lock: SetupLock,
        setup_required: bool,
    ) -> None:
        self._state = state
        self._accounts = accounts
        self._lock = lock
        self._setup_required = setup_required

    def get_status(self) -> SetupStatus:
        if not self._setup_required:
            return SetupStatus(completed=True)

        setup_at = self._state.get_setup_at()
        return SetupStatus(completed=setup_at is not None, setup_at=setup_at)

    def initialize(self, setup: SetupInput, *, initialization_validated: bool) -> None:
        with self._lock.acquire():
            if self._state.get_setup_at() is not None or self._state.has_tenants():
                raise SetupAlreadyCompletedError

            if not initialization_validated:
                raise InitializationValidationRequiredError

            self._accounts.provision(
                SetupInput(
                    email=setup.email.lower(),
                    name=setup.name,
                    password=setup.password,
                    ip_address=setup.ip_address,
                    language=setup.language,
                )
            )
