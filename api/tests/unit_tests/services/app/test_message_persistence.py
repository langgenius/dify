"""Exercise the shared message lifecycle against a database unavailable to global factories."""

import json
from collections.abc import Generator, Iterator
from dataclasses import replace
from decimal import Decimal
from typing import Literal, override

import pytest
from sqlalchemy import Connection, Engine, create_engine, event, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.apps import base_app_queue_manager
from core.app.apps.base_app_queue_manager import AppQueueManager, PublishFrom
from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    ConversationAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import AppQueueEvent, MessageQueueMessage, QueueErrorEvent, WorkflowQueueMessage
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.annotation_reply import AnnotationReplies
from models.base import TypeBase
from models.enums import ConversationFromSource, CreatorUserRole, MessageStatus
from models.model import AppMode, Conversation, Message, MessageAgentThought, MessageFile
from repositories.app.generation_repository import AppGenerationRepository
from services.app.generation.adapters import message_pipeline
from services.app.generation.adapters.message_pipeline import EasyUIBasedGenerateTaskPipeline
from services.app.generation.message_records import MessageBasedAppGenerator
from services.app.generation.ports import MessageIdentity, MessageUpdate
from services.errors.message import MessageNotExistsError
from tests.unit_tests.core.app.apps.test_message_based_app_generator import DummyModelConf, _make_app_config
from tests.unit_tests.model_factories import make_app, make_message

type GenerateEntityType = (
    type[ChatAppGenerateEntity]
    | type[CompletionAppGenerateEntity]
    | type[AgentChatAppGenerateEntity]
    | type[AgentAppGenerateEntity]
)
type MessageStore = tuple[sessionmaker[Session], AppGenerationRepository]


class Queue(AppQueueManager):
    identity: MessageIdentity | None

    @override
    def __init__(self, task_id: str, user_id: str, invoke_from: InvokeFrom) -> None:
        super().__init__(task_id=task_id, user_id=user_id, invoke_from=invoke_from)
        self.identity = None

    @classmethod
    def for_identity(cls, identity: MessageIdentity) -> "Queue":
        queue = cls(task_id="task", user_id="user", invoke_from=InvokeFrom.WEB_APP)
        queue.identity = identity
        return queue

    @override
    def listen(self) -> Generator[MessageQueueMessage | WorkflowQueueMessage, None, None]:
        assert self.identity is not None
        yield MessageQueueMessage(
            task_id="task",
            message_id=self.identity.message_id,
            conversation_id=self.identity.conversation_id,
            app_mode=AppMode.CHAT,
            event=QueueErrorEvent(error=ValueError("generation failed")),
        )

    @override
    def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
        raise AssertionError(f"Unexpected event from {pub_from}: {event}")


@pytest.fixture
def message_store(monkeypatch: pytest.MonkeyPatch) -> Iterator[MessageStore]:
    monkeypatch.setattr(base_app_queue_manager, "redis_client", QueueRedisStub())
    engine = create_engine("sqlite://", poolclass=QueuePool)
    TypeBase.metadata.create_all(
        engine,
        tables=[
            TypeBase.metadata.tables[name]
            for name in ("apps", "conversations", "messages", "message_agent_thoughts", "message_files", "upload_files")
        ],
    )
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as session:
        session.add(make_app(app_id="app-id", tenant_id="tenant-id"))
    try:
        yield sessions, AppGenerationRepository(sessions)
    finally:
        engine.dispose()


class ChatDummyModelConf(DummyModelConf):
    mode: Literal["chat"] = "chat"


class QueueRedisStub:
    def setex(self, key: str, timeout: int, value: object) -> bool:
        assert key == "generate_task_belong:task"
        assert timeout == 1800
        assert value == "end-user-user"
        return True


def checked_out_connections(engine: Engine) -> int:
    pool = engine.pool
    assert isinstance(pool, QueuePool)
    return pool.checkedout()


