"""Core's run stream, built by core's own code, as the job reader reads it.

No frame here is written by hand. Each one comes from core's response objects through the app's response converter
on the OPENAPI surface and BaseAppGenerator.convert_to_event_stream; a graph app's frames also pass through the
worker's publish to the run's topic and the API's topic reader, as they do in production. A change in core's wire
format fails this test in the core change that makes it.
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable, Generator, Iterable, Iterator, Mapping
from typing import override

import pytest

from configs import dify_config
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.agent_chat.generate_response_converter import AgentChatAppGenerateResponseConverter
from core.app.apps.base_app_generate_response_converter import AppGenerateResponseConverter
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.chat.generate_response_converter import ChatAppGenerateResponseConverter
from core.app.apps.completion.generate_response_converter import CompletionAppGenerateResponseConverter
from core.app.apps.streaming_utils import stream_topic_events
from core.app.apps.workflow.generate_response_converter import WorkflowAppGenerateResponseConverter
from core.app.entities.app_invoke_entities import InvokeFrom
from core.app.entities.task_entities import (
    AppBlockingResponse,
    AppStreamResponse,
    ChatbotAppStreamResponse,
    CompletionAppStreamResponse,
    ErrorStreamResponse,
    HumanInputRequiredResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    PingStreamResponse,
    StreamResponse,
    WorkflowAppStreamResponse,
    WorkflowPauseStreamResponse,
    WorkflowStartStreamResponse,
)
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowExecutionStatus
from libs.broadcast_channel.channel import Subscription
from models.enums import CreatorUserRole
from models.model import AppMode
from repositories.run_job_store import RedisRunJobStore
from services.run_job.contracts import JobIds, JobOwner, JobRecord, JobStatus
from services.run_job.frames import pending_form
from services.run_job.reader import read_to_end
from services.run_job.service import family_of
from tasks.app_generate import workflow_execute_task
from tests.unit_tests.services.run_job.fakes import InMemoryRedis, RecordingJobStopper, workflow_finished

JOB_ID = "job-1"
SAMPLE_OP = "run.sample"
TASK_ID = "task-1"
RUN_ID = "run-1"
MESSAGE_ID = "msg-1"
CONVERSATION_ID = "conv-1"
WORKFLOW_ID = "wf-1"
OWNER = JobOwner(tenant_id="t1", app_id="app-1", caller_role=CreatorUserRole.ACCOUNT, caller_id="acct-1")


class _RecordedTopic:
    """The run's topic: the worker publishes to it."""

    def __init__(self) -> None:
        self.published: list[bytes] = []

    def publish(self, payload: bytes) -> None:
        self.published.append(payload)


class _Replay(Subscription):
    """The API's subscription to the run's topic, replaying what the worker published."""

    def __init__(self, payloads: Iterable[bytes]) -> None:
        self._payloads = deque(payloads)

    @override
    def __iter__(self) -> Iterator[bytes]:
        return iter(self._payloads)

    @override
    def close(self) -> None:
        self._payloads.clear()

    @override
    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        return self._payloads.popleft() if self._payloads else None


def _converted[R: AppBlockingResponse](
    converter: type[AppGenerateResponseConverter[R]], responses: list[AppStreamResponse]
) -> Generator[str | Mapping[str, object]]:
    """Convert as the OPENAPI surface does, and prove it takes the converter's full-response branch."""
    converted = converter.convert((response for response in responses), InvokeFrom.OPENAPI)
    assert isinstance(converted, Generator)
    frames = list(converted)
    assert frames == list(converter.convert_stream_full_response(response for response in responses))
    return (frame for frame in frames)


def _graph_events[R: AppBlockingResponse](
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    converter: type[AppGenerateResponseConverter[R]],
    responses: list[AppStreamResponse],
) -> list[Mapping[str, object] | str]:
    """The events the API reads from a graph run's topic: the worker publishes them, the topic reader yields them."""
    topic = _RecordedTopic()
    monkeypatch.setattr(
        workflow_execute_task.MessageBasedAppGenerator, "get_response_topic", lambda *_args, **_kwargs: topic
    )
    workflow_execute_task._publish_streaming_response(
        _converted(converter, responses), RUN_ID, mode, WORKFLOW_ID, {}, WorkflowStartReason.INITIAL
    )
    return list(stream_topic_events(subscription=_Replay(topic.published), idle_timeout=0))


