from collections.abc import Iterator, Mapping, Sequence
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from unittest.mock import create_autospec, patch

import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection
from sqlalchemy.orm import Session, sessionmaker

from core.credit_usage import CreditUsageCreatedBy
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.model_context import get_credit_usage_metadata
from core.model_manager import ModelManager
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.index_processor.index_processor_base import SummaryIndexSettingDict
from core.rag.index_processor.processor.paragraph_index_processor import ParagraphIndexProcessor
from core.rag.models.document import ChildDocument
from core.rag.models.document import Document as IndexDocument
from extensions.storage.storage_type import StorageType
from graphon.model_runtime.entities.llm_entities import LLMResult, LLMUsage
from graphon.model_runtime.entities.message_entities import AssistantPromptMessage
from libs.helper import generate_text_hash
from libs.pagination import PaginatedResult
from machinery.context import RequestContext
from models.dataset import ChildChunk, Dataset, Document, DocumentSegment
from models.enums import CreatorUserRole, DocumentCreatedFrom, SegmentStatus, SummaryStatus
from models.model import UploadFile
from repositories.knowledge.dataset_repository import SQLAlchemyDatasetRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from repositories.workspace_member_query_repository import WorkspaceMemberQueryRepository
from services.entities.knowledge_entities.segments import ChildChunkUpdateArgs
from services.knowledge.dataset_access import DatasetAccessService
from services.knowledge.resource_scope import DatasetRef
from services.knowledge.segments.adapters import (
    CelerySegmentBatchImportDispatcher,
    ModelManagerSegmentGuard,
    RedisSegmentIndexingState,
)
from services.knowledge.segments.application import (
    DatasetSegmentApplicationService,
    SegmentBatchImportDispatcher,
    SegmentDatasetRecord,
    SegmentIndex,
    SegmentIndexingState,
    SegmentListFilter,
    SegmentModelGuard,
    SegmentModelProviderError,
)


@dataclass
class SegmentLimitsStub:
    SINGLE_CHUNK_ATTACHMENT_LIMIT: int = 10


def _dataset(dataset_id: str, workspace_id: str, *, permission: str = "partial_members") -> Dataset:
    return Dataset(
        id=dataset_id,
        tenant_id=workspace_id,
        name="Dataset",
        description="",
        provider="vendor",
        permission=permission,
        indexing_technique="economy",
        created_by="account-1",
        maintainer="maintainer-1",
    )


def _document(document_id: str, workspace_id: str, dataset_id: str) -> Document:
    return Document(
        id=document_id,
        tenant_id=workspace_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type="upload_file",
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by="account-1",
        doc_form="text_model",
        word_count=0,
    )


def _segment(segment_id: str, workspace_id: str, dataset_id: str, document_id: str) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=workspace_id,
        dataset_id=dataset_id,
        document_id=document_id,
        position=1,
        content="content",
        word_count=7,
        tokens=2,
        created_by="account-1",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = segment_id
    return segment


def _upload(file_id: str, workspace_id: str, name: str) -> UploadFile:
    upload = UploadFile(
        tenant_id=workspace_id,
        storage_type=StorageType.OPENDAL,
        key=f"key-{file_id}",
        name=name,
        size=1,
        extension="csv",
        mime_type="text/csv",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="account-1",
        created_at=datetime(2026, 1, 1),
        used=False,
    )
    upload.id = file_id
    return upload


def test_scope_lookup_enforces_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))

    store = SQLAlchemyDatasetRepository(session_factory=sqlite_session_factory)
    scope = store.get_segment_scope(
        dataset_ref=DatasetRef("workspace-1", "dataset-1"),
        document_id="document-1",
        actor_id="account-1",
    )

    assert scope.dataset is not None
    assert scope.document is not None
    assert (
        store.get_segment_scope(
            dataset_ref=DatasetRef("workspace-2", "dataset-1"),
            document_id="document-1",
            actor_id="account-1",
        ).dataset
        is None
    )


def test_upload_lookup_is_tenant_scoped(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _upload("file-1", "workspace-1", "one.csv"),
                _upload("file-2", "workspace-2", "two.csv"),
            ]
        )

    store = SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory)

    assert store.get_file_name(workspace_id="workspace-1", upload_file_id="file-1") == "one.csv"
    assert store.get_file_name(workspace_id="workspace-1", upload_file_id="file-2") is None


