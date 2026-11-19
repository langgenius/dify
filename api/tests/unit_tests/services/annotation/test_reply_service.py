from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal, Protocol

import pytest
from sqlalchemy import Table, create_engine, event, select
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import QueuePool

from core.rag.index_processor.constant.index_type import IndexTechniqueType
from core.rag.models.document import Document
from models.annotation_reply import AnnotationMatch, AnnotationReply, AnnotationSearch
from models.base import TypeBase
from models.dataset import Dataset, DatasetCollectionBinding
from models.enums import CollectionBindingType, ConversationFromSource
from models.model import App, AppAnnotationHitHistory, AppAnnotationSetting, Message, MessageAnnotation
from models.vector import VectorConfiguration
from repositories.annotation.reply_repository import AnnotationReplyRepository
from services.annotation import retrieval_gateway
from services.annotation.reply_service import AnnotationReplyService
from services.annotation.retrieval_gateway import AnnotationVectorRetrieval
from tests.helpers.unit.model_factories import make_app, make_message


class ConfigOverrides(Protocol):
    def __call__(self, **values: object) -> None: ...


@dataclass(frozen=True)
class AnnotationStore:
    engine: Engine
    pool: QueuePool
    sessions: sessionmaker[Session]


@dataclass
class InMemoryAnnotationRecords:
    search_context: AnnotationSearch
    match: AnnotationMatch
    reply: AnnotationReply
    recorded: bool = False

    def prepare(self, *, tenant_id: str, app_id: str) -> AnnotationSearch:
        assert (tenant_id, app_id) == (self.search_context.tenant_id, self.search_context.app_id)
        return self.search_context

    def record_hit(
        self,
        search: AnnotationSearch,
        match: AnnotationMatch,
        *,
        message_id: str,
        query: str,
        user_id: str,
        from_source: ConversationFromSource,
    ) -> AnnotationReply:
        assert search == self.search_context
        assert match == self.match
        assert (message_id, query, user_id, from_source) == (
            "msg-1",
            "hi",
            "user",
            ConversationFromSource.API,
        )
        self.recorded = True
        return self.reply


@dataclass(frozen=True)
class InMemoryAnnotationRetrieval:
    search_context: AnnotationSearch
    match: AnnotationMatch

    def search(self, context: AnnotationSearch, query: str) -> AnnotationMatch:
        assert (context, query) == (self.search_context, "hi")
        return self.match


type OwnershipChange = Literal[
    "binding",
    "disable",
    "foreign_annotation",
    "foreign_message",
    "missing_annotation",
]


@pytest.fixture
def annotation_store(config_overrides: ConfigOverrides) -> Iterator[AnnotationStore]:
    config_overrides(VECTOR_STORE="qdrant")
    # The injected store is deliberately separate from the globally configured test database.
    engine = create_engine("sqlite://", poolclass=QueuePool)
    tables: list[Table] = []
    for model in (
        App,
        Message,
        AppAnnotationSetting,
        DatasetCollectionBinding,
        MessageAnnotation,
        AppAnnotationHitHistory,
    ):
        table = model.__table__
        assert isinstance(table, Table)
        tables.append(table)
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
    assert isinstance(engine.pool, QueuePool)
    yield AnnotationStore(engine=engine, pool=engine.pool, sessions=sessions)
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


def test_query_supports_persistence_neutral_ports() -> None:
    context = AnnotationSearch(
        tenant_id="tenant-1",
        app_id="app-1",
        embedding_model_provider="provider",
        embedding_model="model",
        collection_binding_id="binding-1",
        configuration=VectorConfiguration("qdrant", "annotations"),
        setting_id="setting-1",
        score_threshold=0.5,
    )
    match = AnnotationMatch(annotation_id="annotation-1", score=0.8)
    expected_reply = AnnotationReply(id="annotation-1", content="answer")
    records = InMemoryAnnotationRecords(context, match, expected_reply)
    service = AnnotationReplyService(records, InMemoryAnnotationRetrieval(context, match))

    assert query(service) == expected_reply
    assert records.recorded


def test_prepare_returns_persistence_neutral_search(annotation_store: AnnotationStore) -> None:
    repository = AnnotationReplyRepository(annotation_store.sessions)

    search = repository.prepare(tenant_id="tenant-1", app_id="app-1")

    assert search is not None
    assert search == AnnotationSearch(
        tenant_id="tenant-1",
        app_id="app-1",
        embedding_model_provider="provider",
        embedding_model="model",
        collection_binding_id="binding-1",
        configuration=VectorConfiguration("qdrant", "annotations"),
        setting_id="setting-1",
        score_threshold=0.5,
    )
    assert all(not isinstance(value, Dataset) for value in vars(search).values())


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
            assert (
                dataset.id,
                dataset.tenant_id,
                dataset.indexing_technique,
                dataset.embedding_model_provider,
                dataset.embedding_model,
                dataset.collection_binding_id,
            ) == (
                "app-1",
                "tenant-1",
                IndexTechniqueType.HIGH_QUALITY,
                "provider",
                "model",
                "binding-1",
            )
            assert session is None
            assert pool.checkedout() == 0
            assert configuration == VectorConfiguration("qdrant", "annotations")
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


def test_query_returns_none_when_annotation_setting_is_missing(
    annotation_store: AnnotationStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with annotation_store.sessions.begin() as session:
        setting = session.get(AppAnnotationSetting, "setting-1")
        assert setting is not None
        session.delete(setting)

    assert query(install_vector(monkeypatch, annotation_store)) is None


def test_query_returns_none_when_collection_binding_is_missing(
    annotation_store: AnnotationStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with annotation_store.sessions.begin() as session:
        binding = session.get(DatasetCollectionBinding, "binding-1")
        assert binding is not None
        session.delete(binding)

    assert query(install_vector(monkeypatch, annotation_store)) is None


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
        assert (hit.question, hit.annotation_question, hit.annotation_content, hit.score) == (
            "hi",
            "question",
            "answer",
            0.8,
        )


@pytest.mark.parametrize(
    "change",
    ["disable", "foreign_annotation", "foreign_message", "missing_annotation", "binding"],
)
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
            elif change == "missing_annotation":
                annotation = session.get(MessageAnnotation, "annotation-1")
                assert annotation is not None
                session.delete(annotation)
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
