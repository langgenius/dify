"""Application service for the self-hosted initialization gate."""

import hmac
from typing import Protocol


class InitValidationState(Protocol):
    def has_tenants(self) -> bool: ...

    def is_setup(self) -> bool: ...


class AlreadyInitializedError(Exception):
    """Raised when initialization has already created a tenant."""


class InvalidInitializationPasswordError(Exception):
    """Raised when the supplied initialization password does not match."""


class InitValidationService:
    def __init__(
        self,
        *,
        state: InitValidationState,
        validation_required: bool,
        expected_password: str,
    ) -> None:
        self._state = state
        self._validation_required = validation_required
        self._expected_password = expected_password

    def is_validated(self, *, session_validated: bool) -> bool:
        if not self._validation_required or session_validated:
            return True

        return self._state.is_setup()

    def validate_password(self, password: str) -> None:
        if self._state.has_tenants():
            raise AlreadyInitializedError

        expected_password = self._expected_password
        if (
            not password
            or not expected_password
            or not hmac.compare_digest(
                password.encode("utf-8"),
                expected_password.encode("utf-8"),
            )
        ):
            raise InvalidInitializationPasswordError
