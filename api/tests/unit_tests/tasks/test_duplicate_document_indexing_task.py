"""Unit tests for queue/wrapper behaviors in duplicate document indexing tasks (non-database logic)."""

import uuid
from contextlib import nullcontext
from unittest.mock import Mock, patch

import pytest

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from models.dataset import Dataset, Document, DocumentSegment
from models.enums import DataSourceType, DocumentCreatedFrom, IndexingStatus, SegmentStatus
from services.feature_service import FeatureModel
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)


def _cleanup_rows() -> tuple[Dataset, Document, DocumentSegment]:
    dataset = Dataset(
        id="dataset-1",
        tenant_id="tenant-1",
        name="Dataset",
        data_source_type=DataSourceType.UPLOAD_FILE,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        created_by="account-1",
    )
    document = Document(
        id="document-1",
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        position=1,
        data_source_type=DataSourceType.UPLOAD_FILE,
        batch="batch-1",
        name="Document",
        created_from=DocumentCreatedFrom.WEB,
        created_by="account-1",
        indexing_status=IndexingStatus.ERROR,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    segment = DocumentSegment(
        tenant_id=dataset.tenant_id,
        dataset_id=dataset.id,
        document_id=document.id,
        position=1,
        content="old content",
        word_count=2,
        tokens=2,
        created_by="account-1",
        index_node_id="node-1",
        status=SegmentStatus.COMPLETED,
    )
    segment.id = "segment-1"
    return dataset, document, segment


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

    def test_core_cleanup_deletes_summary_vectors_with_dataset_scope(self) -> None:
        dataset, document, segment = _cleanup_rows()
        session = Mock()
        session.scalar.return_value = dataset
        document_rows = Mock()
        document_rows.all.return_value = [document]
        segment_rows = Mock()
        segment_rows.all.return_value = [segment]
        session.scalars.side_effect = [document_rows, segment_rows]
        processor = Mock()

        with (
            patch(
                "tasks.duplicate_document_indexing_task.session_factory.create_session",
                return_value=nullcontext(session),
            ),
            patch(
                "tasks.duplicate_document_indexing_task.FeatureService.get_features",
                return_value=FeatureModel(),
            ),
            patch("tasks.duplicate_document_indexing_task.IndexProcessorFactory") as processor_factory,
            patch("tasks.duplicate_document_indexing_task.IndexingRunner"),
        ):
            processor_factory.return_value.init_index_processor.return_value = processor
            _duplicate_document_indexing_task(dataset.id, [document.id])

        processor.clean.assert_called_once_with(
            dataset,
            [segment.index_node_id],
            with_keywords=True,
            delete_child_chunks=True,
            delete_summaries=True,
            segment_ids=[segment.id],
            session=session,
        )
        segment_queries = [str(call.args[0]) for call in session.scalars.call_args_list]
        delete_queries = [str(call.args[0]) for call in session.execute.call_args_list]
        assert "document_segments.dataset_id" in segment_queries[1]
        assert "document_segments.dataset_id" in delete_queries[0]

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
