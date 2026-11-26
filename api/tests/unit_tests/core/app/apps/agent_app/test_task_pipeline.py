"""AgentAppTaskPipeline: steering frames interleaved with shared EasyUI dispatch.

Uses the real ``AgentAppQueueManager`` listener machinery (queue fed via
``_q.put``), a real ``AgentAppGenerateEntity``, and sqlite-backed
``Conversation``/``Message`` rows — the only seam stubbed is the message cycle
manager, as in the shared EasyUI pipeline tests.
"""

import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from core.app.app_config.entities import EasyUIBasedAppModelConfigFrom, ModelConfigEntity, PromptTemplateEntity
from core.app.apps.agent_app.app_config_manager import AgentAppConfig
from core.app.apps.agent_app.generate_response_converter import AgentAppGenerateResponseConverter
from core.app.apps.agent_app.task_pipeline import AgentAppQueueManager, AgentAppTaskPipeline
from core.app.entities.app_invoke_entities import AgentAppGenerateEntity, InvokeFrom
from core.app.entities.queue_entities import (
    AgentDeliveredInput,
    AppQueueEvent,
    MessageQueueMessage,
    QueueAgentInputDeliveredEvent,
    QueueAgentMessageEvent,
    QueueAgentQueueReadyEvent,
    QueuePingEvent,
)
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.enums import ConversationFromSource
from models.enums import InvokeFrom as ModelInvokeFrom
from models.model import AppMode, Conversation, Message
from tests.helpers.unit.core.model_fixtures import make_model_config
from tests.helpers.unit.model_factories import make_conversation, make_message


def _conversation(conversation_id: str) -> Conversation:
    return make_conversation(
        conversation_id=conversation_id,
        mode=AppMode.AGENT,
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="user-1",
        invoke_from=ModelInvokeFrom.DEBUGGER,
    )


def _message(message_id: str, *, conversation_id: str = "test-conversation-id") -> Message:
    return make_message(
        message_id=message_id,
        conversation_id=conversation_id,
        query="hello",
        message={"role": "user", "content": "hello"},
        answer="",
        message_unit_price=Decimal(0),
        answer_unit_price=Decimal(0),
        currency="USD",
        from_source=ConversationFromSource.CONSOLE,
        from_account_id="user-1",
        invoke_from=ModelInvokeFrom.DEBUGGER,
        created_at=datetime(2024, 1, 1, tzinfo=UTC),
    )


def _entity() -> AgentAppGenerateEntity:
    return AgentAppGenerateEntity(
        task_id="test-task-id",
        app_config=AgentAppConfig(
            tenant_id="tenant-1",
            app_id="app-1",
            app_mode=AppMode.AGENT,
            app_model_config_from=EasyUIBasedAppModelConfigFrom.APP_LATEST_CONFIG,
            app_model_config_dict={},
            model=ModelConfigEntity(provider="openai", model="gpt-4o-mini", mode="chat"),
            prompt_template=PromptTemplateEntity(prompt_type=PromptTemplateEntity.PromptType.SIMPLE),
        ),
        model_conf=make_model_config(provider="openai", model="gpt-4o-mini", mode="chat"),
        inputs={},
        files=[],
        query="hello",
        user_id="user-1",
        stream=True,
        invoke_from=InvokeFrom.DEBUGGER,
        agent_id="agent-1",
        agent_config_snapshot_id="snapshot-1",
        agent_config_version_kind="draft",
    )


def _queue_manager() -> AgentAppQueueManager:
    return AgentAppQueueManager(
        task_id="test-task-id",
        user_id="user-1",
        invoke_from=InvokeFrom.DEBUGGER,
        conversation_id="test-conversation-id",
        app_mode=AppMode.AGENT,
        message_id="test-message-id",
    )


def _feed(queue_manager: AgentAppQueueManager, events: list[AppQueueEvent | None]) -> None:
    for event in events:
        queue_manager._q.put(
            MessageQueueMessage(
                task_id="test-task-id",
                app_mode=AppMode.AGENT,
                message_id="test-message-id",
                conversation_id="test-conversation-id",
                event=event,
            )
            if event is not None
            else None
        )


def _agent_chunk(content: str) -> QueueAgentMessageEvent:
    return QueueAgentMessageEvent(
        chunk=LLMResultChunk(
            model="gpt-4o-mini",
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content=content)),
        )
    )


