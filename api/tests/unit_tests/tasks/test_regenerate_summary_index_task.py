"""Regression tests for regenerate-summary task transaction rollover."""

import logging
from unittest.mock import MagicMock

import pytest

import tasks.regenerate_summary_index_task as task_module
from core.rag.datasource.vdb import vector_factory
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, DocumentSegment, DocumentSegmentSummary
from models.dataset import Document as DatasetDocument
from models.enums import SummaryStatus


class _Rows:
    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def all(self) -> list[object]:
        return self._rows


def _dataset() -> Dataset:
    dataset = Dataset()
    dataset.id = "dataset-1"
    dataset.indexing_technique = IndexTechniqueType.HIGH_QUALITY
    dataset.summary_index_setting = {"enable": True, "model_name": "summary-model"}
    return dataset


def _document() -> DatasetDocument:
    document = DatasetDocument()
    document.id = "document-1"
    document.doc_form = IndexStructureType.PARAGRAPH_INDEX
    return document


def _segment() -> DocumentSegment:
    segment = DocumentSegment(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        document_id="document-1",
        position=1,
        content="segment content",
        word_count=2,
        tokens=2,
        created_by="account-1",
    )
    segment.id = "segment-1"
    return segment


def _summary(*, enabled: bool = True) -> DocumentSegmentSummary:
    summary = DocumentSegmentSummary(
        dataset_id="dataset-1",
        document_id="document-1",
        chunk_id="segment-1",
        summary_index_node_id="old-node",
        summary_content="summary",
        status=SummaryStatus.COMPLETED,
        enabled=enabled,
    )
    summary.id = "summary-1"
    return summary


class _TrackedSessionContext:
    def __init__(self, session: MagicMock) -> None:
        self.session = session
        self.active = False
        self.transaction_active = False

    def __enter__(self) -> MagicMock:
        self.active = True
        return self.session

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.active = False
        self.transaction_active = False

    def query(self, result: object) -> object:
        self.transaction_active = True
        return result


def test_revectorization_rolls_over_loader_transaction_before_external_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary()
    session = MagicMock()
    context = _TrackedSessionContext(session)
    session.scalar.side_effect = lambda *_args: context.query(dataset)
    session.execute.side_effect = lambda *_args: context.query(_Rows([(segment, summary)]))
    session.in_transaction.side_effect = lambda: context.transaction_active
    session.commit.side_effect = lambda: setattr(context, "transaction_active", False)
    monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=context))

    callback_state: list[tuple[bool, bool]] = []

    def vectorize(*_args: object) -> None:
        callback_state.append((context.active, session.in_transaction()))
        raise RuntimeError("external vectorization failed")

    vectorize_mock = MagicMock(side_effect=vectorize)
    monkeypatch.setattr(task_module.SummaryIndexService, "vectorize_summary", vectorize_mock)
    vector_cls = MagicMock()
    monkeypatch.setattr(vector_factory, "Vector", vector_cls)

    task_module.regenerate_summary_index_task.run("dataset-1", regenerate_vectors_only=True)

    vectorize_mock.assert_called_once_with(summary, segment, dataset)
    assert callback_state == [(True, False)]
    session.commit.assert_called_once()
    session.add.assert_not_called()
    vector_cls.assert_not_called()


def test_revectorization_does_not_use_an_older_enabled_duplicate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    segment = _segment()
    canonical_disabled = _summary(enabled=False)
    canonical_disabled.id = "summary-new"
    canonical_disabled.summary_content = "new"
    older_enabled = _summary()
    older_enabled.id = "summary-old"
    older_enabled.summary_content = "old"
    session = MagicMock()
    context = _TrackedSessionContext(session)
    session.scalar.side_effect = lambda *_args: context.query(dataset)
    executed_statements: list[object] = []

    def execute(statement: object) -> object:
        executed_statements.append(statement)
        return context.query(_Rows([(segment, canonical_disabled), (segment, older_enabled)]))

    session.execute.side_effect = execute
    monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=context))
    vectorize_mock = MagicMock()
    monkeypatch.setattr(task_module.SummaryIndexService, "vectorize_summary", vectorize_mock)

    task_module.regenerate_summary_index_task.run("dataset-1", regenerate_vectors_only=True)

    vectorize_mock.assert_not_called()
    statement_sql = str(executed_statements[0])
    assert "document_segment_summaries.updated_at DESC" in statement_sql
    assert "document_segment_summaries.id DESC" in statement_sql


