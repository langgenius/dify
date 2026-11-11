from __future__ import annotations

import json
import queue
from collections.abc import Generator

import pytest
from sqlalchemy.orm import Session

from core.app.app_config.entities import WorkflowUIBasedAppConfig
from core.app.apps.advanced_chat.app_config_manager import AdvancedChatAppConfigManager
from core.app.apps.advanced_chat.generate_response_converter import AdvancedChatAppGenerateResponseConverter
from core.app.apps.advanced_chat.generate_task_pipeline import (
    AdvancedChatAppGenerateTaskPipeline,
    ConversationSnapshot,
    MessageSnapshot,
    WorkflowSnapshot,
)
from core.app.apps.base_app_generator import BaseAppGenerator
from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.message_based_app_generator import MessageBasedAppGenerator
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.apps.streaming_utils import STREAM_COMPLETE_SIGNAL, _normalize_terminal_events, stream_topic_events
from core.app.entities.app_invoke_entities import AdvancedChatAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    QueueStopEvent,
    QueueTextChunkEvent,
    QueueWorkflowFailedEvent,
    QueueWorkflowStartedEvent,
)
from core.app.entities.task_entities import (
    ChatbotAppBlockingResponse,
    ChatbotAppStreamResponse,
    MessageEndStreamResponse,
    MessageStreamResponse,
    StreamEvent,
)
from core.workflow.system_variables import build_system_variables
from extensions.application_services.app_moderation import DEFAULT_CHAT_MODERATION_REPLY, app_moderation_scope
from extensions.application_services.moderation import build_llm_moderation_guard
from graphon.entities import WorkflowStartReason
from graphon.enums import WorkflowType
from graphon.model_runtime.entities.message_entities import UserPromptMessage
from graphon.runtime import RuntimeState
from libs.broadcast_channel.channel import SupportsPreparedSubscription
from machinery.context import AppRequestContext
from models.enums import ConversationFromSource, MessageStatus
from models.model import AppMode, EndUser, Message
from services.moderation_adapters import HostedOpenAIModerationGateway
from services.moderation_invocation_errors import (
    ModerationUnavailableInvocationError,
    PlatformModerationRejectedInvocationError,
)
from services.moderation_service import ModerationPhase, ModerationRule, ModerationService
from tasks.app_generate.workflow_execute_task import _publish_streaming_response
from tests.helpers.unit.core.model_moderation_fixtures import RecordingHostedModerationClient, make_moderated_model
from tests.helpers.unit.model_factories import make_app, make_conversation, make_message, make_workflow
from tests.workflow_test_utils import build_test_variable_pool


class FakeSubscription:
    def __init__(self, message_queue: queue.Queue[bytes], state: dict[str, bool]) -> None:
        self._queue = message_queue
        self._state = state
        self._closed = False

    def __enter__(self):
        self._state["subscribed"] = True
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def close(self) -> None:
        self._closed = True

    @property
    def closed(self) -> bool:
        return self._closed

    def receive(self, timeout: float | None = 0.1) -> bytes | None:
        if self._closed:
            return None
        try:
            if timeout is None:
                return self._queue.get()
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return None


class FakeTopic:
    def __init__(self) -> None:
        self._queue: queue.Queue[bytes] = queue.Queue()
        self._state = {"subscribed": False}
        self.subscribe_calls = 0
        self.subscriber_view_calls = 0

    def as_subscriber(self):
        self.subscriber_view_calls += 1
        return self

    def subscribe(self) -> FakeSubscription:
        self.subscribe_calls += 1
        return FakeSubscription(self._queue, self._state)

    def publish(self, payload: bytes) -> None:
        self._queue.put(payload)

    @property
    def subscribed(self) -> bool:
        return self._state["subscribed"]


class FakePreparedSubscriber(SupportsPreparedSubscription):
    def __init__(self, message_queue: queue.Queue[bytes], state: dict[str, bool]) -> None:
        self._queue = message_queue
        self._state = state
        self.prepare_calls = 0

    def prepare_subscription(self) -> FakeSubscription:
        self.prepare_calls += 1
        return FakeSubscription(self._queue, self._state)

    def subscribe(self) -> FakeSubscription:
        return FakeSubscription(self._queue, self._state)