def test_segment_lookup_rejects_segment_from_another_owner_chain(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _dataset("dataset-1", "workspace-1"),
                _dataset("dataset-2", "workspace-2"),
                _document("document-1", "workspace-1", "dataset-1"),
                _document("document-2", "workspace-2", "dataset-2"),
                _segment("segment-1", "workspace-2", "dataset-2", "document-2"),
            ]
        )

    store = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    assert store.get_segment(DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-2")) is None


def test_empty_segment_list_returns_materialized_page(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))

    store = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    with patch("repositories.knowledge.segment_repository.dify_config") as config:
        config.SQLALCHEMY_DATABASE_URI_SCHEME = "mysql"
        result = store.list_segments(
            DatasetRef("workspace-1", "dataset-1").document("document-1"),
            SegmentListFilter(page=1, limit=20, keyword="missing"),
        )

    assert result.items == ()
    assert result.total == 0
    assert result.limit == 20


def test_postgresql_keyword_filter_keeps_json_array_guard(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))

    page = PaginatedResult[DocumentSegment](items=[], total=0, page=1, per_page=20)
    store = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    with (
        patch("repositories.knowledge.segment_repository.dify_config") as config,
        patch("repositories.knowledge.segment_repository.paginate_query", return_value=page) as paginate,
    ):
        config.SQLALCHEMY_DATABASE_URI_SCHEME = "postgresql"
        store.list_segments(
            DatasetRef("workspace-1", "dataset-1").document("document-1"),
            SegmentListFilter(keyword="知识"),
        )

    statement = paginate.call_args.args[0]
    sql = str(statement.compile(dialect=postgresql.dialect()))
    assert "jsonb_typeof" in sql
    assert "jsonb_array_elements_text" in sql
    assert "CASE WHEN" in sql


def _application(
    factory: sessionmaker[Session], *, indexing: SegmentIndex | None = None
) -> DatasetSegmentApplicationService:
    datasets = SQLAlchemyDatasetRepository(session_factory=factory)
    index = create_autospec(SegmentIndex, instance=True, spec_set=True)
    index.count_tokens.return_value = 0
    state = create_autospec(SegmentIndexingState, instance=True, spec_set=True)
    state.is_segment_indexing.return_value = False
    state.is_document_indexing.return_value = False
    return DatasetSegmentApplicationService(
        dataset_access=DatasetAccessService(
            datasets=datasets,
            workspace_roles=WorkspaceMemberQueryRepository(session_factory=factory),
            legacy_permissions_enabled=False,
        ),
        scopes=datasets,
        store=SQLAlchemySegmentRepository(session_factory=factory),
        limits=SegmentLimitsStub(),
        text_hash=generate_text_hash,
        index=indexing or index,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=factory),
        model_guard=create_autospec(SegmentModelGuard, instance=True, spec_set=True),
        indexing_state=state,
        batch_dispatcher=create_autospec(SegmentBatchImportDispatcher, instance=True, spec_set=True),
        job_id_factory=lambda: "job-1",
    )


def test_mutations_use_request_actor_without_a_flask_request(
    sqlite_session_factory: sessionmaker[Session],
) -> None:

    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    app = _application(sqlite_session_factory)
    context = RequestContext("request-1", None, "author-1", "workspace-1")
    created = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "original"}
    )
    assert created.data.created_by == "author-1"
    updated = app.update_segment(
        RequestContext("request-2", None, "editor-2", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "updated content"},
    )
    assert updated.data.updated_by == "editor-2"
    assert updated.data.content == "updated content"
    assert isinstance(updated.data.created_at, datetime)
    with sqlite_session_factory() as session:
        segment = session.get(DocumentSegment, created.data.id)
        assert segment is not None
        assert segment.created_by == "author-1"
        assert segment.updated_by == "editor-2"
        assert segment.status == SegmentStatus.COMPLETED


