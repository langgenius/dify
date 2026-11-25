"""Use cases for non-streaming app run jobs: start, view, wait and stop."""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any, Final, Protocol

from core.app.entities.task_entities import HumanInputRequiredResponse, StreamEvent
from libs.datetime_utils import naive_utc_now
from libs.stream import close_stream
from models.enums import CreatorUserRole
from models.model import AppMode
from services.run_job.contracts import (
    JobEnding,
    JobFailure,
    JobOwner,
    JobRecord,
    JobStatus,
    RunJobStore,
)
from services.run_job.frames import RunFrame
from services.run_job.reader import StreamEndings, read_to_end, run_finished_ending
from services.workflow.graph_check import GRAPH_MODES, MESSAGE_MODES

if TYPE_CHECKING:
    from services.app_task_service import WorkflowStopOutcome

WAIT_DEFAULT_SECONDS: Final = 25
WAIT_MAX_SECONDS: Final = 45
POLL_INTERVAL_SECONDS: Final = 1.0
READER_THREAD_NAME: Final = "run-job-reader"
# Keyed job ids are uuid5 names in this namespace, so a repeated key names the same job.
JOB_ID_NAMESPACE: Final = uuid.UUID("5c1f2f86-6a47-4d3e-9a39-2f0b8d7c4e21")
# Core checks its run time limit only when a node finishes, so a live run can pass the limit by one node's length.
RUN_TIME_LIMIT_MARGIN: Final = timedelta(minutes=15)


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
    error: str | None = None
    # When a running run started or last resumed (naive UTC); None when it is not running or this is not known.
    running_since: datetime | None = None


@dataclass(frozen=True, slots=True, kw_only=True)
class MessageResult:
    answer: str
    error: str | None


@dataclass(frozen=True, slots=True, kw_only=True)
class JobView:
    record: JobRecord
    status: JobStatus
    answer: str | None = None
    outputs: Mapping[str, Any] | None = None
    error: str | None = None
    form: HumanInputRequiredResponse | None = None


class RunResultReader(Protocol):
    def run(self, *, tenant_id: str, run_id: str) -> RunResult | None:
        """Postcondition: the stored result of the run, or None when it is not stored."""

    def pending_form(
        self, *, tenant_id: str, app_id: str, run_id: str, mode: AppMode
    ) -> HumanInputRequiredResponse | None:
        """Precondition: the run is paused. Postcondition: its pending human input form, or None."""

    def message(self, *, app_id: str, message_id: str) -> MessageResult | None:
        """Postcondition: the saved answer and error of the message, or None when not stored."""


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
        """Postcondition: the run is asked to stop and the outcome is reported."""

    def stop_message_task(self, *, task_id: str, caller_role: CreatorUserRole, caller_id: str) -> bool:
        """Postcondition: the task is asked to stop."""


class JobNotFoundError(Exception):
    """The job does not exist or belongs to another owner."""


class JobCapacityError(Exception):
    """The background run cap of this process is reached."""


def fail_if_reader_dead(store: RunJobStore, record: JobRecord, failure: JobFailure, *, reader_alive: bool) -> JobRecord:
    """Fail a job whose reader died before recording an ending.

    Precondition: reader_alive was read before record. A reader deletes the alive key after its last write and the
    key lapses when a reader dies, so a record read after the key was found gone holds every write of the reader.
    Postcondition: the record unchanged while the reader is alive; otherwise the job is settled as FAILED for the
    given reason unless it has an ending already, and the stored record is returned (record, if the job is gone).
    """
    if reader_alive:
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


