import json
from collections.abc import Mapping

import pytest

from core.app.entities.task_entities import (
    MessageEndStreamResponse,
    StreamEvent,
    WorkflowFinishStreamResponse,
    WorkflowStartStreamResponse,
)
from graphon.enums import WorkflowExecutionStatus
from services.run_job_contracts import JobIds
from services.run_job_frames import Misfit, RunFrame, read_frame


def _sse(payload: object) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _started() -> Mapping[str, object]:
    return WorkflowStartStreamResponse(
        task_id="task-1",
        workflow_run_id="run-1",
        data=WorkflowStartStreamResponse.Data(id="run-1", workflow_id="wf-1", inputs={}, created_at=1),
    ).model_dump(mode="json")


def _finished(status: WorkflowExecutionStatus, error: str | None) -> Mapping[str, object]:
    return WorkflowFinishStreamResponse(
        task_id="task-1",
        workflow_run_id="run-1",
        data=WorkflowFinishStreamResponse.Data(
            id="run-1",
            workflow_id="wf-1",
            status=status,
            error=error,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=1,
            created_at=1,
            finished_at=2,
        ),
    ).model_dump(mode="json")


@pytest.mark.parametrize("frame", ["event: ping\n\n", "", "id: 7\n\n"], ids=["ping", "empty", "other line"])
def test_a_frame_without_data_is_nothing(frame: str) -> None:
    assert read_frame(frame) is None


def test_a_frame_names_the_ids_it_carries() -> None:
    assert read_frame(_sse(_started())) == RunFrame(
        event=StreamEvent.WORKFLOW_STARTED, ids=JobIds(task_id="task-1", run_id="run-1")
    )


def test_a_chat_frame_carries_the_ids_its_stream_adds() -> None:
    end = MessageEndStreamResponse(task_id="task-1", id="msg-1").model_dump(mode="json")

    frame = read_frame(_sse({**end, "conversation_id": "conv-1", "message_id": "msg-1", "created_at": 1}))

    assert frame == RunFrame(
        event=StreamEvent.MESSAGE_END,
        ids=JobIds(task_id="task-1", message_id="msg-1", conversation_id="conv-1"),
    )


def test_workflow_finished_carries_the_run_status_and_error() -> None:
    frame = read_frame(_sse(_finished(WorkflowExecutionStatus.FAILED, "boom")))

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
    assert read_frame(frame) == Misfit(event=event)
