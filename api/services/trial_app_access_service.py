"""Resolve trial execution access without exposing persistence models."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class TrialAppRef:
    app_id: str
    tenant_id: str
    app_mode: str


@dataclass(frozen=True)
class TrialAppAccessSnapshot:
    app: TrialAppRef
    trial_limit: int
    used_count: int | None


class TrialAppAccessQuery(Protocol):
    def resolve(self, *, app_id: str, account_id: str) -> TrialAppAccessSnapshot | None: ...


class TrialAppUnavailableError(Exception):
    """The requested app is unavailable for trial execution."""


class TrialAppUsageLimitExceededError(Exception):
    """The account has exhausted the requested app's trial allowance."""


class TrialAppAccessService:
    def __init__(self, *, apps: TrialAppAccessQuery) -> None:
        self._apps: TrialAppAccessQuery = apps

    def get_access(self, *, app_id: str, account_id: str) -> TrialAppRef:
        access = self._apps.resolve(app_id=app_id, account_id=account_id)
        if access is None:
            raise TrialAppUnavailableError(f"App {app_id} is unavailable for trial execution")

        # Preserve the first-use allowance, including when the configured limit is zero.
        if access.used_count is not None and access.used_count >= access.trial_limit:
            raise TrialAppUsageLimitExceededError(
                f"Account {account_id} has used {access.used_count} trials of app {app_id} "
                f"with a limit of {access.trial_limit}"
            )
        return access.app
