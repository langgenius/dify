"""Core's run stream as typed values: the only code that knows its wire format.

A frame is one chunk of `BaseAppGenerator.convert_to_event_stream`: `data: <json>` for an event, `event: ping` for a
ping. The JSON is the event's `StreamResponse`, flattened together with the ids that the app's stream wrapper adds
(`ChatbotAppStreamResponse`, `CompletionAppStreamResponse`, `WorkflowAppStreamResponse`); the app's response
converter writes those ids by hand, as it builds the error event by hand from the exception. Core exports no name for
the framing or for the flattened ids, so only the contract test guards them.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

from pydantic import BaseModel, ValidationError

from core.app.entities.task_entities import (
    HumanInputRequiredResponse,
    StreamEvent,
    StreamResponse,
    WorkflowFinishStreamResponse,
)
from graphon.enums import WorkflowExecutionStatus
from libs.stream import DATA_PREFIX, decode_data_frame
from services.run_job.contracts import JobIds

logger = logging.getLogger(__name__)

_EVENT_KEY: Final = "event"
_PAUSE_OR_FINISH: Final = frozenset({StreamEvent.WORKFLOW_PAUSED, StreamEvent.WORKFLOW_FINISHED})


@dataclass(frozen=True, slots=True, kw_only=True)
class RunFrame:
    """What one frame says: the ids it carries, a finished run's status and error, or an error event's message."""

    event: StreamEvent
    ids: JobIds
    run_status: WorkflowExecutionStatus | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class Misfit:
    """A data frame that does not fit core's model: its event name, if it has one, and the fields that did not fit.

    It holds no values, so it can be logged without copying run content into the logs.
    """

    event: str | None
    fields: tuple[str, ...] = ()


class _StreamIds(BaseModel):
    """The ids the app's stream wrapper adds to every event."""

    workflow_run_id: str | None = None
    message_id: str | None = None
    conversation_id: str | None = None


class _Frame(StreamResponse, _StreamIds):
    """Any event but an error: core's StreamResponse with the wrapper's ids."""


class _ErrorFrame(_StreamIds):
    """The error event; core has no model for it, so these names are guarded only by the contract test."""

    event: Literal[StreamEvent.ERROR]
    message: str


def read_frame(frame: str) -> RunFrame | Misfit | None:
    """Read one frame of a run's stream.

    Postcondition: None for a frame without data (a ping); the frame's values when it fits core's model; otherwise
    a Misfit naming its event. Nothing is guessed from a frame that does not fit.
    """
    payload = decode_data_frame(frame)
    if payload is None:
        if frame.startswith(DATA_PREFIX):
            return Misfit(event=None)
        return None
    try:
        return _typed(payload)
    except ValidationError as error:
        return Misfit(event=_event_name(payload), fields=_failed_fields(error))


def _event_name(payload: Mapping[str, Any]) -> str | None:
    name = payload.get(_EVENT_KEY)
    return name if isinstance(name, str) else None


def _failed_fields(error: ValidationError) -> tuple[str, ...]:
    """Postcondition: the dotted location of each field that failed, without its value."""
    return tuple(".".join(str(part) for part in detail["loc"]) for detail in error.errors())


def _typed(payload: Mapping[str, Any]) -> RunFrame:
    """Precondition: payload is a decoded data frame. Postcondition: its values; ValidationError when it misfits."""
    if payload.get(_EVENT_KEY) == StreamEvent.ERROR:
        error = _ErrorFrame.model_validate(payload)
        return RunFrame(event=error.event, ids=_ids(error, task_id=None), error=error.message)
    frame = _Frame.model_validate(payload)
    ids = _ids(frame, task_id=frame.task_id)
    if frame.event is not StreamEvent.WORKFLOW_FINISHED:
        return RunFrame(event=frame.event, ids=ids)
    finished = WorkflowFinishStreamResponse.model_validate(payload).data
    return RunFrame(event=frame.event, ids=ids, run_status=finished.status, error=finished.error)


def _ids(frame: _StreamIds, *, task_id: str | None) -> JobIds:
    return JobIds(
        task_id=task_id,
        run_id=frame.workflow_run_id,
        message_id=frame.message_id,
        conversation_id=frame.conversation_id,
    )


def pending_form(events: Iterable[Mapping[str, Any] | str]) -> HumanInputRequiredResponse | None:
    """Read a paused run's replayed events up to its first pause or finish.

    Precondition: events are the event mappings of a run's snapshot stream; its pings are strings.
    Postcondition: the last human_input_required event read, as core's model; None when there is none or the last
    one does not fit. Events after the first workflow_paused or workflow_finished are not read.
    """
    form: HumanInputRequiredResponse | None = None
    for event in events:
        if isinstance(event, Mapping):
            name = event.get(_EVENT_KEY)
            if name in _PAUSE_OR_FINISH:
                return form
            if name == StreamEvent.HUMAN_INPUT_REQUIRED:
                form = _human_input(event)
    return form


def _human_input(event: Mapping[str, Any]) -> HumanInputRequiredResponse | None:
    """Postcondition: the event as core's HumanInputRequiredResponse; None, logged as an error, when it does not fit."""
    try:
        return HumanInputRequiredResponse.model_validate(event)
    except ValidationError as error:
        misfit = Misfit(event=StreamEvent.HUMAN_INPUT_REQUIRED, fields=_failed_fields(error))
    # Logged outside the handler: a traceback would carry pydantic's message, which quotes the form's values.
    logger.error("A %s event does not fit core's model at %s", misfit.event, misfit.fields)
    return None
