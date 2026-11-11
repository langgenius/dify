"""Exercise migrated message tracing through real queues and repository transactions."""

import json
from typing import Literal

import pytest
from dify_trace_sdk.emitter import TraceScope
from dify_trace_sdk.events import MessageCompleted, TraceCorrelation, TraceEvent
from sqlalchemy import event
from sqlalchemy.orm import Session, sessionmaker

from core.app.apps.base_app_queue_manager import PublishFrom
from core.app.apps.message_based_app_queue_manager import MessageBasedAppQueueManager
from core.app.entities.app_invoke_entities import AgentAppGenerateEntity, AgentChatAppGenerateEntity
from core.app.entities.queue_entities import QueueErrorEvent, QueueLLMChunkEvent, QueueMessageEndEvent, QueueStopEvent
from core.app.entities.task_entities import MessageStreamResponse, StreamEvent
from core.plugin.impl.model import PluginModelClient
from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.enums import MessageStatus
from models.model import AppMode, Conversation, Message
from repositories.app.generation_repository import AppGenerationRepository
from services.app.generation.adapters.message_pipeline import EasyUIBasedGenerateTaskPipeline


class CommittedMessageRecorder:
    def __init__(self, sessions: sessionmaker[Session]) -> None:
        self.sessions = sessions
        self.observations: list[tuple[TraceEvent, str, MessageStatus]] = []

    def emit(self, event: TraceEvent) -> None:
        """Read from another connection, so uncommitted outcomes cannot appear durable."""
        payload = event.payload
        assert isinstance(payload, MessageCompleted)
        with self.sessions() as session:
            message = session.get(Message, payload.message_id)
            assert message is not None
            self.observations.append((event, message.answer, message.status))


@pytest.mark.parametrize("mode", [AppMode.AGENT_CHAT, AppMode.AGENT])
@pytest.mark.parametrize("terminal", ["end", "error", "stop"])
@pytest.mark.parametrize("commit_fails", [False, True])
@pytest.mark.usefixtures("agent_runtime_app")
def test_trace_follows_commit_and_agent_stop_remains_intent(
    agent_generate_entity: AgentChatAppGenerateEntity,
    agent_queue_manager: MessageBasedAppQueueManager,
    agent_records: tuple[Conversation, Message],
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    terminal: Literal["end", "error", "stop"],
    commit_fails: bool,
) -> None:
    """Only committed terminals trace; Agent stop is persisted for the worker, not completed here."""
    entity: AgentChatAppGenerateEntity | AgentAppGenerateEntity = agent_generate_entity
    conversation, message = agent_records
    if mode == AppMode.AGENT:
        entity = AgentAppGenerateEntity(
            task_id=entity.task_id,
            app_config=entity.app_config,
            model_conf=entity.model_conf,
            inputs=entity.inputs,
            query=entity.query,
            files=entity.files,
            user_id=entity.user_id,
            stream=entity.stream,
            invoke_from=entity.invoke_from,
            agent_id="agent",
            agent_config_snapshot_id="snapshot",
        )
        entity.app_config.app_mode = mode
    recorder = CommittedMessageRecorder(sqlite_session_factory)
    entity.trace_scope = TraceScope(
        emitter=recorder,
        tenant_id="tenant",
        app_id="app1",
        user_id="user",
        correlation=TraceCorrelation(
            external_trace_id=None, session_id=None, parent_workflow_run_id=None, parent_node_execution_id=None
        ),
    )
    pipeline = EasyUIBasedGenerateTaskPipeline(
        entity,
        agent_queue_manager,
        conversation,
        message,
        True,
        records=AppGenerationRepository(sqlite_session_factory),
    )
    monkeypatch.setattr(PluginModelClient, "get_llm_num_tokens", lambda *_args, **_kwargs: 2)
    chunk = QueueLLMChunkEvent(
        chunk=LLMResultChunk(
            model=entity.model_conf.model,
            prompt_messages=[],
            delta=LLMResultChunkDelta(index=0, message=AssistantPromptMessage(content="answer")),
        )
    )
    agent_queue_manager.publish(chunk, PublishFrom.TASK_PIPELINE)
    terminal_event = (
        QueueErrorEvent(error=ValueError("generation failed"))
        if terminal == "error"
        else QueueStopEvent(stopped_by=QueueStopEvent.StopBy.USER_MANUAL)
        if terminal == "stop"
        else QueueMessageEndEvent()
    )
    agent_queue_manager.publish(terminal_event, PublishFrom.TASK_PIPELINE)

    def reject_commit(_session: Session) -> None:
        raise RuntimeError("commit rejected")

    if commit_fails:
        event.listen(sqlite_session_factory, "before_commit", reject_commit)
    try:
        if commit_fails:
            with pytest.raises(RuntimeError, match="commit rejected"):
                list(pipeline._process_stream_response(publisher=None))
        else:
            responses = list(pipeline._process_stream_response(publisher=None))
            assert isinstance(responses[0], MessageStreamResponse)
            assert responses[0].event == StreamEvent.MESSAGE
    finally:
        if commit_fails:
            event.remove(sqlite_session_factory, "before_commit", reject_commit)

    agent_stop = mode == AppMode.AGENT and terminal == "stop"
    if commit_fails or agent_stop:
        assert recorder.observations == []
    else:
        [(emitted, answer, status)] = recorder.observations
        assert isinstance(emitted.payload, MessageCompleted)
        assert (emitted.payload.message_id, emitted.payload.conversation_id) == (message.id, conversation.id)
        assert answer == ("" if terminal == "error" else "answer")
        assert status == (MessageStatus.ERROR if terminal == "error" else MessageStatus.NORMAL)
    with sqlite_session_factory() as session:
        saved = session.get(Message, message.id)
        assert saved is not None
        metadata = json.loads(saved.message_metadata or "{}")
        assert bool(metadata.get("agent_stop_requested")) == (agent_stop and not commit_fails)
        if commit_fails:
            assert saved.answer == ""
            assert saved.status == MessageStatus.NORMAL
