"""Unit tests for services.summary_index_service."""

from __future__ import annotations

import logging
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import cast
from unittest.mock import ANY, MagicMock, call

import pytest
from sqlalchemy import Table, create_engine, select
from sqlalchemy.orm import Session, sessionmaker

import services.summary_index_service as summary_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, SegmentStatus, SummaryStatus
from services.summary_index_service import SummaryGenerationClaim, SummaryIndexService


@dataclass(frozen=True)
class _SessionContext:
    session: MagicMock

    def __enter__(self) -> MagicMock:
        return self.session

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def _dataset(*, indexing_technique: str = IndexTechniqueType.HIGH_QUALITY) -> MagicMock:
    dataset = MagicMock(name="dataset")
    dataset.id = "dataset-1"
    dataset.tenant_id = "tenant-1"
    dataset.indexing_technique = indexing_technique
    dataset.embedding_model_provider = "openai"
    dataset.embedding_model = "text-embedding"
    dataset.index_struct = '{"type":"weaviate","vector_store":{"class_prefix":"dataset-1"}}'
    dataset.collection_binding_id = None
    return dataset


def _segment(*, has_document: bool = True) -> MagicMock:
    segment = MagicMock(name="segment")
    segment.id = "seg-1"
    segment.document_id = "doc-1"
    segment.dataset_id = "dataset-1"
    segment.content = "hello world"
    segment.enabled = True
    segment.status = SegmentStatus.COMPLETED
    segment.position = 1
    if has_document:
        doc = MagicMock(name="document")
        doc.doc_language = "en"
        doc.doc_form = IndexStructureType.PARAGRAPH_INDEX
        segment.document = doc
    else:
        segment.document = None
    return segment


def _summary_record(*, summary_content: str = "summary", node_id: str | None = None) -> MagicMock:
    record = MagicMock(spec=summary_module.DocumentSegmentSummary, name="summary_record")
    record.id = "sum-1"
    record.dataset_id = "dataset-1"
    record.document_id = "doc-1"
    record.chunk_id = "seg-1"
    record.summary_content = summary_content
    record.summary_index_node_id = node_id
    record.summary_index_node_hash = None
    record.tokens = None
    record.status = SummaryStatus.GENERATING
    record.error = None
    record.enabled = True
    record.created_at = datetime(2024, 1, 1, tzinfo=UTC)
    record.updated_at = datetime.now(UTC)
    record.disabled_at = None
    record.disabled_by = None
    return record


def _concrete_dataset(*, indexing_technique: str = IndexTechniqueType.HIGH_QUALITY) -> Dataset:
    return Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=indexing_technique,
        created_by="user-1",
        embedding_model_provider="openai",
        embedding_model="text-embedding",
    )


def _concrete_segment() -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="doc-1",
        position=1,
        content="manual segment content",
        word_count=3,
        tokens=3,
        created_by="user-1",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = "seg-1"
    return segment


def _concrete_summary_record(*, summary_content: str = "summary") -> DocumentSegmentSummary:
    summary = DocumentSegmentSummary(
        dataset_id="dataset-1",
        document_id="doc-1",
        chunk_id="seg-1",
        summary_content=summary_content,
        status=SummaryStatus.GENERATING,
        enabled=True,
    )
    summary.id = "sum-1"
    return summary


def test_delete_unreferenced_summary_vectors_preserves_current_pointer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    session = MagicMock()
    session.get.return_value = dataset
    session.scalars.return_value.all.return_value = ["current-node"]
    vector_class = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", vector_class)
    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )

    summary_module.delete_unreferenced_summary_vectors(dataset.id, ["current-node"])

    vector_class.assert_not_called()


def test_delete_unreferenced_summary_vectors_deduplicates_deletable_nodes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    session = MagicMock()
    session.get.return_value = dataset
    session.scalars.return_value.all.return_value = []
    vector = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))
    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )

    summary_module.delete_unreferenced_summary_vectors(dataset.id, ["old-node", "", "old-node"])

    vector.delete_by_ids.assert_called_once_with(["old-node"])


def test_delete_unreferenced_summary_vectors_batches_queries_and_deletes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    session = MagicMock()
    session.get.return_value = dataset
    first_scalar_result = MagicMock()
    first_scalar_result.all.return_value = []
    second_scalar_result = MagicMock()
    second_scalar_result.all.return_value = []
    session.scalars.side_effect = [first_scalar_result, second_scalar_result]
    vector = MagicMock()
    monkeypatch.setattr(summary_module, "_SUMMARY_VECTOR_CLEANUP_BATCH_SIZE", 2)
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))
    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )

    summary_module.delete_unreferenced_summary_vectors(dataset.id, ["node-1", "node-2", "node-3"])

    assert session.scalars.call_count == 2
    assert vector.delete_by_ids.call_args_list == [
        call(["node-1", "node-2"]),
        call(["node-3"]),
    ]


def test_delete_unreferenced_summary_vectors_is_best_effort(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    session = MagicMock()
    session.get.return_value = dataset
    session.scalars.return_value.all.return_value = []
    vector = MagicMock()
    vector.delete_by_ids.side_effect = ConnectionError("unavailable")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))
    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )

    summary_module.delete_unreferenced_summary_vectors(dataset.id, ["old-node"])

    vector.delete_by_ids.assert_called_once_with(["old-node"])


class _CommitTrackingSession:
    expire_on_commit: bool
    commit_expire_on_commit_values: list[bool]

    def __init__(self) -> None:
        self.expire_on_commit = True
        self.commit_expire_on_commit_values = []

    def scalar(self, _stmt: object) -> str:
        return IndexStructureType.PARAGRAPH_INDEX

    def commit(self) -> None:
        self.commit_expire_on_commit_values.append(self.expire_on_commit)


class _ScopedCommitTrackingSession:
    current_session: _CommitTrackingSession

    def __init__(self) -> None:
        self.current_session = _CommitTrackingSession()

    def __call__(self) -> _CommitTrackingSession:
        return self.current_session

    def scalar(self, stmt: object) -> str:
        return self.current_session.scalar(stmt)

    def commit(self) -> None:
        self.current_session.commit()


def _generation_claim(
    *,
    generation_token: str = "generation-1",
    source_content: str = "hello world",
) -> SummaryGenerationClaim:
    return SummaryGenerationClaim(
        dataset_id="dataset-1",
        segment_id="seg-1",
        summary_record_id="sum-1",
        generation_token=generation_token,
        source_content_hash=summary_module.helper.generate_text_hash(source_content),
    )


def _claim_summary(
    summary: DocumentSegmentSummary,
    segment: DocumentSegment,
    *,
    generation_token: str = "generation-1",
) -> SummaryGenerationClaim:
    previous_error = summary.error
    had_active_publication = SummaryIndexService._summary_has_active_publication(summary)
    if not had_active_publication:
        summary.status = SummaryStatus.GENERATING
    summary.error = SummaryIndexService._generation_claim_marker(generation_token)
    return SummaryGenerationClaim(
        dataset_id=summary.dataset_id,
        segment_id=summary.chunk_id,
        summary_record_id=summary.id,
        generation_token=generation_token,
        source_content_hash=summary_module.helper.generate_text_hash(segment.content),
        expected_summary_content=summary.summary_content,
        expected_status=summary.status,
        expected_node_id=summary.summary_index_node_id,
        expected_enabled=summary.enabled,
        previous_error=previous_error,
        had_active_publication=had_active_publication,
    )


def test_mark_generation_preserves_active_publication(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    summary = _concrete_summary_record(summary_content="active summary")
    summary.status = SummaryStatus.COMPLETED
    summary.summary_index_node_id = "active-node"
    summary.summary_index_node_hash = "active-hash"
    session = MagicMock()

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))
    monkeypatch.setattr(SummaryIndexService, "_get_summary_record", MagicMock(return_value=summary))

    claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)

    assert summary.status == SummaryStatus.COMPLETED
    assert summary.summary_content == "active summary"
    assert summary.summary_index_node_id == "active-node"
    assert summary.error == SummaryIndexService._generation_claim_marker(claim.generation_token)
    assert SummaryIndexService._effective_summary_status(summary) == SummaryStatus.GENERATING
    session.commit.assert_called_once_with()


def test_mark_generation_discards_and_cleans_superseded_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    summary = _concrete_summary_record(summary_content="active summary")
    summary.status = SummaryStatus.COMPLETED
    summary.summary_index_node_id = "active-node"
    summary.error = SummaryIndexService._generation_claim_marker("superseded-token")
    session = MagicMock()
    cleanup = MagicMock()

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))
    monkeypatch.setattr(SummaryIndexService, "_get_summary_record", MagicMock(return_value=summary))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)

    assert claim.previous_error is None
    assert summary.error == SummaryIndexService._generation_claim_marker(claim.generation_token)
    cleanup.assert_called_once_with(dataset.id, ["superseded-token"])


def test_stale_completed_claim_reports_completed_publication() -> None:
    summary = _concrete_summary_record(summary_content="active summary")
    summary.status = SummaryStatus.COMPLETED
    summary.summary_index_node_id = "active-node"
    summary.error = SummaryIndexService._generation_claim_marker("abandoned-token")
    summary.updated_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)

    assert SummaryIndexService._effective_summary_status(summary) == SummaryStatus.COMPLETED