def test_list_reads_dataset_and_document_once(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    statements: list[str] = []
    engine = sqlite_session_factory.kw["bind"]

    def record(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        page = _application(sqlite_session_factory).list_segments(
            RequestContext("request-1", None, "account-1", "workspace-1"),
            dataset_id="dataset-1",
            document_id="document-1",
            query=SegmentListFilter(),
        )
    finally:
        event.remove(engine, "before_cursor_execute", record)
    assert page.items == ()
    assert sum("FROM datasets" in statement for statement in statements) == 1
    assert sum("JOIN documents" in statement or "FROM documents" in statement for statement in statements) == 1


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (LLMBadRequestError(), "bad_request"),
        (ProviderTokenNotInitError("token missing"), "token"),
    ],
)
def test_model_guard_translates_provider_errors(error: Exception, kind: str) -> None:
    from core.model_manager import ModelManager

    model = create_autospec(ModelManager, instance=True, spec_set=True)
    model.get_model_instance.side_effect = error
    dataset = SegmentDatasetRecord(
        id="dataset-1",
        workspace_id="workspace-1",
        indexing_technique="high_quality",
        embedding_model_provider="provider",
        embedding_model="model",
    )

    with patch("services.knowledge.segments.adapters.ModelManager.for_tenant", return_value=model):
        with pytest.raises(SegmentModelProviderError) as raised:
            ModelManagerSegmentGuard().check(dataset)

    assert raised.value.kind == kind


def test_redis_state_uses_existing_keys_and_decodes_status() -> None:
    from services.knowledge.segments.adapters import RedisSegmentClient

    redis = create_autospec(RedisSegmentClient, instance=True, spec_set=True)
    redis.get.side_effect = [b"running", b"completed"]
    state = RedisSegmentIndexingState(redis)

    assert state.is_document_indexing("document-1") is True
    state.set_batch_waiting("job-1")
    assert state.get_batch_status("job-1") == "completed"
    redis.get.assert_any_call("document_document-1_indexing")
    redis.setnx.assert_called_once_with("segment_batch_import_job-1", "waiting")


def test_celery_dispatcher_preserves_task_argument_order() -> None:
    calls: list[tuple[str, ...]] = []

    def delay(*args: str) -> None:
        calls.append(args)

    dispatcher = CelerySegmentBatchImportDispatcher(delay=delay)

    dispatcher.dispatch(
        job_id="job-1",
        upload_file_id="file-1",
        dataset_id="dataset-1",
        document_id="document-1",
        workspace_id="workspace-1",
        actor_id="account-1",
    )

    assert calls == [("job-1", "file-1", "dataset-1", "document-1", "workspace-1", "account-1")]