class GraphJobs:
    """Workflow and chatflow jobs: once the run id is known, the run row is the job's state."""

    modes: Final = GRAPH_MODES
    # A graph stream ends with workflow_finished or workflow_paused: core's worker follows an error with a failed
    # workflow_finished that carries the same message, and that frame is the only outcome of a run that failed
    # before it was stored. For a chatflow it also comes after the answer is saved. A chatflow answered without a
    # run (annotation reply, input moderation) ends with message_end, as core's worker completes that stream.
    ending_events: Final = frozenset({StreamEvent.WORKFLOW_FINISHED, StreamEvent.MESSAGE_END})

    def at_frame(self, record: JobRecord, frame: RunFrame) -> JobEnding | None:
        """Postcondition: the finished run's ending for workflow_finished; SUCCEEDED for message_end while the job
        has no run id, as the message is then its result; None for any other frame."""
        if frame.event is StreamEvent.MESSAGE_END:
            return None if record.run_id is not None else JobEnding(status=JobStatus.SUCCEEDED)
        return run_finished_ending(frame)

    def at_stream_end(self, record: JobRecord) -> JobEnding | None:
        """Postcondition: RUN_NOT_CONFIRMED when the stream ended before naming a run; None otherwise."""
        if record.run_id is not None:
            return None
        return JobEnding(status=JobStatus.FAILED, failure=JobFailure.RUN_NOT_CONFIRMED)

    def stop(self, tasks: RunTaskControl, record: JobRecord) -> None:
        """Postcondition: the workflow run is asked to stop; nothing happens while run_id is unset."""
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

    def view(
        self,
        record: JobRecord,
        reader_alive: bool,
        store: RunJobStore,
        results: RunResultReader,
        *,
        stalled_before: datetime,
    ) -> JobView:
        """Precondition: reader_alive was read before record; a run running since before stalled_before is past
        core's time limit and the margin. Postcondition: see RunJobService.view."""
        if record.failure is not None:
            # Already reported final: a run that starts late is not linked to the job.
            return _record_view(record)
        if record.run_id is None:
            unconfirmed = fail_if_reader_dead(store, record, JobFailure.RUN_NOT_CONFIRMED, reader_alive=reader_alive)
            return _answered_without_run(results, unconfirmed)
        run = results.run(tenant_id=record.owner.tenant_id, run_id=record.run_id)
        if run is None:
            return _record_view(record)
        if _stalled(run, stalled_before):
            store.settle(record.id, JobEnding(status=JobStatus.FAILED, failure=JobFailure.RUN_STALLED))
            return _record_view(store.get(record.id) or record)
        form = None
        if run.status is JobStatus.PAUSED:
            form = results.pending_form(
                tenant_id=record.owner.tenant_id,
                app_id=record.owner.app_id,
                run_id=record.run_id,
                mode=record.mode,
            )
        view = JobView(record=record, status=run.status, outputs=run.outputs, error=run.error, form=form)
        if not run.status.is_final:
            return view
        if record.message_id is None:
            return view
        if not record.status.is_final:
            # The run row turns final before the reader saves the answer and records the ending.
            if reader_alive:
                return JobView(record=record, status=JobStatus.RUNNING)
        message = _saved_message(results, record)
        if message is None:
            return view
        return replace(view, answer=message.answer)


class MessageJobs:
    """Chat, agent-chat and completion jobs: the record and the message row are the job's state."""

    modes: Final = MESSAGE_MODES
    ending_events: Final = frozenset({StreamEvent.MESSAGE_END, StreamEvent.ERROR})

    def at_frame(self, record: JobRecord, frame: RunFrame) -> JobEnding | None:
        """Postcondition: FAILED with the message for an error; at message_end, STOPPED when a stop was requested,
        else SUCCEEDED; None for any other frame."""
        if frame.event is StreamEvent.ERROR:
            return JobEnding(status=JobStatus.FAILED, error=frame.error)
        if frame.event is not StreamEvent.MESSAGE_END:
            return None
        if record.stop_requested:
            return JobEnding(status=JobStatus.STOPPED)
        return JobEnding(status=JobStatus.SUCCEEDED)

    def at_stream_end(self, record: JobRecord) -> JobEnding | None:
        """Postcondition: NO_RESULT; a job the stream finished keeps its ending, as settle writes only once."""
        return JobEnding(status=JobStatus.FAILED, failure=JobFailure.NO_RESULT)

    def stop(self, tasks: RunTaskControl, record: JobRecord) -> None:
        """Postcondition: the task is asked to stop; nothing happens while task_id is unset."""
        if record.task_id is None:
            return
        tasks.stop_message_task(
            task_id=record.task_id,
            caller_role=record.owner.caller_role,
            caller_id=record.owner.caller_id,
        )

    def view(
        self,
        record: JobRecord,
        reader_alive: bool,
        store: RunJobStore,
        results: RunResultReader,
        *,
        stalled_before: datetime,
    ) -> JobView:
        """Precondition: reader_alive was read before record; stalled_before does not apply, as a message job has no
        run row. Postcondition: see RunJobService.view."""
        checked = fail_if_reader_dead(store, record, JobFailure.RUN_INTERRUPTED, reader_alive=reader_alive)
        view = _record_view(checked)
        if not checked.status.is_final:
            return view
        if checked.failure is not None:
            return view
        message = _saved_message(results, checked)
        if message is None:
            return view
        error = message.error if message.error is not None else checked.error
        return replace(view, answer=message.answer, error=error)