def initialize(
    records: AppGenerationRepository,
    mode: AppMode,
    entity_type: GenerateEntityType,
    annotations: AnnotationReplies,
    conversation: Conversation | None = None,
) -> tuple[MessageIdentity, EasyUIBasedGenerateTaskPipeline]:
    config = _make_app_config(mode)
    model = ChatDummyModelConf()
    entity = entity_type.model_construct(
        task_id="task",
        app_config=config,
        model_conf=model,
        inputs={},
        query="hello",
        files=[],
        user_id="user",
        invoke_from=InvokeFrom.WEB_APP,
        stream=False,
        extras={},
        trace_manager=None,
    )
    if isinstance(entity, ConversationAppGenerateEntity):
        entity.parent_message_id = "parent-message"
    generator = MessageBasedAppGenerator(records=records, annotations=annotations)
    conversation, message = generator._init_generate_records(entity, conversation)
    identity = MessageIdentity(config.tenant_id, config.app_id, conversation.id, message.id)
    pipeline = EasyUIBasedGenerateTaskPipeline(
        entity,
        Queue.for_identity(identity),
        conversation,
        message,
        False,
        records=records,
    )
    return identity, pipeline


@pytest.mark.parametrize(
    ("mode", "entity_type"),
    [
        (AppMode.CHAT, ChatAppGenerateEntity),
        (AppMode.COMPLETION, CompletionAppGenerateEntity),
        (AppMode.AGENT_CHAT, AgentChatAppGenerateEntity),
        (AppMode.AGENT, AgentAppGenerateEntity),
    ],
)
def test_initializing_message_in_long_conversation_does_not_read_history(
    message_store: MessageStore,
    annotation_replies: AnnotationReplies,
    mode: AppMode,
    entity_type: GenerateEntityType,
) -> None:
    sessions, records = message_store
    identity, _ = initialize(records, mode, entity_type, annotation_replies)
    _, conversation, message = records.load(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        conversation_id=identity.conversation_id,
        message_id=identity.message_id,
    )
    expected_parent_id = "parent-message" if issubclass(entity_type, ConversationAppGenerateEntity) else None
    assert message.parent_message_id == expected_parent_id
    with sessions.begin() as session:
        session.add_all(
            make_message(
                message_id=f"history-{index}",
                app_id=identity.app_id,
                conversation_id=identity.conversation_id,
                query="previous question",
                inputs={},
                message={},
                answer="long response " * 1000,
                message_unit_price=Decimal(0),
                answer_unit_price=Decimal(0),
                currency="USD",
                from_source=ConversationFromSource.API,
            )
            for index in range(256)
        )

    selects: list[str] = []

    def capture_reads(
        _conn: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        sql = " ".join(statement.lower().split())
        if sql.startswith("select") and " from messages " in sql:
            selects.append(sql)

    engine: Engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", capture_reads)
    try:
        next_identity, _ = initialize(records, mode, entity_type, annotation_replies, conversation)
    finally:
        event.remove(engine, "before_cursor_execute", capture_reads)

    assert next_identity.conversation_id == identity.conversation_id
    assert next_identity.message_id != identity.message_id
    # Refreshing the newly inserted row is bounded; selecting a conversation's history is not.
    assert all("where messages.id =" in sql for sql in selects), selects
    assert checked_out_connections(engine) == 0


@pytest.mark.parametrize(
    ("mode", "entity_type"),
    [
        (AppMode.CHAT, ChatAppGenerateEntity),
        (AppMode.COMPLETION, CompletionAppGenerateEntity),
        (AppMode.AGENT_CHAT, AgentChatAppGenerateEntity),
        (AppMode.AGENT, AgentAppGenerateEntity),
    ],
)
def test_initialization_worker_read_and_completion_use_injected_database(
    message_store: MessageStore,
    annotation_replies: AnnotationReplies,
    monkeypatch: pytest.MonkeyPatch,
    mode: AppMode,
    entity_type: GenerateEntityType,
) -> None:
    sessions, records = message_store
    identity, pipeline = initialize(records, mode, entity_type, annotation_replies)
    engine: Engine = sessions.kw["bind"]
    assert checked_out_connections(engine) == 0
    app, conversation, message = records.load(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        conversation_id=identity.conversation_id,
        message_id=identity.message_id,
    )
    assert (app.id, conversation.mode, message.query) == ("app-id", mode, "hello")
    assert checked_out_connections(engine) == 0
    pipeline._task_state.llm_result.message = AssistantPromptMessage(content="answer")
    pipeline._task_state.llm_result.usage = LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 3})
    observed: list[str] = []

    def completed(saved: Message, **_kwargs: object) -> None:
        assert checked_out_connections(engine) == 0
        with sessions() as session:
            committed = session.get(Message, saved.id)
            assert committed is not None
            assert (committed.answer, committed.message_tokens, committed.answer_tokens) == ("answer", 2, 3)
        observed.append(saved.id)

    monkeypatch.setattr(message_pipeline.message_was_created, "send", completed)
    pipeline._save_message()
    assert observed == [identity.message_id]
    assert pipeline._message_end_to_stream_response().files == []
    assert checked_out_connections(engine) == 0
    with sessions() as session:
        assert len(session.scalars(select(Conversation)).all()) == 1
        assert len(session.scalars(select(Message)).all()) == 1