def test_child_chunk_mutations_preserve_explicit_actors(
    sqlite_session_factory: sessionmaker[Session],
) -> None:

    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        document = _document("document-1", "workspace-1", "dataset-1")
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        session.add(document)
        session.add(_segment("segment-1", "workspace-1", "dataset-1", "document-1"))
    app = _application(sqlite_session_factory)
    created = app.create_child_chunk(
        RequestContext("create", None, "creator", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        content="first",
    )
    app.update_child_chunk(
        RequestContext("update", None, "editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        child_chunk_id=created.id,
        content="second",
    )
    with sqlite_session_factory() as session:
        chunk = session.get(ChildChunk, created.id)
        assert chunk is not None
        assert chunk.created_by == "creator"
        assert chunk.updated_by == "editor"
    results = app.update_child_chunks(
        RequestContext("batch", None, "batch-editor", "workspace-1"),
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id="segment-1",
        chunks=[ChildChunkUpdateArgs(id=created.id, content="third"), ChildChunkUpdateArgs(content="new child")],
    )
    with sqlite_session_factory() as session:
        chunks = [session.get(ChildChunk, result.id) for result in results]
        assert len(chunks) == 2
        existing, added = chunks
        assert existing is not None
        assert added is not None
        assert existing.updated_by == "batch-editor"
        assert added.created_by == "batch-editor"


@dataclass
class IndexRedisStub:
    def get(self, name: str | bytes) -> None:
        del name

    def setnx(self, name: str | bytes, value: object) -> bool:
        del name, value
        return True

    def setex(self, name: str, time: int, value: object) -> bool:
        del name, time, value
        return True

    def lock(self, name: str, timeout: int) -> nullcontext[None]:
        del name, timeout
        return nullcontext()


@dataclass
class VectorProbe:
    active_transactions: set[Connection]
    fail: bool = False
    writes: int = 0
    deleted_ids: list[str] = field(default_factory=list)
    tasks: list[tuple[str, tuple[object, ...]]] = field(default_factory=list)

    def add_texts(self, documents: Sequence[IndexDocument], **_kwargs: object) -> None:
        assert not self.active_transactions, "Index I/O must not hold a DB transaction"
        self.writes += len(documents)
        if self.fail:
            raise RuntimeError("index unavailable")

    def create(self, documents: Sequence[IndexDocument], **kwargs: object) -> None:
        self.add_texts(documents, **kwargs)

    def delete_by_ids(self, ids: Sequence[str]) -> None:
        assert ids
        assert not self.active_transactions
        if self.fail:
            raise RuntimeError("index unavailable")
        self.deleted_ids.extend(ids)

    def create_multimodal(self, documents: Sequence[IndexDocument], **kwargs: object) -> None:
        assert not self.active_transactions
        assert kwargs["upload_files"]
        self.add_texts(documents)


type IndexingProbe = tuple[DatasetSegmentApplicationService, SQLAlchemySegmentRepository, VectorProbe]


@pytest.fixture
def indexing_probe(
    sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> Iterator[IndexingProbe]:
    from services.knowledge.segments import indexing as indexing_module

    with sqlite_session_factory.begin() as session:
        dataset = _dataset("dataset-1", "workspace-1")
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.index_struct = '{"type": "qdrant"}'
        session.add(dataset)
        session.add(_document("document-1", "workspace-1", "dataset-1"))
    engine = sqlite_session_factory.kw["bind"]
    active: set[Connection] = set()
    begin = active.add
    finish = active.discard
    event.listen(engine, "begin", begin)
    event.listen(engine, "commit", finish)
    event.listen(engine, "rollback", finish)
    probe = VectorProbe(active)

    def vector(dataset: Dataset, *, session: Session | None, vector_type: str) -> VectorProbe:
        assert dataset.tenant_id == "workspace-1"
        assert session is None
        assert vector_type == "qdrant"
        assert not active
        return probe

    class TokenModel:
        def get_text_embedding_num_tokens(self, texts: Sequence[str]) -> list[int]:
            assert not active
            return [len(text) for text in texts]

    class ModelLookup:
        def get_model_instance(self, **kwargs: object) -> TokenModel:
            assert kwargs["tenant_id"] == "workspace-1"
            assert not active
            return TokenModel()

    monkeypatch.setattr(indexing_module, "Vector", vector)
    monkeypatch.setattr(indexing_module.ModelManager, "for_tenant", lambda **_kwargs: ModelLookup())
    repository = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)

    def dispatch(kind: str, *args: object) -> None:
        assert not active
        probe.tasks.append((kind, args))

    gateway = indexing_module.SegmentIndexingGateway(
        segments=repository,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
        redis=IndexRedisStub(),
        new_session=sqlite_session_factory,
        delete_task=lambda *args: dispatch("delete", *args),
        enable_task=lambda *args: dispatch("enable", *args),
        disable_task=lambda *args: dispatch("disable", *args),
    )
    yield _application(sqlite_session_factory, indexing=gateway), repository, probe
    event.remove(engine, "begin", begin)
    event.remove(engine, "commit", finish)
    event.remove(engine, "rollback", finish)


def test_segment_indexing_and_summary_use_closed_read_sessions(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    from models.dataset import DocumentSegmentSummary

    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = app.create_segment(context, dataset_id="dataset-1", document_id="document-1", values={"content": "first"})
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "second", "summary": "manual summary"},
    )
    assert updated.data.status == "completed"
    assert updated.data.summary == "manual summary"
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.status == "completed"
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == len("second")
    assert probe.writes >= 3
    probe.fail = True
    failed = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "failed change"},
    )
    assert failed.data.status == "error"
    assert failed.data.enabled is False
    assert failed.data.error == "index unavailable"


