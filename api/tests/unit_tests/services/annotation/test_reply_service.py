from dataclasses import replace

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueStopEvent
from core.rag.models.document import Document
from models.base import TypeBase
from models.dataset import DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from repositories.annotation.reply_repository import AnnotationReplyRepository
from services.annotation import retrieval_gateway
from services.annotation.reply_service import AnnotationReplyService
from services.annotation.retrieval_gateway import AnnotationVectorRetrieval
from tests.unit_tests.core.app.apps.advanced_chat.test_app_runner_input_moderation import (
    build_runner as _runner_fixture,
)
from tests.unit_tests.model_factories import make_app, make_message

build_runner = _runner_fixture


@pytest.fixture
def annotation_store(config_overrides):
    config_overrides(VECTOR_STORE="qdrant")
    # The injected store is deliberately separate from the globally configured test database.
    engine = create_engine("sqlite://", poolclass=QueuePool)
    TypeBase.metadata.create_all(
        engine,
        tables=[
            m.__table__
            for m in (
                App,
                Message,
                AppAnnotationSetting,
                DatasetCollectionBinding,
                MessageAnnotation,
                AppAnnotationHitHistory,
            )
        ],
    )
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions.begin() as session:
        session.add_all(
            [
                make_app(),
                make_message(
                    message_id="msg-1",
                    app_id="app-1",
                    inputs={},
                    query="hi",
                    message={},
                    answer="",
                    message_unit_price=0,
                    answer_unit_price=0,
                    currency="USD",
                    from_source=ConversationFromSource.API,
                ),
            ]
        )
        binding = DatasetCollectionBinding(
            provider_name="provider",
            model_name="model",
            type=CollectionBindingType.ANNOTATION,
            collection_name="annotations",
        )
        binding.id = "binding-1"
        setting = AppAnnotationSetting(
            app_id="app-1",
            collection_binding_id=binding.id,
            score_threshold=0.5,
            created_user_id="user",
            updated_user_id="user",
        )
        setting.id = "setting-1"
        annotation = MessageAnnotation(app_id="app-1", question="question", content="answer", account_id="user")
        annotation.id = "annotation-1"
        session.add_all([binding, setting, annotation])
    yield sessions
    engine.dispose()


def query(service, **kwargs):
    return service.query(
        tenant_id="tenant-1",
        app_id="app-1",
        message_id="msg-1",
        query="hi",
        user_id="user",
        from_source=ConversationFromSource.API,
        **kwargs,
    )


def install_vector(monkeypatch, sessions, *, before_search=lambda: None):
    engine = sessions.kw["bind"]

    class Vector:
        def __init__(self, dataset, *, attributes, session, configuration):
            assert dataset.tenant_id == "tenant-1"
            assert session is None
            assert engine.pool.checkedout() == 0
            assert configuration.collection_name == "annotations"
            assert attributes == ["doc_id", "annotation_id", "app_id"]

        def search_by_vector(self, **kwargs):
            assert engine.pool.checkedout() == 0
            assert kwargs == {"query": "hi", "top_k": 1, "score_threshold": 0.5, "filter": {"group_id": ["app-1"]}}
            before_search()
            return [Document(page_content="question", metadata={"annotation_id": "annotation-1", "score": 0.8})]

    monkeypatch.setattr(retrieval_gateway, "Vector", Vector)
    return AnnotationReplyService(AnnotationReplyRepository(sessions), AnnotationVectorRetrieval())


@pytest.mark.parametrize("source", list(ConversationFromSource))
def test_search_releases_connection_and_commits_hit(annotation_store, monkeypatch, source):
    service = install_vector(monkeypatch, annotation_store)
    reply = service.query(
        tenant_id="tenant-1", app_id="app-1", message_id="msg-1", query="hi", user_id="user", from_source=source
    )
    assert reply.content == "answer"
    with annotation_store() as session:
        assert session.get(MessageAnnotation, reply.id).hit_count == 1
        hit = session.scalar(select(AppAnnotationHitHistory))
        assert (hit.annotation_id, hit.message_id, hit.source) == (reply.id, "msg-1", source)


@pytest.mark.parametrize("change", ["disable", "foreign_annotation", "foreign_message", "binding"])
def test_revalidates_after_remote_search(annotation_store, monkeypatch, change):
    def change_owner():
        with annotation_store.begin() as session:
            if change == "disable":
                session.delete(session.get(AppAnnotationSetting, "setting-1"))
            elif change == "binding":
                session.get(AppAnnotationSetting, "setting-1").collection_binding_id = "replacement"
            elif change == "foreign_annotation":
                session.get(MessageAnnotation, "annotation-1").app_id = "foreign"
            else:
                session.get(Message, "msg-1").app_id = "foreign"

    service = install_vector(monkeypatch, annotation_store, before_search=change_owner)
    assert query(service) is None
    with annotation_store() as session:
        assert session.scalar(select(AppAnnotationHitHistory)) is None


def test_retrieval_failure_does_not_leave_a_transaction(annotation_store, monkeypatch):
    def fail():
        raise RuntimeError("embedding unavailable")

    service = install_vector(monkeypatch, annotation_store, before_search=fail)
    assert query(service) is None
    assert annotation_store.kw["bind"].pool.checkedout() == 0
    with annotation_store() as session:
        assert session.get(MessageAnnotation, "annotation-1").hit_count == 0


def test_history_failure_rolls_back_hit_count(annotation_store, monkeypatch):
    engine = annotation_store.kw["bind"]

    def fail(_conn, _cursor, statement, _params, _context, _many):
        if statement.startswith("INSERT INTO app_annotation_hit_histories"):
            raise RuntimeError("history write failed")

    service = install_vector(monkeypatch, annotation_store)
    event.listen(engine, "before_cursor_execute", fail)
    try:
        assert query(service) is None
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    with annotation_store() as session:
        assert session.get(MessageAnnotation, "annotation-1").hit_count == 0
        assert session.scalar(select(AppAnnotationHitHistory)) is None


def test_chatflow_runner_search_and_publish_are_outside_transaction(build_runner, annotation_store, monkeypatch):
    runner = build_runner
    runner._app.id = runner.application_generate_entity.app_config.app_id = "app-1"
    runner._app.tenant_id = runner.application_generate_entity.app_config.tenant_id = "tenant-1"
    runner.message.id = "msg-1"
    runner.application_generate_entity.query = "hi"
    runner._runtime = replace(runner._runtime, annotation_replies=install_vector(monkeypatch, annotation_store))
    monkeypatch.setattr(runner, "handle_input_moderation", lambda **_kwargs: (False, {}, "hi"))
    events = []

    def publish(item):
        assert annotation_store.kw["bind"].pool.checkedout() == 0
        with annotation_store() as session:
            assert session.scalar(select(AppAnnotationHitHistory)) is not None
        events.append(item)

    monkeypatch.setattr(runner._events, "_publish_event", publish)
    runner.run()
    assert isinstance(events[0], QueueAnnotationReplyEvent)
    assert isinstance(events[-1], QueueStopEvent)