class FailingPreparedSubscriber(FakePreparedSubscriber):
    def prepare_subscription(self) -> FakeSubscription:
        raise RuntimeError("prepare failed")


class FakePreparedTopic(FakeTopic):
    def __init__(self) -> None:
        super().__init__()
        self.subscriber = FakePreparedSubscriber(self._queue, self._state)

    def as_subscriber(self) -> FakePreparedSubscriber:
        self.subscriber_view_calls += 1
        return self.subscriber


class FailingPreparedTopic(FakeTopic):
    def __init__(self) -> None:
        super().__init__()
        self.subscriber = FailingPreparedSubscriber(self._queue, self._state)

    def as_subscriber(self) -> FailingPreparedSubscriber:
        self.subscriber_view_calls += 1
        return self.subscriber


def test_retrieve_events_falls_back_to_subscribe_and_invokes_hook_after_entry(monkeypatch: pytest.MonkeyPatch):
    topic = FakeTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))

    def on_subscribe() -> None:
        assert topic.subscribed is True
        event = {"event": StreamEvent.WORKFLOW_FINISHED.value}
        topic.publish(json.dumps(event).encode())

    generator = MessageBasedAppGenerator.retrieve_events(
        AppMode.WORKFLOW,
        "workflow-run-id",
        idle_timeout=0.5,
        on_subscribe=on_subscribe,
    )

    assert topic.subscriber_view_calls == 1
    assert topic.subscribe_calls == 1
    assert topic.subscribed is False
    assert next(generator) == StreamEvent.PING.value
    event = next(generator)
    assert event["event"] == StreamEvent.WORKFLOW_FINISHED.value
    with pytest.raises(StopIteration):
        next(generator)


def test_retrieve_events_prepares_capable_topic_before_generator_iteration(monkeypatch: pytest.MonkeyPatch):
    topic = FakePreparedTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))

    generator = MessageBasedAppGenerator.retrieve_events(
        AppMode.WORKFLOW,
        "workflow-run-id",
        idle_timeout=0.5,
    )

    assert topic.subscriber_view_calls == 1
    assert topic.subscriber.prepare_calls == 1
    assert topic.subscribe_calls == 0
    assert topic.subscribed is False

    topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_FINISHED.value}).encode())
    assert next(generator) == StreamEvent.PING.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_FINISHED.value


def test_retrieve_events_propagates_preparation_error_before_generator_iteration(monkeypatch: pytest.MonkeyPatch):
    topic = FailingPreparedTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))

    with pytest.raises(RuntimeError, match="prepare failed"):
        MessageBasedAppGenerator.retrieve_events(
            AppMode.WORKFLOW,
            "workflow-run-id",
            idle_timeout=0.5,
        )


def test_normalize_terminal_events_defaults():
    assert _normalize_terminal_events(None) == {
        StreamEvent.WORKFLOW_FINISHED.value,
        StreamEvent.WORKFLOW_PAUSED.value,
    }


def test_normalize_terminal_events_empty_values():
    assert _normalize_terminal_events([]) == set({})


def test_stream_topic_events_emits_ping_and_idle_timeout(monkeypatch: pytest.MonkeyPatch):
    topic = FakeTopic()
    subscription = topic.subscribe()
    times = [1000.0, 1000.0, 1001.0, 1001.0, 1002.0]

    def fake_time():
        return times.pop(0)

    monkeypatch.setattr("core.app.apps.streaming_utils.time.time", fake_time)

    generator = stream_topic_events(
        subscription=subscription,
        idle_timeout=10.0,
        ping_interval=1.0,
    )

    assert next(generator) == StreamEvent.PING.value
    # next receive yields None -> ping interval triggers
    assert next(generator) == StreamEvent.PING.value