def test_recover_stale_generation_claim_restores_publication_and_cleans_vector(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    summary = _concrete_summary_record(summary_content="active summary")
    summary.status = SummaryStatus.COMPLETED
    summary.summary_index_node_id = "active-node"
    summary.error = SummaryIndexService._generation_claim_marker("abandoned-node")
    summary.updated_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    session = MagicMock()
    session.scalars.return_value.all.return_value = [summary]
    cleanup = MagicMock()

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    SummaryIndexService._recover_stale_generation_claims(dataset.id, [summary])

    assert summary.status == SummaryStatus.COMPLETED
    assert summary.error is None
    session.commit.assert_called_once_with()
    cleanup.assert_called_once_with(dataset.id, ["abandoned-node"])


def test_save_claim_stages_content_without_mutating_active_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    active_summary = _concrete_summary_record(summary_content="active summary")
    active_summary.status = SummaryStatus.COMPLETED
    active_summary.summary_index_node_id = "active-node"
    active_summary.summary_index_node_hash = "active-hash"
    claim = _claim_summary(active_summary, segment)
    session = MagicMock()
    session.get.return_value = active_summary

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))

    staged_summary = SummaryIndexService._save_summary_content(
        segment,
        dataset,
        "replacement summary",
        generation_claim=claim,
    )

    assert staged_summary is not active_summary
    assert staged_summary.summary_content == "replacement summary"
    assert staged_summary.summary_index_node_id == "active-node"
    assert active_summary.summary_content == "active summary"
    assert active_summary.status == SummaryStatus.COMPLETED
    assert active_summary.summary_index_node_id == "active-node"
    session.commit.assert_not_called()


def test_claimed_error_restores_active_publication(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    active_summary = _concrete_summary_record(summary_content="active summary")
    active_summary.status = SummaryStatus.COMPLETED
    active_summary.summary_index_node_id = "active-node"
    active_summary.summary_index_node_hash = "active-hash"
    claim = _claim_summary(active_summary, segment)
    session = MagicMock()

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_get_summary_record", MagicMock(return_value=active_summary))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))

    SummaryIndexService.update_summary_record_error(
        segment,
        dataset,
        "replacement failed",
        generation_claim=claim,
    )

    assert active_summary.status == SummaryStatus.COMPLETED
    assert active_summary.error is None
    assert active_summary.summary_content == "active summary"
    assert active_summary.summary_index_node_id == "active-node"
    session.commit.assert_called_once_with()


def test_claimed_error_releases_active_publication_after_source_change(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    active_summary = _concrete_summary_record(summary_content="active summary")
    active_summary.status = SummaryStatus.COMPLETED
    active_summary.summary_index_node_id = "active-node"
    active_summary.summary_index_node_hash = "active-hash"
    claim = _claim_summary(active_summary, segment)
    session = MagicMock()

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_get_summary_record", MagicMock(return_value=active_summary))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value="changed source"))

    SummaryIndexService.update_summary_record_error(
        segment,
        dataset,
        "provider failed",
        generation_claim=claim,
    )

    assert active_summary.status == SummaryStatus.COMPLETED
    assert active_summary.error is None
    assert active_summary.summary_content == "active summary"
    assert active_summary.summary_index_node_id == "active-node"
    session.commit.assert_called_once_with()


def test_batch_create_summary_records_preserves_active_publication(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    summary = _concrete_summary_record(summary_content="active summary")
    summary.status = SummaryStatus.COMPLETED
    summary.summary_index_node_id = "active-node"
    summary.summary_index_node_hash = "active-hash"
    session = MagicMock()
    allowed_ids_result = MagicMock()
    allowed_ids_result.all.return_value = [segment.id]
    existing_summaries_result = MagicMock()
    existing_summaries_result.all.return_value = [summary]
    session.scalars.side_effect = [allowed_ids_result, existing_summaries_result]

    monkeypatch.setattr(
        summary_module.session_factory,
        "create_session",
        MagicMock(return_value=_SessionContext(session)),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())

    SummaryIndexService.batch_create_summary_records([segment], dataset, status=SummaryStatus.NOT_STARTED)

    assert summary.status == SummaryStatus.COMPLETED
    assert summary.summary_content == "active summary"
    assert summary.summary_index_node_id == "active-node"
    session.commit.assert_called_once_with()


def test_generate_conflict_abandons_owned_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    claim = _generation_claim()
    staged_summary = _concrete_summary_record(summary_content="replacement")
    conflict = summary_module.SummaryIndexConflictError("dataset configuration changed")
    abandon_claim = MagicMock()

    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(
        SummaryIndexService,
        "generate_summary_for_segment",
        MagicMock(return_value=("replacement", MagicMock(total_tokens=0))),
    )
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_summary))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=conflict))
    monkeypatch.setattr(SummaryIndexService, "_abandon_generation_claim", abandon_claim, raising=False)

    with pytest.raises(summary_module.SummaryIndexConflictError, match="dataset configuration changed"):
        SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})

    abandon_claim.assert_called_once_with(claim)


def test_claimed_vector_uses_recoverable_generation_token_as_node_id(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    active_summary = _concrete_summary_record(summary_content="active summary")
    active_summary.status = SummaryStatus.COMPLETED
    active_summary.summary_index_node_id = "active-node"
    claim = _claim_summary(active_summary, segment, generation_token="recoverable-node")
    staged_summary = _concrete_summary_record(summary_content="replacement summary")
    staged_summary.summary_index_node_id = "active-node"
    vector = MagicMock()
    publications: list[summary_module._SummaryVectorPublication] = []

    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_embedding_token_count", MagicMock(return_value=0))

    def publish(publication: summary_module._SummaryVectorPublication) -> datetime:
        publications.append(publication)
        return datetime.now(UTC).replace(tzinfo=None)

    monkeypatch.setattr(SummaryIndexService, "_publish_summary_vector", publish)

    SummaryIndexService.vectorize_summary(
        staged_summary,
        segment,
        dataset,
        generation_claim=claim,
    )

    assert publications[0].new_node_id == claim.generation_token
    assert vector.add_texts.call_args.args[0][0].metadata["doc_id"] == claim.generation_token


def _allow_current_publication_dataset(monkeypatch: pytest.MonkeyPatch, dataset: Dataset | MagicMock) -> None:
    monkeypatch.setattr(SummaryIndexService, "_get_publication_dataset", MagicMock(return_value=dataset))


def test_generate_summary_for_segment_passes_document_language(monkeypatch: pytest.MonkeyPatch) -> None:
    usage = MagicMock()
    usage.total_tokens = 10
    usage.prompt_tokens = 3
    usage.completion_tokens = 7

    paragraph_module = SimpleNamespace(
        ParagraphIndexProcessor=SimpleNamespace(generate_summary=MagicMock(return_value=("sum", usage)))
    )
    monkeypatch.setitem(
        sys.modules,
        "core.rag.index_processor.processor.paragraph_index_processor",
        paragraph_module,
    )

    segment = _segment(has_document=True)
    dataset = _dataset()
    language_session = MagicMock()
    language_session.scalar.return_value = "en"
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(language_session))),
    )

    content, got_usage = SummaryIndexService.generate_summary_for_segment(segment, dataset, {"enable": True})
    assert content == "sum"
    assert got_usage is usage

    paragraph_module.ParagraphIndexProcessor.generate_summary.assert_called_once()
    _, kwargs = paragraph_module.ParagraphIndexProcessor.generate_summary.call_args
    assert kwargs["document_language"] == "en"


def test_generate_summary_for_segment_raises_when_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    paragraph_module = SimpleNamespace(
        ParagraphIndexProcessor=SimpleNamespace(generate_summary=MagicMock(return_value=("", MagicMock())))
    )
    monkeypatch.setitem(
        sys.modules,
        "core.rag.index_processor.processor.paragraph_index_processor",
        paragraph_module,
    )
    language_session = MagicMock()
    language_session.scalar.return_value = None
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(language_session))),
    )

    with pytest.raises(ValueError, match="Generated summary is empty"):
        SummaryIndexService.generate_summary_for_segment(_segment(), _dataset(), {"enable": True})


