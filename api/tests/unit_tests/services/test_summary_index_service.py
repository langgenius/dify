"""Unit tests for services.summary_index_service."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import services.summary_index_service as summary_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.enums import SegmentStatus, SummaryStatus
from services.summary_index_service import SummaryIndexService


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
    record.updated_at = datetime(2024, 1, 1, tzinfo=UTC)
    record.disabled_at = None
    record.disabled_by = None
    return record


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

    content, got_usage = SummaryIndexService.generate_summary_for_segment(segment, dataset, {"a": 1})
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

    with pytest.raises(ValueError, match="Generated summary is empty"):
        SummaryIndexService.generate_summary_for_segment(_segment(), _dataset(), {"a": 1})


def test_create_summary_record_updates_existing_and_reenables(monkeypatch: pytest.MonkeyPatch) -> None:
    existing = _summary_record(summary_content="old", node_id="n1")
    existing.enabled = False
    existing.disabled_at = datetime(2024, 1, 1)
    existing.disabled_by = "u"

    session = MagicMock(name="session")
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = existing
    session.query.return_value = query

    create_session_mock = MagicMock(return_value=_SessionContext(session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    segment = _segment()
    dataset = _dataset()

    result = SummaryIndexService.create_summary_record(segment, dataset, "new", status=SummaryStatus.GENERATING)
    assert result is existing
    assert existing.summary_content == "new"
    assert existing.status == SummaryStatus.GENERATING
    assert existing.enabled is True
    assert existing.disabled_at is None
    assert existing.disabled_by is None
    assert existing.error is None
    session.add.assert_called_once_with(existing)
    session.flush.assert_called_once()


def test_create_summary_record_creates_new(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock(name="session")
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = None
    session.query.return_value = query

    create_session_mock = MagicMock(return_value=_SessionContext(session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    record = SummaryIndexService.create_summary_record(_segment(), _dataset(), "new", status=SummaryStatus.GENERATING)
    assert record.dataset_id == "dataset-1"
    assert record.chunk_id == "seg-1"
    assert record.summary_content == "new"
    assert record.enabled is True
    session.add.assert_called_once()
    session.flush.assert_called_once()


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
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))

    embedding_model = MagicMock()
    embedding_model.get_text_embedding_num_tokens.return_value = [5]
    model_manager = MagicMock()
    model_manager.get_model_instance.return_value = embedding_model
    monkeypatch.setattr(summary_module, "ModelManager", MagicMock(return_value=model_manager))

    vector_instance = MagicMock()
    vector_instance.add_texts.side_effect = [RuntimeError("connection timeout"), None]
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))

    session = MagicMock(name="provided_session")
    merged = _summary_record(summary_content="sum")
    session.merge.return_value = merged
    monkeypatch.setattr(summary_module.time, "sleep", MagicMock())

    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=session)

    assert vector_instance.add_texts.call_count == 2
    summary_module.time.sleep.assert_called_once()  # type: ignore[attr-defined]
    session.flush.assert_called_once()
    assert summary.status == SummaryStatus.COMPLETED
    assert summary.summary_index_node_id == "uuid-1"
    assert summary.summary_index_node_hash == "hash-1"
    assert summary.tokens == 5


def test_vectorize_summary_without_session_creates_record_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id="old-node")

    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))

    # Force deletion branch to run and swallow delete failures.
    vector_for_delete = MagicMock()
    vector_for_delete.delete_by_ids.side_effect = RuntimeError("delete failed")
    vector_for_add = MagicMock()
    vector_for_add.add_texts.return_value = None
    vector_cls = MagicMock(side_effect=[vector_for_delete, vector_for_add])
    monkeypatch.setattr(summary_module, "Vector", vector_cls)

    model_manager = MagicMock()
    model_manager.get_model_instance.side_effect = RuntimeError("no model")
    monkeypatch.setattr(summary_module, "ModelManager", MagicMock(return_value=model_manager))

    # New session used after vectorization succeeds (record not found by id nor chunk_id).
    session = MagicMock(name="session")
    q1 = MagicMock()
    q1.filter_by.return_value = q1
    q1.first.side_effect = [None, None]
    session.query.return_value = q1

    create_session_mock = MagicMock(return_value=_SessionContext(session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)

    # One context for success path, no error handler session.
    create_session_mock.assert_called()
    session.add.assert_called()
    session.commit.assert_called_once()
    assert summary.status == SummaryStatus.COMPLETED
    assert summary.summary_index_node_id == "old-node"  # reused


def test_vectorize_summary_final_failure_updates_error_status(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
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
    q = MagicMock()
    q.filter_by.return_value = q
    q.first.return_value = summary
    error_session.query.return_value = q

    create_session_mock = MagicMock(return_value=_SessionContext(error_session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)

    assert summary.status == SummaryStatus.ERROR
    assert "Vectorization failed" in (summary.error or "")
    error_session.commit.assert_called_once()


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

    session = MagicMock()
    query = MagicMock()
    query.filter.return_value = query
    query.all.return_value = [existing]
    session.query.return_value = query

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.batch_create_summary_records([s1, s2], dataset, status=SummaryStatus.NOT_STARTED)
    session.commit.assert_called_once()
    assert existing.enabled is True


def test_update_summary_record_error_updates_when_exists(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record()

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.update_summary_record_error(segment, dataset, "err")
    assert record.status == SummaryStatus.ERROR
    assert record.error == "err"
    session.commit.assert_called_once()


def test_generate_and_vectorize_summary_success(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(
        SummaryIndexService, "generate_summary_for_segment", MagicMock(return_value=("sum", MagicMock(total_tokens=0)))
    )
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(return_value=None))

    out = SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})
    assert out is record
    session.refresh.assert_called_once_with(record)
    session.commit.assert_called()


def test_generate_and_vectorize_summary_vectorize_failure_sets_error(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(
        SummaryIndexService, "generate_summary_for_segment", MagicMock(return_value=("sum", MagicMock(total_tokens=0)))
    )
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})
    assert record.status == SummaryStatus.ERROR
    # Outer exception handler overwrites the error with the raw exception message.
    assert record.error == "boom"


def test_vectorize_summary_updates_existing_record_found_by_chunk_id(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))

    vector_instance = MagicMock()
    vector_instance.add_texts.return_value = None
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(
        summary_module,
        "ModelManager",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )

    existing = _summary_record(summary_content="old", node_id="old-node")
    existing.id = "other-id"
    session = MagicMock(name="session")
    q = MagicMock()
    q.filter_by.return_value = q
    q.first.side_effect = [None, existing]  # miss by id, hit by chunk_id
    session.query.return_value = q
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)
    session.commit.assert_called_once()
    assert existing.summary_index_node_id == "uuid-1"


def test_vectorize_summary_updates_existing_record_found_by_id(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module, "Vector", MagicMock(return_value=MagicMock(add_texts=MagicMock(return_value=None)))
    )
    monkeypatch.setattr(
        summary_module,
        "ModelManager",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )

    existing = _summary_record(summary_content="old", node_id="old-node")
    session = MagicMock(name="session")
    q = MagicMock()
    q.filter_by.return_value = q
    q.first.return_value = existing  # hit by id
    session.query.return_value = q
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)
    session.commit.assert_called_once()
    assert existing.summary_index_node_hash == "hash-1"


def test_vectorize_summary_session_enter_returns_none_triggers_runtime_error(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module, "Vector", MagicMock(return_value=MagicMock(add_texts=MagicMock(return_value=None)))
    )
    monkeypatch.setattr(
        summary_module,
        "ModelManager",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )

    class _BadContext:
        def __enter__(self):
            return None

        def __exit__(self, exc_type, exc, tb) -> None:
            return None

    error_session = MagicMock()
    q = MagicMock()
    q.filter_by.return_value = q
    q.first.return_value = summary
    error_session.query.return_value = q

    create_session_mock = MagicMock(side_effect=[_BadContext(), _SessionContext(error_session)])
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    with pytest.raises(RuntimeError, match="Session should not be None"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)


def test_vectorize_summary_created_record_becomes_none_triggers_guard(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary_record(summary_content="sum", node_id=None)

    monkeypatch.setattr(summary_module.uuid, "uuid4", MagicMock(return_value="uuid-1"))
    monkeypatch.setattr(summary_module.helper, "generate_text_hash", MagicMock(return_value="hash-1"))
    monkeypatch.setattr(
        summary_module, "Vector", MagicMock(return_value=MagicMock(add_texts=MagicMock(return_value=None)))
    )
    monkeypatch.setattr(
        summary_module,
        "ModelManager",
        MagicMock(return_value=MagicMock(get_model_instance=MagicMock(return_value=None))),
    )

    session = MagicMock()
    q = MagicMock()
    q.filter_by.return_value = q
    q.first.side_effect = [None, None]  # miss by id and chunk_id
    session.query.return_value = q

    error_session = MagicMock()
    eq = MagicMock()
    eq.filter_by.return_value = eq
    eq.first.return_value = summary
    error_session.query.return_value = eq

    create_session_mock = MagicMock(side_effect=[_SessionContext(session), _SessionContext(error_session)])
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    # Force the created record to be None so the "should not be None" guard triggers.
    monkeypatch.setattr(summary_module, "DocumentSegmentSummary", MagicMock(return_value=None))

    with pytest.raises(RuntimeError, match="summary_record_in_session should not be None"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)


def test_vectorize_summary_error_handler_tries_chunk_id_lookup_and_can_warn_not_found(
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
    q = MagicMock()
    q.filter_by.return_value = q
    q.first.side_effect = [None, None]  # not found by id, not found by chunk_id
    error_session.query.return_value = q

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(error_session))),
    )

    with pytest.raises(RuntimeError, match="boom"):
        SummaryIndexService.vectorize_summary(summary, segment, dataset, session=None)

    # No record -> no commit in error session.
    error_session.commit.assert_not_called()


def test_update_summary_record_error_warns_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = None
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    logger_mock = MagicMock()
    monkeypatch.setattr(summary_module, "logger", logger_mock)

    SummaryIndexService.update_summary_record_error(segment, dataset, "err")
    logger_mock.warning.assert_called_once()


def test_generate_and_vectorize_summary_creates_missing_record_and_logs_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = None
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    usage = MagicMock(total_tokens=4, prompt_tokens=1, completion_tokens=3)
    monkeypatch.setattr(SummaryIndexService, "generate_summary_for_segment", MagicMock(return_value=("sum", usage)))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(return_value=None))

    logger_mock = MagicMock()
    monkeypatch.setattr(summary_module, "logger", logger_mock)

    result = SummaryIndexService.generate_and_vectorize_summary(segment, dataset, {"enable": True})
    assert result.status in {SummaryStatus.GENERATING, SummaryStatus.COMPLETED}
    logger_mock.info.assert_called()


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
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = [seg1, seg2]
    session.query.return_value = query

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
    update_err_mock.assert_called_once()


def test_generate_summaries_for_document_no_segments_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    document = MagicMock(spec=summary_module.DatasetDocument)
    document.id = "doc-1"
    document.doc_form = IndexStructureType.PARAGRAPH_INDEX

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = []
    session.query.return_value = query
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
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = [seg]
    session.query.return_value = query
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
        segment_ids=[seg.id],
        only_parent_chunks=True,
    )
    query.filter.assert_called()


def test_disable_summaries_for_segments_handles_vector_delete_error(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    summary1 = _summary_record(summary_content="s", node_id="n1")
    summary2 = _summary_record(summary_content="s", node_id=None)

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = [summary1, summary2]
    session.query.return_value = query

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(
        summary_module,
        "Vector",
        MagicMock(return_value=MagicMock(delete_by_ids=MagicMock(side_effect=RuntimeError("boom")))),
    )
    monkeypatch.setitem(
        sys.modules, "libs.datetime_utils", SimpleNamespace(naive_utc_now=MagicMock(return_value=datetime(2024, 1, 1)))
    )

    SummaryIndexService.disable_summaries_for_segments(dataset, segment_ids=["seg-1"], disabled_by="u")
    assert summary1.enabled is False
    assert summary1.disabled_by == "u"
    session.commit.assert_called_once()


def test_disable_summaries_for_segments_no_summaries_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = []
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setitem(
        sys.modules, "libs.datetime_utils", SimpleNamespace(naive_utc_now=MagicMock(return_value=datetime(2024, 1, 1)))
    )
    SummaryIndexService.disable_summaries_for_segments(dataset)
    session.commit.assert_not_called()


def test_enable_summaries_for_segments_skips_non_high_quality() -> None:
    SummaryIndexService.enable_summaries_for_segments(_dataset(indexing_technique=IndexTechniqueType.ECONOMY))


def test_enable_summaries_for_segments_revectorizes_and_enables(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    summary = _summary_record(summary_content="sum", node_id="n1")
    summary.enabled = False

    segment = _segment()
    segment.id = summary.chunk_id
    segment.enabled = True
    segment.status = SegmentStatus.COMPLETED

    session = MagicMock()
    summary_query = MagicMock()
    summary_query.filter_by.return_value = summary_query
    summary_query.filter.return_value = summary_query
    summary_query.all.return_value = [summary]

    seg_query = MagicMock()
    seg_query.filter_by.return_value = seg_query
    seg_query.first.return_value = segment

    def query_side_effect(model: object) -> MagicMock:
        if model is summary_module.DocumentSegmentSummary:
            return summary_query
        return seg_query

    session.query.side_effect = query_side_effect

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    vec_mock = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vec_mock)

    SummaryIndexService.enable_summaries_for_segments(dataset, segment_ids=[summary.chunk_id])
    vec_mock.assert_called_once()
    assert summary.enabled is True
    session.commit.assert_called_once()


def test_enable_summaries_for_segments_no_summaries_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = []
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    SummaryIndexService.enable_summaries_for_segments(dataset)
    session.commit.assert_not_called()


def test_enable_summaries_for_segments_skips_segment_or_content_and_handles_vectorize_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    summary1 = _summary_record(summary_content="sum", node_id="n1")
    summary1.enabled = False
    summary2 = _summary_record(summary_content="", node_id="n2")
    summary2.enabled = False
    summary3 = _summary_record(summary_content="sum3", node_id="n3")
    summary3.enabled = False

    bad_segment = _segment()
    bad_segment.enabled = False
    bad_segment.status = SegmentStatus.COMPLETED

    good_segment = _segment()
    good_segment.enabled = True
    good_segment.status = SegmentStatus.COMPLETED

    session = MagicMock()
    summary_query = MagicMock()
    summary_query.filter_by.return_value = summary_query
    summary_query.filter.return_value = summary_query
    summary_query.all.return_value = [summary1, summary2, summary3]

    seg_query = MagicMock()
    seg_query.filter_by.return_value = seg_query
    seg_query.first.side_effect = [bad_segment, good_segment, good_segment]

    def query_side_effect(model: object) -> MagicMock:
        if model is summary_module.DocumentSegmentSummary:
            return summary_query
        return seg_query

    session.query.side_effect = query_side_effect
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    logger_mock = MagicMock()
    monkeypatch.setattr(summary_module, "logger", logger_mock)
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    SummaryIndexService.enable_summaries_for_segments(dataset)
    logger_mock.exception.assert_called_once()
    session.commit.assert_called_once()


def test_delete_summaries_for_segments_deletes_vectors_and_records(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    summary = _summary_record(summary_content="sum", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = [summary]
    session.query.return_value = query

    vector_instance = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    SummaryIndexService.delete_summaries_for_segments(dataset, segment_ids=[summary.chunk_id])
    vector_instance.delete_by_ids.assert_called_once_with(["n1"])
    session.delete.assert_called_once_with(summary)
    session.commit.assert_called_once()


def test_delete_summaries_for_segments_no_summaries_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.filter.return_value = query
    query.all.return_value = []
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    SummaryIndexService.delete_summaries_for_segments(dataset)
    session.commit.assert_not_called()


def test_update_summary_for_segment_skip_conditions() -> None:
    economy_dataset = _dataset(indexing_technique=IndexTechniqueType.ECONOMY)
    assert SummaryIndexService.update_summary_for_segment(_segment(), economy_dataset, "x") is None
    seg = _segment(has_document=True)
    seg.document.doc_form = IndexStructureType.QA_INDEX
    assert SummaryIndexService.update_summary_for_segment(seg, _dataset(), "x") is None


def test_update_summary_for_segment_empty_content_deletes_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query

    vector_instance = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    assert SummaryIndexService.update_summary_for_segment(segment, dataset, "   ") is None
    vector_instance.delete_by_ids.assert_called_once_with(["n1"])
    session.delete.assert_called_once_with(record)
    session.commit.assert_called_once()


def test_update_summary_for_segment_empty_content_delete_vector_warns(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    vector_instance = MagicMock()
    vector_instance.delete_by_ids.side_effect = RuntimeError("boom")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    logger_mock = MagicMock()
    monkeypatch.setattr(summary_module, "logger", logger_mock)

    assert SummaryIndexService.update_summary_for_segment(segment, dataset, "") is None
    logger_mock.warning.assert_called()


def test_update_summary_for_segment_empty_content_no_record_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = None
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    assert SummaryIndexService.update_summary_for_segment(segment, dataset, "   ") is None


def test_update_summary_for_segment_updates_existing_and_vectorizes(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query

    vector_instance = MagicMock()
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    vectorize_mock = MagicMock()
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

    out = SummaryIndexService.update_summary_for_segment(segment, dataset, "new summary")
    assert out is record
    vectorize_mock.assert_called_once()
    session.refresh.assert_called_once_with(record)
    session.commit.assert_called()


def test_update_summary_for_segment_existing_vector_delete_warns(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    vector_instance = MagicMock()
    vector_instance.delete_by_ids.side_effect = RuntimeError("boom")
    monkeypatch.setattr(summary_module, "Vector", MagicMock(return_value=vector_instance))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(return_value=None))
    logger_mock = MagicMock()
    monkeypatch.setattr(summary_module, "logger", logger_mock)

    SummaryIndexService.update_summary_for_segment(segment, dataset, "new")
    logger_mock.warning.assert_called()


def test_update_summary_for_segment_existing_vectorize_failure_returns_error_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(side_effect=RuntimeError("boom")))

    out = SummaryIndexService.update_summary_for_segment(segment, dataset, "new")
    assert out is record
    assert out.status == SummaryStatus.ERROR
    assert "Vectorization failed" in (out.error or "")


def test_update_summary_for_segment_new_record_success(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = None
    session.query.return_value = query
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    created = _summary_record(summary_content="new", node_id=None)
    monkeypatch.setattr(SummaryIndexService, "create_summary_record", MagicMock(return_value=created))
    session.merge.return_value = created
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", MagicMock(return_value=None))

    out = SummaryIndexService.update_summary_for_segment(segment, dataset, "new")
    assert out is created
    session.refresh.assert_called()
    session.commit.assert_called()


def test_update_summary_for_segment_outer_exception_sets_error_and_reraises(monkeypatch: pytest.MonkeyPatch) -> None:
    dataset = _dataset()
    segment = _segment()
    record = _summary_record(summary_content="old", node_id="n1")

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = record
    session.query.return_value = query
    session.flush.side_effect = RuntimeError("flush boom")
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    with pytest.raises(RuntimeError, match="flush boom"):
        SummaryIndexService.update_summary_for_segment(segment, dataset, "new")
    assert record.status == SummaryStatus.ERROR
    assert record.error == "flush boom"
    session.commit.assert_called()


def test_get_segment_summary_and_document_summaries(monkeypatch: pytest.MonkeyPatch) -> None:
    record = _summary_record(summary_content="sum", node_id="n1")
    session = MagicMock()

    q1 = MagicMock()
    q1.where.return_value = q1
    q1.first.return_value = record

    q2 = MagicMock()
    q2.filter.return_value = q2
    q2.all.return_value = [record]

    def query_side_effect(model: object) -> MagicMock:
        if model is summary_module.DocumentSegmentSummary:
            # first call used by get_segment_summary, second by get_document_summaries
            if not hasattr(query_side_effect, "_called"):
                query_side_effect._called = True  # type: ignore[attr-defined]
                return q1
            return q2
        return MagicMock()

    session.query.side_effect = query_side_effect
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    assert SummaryIndexService.get_segment_summary("seg-1", "dataset-1") is record
    assert SummaryIndexService.get_document_summaries("doc-1", "dataset-1", segment_ids=["seg-1"]) == [record]


def test_get_segments_summaries_non_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    record1 = _summary_record()
    record1.chunk_id = "seg-1"
    record2 = _summary_record()
    record2.chunk_id = "seg-2"
    session = MagicMock()
    q = MagicMock()
    q.where.return_value = q
    q.all.return_value = [record1, record2]
    session.query.return_value = q
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    out = SummaryIndexService.get_segments_summaries(["seg-1", "seg-2"], "dataset-1")
    assert set(out.keys()) == {"seg-1", "seg-2"}


def test_get_document_summary_index_status_no_segments_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    q = MagicMock()
    q.where.return_value = q
    q.all.return_value = []
    session.query.return_value = q
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    assert SummaryIndexService.get_document_summary_index_status("doc-1", "dataset-1", "tenant-1") is None


def test_get_documents_summary_index_status_empty_input(monkeypatch: pytest.MonkeyPatch) -> None:
    assert SummaryIndexService.get_documents_summary_index_status([], "dataset-1", "tenant-1") == {}


def test_get_documents_summary_index_status_no_pending_sets_none(monkeypatch: pytest.MonkeyPatch) -> None:
    session = MagicMock()
    q = MagicMock()
    q.where.return_value = q
    q.all.return_value = [SimpleNamespace(id="seg-1", document_id="doc-1")]
    session.query.return_value = q
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )
    monkeypatch.setattr(
        SummaryIndexService,
        "get_segments_summaries",
        MagicMock(return_value={"seg-1": SimpleNamespace(status=SummaryStatus.COMPLETED)}),
    )
    result = SummaryIndexService.get_documents_summary_index_status(["doc-1"], "dataset-1", "tenant-1")
    assert result["doc-1"] is None


def test_update_summary_for_segment_creates_new_and_vectorize_fails_returns_error_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()

    session = MagicMock()
    query = MagicMock()
    query.filter_by.return_value = query
    query.first.return_value = None
    session.query.return_value = query

    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session))),
    )

    created = _summary_record(summary_content="new", node_id=None)
    monkeypatch.setattr(SummaryIndexService, "create_summary_record", MagicMock(return_value=created))
    session.merge.return_value = created

    vectorize_mock = MagicMock(side_effect=RuntimeError("boom"))
    monkeypatch.setattr(SummaryIndexService, "vectorize_summary", vectorize_mock)

    out = SummaryIndexService.update_summary_for_segment(segment, dataset, "new")
    assert out.status == SummaryStatus.ERROR
    assert "Vectorization failed" in (out.error or "")


def test_get_segments_summaries_empty_list() -> None:
    assert SummaryIndexService.get_segments_summaries([], "dataset-1") == {}


def test_get_document_summary_index_status_and_documents_status(monkeypatch: pytest.MonkeyPatch) -> None:
    seg_row = SimpleNamespace(id="seg-1", document_id="doc-1")
    session = MagicMock()
    query = MagicMock()
    query.where.return_value = query
    query.all.return_value = [SimpleNamespace(id="seg-1")]
    session.query.return_value = query

    create_session_mock = MagicMock(return_value=_SessionContext(session))
    monkeypatch.setattr(summary_module, "session_factory", SimpleNamespace(create_session=create_session_mock))

    monkeypatch.setattr(
        SummaryIndexService,
        "get_segments_summaries",
        MagicMock(return_value={"seg-1": SimpleNamespace(status=SummaryStatus.GENERATING)}),
    )
    assert SummaryIndexService.get_document_summary_index_status("doc-1", "dataset-1", "tenant-1") == "SUMMARIZING"

    # Multiple docs
    query2 = MagicMock()
    query2.where.return_value = query2
    query2.all.return_value = [seg_row]
    session2 = MagicMock()
    session2.query.return_value = query2
    monkeypatch.setattr(
        summary_module,
        "session_factory",
        SimpleNamespace(create_session=MagicMock(return_value=_SessionContext(session2))),
    )
    monkeypatch.setattr(
        SummaryIndexService,
        "get_segments_summaries",
        MagicMock(return_value={"seg-1": SimpleNamespace(status=SummaryStatus.NOT_STARTED)}),
    )
    result = SummaryIndexService.get_documents_summary_index_status(["doc-1", "doc-2"], "dataset-1", "tenant-1")
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

    detail = SummaryIndexService.get_document_summary_status_detail("doc-1", "dataset-1")
    assert detail["total_segments"] == 2
    assert detail["summary_status"]["completed"] == 1
    assert detail["summary_status"]["not_started"] == 1
    assert detail["summaries"][0]["summary_preview"].endswith("...")
    assert detail["summaries"][1]["status"] == "not_started"
