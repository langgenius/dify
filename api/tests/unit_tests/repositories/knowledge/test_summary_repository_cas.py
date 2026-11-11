from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pytest
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus, SummaryStatus
from repositories.knowledge.summary_repository import SQLAlchemySummaryRepository
from services.knowledge.entities.resource_scope import DatasetRef
from services.knowledge.summaries.adapters import SummaryIndexAdapter
from services.knowledge.summaries.application import SummaryIndexService, SummaryVectorInput, SummaryVectorResult


@dataclass
class _VectorProbe:
    error: Exception | None = None
    writes: list[str] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)

    def delete(self, node_id: str) -> None:
        self.deletes.append(node_id)

    def count_tokens(self, content: str) -> int:
        return len(content)

    def write(self, command: SummaryVectorInput, result: SummaryVectorResult) -> None:
        del command
        self.writes.append(result.node_id)
        if self.error is not None:
            raise self.error


@dataclass
class _AckLostStore:
    inner: SQLAlchemySummaryRepository

    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool:
        assert self.inner.completed(command, result) is True
        raise RuntimeError("commit acknowledgement lost")

    def failed(self, command: SummaryVectorInput, error: str) -> bool:
        return self.inner.failed(command, error)

    def is_published(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool:
        return self.inner.is_published(command, result)


@dataclass
class _UncertainPublicationStore:
    failed_called: bool = False

    def completed(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool:
        del command, result
        raise RuntimeError("commit acknowledgement lost")

    def failed(self, command: SummaryVectorInput, error: str) -> bool:
        del command, error
        self.failed_called = True
        return False

    def is_published(self, command: SummaryVectorInput, result: SummaryVectorResult) -> bool:
        del command, result
        raise RuntimeError("publication read unavailable")


def _seed_summary(factory: sessionmaker[Session]) -> SummaryVectorInput:
    expected_updated_at = datetime(2026, 1, 1, 1, 2, 3, 456789)
    with factory.begin() as session:
        dataset = Dataset(
            id="dataset-1",
            tenant_id="tenant-1",
            name="Dataset",
            description="",
            provider="vendor",
            data_source_type=DataSourceType.UPLOAD_FILE,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            created_by="account-1",
            chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
        )
        document = Document(
            id="document-1",
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=1,
            data_source_type=DataSourceType.UPLOAD_FILE,
            data_source_info="{}",
            batch="batch-1",
            name="Document",
            created_from=DocumentCreatedFrom.WEB,
            created_by="account-1",
            indexing_status=IndexingStatus.COMPLETED,
            enabled=True,
            archived=False,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )
        segment = DocumentSegment(
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="segment",
            word_count=1,
            tokens=1,
            created_by="account-1",
            enabled=True,
            status=SegmentStatus.COMPLETED,
        )
        segment.id = "segment-1"
        summary = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content="old summary",
            summary_index_node_id="old-node",
            status=SummaryStatus.GENERATING,
        )
        summary.id = "summary-1"
        summary.updated_at = expected_updated_at
        session.add_all([dataset, document, segment, summary])

    return SummaryVectorInput(
        DatasetRef("tenant-1", "dataset-1").document("document-1").segment("segment-1"),
        "summary-1",
        "old summary",
        "old-node",
        expected_updated_at,
        str(SummaryStatus.GENERATING),
        True,
    )


def _service(
    factory: sessionmaker[Session],
    vectors: _VectorProbe,
    *,
    node_id: str = "fresh-node",
    store: SQLAlchemySummaryRepository | _AckLostStore | _UncertainPublicationStore | None = None,
) -> SummaryIndexService:
    return SummaryIndexService(
        store=store or SQLAlchemySummaryRepository(new_session=factory),
        vectors=vectors,
        new_id=lambda: node_id,
        text_hash=lambda content: f"hash:{content}",
        sleep=lambda _delay: None,
    )


def test_stale_completion_cannot_overwrite_a_newer_edit_and_cleans_only_its_new_node(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command = _seed_summary(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        current.summary_content = "new summary"
        current.summary_index_node_id = "new-node"
        current.status = SummaryStatus.COMPLETED
        current.updated_at = command.expected_updated_at + timedelta(seconds=1)

    vectors = _VectorProbe()
    result = _service(sqlite_session_factory, vectors).vectorize(command)

    assert result is None
    assert vectors.writes == ["fresh-node"]
    assert vectors.deletes == ["fresh-node"]
    with sqlite_session_factory() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        assert current.summary_content == "new summary"
        assert current.summary_index_node_id == "new-node"
        assert current.status == SummaryStatus.COMPLETED


def test_stale_failure_does_not_mark_a_newer_summary_as_error(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command = _seed_summary(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        current.summary_content = "new summary"
        current.summary_index_node_id = "new-node"
        current.status = SummaryStatus.COMPLETED
        current.updated_at = command.expected_updated_at + timedelta(seconds=1)

    vectors = _VectorProbe(error=ValueError("embedding rejected"))
    result = _service(sqlite_session_factory, vectors).vectorize(command)

    assert result is None
    assert vectors.deletes == ["fresh-node"]
    with sqlite_session_factory() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        assert current.summary_content == "new summary"
        assert current.summary_index_node_id == "new-node"
        assert current.status == SummaryStatus.COMPLETED
        assert current.error is None


def test_completion_after_summary_clear_is_discarded_without_recreating_the_row(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command = _seed_summary(sqlite_session_factory)
    with sqlite_session_factory.begin() as session:
        session.delete(session.get_one(DocumentSegmentSummary, command.summary_id))

    vectors = _VectorProbe()
    result = _service(sqlite_session_factory, vectors).vectorize(command)

    assert result is None
    assert vectors.deletes == ["fresh-node"]
    with sqlite_session_factory() as session:
        assert session.get(DocumentSegmentSummary, command.summary_id) is None


def test_current_summary_publishes_new_node_before_retiring_the_previous_node(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command = _seed_summary(sqlite_session_factory)
    vectors = _VectorProbe()

    result = _service(sqlite_session_factory, vectors).vectorize(command)

    assert result is not None
    assert result.node_id == "fresh-node"
    assert vectors.writes == ["fresh-node"]
    assert vectors.deletes == ["old-node"]
    with sqlite_session_factory() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        assert current.summary_content == command.content
        assert current.summary_index_node_id == "fresh-node"
        assert current.status == SummaryStatus.COMPLETED


def test_lost_completion_ack_keeps_the_node_confirmed_by_the_real_repository(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command = _seed_summary(sqlite_session_factory)
    repository = SQLAlchemySummaryRepository(new_session=sqlite_session_factory)
    vectors = _VectorProbe()

    result = _service(
        sqlite_session_factory,
        vectors,
        store=_AckLostStore(repository),
    ).vectorize(command)

    assert result is not None
    assert result.node_id == "fresh-node"
    assert vectors.deletes == ["old-node"]
    with sqlite_session_factory() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        assert current.summary_index_node_id == "fresh-node"
        assert current.status == SummaryStatus.COMPLETED


def test_publication_confirmation_failure_preserves_the_new_node(
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    command = _seed_summary(sqlite_session_factory)
    store = _UncertainPublicationStore()
    vectors = _VectorProbe()

    with pytest.raises(RuntimeError, match="commit acknowledgement lost"):
        _service(sqlite_session_factory, vectors, store=store).vectorize(command)

    assert store.failed_called is False
    assert vectors.writes == ["fresh-node"]
    assert vectors.deletes == []


def test_manual_update_caller_does_not_overwrite_new_edit_after_attempt_failure(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command = _seed_summary(sqlite_session_factory)

    def fail_after_new_edit(
        summary: DocumentSegmentSummary,
        segment: DocumentSegment,
        dataset: Dataset,
        session: Session | None = None,
        **_: object,
    ) -> bool:
        del segment, dataset
        assert session is not None
        summary.updated_at = command.expected_updated_at + timedelta(seconds=1)
        session.flush()
        attempt = SummaryVectorInput(
            command.ref,
            summary.id,
            summary.summary_content or "",
            summary.summary_index_node_id,
            summary.updated_at,
            str(summary.status),
            summary.enabled,
        )
        session.commit()
        repository = SQLAlchemySummaryRepository(new_session=sqlite_session_factory)
        assert repository.failed(attempt, "Vectorization failed: rejected") is True

        with sqlite_session_factory.begin() as edit_session:
            current = edit_session.get_one(DocumentSegmentSummary, command.summary_id)
            current.summary_content = "newer manual edit"
            current.summary_index_node_id = "newer-node"
            current.status = SummaryStatus.COMPLETED
            current.error = None
            current.updated_at = command.expected_updated_at + timedelta(seconds=2)

        raise ValueError("embedding rejected")

    monkeypatch.setattr(SummaryIndexAdapter, "vectorize_summary", staticmethod(fail_after_new_edit))

    with sqlite_session_factory() as session:
        dataset = session.get_one(Dataset, command.ref.document.dataset.dataset_id)
        segment = session.get_one(DocumentSegment, command.ref.segment_id)
        result = SummaryIndexAdapter.update_summary_for_segment(
            segment,
            dataset,
            "superseded manual edit",
            session=session,
        )

        assert result is not None
        assert result.summary_content == "newer manual edit"
        assert result.summary_index_node_id == "newer-node"
        assert result.status == SummaryStatus.COMPLETED
        assert result.error is None

    with sqlite_session_factory() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        assert current.summary_content == "newer manual edit"
        assert current.summary_index_node_id == "newer-node"
        assert current.status == SummaryStatus.COMPLETED
        assert current.error is None


def test_generation_failure_does_not_mark_a_concurrent_edit_as_error(
    sqlite_session_factory: sessionmaker[Session],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    command = _seed_summary(sqlite_session_factory)

    def fail_after_new_edit(
        segment: DocumentSegment,
        dataset: Dataset,
        summary_index_setting: object,
        *,
        session: Session,
    ) -> tuple[str, object]:
        del segment, dataset, summary_index_setting, session
        with sqlite_session_factory.begin() as edit_session:
            current = edit_session.get_one(DocumentSegmentSummary, command.summary_id)
            current.summary_content = "newer generated edit"
            current.summary_index_node_id = "newer-node"
            current.status = SummaryStatus.COMPLETED
            current.error = None
            current.updated_at = command.expected_updated_at + timedelta(seconds=2)
        raise ValueError("model rejected request")

    monkeypatch.setattr(SummaryIndexAdapter, "generate_summary_for_segment", staticmethod(fail_after_new_edit))

    with sqlite_session_factory() as session:
        dataset = session.get_one(Dataset, command.ref.document.dataset.dataset_id)
        segment = session.get_one(DocumentSegment, command.ref.segment_id)
        with pytest.raises(ValueError, match="model rejected request"):
            SummaryIndexAdapter.generate_and_vectorize_summary(
                segment,
                dataset,
                {"enable": True},
                session=session,
            )

    with sqlite_session_factory() as session:
        current = session.get_one(DocumentSegmentSummary, command.summary_id)
        assert current.summary_content == "newer generated edit"
        assert current.summary_index_node_id == "newer-node"
        assert current.status == SummaryStatus.COMPLETED
        assert current.error is None
