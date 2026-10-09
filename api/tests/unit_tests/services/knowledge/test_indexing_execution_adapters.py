import json
import threading
from collections.abc import Generator, Iterator
from contextlib import contextmanager
from dataclasses import replace
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import Connection, Engine, event, inspect, select
from sqlalchemy.orm import Session, sessionmaker
from werkzeug.exceptions import NotFound

from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError, QuotaExceededError
from core.plugin.impl.exc import PluginDaemonClientSideError
from core.rag.datasource.vdb.vector_factory import Vector
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import AttachmentDocument, ChildDocument
from core.rag.models.document import Document as IndexDocument
from extensions.storage.storage_type import StorageType
from models.dataset import Dataset, DatasetKeywordTable, DatasetProcessRule, Document, DocumentSegment
from models.enums import CreatorUserRole, IndexingStatus, ProcessRuleMode, SegmentStatus
from models.model import UploadFile
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from repositories.knowledge.upload_file_repository import SQLAlchemyKnowledgeUploadRepository
from services.knowledge.indexing.adapters.execution import IndexingExecutionAdapter
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingDocument
from services.knowledge.resource_scope import DatasetRef
from tests.unit_tests.config_override import apply_config_overrides
from tests.unit_tests.repositories.knowledge.test_document_repository import _dataset, _document

MODULE = "services.knowledge.indexing.adapters.execution"


BackendFixture = tuple[
    IndexingExecutionAdapter,
    SQLAlchemyDocumentRepository,
    SQLAlchemySegmentRepository,
    MagicMock,
    IndexingDocument,
    MagicMock,
]


@pytest.fixture
def backend(sqlite_session_factory: sessionmaker[Session]) -> Iterator[BackendFixture]:
    with sqlite_session_factory.begin() as session:
        session.add_all(
            [_dataset("dataset-1", "workspace-1"), _document("document-1", status=IndexingStatus.SPLITTING)]
        )
    documents = SQLAlchemyDocumentRepository(session_factory=sqlite_session_factory)
    segments = SQLAlchemySegmentRepository(session_factory=sqlite_session_factory)
    sources = MagicMock()
    adapter = IndexingExecutionAdapter(
        session_factory=sqlite_session_factory,
        documents=documents,
        segments=segments,
        uploads=SQLAlchemyKnowledgeUploadRepository(session_factory=sqlite_session_factory),
        sources=sources,
    )
    job = replace(
        documents.get_indexing_document(DatasetRef("workspace-1", "dataset-1").document("document-1")),
        processing_rule={"mode": "automatic", "rules": {}},
    )
    with patch(f"{MODULE}.redis_client") as redis:
        redis.get.return_value = None
        yield adapter, documents, segments, sources, job, redis


@pytest.fixture
def active_transactions(sqlite_engine: Engine) -> Iterator[set[Connection]]:
    active: set[Connection] = set()
    begin, finish = active.add, active.discard
    event.listen(sqlite_engine, "begin", begin)
    event.listen(sqlite_engine, "commit", finish)
    event.listen(sqlite_engine, "rollback", finish)
    try:
        yield active
    finally:
        event.remove(sqlite_engine, "begin", begin)
        event.remove(sqlite_engine, "commit", finish)
        event.remove(sqlite_engine, "rollback", finish)


