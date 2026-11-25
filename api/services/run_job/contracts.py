"""Contracts for non-streaming app run jobs: records, their writes and the store protocol."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Final, Protocol

from models.enums import CreatorUserRole
from models.model import AppMode

ALIVE_TTL_SECONDS: Final = 45


class JobStatus(StrEnum):
    RUNNING = "running"
    PAUSED = "paused"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    STOPPED = "stopped"

    @property
    def is_final(self) -> bool:
        """Report whether no further status change can follow.

        Postcondition: true exactly for SUCCEEDED, FAILED and STOPPED.
        """
        return self in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.STOPPED)


class JobFailure(StrEnum):
    """Why the job service, not the run, failed a job; message is the error text reported for it."""

    message: str

    RUN_NOT_CONFIRMED = ("run_not_confirmed", "run start was not confirmed; it may still execute")
    NO_RESULT = ("no_result", "run ended without a result")
    RUN_STALLED = ("run_stalled", "run passed the workflow time limit without finishing; its worker may have stopped")
    RUN_INTERRUPTED = ("run_interrupted", "run was interrupted")

    def __new__(cls, value: str, message: str) -> JobFailure:
        member = str.__new__(cls, value)
        member._value_ = value
        member.message = message
        return member


@dataclass(frozen=True, slots=True, kw_only=True)
class JobOwner:
    tenant_id: str
    app_id: str
    caller_role: CreatorUserRole
    caller_id: str


@dataclass(frozen=True, slots=True, kw_only=True)
class JobEnding:
    """A job's final state. error is the run's own text; a failure reason carries its message instead."""

    status: JobStatus
    failure: JobFailure | None = None
    error: str | None = None

    def __post_init__(self) -> None:
        """Postcondition: raises ValueError unless status is final."""
        if not self.status.is_final:
            raise ValueError(f"A job ending needs a final status, not {self.status}")


@dataclass(frozen=True, slots=True, kw_only=True)
class JobRecord:
    id: str
    owner: JobOwner
    mode: AppMode
    op: str
    task_id: str | None = None
    run_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None
    stop_requested: bool = False
    ending: JobEnding | None = None

    @property
    def status(self) -> JobStatus:
        """Postcondition: RUNNING until the job has an ending, then the ending's status."""
        if self.ending is None:
            return JobStatus.RUNNING
        return self.ending.status

    @property
    def failure(self) -> JobFailure | None:
        """Postcondition: why the service failed the job, or None."""
        if self.ending is None:
            return None
        return self.ending.failure

    @property
    def error(self) -> str | None:
        """Postcondition: the failure reason's message when the service failed the job, else the run's error."""
        if self.failure is not None:
            return self.failure.message
        if self.ending is None:
            return None
        return self.ending.error


@dataclass(frozen=True, slots=True, kw_only=True)
class JobIds:
    task_id: str | None = None
    run_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None


class RunJobStore(Protocol):
    def create(self, record: JobRecord) -> bool:
        """Precondition: record is a new job. Postcondition: true when stored; false, writing nothing, when a job with
        its id exists. Atomic on the job's key."""

    def get(self, job_id: str) -> JobRecord | None:
        """Postcondition: the stored record, or None."""

    def record_ids(self, job_id: str, ids: JobIds) -> None:
        """Postcondition: the ids that are set are stored; a missing job is not recreated."""

    def settle(self, job_id: str, ending: JobEnding) -> bool:
        """Postcondition: true when the job existed without an ending and now holds this one;
        false, with nothing written, otherwise. The ending is written once, atomically on the job's key."""

    def request_stop(self, job_id: str) -> None:
        """Postcondition: stop_requested is set; a missing job is not recreated."""

    def discard(self, job_id: str) -> None:
        """Postcondition: the job and its alive key are gone."""

    def touch(self, job_id: str) -> None:
        """Postcondition: the alive key is refreshed."""

    def drop_alive(self, job_id: str) -> None:
        """Postcondition: the alive key is gone."""

    def is_alive(self, job_id: str) -> bool:
        """Postcondition: true while the alive key is live."""
