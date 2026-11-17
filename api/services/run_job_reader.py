"""Read a run's SSE stream and record its progress as job state."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final, Protocol, runtime_checkable

from core.app.entities.task_entities import StreamEvent
from graphon.enums import WorkflowExecutionStatus
from services.run_job_contracts import JobFamily, JobPatch, JobRecord, JobStatus, RunJobStore

logger = logging.getLogger(__name__)

DATA_PREFIX: Final = "data:"
NO_RESULT_ERROR: Final = "run ended without a result"
ID_FIELDS: Final = ("task_id", "workflow_run_id", "message_id", "conversation_id")

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


_Handler = Callable[[_FrameContext], JobPatch | None]


def _run_finished(context: _FrameContext) -> JobPatch | None:
    """Map a workflow_finished frame to a final job status.

    Precondition: context.payload is a decoded workflow_finished frame.
    Postcondition: a patch for succeeded, partial-succeeded, failed or stopped runs; None for any other status.
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
        return JobPatch(status=status)
    if not isinstance(error, str):
        return JobPatch(status=status)
    return JobPatch(status=status, error=error)


def _run_paused(context: _FrameContext) -> JobPatch | None:
    """Mark the job paused.

    Precondition: none.
    Postcondition: a patch setting PAUSED.
    """
    return JobPatch(status=JobStatus.PAUSED)


def _form_required(context: _FrameContext) -> JobPatch | None:
    """Keep the human input form of a paused run.

    Precondition: context.payload is a decoded human_input_required frame.
    Postcondition: a patch holding the frame's data as the form, or None when it has no data object.
    """
    data = context.payload.get("data")
    if not isinstance(data, Mapping):
        return None
    return JobPatch(form=data)


def _message_ended(context: _FrameContext) -> JobPatch | None:
    """Finish a message job at the end of its answer.

    Precondition: none.
    Postcondition: None for graph jobs; STOPPED when a stop was requested, else SUCCEEDED.
    """
    if context.record.family is not JobFamily.MESSAGE:
        return None
    if context.record.stop_requested:
        return JobPatch(status=JobStatus.STOPPED)
    return JobPatch(status=JobStatus.SUCCEEDED)


def _run_errored(context: _FrameContext) -> JobPatch | None:
    """Fail the job with the error frame's message.

    Precondition: none.
    Postcondition: a patch setting FAILED with the frame's message; the error stays unset when the frame has none.
    """
    message = context.payload.get("message")
    if not isinstance(message, str):
        return JobPatch(status=JobStatus.FAILED)
    return JobPatch(status=JobStatus.FAILED, error=message)


EVENT_HANDLERS: Final[Mapping[str, _Handler]] = {
    StreamEvent.HUMAN_INPUT_REQUIRED.value: _form_required,
    StreamEvent.WORKFLOW_PAUSED.value: _run_paused,
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


def _ids_patch(found: Mapping[str, str]) -> JobPatch:
    """Build the patch that stores the given id fields.

    Precondition: found is not empty and its keys are in ID_FIELDS.
    Postcondition: a patch setting exactly those ids.
    """
    return JobPatch(
        task_id=found.get("task_id"),
        run_id=found.get("workflow_run_id"),
        message_id=found.get("message_id"),
        conversation_id=found.get("conversation_id"),
    )


def _consume(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, stored_ids: set[str]) -> None:
    """Apply one frame to the job.

    Precondition: the job exists.
    Postcondition: the alive key is refreshed; ids, form and status from the frame are stored;
    ids count as stored only after the store accepted them, so a failed save is retried by the next frame that
    carries them; a pending stop is sent once when the task id is first stored.
    """
    store.touch(job_id)
    payload = decode_frame(frame)
    if payload is None:
        return
    task_id_known = "task_id" in stored_ids
    found = _unstored_ids(payload, stored_ids)
    if found:
        store.patch(job_id, _ids_patch(found))
        stored_ids.update(found)
    record = store.get(job_id)
    if record is None:
        return
    if not task_id_known and record.task_id is not None:
        if record.stop_requested:
            stopper.stop(record)
    if record.status.is_final:
        return
    handler = EVENT_HANDLERS.get(str(payload.get("event")))
    if handler is None:
        return
    patch = handler(_FrameContext(record=record, payload=payload))
    if patch is not None:
        store.patch(job_id, patch)


def _consume_safely(frame: str, *, job_id: str, store: RunJobStore, stopper: JobStopper, stored_ids: set[str]) -> None:
    """Apply one frame, keeping a store or stopper failure from ending the read.

    Precondition: the job exists.
    Postcondition: see _consume; an error raised while applying the frame is logged and swallowed.
    """
    try:
        _consume(frame, job_id=job_id, store=store, stopper=stopper, stored_ids=stored_ids)
    except Exception:
        logger.exception("Run job %s frame handling failed", job_id)


def _settle(job_id: str, store: RunJobStore) -> None:
    """Apply the end-of-stream rule.

    Precondition: the stream ended or raised.
    Postcondition: a MESSAGE job without a final status is FAILED with NO_RESULT_ERROR; other jobs are unchanged.
    """
    record = store.get(job_id)
    if record is None:
        return
    if record.status.is_final:
        return
    if record.family is not JobFamily.MESSAGE:
        return
    store.patch(job_id, JobPatch(status=JobStatus.FAILED, error=NO_RESULT_ERROR))


def read_to_end(*, job_id: str, frames: Iterable[str], store: RunJobStore, stopper: JobStopper) -> None:
    """Consume a run's SSE frames and record them as job state.

    Precondition: the job exists.
    Postcondition: every frame was consumed, ids and form details are stored, the alive key was refreshed on each
    frame, a MESSAGE job has a final status, and frames is closed when it has a close method. A frame whose
    handling raises is logged and skipped; a stream that raises is logged and treated as ended.
    """
    stored_ids: set[str] = set()
    try:
        for frame in frames:
            _consume_safely(frame, job_id=job_id, store=store, stopper=stopper, stored_ids=stored_ids)
    except Exception:
        logger.exception("Run job %s stream failed", job_id)
    finally:
        if isinstance(frames, _Closable):
            frames.close()
    _settle(job_id, store)