def test_create_summary_record_updates_existing_and_reenables(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = _summary_record(summary_content="old", node_id="n1")
    existing.enabled = False
    existing.disabled_at = datetime(2024, 1, 1)
    existing.disabled_by = "u"

    session = MagicMock(name="session")
    session.scalar.return_value = existing
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    segment = _segment()
    dataset = _dataset()

    result = SummaryIndexService.create_summary_record(segment, dataset, "new", status=SummaryStatus.GENERATING)
    assert result is existing
    assert result.summary_content == "new"
    assert result.status == SummaryStatus.GENERATING
    assert result.enabled
    assert result.disabled_at is None
    assert result.disabled_by is None
    assert result.error is None
    session.add.assert_called_once_with(existing)
    session.commit.assert_called_once()


def test_create_summary_record_creates_new(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock(name="session")
    session.scalar.return_value = None
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    record = SummaryIndexService.create_summary_record(_segment(), _dataset(), "new", status=SummaryStatus.GENERATING)
    assert record.dataset_id == "dataset-1"
    assert record.chunk_id == "seg-1"
    assert record.summary_content == "new"
    assert record.enabled is True
    session.add.assert_called_once()
    session.commit.assert_called_once()


def test_save_summary_content_does_not_replace_missing_claimed_record(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.get.return_value = None
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="was deleted"):
        SummaryIndexService._save_summary_content(
            _segment(),
            _dataset(),
            "summary",
            generation_claim=SummaryGenerationClaim(
                dataset_id="dataset-1",
                segment_id="seg-1",
                summary_record_id="missing-summary",
                generation_token="generation-1",
                source_content_hash=summary_module.helper.generate_text_hash("hello world"),
            ),
        )

    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_save_summary_content_rejects_superseded_generation_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    record = _summary_record(summary_content="manual")
    record.error = SummaryIndexService._generation_claim_marker("generation-2")
    session = MagicMock()
    session.get.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="generation was superseded"):
        SummaryIndexService._save_summary_content(
            _segment(),
            _dataset(),
            "stale generated summary",
            generation_claim=_generation_claim(),
        )

    assert record.summary_content == "manual"
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_save_summary_content_rejects_changed_source_segment(monkeypatch: pytest.MonkeyPatch) -> None:
    record = _summary_record(summary_content="old")
    record.error = SummaryIndexService._generation_claim_marker("generation-1")
    session = MagicMock()
    session.get.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value="edited content"))

    with pytest.raises(summary_module.SummaryIndexConflictError, match="generation was superseded"):
        SummaryIndexService._save_summary_content(
            _segment(),
            _dataset(),
            "stale generated summary",
            generation_claim=_generation_claim(),
        )

    assert record.summary_content == "old"
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_save_summary_content_rejects_claim_for_another_segment(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="does not match the target segment"):
        SummaryIndexService._save_summary_content(
            _segment(),
            _dataset(),
            "generated summary",
            generation_claim=SummaryGenerationClaim(
                dataset_id="dataset-1",
                segment_id="another-segment",
                summary_record_id="sum-1",
                generation_token="generation-1",
                source_content_hash=summary_module.helper.generate_text_hash("hello world"),
            ),
        )

    session.get.assert_not_called()
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_vectorize_summary_skips_non_high_quality(monkeypatch: pytest.MonkeyPatch) -> None:
    vector_cls = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", vector_cls)
    dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    SummaryIndexService.vectorize_summary(_summary_record(), _segment(), dataset)
    vector_cls.assert_not_called()


def test_vectorize_summary_raises_for_blank_content() -> None:
    with pytest.raises(ValueError, match="Summary content is empty"):
        SummaryIndexService.vectorize_summary(_summary_record(summary_content=" "), _segment(), _dataset())


def test_vectorize_summary_retries_connection_errors_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))

    embedding_model = MagicMock()
    embedding_model.get_text_embedding_num_tokens.return_value = [5]
    model_manager = MagicMock()
    model_manager.get_model_instance.return_value = embedding_model
    monkeypatch.setattr(summary_module.ModelManager, "for_tenant", MagicMock(return_value=model_manager))

    vector_instance = MagicMock()
    vector_instance.add_texts.side_effect = [RuntimeError("connection timeout"), None]
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))

    session = MagicMock(name="provided_session")
    merged = _summary_record(summary_content="sum")
    final_session = MagicMock()
    final_session.scalar.return_value = merged
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(final_session))),
    )
    monkeypatch.setattr(summary_module.time, "sleep", MagicMock())

    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=session)

    assert vector_instance.add_texts.call_count == 2
    summary_module.time.sleep.assert_called_once()  # type: ignore[attr-defined]
    session.commit.assert_called_once()
    final_session.commit.assert_called_once()
    assert summary.status == SummaryStatus.COMPLETED
    assert summary.summary_index_node_id == "uuid-1"
    assert summary.summary_index_node_hash == "hash-1"
    assert summary.tokens == 5


def test_vectorize_summary_publishes_before_retiring_old_vector(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")
    events: list[str] = []

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))

    vector = MagicMock()
    vector.add_texts.side_effect = lambda *_args, **_kwargs: events.append("add")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))
    cleanup = MagicMock(side_effect=lambda *_args: events.append("cleanup"))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    session = MagicMock()
    session.scalar.return_value = stored_summary
    session.commit.side_effect = lambda: events.append("commit")
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.vectorize_summary(summary, segment, dataset)

    assert events == ["add", "commit", "cleanup"]
    assert stored_summary.summary_index_node_id == "uuid-1"
    cleanup.assert_called_once_with(dataset.id, ["old-node"])


def test_publish_summary_vector_rejects_changed_dataset_embedding_config(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")
    publication = summary_module._SummaryVectorPublication(
        dataset_id="dataset-1",
        segment_id="seg-1",
        segment_content="hello world",
        summary_record_id="sum-1",
        summary_content="sum",
        old_node_id="old-node",
        new_node_id="new-node",
        summary_hash="hash-1",
        expected_enabled=True,
        expected_error=None,
        expected_generation_token=None,
        embedding_tokens=3,
        expected_dataset_state=SummaryIndexService._summary_vector_dataset_state(_dataset()),
    )
    current_dataset = _dataset()
    current_dataset.embedding_model = "new-embedding-model"
    session = MagicMock()
    session.get.return_value = current_dataset
    session.scalar.return_value = stored_summary
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="dataset configuration changed"):
        SummaryIndexService._publish_summary_vector(publication)

    session.commit.assert_not_called()
    assert stored_summary.summary_index_node_id == "old-node"


def test_publish_summary_vector_rejects_expired_generation_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    stored_summary = _summary_record(summary_content="active summary", node_id="old-node")
    stored_summary.status = SummaryStatus.COMPLETED
    stored_summary.error = SummaryIndexService._generation_claim_marker("expired-node")
    stored_summary.updated_at = datetime.now(UTC).replace(tzinfo=None) - timedelta(days=2)
    publication = summary_module._SummaryVectorPublication(
        dataset_id="dataset-1",
        segment_id="seg-1",
        segment_content="hello world",
        summary_record_id="sum-1",
        summary_content="replacement summary",
        old_node_id="old-node",
        new_node_id="expired-node",
        summary_hash="hash-1",
        expected_enabled=True,
        expected_error=stored_summary.error,
        expected_generation_token="expired-node",
        embedding_tokens=3,
        expected_dataset_state=SummaryIndexService._summary_vector_dataset_state(_dataset()),
        expected_summary_content="active summary",
        expected_status=SummaryStatus.COMPLETED,
        had_active_publication=True,
    )
    session = MagicMock()
    session.scalar.return_value = stored_summary
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_get_publication_dataset", MagicMock(return_value=_dataset()))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value="hello world"))
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))

    with pytest.raises(summary_module.SummaryIndexConflictError, match="superseded"):
        SummaryIndexService._publish_summary_vector(publication)

    session.commit.assert_not_called()


def test_publish_summary_vector_rejects_deleted_dataset(monkeypatch: pytest.MonkeyPatch) -> None:
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")
    publication = summary_module._SummaryVectorPublication(
        dataset_id="dataset-1",
        segment_id="seg-1",
        segment_content="hello world",
        summary_record_id="sum-1",
        summary_content="sum",
        old_node_id="old-node",
        new_node_id="new-node",
        summary_hash="hash-1",
        expected_enabled=True,
        expected_error=None,
        expected_generation_token=None,
        embedding_tokens=3,
        expected_dataset_state=SummaryIndexService._summary_vector_dataset_state(_dataset()),
    )
    session = MagicMock()
    session.get.return_value = None
    session.scalar.return_value = stored_summary
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="dataset was deleted"):
        SummaryIndexService._publish_summary_vector(publication)

    session.commit.assert_not_called()
    assert stored_summary.summary_index_node_id == "old-node"


def test_vectorize_summary_reconciles_commit_ack_loss_without_deleting_durable_vector(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="new-node"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))
    cleanup_after_commit = MagicMock()
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup_after_commit)

    vector = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

    publish_session = MagicMock()
    publish_session.scalar.return_value = stored_summary
    publish_session.commit.side_effect = ConnectionError("connection lost after server commit")
    reconcile_session = MagicMock()
    reconcile_session.scalar.return_value = stored_summary
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(
            create_session=MagicMock(
                side_effect=[
                    _SessionContext(publish_session),
                    _SessionContext(reconcile_session),
                ]
            )
        ),
    )

    SummaryIndexService.vectorize_summary(summary, segment, dataset)

    assert stored_summary.summary_index_node_id == "new-node"
    assert stored_summary.status == SummaryStatus.COMPLETED
    assert summary.summary_index_node_id == "new-node"
    assert call(["new-node"]) not in vector.delete_by_ids.call_args_list
    cleanup_after_commit.assert_called_once_with(dataset.id, ["old-node"])


def test_vectorize_summary_old_vector_cleanup_failure_is_non_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))

    vector = MagicMock()
    vector.delete_by_ids.side_effect = RuntimeError("cleanup failed")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

    session = MagicMock()
    session.scalar.return_value = stored_summary
    session.get.return_value = dataset
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.vectorize_summary(summary, segment, dataset)

    session.commit.assert_called_once()
    assert stored_summary.status == SummaryStatus.COMPLETED
    assert stored_summary.summary_index_node_id == "uuid-1"
    assert summary.status == SummaryStatus.COMPLETED