def test_error_event_updates_the_same_injected_message(
    message_store: MessageStore, annotation_replies: AnnotationReplies
) -> None:
    sessions, records = message_store
    identity, pipeline = initialize(records, AppMode.CHAT, ChatAppGenerateEntity, annotation_replies)
    responses = list(pipeline._process_stream_response(publisher=None))
    assert len(responses) == 1
    with sessions() as session:
        message = session.get(Message, identity.message_id)
        assert message is not None
        assert message.status == MessageStatus.ERROR
        assert message.error == "generation failed"
    engine: Engine = sessions.kw["bind"]
    assert checked_out_connections(engine) == 0


@pytest.mark.parametrize("usage_arrives_first", [True, False])
def test_stop_and_backend_usage_preserve_each_others_fields(
    message_store: MessageStore, annotation_replies: AnnotationReplies, usage_arrives_first: bool
) -> None:
    sessions, records = message_store
    identity, _ = initialize(records, AppMode.AGENT, AgentAppGenerateEntity, annotation_replies)
    usage = LLMUsage.from_metadata({"prompt_tokens": 7, "completion_tokens": 11, "total_price": "0.3"})
    stopped = MessageUpdate(
        answer="partial answer",
        latency=1,
        metadata={"annotation_reply": {"id": "annotation"}},
        files=[],
        usage=LLMUsage.empty_usage(),
        preserve_existing_usage=True,
    )
    if usage_arrives_first:
        records.save_usage(identity, usage)
        records.save_message(identity, stopped)
    else:
        records.save_message(identity, stopped)
        records.save_usage(identity, usage)
    with sessions() as session:
        message = session.get(Message, identity.message_id)
        assert message is not None
        assert (message.answer, message.message_tokens, message.answer_tokens) == ("partial answer", 7, 11)
        assert message.message_metadata is not None
        assert json.loads(message.message_metadata)["usage"]["prompt_tokens"] == 7
        assert json.loads(message.message_metadata)["annotation_reply"] == {"id": "annotation"}


def test_agent_thought_deltas_append_to_supported_fields(
    message_store: MessageStore, annotation_replies: AnnotationReplies
) -> None:
    sessions, records = message_store
    identity, _ = initialize(records, AppMode.AGENT, AgentAppGenerateEntity, annotation_replies)
    thought_id = records.create_agent_thought(
        identity,
        {
            "position": 1,
            "created_by_role": CreatorUserRole.END_USER,
            "created_by": "user",
            "thought": None,
            "tool_input": "tool-prefix",
            "answer": "answer-prefix",
        },
    )

    records.update_agent_thought(
        identity,
        thought_id,
        values={},
        deltas={"thought": "thought", "tool_input": "-suffix", "answer": "-suffix"},
    )

    with sessions() as session:
        thought = session.get(MessageAgentThought, thought_id)
        assert thought is not None
        assert (thought.thought, thought.tool_input, thought.answer) == (
            "thought",
            "tool-prefix-suffix",
            "answer-prefix-suffix",
        )


