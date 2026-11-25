import json

import pytest

from core.app.entities.task_entities import (
    MessageEndStreamResponse,
    StreamEvent,
)
from graphon.enums import WorkflowExecutionStatus
from services.run_job.contracts import JobIds
from services.run_job.frames import Misfit, RunFrame, read_frame
from tests.unit_tests.services.run_job.fakes import workflow_finished


def _sse(payload: object) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@pytest.mark.parametrize("frame", ["event: ping\n\n", "", "id: 7\n\n"], ids=["ping", "empty", "other line"])
def test_a_frame_without_data_is_nothing(frame: str) -> None:
    assert read_frame(frame) is None


def test_a_chat_frame_carries_the_ids_its_stream_adds() -> None:
    end = MessageEndStreamResponse(task_id="task-1", id="msg-1").model_dump(mode="json")

    frame = read_frame(_sse({**end, "conversation_id": "conv-1", "message_id": "msg-1", "created_at": 1}))

    assert frame == RunFrame(
        event=StreamEvent.MESSAGE_END,
        ids=JobIds(task_id="task-1", message_id="msg-1", conversation_id="conv-1"),
    )


def test_workflow_finished_carries_the_run_status_and_error() -> None:
    frame = read_frame(_sse(workflow_finished(WorkflowExecutionStatus.FAILED, "boom").model_dump(mode="json")))

    assert frame == RunFrame(
        event=StreamEvent.WORKFLOW_FINISHED,
        ids=JobIds(task_id="task-1", run_id="run-1"),
        run_status=WorkflowExecutionStatus.FAILED,
        error="boom",
    )


def test_an_error_frame_carries_its_message_and_ids() -> None:
    error = {"event": "error", "conversation_id": "conv-1", "message_id": "msg-1", "code": "x", "message": "bad"}

    assert read_frame(_sse(error)) == RunFrame(
        event=StreamEvent.ERROR, ids=JobIds(message_id="msg-1", conversation_id="conv-1"), error="bad"
    )


@pytest.mark.parametrize(
    ("frame", "event"),
    [
        ("data: not json\n\n", None),
        ("data: [1, 2]\n\n", None),
        (_sse({"task_id": "task-1"}), None),
        (_sse({"event": "from_the_future", "task_id": "task-1"}), "from_the_future"),
        (_sse({"event": "workflow_started", "workflow_run_id": "run-1"}), "workflow_started"),
        (_sse({"event": "workflow_finished", "task_id": "task-1", "workflow_run_id": "run-1"}), "workflow_finished"),
        (_sse({"event": "error", "code": "x"}), "error"),
    ],
    ids=["not json", "not an object", "no event", "unknown event", "no task id", "finish without data", "error text"],
)
def test_a_data_frame_that_does_not_fit_cores_model_is_a_misfit(frame: str, event: str | None) -> None:
    misfit = read_frame(frame)

    assert isinstance(misfit, Misfit)
    assert misfit.event == event


def test_a_misfit_names_the_fields_that_did_not_fit() -> None:
    assert read_frame(_sse({"event": "workflow_started", "workflow_run_id": "run-1"})) == Misfit(
        event="workflow_started", fields=("task_id",)
    )
    assert read_frame(_sse({"event": ["not", "a", "name"], "task_id": "t"})) == Misfit(event=None, fields=("event",))
