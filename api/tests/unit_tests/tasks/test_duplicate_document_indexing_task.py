"""Unit tests for duplicate document indexing task behavior."""

import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)


@pytest.fixture
def tenant_id():
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id():
    return str(uuid.uuid4())


@pytest.fixture
def document_ids():
    return [str(uuid.uuid4()) for _ in range(3)]


@pytest.fixture
def mock_tenant_isolated_queue():
    with patch("tasks.duplicate_document_indexing_task.TenantIsolatedTaskQueue", autospec=True) as mock_queue_class:
        mock_queue = Mock(spec=TenantIsolatedTaskQueue)
        mock_queue.pull_tasks.return_value = []
        mock_queue.delete_task_key = Mock()
        mock_queue.set_task_waiting_time = Mock()
        mock_queue_class.return_value = mock_queue
        yield mock_queue


class _SessionContext:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, exc_type, exc, tb):
        return False


class TestDuplicateDocumentIndexingTask:
    """Tests for the deprecated duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_calls_core_function(self, mock_core_func, dataset_id, document_ids):
        """Test that duplicate_document_indexing_task calls the core _duplicate_document_indexing_task function."""
        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    def test_core_task_deletes_old_summaries_and_queues_summary_regeneration(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Duplicate indexing should refresh summary index data for replaced segments."""
        # Arrange
        dataset = SimpleNamespace(
            id="dataset-1",
            tenant_id="tenant-1",
            indexing_technique="high_quality",
            summary_index_setting={"enable": True},
        )
        document = SimpleNamespace(
            id="doc-1",
            dataset_id="dataset-1",
            doc_form="text",
            indexing_status="completed",
            need_summary=True,
        )
        indexed_document = SimpleNamespace(
            id="doc-1",
            dataset_id="dataset-1",
            doc_form="text",
            indexing_status="completed",
            need_summary=True,
        )
        segment = SimpleNamespace(id="segment-1", index_node_id="node-1")

        session = MagicMock()
        session.scalar.return_value = dataset
        session.scalars.side_effect = [
            MagicMock(all=MagicMock(return_value=[document])),
            MagicMock(all=MagicMock(return_value=[segment])),
            MagicMock(all=MagicMock(return_value=[indexed_document])),
        ]
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.session_factory.create_session",
            MagicMock(return_value=_SessionContext(session)),
        )

        features = SimpleNamespace(
            billing=SimpleNamespace(enabled=False),
            vector_space=SimpleNamespace(limit=0, size=0),
        )
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.FeatureService.get_features",
            MagicMock(return_value=features),
        )

        index_processor = MagicMock()
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.IndexProcessorFactory",
            MagicMock(return_value=MagicMock(init_index_processor=MagicMock(return_value=index_processor))),
        )

        indexing_runner = MagicMock()
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.IndexingRunner",
            MagicMock(return_value=indexing_runner),
        )

        delete_summaries_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.SummaryIndexService",
            SimpleNamespace(delete_summaries_for_segments=delete_summaries_mock),
            raising=False,
        )
        delay_mock = MagicMock()
        monkeypatch.setattr(
            "tasks.duplicate_document_indexing_task.generate_summary_index_task",
            SimpleNamespace(delay=delay_mock),
            raising=False,
        )

        # Act
        _duplicate_document_indexing_task("dataset-1", ["doc-1"])

        # Assert
        delete_summaries_mock.assert_called_once_with(dataset, segment_ids=["segment-1"])
        delay_mock.assert_called_once_with("dataset-1", "doc-1", None)

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_with_empty_document_ids(self, mock_core_func, dataset_id):
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
    def test_tenant_queue_wrapper_calls_core_function(
        self,
        mock_core_func,
        mock_tenant_isolated_queue,
        tenant_id,
        dataset_id,
        document_ids,
    ):
        """Test that tenant queue wrapper calls the core function."""
        # Arrange
        mock_task_func = Mock()

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_tenant_queue_wrapper_deletes_key_when_no_tasks(
        self,
        mock_core_func,
        mock_tenant_isolated_queue,
        tenant_id,
        dataset_id,
        document_ids,
    ):
        """Test that tenant queue wrapper deletes task key when no more tasks."""
        # Arrange
        mock_task_func = Mock()
        mock_tenant_isolated_queue.pull_tasks.return_value = []

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        mock_tenant_isolated_queue.delete_task_key.assert_called_once()

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_tenant_queue_wrapper_processes_next_tasks(
        self,
        mock_core_func,
        mock_tenant_isolated_queue,
        tenant_id,
        dataset_id,
        document_ids,
    ):
        """Test that tenant queue wrapper processes next tasks from queue."""
        # Arrange
        mock_task_func = Mock()
        next_task = {
            "tenant_id": tenant_id,
            "dataset_id": dataset_id,
            "document_ids": document_ids,
        }
        mock_tenant_isolated_queue.pull_tasks.return_value = [next_task]

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        mock_tenant_isolated_queue.set_task_waiting_time.assert_called_once()
        mock_task_func.delay.assert_called_once_with(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_tenant_queue_wrapper_handles_core_function_error(
        self,
        mock_core_func,
        mock_tenant_isolated_queue,
        tenant_id,
        dataset_id,
        document_ids,
    ):
        """Test that tenant queue wrapper handles errors from core function."""
        # Arrange
        mock_task_func = Mock()
        mock_core_func.side_effect = Exception("Core function error")

        # Act
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert
        # Should still check for next tasks even after error
        mock_tenant_isolated_queue.pull_tasks.assert_called_once()


class TestNormalDuplicateDocumentIndexingTask:
    """Tests for normal_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue", autospec=True)
    def test_normal_task_calls_tenant_queue_wrapper(
        self,
        mock_wrapper_func,
        tenant_id,
        dataset_id,
        document_ids,
    ):
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
        mock_wrapper_func,
        tenant_id,
        dataset_id,
    ):
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
        mock_wrapper_func,
        tenant_id,
        dataset_id,
        document_ids,
    ):
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
        mock_wrapper_func,
        tenant_id,
        dataset_id,
    ):
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
        mock_wrapper_func,
        tenant_id,
        dataset_id,
    ):
        """Test priority task with large batch of documents."""
        # Arrange
        document_ids = [f"doc-{i}" for i in range(100)]

        # Act
        priority_duplicate_document_indexing_task(tenant_id, dataset_id, document_ids)

        # Assert
        mock_wrapper_func.assert_called_once_with(
            tenant_id, dataset_id, document_ids, priority_duplicate_document_indexing_task
        )
