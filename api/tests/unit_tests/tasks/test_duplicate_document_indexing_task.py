"""Unit tests for queue/wrapper behaviors in duplicate document indexing tasks (non-database logic)."""

import uuid
from unittest.mock import Mock, patch

import pytest

from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from tasks.duplicate_document_indexing_task import (
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


class TestDuplicateDocumentIndexingTask:
    """Tests for the deprecated duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task", autospec=True)
    def test_duplicate_document_indexing_task_calls_core_function(self, mock_core_func, dataset_id, document_ids):
        """Test that duplicate_document_indexing_task calls the core _duplicate_document_indexing_task function."""
        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

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
