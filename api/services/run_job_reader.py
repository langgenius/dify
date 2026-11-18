"""Read a run's SSE stream and record its progress as job state."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass, field, replace
from types import MappingProxyType
from typing import Final, Protocol, runtime_checkable

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from services.run_job_contracts import JobEnding, JobFailure, JobFamily, JobIds, JobRecord, JobStatus, RunJobStore
from services.run_job_frames import Misfit, RunFrame, read_frame

logger = logging.getLogger(__name__)

# The alive key means "the reader thread is running". It is refreshed on a timer, not per frame: a graph run that
# waits in the worker queue sends no frame until it starts (only one ping when the stream opens).
ALIVE_REFRESH_SECONDS: Final = 10
ALIVE_THREAD_NAME: Final = "run-job-alive"

RUN_STATUS_TO_JOB_STATUS: Final[Mapping[WorkflowExecutionStatus, JobStatus]] = MappingProxyType(
    {
        WorkflowExecutionStatus.SUCCEEDED: JobStatus.SUCCEEDED,
        WorkflowExecutionStatus.PARTIAL_SUCCEEDED: JobStatus.SUCCEEDED,
        WorkflowExecutionStatus.FAILED: JobStatus.FAILED,
        WorkflowExecutionStatus.STOPPED: JobStatus.STOPPED,
    }
)


class JobStopper(Protocol):
    def stop(self, record: JobRecord) -> None:
        """Precondition: record.task_id is set. Postcondition: the run behind the record is asked to stop."""


@runtime_checkable
class _Closable(Protocol):
    def close(self) -> None: ...


@dataclass(frozen=True, slots=True, kw_only=True)
class _FrameContext:
    record: JobRecord
    frame: RunFrame


_Handler = Callable[[_FrameContext], JobEnding | None]


def _run_finished(context: _FrameContext) -> JobEnding | None:
    """Map a workflow_finished frame to a final job status.

    Precondition: context.frame is a workflow_finished frame.
    Postcondition: an ending for succeeded, partial-succeeded, failed or stopped runs; None for any other status.
    The error is kept only for a failed run.
    """
    run_status = context.frame.run_status
    if run_status is None:
        return None
    status = RUN_STATUS_TO_JOB_STATUS.get(run_status)
    if status is None:
        return None
    if status is not JobStatus.FAILED:
        return JobEnding(status=status)
    return JobEnding(status=status, error=context.frame.error)


def _message_ended(context: _FrameContext) -> JobEnding | None:
    """Finish a message job at the end of its answer.

    Precondition: context.record is a MESSAGE job.
    Postcondition: STOPPED when a stop was requested, else SUCCEEDED.
    """
    if context.record.stop_requested:
        return JobEnding(status=JobStatus.STOPPED)
    return JobEnding(status=JobStatus.SUCCEEDED)


def _run_errored(context: _FrameContext) -> JobEnding | None:
    """Precondition: context.frame is an error frame. Postcondition: an ending of FAILED with the frame's message."""
    return JobEnding(status=JobStatus.FAILED, error=context.frame.error)


# A graph job's stream always ends with workflow_finished or workflow_paused: core's worker follows an error with a
# failed workflow_finished that carries the same message, and it is the only outcome of a run that failed before
# it was stored. Chat streams have no workflow_finished.
ENDINGS_BY_FAMILY: Final[Mapping[JobFamily, Mapping[StreamEvent, _Handler]]] = {
    JobFamily.GRAPH: {StreamEvent.WORKFLOW_FINISHED: _run_finished},
    JobFamily.MESSAGE: {StreamEvent.MESSAGE_END: _message_ended, StreamEvent.ERROR: _run_errored},
}


def _unstored_ids(ids: JobIds, stored: JobIds) -> dict[str, str]:
    """Pick the ids that this frame carries and that were not stored yet.

    Precondition: none.
    Postcondition: the JobIds fields to store, by name; neither argument is changed.
    """
    known = asdict(stored)
    return {name: value for name, value in asdict(ids).items() if value is not None and known[name] is None}


@dataclass(slots=True)
class _Reading:
    """What one reader has stored so far, and the misfit events it has reported."""

    stored: JobIds = field(default_factory=JobIds)
    reported: set[str | None] = field(default_factory=set)


def _report(job_id: str, misfit: Misfit, reading: _Reading) -> None:
    """Postcondition: the first misfit of each event name is logged as an error, without any frame value."""
    if misfit.event in reading.reported:
        return
    reading.reported.add(misfit.event)
    logger.error("Run job %s: a %s frame does not fit core's model at %s", job_id, misfit.event, misfit.fields)