def test_vectorize_summary_does_not_recreate_record_deleted_during_vectorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))

    vector = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

    model_manager = MagicMock()
    model_manager.get_model_instance.side_effect = RuntimeError("no model")
    monkeypatch.setattr(summary_module.ModelManager, "for_tenant", MagicMock(return_value=model_manager))

    session = MagicMock(name="session")
    session.scalar.side_effect = [None, None, None]

    create_session_mock = MagicMock(return_value=_SessionContext(session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    with pytest.raises(summary_module.SummaryIndexConflictError, match="was deleted"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)

    assert create_session_mock.call_count == 2
    session.add.assert_not_called()
    session.commit.assert_not_called()
    vector.delete_by_ids.assert_called_once_with(["uuid-1"])
    assert summary.status == SummaryStatus.GENERATING
    assert summary.summary_index_node_id == "old-node"


def test_vectorize_summary_rejects_newer_generation_after_vector_publish(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")
    summary.error = SummaryIndexService._generation_claim_marker("generation-1")
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")
    stored_summary.error = SummaryIndexService._generation_claim_marker("generation-2")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="new-node"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())

    vector = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

    session = MagicMock()
    session.scalar.return_value = stored_summary
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="vectorization was superseded"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset)

    vector.add_texts.assert_called_once()
    vector.delete_by_ids.assert_called_once_with(["new-node"])
    session.commit.assert_not_called()
    assert stored_summary.summary_index_node_id == "old-node"
    assert stored_summary.error == SummaryIndexService._generation_claim_marker("generation-2")


def test_vectorize_summary_preserves_conflict_when_compensating_vector_delete_fails(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")
    summary.error = SummaryIndexService._generation_claim_marker("generation-1")
    stored_summary = _summary_record(summary_content="sum", node_id="old-node")
    stored_summary.error = SummaryIndexService._generation_claim_marker("generation-2")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="new-node"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())

    vector = MagicMock()
    vector.delete_by_ids.side_effect = RuntimeError("vector cleanup unavailable")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

    session = MagicMock()
    session.scalar.return_value = stored_summary
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with (
        caplog.at_level("WARNING"),
        pytest.raises(summary_module.SummaryIndexConflictError, match="vectorization was superseded"),
    ):
        SummaryIndexService.vectorize_summary(summary, segment, dataset)

    vector.delete_by_ids.assert_called_once_with(["new-node"])
    assert "Failed to compensate summary vector new-node" in caplog.text
    assert stored_summary.summary_index_node_id == "old-node"


def test_vectorize_summary_compensates_unpublished_vector_after_terminal_database_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="new-node"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(SummaryIndexService, "_embedding_token_count", MagicMock(return_value=3))
    monkeypatch.setattr(
        SummaryIndexService,
        "_publish_summary_vector",
        MagicMock(side_effect=RuntimeError("database constraint failure")),
    )
    monkeypatch.setattr(SummaryIndexService, "_publication_is_durable", MagicMock(return_value=False))
    record_failure = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "_record_vectorization_failure", record_failure)

    vector = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

    with pytest.raises(RuntimeError, match="database constraint failure"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset)

    vector.add_texts.assert_called_once()
    vector.delete_by_ids.assert_called_once_with(["new-node"])
    record_failure.assert_called_once()


def test_vectorize_summary_final_failure_updates_error_status(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(summary_module.time, "sleep", MagicMock())

    vector_instance = MagicMock()
    vector_instance.add_texts.side_effect = RuntimeError("boom")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))

    # error_session should find record and commit status update
    error_session = MagicMock(name="error_session")
    error_session.scalar.return_value = summary

    create_session_mock = MagicMock(return_value=_SessionContext(error_session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)

    assert summary.status == SummaryStatus.ERROR
    assert "Vectorization failed" in (summary.error or "")
    error_session.commit.assert_called_once()


def test_vectorize_summary_failure_does_not_mark_newer_generation_as_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)
    summary.error = SummaryIndexService._generation_claim_marker("generation-1")
    stored_summary = _summary_record(summary_content="sum", node_id=None)
    stored_summary.error = SummaryIndexService._generation_claim_marker("generation-2")

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="new-node"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(summary_module.time, "sleep", MagicMock())
    monkeypatch.setattr(
        summary_module,
        "Vector",
        MagicMock(return_value=MagicMock(add_texts=MagicMock(side_effect=RuntimeError("boom")))),
    )

    error_session = MagicMock()
    error_session.scalar.return_value = stored_summary
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(error_session))),
    )

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset)

    assert stored_summary.status == SummaryStatus.GENERATING
    assert stored_summary.error == SummaryIndexService._generation_claim_marker("generation-2")
    error_session.commit.assert_not_called()


def test_batch_create_summary_records_no_segments_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    create_session_mock = MagicMock()
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))
    SummaryIndexService.batch_create_summary_records([], _dataset())
    create_session_mock.assert_not_called()


def test_batch_create_summary_records_creates_and_updates(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    s1 = _segment()
    s2 = _segment()
    s2.id = "seg-2"
    s2.document_id = "doc-2"

    existing = _summary_record()
    existing.chunk_id = "seg-2"
    existing.enabled = False
    existing.error = SummaryIndexService._generation_claim_marker("in-flight-generation")

    session = MagicMock()
    session.scalars.side_effect = [SimpleNamespace(all=lambda: [s1.id, s2.id]), SimpleNamespace(all=lambda: [existing])]
    cleanup = MagicMock()

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    SummaryIndexService.batch_create_summary_records([s1, s2], dataset, status=SummaryStatus.NOT_STARTED)
    session.commit.assert_called_once()
    updated_summary = cast(DocumentSegmentSummary, session.add.call_args.args[0])
    assert updated_summary.enabled
    assert updated_summary.error is None
    cleanup.assert_called_once_with(dataset.id, ["in-flight-generation"])


def test_update_summary_record_error_updates_when_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record()

    session = MagicMock()
    session.scalar.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.update_summary_record_error(segment, dataset, "err")
    assert record.status == SummaryStatus.ERROR
    assert record.error == "err"
    session.commit.assert_called_once()


def test_update_summary_record_error_does_not_overwrite_newer_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record()
    record.error = SummaryIndexService._generation_claim_marker("generation-2")

    session = MagicMock()
    session.scalar.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.update_summary_record_error(
        segment,
        dataset,
        "stale error",
        generation_claim=_generation_claim(generation_token="generation-1"),
    )

    assert record.status == SummaryStatus.GENERATING
    assert record.error == SummaryIndexService._generation_claim_marker("generation-2")
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_generate_and_vectorize_summary_success(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="")

    session = MagicMock()
    session.scalar.return_value = record
    session.get.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))
    monkeypatch.setattr(
        SummaryIndexService, "generate_summary_for_segment", MagicMock(return_value=("sum", MagicMock(total_tokens=0)))
    )
    vectorize_mock = MagicMock(return_value=None)
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

    out = SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})
    assert out is not record
    assert out.summary_content == "sum"
    vectorize_mock.assert_called_once_with(out, segment, dataset, generation_claim=ANY)
    session.commit.assert_called_once_with()


def test_generate_and_vectorize_summary_releases_service_sessions_before_external_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    record = _summary_record(summary_content="old")
    active_contexts = 0

    class _TrackedContext:
        def __init__(self) -> None:
            self.session = MagicMock()
            self.session.scalar.return_value = record
            self.session.get.return_value = record

        def __enter__(self) -> MagicMock:
            nonlocal active_contexts
            active_contexts += 1
            return self.session

        def __exit__(self, exc_type, exc, tb) -> None:
            nonlocal active_contexts
            active_contexts -= 1

    def create_session() -> _TrackedContext:
        return _TrackedContext()

    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session))
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value="hello world"))

    external_calls: list[str] = []
    caller_session = MagicMock()

    def assert_clean_boundary(name: str) -> None:
        assert caller_session.commit.called
        assert active_contexts == 0
        external_calls.append(name)

    monkeypatch.setattr(
        SummaryIndexService,
        "generate_summary_for_segment",
        lambda *_args, **_kwargs: (assert_clean_boundary("llm") or "sum", MagicMock(total_tokens=0)),
    )
    monkeypatch.setattr(
        SummaryIndexService,
        "vectorize_summary",
        lambda *_args, **_kwargs: assert_clean_boundary("vector"),
    )

    SummaryIndexService.generate_and_vectorize_summary(_segment(), _dataset(), {"enable": True}, session=caller_session)

    assert external_calls == ["llm", "vector"]
    caller_session.commit.assert_called_once()


def test_generation_claim_rejects_interleaved_manual_and_older_generated_writes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stored_summary = _summary_record(summary_content="old summary")

    def create_session() -> _SessionContext:
        session = MagicMock()
        session.scalar.return_value = stored_summary
        session.get.return_value = stored_summary
        return _SessionContext(session)

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=create_session),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=True))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value="hello world"))

    dataset = _dataset()
    segment = _segment()

    stale_claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)
    SummaryIndexService._save_summary_content(segment, dataset, "manual summary")

    with pytest.raises(summary_module.SummaryIndexConflictError, match="generation was superseded"):
        SummaryIndexService._save_summary_content(
            segment,
            dataset,
            "stale generated summary",
            generation_claim=stale_claim,
        )

    assert stored_summary.summary_content == "manual summary"
    assert stored_summary.error is None

    staged_summary: DocumentSegmentSummary | None = None
    for attempt in range(200):
        older_claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)
        newer_claim = SummaryIndexService._mark_summary_generation_started(segment, dataset)
        with pytest.raises(summary_module.SummaryIndexConflictError, match="generation was superseded"):
            SummaryIndexService._save_summary_content(
                segment,
                dataset,
                f"older generated summary {attempt}",
                generation_claim=older_claim,
            )
        staged_summary = SummaryIndexService._save_summary_content(
            segment,
            dataset,
            f"newer generated summary {attempt}",
            generation_claim=newer_claim,
        )

    assert staged_summary is not None
    assert staged_summary.summary_content == "newer generated summary 199"
    assert stored_summary.summary_content == "manual summary"