@pytest.mark.parametrize("doc_form", list(IndexStructureType))
def test_vector_io_releases_transactions_and_preserves_chunk_structure(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    active_transactions: set[Connection],
    monkeypatch: pytest.MonkeyPatch,
    doc_form: IndexStructureType,
) -> None:
    adapter, _, segments, _, job, _ = backend
    apply_config_overrides(monkeypatch, VECTOR_STORE="qdrant", VECTOR_STORE_WHITELIST_ENABLE=True)
    files = [
        UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
            key=f"image-{tenant_id}",
            name="image.png",
            size=1,
            extension="png",
            mime_type="image/png",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="account-1",
            created_at=datetime(2026, 1, 1),
            used=True,
        )
        for tenant_id in ("workspace-1", "workspace-2")
    ]
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        document = session.get(Document, "document-1")
        assert dataset is not None
        assert document is not None
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.is_multimodal = True
        document.doc_form = doc_form
        session.add_all(files)
    child = ChildDocument(page_content="child", metadata={"doc_id": "child-node", "doc_hash": "child-hash"})
    chunk = IndexDocument(
        page_content="parent",
        metadata={"doc_id": "node", "doc_hash": "hash"},
        children=[child] if doc_form == IndexStructureType.PARENT_CHILD_INDEX else None,
        attachments=[
            AttachmentDocument(page_content="image", metadata={"doc_id": file.id, "doc_type": "image"})
            for file in files
        ],
    )
    segments.save_for_indexing(job, [chunk], [5])
    vector_backend = MagicMock()
    vector_factory = MagicMock()
    vector_factory.return_value.init_vector.return_value = vector_backend

    def external_call(*_args, **_kwargs) -> list[list[float]]:
        assert not active_transactions, "Index I/O must not hold a database transaction"
        return [[1.0]]

    def get_vector_factory(vector_type: str) -> MagicMock:
        assert not active_transactions, "Vector initialization must follow the whitelist read transaction"
        assert vector_type == "qdrant"
        return vector_factory

    def load_image(key: str) -> bytes:
        assert not active_transactions
        assert key == files[0].key
        return b"image"

    vector_backend.create.side_effect = external_call
    with (
        patch.object(Vector, "get_vector_factory", side_effect=get_vector_factory),
        patch(
            "core.rag.datasource.vdb.vector_factory._LazyEmbeddings.embed_documents", side_effect=external_call
        ) as embed,
        patch(
            "core.rag.datasource.vdb.vector_factory._LazyEmbeddings.embed_multimodal_documents",
            side_effect=external_call,
        ) as embed_images,
        patch("core.rag.datasource.vdb.vector_factory.storage") as storage,
    ):
        storage.load_once.side_effect = load_image
        adapter._process_chunk(Flask(__name__), job.ref, [chunk], False)
    embed.assert_called_once_with(["child" if doc_form == IndexStructureType.PARENT_CHILD_INDEX else "parent"])
    assert embed_images.call_args.args[0] == [{"content": "aW1hZ2U=", "content_type": "image", "file_id": files[0].id}]
    storage.load_once.assert_called_once_with(files[0].key)
    assert vector_backend.create.call_count == 2
    indexed_text = vector_backend.create.call_args_list[0].kwargs["texts"][0]
    assert indexed_text.metadata["doc_id"] == (
        "child-node" if doc_form == IndexStructureType.PARENT_CHILD_INDEX else "node"
    )
    assert segments.resume_indexing(job) == ([], 5)


@pytest.mark.parametrize("storage_type", ["database", "file"])
def test_keyword_io_releases_transactions_and_commits_before_unlocking(
    backend: BackendFixture,
    sqlite_session_factory: sessionmaker[Session],
    active_transactions: set[Connection],
    storage_type: str,
) -> None:
    adapter, _, segments, _, job, redis = backend
    original = json.dumps({"__type__": "keyword_table", "__data__": {"table": {"existing": ["old-node"]}}})
    with sqlite_session_factory.begin() as session:
        session.add(DatasetKeywordTable(dataset_id="dataset-1", data_source_type=storage_type, keyword_table=original))
    chunk = IndexDocument(page_content="hello", metadata={"doc_id": "node", "doc_hash": "hash"})
    segments.save_for_indexing(job, [chunk], [5])
    locked = False

    @contextmanager
    def dataset_lock() -> Generator[None]:
        nonlocal locked
        locked = True
        yield
        assert not active_transactions
        # A separate session must see the write before the next lock holder can read.
        with sqlite_session_factory() as session:
            segment = session.scalar(select(DocumentSegment))
            assert segment is not None
            assert segment.keywords == ["hello"]
        locked = False

    redis.lock.side_effect = lambda *_args, **_kwargs: dataset_lock()

    def external_call(*_args, **_kwargs) -> None:
        assert locked
        assert not active_transactions, "Keyword I/O must not hold a database transaction"

    def load_keywords(*_args) -> bytes:
        external_call()
        return original.encode()

    def file_exists(*_args) -> bool:
        external_call()
        return True

    def extract_keywords(*_args) -> set[str]:
        external_call()
        return {"hello"}

    with (
        patch("core.rag.datasource.keyword.jieba.jieba.redis_client", redis),
        patch("core.rag.datasource.keyword.jieba.jieba.storage") as storage,
        patch("core.rag.datasource.keyword.jieba.jieba.JiebaKeywordTableHandler") as handler,
    ):
        storage.load_once.side_effect = load_keywords
        storage.exists.side_effect = file_exists
        storage.delete.side_effect = external_call
        storage.save.side_effect = external_call
        handler.return_value.extract_keywords.side_effect = extract_keywords
        adapter._process_chunk(Flask(__name__), job.ref, [chunk], True)
    assert not locked
    assert redis.lock.call_args.args == ("keyword_indexing_lock_dataset-1",)
    _, encoded = segments.get_keyword_table(job.ref.dataset)
    if storage_type == "file":
        storage.save.assert_called_once()
        encoded = storage.save.call_args.args[1]
    else:
        storage.save.assert_not_called()
    assert encoded is not None
    assert json.loads(encoded)["__data__"]["table"] == {"existing": ["old-node"], "hello": ["node"]}
    assert segments.resume_indexing(job) == ([], 5)


