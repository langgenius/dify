"""Contracts for non-streaming app run jobs: records, patches and the store protocol."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Final, Protocol

from models.enums import CreatorUserRole
from models.model import AppMode
from services.workflow.graph_check import GRAPH_MODES, MESSAGE_MODES

JOB_TTL_SECONDS: Final = 24 * 60 * 60
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

        Precondition: none.
        Postcondition: true exactly for SUCCEEDED, FAILED and STOPPED.
        """
        return self in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.STOPPED)


class JobFamily(StrEnum):
    GRAPH = "graph"
    MESSAGE = "message"

    @classmethod
    def for_mode(cls, mode: AppMode) -> JobFamily:
        """Map an app mode to the family that stores its result.

        Precondition: mode is a member of GRAPH_MODES or MESSAGE_MODES.
        Postcondition: returns GRAPH for graph modes and MESSAGE for message modes;
        raises ValueError for any other mode.
        """
        if mode in GRAPH_MODES:
            return cls.GRAPH
        if mode in MESSAGE_MODES:
            return cls.MESSAGE
        raise ValueError(f"App mode {mode!r} does not support run jobs")


@dataclass(frozen=True, slots=True, kw_only=True)
class JobOwner:
    tenant_id: str
    app_id: str
    caller_role: CreatorUserRole
    caller_id: str


@dataclass(frozen=True, slots=True, kw_only=True)
class JobRecord:
    id: str
    owner: JobOwner
    mode: AppMode
    op: str
    status: JobStatus
    task_id: str | None = None
    run_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None
    form: Mapping[str, Any] | None = None
    error: str | None = None
    stop_requested: bool = False

    @property
    def family(self) -> JobFamily:
        """Return the result family of this job's app mode.

        Precondition: self.mode supports run jobs.
        Postcondition: equals JobFamily.for_mode(self.mode).
        """
        return JobFamily.for_mode(self.mode)


@dataclass(frozen=True, slots=True, kw_only=True)
class JobPatch:
    status: JobStatus | None = None
    task_id: str | None = None
    run_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None
    form: Mapping[str, Any] | None = None
    error: str | None = None
    stop_requested: bool | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class OpenedJob:
    record: JobRecord
    created: bool


class RunJobStore(Protocol):
    def open(self, record: JobRecord, *, idempotency_key: str | None) -> OpenedJob:
        """Precondition: record.id unused. Postcondition: created=True stores the job; False returns the earlier one."""

    def get(self, job_id: str) -> JobRecord | None:
        """Precondition: none. Postcondition: the stored record, or None."""

    def patch(self, job_id: str, patch: JobPatch) -> None:
        """Precondition: none. Postcondition: set fields change; None fields and missing jobs are untouched."""

    def discard(self, job_id: str, *, idempotency_key: str | None) -> None:
        """Precondition: none. Postcondition: the job and its alive key are gone."""

    def touch(self, job_id: str) -> None:
        """Precondition: none. Postcondition: the alive key is refreshed."""

    def is_alive(self, job_id: str) -> bool:
        """Precondition: none. Postcondition: true while the alive key is live."""