def test_generate_and_vectorize_summary_vectorize_failure_sets_error(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="")

    session = MagicMock()
    session.scalar.return_value = record
    session.get.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))
    monkeypatch.setattr(
        SummaryIndexService, "generate_summary_for_segment", MagicMock(return_value=("sum", MagicMock(total_tokens=0)))
    )
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})
    assert record.status == SummaryStatus.ERROR
    assert record.error == "boom"


def test_vectorize_summary_rejects_replacement_record_found_by_chunk_id(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))

    vector_instance = MagicMock()
    vector_instance.add_texts.return_value = None
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )

    existing = _summary_record(summary_content="old", node_id="old-node")
    existing.id = "other-id"
    session = MagicMock(name="session")
    session.scalar.side_effect = [None, existing]  # miss by id, hit by chunk_id
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(summary_module.SummaryIndexConflictError, match="was replaced"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)
    session.commit.assert_not_called()
    assert existing.summary_index_node_id == "old-node"


def test_vectorize_summary_updates_existing_record_found_by_id(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    _allow_current_publication_dataset(monkeypatch, dataset)
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module, "Vector", MagicMock(return_value=MagicMock(add_texts=MagicMock(return_value=None)))
    )
    monkeypatch.setattr(
        summary_module.ModelManager,
        "for_tenant",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )

    existing = _summary_record(summary_content="sum", node_id=None)
    session = MagicMock(name="session")
    session.scalar.return_value = existing  # hit by id
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)
    session.commit.assert_called_once()
    assert existing.summary_index_node_hash == "hash-1"


def test_vectorize_summary_failure_does_not_mark_a_deleted_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(summary_module.time, "sleep", MagicMock())
    monkeypatch.setattr(
        summary_module,
        "Vector",
        MagicMock(return_value=MagicMock(add_texts=MagicMock(side_effect=RuntimeError("boom")))),
    )

    error_session = MagicMock(name="error_session")
    error_session.scalar.return_value = None

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(error_session))),
    )

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)

    error_session.commit.assert_not_called()


def test_update_summary_record_error_warns_when_missing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    session.scalar.return_value = None
    session.get.return_value = None
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with caplog.at_level(logging.WARNING, logger="services.summary_index_service"):
        SummaryIndexService.update_summary_record_error(segment, dataset, "err")
        assert any(r.levelno >= logging.WARNING for r in caplog.records)


def test_generate_and_vectorize_summary_creates_missing_record_and_logs_usage(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset()
    segment = _segment()

    mark_session = MagicMock()
    mark_session.scalar.return_value = None
    save_session = MagicMock()
    save_session.get.side_effect = lambda *_args, **_kwargs: mark_session.add.call_args.args[0]
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(
            create_session=MagicMock(side_effect=[_SessionContext(mark_session), _SessionContext(save_session)])
        ),
    )
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=segment.content))
    usage = MagicMock(total_tokens=4, prompt_tokens=1, completion_tokens=3)
    monkeypatch.setattr(SummaryIndexService, "generate_summary_for_segment", MagicMock(return_value=("sum", usage)))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(return_value=None))

    with caplog.at_level(logging.INFO, logger="services.summary_index_service"):
        result = SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})
        assert result.status in {SummaryStatus.GENERATING, SummaryStatus.COMPLETED}
        assert any(r.levelno >= logging.INFO for r in caplog.records)


def test_generate_summaries_for_document_skip_conditions(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    document = MagicMock(spec=summary_module.DatasetDocument)
    document.id = "doc-1"
    document.doc_form = IndexStructureType.PARAGRAPH_INDEX
    assert SummaryIndexService.generate_summaries_for_document(dataset, document, {"enable": True}) == []

    dataset = _dataset()
    assert SummaryIndexService.generate_summaries_for_document(dataset, document, {"enable": False}) == []

    document.doc_form = IndexStructureType.QA_INDEX
    assert SummaryIndexService.generate_summaries_for_document(dataset, document, {"enable": True}) == []


def test_generate_summaries_for_document_runs_and_handles_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    document = MagicMock(spec=summary_module.DatasetDocument)
    document.id = "doc-1"
    document.doc_form = IndexStructureType.PARAGRAPH_INDEX

    seg1 = _segment()
    seg2 = _segment()
    seg2.id = "seg-2"

    session = MagicMock()
    session.scalars.return_value.all.return_value = [seg1, seg2]

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "batch_create_summary_records", MagicMock())
    monkeypatch.setattr(
        SummaryIndexService,
        "generate_and_vectorize_summary",
        MagicMock(side_effect=[MagicMock(), RuntimeError("boom")]),
    )
    update_err_mock = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "update_summary_record_error", update_err_mock)

    records = SummaryIndexService.generate_summaries_for_document(dataset, document, {"enable": True})
    assert len(records) == 1
    update_err_mock.assert_not_called()


def test_generate_summaries_for_document_no_segments_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    document = MagicMock(spec=summary_module.DatasetDocument)
    document.id = "doc-1"
    document.doc_form = IndexStructureType.PARAGRAPH_INDEX

    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    assert SummaryIndexService.generate_summaries_for_document(dataset, document, {"enable": True}) == []


def test_generate_summaries_for_document_applies_segment_ids_and_only_parent_chunks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    document = MagicMock(spec=summary_module.DatasetDocument)
    document.id = "doc-1"
    document.doc_form = IndexStructureType.PARAGRAPH_INDEX
    seg = _segment()

    session = MagicMock()
    session.scalars.return_value.all.return_value = [seg]
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    monkeypatch.setattr(SummaryIndexService, "batch_create_summary_records", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "generate_and_vectorize_summary", MagicMock(return_value=MagicMock()))

    SummaryIndexService.generate_summaries_for_document(
        dataset,
        document,
        {"enable": True},
        session=session,
        segment_ids=[seg.id],
        only_parent_chunks=True,
    )
    session.scalars.assert_called()
    session.commit.assert_called_once()


def test_disable_summaries_for_segments_updates_sqlite_records(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _concrete_dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    engine = create_engine("sqlite+pysqlite:///:memory:")
    summary_table = cast(Table, DocumentSegmentSummary.__table__)
    summary_table.create(engine)
    summary_rows = [
        {
            "id": "sum-1",
            "dataset_id": dataset.id,
            "document_id": "doc-1",
            "chunk_id": "seg-1",
            "summary_content": "s",
            "summary_index_node_id": "n1",
            "error": SummaryIndexService._generation_claim_marker("generation-1"),
            "status": SummaryStatus.COMPLETED,
            "enabled": True,
        },
        {
            "id": "sum-2",
            "dataset_id": dataset.id,
            "document_id": "doc-1",
            "chunk_id": "seg-2",
            "summary_content": "s",
            "summary_index_node_id": None,
            "error": SummaryIndexService._generation_claim_marker("generation-2"),
            "status": SummaryStatus.COMPLETED,
            "enabled": True,
        },
    ]
    with engine.begin() as connection:
        connection.execute(summary_table.insert(), summary_rows)

    session_maker = sessionmaker(bind=engine, expire_on_commit=False)
    summary_module.session_factory.configure(engine, expire_on_commit=False)
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    cleanup = MagicMock()
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    SummaryIndexService.disable_summaries_for_segments(
        dataset,
        segment_ids=["seg-1", "seg-2"],
        disabled_by="u",
    )

    with session_maker() as session:
        summaries = session.scalars(select(DocumentSegmentSummary).order_by(DocumentSegmentSummary.id)).all()

    assert [(summary.id, summary.enabled, summary.disabled_by) for summary in summaries] == [
        ("sum-1", False, "u"),
        ("sum-2", False, "u"),
    ]
    assert all(summary.disabled_at is not None for summary in summaries)
    assert all(summary.error is None for summary in summaries)
    cleanup.assert_called_once_with(dataset.id, ["n1", "generation-1", "generation-2"])


def test_disable_summaries_for_segments_no_summaries_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setitem(
        sys.modules, "libs.datetime_utils", SimpleNamespace(naive_utc_now=MagicMock(return_value=datetime(2024, 1, 1)))
    )
    SummaryIndexService.disable_summaries_for_segments(dataset)
    session.commit.assert_called_once()


def test_disable_summaries_commits_caller_transaction_before_vector_cleanup(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    summary = _summary_record(node_id="node-1")
    session = MagicMock()
    events: list[str] = []
    rows = MagicMock()
    rows.all.return_value = [summary]
    session.scalars.side_effect = lambda *_args: events.append("summary-lock") or rows
    session.commit.side_effect = lambda: events.append("commit")
    cleanup = MagicMock(side_effect=lambda *_args: events.append("cleanup"))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)
    monkeypatch.setattr(
        SummaryIndexService, "_lock_segment_rows", MagicMock(side_effect=lambda *_args: events.append("parent-lock"))
    )
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(side_effect=AssertionError("nested session"))),
    )

    SummaryIndexService.disable_summaries_for_segments(dataset, session=session, segment_ids=[summary.chunk_id])

    assert events == ["parent-lock", "summary-lock", "commit", "cleanup"]
    session.begin_nested.assert_called_once_with()
    cleanup.assert_called_once_with(dataset.id, ["node-1"])