@pytest.mark.parametrize("operation", ["create", "update", "replace", "delete"])
def test_child_index_failure_leaves_database_unchanged(indexing_probe: IndexingProbe, operation: str) -> None:
    from services.knowledge.segments.application import (
        ChildChunkDeleteIndexApplicationError,
        ChildChunkIndexingApplicationError,
    )

    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    parent = app.create_segment(context, dataset_id="dataset-1", document_id="document-1", values={"content": "parent"})
    args = {"dataset_id": "dataset-1", "document_id": "document-1", "segment_id": parent.data.id}
    child = app.create_child_chunk(context, **args, content="original")
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(parent.data.id)
    before = repository.get_children(ref)
    probe.fail = True

    def mutate() -> None:
        match operation:
            case "create":
                app.create_child_chunk(context, **args, content="new")
            case "update":
                app.update_child_chunk(context, **args, child_chunk_id=child.id, content="changed")
            case "replace":
                app.update_child_chunks(context, **args, chunks=[ChildChunkUpdateArgs(content="replacement")])
            case "delete":
                app.delete_child_chunk(context, **args, child_chunk_id=child.id)

    with pytest.raises((ChildChunkIndexingApplicationError, ChildChunkDeleteIndexApplicationError)):
        mutate()
    assert repository.get_children(ref) == before


def test_upload_batch_uses_one_scoped_query(sqlite_session_factory: sessionmaker[Session]) -> None:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [
                _upload("file-1", "workspace-1", "one.csv"),
                _upload("file-2", "workspace-1", "two.csv"),
                _upload("foreign", "workspace-2", "foreign.csv"),
            ]
        )
    engine = sqlite_session_factory.kw["bind"]
    statements = []

    def record_sql(_conn, _cursor, statement: str, _parameters, _context, _executemany) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record_sql)
    try:
        uploads = SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory).get_by_ids(
            workspace_id="workspace-1", file_ids=("file-2", "file-1", "foreign", "missing")
        )
    finally:
        event.remove(engine, "before_cursor_execute", record_sql)
    assert set(uploads) == {"file-1", "file-2"}
    assert len(statements) == 1


def test_child_query_escapes_wildcards_and_enforces_complete_scope(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    from services.knowledge.segments.application import ChildChunkListFilter

    with sqlite_session_factory.begin() as session:
        session.add(_dataset("dataset-1", "workspace-1"))
        session.add(_document("document-1", "workspace-1", "dataset-1"))
        session.add(_segment("segment-1", "workspace-1", "dataset-1", "document-1"))
        for position, (workspace, text) in enumerate(
            [("workspace-1", "50%_literal"), ("workspace-1", "5000literal"), ("workspace-2", "50%_literal")], start=1
        ):
            session.add(
                ChildChunk(
                    tenant_id=workspace,
                    dataset_id="dataset-1",
                    document_id="document-1",
                    segment_id="segment-1",
                    position=position,
                    content=text,
                    word_count=len(text),
                    created_by="author",
                )
            )
    repo = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    page = repo.list_child_chunks(
        DatasetRef("workspace-1", "dataset-1").document("document-1").segment("segment-1"),
        ChildChunkListFilter(keyword="%_", limit=1),
    )
    assert page is not None
    assert page.total == 1
    assert [child.content for child in page.items] == ["50%_literal"]


def test_batch_status_and_delete_only_modify_scoped_segments(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session]
) -> None:
    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    first = app.create_segment(context, dataset_id="dataset-1", document_id="document-1", values={"content": "first"})
    second = app.create_segment(context, dataset_id="dataset-1", document_id="document-1", values={"content": "second"})
    with sqlite_session_factory.begin() as session:
        session.add(_segment("foreign", "workspace-2", "dataset-1", "document-1"))
    args = {
        "dataset_id": "dataset-1",
        "document_id": "document-1",
        "segment_ids": [first.data.id, second.data.id, "foreign"],
    }
    app.change_segment_status(context, **args, action="disable")
    kind, task_args = probe.tasks[-1]
    assert kind == "disable"
    assert isinstance(task_args[0], list)
    assert set(task_args[0]) == {first.data.id, second.data.id}
    assert task_args[1:] == ("dataset-1", "document-1")
    with sqlite_session_factory() as session:
        first_row = session.get(DocumentSegment, first.data.id)
        assert first_row is not None
        assert first_row.enabled is False
        foreign_row = session.get(DocumentSegment, "foreign")
        assert foreign_row is not None
        assert foreign_row.enabled is True
    app.delete_segments(context, **args)
    with sqlite_session_factory() as session:
        assert session.get(DocumentSegment, first.data.id) is None
        assert session.get(DocumentSegment, second.data.id) is None
        assert session.get(DocumentSegment, "foreign") is not None
        document = session.get(Document, "document-1")
        assert document is not None
        assert document.word_count == 0


