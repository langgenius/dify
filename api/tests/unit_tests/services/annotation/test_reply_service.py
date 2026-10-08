from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from decimal import Decimal
from typing import Literal, Protocol, cast

import pytest
from sqlalchemy import Table, create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.app.entities.queue_entities import QueueAnnotationReplyEvent, QueueStopEvent
from core.rag.models.document import Document
from models.annotation_reply import AnnotationReply
from models.base import TypeBase
from models.dataset import Dataset, DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from models.vector import VectorConfiguration
from repositories.annotation.reply_repository import AnnotationReplyRepository
from services.annotation import retrieval_gateway
from services.annotation.reply_service import AnnotationReplyService
from services.annotation.retrieval_gateway import AnnotationVectorRetrieval
from tests.unit_tests.core.app.apps.advanced_chat.test_app_runner_input_moderation import (
    build_runner as _runner_fixture,
)
from tests.unit_tests.model_factories import make_app, make_message

build_runner = _runner_fixture


class ConfigOverrides(Protocol):
    def __call__(self, **values: object) -> None: ...


@dataclass(frozen=True)
class AnnotationStore:
    engine: Engine
    pool: QueuePool
    sessions: sessionmaker[Session]


type OwnershipChange = Literal["disable", "foreign_annotation", "foreign_message", "binding"]


@pytest.fixture
def annotation_store(config_overrides: ConfigOverrides) -> Iterator[AnnotationStore]:
    config_overrides(VECTOR_STORE="qdrant")
    # The injected store is deliberately separate from the globally configured test database.
    engine = create_engine("sqlite://", poolclass=QueuePool)
    tables = [
        cast(Table, model.__table__)
        for model in (
            App,
            Message,
            AppAnnotationSetting,
            DatasetCollectionBinding,
            MessageAnnotation,
            AppAnnotationHitHistory,
        )
    ]
    TypeBase.metadata.create_all(
        engine,
        tables=tables,
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
                    message_unit_price=Decimal(0),
                    answer_unit_price=Decimal(0),
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
    yield AnnotationStore(engine=engine, pool=cast(QueuePool, engine.pool), sessions=sessions)
    engine.dispose()


def query(service: AnnotationReplyService) -> AnnotationReply | None:
    return service.query(
        tenant_id="tenant-1",
        app_id="app-1",
        message_id="msg-1",
        query="hi",
        user_id="user",
        from_source=ConversationFromSource.API,
    )


def _noop() -> None:
    pass


def install_vector(
    monkeypatch: pytest.MonkeyPatch,
    store: AnnotationStore,
    *,
    before_search: Callable[[], None] = _noop,
) -> AnnotationReplyService:
    pool = store.pool

    class Vector:
        def __init__(
            self,
            dataset: Dataset,
            *,
            attributes: list[str],
            session: Session | None,
            configuration: VectorConfiguration,
        ) -> None:
            assert dataset.tenant_id == "tenant-1"
            assert session is None
            assert pool.checkedout() == 0
            assert configuration.collection_name == "annotations"
            assert attributes == ["doc_id", "annotation_id", "app_id"]

        def search_by_vector(
            self, *, query: str, top_k: int, score_threshold: float, filter: dict[str, list[str]]
        ) -> list[Document]:
            assert pool.checkedout() == 0
            assert (query, top_k, score_threshold, filter) == ("hi", 1, 0.5, {"group_id": ["app-1"]})
            before_search()
            return [Document(page_content="question", metadata={"annotation_id": "annotation-1", "score": 0.8})]

    monkeypatch.setattr(retrieval_gateway, "Vector", Vector)
    return AnnotationReplyService(AnnotationReplyRepository(store.sessions), AnnotationVectorRetrieval())


@pytest.mark.parametrize("source", list(ConversationFromSource))
def test_search_releases_connection_and_commits_hit(
    annotation_store: AnnotationStore,
    monkeypatch: pytest.MonkeyPatch,
    source: ConversationFromSource,
) -> None:
    service = install_vector(monkeypatch, annotation_store)
    reply = service.query(
        tenant_id="tenant-1", app_id="app-1", message_id="msg-1", query="hi", user_id="user", from_source=source
    )
    assert reply is not None
    assert reply.content == "answer"
    with annotation_store.sessions() as session:
        annotation = session.get(MessageAnnotation, reply.id)
        assert annotation is not None
        assert annotation.hit_count == 1
        hit = session.scalar(select(AppAnnotationHitHistory))
        assert hit is not None
        assert (hit.annotation_id, hit.message_id, hit.source) == (reply.id, "msg-1", source)


@pytest.mark.parametrize("change", ["disable", "foreign_annotation", "foreign_message", "binding"])
def test_revalidates_after_remote_search(
    annotation_store: AnnotationStore,
    monkeypatch: pytest.MonkeyPatch,
    change: OwnershipChange,
) -> None:
    def change_owner() -> None:
        with annotation_store.sessions.begin() as session:
            if change == "disable":
                setting = session.get(AppAnnotationSetting, "setting-1")
                assert setting is not None
                session.delete(setting)
            elif change == "binding":
                setting = session.get(AppAnnotationSetting, "setting-1")
                assert setting is not None
                setting.collection_binding_id = "replacement"
            elif change == "foreign_annotation":
                annotation = session.get(MessageAnnotation, "annotation-1")
                assert annotation is not None
                annotation.app_id = "foreign"
            else:
                message = session.get(Message, "msg-1")
                assert message is not None
                message.app_id = "foreign"

    service = install_vector(monkeypatch, annotation_store, before_search=change_owner)
    assert query(service) is None
    with annotation_store.sessions() as session:
        assert session.scalar(select(AppAnnotationHitHistory)) is None


def test_retrieval_failure_does_not_leave_a_transaction(
    annotation_store: AnnotationStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fail() -> None:
        raise RuntimeError("embedding unavailable")

    service = install_vector(monkeypatch, annotation_store, before_search=fail)
    assert query(service) is None
    assert annotation_store.pool.checkedout() == 0
    with annotation_store.sessions() as session:
        annotation = session.get(MessageAnnotation, "annotation-1")
        assert annotation is not None
        assert annotation.hit_count == 0


def test_history_failure_rolls_back_hit_count(
    annotation_store: AnnotationStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    engine = annotation_store.engine

    def fail(
        _conn: object,
        _cursor: object,
        statement: str,
        _params: object,
        _context: object,
        _many: bool,
    ) -> None:
        if statement.startswith("INSERT INTO app_annotation_hit_histories"):
            raise RuntimeError("history write failed")

    service = install_vector(monkeypatch, annotation_store)
    event.listen(engine, "before_cursor_execute", fail)
    try:
        assert query(service) is None
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    with annotation_store.sessions() as session:
        annotation = session.get(MessageAnnotation, "annotation-1")
        assert annotation is not None
        assert annotation.hit_count == 0
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
