"""SQLite-backed tests for :mod:`services.summary_index_service`."""

from __future__ import annotations

import sys
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session, sessionmaker

import services.summary_index_service as summary_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, SegmentStatus, SummaryStatus
from services.summary_index_service import SummaryIndexService

TENANT_ID = "tenant-1"
OTHER_TENANT_ID = "tenant-2"


@pytest.fixture(autouse=True)
def _install_sqlite_factory(
    monkeypatch: pytest.MonkeyPatch,
    sqlite_session_factory: sessionmaker[Session],
) -> None:
    """Route every service-owned session through the per-test SQLite database."""

    monkeypatch.setattr(summary_module.session_factory, "create_session", sqlite_session_factory)


def _persist_dataset(
    session: Session,
    *,
    dataset_id: str = "dataset-1",
    tenant_id: str = TENANT_ID,
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
) -> Dataset:
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name=f"Dataset {dataset_id}",
        description="",
        provider="vendor",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=indexing_technique,
        created_by="account-1",
        embedding_model_provider="openai",
        embedding_model="text-embedding",
        chunk_structure=IndexStructureType.PARAGRAPH_INDEX,
    )
    session.add(dataset)
    session.commit()
    return dataset


def _persist_document(
    session: Session,
    dataset: Dataset,
    *,
    document_id: str = "doc-1",
    doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX,
    doc_language: str | None = "en",
) -> Document:
    document = Document(
        id=document_id,
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        data_source_info="{}",
        batch="batch-1",
        name=f"Document {document_id}",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        indexing_status="completed",
        enabled=True,
        archived=False,
        doc_form=doc_form,
        doc_language=doc_language,
    )
    session.add(document)
    session.commit()
    return document


def _persist_segment(
    session: Session,
    dataset: Dataset,
    document: Document,
    *,
    segment_id: str = "seg-1",
    position: int = 1,
    content: str = "hello world",
    enabled: bool = True,
    status: SegmentStatus = SegmentStatus.COMPLETED,
) -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=position,
        content=content,
        word_count=len(content.split()),
        tokens=2,
        created_by="account-1",
        enabled=enabled,
        status=status,
    )
    segment.id = segment_id
    session.add(segment)
    session.commit()
    return segment


def _persist_summary(
    session: Session,
    dataset: Dataset,
    document: Document,
    segment: DocumentSegment,
    *,
    summary_id: str = "sum-1",
    content: str | None = "summary",
    node_id: str | None = None,
    status: SummaryStatus = SummaryStatus.GENERATING,
    enabled: bool = True,
    created_at: datetime | None = None,
) -> DocumentSegmentSummary:
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content=content,
        summary_index_node_id=node_id,
        status=status,
        enabled=enabled,
    )
    summary.id = summary_id
    if created_at is not None:
        summary.created_at = created_at
        summary.updated_at = created_at
    session.add(summary)
    session.commit()
    return summary


def _graph(session: Session) -> tuple[Dataset, Document, DocumentSegment]:
    dataset = _persist_dataset(session)
    document = _persist_document(session, dataset)
    segment = _persist_segment(session, dataset, document)
    return dataset, document, segment


def _usage(*, total: int = 10) -> MagicMock:
    usage = MagicMock(name="llm_usage")
    usage.total_tokens = total
    usage.prompt_tokens = 3
    usage.completion_tokens = 7
    return usage


def _install_summary_generator(
    monkeypatch: pytest.MonkeyPatch,
    *,
    content: str = "generated summary",
    usage: MagicMock | None = None,
) -> MagicMock:
    generate = MagicMock(return_value=(content, usage or _usage()))
    paragraph_module = SimpleNamespace(ParagraphIndexProcessor=SimpleNamespace(generate_summary=generate))
    monkeypatch.setitem(
        sys.modules,
        "core.rag.index_processor.processor.paragraph_index_processor",
        paragraph_module,
    )
    return generate


def _install_vector_dependencies(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="node-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    embedding_model = MagicMock(name="embedding_model")
    embedding_model.get_text_embedding_num_tokens.return_value = [5]
    manager = MagicMock(name="model_manager")
    manager.get_model_instance.return_value = embedding_model
    monkeypatch.setattr(summary_module.ModelManager, "for_tenant", MagicMock(return_value=manager))
    vector = MagicMock(name="vector")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))
    return vector