def test_child_regeneration_reuses_splitter_outside_transaction(
    indexing_probe: IndexingProbe, sqlite_session_factory: sessionmaker[Session], monkeypatch: pytest.MonkeyPatch
) -> None:
    import json

    from core.rag.index_processor.processor.parent_child_index_processor import ParentChildIndexProcessor
    from models.dataset import DatasetProcessRule
    from models.enums import ProcessRuleMode

    app, repository, probe = indexing_probe
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.embedding_model_provider = "provider"
        rule = DatasetProcessRule(
            dataset_id="dataset-1",
            mode=ProcessRuleMode.HIERARCHICAL,
            rules=json.dumps({"parent_mode": "full-doc", "subchunk_segmentation": {"max_tokens": 100}}),
            created_by="author",
        )
        session.add(rule)
        document = session.get(Document, "document-1")
        assert document is not None
        document.doc_form = IndexStructureType.PARENT_CHILD_INDEX
        document.dataset_process_rule_id = rule.id

    def split(_self, document: IndexDocument, _rule, _mode, _model) -> list[ChildDocument]:
        assert not probe.active_transactions
        return [
            ChildDocument(
                page_content=document.page_content, metadata={"doc_id": document.page_content, "doc_hash": "hash"}
            )
        ]

    monkeypatch.setattr(ParentChildIndexProcessor, "split_child_nodes", split)
    context = RequestContext("request", None, "author", "workspace-1")
    created = app.create_segment(context, dataset_id="dataset-1", document_id="document-1", values={"content": "first"})
    assert created.data.status == "completed"
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "second", "regenerate_child_chunks": True},
    )
    assert updated.data.status == "completed"
    ref = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    children = repository.get_children(ref)
    assert children is not None
    assert [child.data.content for child in children] == ["second"]


@pytest.mark.parametrize(
    ("content", "submitted_summary", "summary_enabled", "expected_summary", "generated"),
    [
        ("new text", "old summary", True, "new summary", True),
        ("new text", None, True, "new summary", True),
        ("old text", "old summary", True, "old summary", False),
        ("new text", "manual summary", True, "manual summary", False),
        ("new text", "", True, None, False),
        ("new text", " \n\t ", True, None, False),
        ("new text", "old summary", False, "old summary", False),
        ("new text", None, False, "old summary", False),
    ],
)
def test_summary_updates_preserve_generation_and_manual_edit_rules(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    content: str,
    submitted_summary: str | None,
    summary_enabled: bool,
    expected_summary: str | None,
    generated: bool,
) -> None:
    app, repository, _ = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "old text"}
    )
    reference = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    repository.save_summary(reference, "old summary")
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.summary_index_setting = {
            "enable": summary_enabled,
            "model_name": "llm-model",
            "model_provider_name": "provider",
        }
    calls: list[str] = []

    def generate(_tenant_id: str, text: str, _setting: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        calls.append(text)
        return "new summary", LLMUsage.empty_usage()

    monkeypatch.setattr(ParagraphIndexProcessor, "generate_summary_from_inputs", staticmethod(generate))
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": content, "summary": submitted_summary},
    )
    assert calls == ([content] if generated else [])
    assert updated.data.summary == expected_summary


def test_automatic_summary_keeps_knowledge_credit_attribution(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app, repository, _ = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "old text"}
    )
    reference = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    repository.save_summary(reference, "old summary")
    setting: SummaryIndexSettingDict = {"enable": True, "model_name": "llm-model", "model_provider_name": "provider"}
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.summary_index_setting = setting
    metadata: list[Mapping[str, object] | None] = []

    class ModelProbe:
        credentials: dict[str, str] = {}

        @property
        def model_type_instance(self) -> "ModelProbe":
            return self

        def get_model_schema(self, _name: str, _credentials: object) -> None:
            return None

        def get_text_embedding_num_tokens(self, texts: Sequence[str]) -> list[int]:
            return [len(text) for text in texts]

        def invoke_llm(self, **_kwargs: object) -> LLMResult:
            metadata.append(get_credit_usage_metadata())
            return LLMResult(
                model="llm-model", message=AssistantPromptMessage(content="new summary"), usage=LLMUsage.empty_usage()
            )

        def get_model_instance(self, **_kwargs: object) -> "ModelProbe":
            return self

    monkeypatch.setattr(ModelManager, "for_tenant", lambda **_kwargs: ModelProbe())
    # Both public summary entry points must preserve the credit-usage context.
    with sqlite_session_factory() as session:
        ParagraphIndexProcessor.generate_summary("workspace-1", "old text", setting, session=session)
    assert metadata.pop() == {"created_by": CreditUsageCreatedBy.KNOWLEDGE_INDEXING}
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "new text"},
    )
    assert updated.data.summary == "new summary"
    assert metadata == [{"created_by": CreditUsageCreatedBy.KNOWLEDGE_INDEXING}]
    assert get_credit_usage_metadata() is None


