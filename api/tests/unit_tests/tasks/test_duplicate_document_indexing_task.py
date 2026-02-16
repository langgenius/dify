"""
Unit tests for duplicate document indexing tasks.

This module tests the duplicate document indexing task functionality including:
- Task enqueuing to different queues (normal, priority, tenant-isolated)
- Batch processing of multiple duplicate documents
- Progress tracking through task lifecycle
- Error handling and retry mechanisms
- Cleanup of old document data before re-indexing
"""

import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from models.dataset import Dataset, Document, DocumentSegment
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,
    _duplicate_document_indexing_task_with_tenant_queue,
    duplicate_document_indexing_task,
    normal_duplicate_document_indexing_task,
    priority_duplicate_document_indexing_task,
)

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def tenant_id():
    """Generate a unique tenant ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id():
    """Generate a unique dataset ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def document_ids():
    """Generate a list of document IDs for testing."""
    return [str(uuid.uuid4()) for _ in range(3)]


@pytest.fixture
def mock_dataset(dataset_id, tenant_id):
    """Create a mock Dataset object."""
    dataset = Mock(spec=Dataset)
    dataset.id = dataset_id
    dataset.tenant_id = tenant_id
    dataset.indexing_technique = "high_quality"
    dataset.embedding_model_provider = "openai"
    dataset.embedding_model = "text-embedding-ada-002"
    return dataset


@pytest.fixture
def mock_documents(document_ids, dataset_id):
    """Create mock Document objects."""
    documents = []
    for doc_id in document_ids:
        doc = Mock(spec=Document)
        doc.id = doc_id
        doc.dataset_id = dataset_id
        doc.indexing_status = "waiting"
        doc.error = None
        doc.stopped_at = None
        doc.processing_started_at = None
        doc.doc_form = "text_model"
        documents.append(doc)
    return documents


@pytest.fixture
def mock_document_segments(document_ids):
    """Create mock DocumentSegment objects."""
    segments = []
    for doc_id in document_ids:
        for i in range(3):
            segment = Mock(spec=DocumentSegment)
            segment.id = str(uuid.uuid4())
            segment.document_id = doc_id
            segment.index_node_id = f"node-{doc_id}-{i}"
            segments.append(segment)
    return segments


@pytest.fixture
def mock_db_session():
    """Mock database session via session_factory.create_session()."""
    with patch("tasks.duplicate_document_indexing_task.session_factory") as mock_sf:
        session = MagicMock()
        # Allow tests to observe session.close() via context manager teardown
        session.close = MagicMock()
        cm = MagicMock()
        cm.__enter__.return_value = session

        def _exit_side_effect(*args, **kwargs):
            session.close()

        cm.__exit__.side_effect = _exit_side_effect
        mock_sf.create_session.return_value = cm

        query = MagicMock()
        session.query.return_value = query
        query.where.return_value = query
        session.scalars.return_value = MagicMock()
        yield session


@pytest.fixture
def mock_indexing_runner():
    """Mock IndexingRunner."""
    with patch("tasks.duplicate_document_indexing_task.IndexingRunner") as mock_runner_class:
        mock_runner = MagicMock(spec=IndexingRunner)
        mock_runner_class.return_value = mock_runner
        yield mock_runner


@pytest.fixture
def mock_feature_service():
    """Mock FeatureService."""
    with patch("tasks.duplicate_document_indexing_task.FeatureService") as mock_service:
        mock_features = Mock()
        mock_features.billing = Mock()
        mock_features.billing.enabled = False
        mock_features.vector_space = Mock()
        mock_features.vector_space.size = 0
        mock_features.vector_space.limit = 1000
        mock_service.get_features.return_value = mock_features
        yield mock_service


@pytest.fixture
def mock_index_processor_factory():
    """Mock IndexProcessorFactory."""
    with patch("tasks.duplicate_document_indexing_task.IndexProcessorFactory") as mock_factory:
        mock_processor = MagicMock()
        mock_processor.clean = Mock()
        mock_factory.return_value.init_index_processor.return_value = mock_processor
        yield mock_factory


