"""Use cases for non-streaming app run jobs: start, view, wait and stop."""

from __future__ import annotations

import contextvars
import threading
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any, Final, Protocol

from flask import copy_current_request_context

from models.enums import CreatorUserRole
from models.model import AppMode
from services.run_job_contracts import (
    JobEnding,
    JobFailure,
    JobFamily,
    JobOwner,
    JobRecord,
    JobStatus,
    RunJobStore,
)
from services.run_job_reader import JobStopper, close_frames, read_to_end

if TYPE_CHECKING:
    from services.app_task_service import WorkflowStopOutcome

WAIT_DEFAULT_SECONDS: Final = 25
WAIT_MAX_SECONDS: Final = 45
POLL_INTERVAL_SECONDS: Final = 1.0
READER_THREAD_NAME: Final = "run-job-reader"
# Keyed job ids are uuid5 names in this namespace, so a repeated key names the same job.
JOB_ID_NAMESPACE: Final = uuid.UUID("5c1f2f86-6a47-4d3e-9a39-2f0b8d7c4e21")


@dataclass(frozen=True, slots=True, kw_only=True)
class JobOpening:
    owner: JobOwner
    mode: AppMode
    op: str
    idempotency_key: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class RunResult:
    status: JobStatus
    outputs: Mapping[str, Any] | None = None
    answer: str | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class JobView:
    record: JobRecord
    status: JobStatus
    answer: str | None = None
    outputs: Mapping[str, Any] | None = None
    error: str | None = None
    form: Mapping[str, Any] | None = None


class RunResultReader(Protocol):
    def run(self, *, tenant_id: str, run_id: str) -> RunResult | None:
        """Precondition: none. Postcondition: the stored result of the run, or None when it is not stored."""

    def pending_form(self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode) -> Mapping[str, Any] | None:
        """Precondition: the run is paused. Postcondition: its pending human input form, or None."""


class RunTaskControl(Protocol):
    def stop_workflow_run(
        self,
        *,
        tenant_id: str,
        app_id: str,
        run_id: str,
        app_mode: AppMode,
        caller_role: CreatorUserRole,
        caller_id: str,
    ) -> WorkflowStopOutcome:
        """Precondition: none. Postcondition: the run is asked to stop and the outcome is reported."""

    def stop_message_task(self, *, task_id: str, caller_role: CreatorUserRole, caller_id: str) -> bool:
        """Precondition: none. Postcondition: the task is asked to stop."""


class JobNotFoundError(Exception):
    """The job does not exist or belongs to another owner."""


class JobCapacityError(Exception):
    """The background run cap of this process is reached."""


def fail_if_reader_dead(store: RunJobStore, record: JobRecord, failure: JobFailure) -> JobRecord:
    """Fail a job whose reader has ended before the job reached a final status.

    Precondition: record is the stored state of the job. The reader refreshes the alive key on a timer for as long as
    it runs, frames or not, so the key lapses only when the reader has ended.
    Postcondition: the record unchanged while its alive key is live; otherwise the job is settled as FAILED for the
    given reason unless it is final already, and the stored record is returned (record, if the job is gone).
    """
    if store.is_alive(record.id):
        return record
    store.settle(record.id, JobEnding(status=JobStatus.FAILED, failure=failure))
    return store.get(record.id) or record


def _job_id(opening: JobOpening) -> str:
    """Postcondition: a random id without an idempotency key; with one, the same id for the same owner and key."""
    if opening.idempotency_key is None:
        return str(uuid.uuid4())
    owner = opening.owner
    name = f"{owner.tenant_id}:{owner.app_id}:{owner.caller_role}:{owner.caller_id}:{opening.idempotency_key}"
    return str(uuid.uuid5(JOB_ID_NAMESPACE, name))


class _Counter:
    """A thread-safe bounded counter of held slots."""

    def __init__(self, limit: int) -> None:
        """Create a counter.

        Precondition: limit is positive.
        Postcondition: no slot is held.
        """
        self._limit = limit
        self._held = 0
        self._lock = threading.Lock()

    def try_acquire(self) -> bool:
        """Take one slot.

        Precondition: none.
        Postcondition: true and one more slot is held when fewer than the limit were held; false otherwise.
        """
        with self._lock:
            if self._held >= self._limit:
                return False
            self._held += 1
            return True

    def release(self) -> None:
        """Give back one slot.

        Precondition: none.
        Postcondition: one fewer slot is held; the count never goes below zero.
        """
        with self._lock:
            self._held = max(0, self._held - 1)