def _graph_frames[R: AppBlockingResponse](
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    converter: type[AppGenerateResponseConverter[R]],
    responses: list[AppStreamResponse],
) -> list[str]:
    """The frames a graph job's reader gets: the topic's events through convert_to_event_stream."""
    events = _graph_events(monkeypatch, mode, converter, responses)
    return list(BaseAppGenerator.convert_to_event_stream(event for event in events))


def _read(mode: AppMode, frames: list[str], caplog: pytest.LogCaptureFixture) -> JobRecord:
    store = RedisRunJobStore(redis_client=InMemoryRedis(), job_ttl_seconds=dify_config.RUN_JOB_TTL_SECONDS)
    store.create(JobRecord(id=JOB_ID, owner=OWNER, mode=mode, op=SAMPLE_OP))
    with caplog.at_level(logging.ERROR, logger="services.run_job.reader"):
        read_to_end(job_id=JOB_ID, frames=frames, store=store, stopper=RecordingJobStopper(), endings=family_of(mode))
    assert "does not fit" not in caplog.text
    record = store.get(JOB_ID)
    assert record is not None
    return record


def _ids(record: JobRecord) -> JobIds:
    return JobIds(
        task_id=record.task_id,
        run_id=record.run_id,
        message_id=record.message_id,
        conversation_id=record.conversation_id,
    )


def _started() -> WorkflowStartStreamResponse:
    return WorkflowStartStreamResponse(
        task_id=TASK_ID,
        workflow_run_id=RUN_ID,
        data=WorkflowStartStreamResponse.Data(id=RUN_ID, workflow_id=WORKFLOW_ID, inputs={}, created_at=1),
    )


def _paused() -> WorkflowPauseStreamResponse:
    return WorkflowPauseStreamResponse(
        task_id=TASK_ID,
        workflow_run_id=RUN_ID,
        data=WorkflowPauseStreamResponse.Data(
            workflow_run_id=RUN_ID,
            status=WorkflowExecutionStatus.PAUSED,
            created_at=1,
            elapsed_time=0.1,
            total_tokens=0,
            total_steps=1,
        ),
    )


def _workflow_stream(*responses: StreamResponse) -> list[AppStreamResponse]:
    """Wrap as the workflow pipeline does: the run id is known from workflow_started on."""
    wrapped: list[AppStreamResponse] = []
    run_id: str | None = None
    for response in responses:
        if isinstance(response, WorkflowStartStreamResponse):
            run_id = response.workflow_run_id
        wrapped.append(WorkflowAppStreamResponse(workflow_run_id=run_id, stream_response=response))
    return wrapped


def _chat_stream(*responses: StreamResponse) -> list[AppStreamResponse]:
    return [
        ChatbotAppStreamResponse(
            conversation_id=CONVERSATION_ID, message_id=MESSAGE_ID, created_at=1, stream_response=response
        )
        for response in responses
    ]


@pytest.mark.parametrize(
    ("status", "error", "expected"),
    [
        (WorkflowExecutionStatus.SUCCEEDED, None, JobStatus.SUCCEEDED),
        (WorkflowExecutionStatus.FAILED, "boom", JobStatus.FAILED),
        (WorkflowExecutionStatus.STOPPED, None, JobStatus.STOPPED),
    ],
)
def test_a_workflow_job_takes_its_ids_and_ending_from_cores_stream(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    status: WorkflowExecutionStatus,
    error: str | None,
    expected: JobStatus,
) -> None:
    stream = _workflow_stream(PingStreamResponse(task_id=TASK_ID), _started(), workflow_finished(status, error))
    frames = _graph_frames(monkeypatch, AppMode.WORKFLOW, WorkflowAppGenerateResponseConverter, stream)

    record = _read(AppMode.WORKFLOW, frames, caplog)

    assert _ids(record) == JobIds(task_id=TASK_ID, run_id=RUN_ID)
    assert (record.status, record.error) == (expected, error)


