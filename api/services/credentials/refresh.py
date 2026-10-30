"""Coordination contracts for refreshing one persisted provider credential."""

from contextlib import AbstractContextManager
from typing import Literal, Protocol


def credential_needs_refresh(expires_at: int, *, now: float) -> bool:
    return expires_at != -1 and expires_at - 60 < int(now)


class CredentialRefreshUnavailableError(RuntimeError):
    """Temporary coordination failure; preserve it until the caller chooses a retry response."""

    def __init__(self) -> None:
        super().__init__("Credential refresh is temporarily unavailable. Please retry.")


class CredentialRefreshLease(Protocol):
    def ensure_owned(self) -> None:
        """Renew ownership or fail before issuing a refresh or persisting its result."""
        ...


class CredentialRefreshLock(Protocol):
    def acquire(
        self, *, credential_type: Literal["tool", "datasource"], workspace_id: str, credential_id: str
    ) -> AbstractContextManager[CredentialRefreshLease]:
        """Serialize refreshes across workers, with bounded waiting and a renewed lease.

        Callers reload the credential after acquisition and keep this lease through
        the external refresh and the committed conditional write. No database
        transaction may span the external request. Failure never permits an
        unlocked refresh or a return of the original expired credential.
        """
        ...
