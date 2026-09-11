"""Advanced chat response consumers release invocation-owned trace recording bytes."""

from datetime import UTC, datetime
from unittest.mock import Mock
from uuid import uuid4

import pytest

from core.app.apps.advanced_chat.generate_task_pipeline import AdvancedChatAppGenerateTaskPipeline
from core.app.apps.base_app_queue_manager import AppQueueManager
from core.app.entities.queue_entities import QueueWorkflowPausedEvent, WorkflowQueueMessage
from core.app.entities.task_entities import MessageEndStreamResponse, WorkflowPauseStreamResponse
from core.ops.message_trace import MessageTraceRecorder
from core.ops.trace_data import CompletedTrace
from graphon.enums import WorkflowExecutionStatus
from models.model import AppMode
from tests.unit_tests.core.app.apps.advanced_chat.test_generate_task_pipeline_core import _make_pipeline
from tests.unit_tests.core.ops.test_message_trace import RecordingQueue, make_recorder, message_fields


@pytest.fixture
def pending_moderation() -> tuple[AdvancedChatAppGenerateTaskPipeline, MessageTraceRecorder, RecordingQueue]:
    pipeline: AdvancedChatAppGenerateTaskPipeline = _make_pipeline()
    recorder, queue = make_recorder()
    user_id = str(uuid4())
    recorder.source = recorder.source.model_copy(update={"actor_id": user_id})
    assert recorder.source.app_id is not None
    assert recorder.source.message_id is not None
    assert recorder.source.conversation_id is not None
    pipeline._application_generate_entity.app_config.tenant_id = recorder.source.tenant_id
    pipeline._application_generate_entity.app_config.app_id = recorder.source.app_id
    pipeline._application_generate_entity.user_id = user_id
    pipeline._user_id = user_id
    pipeline._application_generate_entity.trace_recorder = recorder
    pipeline._workflow_tenant_id = recorder.source.tenant_id
    pipeline._message_id = recorder.source.message_id
    pipeline._conversation_id = recorder.source.conversation_id
    pipeline._base_task_pipeline.queue_manager = Mock(spec=AppQueueManager)
    pipeline._base_task_pipeline.queue_manager.listen = Mock(return_value=iter(()))
    now = datetime.now(UTC)
    recorder.record_operation(
        "moderation",
        span_type="moderation",
        inputs={"query": "original question"},
        outputs={"passed": True},
        timer={"start": now, "end": now},
    )
    assert queue.reserved > 0
    return pipeline, recorder, queue