def test_extract_attaches_document_metadata_and_owns_local_session(backend: BackendFixture) -> None:
    adapter, _, _, sources, job, _ = backend
    text = IndexDocument(page_content="source")
    with patch(f"{MODULE}.IndexProcessorFactory") as factory:
        processor = factory.return_value.init_index_processor.return_value

        def extract(setting: object, *, session: Session, process_rule_mode: str) -> list[IndexDocument]:
            assert setting is sources.resolve_for_indexing.return_value
            assert not session.in_transaction()
            assert process_rule_mode == "automatic"
            return [text]

        processor.extract.side_effect = extract
        assert adapter.extract(job) == [text]
    sources.resolve_for_indexing.assert_called_once_with(job.source)
    assert text.metadata == {"dataset_id": "dataset-1", "document_id": "document-1"}


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (ProviderTokenNotInitError(), "Provider Token Not Init"),
        (ProviderTokenNotInitError("configure an embedding provider"), "configure an embedding provider"),
        (LLMBadRequestError("invalid model input"), "invalid model input"),
        (QuotaExceededError(), "Quota Exceeded"),
        (PluginDaemonClientSideError("plugin unavailable"), "plugin unavailable"),
        (NotFound("source file missing"), "source file missing"),
        (RuntimeError("index unavailable"), "index unavailable"),
    ],
)
def test_indexing_preserves_provider_and_source_error_descriptions(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session], error: Exception, message: str
) -> None:
    adapter, documents, segments, sources, job, _ = backend
    sources.resolve_for_indexing.side_effect = error
    with sqlite_session_factory.begin() as session:
        rule = DatasetProcessRule(
            dataset_id=job.ref.dataset.dataset_id, mode=ProcessRuleMode.AUTOMATIC, rules="{}", created_by="account-1"
        )
        session.add(rule)
        session.flush()
        document = session.get(Document, job.ref.document_id)
        assert document is not None
        document.dataset_process_rule_id = rule.id

    DocumentIndexingService(documents=documents, segments=segments, backend=adapter).run([job.ref])

    sources.resolve_for_indexing.assert_called_once()
    with sqlite_session_factory() as session:
        document = session.get(Document, job.ref.document_id)
        assert document is not None
        assert document.indexing_status == IndexingStatus.ERROR
        assert document.error == message
        assert document.completed_at is None


@pytest.mark.parametrize("provider", [None, "embedding-provider"])
def test_transform_selects_embedding_model_and_preserves_processor_options(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session], provider: str | None
) -> None:
    adapter, documents, _, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
        dataset.embedding_model_provider = provider
        dataset.embedding_model = "embedding-model"
    with (
        patch.object(documents, "get_indexing_user", return_value=MagicMock()) as user,
        patch(f"{MODULE}.ModelManager.for_tenant") as manager,
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
    ):
        processor = factory.return_value.init_index_processor.return_value
        processor.transform.return_value = list[IndexDocument]()
        adapter.transform(job, [])
        selected = (
            manager.return_value.get_model_instance if provider else manager.return_value.get_default_model_instance
        )
        selected.assert_called_once()
        assert processor.transform.call_args.kwargs["embedding_model_instance"] is selected.return_value
        assert processor.transform.call_args.kwargs["process_rule"] == job.processing_rule
        assert processor.transform.call_args.args == ([], user.return_value)