def _stop_graph_job(tasks: RunTaskControl, record: JobRecord) -> None:
    """Stop the workflow run of a graph job when its run id is known.

    Precondition: record is a GRAPH job.
    Postcondition: the run is asked to stop; nothing happens while run_id is unset.
    """
    if record.run_id is None:
        return
    tasks.stop_workflow_run(
        tenant_id=record.owner.tenant_id,
        app_id=record.owner.app_id,
        run_id=record.run_id,
        app_mode=record.mode,
        caller_role=record.owner.caller_role,
        caller_id=record.owner.caller_id,
    )


def _stop_message_job(tasks: RunTaskControl, record: JobRecord) -> None:
    """Stop the task of a message job when its task id is known.

    Precondition: record is a MESSAGE job.
    Postcondition: the task is asked to stop; nothing happens while task_id is unset.
    """
    if record.task_id is None:
        return
    tasks.stop_message_task(
        task_id=record.task_id,
        caller_role=record.owner.caller_role,
        caller_id=record.owner.caller_id,
    )


_STOPS_BY_FAMILY: Final[Mapping[JobFamily, Callable[[RunTaskControl, JobRecord], None]]] = {
    JobFamily.GRAPH: _stop_graph_job,
    JobFamily.MESSAGE: _stop_message_job,
}


class TaskControlStopper:
    """Stops the run behind a job record through task control; serves the reader and RunJobService.stop."""

    def __init__(self, tasks: RunTaskControl) -> None:
        """Bind the task control.

        Precondition: none.
        Postcondition: stop sends stops through tasks.
        """
        self._tasks = tasks

    def stop(self, record: JobRecord) -> None:
        """Ask the run behind the record to stop.

        Precondition: none.
        Postcondition: the stop for the record's family was sent when the id it needs is known; otherwise nothing
        happened.
        """
        _STOPS_BY_FAMILY[record.family](self._tasks, record)