@pytest.mark.parametrize(
    "invalid_owner",
    [
        {"tenant_id": "another-tenant"},
        {"app_id": "another-app"},
        {"conversation_id": "another-conversation"},
    ],
)
def test_message_write_revalidates_complete_owner_chain(
    message_store: MessageStore, annotation_replies: AnnotationReplies, invalid_owner: dict[str, str]
) -> None:
    _, records = message_store
    identity, _ = initialize(records, AppMode.CHAT, ChatAppGenerateEntity, annotation_replies)
    with pytest.raises(MessageNotExistsError):
        records.save_usage(replace(identity, **invalid_owner), LLMUsage.empty_usage())


def test_multimodal_output_releases_connection_before_file_io_and_publishes_committed_file(
    message_store: MessageStore,
    annotation_replies: AnnotationReplies,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from core.app.entities.queue_entities import QueueMessageFileEvent
    from graphon.model_runtime.entities.llm_entities import LLMResultChunk, LLMResultChunkDelta
    from graphon.model_runtime.entities.message_entities import ImagePromptMessageContent
    from models.tools import ToolFile
    from services.app.generation.adapters import base_runner

    sessions, records = message_store
    identity, _ = initialize(records, AppMode.CHAT, ChatAppGenerateEntity, annotation_replies)
    engine = sessions.kw["bind"]
    tool_file = ToolFile(
        user_id="user",
        tenant_id="tenant-id",
        conversation_id=None,
        file_key="generated/image.png",
        mimetype="image/png",
        original_url="https://example.com/image.png",
        name="image.png",
        size=68,
    )
    observed: list[str] = []

    class Files:
        def create_file_by_url(
            self, user_id: str, tenant_id: str, file_url: str, conversation_id: str | None = None
        ) -> ToolFile:
            assert checked_out_connections(engine) == 0
            assert (user_id, tenant_id, file_url, conversation_id) == (
                "user",
                identity.tenant_id,
                "https://example.com/image.png",
                None,
            )
            return tool_file

    class Events(AppQueueManager):
        invoke_from = InvokeFrom.WEB_APP

        @override
        def __init__(self, task_id: str, user_id: str, invoke_from: InvokeFrom) -> None:
            super().__init__(task_id=task_id, user_id=user_id, invoke_from=invoke_from)

        @classmethod
        def build(cls) -> "Events":
            return cls(task_id="task", user_id="user", invoke_from=InvokeFrom.WEB_APP)

        @override
        def _publish(self, event: AppQueueEvent, pub_from: PublishFrom) -> None:
            assert checked_out_connections(engine) == 0
            assert pub_from is PublishFrom.APPLICATION_MANAGER
            if isinstance(event, QueueMessageFileEvent):
                with sessions() as session:
                    record = session.get(MessageFile, event.message_file_id)
                    assert record is not None
                    assert (record.message_id, record.upload_file_id) == (identity.message_id, tool_file.id)
                observed.append(event.message_file_id)

    def stream() -> Generator[LLMResultChunk, None, None]:
        yield LLMResultChunk(
            model="model",
            prompt_messages=[],
            delta=LLMResultChunkDelta(
                index=0,
                message=AssistantPromptMessage(
                    content=[
                        ImagePromptMessageContent(
                            url="https://example.com/image.png", format="png", mime_type="image/png"
                        ),
                    ]
                ),
            ),
        )

    monkeypatch.setattr(base_runner, "ToolFileManager", Files)
    base_runner.AppRunner(records=records)._handle_invoke_result_stream(
        stream(),
        Events.build(),
        False,
        message_id=identity.message_id,
        user_id="user",
        tenant_id=identity.tenant_id,
    )
    assert len(observed) == 1