def _form() -> HumanInputRequiredResponse:
    return HumanInputRequiredResponse.model_validate(
        {
            "task_id": TASK_ID,
            "workflow_run_id": RUN_ID,
            "data": {
                "form_id": "f1",
                "node_id": "n1",
                "node_title": "Review",
                "form_content": "Approve?",
                "inputs": [{"type": "paragraph", "output_variable_name": "comment"}],
                "actions": [{"id": "approve", "title": "Approve"}],
                "form_token": "ft-1",
                "expiration_time": 4102444800,
            },
        }
    )


type Events = list[Mapping[str, object] | str]


def _paused_workflow(monkeypatch: pytest.MonkeyPatch) -> Events:
    stream = _workflow_stream(_started(), _form(), _paused())
    return _graph_events(monkeypatch, AppMode.WORKFLOW, WorkflowAppGenerateResponseConverter, stream)


def _paused_chatflow(monkeypatch: pytest.MonkeyPatch) -> Events:
    stream = _chat_stream(_started(), _form(), _paused())
    return _graph_events(monkeypatch, AppMode.ADVANCED_CHAT, AdvancedChatAppGenerateResponseConverter, stream)


@pytest.mark.parametrize(
    ("mode", "events_of"),
    [(AppMode.WORKFLOW, _paused_workflow), (AppMode.ADVANCED_CHAT, _paused_chatflow)],
    ids=["workflow", "chatflow"],
)
def test_a_paused_graph_job_keeps_its_ids_stays_running_and_its_form_parses(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    mode: AppMode,
    events_of: Callable[[pytest.MonkeyPatch], Events],
) -> None:
    events = events_of(monkeypatch)

    record = _read(mode, list(BaseAppGenerator.convert_to_event_stream(event for event in events)), caplog)

    assert (record.task_id, record.run_id) == (TASK_ID, RUN_ID)
    assert record.status is JobStatus.RUNNING
    with caplog.at_level(logging.ERROR, logger="services.run_job.frames"):
        assert pending_form(events) == _form()
    assert "does not fit" not in caplog.text


def test_a_workflow_that_fails_before_it_starts_fails_the_job_with_its_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """No run is stored: the worker's failed workflow_finished is the job's only outcome."""
    stream = _workflow_stream(ErrorStreamResponse(task_id=TASK_ID, err=ValueError("bad input")))
    frames = _graph_frames(monkeypatch, AppMode.WORKFLOW, WorkflowAppGenerateResponseConverter, stream)

    record = _read(AppMode.WORKFLOW, frames, caplog)

    assert record.run_id == RUN_ID
    assert (record.status, record.error, record.failure) == (JobStatus.FAILED, "bad input", None)