class TestGenerateAndCreate:
    def test_generate_uses_document_language(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        dataset, _, segment = _graph(sqlite_session)
        usage = _usage()
        generate = _install_summary_generator(monkeypatch, usage=usage)

        content, result_usage = SummaryIndexService.generate_summary_for_segment(
            segment, dataset, {"enable": True}, session=sqlite_session
        )

        assert content == "generated summary"
        assert result_usage is usage
        assert generate.call_args.kwargs["document_language"] == "en"
        assert generate.call_args.kwargs["session"] is sqlite_session

    def test_generate_allows_missing_document_but_rejects_empty_summary(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset = _persist_dataset(sqlite_session)
        orphan_document = _persist_document(sqlite_session, dataset)
        segment = _persist_segment(sqlite_session, dataset, orphan_document)
        sqlite_session.delete(orphan_document)
        sqlite_session.commit()
        _install_summary_generator(monkeypatch, content="")

        with pytest.raises(ValueError, match="Generated summary is empty"):
            SummaryIndexService.generate_summary_for_segment(segment, dataset, {"enable": True}, session=sqlite_session)

    def test_create_updates_only_matching_dataset_and_reenables(self, sqlite_session: Session) -> None:
        dataset, document, segment = _graph(sqlite_session)
        existing = _persist_summary(
            sqlite_session, dataset, document, segment, content="old", node_id="old-node", enabled=False
        )
        other_dataset = _persist_dataset(sqlite_session, dataset_id="dataset-2")
        other_document = _persist_document(sqlite_session, other_dataset, document_id="doc-2")
        decoy = _persist_summary(
            sqlite_session,
            other_dataset,
            other_document,
            segment,
            summary_id="decoy",
            content="decoy",
        )
        existing.disabled_at = datetime(2026, 1, 1)
        existing.disabled_by = "account-2"
        sqlite_session.commit()

        result = SummaryIndexService.create_summary_record(
            segment, dataset, "new", status=SummaryStatus.GENERATING, session=sqlite_session
        )

        assert result.id == existing.id
        assert (result.summary_content, result.status, result.enabled) == (
            "new",
            SummaryStatus.GENERATING,
            True,
        )
        assert (result.disabled_at, result.disabled_by, result.error) == (None, None, None)
        assert sqlite_session.scalar(select(func.count()).select_from(DocumentSegmentSummary)) == 2
        sqlite_session.refresh(decoy)
        assert decoy.summary_content == "decoy"

    def test_create_persists_new_record_in_current_transaction(self, sqlite_session: Session) -> None:
        dataset, document, segment = _graph(sqlite_session)

        result = SummaryIndexService.create_summary_record(
            segment, dataset, "new", status=SummaryStatus.NOT_STARTED, session=sqlite_session
        )

        assert result.id is not None
        stored = sqlite_session.get(DocumentSegmentSummary, result.id)
        assert stored is result
        assert (stored.dataset_id, stored.document_id, stored.chunk_id, stored.summary_content) == (
            dataset.id,
            document.id,
            segment.id,
            "new",
        )


class TestVectorizeSummary:
    def test_skips_economy_dataset(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        dataset = _persist_dataset(sqlite_session, indexing_technique=IndexTechniqueType.ECONOMY)
        document = _persist_document(sqlite_session, dataset)
        segment = _persist_segment(sqlite_session, dataset, document)
        summary = _persist_summary(sqlite_session, dataset, document, segment)
        vector_class = MagicMock()
        monkeypatch.setattr(summary_module, "Vector", vector_class)

        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=sqlite_session)

        vector_class.assert_not_called()

    def test_rejects_blank_content(self, sqlite_session: Session) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, content=" ")

        with pytest.raises(ValueError, match="Summary content is empty"):
            SummaryIndexService.vectorize_summary(summary, segment, dataset, session=sqlite_session)

    def test_provided_session_retries_and_flushes_mapped_record(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment)
        vector = _install_vector_dependencies(monkeypatch)
        vector.add_texts.side_effect = [ConnectionError("connection timeout"), None]
        sleep = MagicMock()
        monkeypatch.setattr(summary_module.time, "sleep", sleep)

        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=sqlite_session)

        assert vector.add_texts.call_count == 2
        sleep.assert_called_once_with(2.0)
        assert (summary.status, summary.summary_index_node_id, summary.summary_index_node_hash, summary.tokens) == (
            SummaryStatus.COMPLETED,
            "node-1",
            "hash-1",
            5,
        )

    def test_service_owned_session_updates_persisted_record(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment)
        _install_vector_dependencies(monkeypatch)

        SummaryIndexService.vectorize_summary(summary, segment, dataset)

        with sqlite_session_factory() as observer:
            stored = observer.get(DocumentSegmentSummary, summary.id)
            assert stored is not None
            assert (stored.status, stored.summary_index_node_id, stored.summary_index_node_hash, stored.tokens) == (
                SummaryStatus.COMPLETED,
                "node-1",
                "hash-1",
                5,
            )

    def test_service_owned_session_falls_back_to_chunk_and_preserves_existing_id(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        stored = _persist_summary(sqlite_session, dataset, document, segment, summary_id="stored-id")
        detached = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=segment.id,
            summary_content="replacement",
        )
        detached.id = "missing-id"
        _install_vector_dependencies(monkeypatch)

        SummaryIndexService.vectorize_summary(detached, segment, dataset)

        with sqlite_session_factory() as observer:
            refreshed = observer.get(DocumentSegmentSummary, stored.id)
            assert refreshed is not None
            assert refreshed.summary_content == "replacement"
            assert refreshed.status == SummaryStatus.COMPLETED
            assert observer.get(DocumentSegmentSummary, detached.id) is None

    def test_service_owned_session_creates_missing_record(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset, _, segment = _graph(sqlite_session)
        detached = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=segment.document_id,
            chunk_id=segment.id,
            summary_content="new summary",
        )
        detached.id = "new-summary"
        _install_vector_dependencies(monkeypatch)

        SummaryIndexService.vectorize_summary(detached, segment, dataset)

        with sqlite_session_factory() as observer:
            stored = observer.get(DocumentSegmentSummary, detached.id)
            assert stored is not None
            assert stored.status == SummaryStatus.COMPLETED

    def test_final_failure_persists_error_in_fresh_session(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment)
        vector = _install_vector_dependencies(monkeypatch)
        vector.add_texts.side_effect = RuntimeError("fatal vector failure")

        with pytest.raises(RuntimeError, match="fatal vector failure"):
            SummaryIndexService.vectorize_summary(summary, segment, dataset, session=sqlite_session)

        with sqlite_session_factory() as observer:
            stored = observer.get(DocumentSegmentSummary, summary.id)
            assert stored is not None
            assert stored.status == SummaryStatus.ERROR
            assert stored.error == "Vectorization failed: fatal vector failure"