def _pipeline(
    queue_manager: AgentAppQueueManager,
    conversation: Conversation,
    message: Message,
) -> AgentAppTaskPipeline:
    pipeline = AgentAppTaskPipeline(
        application_generate_entity=_entity(),
        queue_manager=queue_manager,
        conversation=conversation,
        message=message,
        stream=True,
    )
    return pipeline


class TestSteeringFramesSurviveEndToEnd:
    """The shared EasyUI loop must not swallow the private steering events."""

    def test_steering_frames_arrive_in_queue_order(self) -> None:
        input_id = uuid.uuid4()
        queue_manager = _queue_manager()
        _feed(
            queue_manager,
            [
                QueueAgentQueueReadyEvent(),
                _agent_chunk("first "),
                QueueAgentInputDeliveredEvent(input=AgentDeliveredInput(input_id=input_id, text="plan B")),
                QueuePingEvent(),
                _agent_chunk("second"),
                None,
            ],
        )
        pipeline = _pipeline(queue_manager, _conversation("test-conversation-id"), _message("test-message-id"))

        frames = list(
            AgentAppGenerateResponseConverter.convert_stream_full_response(
                pipeline._to_stream_response(pipeline._process_stream_response(publisher=None))
            )
        )

        events = [frame if isinstance(frame, str) else frame["event"] for frame in frames]
        assert events == [
            "agent_queue_ready",
            "agent_message",
            "agent_input_delivered",
            "ping",
            "agent_message",
        ]
        typed_frames: list[dict[str, object]] = [frame for frame in frames if isinstance(frame, dict)]
        assert all(frame["task_id"] == "test-task-id" for frame in typed_frames)
        assert typed_frames[1]["answer"] == "first "
        assert typed_frames[2]["input"] == {"input_id": str(input_id), "text": "plan B"}
        assert typed_frames[3]["answer"] == "second"

    def test_consecutive_steering_events_each_emit_a_frame(self) -> None:
        input_id = uuid.uuid4()
        queue_manager = _queue_manager()
        _feed(
            queue_manager,
            [
                QueueAgentQueueReadyEvent(),
                QueueAgentInputDeliveredEvent(input=AgentDeliveredInput(input_id=input_id, text="again")),
                None,
            ],
        )
        pipeline = _pipeline(queue_manager, _conversation("test-conversation-id"), _message("test-message-id"))

        frames = list(
            AgentAppGenerateResponseConverter.convert_stream_full_response(
                pipeline._to_stream_response(pipeline._process_stream_response(publisher=None))
            )
        )

        assert [frame["event"] for frame in frames if isinstance(frame, dict)] == [
            "agent_queue_ready",
            "agent_input_delivered",
        ]


class TestSaveMessagePreservesSteeringInputs:
    """The terminal save must not erase inputs the recorder persisted mid-run."""

    def test_steering_inputs_survive_save(self, sqlite_session: Session) -> None:
        input_id = uuid.uuid4()
        stored_inputs = [{"input_id": str(input_id), "text": "delivered input"}]
        conversation = _conversation("conv-save")
        message = _message("msg-save", conversation_id="conv-save")
        message.answer = "partial"
        message.message_metadata = json.dumps({"steering_inputs": stored_inputs, "agent_stop_requested": False})
        sqlite_session.add_all([conversation, message])
        sqlite_session.commit()

        queue_manager = _queue_manager()
        pipeline = _pipeline(queue_manager, conversation, message)
        saved = pipeline._save_message(session=sqlite_session)
        sqlite_session.commit()

        metadata = json.loads(saved.message_metadata or "{}")
        assert metadata["steering_inputs"] == stored_inputs

    def test_save_without_delivered_inputs_stays_clean(self, sqlite_session: Session) -> None:
        conversation = _conversation("conv-plain")
        message = _message("msg-plain", conversation_id="conv-plain")
        sqlite_session.add_all([conversation, message])
        sqlite_session.commit()

        queue_manager = _queue_manager()
        pipeline = _pipeline(queue_manager, conversation, message)
        saved = pipeline._save_message(session=sqlite_session)

        metadata = json.loads(saved.message_metadata or "{}")
        assert metadata["steering_inputs"] == []