def test_stream_topic_events_can_continue_past_pause():
    topic = FakeTopic()
    topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_PAUSED.value}).encode())
    topic.publish(json.dumps({"event": StreamEvent.WORKFLOW_FINISHED.value}).encode())
    subscription = topic.subscribe()

    generator = stream_topic_events(
        subscription=subscription,
        idle_timeout=1.0,
        terminal_events=[StreamEvent.WORKFLOW_FINISHED.value],
    )

    assert next(generator) == StreamEvent.PING.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_PAUSED.value
    assert next(generator)["event"] == StreamEvent.WORKFLOW_FINISHED.value
    with pytest.raises(StopIteration):
        next(generator)


def test_stream_topic_events_hides_completion_signal_and_delivers_prior_public_events():
    topic = FakeTopic()
    message_end = {"event": StreamEvent.MESSAGE_END.value, "message_id": "message-id"}
    tts_end = {"event": StreamEvent.TTS_MESSAGE_END.value, "message_id": "message-id"}
    topic.publish(json.dumps(message_end).encode())
    topic.publish(json.dumps(tts_end).encode())
    topic.publish(STREAM_COMPLETE_SIGNAL)
    topic.publish(json.dumps({"event": StreamEvent.MESSAGE.value, "answer": "too late"}).encode())
    subscription = topic.subscribe()

    events = list(stream_topic_events(subscription=subscription, idle_timeout=1.0))

    assert events == [StreamEvent.PING.value, message_end, tts_end]
    assert subscription.closed is True


def test_stream_completion_signal_ends_stream_when_public_terminal_events_are_disabled():
    topic = FakeTopic()
    workflow_finished = {"event": StreamEvent.WORKFLOW_FINISHED.value}
    topic.publish(json.dumps(workflow_finished).encode())
    topic.publish(STREAM_COMPLETE_SIGNAL)
    topic.publish(json.dumps({"event": StreamEvent.MESSAGE.value, "answer": "too late"}).encode())
    subscription = topic.subscribe()

    events = list(
        stream_topic_events(
            subscription=subscription,
            idle_timeout=1.0,
            terminal_events=[],
        )
    )

    assert events == [StreamEvent.PING.value, workflow_finished]
    assert subscription.closed is True