def _consume(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, reading: _Reading) -> None:
    """Apply one frame to the job.

    Precondition: the job exists; reading.stored holds the ids already written.
    Postcondition: ids and status from the frame are stored and reading.stored names them; ids count as stored only
    after the store accepted them, so a failed save is retried by the next frame that carries them; a pending stop
    is sent once when the task id is first stored. A frame that does not fit core's model changes nothing and is
    reported.
    """
    read = read_frame(frame)
    if isinstance(read, Misfit):
        _report(job_id, read, reading)
        return
    if read is None:
        return
    found = _unstored_ids(read.ids, reading.stored)
    if found:
        store.record_ids(job_id, JobIds(**found))
    task_id_known = reading.stored.task_id is not None
    reading.stored = replace(reading.stored, **found)
    record = store.get(job_id)
    if record is None:
        return
    if not task_id_known and record.task_id is not None:
        if record.stop_requested:
            stopper.stop(record)
    handler = ENDINGS_BY_FAMILY[record.family].get(read.event)
    if handler is None:
        return
    ending = handler(_FrameContext(record=record, frame=read))
    if ending is not None:
        store.settle(job_id, ending)


def _consume_safely(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, reading: _Reading) -> None:
    """Apply one frame, keeping a store or stopper failure from ending the read.

    Precondition: the job exists.
    Postcondition: see _consume; an error raised while applying the frame is logged and swallowed.
    """
    try:
        _consume(frame, job_id=job_id, store=store, stopper=stopper, reading=reading)
    except Exception:
        logger.exception("Run job %s frame handling failed", job_id)


def _end_of_stream(job_id: str, store: RunJobStore) -> None:
    """Record how the reader ended, then let go of the alive key.

    Precondition: the stream ended or raised.
    Postcondition: a MESSAGE job without an ending is FAILED for NO_RESULT; a GRAPH job without a run id is FAILED
    for RUN_NOT_CONFIRMED; a GRAPH job with a run id is left to its run. The alive key is deleted last, so a viewer
    that finds it gone reads this reader's final writes.
    """
    record = store.get(job_id)
    if record is None:
        return
    if record.family is JobFamily.MESSAGE:
        store.settle(job_id, JobEnding(status=JobStatus.FAILED, failure=JobFailure.NO_RESULT))
    elif record.run_id is None:
        store.settle(job_id, JobEnding(status=JobStatus.FAILED, failure=JobFailure.RUN_NOT_CONFIRMED))
    store.drop_alive(job_id)


def _keep_alive(*, job_id: str, store: RunJobStore, stop: threading.Event, interval: float) -> None:
    """Refresh the alive key now and then every interval until stop is set.

    Precondition: runs on its own thread while read_to_end runs.
    Postcondition: returns soon after stop is set; a failed refresh is logged and retried at the next tick.
    """
    _refresh_alive(job_id, store)
    while not stop.wait(interval):
        _refresh_alive(job_id, store)


def _refresh_alive(job_id: str, store: RunJobStore) -> None:
    """Postcondition: the alive key is refreshed, or the failure is logged."""
    try:
        store.touch(job_id)
    except Exception:
        logger.exception("Run job %s alive refresh failed", job_id)


def close_frames(frames: object) -> None:
    """Postcondition: frames (a stream of any kind) is closed when it has a close method; otherwise nothing happens."""
    if isinstance(frames, _Closable):
        frames.close()


def read_to_end(
    *,
    job_id: str,
    frames: Iterable[str],
    store: RunJobStore,
    stopper: JobStopper,
    alive_refresh_seconds: float = ALIVE_REFRESH_SECONDS,
) -> None:
    """Consume a run's SSE frames and record them as job state.

    Precondition: the job exists.
    Postcondition: every frame was consumed, ids are stored, the ending rule of _end_of_stream was applied, and
    frames is closed when it has a close method. The first frame of each event name that does not fit core's model
    is logged as an error. While frames are read, whether or not they arrive, the alive key
    is refreshed every alive_refresh_seconds; the refresh stops and the key is deleted before it returns. A frame
    whose handling raises is logged and skipped; a stream that raises is logged and treated as ended.
    """
    stop = threading.Event()
    alive = threading.Thread(
        target=_keep_alive,
        kwargs={"job_id": job_id, "store": store, "stop": stop, "interval": alive_refresh_seconds},
        name=ALIVE_THREAD_NAME,
        daemon=True,
    )
    alive.start()
    reading = _Reading()
    try:
        for frame in frames:
            _consume_safely(frame, job_id=job_id, store=store, stopper=stopper, reading=reading)
    except Exception:
        logger.exception("Run job %s stream failed", job_id)
    finally:
        stop.set()
        alive.join()
        close_frames(frames)
    _end_of_stream(job_id, store)