GRAPH_JOBS: Final = GraphJobs()
MESSAGE_JOBS: Final = MessageJobs()


def family_of(mode: AppMode) -> GraphJobs | MessageJobs:
    """Postcondition: the family whose modes hold mode; raises ValueError for any other mode."""
    if mode in GRAPH_JOBS.modes:
        return GRAPH_JOBS
    if mode in MESSAGE_JOBS.modes:
        return MESSAGE_JOBS
    raise ValueError(f"App mode {mode!r} does not support run jobs")


def _stalled(run: RunResult, stalled_before: datetime) -> bool:
    """Report whether a run stays running past core's time limit and the margin, as when its worker died.

    Precondition: stalled_before is now minus core's time limit and RUN_TIME_LIMIT_MARGIN.
    Postcondition: true only for a running run whose start or last resume is known and before stalled_before.
    Paused time never counts: a paused run is not running, and a resumed run counts from its resume, as core's
    limit does.
    """
    if run.status is not JobStatus.RUNNING:
        return False
    if run.running_since is None:
        return False
    return run.running_since < stalled_before


def _record_view(record: JobRecord) -> JobView:
    """Build a view from the record's own fields.

    Postcondition: status and error are the record's; answer, outputs and form are None.
    """
    return JobView(record=record, status=record.status, error=record.error)


def _answered_without_run(results: RunResultReader, record: JobRecord) -> JobView:
    """View a graph job that has no run id.

    Precondition: record is a GRAPH job without a run id.
    Postcondition: the record's view; for a chatflow that ended without a failure (an annotation reply or input
    moderation answered it and no run started), with the saved message's answer.
    """
    view = _record_view(record)
    if not record.status.is_final:
        return view
    if record.failure is not None:
        return view
    message = _saved_message(results, record)
    if message is None:
        return view
    return replace(view, answer=message.answer)


def _saved_message(results: RunResultReader, record: JobRecord) -> MessageResult | None:
    """Read the saved message of a finished job.

    Precondition: the job's status is final.
    Postcondition: the message row's answer and error; None when the record has no message id or the row is not
    visible.
    """
    if record.message_id is None:
        return None
    return results.message(app_id=record.owner.app_id, message_id=record.message_id)


