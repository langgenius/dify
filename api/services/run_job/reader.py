"""Read a run's SSE stream and record its progress as job state."""

from __future__ import annotations

import logging
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass, field, replace
from types import MappingProxyType
from typing import Final, Protocol

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from libs.stream import close_stream
from services.run_job.contracts import JobEnding, JobIds, JobRecord, JobStatus, RunJobStore
from services.run_job.frames import Misfit, RunFrame, read_frame

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


# Asks the run behind a record to stop. Precondition: record.task_id is set.
type JobStopper = Callable[[JobRecord], None]


class StreamEndings(Protocol):
    """A job family's rules for how its stream ends a job."""

    @property
    def ending_events(self) -> frozenset[StreamEvent]:
        """The events at_frame can end a job on; the reader skips the job record for any other frame."""
        ...

    def at_frame(self, record: JobRecord, frame: RunFrame) -> JobEnding | None:
        """Precondition: frame fits core's model. Postcondition: the job's ending, or None to leave it."""
        ...

    def at_stream_end(self, record: JobRecord) -> JobEnding | None:
        """Precondition: the stream ended or raised. Postcondition: the job's ending, or None to leave it."""
        ...


def run_finished_ending(frame: RunFrame) -> JobEnding | None:
    """Map a workflow_finished frame to a final job status.

    Postcondition: for a workflow_finished frame, an ending for succeeded, partial-succeeded, failed or stopped
    runs, with the error kept only for a failed run; None for any other frame or status.
    """
    if frame.run_status is None:
        return None
    status = RUN_STATUS_TO_JOB_STATUS.get(frame.run_status)
    if status is None:
        return None
    if status is not JobStatus.FAILED:
        return JobEnding(status=status)
    return JobEnding(status=status, error=frame.error)


def _unstored_ids(ids: JobIds, stored: JobIds) -> dict[str, str]:
    """Pick the ids that this frame carries and that were not stored yet.

    Postcondition: the JobIds fields to store, by name; neither argument is changed.
    """
    known = asdict(stored)
    return {name: value for name, value in asdict(ids).items() if value is not None and known[name] is None}


@dataclass(slots=True)
class _Reading:
    """What one reader has stored so far, the misfit events it has reported, and an ending it could not save."""

    stored: JobIds = field(default_factory=JobIds)
    reported: set[str | None] = field(default_factory=set)
    unsaved: JobEnding | None = None


def _report(job_id: str, misfit: Misfit, reading: _Reading) -> None:
    """Postcondition: the first misfit of each event name is logged as an error, without any frame value."""
    if misfit.event in reading.reported:
        return
    reading.reported.add(misfit.event)
    logger.error("Run job %s: a %s frame does not fit core's model at %s", job_id, misfit.event, misfit.fields)


def _consume(
    frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, endings: StreamEndings, reading: _Reading
) -> None:
    """Apply one frame to the job.

    Precondition: the job exists; reading.stored holds the ids already written.
    Postcondition: ids and ending from the frame are stored and reading.stored names them; the job record is read
    only when the frame carries an id not stored yet or one of the family's ending events; ids count as
    stored only after the store accepted them, so a failed save is retried by the next frame that carries them; an
    ending stays in reading.unsaved until the store accepted it, so a failed save is retried when the stream ends; a
    pending stop is sent once when the task id is first stored. A frame that does not fit core's model changes
    nothing and is reported.
    """
    read = read_frame(frame)
    if isinstance(read, Misfit):
        _report(job_id, read, reading)
        return
    if read is None:
        return
    found = _unstored_ids(read.ids, reading.stored)
    if not found:
        if read.event not in endings.ending_events:
            return
    if found:
        store.record_ids(job_id, JobIds(**found))
    task_id_known = reading.stored.task_id is not None
    reading.stored = replace(reading.stored, **found)
    record = store.get(job_id)
    if record is None:
        return
    if not task_id_known and record.task_id is not None:
        if record.stop_requested:
            stopper(record)
    ending = endings.at_frame(record, read)
    if ending is None:
        return
    reading.unsaved = ending
    store.settle(job_id, ending)
    reading.unsaved = None


def _end_of_stream(job_id: str, store: RunJobStore, endings: StreamEndings, unsaved: JobEnding | None) -> None:
    """Record how the reader ended, then let go of the alive key.

    Precondition: the stream ended or raised; unsaved is the ending read from the stream that the store refused.
    Postcondition: unsaved is saved first, so it is the job's ending unless the job had one; then the family's
    stream-end ending is settled when it gives one. The alive key is deleted last, so a viewer that finds it gone
    reads this reader's final writes.
    """
    if unsaved is not None:
        store.settle(job_id, unsaved)
    record = store.get(job_id)
    if record is None:
        return
    ending = endings.at_stream_end(record)
    if ending is not None:
        store.settle(job_id, ending)
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


def read_to_end(
    *,
    job_id: str,
    frames: Iterable[str],
    store: RunJobStore,
    stopper: JobStopper,
    endings: StreamEndings,
    alive_refresh_seconds: float = ALIVE_REFRESH_SECONDS,
) -> None:
    """Consume a run's SSE frames and record them as job state.

    Precondition: the job exists.
    Postcondition: every frame was consumed, ids are stored, an ending the store refused at its frame is saved, the
    ending rule of _end_of_stream was applied, and frames is closed when it has a close method. The first frame of
    each event name that does not fit core's model is logged as an error. While frames are read, whether or not they
    arrive, the alive key is refreshed every alive_refresh_seconds; the refresh stops and the key is deleted before it
    returns. A frame whose handling raises is logged and skipped; a stream that raises is logged and treated as ended.
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
            try:
                _consume(frame, job_id=job_id, store=store, stopper=stopper, endings=endings, reading=reading)
            except Exception:
                logger.exception("Run job %s frame handling failed", job_id)
    except Exception:
        logger.exception("Run job %s stream failed", job_id)
    finally:
        stop.set()
        alive.join()
        close_stream(frames)
    _end_of_stream(job_id, store, endings, reading.unsaved)
