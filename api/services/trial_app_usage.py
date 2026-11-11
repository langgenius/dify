"""Port for recording recommended trial app usage."""

from typing import Protocol


class TrialAppUsageRecorder(Protocol):
    def record(self, *, app_id: str, account_id: str) -> None: ...