def test_enable_summaries_for_segments_skips_non_high_quality() -> None:
    SummaryIndexService.enable_summaries_for_segments(_dataset(indexing_technique=IndexTechniqueType.ECONOMY))


def test_enable_summary_record_rechecks_current_segment_state(monkeypatch: pytest.MonkeyPatch) -> None:
    summary = _summary_record()
    summary.enabled = False
    session = MagicMock()
    session.get.return_value = summary
    session.execute.return_value.scalar_one_or_none.return_value = None
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    assert SummaryIndexService._enable_summary_record(summary.id, summary.chunk_id, summary.dataset_id) is False
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_enable_summaries_for_segments_revectorizes_and_enables(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    summary = _summary_record(summary_content="sum", node_id="n1")
    summary.enabled = False
    summary.error = SummaryIndexService._generation_claim_marker("in-flight-generation")

    segment = _segment()
    segment.id = summary.chunk_id
    segment.enabled = True
    segment.status = SegmentStatus.COMPLETED

    session = MagicMock()
    summaries_result = MagicMock()
    summaries_result.all.return_value = [summary]
    segments_result = MagicMock()
    segments_result.all.return_value = [segment]
    session.scalars.side_effect = [summaries_result, segments_result]
    session.get.return_value = summary

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    vec_mock = MagicMock()
    cleanup = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vec_mock)
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    SummaryIndexService.enable_summaries_for_segments(dataset, session=session, segment_ids=[summary.chunk_id])
    vec_mock.assert_called_once_with(summary, segment, dataset)
    enabled_summary = cast(DocumentSegmentSummary, session.add.call_args.args[0])
    assert enabled_summary.enabled
    assert enabled_summary.error is None
    assert session.commit.call_count == 2
    cleanup.assert_called_once_with(dataset.id, ["in-flight-generation"])


def test_enable_summaries_for_segments_retires_vector_when_final_enable_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    summary = _summary_record(summary_content="sum", node_id="old-node")
    summary.enabled = False
    segment = _segment()
    segment.id = summary.chunk_id
    segment.enabled = True
    segment.status = SegmentStatus.COMPLETED
    session = MagicMock()
    summaries_result = MagicMock()
    summaries_result.all.return_value = [summary]
    segments_result = MagicMock()
    segments_result.all.return_value = [segment]
    session.scalars.side_effect = [summaries_result, segments_result]

    def publish_replacement(*_args) -> None:
        summary.summary_index_node_id = "new-node"

    cleanup = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", publish_replacement)
    monkeypatch.setattr(SummaryIndexService, "_enable_summary_record", MagicMock(return_value=False))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    SummaryIndexService.enable_summaries_for_segments(dataset, session=session, segment_ids=[summary.chunk_id])

    cleanup.assert_called_once_with(dataset.id, ["new-node"])


def test_enable_summaries_for_segments_no_summaries_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    SummaryIndexService.enable_summaries_for_segments(dataset)
    session.commit.assert_not_called()


def test_enable_summaries_for_segments_skips_segment_or_content_and_handles_vectorize_error(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset()
    summary1 = _summary_record(summary_content="sum", node_id="n1")
    summary1.enabled = False
    summary1.chunk_id = "seg-1"
    summary2 = _summary_record(summary_content="", node_id="n2")
    summary2.enabled = False
    summary2.chunk_id = "seg-2"
    summary3 = _summary_record(summary_content="sum3", node_id="n3")
    summary3.enabled = False
    summary3.chunk_id = "seg-3"

    bad_segment = _segment()
    bad_segment.enabled = False
    bad_segment.status = SegmentStatus.COMPLETED

    good_segment = _segment()
    good_segment.id = "seg-3"
    good_segment.enabled = True
    good_segment.status = SegmentStatus.COMPLETED

    session = MagicMock()
    summaries_result = MagicMock()
    summaries_result.all.return_value = [summary1, summary2, summary3]
    segments_result = MagicMock()
    segments_result.all.return_value = [bad_segment, good_segment]
    session.scalars.side_effect = [summaries_result, segments_result]

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    with caplog.at_level(logging.ERROR, logger="services.summary_index_service"):
        SummaryIndexService.enable_summaries_for_segments(dataset)
        assert any(r.levelno >= logging.ERROR for r in caplog.records)
    session.commit.assert_not_called()


def test_delete_summaries_for_segments_deletes_vectors_and_records(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    summary = _summary_record(summary_content="sum", node_id="n1")
    summary.error = SummaryIndexService._generation_claim_marker("pending-node")

    session = MagicMock()
    session.scalars.return_value.all.return_value = [summary]
    events: list[str] = []
    session.delete.side_effect = lambda *_args: events.append("delete-row")
    session.commit.side_effect = lambda: events.append("commit")

    cleanup = MagicMock(side_effect=lambda *_args: events.append("cleanup"))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(side_effect=AssertionError("nested session"))),
    )

    SummaryIndexService.delete_summaries_for_segments(dataset, segment_ids=[summary.chunk_id], session=session)
    session.delete.assert_called_once_with(summary)
    session.commit.assert_called_once()
    cleanup.assert_called_once_with(dataset.id, ["n1", "pending-node"])
    assert events == ["delete-row", "commit", "cleanup"]


def test_delete_summaries_for_segments_no_summaries_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    SummaryIndexService.delete_summaries_for_segments(dataset)
    session.commit.assert_called_once()


def test_update_summary_for_segment_skip_conditions(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    session.scalar.return_value = IndexStructureType.QA_INDEX
    economy_dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    assert SummaryIndexService.update_summary_for_segment(_segment(), economy_dataset, "x", session=session) is None
    seg = _segment(has_document=True)
    seg.document.doc_form = IndexStructureType.QA_INDEX
    query_session = MagicMock()
    query_session.scalar.return_value = IndexStructureType.QA_INDEX
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(query_session))),
    )
    assert SummaryIndexService.update_summary_for_segment(seg, _dataset(), "x", session=session) is None


def test_update_summary_for_segment_empty_content_deletes_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")
    record.error = SummaryIndexService._generation_claim_marker("pending-node")

    session = MagicMock()
    session.scalar.return_value = record
    events: list[str] = []
    session.delete.side_effect = lambda *_args: events.append("delete-row")
    session.commit.side_effect = lambda: events.append("commit")
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(side_effect=AssertionError("nested session"))),
    )

    cleanup = MagicMock(side_effect=lambda *_args: events.append("cleanup"))
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    assert SummaryIndexService.update_summary_for_segment(segment, dataset, "   ", session=session) is None
    session.delete.assert_called_once_with(record)
    session.commit.assert_called_once()
    cleanup.assert_called_once_with(dataset.id, ["n1", "pending-node"])
    assert events == ["delete-row", "commit", "cleanup"]


def test_update_summary_for_segment_empty_content_cleanup_failure_is_deferred(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    session.scalar.return_value = record
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    cleanup = MagicMock()
    monkeypatch.setattr(summary_module, "delete_unreferenced_summary_vectors", cleanup)

    assert SummaryIndexService.update_summary_for_segment(segment, dataset, "", session=session) is None
    session.begin_nested.assert_called_once_with()
    session.rollback.assert_not_called()
    session.commit.assert_called_once()
    cleanup.assert_called_once_with(dataset.id, ["n1"])


def test_update_summary_for_segment_empty_content_no_record_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    session.scalar.return_value = None
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=MagicMock()))
    assert SummaryIndexService.update_summary_for_segment(segment, dataset, "   ") is None


def test_update_summary_for_segment_updates_existing_and_vectorizes(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    staged_record = _summary_record(summary_content="new summary", node_id="n1")
    claim = _generation_claim()
    events: list[str] = []
    caller_session = _CommitTrackingSession()

    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_record))

    def vectorize_summary(*args, **kwargs):
        events.append("vector")

    vectorize_mock = MagicMock(side_effect=vectorize_summary)
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

    out = SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "new summary",
        session=cast(Session, caller_session),
    )
    assert out is staged_record
    vectorize_mock.assert_called_once_with(staged_record, segment, dataset, generation_claim=claim)
    assert events == ["vector"]


def test_update_summary_for_segment_existing_vector_delete_is_left_to_vectorize_summary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")
    staged_record = _summary_record(summary_content="new", node_id="n1")
    claim = _generation_claim()
    vector_instance = MagicMock()
    caller_session = _CommitTrackingSession()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_record))
    vectorize_mock = MagicMock(return_value=None)
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

    SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "new",
        session=cast(Session, caller_session),
    )
    vector_instance.delete_by_ids.assert_not_called()
    vectorize_mock.assert_called_once_with(staged_record, segment, dataset, generation_claim=claim)


def test_update_summary_for_segment_existing_vectorize_failure_returns_error_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    staged_record = _summary_record(summary_content="new", node_id="n1")
    claim = _generation_claim()
    caller_session = _CommitTrackingSession()
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_record))
    monkeypatch.setattr(SummaryIndexService, "update_summary_record_error", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    out = SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "new",
        session=cast(Session, caller_session),
    )
    assert out is staged_record
    assert out.status == SummaryStatus.ERROR
    assert "Vectorization failed" in (out.error or "")