@pytest.mark.parametrize("consumer", ["exhaustion", "stream_cancel", "blocking_pause"])
def test_pause_submits_pending_operations_once_without_completing_the_message(
    pending_moderation: tuple[AdvancedChatAppGenerateTaskPipeline, MessageTraceRecorder, RecordingQueue],
    monkeypatch: pytest.MonkeyPatch,
    consumer: str,
) -> None:
    pipeline, recorder, queue = pending_moderation
    task_id = pipeline._application_generate_entity.task_id
    pause_event = QueueWorkflowPausedEvent(paused_nodes=["human-input"])
    pipeline._base_task_pipeline.queue_manager.listen = Mock(
        return_value=iter([WorkflowQueueMessage(task_id=task_id, app_mode=AppMode.ADVANCED_CHAT, event=pause_event)])
    )
    pause_response = WorkflowPauseStreamResponse(
        task_id=task_id,
        workflow_run_id="workflow-run",
        data=WorkflowPauseStreamResponse.Data(
            workflow_run_id="workflow-run",
            paused_nodes=["human-input"],
            status=WorkflowExecutionStatus.PAUSED,
            created_at=0,
            elapsed_time=1,
            total_tokens=0,
            total_steps=1,
        ),
    )
    monkeypatch.setattr(pipeline, "_handle_workflow_paused_event", Mock(return_value=iter([pause_response])))
    monkeypatch.setattr(
        pipeline,
        "_message_end_to_stream_response",
        Mock(return_value=MessageEndStreamResponse(task_id=task_id, id=pipeline._message_id, metadata={})),
    )
    wrapper = pipeline._wrapper_process_stream_response(trace_recorder=recorder)
    if consumer == "exhaustion":
        assert list(wrapper) == [pause_response]
    elif consumer == "stream_cancel":
        stream = pipeline._to_stream_response(wrapper)
        assert next(stream).stream_response == pause_response
        stream.close()
    else:
        response = pipeline._to_blocking_response(wrapper)
        assert response.data.message_id == pipeline._message_id

    assert recorder._closed
    assert queue.reserved == 0
    assert len(queue.items) == 1
    pending_trace = CompletedTrace.model_validate_json(queue.items[0].trace_json)
    assert pending_trace.source.tenant_id == recorder.source.tenant_id
    assert pending_trace.source.message_id == recorder.source.message_id
    assert pending_trace.source.actor_id == recorder.source.actor_id
    assert pending_trace.parent is not None
    assert len(pending_trace.spans) == 1
    moderation = pending_trace.spans[0]
    assert moderation.span_type == "moderation"
    assert moderation.inputs == {"query": "original question"}
    assert moderation.outputs == {"passed": True}
    assert moderation.started_at is not None
    assert moderation.ended_at == moderation.started_at
    wrapper.close()
    recorder.close(submit_pending_operations=True)
    assert len(queue.items) == 1

    resumed_recorder = MessageTraceRecorder(recorder.source, queue, recorder.provider_settings)
    resumed_recorder.finish_message_trace(message_fields(resumed_recorder))
    resumed_recorder.close(submit_pending_operations=True)
    traces = [CompletedTrace.model_validate_json(item.trace_json) for item in queue.items]
    assert sum(span.attributes.get("operation_type") == "message" for trace in traces for span in trace.spans) == 1
    assert queue.reserved == 0


@pytest.mark.parametrize("failure", ["empty_stream", "queue_error", "tts_setup_error"])
def test_wrapper_releases_recording_budget_on_exhaustion_or_error(
    pending_moderation: tuple[AdvancedChatAppGenerateTaskPipeline, MessageTraceRecorder, RecordingQueue],
    monkeypatch: pytest.MonkeyPatch,
    failure: str,
) -> None:
    pipeline, recorder, queue = pending_moderation
    if failure == "queue_error":
        pipeline._base_task_pipeline.queue_manager.listen = Mock(side_effect=RuntimeError("queue unavailable"))
    elif failure == "tts_setup_error":
        pipeline._base_task_pipeline.stream = True
        pipeline._workflow_features_dict = {"text_to_speech": {"enabled": True, "autoPlay": "enabled"}}
        monkeypatch.setattr(
            "core.app.apps.advanced_chat.generate_task_pipeline.AppGeneratorTTSPublisher",
            Mock(side_effect=RuntimeError("tts unavailable")),
        )

    wrapper = pipeline._wrapper_process_stream_response(trace_recorder=recorder)
    if failure == "empty_stream":
        assert list(wrapper) == []
    else:
        with pytest.raises(RuntimeError, match="unavailable"):
            list(wrapper)
    assert recorder._closed
    assert queue.reserved == 0
    assert len(queue.items) == 1


def test_failed_operation_submission_still_releases_budget(
    pending_moderation: tuple[AdvancedChatAppGenerateTaskPipeline, MessageTraceRecorder, RecordingQueue],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pipeline, recorder, queue = pending_moderation
    submit = Mock(side_effect=RuntimeError("trace queue unavailable"))
    monkeypatch.setattr(queue, "submit_trace", submit)

    assert list(pipeline._wrapper_process_stream_response(trace_recorder=recorder)) == []

    submit.assert_called_once()
    assert recorder._closed
    assert queue.reserved == 0