class TestBatchAndGeneration:
    def test_batch_create_no_segments_is_noop(self, sqlite_session: Session) -> None:
        dataset = _persist_dataset(sqlite_session)

        SummaryIndexService.batch_create_summary_records([], dataset)

        assert sqlite_session.scalar(select(func.count()).select_from(DocumentSegmentSummary)) == 0

    def test_batch_create_inserts_updates_reenables_and_scopes(
        self, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        dataset, document, first = _graph(sqlite_session)
        second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        existing = _persist_summary(sqlite_session, dataset, document, first, enabled=False)
        existing.error = "old"
        existing.disabled_by = "account-2"
        sqlite_session.commit()

        SummaryIndexService.batch_create_summary_records([first, second], dataset, status=SummaryStatus.NOT_STARTED)

        with sqlite_session_factory() as observer:
            rows = observer.scalars(
                select(DocumentSegmentSummary)
                .where(DocumentSegmentSummary.dataset_id == dataset.id)
                .order_by(DocumentSegmentSummary.chunk_id)
            ).all()
            assert [row.chunk_id for row in rows] == [first.id, second.id]
            assert all(row.status == SummaryStatus.NOT_STARTED for row in rows)
            assert all(row.enabled and row.error is None for row in rows)

    def test_update_error_persists_existing_and_missing_is_noop(
        self, sqlite_session: Session, sqlite_session_factory: sessionmaker[Session]
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment)

        SummaryIndexService.update_summary_record_error(segment, dataset, "generation failed")

        with sqlite_session_factory() as observer:
            stored = observer.get(DocumentSegmentSummary, summary.id)
            assert stored is not None
            assert (stored.status, stored.error) == (SummaryStatus.ERROR, "generation failed")
        other = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        SummaryIndexService.update_summary_record_error(other, dataset, "ignored")
        assert sqlite_session.scalar(select(func.count()).select_from(DocumentSegmentSummary)) == 1

    def test_generate_and_vectorize_creates_commits_and_returns_row(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, _, segment = _graph(sqlite_session)
        monkeypatch.setattr(
            SummaryIndexService,
            "generate_summary_for_segment",
            MagicMock(return_value=("generated", _usage())),
        )

        def vectorize(
            record: DocumentSegmentSummary,
            _segment: DocumentSegment,
            _dataset: Dataset,
            session: Session | None = None,
        ) -> None:
            record.status = SummaryStatus.COMPLETED
            record.summary_index_node_id = "node-1"
            sqlite_session.flush()

        monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize)

        result = SummaryIndexService.generate_and_vectorize_summary(
            segment, dataset, {"enable": True}, session=sqlite_session
        )

        assert (result.summary_content, result.status, result.summary_index_node_id) == (
            "generated",
            SummaryStatus.COMPLETED,
            "node-1",
        )

    def test_generate_failure_rolls_back_then_persists_error(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, status=SummaryStatus.NOT_STARTED)
        monkeypatch.setattr(
            SummaryIndexService,
            "generate_summary_for_segment",
            MagicMock(side_effect=RuntimeError("LLM failed")),
        )

        with pytest.raises(RuntimeError, match="LLM failed"):
            SummaryIndexService.generate_and_vectorize_summary(
                segment, dataset, {"enable": True}, session=sqlite_session
            )

        sqlite_session.refresh(summary)
        assert (summary.status, summary.error) == (SummaryStatus.ERROR, "LLM failed")

    @pytest.mark.parametrize(
        ("technique", "enabled", "doc_form"),
        [
            (IndexTechniqueType.ECONOMY, True, IndexStructureType.PARAGRAPH_INDEX),
            (IndexTechniqueType.HIGH_QUALITY, False, IndexStructureType.PARAGRAPH_INDEX),
            (IndexTechniqueType.HIGH_QUALITY, True, IndexStructureType.QA_INDEX),
        ],
    )
    def test_generate_document_skip_conditions(
        self,
        sqlite_session: Session,
        technique: IndexTechniqueType,
        enabled: bool,
        doc_form: IndexStructureType,
    ) -> None:
        dataset = _persist_dataset(sqlite_session, indexing_technique=technique)
        document = _persist_document(sqlite_session, dataset, doc_form=doc_form)

        assert SummaryIndexService.generate_summaries_for_document(dataset, document, {"enable": enabled}) == []

    def test_generate_document_filters_segments_and_continues_after_failure(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, first = _graph(sqlite_session)
        second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        _persist_segment(sqlite_session, dataset, document, segment_id="disabled", position=3, enabled=False)
        generated = DocumentSegmentSummary(
            dataset_id=dataset.id,
            document_id=document.id,
            chunk_id=first.id,
            summary_content="ok",
            status=SummaryStatus.COMPLETED,
        )
        generate = MagicMock(side_effect=[generated, RuntimeError("boom")])
        update_error = MagicMock()
        monkeypatch.setattr(SummaryIndexService, "generate_and_vectorize_summary", generate)
        monkeypatch.setattr(SummaryIndexService, "update_summary_record_error", update_error)

        result = SummaryIndexService.generate_summaries_for_document(
            dataset,
            document,
            {"enable": True},
            segment_ids=[first.id, second.id],
            only_parent_chunks=True,
        )

        assert result == [generated]
        assert [call.args[0].id for call in generate.call_args_list] == [first.id, second.id]
        update_error.assert_called_once()


class TestEnableDisableDelete:
    def test_disable_filters_ids_deletes_vectors_and_persists_flags(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset, document, first = _graph(sqlite_session)
        second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        selected = _persist_summary(sqlite_session, dataset, document, first, node_id="node-1")
        untouched = _persist_summary(sqlite_session, dataset, document, second, summary_id="sum-2", node_id="node-2")
        vector = MagicMock(name="vector")
        monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

        SummaryIndexService.disable_summaries_for_segments(dataset, segment_ids=[first.id], disabled_by="account-2")

        vector.delete_by_ids.assert_called_once_with(["node-1"])
        with sqlite_session_factory() as observer:
            stored_selected = observer.get(DocumentSegmentSummary, selected.id)
            stored_untouched = observer.get(DocumentSegmentSummary, untouched.id)
            assert stored_selected is not None
            assert stored_untouched is not None
            assert stored_selected.enabled is False
            assert stored_selected.disabled_by == "account-2"
            assert stored_selected.disabled_at is not None
            assert stored_untouched.enabled is True

    def test_disable_survives_vector_delete_failure(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, node_id="node-1")
        vector = MagicMock(name="vector")
        vector.delete_by_ids.side_effect = RuntimeError("vector unavailable")
        monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

        SummaryIndexService.disable_summaries_for_segments(dataset)

        sqlite_session.refresh(summary)
        assert summary.enabled is False

    def test_enable_revectorizes_only_eligible_segments(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, good = _graph(sqlite_session)
        disabled_segment = _persist_segment(
            sqlite_session, dataset, document, segment_id="seg-2", position=2, enabled=False
        )
        blank_segment = _persist_segment(sqlite_session, dataset, document, segment_id="seg-3", position=3)
        good_summary = _persist_summary(sqlite_session, dataset, document, good, enabled=False)
        _persist_summary(sqlite_session, dataset, document, disabled_segment, summary_id="sum-2", enabled=False)
        _persist_summary(
            sqlite_session,
            dataset,
            document,
            blank_segment,
            summary_id="sum-3",
            content="",
            enabled=False,
        )

        def vectorize(
            record: DocumentSegmentSummary,
            _segment: DocumentSegment,
            _dataset: Dataset,
            session: Session | None = None,
        ) -> None:
            record.status = SummaryStatus.COMPLETED
            sqlite_session.flush()

        vectorize_mock = MagicMock(side_effect=vectorize)
        monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

        SummaryIndexService.enable_summaries_for_segments(dataset)

        sqlite_session.refresh(good_summary)
        assert good_summary.enabled is True
        assert vectorize_mock.call_count == 1
        assert vectorize_mock.call_args.args[1].id == good.id

    def test_enable_skips_economy_dataset(self, sqlite_session: Session) -> None:
        dataset = _persist_dataset(sqlite_session, indexing_technique=IndexTechniqueType.ECONOMY)
        SummaryIndexService.enable_summaries_for_segments(dataset)

    def test_enable_keeps_failed_summary_disabled(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, enabled=False)
        monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

        SummaryIndexService.enable_summaries_for_segments(dataset)

        sqlite_session.refresh(summary)
        assert summary.enabled is False

    def test_delete_is_dataset_and_segment_scoped(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, first = _graph(sqlite_session)
        second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        deleted = _persist_summary(sqlite_session, dataset, document, first, node_id="node-1")
        kept = _persist_summary(sqlite_session, dataset, document, second, summary_id="sum-2", node_id="node-2")
        vector = MagicMock(name="vector")
        monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

        SummaryIndexService.delete_summaries_for_segments(dataset, segment_ids=[first.id], session=sqlite_session)

        assert sqlite_session.get(DocumentSegmentSummary, deleted.id) is None
        assert sqlite_session.get(DocumentSegmentSummary, kept.id) is not None
        vector.delete_by_ids.assert_called_once_with(["node-1"])


class TestManualUpdate:
    def test_skips_economy_and_qa_documents(self, sqlite_session: Session) -> None:
        economy = _persist_dataset(sqlite_session, indexing_technique=IndexTechniqueType.ECONOMY)
        document = _persist_document(sqlite_session, economy)
        segment = _persist_segment(sqlite_session, economy, document)
        assert SummaryIndexService.update_summary_for_segment(segment, economy, "new", session=sqlite_session) is None

        quality = _persist_dataset(sqlite_session, dataset_id="dataset-2")
        qa_document = _persist_document(
            sqlite_session, quality, document_id="doc-2", doc_form=IndexStructureType.QA_INDEX
        )
        qa_segment = _persist_segment(sqlite_session, quality, qa_document, segment_id="seg-2")
        assert (
            SummaryIndexService.update_summary_for_segment(qa_segment, quality, "new", session=sqlite_session) is None
        )

    def test_empty_content_deletes_record_even_when_vector_delete_fails(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, node_id="node-1")
        vector = MagicMock(name="vector")
        vector.delete_by_ids.side_effect = RuntimeError("boom")
        monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

        result = SummaryIndexService.update_summary_for_segment(segment, dataset, "   ", session=sqlite_session)

        assert result is None
        assert sqlite_session.get(DocumentSegmentSummary, summary.id) is None

    def test_empty_content_without_record_is_noop(self, sqlite_session: Session) -> None:
        dataset, _, segment = _graph(sqlite_session)
        assert SummaryIndexService.update_summary_for_segment(segment, dataset, "", session=sqlite_session) is None

    def test_existing_record_updates_vectorizes_and_commits(
        self,
        sqlite_session: Session,
        sqlite_session_factory: sessionmaker[Session],
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, content="old", node_id="old-node")
        vector = MagicMock(name="vector")
        monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector))

        def vectorize(
            record: DocumentSegmentSummary,
            _segment: DocumentSegment,
            _dataset: Dataset,
            session: Session | None = None,
        ) -> None:
            record.status = SummaryStatus.COMPLETED
            record.summary_index_node_hash = "new-hash"
            sqlite_session.flush()

        monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize)

        result = SummaryIndexService.update_summary_for_segment(segment, dataset, "new", session=sqlite_session)

        assert result is not None
        vector.delete_by_ids.assert_called_once_with(["old-node"])
        with sqlite_session_factory() as observer:
            stored = observer.get(DocumentSegmentSummary, summary.id)
            assert stored is not None
            assert (stored.summary_content, stored.status, stored.summary_index_node_hash) == (
                "new",
                SummaryStatus.COMPLETED,
                "new-hash",
            )

    def test_new_record_is_persisted(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        dataset, _, segment = _graph(sqlite_session)

        def vectorize(
            record: DocumentSegmentSummary,
            _segment: DocumentSegment,
            _dataset: Dataset,
            session: Session | None = None,
        ) -> None:
            record.status = SummaryStatus.COMPLETED
            sqlite_session.flush()

        monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize)

        result = SummaryIndexService.update_summary_for_segment(segment, dataset, "new", session=sqlite_session)

        assert result is not None
        assert sqlite_session.get(DocumentSegmentSummary, result.id) is result
        assert result.status == SummaryStatus.COMPLETED

    def test_vector_failure_returns_persisted_error_record(
        self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, content="old")
        monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

        result = SummaryIndexService.update_summary_for_segment(segment, dataset, "new", session=sqlite_session)

        assert result is summary
        assert (result.summary_content, result.status, result.error) == (
            "new",
            SummaryStatus.ERROR,
            "Vectorization failed: boom",
        )
        sqlite_session.refresh(summary)
        assert summary.status == SummaryStatus.ERROR

    def test_flush_failure_rolls_back_then_records_error(self, sqlite_session: Session) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, content="old")
        calls = 0

        def fail_first_flush(_session: Session, _context: object, _instances: object) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise RuntimeError("flush boom")

        event.listen(sqlite_session, "before_flush", fail_first_flush)
        try:
            with pytest.raises(RuntimeError, match="flush boom"):
                SummaryIndexService.update_summary_for_segment(segment, dataset, "new", session=sqlite_session)
        finally:
            event.remove(sqlite_session, "before_flush", fail_first_flush)

        sqlite_session.refresh(summary)
        assert (summary.status, summary.error) == (SummaryStatus.ERROR, "flush boom")


class TestReadModels:
    def test_getters_filter_dataset_document_segments_and_enabled(self, sqlite_session: Session) -> None:
        dataset, document, first = _graph(sqlite_session)
        second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        first_summary = _persist_summary(sqlite_session, dataset, document, first, status=SummaryStatus.COMPLETED)
        _persist_summary(sqlite_session, dataset, document, second, summary_id="sum-2", enabled=False)
        other_dataset = _persist_dataset(sqlite_session, dataset_id="dataset-2")
        other_document = _persist_document(sqlite_session, other_dataset, document_id="doc-2")
        other_segment = _persist_segment(sqlite_session, other_dataset, other_document, segment_id="seg-3")
        _persist_summary(sqlite_session, other_dataset, other_document, other_segment, summary_id="sum-3")

        assert SummaryIndexService.get_segment_summary(first.id, dataset.id, session=sqlite_session) is first_summary
        assert SummaryIndexService.get_segment_summary(second.id, dataset.id, session=sqlite_session) is None
        assert SummaryIndexService.get_segments_summaries(
            [first.id, second.id, other_segment.id], dataset.id, session=sqlite_session
        ) == {first.id: first_summary}
        assert SummaryIndexService.get_segments_summaries([], dataset.id, session=sqlite_session) == {}
        assert SummaryIndexService.get_document_summaries(
            document.id, dataset.id, [first.id, second.id], session=sqlite_session
        ) == [first_summary]

    def test_single_document_status_uses_real_pending_rows_and_tenant_scope(self, sqlite_session: Session) -> None:
        dataset, document, segment = _graph(sqlite_session)
        summary = _persist_summary(sqlite_session, dataset, document, segment, status=SummaryStatus.GENERATING)

        assert (
            SummaryIndexService.get_document_summary_index_status(
                document.id, dataset.id, TENANT_ID, session=sqlite_session
            )
            == "SUMMARIZING"
        )
        summary.status = SummaryStatus.COMPLETED
        sqlite_session.commit()
        assert (
            SummaryIndexService.get_document_summary_index_status(
                document.id, dataset.id, TENANT_ID, session=sqlite_session
            )
            is None
        )
        assert (
            SummaryIndexService.get_document_summary_index_status(
                document.id, dataset.id, OTHER_TENANT_ID, session=sqlite_session
            )
            is None
        )

    def test_multiple_document_status_groups_real_rows(self, sqlite_session: Session) -> None:
        dataset = _persist_dataset(sqlite_session)
        first_doc = _persist_document(sqlite_session, dataset, document_id="doc-1")
        second_doc = _persist_document(sqlite_session, dataset, document_id="doc-2")
        first_segment = _persist_segment(sqlite_session, dataset, first_doc, segment_id="seg-1")
        second_segment = _persist_segment(sqlite_session, dataset, second_doc, segment_id="seg-2")
        _persist_summary(sqlite_session, dataset, first_doc, first_segment, status=SummaryStatus.NOT_STARTED)
        _persist_summary(
            sqlite_session,
            dataset,
            second_doc,
            second_segment,
            summary_id="sum-2",
            status=SummaryStatus.COMPLETED,
        )

        result = SummaryIndexService.get_documents_summary_index_status(
            [first_doc.id, second_doc.id, "missing"], dataset.id, TENANT_ID, session=sqlite_session
        )

        assert result == {first_doc.id: "SUMMARIZING", second_doc.id: None, "missing": None}
        assert (
            SummaryIndexService.get_documents_summary_index_status([], dataset.id, TENANT_ID, session=sqlite_session)
            == {}
        )

    def test_status_detail_counts_and_previews(self, sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
        dataset, document, first = _graph(sqlite_session)
        second = _persist_segment(sqlite_session, dataset, document, segment_id="seg-2", position=2)
        created_at = datetime(2026, 1, 1)
        _persist_summary(
            sqlite_session,
            dataset,
            document,
            first,
            content="x" * 150,
            status=SummaryStatus.COMPLETED,
            created_at=created_at,
        )
        segment_service = SimpleNamespace(get_segments_by_document_and_dataset=MagicMock(return_value=[first, second]))
        monkeypatch.setitem(sys.modules, "services.dataset_service", SimpleNamespace(SegmentService=segment_service))

        detail = SummaryIndexService.get_document_summary_status_detail(document.id, dataset.id, sqlite_session)

        assert detail["total_segments"] == 2
        assert detail["summary_status"]["completed"] == 1
        assert detail["summary_status"]["not_started"] == 1
        assert detail["summaries"][0]["summary_preview"] == "x" * 100 + "..."
        assert detail["summaries"][0]["created_at"] == int(created_at.timestamp())
        assert detail["summaries"][1]["status"] == SummaryStatus.NOT_STARTED