def test_update_summary_for_segment_vectorize_failure_preserves_active_publication(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    published_summary = _concrete_summary_record(summary_content="published summary")
    published_summary.status = SummaryStatus.COMPLETED
    published_summary.summary_index_node_id = "published-node"
    published_summary.summary_index_node_hash = "published-hash"
    published_summary.tokens = 3
    claim = _claim_summary(published_summary, segment)
    staged_summary = _concrete_summary_record(summary_content="replacement summary")
    staged_summary.summary_index_node_id = published_summary.summary_index_node_id
    staged_summary.summary_index_node_hash = published_summary.summary_index_node_hash
    staged_summary.tokens = published_summary.tokens
    staged_summary.error = SummaryIndexService._generation_claim_marker(claim.generation_token)
    caller_session = _CommitTrackingSession()

    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_summary))
    monkeypatch.setattr(SummaryIndexService, "update_summary_record_error", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    result = SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "replacement summary",
        session=cast(Session, caller_session),
    )

    assert result is staged_summary
    assert result.status == SummaryStatus.COMPLETED
    assert result.error is None
    assert result.summary_content == "published summary"
    assert result.summary_index_node_id == "published-node"


def test_update_summary_for_segment_new_record_success(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    staged_record = _summary_record(summary_content="new")
    claim = _generation_claim()
    caller_session = _CommitTrackingSession()
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_record))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(return_value=None))

    out = SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "new",
        session=cast(Session, caller_session),
    )
    assert out is staged_record


def test_update_summary_for_segment_save_conflict_abandons_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    claim = _generation_claim()
    abandon_claim = MagicMock()
    query_session = MagicMock()
    query_session.scalar.return_value = IndexStructureType.PARAGRAPH_INDEX
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(query_session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(
        SummaryIndexService,
        "_save_summary_content",
        MagicMock(side_effect=summary_module.SummaryIndexConflictError("source changed")),
    )
    monkeypatch.setattr(SummaryIndexService, "_abandon_generation_claim", abandon_claim)

    with pytest.raises(summary_module.SummaryIndexConflictError, match="source changed"):
        SummaryIndexService.update_summary_for_segment(segment, dataset, "new")

    abandon_claim.assert_called_once_with(claim)


def test_get_segment_summary_and_document_summaries() -> None:
    record = _summary_record(summary_content="sum", node_id="n1")
    session = MagicMock()
    session.scalar.return_value = record
    session.scalars.return_value.all.return_value = [record]

    assert SummaryIndexService.get_segment_summary("seg-1", "dataset-1", session=session) is record
    assert SummaryIndexService.get_document_summaries("doc-1", "dataset-1", segment_ids=["seg-1"], session=session) == [
        record
    ]


def test_get_segments_summaries_non_empty() -> None:
    record1 = _summary_record()
    record1.chunk_id = "seg-1"
    record2 = _summary_record()
    record2.chunk_id = "seg-2"
    session = MagicMock()
    session.scalars.return_value.all.return_value = [record1, record2]

    out = SummaryIndexService.get_segments_summaries(["seg-1", "seg-2"], "dataset-1", session=session)
    assert set(out.keys()) == {"seg-1", "seg-2"}


def test_summary_reads_do_not_fall_back_to_an_older_enabled_duplicate() -> None:
    canonical_disabled = _summary_record(summary_content="new")
    canonical_disabled.enabled = False
    older_enabled = _summary_record(summary_content="old")
    session = MagicMock()
    session.scalar.return_value = canonical_disabled
    session.scalars.return_value.all.return_value = [canonical_disabled, older_enabled]

    assert SummaryIndexService.get_segment_summary("seg-1", "dataset-1", session=session) is None
    assert SummaryIndexService.get_segments_summaries(["seg-1"], "dataset-1", session=session) == {}
    assert SummaryIndexService.get_document_summaries("doc-1", "dataset-1", session=session) == []


def test_get_document_summaries_empty_segment_selection_is_empty() -> None:
    session = MagicMock()

    assert (
        SummaryIndexService.get_document_summaries(
            "doc-1",
            "dataset-1",
            segment_ids=[],
            session=session,
        )
        == []
    )
    session.scalars.assert_not_called()


def test_get_document_summary_index_status_no_segments_returns_none() -> None:
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    assert (
        SummaryIndexService.get_document_summary_index_status("doc-1", "dataset-1", "tenant-1", session=session) is None
    )


def test_get_documents_summary_index_status_empty_input() -> None:
    assert (
        SummaryIndexService.get_documents_summary_index_status([], "dataset-1", "tenant-1", session=MagicMock()) == {}
    )


def test_get_documents_summary_index_status_no_pending_sets_none(monkeypatch: pytest.MonkeyPatch) -> None:
    completed_summary = _concrete_summary_record()
    completed_summary.status = SummaryStatus.COMPLETED
    session = MagicMock()
    session.execute.return_value.all.return_value = [_concrete_segment()]
    monkeypatch.setattr(
        SummaryIndexService,
        "get_segments_summaries",
        MagicMock(return_value={"seg-1": completed_summary}),
    )
    result = SummaryIndexService.get_documents_summary_index_status(["doc-1"], "dataset-1", "tenant-1", session=session)
    assert result["doc-1"] is None


def test_update_summary_for_segment_creates_new_and_vectorize_fails_returns_error_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()

    staged_record = _summary_record(summary_content="new")
    claim = _generation_claim()
    caller_session = _CommitTrackingSession()
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=staged_record))
    monkeypatch.setattr(SummaryIndexService, "update_summary_record_error", MagicMock())
    vectorize_mock = MagicMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

    out = SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "new",
        session=cast(Session, caller_session),
    )
    assert out is not None
    assert out.status == SummaryStatus.ERROR
    assert "Vectorization failed" in (out.error or "")


def test_get_segments_summaries_empty_list() -> None:
    assert SummaryIndexService.get_segments_summaries([], "dataset-1", session=MagicMock()) == {}


def test_get_document_summary_index_status_and_documents_status(monkeypatch: pytest.MonkeyPatch) -> None:
    segment = _concrete_segment()
    generating_summary = _concrete_summary_record()
    generating_summary.status = SummaryStatus.GENERATING
    not_started_summary = _concrete_summary_record()
    not_started_summary.status = SummaryStatus.NOT_STARTED
    session = MagicMock()
    session.scalars.return_value.all.return_value = ["seg-1"]  # get_document_summary_index_status returns IDs

    monkeypatch.setattr(
        SummaryIndexService,
        "get_segments_summaries",
        MagicMock(return_value={"seg-1": generating_summary}),
    )
    assert (
        SummaryIndexService.get_document_summary_index_status("doc-1", "dataset-1", "tenant-1", session=session)
        == "SUMMARIZING"
    )

    # Multiple docs
    session2 = MagicMock()
    session2.execute.return_value.all.return_value = [segment]  # get_documents_summary_index_status uses execute
    monkeypatch.setattr(
        SummaryIndexService,
        "get_segments_summaries",
        MagicMock(return_value={"seg-1": not_started_summary}),
    )
    result = SummaryIndexService.get_documents_summary_index_status(
        ["doc-1", "doc-2"], "dataset-1", "tenant-1", session=session2
    )
    assert result["doc-1"] == "SUMMARIZING"
    assert result["doc-2"] is None


def test_get_document_summary_status_detail_counts_and_previews(monkeypatch: pytest.MonkeyPatch) -> None:
    segment1 = _segment()
    segment1.id = "seg-1"
    segment1.position = 1
    segment2 = _segment()
    segment2.id = "seg-2"
    segment2.position = 2

    summary1 = _summary_record(summary_content="x" * 150, node_id="n1")
    summary1.chunk_id = "seg-1"
    summary1.status = SummaryStatus.COMPLETED
    summary1.error = None
    summary1.created_at = datetime(2024, 1, 1, tzinfo=UTC)
    summary1.updated_at = datetime(2024, 1, 2, tzinfo=UTC)

    segment_service = SimpleNamespace(get_segments_by_document_and_dataset=MagicMock(return_value=[segment1, segment2]))
    monkeypatch.setitem(sys.modules, "services.dataset_service", SimpleNamespace(SegmentService=segment_service))

    monkeypatch.setattr(SummaryIndexService, "get_document_summaries", MagicMock(return_value=[summary1]))

    detail = SummaryIndexService.get_document_summary_status_detail("doc-1", "dataset-1", MagicMock())
    assert detail["total_segments"] == 2
    assert detail["summary_status"]["completed"] == 1
    assert detail["summary_status"]["not_started"] == 1
    summary_preview = detail["summaries"][0]["summary_preview"]
    assert summary_preview is not None
    assert summary_preview.endswith("...")
    assert detail["summaries"][1]["status"] == "not_started"


def test_get_document_summary_status_detail_hides_internal_generation_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    segment = _segment()
    summary = _summary_record()
    summary.status = SummaryStatus.COMPLETED
    summary.summary_index_node_id = "active-node"
    summary.error = SummaryIndexService._generation_claim_marker("generation-1")

    segment_service = SimpleNamespace(get_segments_by_document_and_dataset=MagicMock(return_value=[segment]))
    monkeypatch.setitem(sys.modules, "services.dataset_service", SimpleNamespace(SegmentService=segment_service))
    monkeypatch.setattr(SummaryIndexService, "get_document_summaries", MagicMock(return_value=[summary]))

    detail = SummaryIndexService.get_document_summary_status_detail("doc-1", "dataset-1", MagicMock())

    assert detail["summaries"][0]["status"] == SummaryStatus.GENERATING
    assert detail["summaries"][0]["error"] is None


