import threading
from collections.abc import Iterator
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy import inspect, select
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.models.document import Document as IndexDocument
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentSegment
from models.enums import IndexingStatus, ProcessRuleMode, SegmentStatus
from repositories.knowledge.document_repository import SQLAlchemyDocumentRepository
from repositories.knowledge.segment_repository import SQLAlchemySegmentRepository
from services.knowledge.indexing.adapters.execution import IndexingExecutionAdapter
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.indexing.execution import DocumentIndexingService, IndexingDocument
from services.knowledge.resource_scope import DatasetRef
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
        session_factory=sqlite_session_factory, documents=documents, segments=segments, sources=sources
    )
    job = replace(
        documents.get_indexing_document(DatasetRef("workspace-1", "dataset-1").document("document-1")),
        processing_rule={"mode": "automatic", "rules": {}},
    )
    with patch(f"{MODULE}.redis_client") as redis:
        redis.get.return_value = None
        yield adapter, documents, segments, sources, job, redis


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


def test_hash_groups_use_worker_owned_sessions_and_commit_before_completion(
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
    calls = []
    main_thread = threading.get_ident()

    def load(dataset: Dataset, group: list[IndexDocument], *, session: Session, **kwargs: object) -> None:
        assert kwargs["with_keywords"] is False
        assert threading.get_ident() != main_thread
        assert inspect(dataset).detached
        assert not session.in_transaction()
        persisted = session.scalars(select(DocumentSegment)).all()
        assert len(persisted) == 3
        assert all(
            row.status == SegmentStatus.INDEXING
            for row in persisted
            if row.index_node_id in {chunk.metadata["doc_id"] for chunk in group}
        )
        calls.append((session, [chunk.page_content for chunk in group]))

    with Flask(__name__).app_context(), patch(f"{MODULE}.IndexProcessorFactory") as factory:
        factory.return_value.init_index_processor.return_value.load.side_effect = load
        adapter.load(job, chunks)
    assert sum(group.count("same") for _, group in calls) == 2
    assert sum("same" in group for _, group in calls) == 1
    assert len({id(session) for session, _ in calls}) == len(calls)
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
        patch(f"{MODULE}.Keyword") as keyword,
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
    ):
        keyword.return_value.create.side_effect = RuntimeError("worker failed")
        factory.return_value.init_index_processor.return_value.load.side_effect = RuntimeError("worker failed")
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
        patch(f"{MODULE}.Keyword"),
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

    def change_document(*_args) -> None:
        with sqlite_session_factory.begin() as writer:
            row = writer.get(Document, "document-1")
            assert row is not None
            if change == "paused":
                row.is_paused = True
            else:
                writer.delete(row)

    service = DocumentIndexingService(documents=documents, segments=segments, backend=adapter)
    with Flask(__name__).app_context(), patch(f"{MODULE}.Keyword") as keyword:
        keyword.return_value.create.side_effect = change_document
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

    def load(_dataset, group: list[IndexDocument], **_kwargs) -> None:
        if group[0].page_content == "bad":
            raise RuntimeError("one shard failed")

    with (
        Flask(__name__).app_context(),
        patch(f"{MODULE}.IndexProcessorFactory") as factory,
        patch(f"{MODULE}.helper.generate_text_hash", side_effect=lambda content: "0" if content == "good" else "1"),
    ):
        processor = factory.return_value.init_index_processor.return_value
        processor.load.side_effect = load
        service.run_in_indexing_status(job.ref)
        pending, tokens = segments.resume_indexing(job)
        assert [chunk.page_content for chunk in pending] == ["bad"]
        assert tokens == 30
        processor.load.reset_mock()
        processor.load.side_effect = None
        service.run_in_indexing_status(job.ref)
        processor.load.assert_called_once()
        assert [chunk.page_content for chunk in processor.load.call_args.args[1]] == ["bad"]
    with sqlite_session_factory() as session:
        row = session.get(Document, "document-1")
        assert row is not None
        assert row.indexing_status == IndexingStatus.COMPLETED
        assert row.tokens == 30
        assert row.error is None