# Runs a job's reader on a thread of its own; raises, starting nothing, when it cannot.
type ReaderStarter = Callable[[Callable[[], None]], None]


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
        run_time_limit: timedelta,
        start_reader: ReaderStarter,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = naive_utc_now,
    ) -> None:
        """Create the service.

        Precondition: both caps are positive; run_time_limit is core's limit on one run's execution time; start_reader
        runs the function it gets on a thread of its own, or raises and starts nothing; sleep and monotonic are
        consistent with each other; now returns naive UTC time, as run rows store it.
        Postcondition: no slot or waiter is held.
        """
        self._store = store
        self._results = results
        self._tasks = tasks
        self._slots = threading.BoundedSemaphore(max_background_runs)
        self._waiters = threading.BoundedSemaphore(max_waiters)
        self._stalled_after = run_time_limit + RUN_TIME_LIMIT_MARGIN
        self._start_reader = start_reader
        self._sleep = sleep
        self._monotonic = monotonic
        self._now = now

    def start(self, opening: JobOpening, launch: Callable[[], Iterable[str]]) -> str:
        """Create a job and start its run, or return the earlier job for the same idempotency key.

        Precondition: called where start_reader can start a reader; opening.mode supports run jobs; launch starts the
        run and returns its SSE frames.
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
        if not self._slots.acquire(blocking=False):
            self._store.discard(job_id)
            raise JobCapacityError("Too many background runs are active")
        frames: Iterable[str] = ()
        try:
            frames = launch()
            self._read_in_background(job_id, frames, family_of(opening.mode))
        except BaseException:
            self._slots.release()
            close_stream(frames)
            self._store.discard(job_id)
            raise
        return job_id

    def _read_in_background(self, job_id: str, frames: Iterable[str], endings: StreamEndings) -> None:
        """Hand start_reader the reader of the run's frames, which releases the job's slot when the stream ends.

        Precondition: the job holds a slot.
        Postcondition: the reader started; raises, starting nothing, when start_reader cannot start it.
        """

        def read_and_release() -> None:
            """Read the stream to its end, then free the slot.

            Postcondition: the slot is released, also when reading raised.
            """
            try:
                read_to_end(job_id=job_id, frames=frames, store=self._store, stopper=self._stop, endings=endings)
            finally:
                self._slots.release()

        self._start_reader(read_and_release)

    def _stop(self, record: JobRecord) -> None:
        """Ask the run behind the record to stop; serves the reader and stop.

        Postcondition: the stop for the record's family was sent when the id it needs is known; otherwise nothing
        happened.
        """
        family_of(record.mode).stop(self._tasks, record)

    def view(self, owner: JobOwner, job_id: str) -> JobView:
        """Describe a job's current state.

        Postcondition: a view of the job. The alive key is read before the record. A GRAPH job with a stored run
        takes status, outputs and error from the run, and its form from the pending form while paused (None
        otherwise). A GRAPH job without a run id whose reader died (alive key gone, no ending) is FAILED as
        RUN_NOT_CONFIRMED, and that is saved; once saved it is final for good, even if a run id and a run row appear
        later. A GRAPH job whose run stays running past core's time limit and RUN_TIME_LIMIT_MARGIN (see _stalled) is
        FAILED as RUN_STALLED, and that is saved and final for good in the same way. Without a visible run row the
        record's own status and error are used, with no form. A MESSAGE job whose reader died is FAILED as
        RUN_INTERRUPTED, and that is saved. For a job that is final, with a message id and a visible message row, the
        answer is the message's answer. A GRAPH job whose run is final but whose record has no ending while its
        reader is alive is RUNNING with no answer yet, because the reader is still saving it. A job the service
        failed has no answer. A MESSAGE job also takes the message's error, with the record's error as the fallback.
        Raises JobNotFoundError when the job is missing or owned by someone else.
        """
        record, reader_alive = self._owned(owner, job_id)
        return self._view_of(record, reader_alive=reader_alive)

    def _owned(self, owner: JobOwner, job_id: str) -> tuple[JobRecord, bool]:
        """Load the owner's job and whether its reader is alive, read before the record.

        Postcondition: the record and the alive flag; raises JobNotFoundError when the job is missing or owned by
        someone else.
        """
        reader_alive = self._store.is_alive(job_id)
        record = self._store.get(job_id)
        if record is None:
            raise JobNotFoundError(job_id)
        if record.owner != owner:
            raise JobNotFoundError(job_id)
        return record, reader_alive

    def _view_of(self, record: JobRecord, *, reader_alive: bool) -> JobView:
        """Build the view of a record.

        Precondition: record is stored; reader_alive was read before it.
        Postcondition: see view.
        """
        stalled_before = self._now() - self._stalled_after
        return family_of(record.mode).view(
            record, reader_alive, self._store, self._results, stalled_before=stalled_before
        )

    def wait(self, owner: JobOwner, job_id: str, *, wait_seconds: int) -> JobView:
        """Wait for a job to finish or pause.

        Precondition: wait_seconds is between 0 and WAIT_MAX_SECONDS; the routes validate it.
        Postcondition: returns once the job is final or paused with a waiting form, the wait time is used up, or at
        once for wait_seconds of 0 or when max_waiters calls already wait in this process. Raises JobNotFoundError as
        view does.
        """
        view = self.view(owner, job_id)
        if wait_seconds <= 0:
            return view
        if not self._waiters.acquire(blocking=False):
            return view
        try:
            deadline = self._monotonic() + wait_seconds
            remaining = float(wait_seconds)
            while not _settled(view) and remaining > 0:
                self._sleep(min(POLL_INTERVAL_SECONDS, remaining))
                view = self.view(owner, job_id)
                remaining = deadline - self._monotonic()
        finally:
            self._waiters.release()
        return view

    def stop(self, owner: JobOwner, job_id: str) -> JobView:
        """Ask a job to stop.

        Postcondition: for a job that is not final, stop_requested is stored and the run is stopped now when its id
        is known, otherwise the reader sends the stop once the id arrives; a final job is left untouched and
        nothing is sent. Returns the fresh view. Raises JobNotFoundError when the job is missing or owned by
        someone else.
        """
        record, reader_alive = self._owned(owner, job_id)
        view = self._view_of(record, reader_alive=reader_alive)
        if view.status.is_final:
            return view
        self._store.request_stop(job_id)
        # Re-read so ids stored by the reader since the first read are not missed.
        stopping = replace(self._store.get(job_id) or record, stop_requested=True)
        self._stop(stopping)
        return self._view_of(stopping, reader_alive=reader_alive)


def _settled(view: JobView) -> bool:
    """Report whether waiting for the job is pointless.

    Postcondition: true when the view's status is final, or paused with a form waiting for input. A paused job
    without a form is being resumed, so it is not settled.
    """
    if view.status.is_final:
        return True
    return view.status is JobStatus.PAUSED and view.form is not None