def test_lock_segment_rows_empty_selection_is_noop() -> None:
    session = MagicMock()

    SummaryIndexService._lock_segment_rows(session, "dataset-1", [])

    session.execute.assert_not_called()


@pytest.mark.parametrize(
    ("allows_summary", "source_content", "message"),
    [
        (False, "hello world", "no longer accepts summaries"),
        (True, "changed content", "changed before summary generation started"),
    ],
)
def test_mark_summary_generation_rejects_stale_segment_state(
    monkeypatch: pytest.MonkeyPatch,
    allows_summary: bool,
    source_content: str,
    message: str,
) -> None:
    session = MagicMock()
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=allows_summary))
    monkeypatch.setattr(SummaryIndexService, "_get_segment_content", MagicMock(return_value=source_content))

    with pytest.raises(summary_module.SummaryIndexConflictError, match=message):
        SummaryIndexService._mark_summary_generation_started(_segment(), _dataset())

    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_save_summary_content_rejects_segment_that_became_ineligible(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(SummaryIndexService, "_segment_allows_summary", MagicMock(return_value=False))

    with pytest.raises(summary_module.SummaryIndexConflictError, match="no longer accepts summaries"):
        SummaryIndexService._save_summary_content(_segment(), _dataset(), "summary")

    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_batch_create_summary_records_skips_ineligible_segments(monkeypatch: pytest.MonkeyPatch) -> None:
    allowed = _segment()
    disallowed = _segment()
    disallowed.id = "seg-disallowed"
    session = MagicMock()
    session.scalars.return_value.all.return_value = []
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "_lock_segment_rows", MagicMock())
    monkeypatch.setattr(
        SummaryIndexService,
        "_summary_allowed_segment_ids",
        MagicMock(return_value={allowed.id}),
    )

    SummaryIndexService.batch_create_summary_records([allowed, disallowed], _dataset())

    assert session.add.call_count == 1
    assert session.add.call_args.args[0].chunk_id == allowed.id
    session.commit.assert_called_once_with()


def test_generation_failure_before_vectorization_updates_claimed_error(monkeypatch: pytest.MonkeyPatch) -> None:
    claim = _generation_claim()
    update_error = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(
        SummaryIndexService,
        "generate_summary_for_segment",
        MagicMock(side_effect=RuntimeError("llm unavailable")),
    )
    monkeypatch.setattr(SummaryIndexService, "update_summary_record_error", update_error)

    segment = _segment()
    dataset = _dataset()
    with pytest.raises(RuntimeError, match="llm unavailable"):
        SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})

    update_error.assert_called_once_with(
        segment=segment,
        dataset=dataset,
        error="llm unavailable",
        generation_claim=claim,
    )


def test_empty_summary_mutation_selections_do_not_open_transactions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_session = MagicMock(side_effect=AssertionError("no session expected"))
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=create_session),
    )
    dataset = _dataset()

    SummaryIndexService.disable_summaries_for_segments(dataset, segment_ids=[])
    SummaryIndexService.enable_summaries_for_segments(dataset, segment_ids=[])
    SummaryIndexService.delete_summaries_for_segments(dataset, segment_ids=[])

    create_session.assert_not_called()


@pytest.mark.parametrize(
    "operation",
    [
        SummaryIndexService.disable_summaries_for_segments,
        SummaryIndexService.delete_summaries_for_segments,
    ],
)
def test_caller_owned_summary_mutation_rolls_back_nested_transaction_failure(
    monkeypatch: pytest.MonkeyPatch,
    operation,
) -> None:
    dataset = _dataset()
    session = MagicMock()
    session.is_active = False
    nested = MagicMock()
    nested.__enter__.side_effect = RuntimeError("savepoint failed")
    session.begin_nested.return_value = nested

    with pytest.raises(RuntimeError, match="savepoint failed"):
        operation(dataset, segment_ids=["seg-1"], session=session)

    session.rollback.assert_called_once_with()
    session.refresh.assert_not_called()
    session.commit.assert_not_called()


@pytest.mark.parametrize(
    "operation",
    [
        SummaryIndexService.disable_summaries_for_segments,
        SummaryIndexService.delete_summaries_for_segments,
    ],
)
def test_caller_owned_summary_mutation_preserves_active_outer_transaction(
    operation,
) -> None:
    dataset = _dataset()
    session = MagicMock()
    session.is_active = True
    nested = MagicMock()
    nested.__enter__.side_effect = RuntimeError("savepoint failed")
    session.begin_nested.return_value = nested

    with pytest.raises(RuntimeError, match="savepoint failed"):
        operation(dataset, segment_ids=["seg-1"], session=session)

    session.rollback.assert_not_called()
    session.commit.assert_not_called()


def test_enable_summaries_skips_duplicate_and_already_enabled_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    disabled = _summary_record(summary_content="summary")
    disabled.enabled = False
    duplicate = _summary_record(summary_content="older duplicate")
    duplicate.enabled = False
    already_enabled = _summary_record(summary_content="enabled")
    already_enabled.chunk_id = "seg-enabled"
    already_enabled.enabled = True
    segment = _segment()

    session = MagicMock()
    summaries_result = MagicMock()
    summaries_result.all.return_value = [disabled, duplicate, already_enabled]
    segments_result = MagicMock()
    segments_result.all.return_value = [segment]
    session.scalars.side_effect = [summaries_result, segments_result]
    vectorize_summary = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_summary)
    monkeypatch.setattr(SummaryIndexService, "_enable_summary_record", MagicMock(return_value=True))

    SummaryIndexService.enable_summaries_for_segments(
        _dataset(),
        session=session,
        segment_ids=[disabled.chunk_id, already_enabled.chunk_id],
    )

    vectorize_summary.assert_called_once_with(disabled, segment, ANY)
    session.scalar.assert_not_called()


def test_empty_manual_summary_rolls_back_nested_transaction_failure() -> None:
    dataset = _dataset()
    session = MagicMock()
    session.is_active = False
    session.scalar.return_value = IndexStructureType.PARAGRAPH_INDEX
    nested = MagicMock()
    nested.__enter__.side_effect = RuntimeError("savepoint failed")
    session.begin_nested.return_value = nested

    with pytest.raises(RuntimeError, match="savepoint failed"):
        SummaryIndexService.update_summary_for_segment(
            _segment(),
            dataset,
            "",
            session=session,
        )

    session.rollback.assert_called_once_with()
    session.refresh.assert_not_called()
    session.commit.assert_not_called()


def test_manual_summary_conflict_is_logged_and_reraised(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    conflict = summary_module.SummaryIndexConflictError("superseded")
    claim = _generation_claim()
    abandon_claim = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", MagicMock(return_value=_summary_record()))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=conflict))
    monkeypatch.setattr(SummaryIndexService, "_abandon_generation_claim", abandon_claim)
    session = MagicMock()
    session.scalar.return_value = IndexStructureType.PARAGRAPH_INDEX

    with pytest.raises(summary_module.SummaryIndexConflictError, match="superseded"):
        SummaryIndexService.update_summary_for_segment(
            _segment(),
            _dataset(),
            "manual",
            session=session,
        )

    abandon_claim.assert_called_once_with(claim)


def test_update_summary_for_segment_commits_without_expiring_loaded_instances(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _concrete_dataset()
    segment = _concrete_segment()
    summary_record = _concrete_summary_record(summary_content="manual summary")
    claim = _generation_claim()
    caller_session = _ScopedCommitTrackingSession()
    vectorized: list[tuple[DocumentSegmentSummary, DocumentSegment, Dataset, SummaryGenerationClaim]] = []

    def save_summary_content(
        *,
        segment: DocumentSegment,
        dataset: Dataset,
        summary_content: str,
        status: SummaryStatus = SummaryStatus.GENERATING,
        generation_claim: SummaryGenerationClaim | None = None,
    ) -> DocumentSegmentSummary:
        assert summary_content == "manual summary"
        assert status == SummaryStatus.GENERATING
        assert generation_claim is claim
        assert isinstance(segment, DocumentSegment)
        assert isinstance(dataset, Dataset)
        return summary_record

    def vectorize_summary(
        summary_record: DocumentSegmentSummary,
        segment: DocumentSegment,
        dataset: Dataset,
        *,
        generation_claim: SummaryGenerationClaim,
    ) -> None:
        vectorized.append((summary_record, segment, dataset, generation_claim))

    monkeypatch.setattr(SummaryIndexService, "_mark_summary_generation_started", MagicMock(return_value=claim))
    monkeypatch.setattr(SummaryIndexService, "_save_summary_content", save_summary_content)
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_summary)

    result = SummaryIndexService.update_summary_for_segment(
        segment,
        dataset,
        "manual summary",
        session=cast(Session, caller_session),
    )

    assert result is summary_record
    assert vectorized == [(summary_record, segment, dataset, claim)]
    assert caller_session.current_session.commit_expire_on_commit_values == [False]
    assert caller_session.current_session.expire_on_commit is True
