"""Exercise the shared message lifecycle against a database unavailable to global factories."""

import json
from dataclasses import replace
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.entities.app_invoke_entities import (
    AgentAppGenerateEntity,
    AgentChatAppGenerateEntity,
    ChatAppGenerateEntity,
    CompletionAppGenerateEntity,
    InvokeFrom,
)
from core.app.entities.queue_entities import MessageQueueMessage, QueueErrorEvent
from graphon.model_runtime.entities.llm_entities import LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from models.base import TypeBase
from models.enums import ConversationFromSource, MessageStatus
from models.model import App, AppMode, Conversation, Message, MessageFile, UploadFile
from repositories.app.generation_repository import AppGenerationRepository
from services.app.generation.adapters import message_pipeline
from services.app.generation.adapters.message_pipeline import EasyUIBasedGenerateTaskPipeline
from services.app.generation.message_records import MessageBasedAppGenerator
from services.app.generation.ports import MessageIdentity, MessageUpdate
from services.errors.message import MessageNotExistsError
from tests.unit_tests.core.app.apps.test_message_based_app_generator import DummyModelConf, _make_app_config
from tests.unit_tests.model_factories import make_app, make_message


class Queue:
    def __init__(self, identity):
        self.identity = identity

    def listen(self):
        yield MessageQueueMessage(
            task_id="task",
            message_id=self.identity.message_id,
            conversation_id=self.identity.conversation_id,
            app_mode=AppMode.CHAT,
            event=QueueErrorEvent(error=ValueError("generation failed")),
        )


@pytest.fixture
def message_store():
    engine = create_engine("sqlite://", poolclass=QueuePool)
    TypeBase.metadata.create_all(
        engine,
        tables=[model.__table__ for model in (App, Conversation, Message, MessageFile, UploadFile)],
    )
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as session:
        session.add(make_app(app_id="app-id", tenant_id="tenant-id"))
    try:
        yield sessions, AppGenerationRepository(sessions)
    finally:
        engine.dispose()


def initialize(records, mode, entity_type, annotations, conversation=None):
    config = _make_app_config(mode)
    model = DummyModelConf()
    model.mode = "chat"
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
    generator = MessageBasedAppGenerator(records=records, annotations=annotations)
    conversation, message = generator._init_generate_records(entity, conversation)
    identity = MessageIdentity(config.tenant_id, config.app_id, conversation.id, message.id)
    pipeline = EasyUIBasedGenerateTaskPipeline(
        entity,
        Queue(identity),
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
    message_store, annotation_replies, mode, entity_type
):
    sessions, records = message_store
    identity, _ = initialize(records, mode, entity_type, annotation_replies)
    _, conversation, _ = records.load(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        conversation_id=identity.conversation_id,
        message_id=identity.message_id,
    )
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

    selects = []

    def capture_reads(_conn, _cursor, statement, _parameters, _context, _executemany):
        sql = " ".join(statement.lower().split())
        if sql.startswith("select") and " from messages " in sql:
            selects.append(sql)

    engine = sessions.kw["bind"]
    event.listen(engine, "before_cursor_execute", capture_reads)
    try:
        next_identity, _ = initialize(records, mode, entity_type, annotation_replies, conversation)
    finally:
        event.remove(engine, "before_cursor_execute", capture_reads)

    assert next_identity.conversation_id == identity.conversation_id
    assert next_identity.message_id != identity.message_id
    # Refreshing the newly inserted row is bounded; selecting a conversation's history is not.
    assert all("where messages.id =" in sql for sql in selects), selects
    assert engine.pool.checkedout() == 0


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
    message_store,
    annotation_replies,
    monkeypatch,
    mode,
    entity_type,
):
    sessions, records = message_store
    identity, pipeline = initialize(records, mode, entity_type, annotation_replies)
    engine = sessions.kw["bind"]
    assert engine.pool.checkedout() == 0
    app, conversation, message = records.load(
        tenant_id=identity.tenant_id,
        app_id=identity.app_id,
        conversation_id=identity.conversation_id,
        message_id=identity.message_id,
    )
    assert (app.id, conversation.mode, message.query) == ("app-id", mode, "hello")
    assert engine.pool.checkedout() == 0
    pipeline._task_state.llm_result.message = AssistantPromptMessage(content="answer")
    pipeline._task_state.llm_result.usage = LLMUsage.from_metadata({"prompt_tokens": 2, "completion_tokens": 3})
    observed = []

    def completed(saved, **_kwargs):
        assert engine.pool.checkedout() == 0
        with sessions() as session:
            committed = session.get(Message, saved.id)
            assert (committed.answer, committed.message_tokens, committed.answer_tokens) == ("answer", 2, 3)
        observed.append(saved.id)

    monkeypatch.setattr(message_pipeline.message_was_created, "send", completed)
    pipeline._save_message()
    assert observed == [identity.message_id]
    assert pipeline._message_end_to_stream_response().files == []
    assert engine.pool.checkedout() == 0
    with sessions() as session:
        assert len(session.scalars(select(Conversation)).all()) == 1
        assert len(session.scalars(select(Message)).all()) == 1


def test_error_event_updates_the_same_injected_message(message_store, annotation_replies):
    sessions, records = message_store
    identity, pipeline = initialize(records, AppMode.CHAT, ChatAppGenerateEntity, annotation_replies)
    responses = list(pipeline._process_stream_response(publisher=None))
    assert len(responses) == 1
    with sessions() as session:
        message = session.get(Message, identity.message_id)
        assert message.status == MessageStatus.ERROR
        assert message.error == "generation failed"
    assert sessions.kw["bind"].pool.checkedout() == 0


@pytest.mark.parametrize("usage_arrives_first", [True, False])
def test_stop_and_backend_usage_preserve_each_others_fields(message_store, annotation_replies, usage_arrives_first):
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
        assert (message.answer, message.message_tokens, message.answer_tokens) == ("partial answer", 7, 11)
        assert json.loads(message.message_metadata)["usage"]["prompt_tokens"] == 7
        assert json.loads(message.message_metadata)["annotation_reply"] == {"id": "annotation"}


@pytest.mark.parametrize(
    "invalid_owner",
    [
        {"tenant_id": "another-tenant"},
        {"app_id": "another-app"},
        {"conversation_id": "another-conversation"},
    ],
)
def test_message_write_revalidates_complete_owner_chain(message_store, annotation_replies, invalid_owner):
    _, records = message_store
    identity, _ = initialize(records, AppMode.CHAT, ChatAppGenerateEntity, annotation_replies)
    with pytest.raises(MessageNotExistsError):
        records.save_usage(replace(identity, **invalid_owner), LLMUsage.empty_usage())


def test_multimodal_output_releases_connection_before_file_io_and_publishes_committed_file(
    message_store,
    annotation_replies,
    monkeypatch,
):
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
    observed = []

    class Files:
        def create_file_by_url(self, **_kwargs):
            assert engine.pool.checkedout() == 0
            return tool_file

    class Events:
        invoke_from = InvokeFrom.WEB_APP

        def publish(self, event, _source):
            assert engine.pool.checkedout() == 0
            if isinstance(event, QueueMessageFileEvent):
                with sessions() as session:
                    record = session.get(MessageFile, event.message_file_id)
                    assert (record.message_id, record.upload_file_id) == (identity.message_id, tool_file.id)
                observed.append(event.message_file_id)

    def stream():
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
        Events(),
        False,
        message_id=identity.message_id,
        user_id="user",
        tenant_id=identity.tenant_id,
    )
    assert len(observed) == 1