def test_a_chatflow_job_takes_its_ids_and_ending_from_cores_stream(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    stream = _chat_stream(
        _started(),
        MessageStreamResponse(task_id=TASK_ID, id=MESSAGE_ID, answer="hi"),
        MessageEndStreamResponse(task_id=TASK_ID, id=MESSAGE_ID),
        workflow_finished(WorkflowExecutionStatus.SUCCEEDED),
    )
    frames = _graph_frames(monkeypatch, AppMode.ADVANCED_CHAT, AdvancedChatAppGenerateResponseConverter, stream)

    record = _read(AppMode.ADVANCED_CHAT, frames, caplog)

    assert _ids(record) == JobIds(
        task_id=TASK_ID, run_id=RUN_ID, message_id=MESSAGE_ID, conversation_id=CONVERSATION_ID
    )
    assert record.status is JobStatus.SUCCEEDED


def test_a_chatflow_answered_without_a_workflow_run_succeeds(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """An annotation reply or input moderation: the stream is the answer and message_end, with no run.

    Core's worker completes such a stream without inventing a workflow run, and the job ends with its message.
    """
    stream = _chat_stream(
        MessageStreamResponse(task_id=TASK_ID, id=MESSAGE_ID, answer="a preset answer"),
        MessageEndStreamResponse(task_id=TASK_ID, id=MESSAGE_ID),
    )
    frames = _graph_frames(monkeypatch, AppMode.ADVANCED_CHAT, AdvancedChatAppGenerateResponseConverter, stream)

    record = _read(AppMode.ADVANCED_CHAT, frames, caplog)

    assert _ids(record) == JobIds(task_id=TASK_ID, message_id=MESSAGE_ID, conversation_id=CONVERSATION_ID)
    assert (record.status, record.failure) == (JobStatus.SUCCEEDED, None)


def _message_frames[R: AppBlockingResponse](
    converter: type[AppGenerateResponseConverter[R]], responses: list[AppStreamResponse]
) -> list[str]:
    """The frames a message job's reader gets: the app's converter, then convert_to_event_stream."""
    return list(BaseAppGenerator.convert_to_event_stream(_converted(converter, responses)))


def _chat_frames(responses: list[StreamResponse]) -> list[str]:
    return _message_frames(ChatAppGenerateResponseConverter, _chat_stream(*responses))


def _agent_chat_frames(responses: list[StreamResponse]) -> list[str]:
    return _message_frames(AgentChatAppGenerateResponseConverter, _chat_stream(*responses))


def _completion_frames(responses: list[StreamResponse]) -> list[str]:
    stream: list[AppStreamResponse] = [
        CompletionAppStreamResponse(message_id=MESSAGE_ID, created_at=1, stream_response=response)
        for response in responses
    ]
    return _message_frames(CompletionAppGenerateResponseConverter, stream)


MESSAGE_CASES = [
    (AppMode.CHAT, _chat_frames, CONVERSATION_ID),
    (AppMode.AGENT_CHAT, _agent_chat_frames, CONVERSATION_ID),
    (AppMode.COMPLETION, _completion_frames, None),
]


@pytest.mark.parametrize(
    ("mode", "frames_of", "conversation_id"), MESSAGE_CASES, ids=["chat", "agent-chat", "completion"]
)
def test_a_message_job_takes_its_ids_and_ending_from_cores_stream(
    caplog: pytest.LogCaptureFixture,
    mode: AppMode,
    frames_of: Callable[[list[StreamResponse]], list[str]],
    conversation_id: str | None,
) -> None:
    frames = frames_of(
        [
            MessageStreamResponse(task_id=TASK_ID, id=MESSAGE_ID, answer="hi"),
            MessageEndStreamResponse(task_id=TASK_ID, id=MESSAGE_ID),
        ]
    )

    record = _read(mode, frames, caplog)

    assert _ids(record) == JobIds(task_id=TASK_ID, message_id=MESSAGE_ID, conversation_id=conversation_id)
    assert record.status is JobStatus.SUCCEEDED


@pytest.mark.parametrize(
    ("mode", "frames_of", "conversation_id"), MESSAGE_CASES, ids=["chat", "agent-chat", "completion"]
)
def test_a_message_job_fails_with_the_error_cores_stream_reports(
    caplog: pytest.LogCaptureFixture,
    mode: AppMode,
    frames_of: Callable[[list[StreamResponse]], list[str]],
    conversation_id: str | None,
) -> None:
    """Core builds the error frame by hand from the exception: only this test guards its message key."""
    frames = frames_of(
        [
            MessageStreamResponse(task_id=TASK_ID, id=MESSAGE_ID, answer="hi"),
            ErrorStreamResponse(task_id=TASK_ID, err=ValueError("bad input")),
        ]
    )

    record = _read(mode, frames, caplog)

    assert _ids(record) == JobIds(task_id=TASK_ID, message_id=MESSAGE_ID, conversation_id=conversation_id)
    assert (record.status, record.error) == (JobStatus.FAILED, "bad input")
