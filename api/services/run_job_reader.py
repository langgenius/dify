"""Read a run's SSE stream and record its progress as job state."""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final, Protocol, runtime_checkable

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from services.run_job_contracts import JobEnding, JobFailure, JobFamily, JobIds, JobRecord, JobStatus, RunJobStore

logger = logging.getLogger(__name__)

DATA_PREFIX: Final = "data:"
ID_FIELDS: Final = ("task_id", "workflow_run_id", "message_id", "conversation_id")
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
    payload: Mapping[str, Any]


_Handler = Callable[[_FrameContext], JobEnding | None]


def _run_finished(context: _FrameContext) -> JobEnding | None:
    """Map a workflow_finished frame to a final job status.

    Precondition: context.payload is a decoded workflow_finished frame.
    Postcondition: an ending for succeeded, partial-succeeded, failed or stopped runs; None for any other status.
    """
    data = context.payload.get("data")
    if not isinstance(data, Mapping):
        return None
    try:
        status = RUN_STATUS_TO_JOB_STATUS.get(WorkflowExecutionStatus(data.get("status")))
    except ValueError:
        return None
    if status is None:
        return None
    error = data.get("error")
    if status is not JobStatus.FAILED:
        return JobEnding(status=status)
    if not isinstance(error, str):
        return JobEnding(status=status)
    return JobEnding(status=status, error=error)


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
    """Fail the job with the error frame's message.

    Precondition: none.
    Postcondition: an ending of FAILED with the frame's message; the error stays unset when the frame has none.
    """
    message = context.payload.get("message")
    if not isinstance(message, str):
        return JobEnding(status=JobStatus.FAILED)
    return JobEnding(status=JobStatus.FAILED, error=message)


EVENT_HANDLERS: Final[Mapping[str, _Handler]] = {
    StreamEvent.WORKFLOW_FINISHED.value: _run_finished,
    StreamEvent.MESSAGE_END.value: _message_ended,
    StreamEvent.ERROR.value: _run_errored,
}


def decode_frame(frame: str) -> Mapping[str, Any] | None:
    """Decode the JSON object of an SSE data frame.

    Precondition: none.
    Postcondition: the decoded object, or None for pings, non-data frames and anything that is not a JSON object.
    """
    text = frame.strip()
    if not text.startswith(DATA_PREFIX):
        return None
    try:
        payload = json.loads(text.removeprefix(DATA_PREFIX))
    except ValueError:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _unstored_ids(payload: Mapping[str, Any], stored: set[str]) -> Mapping[str, str]:
    """Pick the run ids that this frame carries and that were not stored yet.

    Precondition: stored holds the id fields already written.
    Postcondition: the id fields and values to store; stored is not changed.
    """
    return {name: payload[name] for name in ID_FIELDS if name not in stored and isinstance(payload.get(name), str)}


def _ids_of(found: Mapping[str, str]) -> JobIds:
    """Name the given id fields as job ids.

    Precondition: found is not empty and its keys are in ID_FIELDS.
    Postcondition: exactly those ids are set.
    """
    return JobIds(
        task_id=found.get("task_id"),
        run_id=found.get("workflow_run_id"),
        message_id=found.get("message_id"),
        conversation_id=found.get("conversation_id"),
    )


def _consume(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, stored_ids: set[str]) -> None:
    """Apply one frame to the job.

    Precondition: the job exists.
    Postcondition: ids and status from the frame are stored;
    ids count as stored only after the store accepted them, so a failed save is retried by the next frame that
    carries them; a pending stop is sent once when the task id is first stored.
    """
    payload = decode_frame(frame)
    if payload is None:
        return
    task_id_known = "task_id" in stored_ids
    found = _unstored_ids(payload, stored_ids)
    if found:
        store.record_ids(job_id, _ids_of(found))
        stored_ids.update(found)
    record = store.get(job_id)
    if record is None:
        return
    if not task_id_known and record.task_id is not None:
        if record.stop_requested:
            stopper.stop(record)
    handler = EVENT_HANDLERS.get(str(payload.get("event")))
    if handler is None:
        return
    ending = handler(_FrameContext(record=record, payload=payload))
    if ending is not None:
        store.settle(job_id, ending)


def _consume_safely(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, stored_ids: set[str]) -> None:
    """Apply one frame, keeping a store or stopper failure from ending the read.

    Precondition: the job exists.
    Postcondition: see _consume; an error raised while applying the frame is logged and swallowed.
    """
    try:
        _consume(frame, job_id=job_id, store=store, stopper=stopper, stored_ids=stored_ids)
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
    stored_ids: set[str] = set()
    try:
        for frame in frames:
            _consume_safely(frame, job_id=job_id, store=store, stopper=stopper, stored_ids=stored_ids)
    except Exception:
        logger.exception("Run job %s stream failed", job_id)
    finally:
        stop.set()
        alive.join()
        close_frames(frames)
    _end_of_stream(job_id, store)
