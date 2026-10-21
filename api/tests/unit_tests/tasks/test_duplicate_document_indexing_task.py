"""Unit tests for duplicate document indexing tasks.

Queue/wrapper behaviors use mocks; summary cleanup and regeneration run against SQLite.
"""

import json
import uuid
from collections.abc import Iterator, Sequence
from unittest.mock import MagicMock, Mock, create_autospec, patch

import pytest
from sqlalchemy import Connection, Engine, select
from sqlalchemy.orm import Session

import tasks.duplicate_document_indexing_task as task_module
from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from models.dataset import Dataset, Document, DocumentSegment, DocumentSegmentSummary
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SummaryStatus
from services.knowledge.indexing.adapters.execution import build_document_indexing_service
from services.knowledge.indexing.errors import DocumentIsPausedError
from services.knowledge.resource_scope import DocumentRef
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)
from tasks.generate_summary_index_task import generate_summary_index_task


@pytest.fixture
def tenant_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id() -> str:
    return str(uuid.uuid4())


@pytest.fixture
def document_ids() -> list[str]:
    return [str(uuid.uuid4()) for _ in range(3)]


class TestDuplicateDocumentIndexingTask:
    """Tests for the deprecated duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_calls_core_function(
        self, mock_core_func: MagicMock, dataset_id: str, document_ids: list[str]
    ) -> None:
        """Test that duplicate_document_indexing_task calls the core _duplicate_document_indexing_task function."""
        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_with_empty_document_ids(
        self, mock_core_func: MagicMock, dataset_id: str
    ) -> None:
        """Test duplicate_document_indexing_task with empty document_ids list."""
        # Arrange
        document_ids = []

        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)


class TestDuplicateDocumentIndexingTaskWithTenantQueue:
    """Tests for _duplicate_document_indexing_task_with_tenant_queue function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    @pytest.mark.usefixtures("tenant_queue_commands")
    def test_tenant_queue_wrapper_calls_core_function(
        self,
        mock_core_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper calls the core function."""
        # Arrange
        mock_task_func = Mock()

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    @patch(
        "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task",
        new=create_autospec(_duplicate_document_indexing_task),
    )
    def test_tenant_queue_wrapper_deletes_key_when_no_tasks(
        self,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper deletes task key when no more tasks."""
        # Arrange
        mock_task_func = Mock()
        tenant_queue_commands.return_value = None

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_any_call("DEL", f"tenant_duplicate_document_indexing_task:{tenant_id}")

    @patch(
        "tasks.duplicate_document_indexing_task._duplicate_document_indexing_task",
        new=create_autospec(_duplicate_document_indexing_task),
    )
    def test_tenant_queue_wrapper_processes_next_tasks(
        self,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper processes next tasks from queue."""
        # Arrange
        mock_task_func = Mock()
        next_task = {
            "tenant_id": tenant_id,
            "dataset_id": dataset_id,
            "document_ids": document_ids,
        }
        tenant_queue_commands.side_effect = [json.dumps({"data": next_task}), None, None]

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        tenant_queue_commands.assert_any_call("SETEX", f"tenant_duplicate_document_indexing_task:{tenant_id}", 3600, 1)
        mock_task_func.delay.assert_called_once_with(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_tenant_queue_wrapper_handles_core_function_error(
        self,
        mock_core_func: MagicMock,
        tenant_queue_commands: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that tenant queue wrapper handles errors from core function."""
        # Arrange
        mock_task_func = Mock()
        mock_core_func.side_effect = Exception("Core function error")

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        # Should still check for next tasks even after error
        tenant_queue_commands.assert_any_call("RPOP", f"tenant_self_duplicate_document_indexing_task_queue:{tenant_id}")


class TestNormalDuplicateDocumentIndexingTask:
    """Tests for normal_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_normal_task_calls_tenant_queue_wrapper(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that normal task calls tenant queue wrapper."""
        # Act
        normal_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, normal_duplicate_document_indexing_task
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_normal_task_with_empty_document_ids(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
    ) -> None:
        """Test normal task with empty document_ids list."""
        # Arrange
        document_ids = []

        # Act
        normal_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, normal_duplicate_document_indexing_task
        )


class TestPriorityDuplicateDocumentIndexingTask:
    """Tests for priority_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_priority_task_calls_tenant_queue_wrapper(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
        document_ids: list[str],
    ) -> None:
        """Test that priority task calls tenant queue wrapper."""
        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_priority_task_with_single_document(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
    ) -> None:
        """Test priority task with single document."""
        # Arrange
        document_ids = ["doc-1"]

        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_priority_task_with_large_batch(
        self,
        mock_wrapper_func: MagicMock,
        tenant_id: str,
        dataset_id: str,
    ) -> None:
        """Test priority task with large batch of documents."""
        # Arrange
        document_ids = [f"doc-{i}" for i in range(100)]

        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )


@pytest.fixture
def summary_harness(sqlite_session: Session, monkeypatch: pytest.MonkeyPatch) -> Iterator[tuple[MagicMock, MagicMock]]:
    """Run the core task on SQLite with the real paragraph processor and mocked external indexes."""
    engine = sqlite_session.get_bind()
    monkeypatch.setattr(
        task_module.session_factory,
        "create_session",
        lambda: Session(engine, expire_on_commit=False),
    )
    build_service = create_autospec(build_document_indexing_service)
    monkeypatch.setattr(task_module, "build_document_indexing_service", build_service)
    with (
        patch("core.rag.index_processor.processor.paragraph_index_processor.Vector", autospec=True),
        patch("services.knowledge.summaries.adapters._delete_summary_vectors", autospec=True) as delete_vectors,
    ):
        yield build_service.return_value, delete_vectors


def _persist_document_with_summary(
    session: Session,
    *,
    dataset: Dataset | None = None,
    summary_enabled: bool = True,
    need_summary: bool = True,
) -> tuple[Dataset, Document, DocumentSegmentSummary]:
    created_by = str(uuid.uuid4())
    if dataset is None:
        dataset = Dataset(
            tenant_id=str(uuid.uuid4()),
            name="Duplicate dataset",
            data_source_type=DataSourceType.UPLOAD_FILE,
            created_by=created_by,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            summary_index_setting={"enable": summary_enabled},
        )
        session.add(dataset)
        session.flush()
    document = Document(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name=f"{uuid.uuid4()}.txt",
        created_from=DocumentCreatedFrom.WEB,
        created_by=created_by,
        indexing_status=IndexingStatus.WAITING,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        need_summary=need_summary,
    )
    session.add(document)
    session.flush()
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="segment",
        word_count=1,
        tokens=1,
        created_by=created_by,
        index_node_id=f"node-{document.id}",
    )
    session.add(segment)
    session.flush()
    summary = DocumentSegmentSummary(
        dataset_id=dataset.id,
        document_id=document.id,
        chunk_id=segment.id,
        summary_content="old summary",
        summary_index_node_id=f"summary-node-{document.id}",
        status=SummaryStatus.COMPLETED,
    )
    session.add(summary)
    session.commit()
    return dataset, document, summary


def _complete_indexing(refs: Sequence[DocumentRef], *, bind: Engine | Connection) -> None:
    with Session(bind) as writer, writer.begin():
        for ref in refs:
            document = writer.get(Document, ref.document_id)
            assert document is not None
            document.indexing_status = IndexingStatus.COMPLETED


class TestDuplicateDocumentIndexingSummaries:
    """Duplicate uploads must replace old summary index data instead of leaving it behind."""

    def test_deletes_old_summaries_and_queues_regeneration(
        self, sqlite_session: Session, summary_harness: tuple[MagicMock, MagicMock]
    ) -> None:
        indexing_service, delete_vectors = summary_harness
        dataset, document, summary = _persist_document_with_summary(sqlite_session)
        _, _, other_summary = _persist_document_with_summary(sqlite_session, dataset=dataset)
        dataset_id, document_id = dataset.id, document.id
        summary_id, other_summary_id = summary.id, other_summary.id
        indexing_service.run.side_effect = lambda refs: _complete_indexing(refs, bind=sqlite_session.get_bind())

        with patch.object(generate_summary_index_task, "delay") as delay:
            _duplicate_document_indexing_task(dataset_id, [document_id])

        sqlite_session.expire_all()
        remaining = set(sqlite_session.scalars(select(DocumentSegmentSummary.id)).all())
        assert summary_id not in remaining
        assert other_summary_id in remaining
        delete_vectors.assert_called_once()
        assert delete_vectors.call_args.args[1] == [f"summary-node-{document_id}"]
        delay.assert_called_once_with(dataset_id, document_id, None)

    @pytest.mark.parametrize(
        ("summary_enabled", "need_summary"),
        [(False, True), (True, False)],
    )
    def test_skips_regeneration_when_summary_is_not_requested(
        self,
        sqlite_session: Session,
        summary_harness: tuple[MagicMock, MagicMock],
        summary_enabled: bool,
        need_summary: bool,
    ) -> None:
        indexing_service, _ = summary_harness
        dataset, document, _ = _persist_document_with_summary(
            sqlite_session, summary_enabled=summary_enabled, need_summary=need_summary
        )
        indexing_service.run.side_effect = lambda refs: _complete_indexing(refs, bind=sqlite_session.get_bind())

        with patch.object(generate_summary_index_task, "delay") as delay:
            _duplicate_document_indexing_task(dataset.id, [document.id])

        delay.assert_not_called()

    @pytest.mark.parametrize(
        "error",
        [RuntimeError("indexing failed"), DocumentIsPausedError("paused")],
    )
    def test_skips_regeneration_when_indexing_does_not_finish(
        self,
        sqlite_session: Session,
        summary_harness: tuple[MagicMock, MagicMock],
        error: Exception,
    ) -> None:
        indexing_service, _ = summary_harness
        dataset, document, _ = _persist_document_with_summary(sqlite_session)
        indexing_service.run.side_effect = error

        with patch.object(generate_summary_index_task, "delay") as delay:
            _duplicate_document_indexing_task(dataset.id, [document.id])

        delay.assert_not_called()
