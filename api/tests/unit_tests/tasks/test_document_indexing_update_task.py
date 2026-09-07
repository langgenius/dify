"""SQLite-backed tests for document update indexing and summary generation."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

import tasks.document_indexing_update_task as task_module
from core.indexing_runner import DocumentIsPausedError
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus
from tasks.document_indexing_update_task import document_indexing_update_task


@pytest.fixture
def task_harness(
    sqlite_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[MagicMock, MagicMock]:
    """Bind task-owned sessions to SQLite and keep only external boundaries mocked."""
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    runner = MagicMock()
    processor = MagicMock()
    monkeypatch.setattr(task_module, "IndexingRunner", MagicMock(return_value=runner))
    monkeypatch.setattr(
        task_module,
        "IndexProcessorFactory",
        MagicMock(return_value=MagicMock(init_index_processor=MagicMock(return_value=processor))),
    )
    return runner, processor


def _persist_rows(
    session: Session,
    *,
    indexing_technique: IndexTechniqueType = IndexTechniqueType.HIGH_QUALITY,
    summary_index_setting: dict | None = None,
    doc_form: IndexStructureType = IndexStructureType.PARAGRAPH_INDEX,
    need_summary: bool = True,
    with_segment: bool = False,
) -> tuple[Dataset, Document]:
    tenant_id = str(uuid.uuid4())
    dataset_id = str(uuid.uuid4())
    document_id = str(uuid.uuid4())
    created_by = str(uuid.uuid4())
    dataset = Dataset(
        id=dataset_id,
        tenant_id=tenant_id,
        name="Update dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        created_by=created_by,
        indexing_technique=indexing_technique,
        summary_index_setting=summary_index_setting,
    )
    document = Document(
        id=document_id,
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="document.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
        indexing_status=IndexingStatus.WAITING,
        doc_form=doc_form,
        need_summary=need_summary,
    )
    rows: list[object] = [dataset, document]
    if with_segment:
        rows.append(
            DocumentSegment(
                tenant_id=tenant_id,
                dataset_id=dataset_id,
                document_id=document_id,
                position=1,
                content="segment",
                word_count=1,
                tokens=1,
                created_by=created_by,
                index_node_id="node-1",
            )
        )
    session.add_all(rows)
    session.commit()
    return dataset, document


def _complete_indexing(documents: list[Document], _session: Session) -> None:
    for document in documents:
        document.indexing_status = IndexingStatus.COMPLETED


def test_queues_summary_when_all_persisted_conditions_match(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = _complete_indexing
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_called_once_with(dataset.id, document.id, None)
    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id).indexing_status == IndexingStatus.COMPLETED  # type: ignore[union-attr]


@pytest.mark.parametrize(
    ("dataset_changes", "document_changes"),
    [
        ({"indexing_technique": IndexTechniqueType.ECONOMY}, {}),
        ({"summary_index_setting": None}, {}),
        ({"summary_index_setting": {"enable": False}}, {}),
        ({"summary_index_setting": {"enable": True}}, {"need_summary": False}),
        (
            {"summary_index_setting": {"enable": True}},
            {"doc_form": IndexStructureType.QA_INDEX},
        ),
    ],
)
def test_skips_summary_when_persisted_eligibility_does_not_match(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
    dataset_changes: dict,
    document_changes: dict,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(
        sqlite_session,
        summary_index_setting={"enable": True},
    )
    for key, value in dataset_changes.items():
        setattr(dataset, key, value)
    for key, value in document_changes.items():
        setattr(document, key, value)
    sqlite_session.commit()
    runner.run.side_effect = _complete_indexing
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


@pytest.mark.parametrize(
    "error_factory",
    [
        lambda _document_id: RuntimeError("indexing failed"),
        lambda document_id: DocumentIsPausedError(f"{document_id} is paused"),
    ],
)
def test_skips_summary_when_indexing_fails_or_is_paused(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
    error_factory: Callable[[str], Exception],
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = error_factory(document.id)
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


def test_returns_without_opening_external_boundaries_when_document_is_missing(
    task_harness: tuple[MagicMock, MagicMock],
) -> None:
    runner, processor = task_harness

    document_indexing_update_task(str(uuid.uuid4()), str(uuid.uuid4()))

    runner.run.assert_not_called()
    processor.clean.assert_not_called()


def test_skips_summary_when_dataset_is_removed_after_indexing(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})

    def complete_and_remove(documents: list[Document], session: Session) -> None:
        _complete_indexing(documents, session)
        persisted_dataset = session.get(Dataset, dataset.id)
        assert persisted_dataset is not None
        session.delete(persisted_dataset)

    runner.run.side_effect = complete_and_remove
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


def test_skips_summary_when_runner_leaves_document_incomplete(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.return_value = None
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    delay.assert_not_called()


def test_queue_failure_is_swallowed_after_successful_indexing(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, _processor = task_harness
    dataset, document = _persist_rows(sqlite_session, summary_index_setting={"enable": True})
    runner.run.side_effect = _complete_indexing
    monkeypatch.setattr(
        task_module.generate_summary_index_task,
        "delay",
        MagicMock(side_effect=RuntimeError("queue unavailable")),
    )

    document_indexing_update_task(dataset.id, document.id)

    sqlite_session.expire_all()
    assert sqlite_session.get(Document, document.id).indexing_status == IndexingStatus.COMPLETED  # type: ignore[union-attr]


def test_cleans_and_deletes_persisted_segments_with_real_session(
    sqlite_session: Session,
    task_harness: tuple[MagicMock, MagicMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    runner, processor = task_harness
    dataset, document = _persist_rows(
        sqlite_session,
        summary_index_setting={"enable": True},
        with_segment=True,
    )
    runner.run.side_effect = _complete_indexing
    delay = MagicMock()
    monkeypatch.setattr(task_module.generate_summary_index_task, "delay", delay)

    document_indexing_update_task(dataset.id, document.id)

    processor.clean.assert_called_once()
    assert isinstance(processor.clean.call_args.kwargs["session"], Session)
    assert sqlite_session.scalars(select(DocumentSegment).where(DocumentSegment.document_id == document.id)).all() == []
    delay.assert_called_once_with(dataset.id, document.id, None)