def test_hash_groups_load_worker_owned_inputs_before_completion(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session]
) -> None:
    adapter, _, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, "dataset-1")
        assert persisted_dataset is not None
        persisted_dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    chunks = [
        IndexDocument(page_content=content, metadata={"doc_id": f"node-{i}", "doc_hash": f"hash-{i}"})
        for i, content in enumerate(["same", "other", "same"])
    ]
    segments.save_for_indexing(job, chunks, [3, 5, 7])
    calls: list[tuple[Dataset, list[str]]] = []
    main_thread = threading.get_ident()

    def vector(dataset: Dataset, *, session: Session | None, vector_type: str) -> MagicMock:
        assert threading.get_ident() != main_thread
        assert inspect(dataset).detached
        assert session is None
        assert vector_type == "qdrant"

        def create(group: list[IndexDocument]) -> None:
            with sqlite_session_factory() as reader:
                persisted = reader.scalars(select(DocumentSegment)).all()
                assert len(persisted) == 3
                assert all(
                    row.status == SegmentStatus.INDEXING
                    for row in persisted
                    if row.index_node_id in {chunk.metadata["doc_id"] for chunk in group}
                )
            calls.append((dataset, [chunk.page_content for chunk in group]))

        backend = MagicMock()
        backend.create.side_effect = create
        return backend

    with Flask(__name__).app_context(), patch(f"{MODULE}.Vector", side_effect=vector) as factory:
        factory.resolve_vector_type.return_value = "qdrant"
        adapter.load(job, chunks)
    assert sum(group.count("same") for _, group in calls) == 2
    assert sum("same" in group for _, group in calls) == 1
    assert len({id(dataset) for dataset, _ in calls}) == len(calls)
    assert segments.resume_indexing(job) == ([], 15)


@pytest.mark.parametrize("technique", ["economy", "high_quality"])
def test_worker_failure_marks_document_error_and_keeps_retryable_segments(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session], technique: str
) -> None:
    adapter, documents, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, "dataset-1")
        assert persisted_dataset is not None
        persisted_dataset.indexing_technique = IndexTechniqueType(technique)
    chunks = [IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})]
    segments.save_for_indexing(job, chunks, [9])
    with (
        Flask(__name__).app_context(),
        patch(f"{MODULE}.Jieba") as keyword,
        patch(f"{MODULE}.Vector") as vector,
    ):
        keyword.return_value.update_texts.side_effect = RuntimeError("worker failed")
        vector.return_value.create.side_effect = RuntimeError("worker failed")
        DocumentIndexingService(documents=documents, segments=segments, backend=adapter).run_in_indexing_status(job.ref)
    with sqlite_session_factory() as session:
        row = session.get(Document, job.ref.document_id)
        assert row is not None
        assert row.indexing_status == IndexingStatus.ERROR
        assert row.error == "worker failed"
    assert len(segments.resume_indexing(job)[0]) == 1


def test_worker_pause_does_not_mark_segments_complete(backend: BackendFixture) -> None:
    adapter, _, segments, _, job, redis = backend
    chunks = [IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})]
    segments.save_for_indexing(job, chunks, [9])
    redis.get.return_value = b"paused"
    with Flask(__name__).app_context(), pytest.raises(DocumentIsPausedError):
        adapter.load(job, chunks)
    assert len(segments.resume_indexing(job)[0]) == 1