class RunJobService:
    """Starts jobs with their readers, and answers view, wait and stop for the owner of a job.

    Precondition: built once per process with a store, result reader and task control.
    Postcondition: background runs and waiters of this process stay within their caps.
    """

    def __init__(
        self,
        *,
        store: RunJobStore,
        results: RunResultReader,
        tasks: RunTaskControl,
        max_background_runs: int,
        max_waiters: int,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        """Create the service.

        Precondition: both caps are positive; sleep and monotonic are consistent with each other.
        Postcondition: no slot or waiter is held.
        """
        self._store = store
        self._results = results
        self._stopper: JobStopper = TaskControlStopper(tasks)
        self._slots = _Counter(max_background_runs)
        self._waiters = _Counter(max_waiters)
        self._sleep = sleep
        self._monotonic = monotonic

    def start(self, opening: JobOpening, launch: Callable[[], Iterable[str]]) -> str:
        """Create a job and start its run, or return the earlier job for the same idempotency key.

        Precondition: called inside a request context; opening.mode supports run jobs; launch starts the run and
        returns its SSE frames.
        Postcondition: returns the job id: derived from the owner and the key when a key is given, so the earlier
        job of a repeated key is returned without launching or taking a slot; random otherwise. For a new job,
        launch ran once and a daemon reader thread holds one background slot until the stream ends. When the store
        raises, nothing ran. At the cap, JobCapacityError is raised before launching and the new job is removed.
        When launch or the reader start raises, the frames are closed, the slot is released, the job is removed
        and the error propagates.
        """
        job_id = _job_id(opening)
        record = JobRecord(id=job_id, owner=opening.owner, mode=opening.mode, op=opening.op)
        # Store first so a repeated key at the cap still returns its earlier job.
        if not self._store.create(record):
            return job_id
        if not self._slots.try_acquire():
            self._store.discard(job_id)
            raise JobCapacityError("Too many background runs are active")
        frames: Iterable[str] = ()
        try:
            frames = launch()
            self._read_in_background(job_id, frames)
        except BaseException:
            self._slots.release()
            close_frames(frames)
            self._store.discard(job_id)
            raise
        return job_id

    def _read_in_background(self, job_id: str, frames: Iterable[str]) -> None:
        """Read the run's frames on a daemon thread that releases the job's slot when the stream ends.

        Precondition: called inside a request context while the job holds a slot.
        Postcondition: the reader thread started; raises, starting nothing, when it cannot.
        """
        context = contextvars.copy_context()

        def reader_with_context() -> None:
            """Read the stream under the copied contexts.

            Precondition: runs on the reader thread.
            Postcondition: the stream was read to its end and the slot is released.
            """
            try:
                context.run(
                    read_to_end,
                    job_id=job_id,
                    frames=frames,
                    store=self._store,
                    stopper=self._stopper,
                )
            finally:
                self._slots.release()

        thread = threading.Thread(
            target=copy_current_request_context(reader_with_context),
            name=READER_THREAD_NAME,
            daemon=True,
        )
        thread.start()

    def view(self, owner: JobOwner, job_id: str) -> JobView:
        """Describe a job's current state.

        Precondition: none.
        Postcondition: a view of the job; a GRAPH job with a stored run takes status, outputs and error from the
        run, and its form from the pending form while paused (None otherwise). A GRAPH job
        without a run id whose reader has ended and which is not final is FAILED as RUN_NOT_CONFIRMED, and that
        is saved; once saved it is final for good, even if a run id and a run row appear later. Without a visible
        run row, and for
        MESSAGE jobs, the record's own status and error are used, with no form. Raises JobNotFoundError when the job is
        missing or owned by someone else.
        """
        record = self._store.get(job_id)
        if record is None:
            raise JobNotFoundError(job_id)
        if record.owner != owner:
            raise JobNotFoundError(job_id)
        return self._view_of(record)

    def _view_of(self, record: JobRecord) -> JobView:
        """Build the view of a record.

        Precondition: record is stored.
        Postcondition: see view.
        """
        fallback = JobView(record=record, status=record.status, error=record.error)
        if record.family is not JobFamily.GRAPH:
            return fallback
        if record.failure is not None:
            # Already reported final: a run that starts late is not linked to the job.
            return fallback
        if record.run_id is None:
            unconfirmed = fail_if_reader_dead(self._store, record, JobFailure.RUN_NOT_CONFIRMED)
            return JobView(record=unconfirmed, status=unconfirmed.status, error=unconfirmed.error)
        run = self._results.run(tenant_id=record.owner.tenant_id, run_id=record.run_id)
        if run is None:
            return fallback
        form = None
        if run.status is JobStatus.PAUSED:
            form = self._results.pending_form(
                tenant_id=record.owner.tenant_id,
                app_id=record.owner.app_id,
                run_id=record.run_id,
                mode=record.mode,
            )
        return JobView(record=record, status=run.status, outputs=run.outputs, error=run.error, form=form)

    def wait(self, owner: JobOwner, job_id: str, *, wait_seconds: int) -> JobView:
        """Wait for a job to finish or pause.

        Precondition: wait_seconds is not negative.
        Postcondition: returns once the job is final or paused with a waiting form, the clamped wait time is used
        up, or at once for wait_seconds of 0 or when max_waiters calls already wait in this process. Raises
        JobNotFoundError as view does.
        """
        view = self.view(owner, job_id)
        seconds = min(wait_seconds, WAIT_MAX_SECONDS)
        if seconds <= 0:
            return view
        if not self._waiters.try_acquire():
            return view
        try:
            deadline = self._monotonic() + seconds
            remaining = float(seconds)
            while not _settled(view) and remaining > 0:
                self._sleep(min(POLL_INTERVAL_SECONDS, remaining))
                view = self.view(owner, job_id)
                remaining = deadline - self._monotonic()
        finally:
            self._waiters.release()
        return view

    def stop(self, owner: JobOwner, job_id: str) -> JobView:
        """Ask a job to stop.

        Precondition: none.
        Postcondition: for a job that is not final, stop_requested is stored and the run is stopped now when its id
        is known, otherwise the reader sends the stop once the id arrives; a final job is left untouched and
        nothing is sent. Returns the fresh view. Raises JobNotFoundError when the job is missing or owned by
        someone else.
        """
        record = self._store.get(job_id)
        if record is None:
            raise JobNotFoundError(job_id)
        if record.owner != owner:
            raise JobNotFoundError(job_id)
        view = self._view_of(record)
        if view.status.is_final:
            return view
        self._store.request_stop(job_id)
        # Re-read so ids stored by the reader since the first read are not missed.
        stopping = replace(self._store.get(job_id) or record, stop_requested=True)
        self._stopper.stop(stopping)
        return self._view_of(stopping)


def _settled(view: JobView) -> bool:
    """Report whether waiting for the job is pointless.

    Precondition: none.
    Postcondition: true when the view's status is final, or paused with a form waiting for input. A paused job
    without a form is being resumed, so it is not settled.
    """
    if view.status.is_final:
        return True
    return view.status is JobStatus.PAUSED and view.form is not None