@pytest.mark.parametrize("storage_type", ["database", "file"])
def test_economy_index_shares_persistence_with_existing_keyword_calls(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    storage_type: str,
) -> None:
    from core.rag.datasource.keyword.jieba import jieba as jieba_module
    from core.rag.datasource.keyword.jieba import keyword_table as table_module
    from core.rag.datasource.keyword.keyword_factory import Keyword
    from tests.unit_tests.config_override import apply_config_overrides

    app, repository, probe = indexing_probe
    reads: list[str] = []
    writes: list[str] = []

    class FileStorageProbe:
        def load_once(self, key: str) -> bytes:
            assert not probe.active_transactions
            reads.append(key)
            return (tmp_path / key).read_bytes()

        def exists(self, key: str) -> bool:
            assert not probe.active_transactions
            return (tmp_path / key).exists()

        def save(self, key: str, data: bytes) -> None:
            assert not probe.active_transactions
            writes.append(key)
            path = tmp_path / key
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        def delete(self, key: str) -> None:
            assert not probe.active_transactions
            (tmp_path / key).unlink()

    class KeywordExtractor:
        def extract_keywords(self, text: str, _keyword_number: int = 10) -> set[str]:
            assert not probe.active_transactions
            return set(text.split())

    storage = FileStorageProbe()
    monkeypatch.setattr(table_module, "storage", storage)
    monkeypatch.setattr(jieba_module, "JiebaKeywordTableHandler", KeywordExtractor)
    apply_config_overrides(monkeypatch, KEYWORD_DATA_SOURCE_TYPE=storage_type)
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.indexing_technique = IndexTechniqueType.ECONOMY
    context = RequestContext("request", None, "author", "workspace-1")
    first = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "initial 中文"}
    )
    second = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "other", "keywords": ["manual"]}
    )
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=first.data.id,
        values={"content": "replacement"},
    )
    assert first.data.status == second.data.status == updated.data.status == "completed"
    assert first.data.index_node_id is not None
    assert second.data.index_node_id is not None
    assert set(first.data.keywords or ()) == {"initial", "中文"}
    assert second.data.keywords == ("manual",)
    assert updated.data.keywords == ("replacement",)
    dataset_ref = DatasetRef("workspace-1", "dataset-1")
    source_type, data = repository.get_keyword_table(dataset_ref)
    payload = table_module.load_keyword_table(
        tenant_id="workspace-1", dataset_id="dataset-1", storage_type=source_type, data=data
    )
    assert payload is not None
    assert payload["__data__"]["table"] == {
        "replacement": {first.data.index_node_id},
        "manual": {second.data.index_node_id},
    }
    if storage_type == "database":
        assert reads == writes == []
    else:
        assert writes == ["keyword_files/workspace-1/dataset-1.txt"] * 3

    # The existing session-taking API must consume the exact payload written by
    # the repository-backed path. Only that existing API retains caller sessions.
    class SessionFileStorage:
        def load_once(self, key: str) -> bytes:
            return (tmp_path / key).read_bytes()

        def exists(self, key: str) -> bool:
            return (tmp_path / key).exists()

        def save(self, key: str, data: bytes) -> None:
            (tmp_path / key).write_bytes(data)

        def delete(self, key: str) -> None:
            (tmp_path / key).unlink()

    monkeypatch.setattr(table_module, "storage", SessionFileStorage())
    monkeypatch.setattr(jieba_module, "redis_client", IndexRedisStub())
    with sqlite_session_factory() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        keyword = Keyword(dataset)
        assert keyword.text_exists(first.data.index_node_id, session=session)
        assert keyword.text_exists(second.data.index_node_id, session=session)
        keyword.delete_by_ids([first.data.index_node_id], session)
        session.commit()
    source_type, data = repository.get_keyword_table(dataset_ref)
    payload = table_module.load_keyword_table(
        tenant_id="workspace-1", dataset_id="dataset-1", storage_type=source_type, data=data
    )
    assert payload is not None
    assert payload["__data__"]["table"] == {"manual": {second.data.index_node_id}}