@pytest.mark.parametrize("technique", ["economy", "high_quality"])
@pytest.mark.parametrize("doc_form", ["text_model", "qa_model", "hierarchical_model"])
def test_full_indexing_commits_phases_through_real_repositories(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session], technique: str, doc_form: str
) -> None:
    adapter, documents, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        dataset = session.get(Dataset, "dataset-1")
        assert dataset is not None
        dataset.indexing_technique = IndexTechniqueType(technique)
        row = session.get(Document, "document-1")
        assert row is not None
        row.doc_form = IndexStructureType(doc_form)
        rule = DatasetProcessRule(
            dataset_id="dataset-1", mode=ProcessRuleMode.AUTOMATIC, rules="{}", created_by="account-1"
        )
        rule.id = "rule-1"
        row.dataset_process_rule_id = rule.id
        session.add(rule)
    chunk = IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})
    with (
        Flask(__name__).app_context(),
        patch.object(documents, "get_indexing_user", return_value=MagicMock()),
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
        patch(f"{MODULE}.ModelManager.for_tenant"),
        patch(f"{MODULE}.calculate_segment_token_counts", return_value=[19]),
        patch(f"{MODULE}.Jieba"),
        patch(f"{MODULE}.Vector"),
    ):
        processor = factory.return_value.init_index_processor.return_value
        processor.extract.return_value = [chunk]
        processor.transform.return_value = [chunk]
        DocumentIndexingService(documents=documents, segments=segments, backend=adapter).run([job.ref])
    with sqlite_session_factory() as session:
        row = session.get(Document, "document-1")
        assert row is not None
        assert row.indexing_status == IndexingStatus.COMPLETED
        assert row.tokens == 19
        assert row.parsing_completed_at is not None
        assert row.splitting_completed_at is not None
        assert row.completed_at is not None


@pytest.mark.parametrize("change", ["paused", "deleted"])
def test_document_changed_during_worker_io_cannot_be_completed(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session], change: str
) -> None:
    adapter, documents, segments, _, job, _ = backend
    chunks = [IndexDocument(page_content="text", metadata={"doc_id": "node", "doc_hash": "hash"})]
    segments.save_for_indexing(job, chunks, [9])

    def change_document(*_args, **_kwargs) -> None:
        with sqlite_session_factory.begin() as writer:
            row = writer.get(Document, "document-1")
            assert row is not None
            if change == "paused":
                row.is_paused = True
            else:
                writer.delete(row)

    service = DocumentIndexingService(documents=documents, segments=segments, backend=adapter)
    with Flask(__name__).app_context(), patch(f"{MODULE}.Jieba") as keyword:
        keyword.return_value.update_texts.side_effect = change_document
        if change == "paused":
            with pytest.raises(DocumentIsPausedError):
                service.run_in_indexing_status(job.ref)
        else:
            service.run_in_indexing_status(job.ref)
    with sqlite_session_factory() as session:
        segment = session.scalar(select(DocumentSegment))
        assert segment is not None
        assert segment.status == SegmentStatus.INDEXING


def test_partial_worker_failure_retries_only_incomplete_segments_and_keeps_total(
    backend: BackendFixture, sqlite_session_factory: sessionmaker[Session]
) -> None:
    adapter, documents, segments, _, job, _ = backend
    with sqlite_session_factory.begin() as session:
        persisted_dataset = session.get(Dataset, "dataset-1")
        assert persisted_dataset is not None
        persisted_dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    chunks = [
        IndexDocument(page_content=content, metadata={"doc_id": content, "doc_hash": content})
        for content in ["good", "bad"]
    ]
    segments.save_for_indexing(job, chunks, [13, 17])
    service = DocumentIndexingService(documents=documents, segments=segments, backend=adapter)

    def load(group: list[IndexDocument]) -> None:
        if group[0].page_content == "bad":
            raise RuntimeError("one shard failed")

    with (
        Flask(__name__).app_context(),
        patch(f"{MODULE}.Vector") as factory,
        patch(f"{MODULE}.helper.generate_text_hash", side_effect=lambda content: "0" if content == "good" else "1"),
    ):
        vector = factory.return_value
        vector.create.side_effect = load
        service.run_in_indexing_status(job.ref)
        pending, tokens = segments.resume_indexing(job)
        assert [chunk.page_content for chunk in pending] == ["bad"]
        assert tokens == 30
        vector.create.reset_mock()
        vector.create.side_effect = None
        service.run_in_indexing_status(job.ref)
        vector.create.assert_called_once()
        assert [chunk.page_content for chunk in vector.create.call_args.args[0]] == ["bad"]
    with sqlite_session_factory() as session:
        row = session.get(Document, "document-1")
        assert row is not None
        assert row.indexing_status == IndexingStatus.COMPLETED
        assert row.tokens == 30
        assert row.error is None
