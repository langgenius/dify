"""States returned for permanent deletion of a monthly workflow-run archive."""

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol


class WorkflowRunArchiveDeletionStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass(frozen=True)
class WorkflowRunArchiveDeletionTask:
    year: int
    month: int
    status: WorkflowRunArchiveDeletionStatus
    error: str | None = None


class WorkflowRunArchiveDeletionDispatcher(Protocol):
    def __call__(self, *, tenant_id: str, year: int, month: int) -> None: ...