@pytest.mark.parametrize("generated_summary", [None, "", " \n\t "], ids=["exception", "empty", "whitespace"])
def test_summary_generation_failure_preserves_the_completed_segment(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    generated_summary: str | None,
) -> None:
    from models.dataset import DocumentSegmentSummary

    app, repository, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "original"}
    )
    reference = DatasetRef("workspace-1", "dataset-1").document("document-1").segment(created.data.id)
    repository.save_summary(reference, "original summary")
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.summary_index_setting = {"enable": True, "model_name": "model", "model_provider_name": "provider"}
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        summary.summary_index_node_id = "original-summary-node"

    def generate(*_args: object, **_kwargs: object) -> tuple[str, LLMUsage]:
        assert not probe.active_transactions
        if generated_summary is not None:
            return generated_summary, LLMUsage.empty_usage()
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(ParagraphIndexProcessor, "generate_summary_from_inputs", staticmethod(generate))
    updated = app.update_segment(
        context,
        dataset_id="dataset-1",
        document_id="document-1",
        segment_id=created.data.id,
        values={"content": "replacement", "summary": "original summary"},
    )
    assert updated.data.content == "replacement"
    assert updated.data.enabled is True
    assert updated.data.status == "completed"
    assert updated.data.summary == "original summary"
    assert "original-summary-node" not in probe.deleted_ids
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.status == "error"
        assert summary.summary_index_node_id == "original-summary-node"
        assert summary.error == ("Generated summary is empty" if generated_summary is not None else "LLM unavailable")


@pytest.mark.parametrize("failed_commits", [1, 2, 3])
def test_summary_commit_retries_use_fresh_sessions_and_persist_outcome(
    indexing_probe: IndexingProbe,
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
    failed_commits: int,
) -> None:
    from models.dataset import DocumentSegmentSummary
    from services import summary_index_service as summary_module

    app, _, probe = indexing_probe
    context = RequestContext("request", None, "author", "workspace-1")
    created = app.create_segment(
        context, dataset_id="dataset-1", document_id="document-1", values={"content": "original"}
    )
    attempts: list[Session] = []
    delays: list[float] = []

    def fail_summary_commit(session: Session) -> None:
        if any(
            isinstance(record, DocumentSegmentSummary) and record.status == SummaryStatus.COMPLETED
            for record in session.new | session.dirty
        ):
            attempts.append(session)
            if len(attempts) <= failed_commits:
                raise ConnectionError("connection lost before commit")

    def wait(seconds: float) -> None:
        assert not probe.active_transactions
        delays.append(seconds)

    monkeypatch.setattr(summary_module.time, "sleep", wait)
    event.listen(sqlite_session_factory.class_, "before_commit", fail_summary_commit)
    try:
        updated = app.update_segment(
            context,
            dataset_id="dataset-1",
            document_id="document-1",
            segment_id=created.data.id,
            values={"content": "original", "summary": "manual summary"},
        )
        assert updated.data.status == "completed"
        assert updated.data.enabled is True
        assert not probe.active_transactions
    finally:
        event.remove(sqlite_session_factory.class_, "before_commit", fail_summary_commit)
        for session in attempts:
            session.close()

    assert len(attempts) == min(failed_commits + 1, 3)
    assert len({id(session) for session in attempts}) == len(attempts)
    assert delays == [2.0, 4.0][: min(failed_commits, 2)]
    with sqlite_session_factory() as session:
        summary = session.scalar(select(DocumentSegmentSummary))
        assert summary is not None
        assert summary.summary_content == "manual summary"
        if failed_commits < 3:
            assert summary.status == SummaryStatus.COMPLETED
            assert summary.summary_index_node_id is not None
            assert summary.summary_index_node_hash is not None
            assert summary.error is None
        else:
            assert summary.status == SummaryStatus.ERROR
            assert summary.error == "Vectorization failed: connection lost before commit"