@pytest.fixture
def mock_tenant_isolated_queue():
    """Mock TenantIsolatedTaskQueue."""
    with patch("tasks.duplicate_document_indexing_task.TenantIsolatedTaskQueue") as mock_queue_class:
        mock_queue = MagicMock(spec=TenantIsolatedTaskQueue)
        mock_queue.pull_tasks.return_value = []
        mock_queue.delete_task_key = Mock()
        mock_queue.set_task_waiting_time = Mock()
        mock_queue_class.return_value = mock_queue
        yield mock_queue


# ============================================================================
# Tests for deprecated duplicate_document_indexing_task
# ============================================================================


class TestDuplicateDocumentIndexingTask:
    """Tests for the deprecated duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task")
    def test_duplicate_document_indexing_task_calls_core_function(self, mock_core_func, dataset_id, document_ids):
        """Test that duplicate_document_indexing_task calls the core _duplicate_document_indexing_task function."""
        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task")
    def test_duplicate_document_indexing_task_with_empty_document_ids(self, mock_core_func, dataset_id):
        """Test duplicate_document_indexing_task with empty document_ids list."""
        # Arrange
        document_ids = []

        # Act
        duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        mock_core_func.assert_called_once_with(dataset_id, document_ids)


# ============================================================================
# Tests for _duplicate_document_indexing_task core function
# ============================================================================


class TestDuplicateDocumentIndexingTaskCore:
    """Tests for the _duplicate_document_indexing_task core function."""

    def test_successful_duplicate_document_indexing(
        self,
        mock_db_session,
        mock_indexing_runner,
        mock_feature_service,
        mock_index_processor_factory,
        mock_dataset,
        mock_documents,
        mock_document_segments,
        dataset_id,
        document_ids,
    ):
        """Test successful duplicate document indexing flow."""
        # Arrange
        # Dataset via query.first()
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset
        # scalars() call sequence:
        # 1) documents list
        # 2..N) segments per document

        def _scalars_side_effect(*args, **kwargs):
            m = MagicMock()
            # First call returns documents; subsequent calls return segments
            if not hasattr(_scalars_side_effect, "_calls"):
                _scalars_side_effect._calls = 0
            if _scalars_side_effect._calls == 0:
                m.all.return_value = mock_documents
            else:
                m.all.return_value = mock_document_segments
            _scalars_side_effect._calls += 1
            return m

        mock_db_session.scalars.side_effect = _scalars_side_effect

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # Verify IndexingRunner was called
        mock_indexing_runner.run.assert_called_once()

        # Verify all documents were set to parsing status
        for doc in mock_documents:
            assert doc.indexing_status == "parsing"
            assert doc.processing_started_at is not None

        # Verify session operations
        assert mock_db_session.commit.called
        assert mock_db_session.close.called

    def test_duplicate_document_indexing_dataset_not_found(self, mock_db_session, dataset_id, document_ids):
        """Test duplicate document indexing when dataset is not found."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = None

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # Should close the session at least once
        assert mock_db_session.close.called

    def test_duplicate_document_indexing_with_billing_enabled_sandbox_plan(
        self,
        mock_db_session,
        mock_feature_service,
        mock_dataset,
        dataset_id,
        document_ids,
    ):
        """Test duplicate document indexing with billing enabled and sandbox plan."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset
        mock_features = mock_feature_service.get_features.return_value
        mock_features.billing.enabled = True
        mock_features.billing.subscription.plan = CloudPlan.SANDBOX

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # For sandbox plan with multiple documents, should fail
        mock_db_session.commit.assert_called()

    def test_duplicate_document_indexing_with_billing_limit_exceeded(
        self,
        mock_db_session,
        mock_feature_service,
        mock_dataset,
        mock_documents,
        dataset_id,
        document_ids,
    ):
        """Test duplicate document indexing when billing limit is exceeded."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset
        # First scalars() -> documents; subsequent -> empty segments

        def _scalars_side_effect(*args, **kwargs):
            m = MagicMock()
            if not hasattr(_scalars_side_effect, "_calls"):
                _scalars_side_effect._calls = 0
            if _scalars_side_effect._calls == 0:
                m.all.return_value = mock_documents
            else:
                m.all.return_value = []
            _scalars_side_effect._calls += 1
            return m

        mock_db_session.scalars.side_effect = _scalars_side_effect
        mock_features = mock_feature_service.get_features.return_value
        mock_features.billing.enabled = True
        mock_features.billing.subscription.plan = CloudPlan.TEAM
        mock_features.vector_space.size = 990
        mock_features.vector_space.limit = 1000

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # Should commit the session
        assert mock_db_session.commit.called
        # Should close the session
        assert mock_db_session.close.called

    def test_duplicate_document_indexing_runner_error(
        self,
        mock_db_session,
        mock_indexing_runner,
        mock_feature_service,
        mock_index_processor_factory,
        mock_dataset,
        mock_documents,
        dataset_id,
        document_ids,
    ):
        """Test duplicate document indexing when IndexingRunner raises an error."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def _scalars_side_effect(*args, **kwargs):
            m = MagicMock()
            if not hasattr(_scalars_side_effect, "_calls"):
                _scalars_side_effect._calls = 0
            if _scalars_side_effect._calls == 0:
                m.all.return_value = mock_documents
            else:
                m.all.return_value = []
            _scalars_side_effect._calls += 1
            return m

        mock_db_session.scalars.side_effect = _scalars_side_effect
        mock_indexing_runner.run.side_effect = Exception("Indexing error")

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # Should close the session even after error
        mock_db_session.close.assert_called_once()

    def test_duplicate_document_indexing_document_is_paused(
        self,
        mock_db_session,
        mock_indexing_runner,
        mock_feature_service,
        mock_index_processor_factory,
        mock_dataset,
        mock_documents,
        dataset_id,
        document_ids,
    ):
        """Test duplicate document indexing when document is paused."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def _scalars_side_effect(*args, **kwargs):
            m = MagicMock()
            if not hasattr(_scalars_side_effect, "_calls"):
                _scalars_side_effect._calls = 0
            if _scalars_side_effect._calls == 0:
                m.all.return_value = mock_documents
            else:
                m.all.return_value = []
            _scalars_side_effect._calls += 1
            return m

        mock_db_session.scalars.side_effect = _scalars_side_effect
        mock_indexing_runner.run.side_effect = DocumentIsPausedError("Document paused")

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # Should handle DocumentIsPausedError gracefully
        mock_db_session.close.assert_called_once()

    def test_duplicate_document_indexing_cleans_old_segments(
        self,
        mock_db_session,
        mock_indexing_runner,
        mock_feature_service,
        mock_index_processor_factory,
        mock_dataset,
        mock_documents,
        mock_document_segments,
        dataset_id,
        document_ids,
    ):
        """Test that duplicate document indexing cleans old segments."""
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def _scalars_side_effect(*args, **kwargs):
            m = MagicMock()
            if not hasattr(_scalars_side_effect, "_calls"):
                _scalars_side_effect._calls = 0
            if _scalars_side_effect._calls == 0:
                m.all.return_value = mock_documents
            else:
                m.all.return_value = mock_document_segments
            _scalars_side_effect._calls += 1
            return m

        mock_db_session.scalars.side_effect = _scalars_side_effect
        mock_processor = mock_index_processor_factory.return_value.init_index_processor.return_value

        # Act
        _duplicate_document_indexing_task(dataset_id, document_ids)

        # Assert
        # Verify clean was called for each document
        assert mock_processor.clean.call_count == len(mock_documents)

        # Verify segments were deleted in batch (DELETE FROM document_segments)
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.execute.call_args_list]
        assert any("DELETE FROM document_segments" in sql for sql in execute_sqls)


# ============================================================================
# Tests for tenant queue wrapper function
# ============================================================================


class TestDuplicateDocumentIndexingTaskWithTenantQueue:
    """Tests for _duplicate_document_indexing_task_with_tenant_queue function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task")
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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task")
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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task")
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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task")
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


# ============================================================================
# Tests for normal_duplicate_document_indexing_task
# ============================================================================


class TestNormalDuplicateDocumentIndexingTask:
    """Tests for normal_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue")
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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue")
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


# ============================================================================
# Tests for priority_duplicate_document_indexing_task
# ============================================================================


class TestPriorityDuplicateDocumentIndexingTask:
    """Tests for priority_duplicate_document_indexing_task function."""

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue")
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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue")
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

    @patch("tasks.duplicate_document_indexing_task._duplicate_document_indexing_task_with_tenant_queue")
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
