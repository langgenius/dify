"""Read a run's SSE stream and record its progress as job state."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, fields, replace
from types import MappingProxyType
from typing import Final, Protocol, runtime_checkable

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from services.run_job_contracts import JobEnding, JobFailure, JobFamily, JobIds, JobRecord, JobStatus, RunJobStore
from services.run_job_frames import RunFrame, read_frame

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

    Precondition: none.
    Postcondition: None for graph jobs; STOPPED when a stop was requested, else SUCCEEDED.
    """
    if context.record.family is not JobFamily.MESSAGE:
        return None
    if context.record.stop_requested:
        return JobEnding(status=JobStatus.STOPPED)
    return JobEnding(status=JobStatus.SUCCEEDED)


def _run_errored(context: _FrameContext) -> JobEnding | None:
    """Precondition: context.frame is an error frame. Postcondition: an ending of FAILED with the frame's message."""
    return JobEnding(status=JobStatus.FAILED, error=context.frame.error)


EVENT_HANDLERS: Final[Mapping[StreamEvent, _Handler]] = {
    StreamEvent.WORKFLOW_FINISHED: _run_finished,
    StreamEvent.MESSAGE_END: _message_ended,
    StreamEvent.ERROR: _run_errored,
}


def _unstored_ids(ids: JobIds, stored: JobIds) -> dict[str, str]:
    """Pick the ids that this frame carries and that were not stored yet.

    Precondition: none.
    Postcondition: the JobIds fields to store, by name; neither argument is changed.
    """
    return {
        field.name: value
        for field in fields(JobIds)
        if getattr(stored, field.name) is None and (value := getattr(ids, field.name)) is not None
    }


def _consume(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, stored: JobIds) -> JobIds:
    """Apply one frame to the job.

    Precondition: the job exists; stored holds the ids already written.
    Postcondition: ids and status from the frame are stored, and the ids now stored are returned;
    ids count as stored only after the store accepted them, so a failed save is retried by the next frame that
    carries them; a pending stop is sent once when the task id is first stored.
    """
    read = read_frame(frame)
    if not isinstance(read, RunFrame):
        return stored
    found = _unstored_ids(read.ids, stored)
    if found:
        store.record_ids(job_id, JobIds(**found))
    task_id_known = stored.task_id is not None
    stored = replace(stored, **found)
    record = store.get(job_id)
    if record is None:
        return stored
    if not task_id_known and record.task_id is not None:
        if record.stop_requested:
            stopper.stop(record)
    handler = EVENT_HANDLERS.get(read.event)
    if handler is None:
        return stored
    ending = handler(_FrameContext(record=record, frame=read))
    if ending is not None:
        store.settle(job_id, ending)
    return stored


def _consume_safely(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, stored: JobIds) -> JobIds:
    """Apply one frame, keeping a store or stopper failure from ending the read.

    Precondition: the job exists.
    Postcondition: see _consume; an error raised while applying the frame is logged and swallowed, and the ids
    stored before the frame are returned.
    """
    try:
        return _consume(frame, job_id=job_id, store=store, stopper=stopper, stored=stored)
    except Exception:
        logger.exception("Run job %s frame handling failed", job_id)
        return stored


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
    frames is closed when it has a close method. While frames are read, whether or not they arrive, the alive key
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
    stored = JobIds()
    try:
        for frame in frames:
            stored = _consume_safely(frame, job_id=job_id, store=store, stopper=stopper, stored=stored)
    except Exception:
        logger.exception("Run job %s stream failed", job_id)
    finally:
        stop.set()
        alive.join()
        close_frames(frames)
    _end_of_stream(job_id, store)