def test_regeneration_rolls_over_lookup_transaction_before_external_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dataset = _dataset()
    setting = dataset.summary_index_setting
    assert setting is not None
    document = _document()
    segment = _segment()
    summary = _summary()
    session = MagicMock()
    context = _TrackedSessionContext(session)
    scalar_results = iter([dataset, summary])
    session.scalar.side_effect = lambda *_args: context.query(next(scalar_results))
    scalar_batches = iter([[document], [segment]])
    session.scalars.side_effect = lambda *_args: context.query(_Rows(next(scalar_batches)))
    session.in_transaction.side_effect = lambda: context.transaction_active
    session.commit.side_effect = lambda: setattr(context, "transaction_active", False)
    monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=context))

    callback_state: list[tuple[bool, bool]] = []

    def generate(*_args: object) -> None:
        callback_state.append((context.active, session.in_transaction()))
        raise RuntimeError("external generation failed")

    generate_mock = MagicMock(side_effect=generate)
    monkeypatch.setattr(task_module.SummaryIndexService, "generate_and_vectorize_summary", generate_mock)

    task_module.regenerate_summary_index_task.run("dataset-1")

    generate_mock.assert_called_once_with(segment, dataset, setting)
    assert callback_state == [(True, False)]
    session.commit.assert_called_once()
    session.add.assert_not_called()


def test_revectorization_treats_concurrent_supersession_as_benign(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset()
    segment = _segment()
    summary = _summary()
    session = MagicMock()
    context = _TrackedSessionContext(session)
    session.scalar.side_effect = lambda *_args: context.query(dataset)
    session.execute.side_effect = lambda *_args: context.query(_Rows([(segment, summary)]))
    monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=context))
    vectorize_mock = MagicMock(side_effect=task_module.SummaryIndexConflictError("superseded"))
    monkeypatch.setattr(task_module.SummaryIndexService, "vectorize_summary", vectorize_mock)

    with caplog.at_level(logging.INFO, logger=task_module.__name__):
        task_module.regenerate_summary_index_task.run("dataset-1", regenerate_vectors_only=True)

    vectorize_mock.assert_called_once_with(summary, segment, dataset)
    assert "Summary re-vectorization for segment segment-1 was superseded" in caplog.text
    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]


def test_regeneration_treats_concurrent_supersession_as_benign(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    dataset = _dataset()
    document = _document()
    segment = _segment()
    summary = _summary()
    session = MagicMock()
    context = _TrackedSessionContext(session)
    scalar_results = iter([dataset, summary])
    session.scalar.side_effect = lambda *_args: context.query(next(scalar_results))
    scalar_batches = iter([[document], [segment]])
    session.scalars.side_effect = lambda *_args: context.query(_Rows(next(scalar_batches)))
    session.in_transaction.side_effect = lambda: context.transaction_active
    session.commit.side_effect = lambda: setattr(context, "transaction_active", False)
    monkeypatch.setattr(task_module.session_factory, "create_session", MagicMock(return_value=context))
    generate_mock = MagicMock(side_effect=task_module.SummaryIndexConflictError("superseded"))
    monkeypatch.setattr(task_module.SummaryIndexService, "generate_and_vectorize_summary", generate_mock)

    with caplog.at_level(logging.INFO, logger=task_module.__name__):
        task_module.regenerate_summary_index_task.run("dataset-1")

    generate_mock.assert_called_once_with(segment, dataset, dataset.summary_index_setting)
    assert "Summary regeneration for segment segment-1 was superseded" in caplog.text
    assert not [record for record in caplog.records if record.levelno >= logging.ERROR]