def test_annotation_shaped_response_stream_completes_without_workflow_events(monkeypatch: pytest.MonkeyPatch):
    topic = FakeTopic()

    def fake_get_response_topic(cls, app_mode, workflow_run_id):
        return topic

    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", classmethod(fake_get_response_topic))
    subscription = topic.subscribe()

    def runtime_responses() -> Generator[ChatbotAppStreamResponse]:
        yield ChatbotAppStreamResponse(
            conversation_id="conversation-id",
            message_id="message-id",
            created_at=1_700_000_000,
            stream_response=MessageStreamResponse(
                task_id="task-id",
                id="message-id",
                answer="annotation answer",
            ),
        )
        yield ChatbotAppStreamResponse(
            conversation_id="conversation-id",
            message_id="message-id",
            created_at=1_700_000_000,
            stream_response=MessageEndStreamResponse(
                task_id="task-id",
                id="message-id",
                metadata={},
            ),
        )

    converted = AdvancedChatAppGenerateResponseConverter.convert(runtime_responses(), InvokeFrom.WEB_APP)
    assert isinstance(converted, Generator)
    _publish_streaming_response(
        converted,
        "workflow-run-id",
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id="workflow-id",
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    # Two public events plus transport completion must be queued before consumption.
    # Otherwise an idle timeout could masquerade as a successful EOF in this test.
    assert topic._queue.qsize() == 3
    response_stream = stream_topic_events(subscription=subscription, idle_timeout=1.0)
    assert next(response_stream) == StreamEvent.PING.value
    message = next(response_stream)
    assert isinstance(message, dict)
    assert message["event"] == StreamEvent.MESSAGE.value
    assert message["answer"] == "annotation answer"
    message_end = next(response_stream)
    assert isinstance(message_end, dict)
    assert message_end["event"] == StreamEvent.MESSAGE_END.value
    assert message_end["metadata"] == {}
    with pytest.raises(StopIteration):
        next(response_stream)

    assert subscription.closed is True
    assert topic._queue.empty()


def test_input_moderation_direct_reply_completes_without_workflow_events(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
):
    """A moderation text/stop queue saves the reply and reaches EOF without a workflow or annotation."""
    moderation_reply = "This request was blocked by input moderation."
    user = EndUser(tenant_id="tenant-id", type="session", session_id="session-id")
    message = Message(
        id="message-id",
        app_id="app-id",
        conversation_id="conversation-id",
        query="blocked query",
        message={},
        answer="",
        from_source=ConversationFromSource.API,
        from_end_user_id=user.id,
        invoke_from=InvokeFrom.WEB_APP,
        app_mode=AppMode.ADVANCED_CHAT,
    )
    sqlite_session.add(message)
    sqlite_session.commit()
    app_config = WorkflowUIBasedAppConfig(
        app_id=message.app_id,
        tenant_id=user.tenant_id,
        workflow_id="workflow-id",
        app_mode=AppMode.ADVANCED_CHAT,
    )
    generate_entity = AdvancedChatAppGenerateEntity(
        task_id="task-id",
        app_config=app_config,
        inputs={},
        files=[],
        user_id=user.id,
        stream=True,
        invoke_from=InvokeFrom.WEB_APP,
        query=message.query,
        workflow_run_id="workflow-run-id",
        extras={"auto_generate_conversation_name": False},
    )
    queue_manager = MessageBasedAppQueueManager(
        task_id=generate_entity.task_id,
        user_id=user.id,
        invoke_from=generate_entity.invoke_from,
        conversation_id=message.conversation_id,
        app_mode=AppMode.ADVANCED_CHAT,
        message_id=message.id,
    )
    pipeline = AdvancedChatAppGenerateTaskPipeline(
        application_generate_entity=generate_entity,
        workflow=WorkflowSnapshot(id=app_config.workflow_id, tenant_id=user.tenant_id, features_dict={}),
        queue_manager=queue_manager,
        conversation=ConversationSnapshot(id=message.conversation_id, mode=AppMode.ADVANCED_CHAT),
        message=MessageSnapshot.from_message(message),
        user=user,
        stream=True,
        dialogue_count=1,
        draft_var_saver_factory=BaseAppGenerator._get_draft_var_saver_factory(
            generate_entity.invoke_from, user, tenant_id=user.tenant_id
        ),
    )
    # These are the events emitted by the runner when input moderation returns a direct reply.
    queue_manager.publish(QueueTextChunkEvent(text=moderation_reply), PublishFrom.APPLICATION_MANAGER)
    queue_manager.publish(
        QueueStopEvent(stopped_by=QueueStopEvent.StopBy.INPUT_MODERATION), PublishFrom.APPLICATION_MANAGER
    )
    runtime_responses = pipeline.process()
    assert isinstance(runtime_responses, Generator)
    converted = AdvancedChatAppGenerateResponseConverter.convert(runtime_responses, InvokeFrom.WEB_APP)
    assert isinstance(converted, Generator)
    topic = FakeTopic()
    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", lambda *_args, **_kwargs: topic)
    subscription = topic.subscribe()

    _publish_streaming_response(
        converted,
        generate_entity.workflow_run_id,
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id=app_config.workflow_id,
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )

    # A queued completion signal makes EOF independent of the idle timeout.
    assert topic._queue.qsize() == 3
    events = list(stream_topic_events(subscription=subscription, idle_timeout=1.0))
    assert events[0] == StreamEvent.PING.value
    message_event, message_end = events[1:]
    assert isinstance(message_event, dict)
    assert message_event["event"] == StreamEvent.MESSAGE.value
    assert message_event["answer"] == moderation_reply
    assert isinstance(message_end, dict)
    assert message_end["event"] == StreamEvent.MESSAGE_END.value
    assert "annotation_reply" not in message_end["metadata"]
    assert subscription.closed is True
    assert topic._queue.empty()
    assert queue_manager.graph_runtime_state is None

    sqlite_session.refresh(message)
    assert message.answer == moderation_reply
    assert message.status == MessageStatus.NORMAL
    assert message.workflow_run_id is None


@pytest.mark.parametrize("phase", ["input", "output"])
@pytest.mark.parametrize("previous_answer", ["", "approved prefix"])
@pytest.mark.parametrize("configured", [False, True])
@pytest.mark.parametrize("invoke_from", [InvokeFrom.WEB_APP, InvokeFrom.SERVICE_API])
@pytest.mark.parametrize("unavailable", [False, True])
@pytest.mark.parametrize("stream", [False, True])
def test_chatflow_moderation_result_survives_workflow_terminal(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session: Session,
    phase: ModerationPhase,
    previous_answer: str,
    configured: bool,
    invoke_from: InvokeFrom,
    unavailable: bool,
    stream: bool,
) -> None:
    app = make_app(tenant_id="test-tenant-id", mode=AppMode.ADVANCED_CHAT)
    workflow = make_workflow(
        workflow_id="workflow-1",
        app_id=app.id,
        tenant_id=app.tenant_id,
        workflow_type=WorkflowType.CHAT,
        version="published",
        graph={"nodes": [{"id": "start", "data": {"type": "start", "variables": []}}], "edges": []},
        features={
            "sensitive_word_avoidance": {
                "enabled": configured,
                "type": "openai_moderation",
                "config": {
                    "inputs_config": {"enabled": True, "preset_response": "App input refusal"},
                    "outputs_config": {"enabled": True, "preset_response": "App output refusal"},
                },
            }
        },
    )
    config = AdvancedChatAppConfigManager.get_app_config(app_model=app, workflow=workflow)
    user = EndUser(id="end-user-1", tenant_id=app.tenant_id, type="session", session_id="session-id")
    conversation = make_conversation(app_id=app.id, mode=app.mode, from_source=ConversationFromSource.API)
    message = make_message(
        app_id=app.id,
        conversation_id=conversation.id,
        query="blocked" if phase == "input" else "safe",
        message={},
        answer="",
        invoke_from=invoke_from,
        from_source=ConversationFromSource.API,
        from_end_user_id=user.id,
    )
    sqlite_session.add_all([conversation, message])
    sqlite_session.commit()
    entity = AdvancedChatAppGenerateEntity(
        task_id="task-1",
        app_config=config,
        query=message.query,
        inputs={},
        files=[],
        user_id=user.id,
        stream=stream,
        invoke_from=invoke_from,
        workflow_run_id="workflow-run-1",
        extras={"auto_generate_conversation_name": False},
    )
    queue_manager = MessageBasedAppQueueManager(
        task_id=entity.task_id,
        user_id=user.id,
        invoke_from=invoke_from,
        conversation_id=conversation.id,
        app_mode=app.mode,
        message_id=message.id,
    )
    queue_manager.graph_runtime_state = RuntimeState(
        workflow_id=workflow.id,
        variable_pool=build_test_variable_pool(
            variables=build_system_variables(workflow_execution_id=entity.workflow_run_id)
        ),
        start_at=0.0,
        node_run_steps=2,
    )
    with app_moderation_scope(app.tenant_id, app.id):
        pipeline = AdvancedChatAppGenerateTaskPipeline(
            application_generate_entity=entity,
            workflow=WorkflowSnapshot.from_workflow(workflow),
            queue_manager=queue_manager,
            conversation=ConversationSnapshot.from_conversation(conversation),
            message=MessageSnapshot.from_message(message),
            user=user,
            stream=stream,
            dialogue_count=1,
            draft_var_saver_factory=BaseAppGenerator._get_draft_var_saver_factory(
                invoke_from, user, tenant_id=app.tenant_id
            ),
        )
        client = RecordingHostedModerationClient()
        if unavailable:
            client.error = RuntimeError("Private moderation backend failure")
        service = ModerationService(
            gateway=HostedOpenAIModerationGateway(
                client=client,
                credentials={"openai_api_key": "platform-key"},
                plugin_unique_identifier="langgenius/openai:1.0.0@checksum",
            )
        )
        guard = build_llm_moderation_guard(
            AppRequestContext(tenant_id=app.tenant_id, app_id=app.id),
            service=service,
            rule=ModerationRule(
                type="openai_moderation",
                config={
                    "inputs_config": {"enabled": not unavailable or phase == "input"},
                    "outputs_config": {"enabled": True},
                },
            ),
            platform=True,
        )
        model, provider = make_moderated_model(quota=True, parts=["blocked"], moderation=guard)

        def invoke() -> None:
            list(model.invoke_llm([UserPromptMessage(content=entity.query)], stream=True))

        error_type = ModerationUnavailableInvocationError if unavailable else PlatformModerationRejectedInvocationError
        with pytest.raises(error_type) as rejected:
            invoke()
    queue_manager.publish(QueueWorkflowStartedEvent(), PublishFrom.APPLICATION_MANAGER)
    pipeline._task_state.answer = previous_answer
    queue_manager.publish(
        QueueWorkflowFailedEvent(error=str(rejected.value), exceptions_count=1), PublishFrom.APPLICATION_MANAGER
    )
    expected_reply = f"App {phase} refusal" if configured else DEFAULT_CHAT_MODERATION_REPLY
    if not stream:
        if unavailable:
            with pytest.raises(ModerationUnavailableInvocationError) as failure:
                pipeline.process()
            assert failure.value.error_code == "moderation_unavailable"
            assert failure.value.status_code == 503
        else:
            response = pipeline.process()
            assert isinstance(response, ChatbotAppBlockingResponse)
            assert response.data.answer == expected_reply
        sqlite_session.refresh(message)
        assert message.status == (MessageStatus.ERROR if unavailable else MessageStatus.NORMAL)
        assert message.error == (str(rejected.value) if unavailable else None)
        assert message.answer == ("" if unavailable else expected_reply)
        assert provider.invocations == (0 if phase == "input" else 1)
        return
    runtime_responses = pipeline.process()
    assert isinstance(runtime_responses, Generator)
    converted = AdvancedChatAppGenerateResponseConverter.convert(runtime_responses, invoke_from)
    assert isinstance(converted, Generator)
    topic = FakeTopic()
    monkeypatch.setattr(MessageBasedAppGenerator, "get_response_topic", lambda *_args, **_kwargs: topic)
    _publish_streaming_response(
        converted,
        entity.workflow_run_id,
        app_mode=AppMode.ADVANCED_CHAT,
        workflow_id=workflow.id,
        inputs={},
        started_reason=WorkflowStartReason.INITIAL,
    )
    assert topic._queue.qsize() == (3 if unavailable else 4)
    subscription = topic.subscribe()
    events = list(stream_topic_events(subscription=subscription, idle_timeout=0.1))
    public_events = [event for event in events if isinstance(event, dict)]
    if unavailable:
        assert [event["event"] for event in public_events] == ["workflow_started", "error", "workflow_finished"]
        assert public_events[1]["code"] == "moderation_unavailable"
        assert public_events[1]["status"] == 503
        assert public_events[1]["message"] == str(ModerationUnavailableInvocationError())
        assert "Private" not in json.dumps(public_events)
    else:
        assert [event["event"] for event in public_events] == [
            "workflow_started",
            "message_replace" if previous_answer else "message",
            "message_end",
            "workflow_finished",
        ]
        assert public_events[1]["answer"] == expected_reply
    assert public_events[-1]["data"]["status"] == "failed"
    assert public_events[-1]["data"]["error"] == str(rejected.value)
    assert subscription.closed
    assert topic._queue.empty()
    assert provider.invocations == (0 if phase == "input" else 1)
    sqlite_session.refresh(message)
    assert message.answer == ("" if unavailable else expected_reply)
    assert message.status == (MessageStatus.ERROR if unavailable else MessageStatus.NORMAL)
    assert message.error == (str(rejected.value) if unavailable else None)
