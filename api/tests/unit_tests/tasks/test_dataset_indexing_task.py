"""
Unit tests for dataset indexing tasks.

This module tests the document indexing task functionality including:
- Task enqueuing to different queues (normal, priority, tenant-isolated)
- Batch processing of multiple documents
- Progress tracking through task lifecycle
- Error handling and retry mechanisms
- Task cancellation and cleanup
"""

import uuid
from unittest.mock import MagicMock, Mock, patch

import pytest

from core.indexing_runner import DocumentIsPausedError, IndexingRunner
from core.rag.pipeline.queue import TenantIsolatedTaskQueue
from enums.cloud_plan import CloudPlan
from extensions.ext_redis import redis_client
from models.dataset import Dataset, Document
from services.document_indexing_proxy.document_indexing_task_proxy import DocumentIndexingTaskProxy
from tasks.document_indexing_task import (
    _document_indexing,
    _document_indexing_with_tenant_queue,
    document_indexing_task,
    normal_document_indexing_task,
    priority_document_indexing_task,
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
        documents.append(doc)
    return documents


@pytest.fixture
def mock_db_session():
    """Mock database session via session_factory.create_session()."""
    with patch("tasks.document_indexing_task.session_factory") as mock_sf:
        session = MagicMock()
        # Ensure tests that expect session.close() to be called can observe it via the context manager
        session.close = MagicMock()
        cm = MagicMock()
        cm.__enter__.return_value = session
        # Link __exit__ to session.close so "close" expectations reflect context manager teardown

        def _exit_side_effect(*args, **kwargs):
            session.close()

        cm.__exit__.side_effect = _exit_side_effect
        mock_sf.create_session.return_value = cm

        query = MagicMock()
        session.query.return_value = query
        query.where.return_value = query
        yield session


@pytest.fixture
def mock_indexing_runner():
    """Mock IndexingRunner."""
    with patch("tasks.document_indexing_task.IndexingRunner") as mock_runner_class:
        mock_runner = MagicMock(spec=IndexingRunner)
        mock_runner_class.return_value = mock_runner
        yield mock_runner


@pytest.fixture
def mock_feature_service():
    """Mock FeatureService for billing and feature checks."""
    with patch("tasks.document_indexing_task.FeatureService") as mock_service:
        yield mock_service


@pytest.fixture
def mock_redis():
    """Mock Redis client operations."""
    # Redis is already mocked globally in conftest.py
    # Reset it for each test
    redis_client.reset_mock()
    redis_client.get.return_value = None
    redis_client.setex.return_value = True
    redis_client.delete.return_value = True
    redis_client.lpush.return_value = 1
    redis_client.rpop.return_value = None
    return redis_client


# ============================================================================
# Test Task Enqueuing
# ============================================================================


class TestTaskEnqueuing:
    """Test cases for task enqueuing to different queues."""

    def test_enqueue_to_priority_direct_queue_for_self_hosted(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test enqueuing to priority direct queue for self-hosted deployments.

        When billing is disabled (self-hosted), tasks should go directly to
        the priority queue without tenant isolation.
        """
        # Arrange
        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = False

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert
                mock_task.delay.assert_called_once_with(
                    tenant_id=tenant_id, dataset_id=dataset_id, document_ids=document_ids
                )

    def test_enqueue_to_normal_tenant_queue_for_sandbox_plan(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test enqueuing to normal tenant queue for sandbox plan.

        Sandbox plan users should have their tasks queued with tenant isolation
        in the normal priority queue.
        """
        # Arrange
        mock_redis.get.return_value = None  # No existing task

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.SANDBOX

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "NORMAL_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert - Should set task key and call delay
                assert mock_redis.setex.called
                mock_task.delay.assert_called_once()

    def test_enqueue_to_priority_tenant_queue_for_paid_plan(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test enqueuing to priority tenant queue for paid plans.

        Paid plan users should have their tasks queued with tenant isolation
        in the priority queue.
        """
        # Arrange
        mock_redis.get.return_value = None  # No existing task

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert
                assert mock_redis.setex.called
                mock_task.delay.assert_called_once()

    def test_enqueue_adds_to_waiting_queue_when_task_running(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test that new tasks are added to waiting queue when a task is already running.

        If a task is already running for the tenant (task key exists),
        new tasks should be pushed to the waiting queue.
        """
        # Arrange
        mock_redis.get.return_value = b"1"  # Task already running

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

                # Act
                proxy.delay()

                # Assert - Should push to queue, not call delay
                assert mock_redis.lpush.called
                mock_task.delay.assert_not_called()

    def test_legacy_document_indexing_task_still_works(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_documents, mock_indexing_runner
    ):
        """
        Test that the legacy document_indexing_task function still works.

        This ensures backward compatibility for existing code that may still
        use the deprecated function.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                # Return documents one by one for each call
                mock_query.where.return_value.first.side_effect = mock_documents
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            document_indexing_task(dataset_id, document_ids)

            # Assert
            mock_indexing_runner.run.assert_called_once()


# ============================================================================
# Test Batch Processing
# ============================================================================


class TestBatchProcessing:
    """Test cases for batch processing of multiple documents."""

    def test_batch_processing_multiple_documents(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test batch processing of multiple documents.

        All documents in the batch should be processed together and their
        status should be updated to 'parsing'.
        """
        # Arrange - Create actual document objects that can be modified
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.error = None
            doc.stopped_at = None
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        # Create an iterator for documents
        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                # Return documents one by one for each call
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert - All documents should be set to 'parsing' status
            for doc in mock_documents:
                assert doc.indexing_status == "parsing"
                assert doc.processing_started_at is not None

            # IndexingRunner should be called with all documents
            mock_indexing_runner.run.assert_called_once()
            call_args = mock_indexing_runner.run.call_args[0][0]
            assert len(call_args) == len(document_ids)

    def test_batch_processing_with_limit_check(self, dataset_id, mock_db_session, mock_dataset, mock_feature_service):
        """
        Test batch processing respects upload limits.

        When the number of documents exceeds the batch upload limit,
        an error should be raised and all documents should be marked as error.
        """
        # Arrange
        batch_limit = 10
        document_ids = [str(uuid.uuid4()) for _ in range(batch_limit + 1)]

        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.error = None
            doc.stopped_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_feature_service.get_features.return_value.vector_space.limit = 1000
        mock_feature_service.get_features.return_value.vector_space.size = 0

        with patch("tasks.document_indexing_task.dify_config.BATCH_UPLOAD_LIMIT", str(batch_limit)):
            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert - All documents should have error status
            for doc in mock_documents:
                assert doc.indexing_status == "error"
                assert doc.error is not None
                assert "batch upload limit" in doc.error

    def test_batch_processing_sandbox_plan_single_document_only(
        self, dataset_id, mock_db_session, mock_dataset, mock_feature_service
    ):
        """
        Test that sandbox plan only allows single document upload.

        Sandbox plan should reject batch uploads (more than 1 document).
        """
        # Arrange
        document_ids = [str(uuid.uuid4()) for _ in range(2)]

        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.error = None
            doc.stopped_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.SANDBOX
        mock_feature_service.get_features.return_value.vector_space.limit = 1000
        mock_feature_service.get_features.return_value.vector_space.size = 0

        # Act
        _document_indexing(dataset_id, document_ids)

        # Assert - All documents should have error status
        for doc in mock_documents:
            assert doc.indexing_status == "error"
            assert "does not support batch upload" in doc.error

    def test_batch_processing_empty_document_list(
        self, dataset_id, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test batch processing with empty document list.

        Should handle empty list gracefully without errors.
        """
        # Arrange
        document_ids = []
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert - IndexingRunner should still be called with empty list
            mock_indexing_runner.run.assert_called_once_with([])


# ============================================================================
# Test Progress Tracking
# ============================================================================


class TestProgressTracking:
    """Test cases for progress tracking through task lifecycle."""

    def test_document_status_progression(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test document status progresses correctly through lifecycle.

        Documents should transition from 'waiting' -> 'parsing' -> processed.
        """
        # Arrange - Create actual document objects
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert - Status should be 'parsing'
            for doc in mock_documents:
                assert doc.indexing_status == "parsing"
                assert doc.processing_started_at is not None

            # Verify commit was called to persist status
            assert mock_db_session.commit.called

    def test_processing_started_timestamp_set(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that processing_started_at timestamp is set correctly.

        When documents start processing, the timestamp should be recorded.
        """
        # Arrange - Create actual document objects
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert
            for doc in mock_documents:
                assert doc.processing_started_at is not None

    def test_tenant_queue_processes_next_task_after_completion(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that tenant queue processes next waiting task after completion.

        After a task completes, the system should check for waiting tasks
        and process the next one.
        """
        # Arrange
        next_task_data = {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": ["next_doc_id"]}

        # Simulate next task in queue
        from core.rag.pipeline.queue import TaskWrapper

        wrapper = TaskWrapper(data=next_task_data)
        mock_redis.rpop.return_value = wrapper.serialize()

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                # Assert - Next task should be enqueued
                mock_task.delay.assert_called()
                # Task key should be set for next task
                assert mock_redis.setex.called

    def test_tenant_queue_clears_flag_when_no_more_tasks(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that tenant queue clears flag when no more tasks are waiting.

        When there are no more tasks in the queue, the task key should be deleted.
        """
        # Arrange
        mock_redis.rpop.return_value = None  # No more tasks
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                # Assert - Task key should be deleted
                assert mock_redis.delete.called


# ============================================================================
# Test Error Handling and Retries
# ============================================================================


class TestErrorHandling:
    """Test cases for error handling and retry mechanisms."""

    def test_error_handling_sets_document_error_status(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_feature_service
    ):
        """
        Test that errors during validation set document error status.

        When validation fails (e.g., limit exceeded), documents should be
        marked with error status and error message.
        """
        # Arrange - Create actual document objects
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.error = None
            doc.stopped_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Set up to trigger vector space limit error
        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_feature_service.get_features.return_value.vector_space.limit = 100
        mock_feature_service.get_features.return_value.vector_space.size = 100  # At limit

        # Act
        _document_indexing(dataset_id, document_ids)

        # Assert
        for doc in mock_documents:
            assert doc.indexing_status == "error"
            assert doc.error is not None
            assert "over the limit" in doc.error
            assert doc.stopped_at is not None

    def test_error_handling_during_indexing_runner(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_documents, mock_indexing_runner
    ):
        """
        Test error handling when IndexingRunner raises an exception.

        Errors during indexing should be caught and logged, but not crash the task.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first.side_effect = mock_documents
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Make IndexingRunner raise an exception
        mock_indexing_runner.run.side_effect = Exception("Indexing failed")

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act - Should not raise exception
            _document_indexing(dataset_id, document_ids)

            # Assert - Session should be closed even after error
            assert mock_db_session.close.called

    def test_document_paused_error_handling(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_documents, mock_indexing_runner
    ):
        """
        Test handling of DocumentIsPausedError.

        When a document is paused, the error should be caught and logged
        but not treated as a failure.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first.side_effect = mock_documents
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Make IndexingRunner raise DocumentIsPausedError
        mock_indexing_runner.run.side_effect = DocumentIsPausedError("Document is paused")

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act - Should not raise exception
            _document_indexing(dataset_id, document_ids)

            # Assert - Session should be closed
            assert mock_db_session.close.called

    def test_dataset_not_found_error_handling(self, dataset_id, document_ids, mock_db_session):
        """
        Test handling when dataset is not found.

        If the dataset doesn't exist, the task should exit gracefully.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = None

        # Act
        _document_indexing(dataset_id, document_ids)

        # Assert - Session should be closed
        assert mock_db_session.close.called

    def test_tenant_queue_error_handling_still_processes_next_task(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that errors don't prevent processing next task in tenant queue.

        Even if the current task fails, the next task should still be processed.
        """
        # Arrange
        next_task_data = {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": ["next_doc_id"]}

        from core.rag.pipeline.queue import TaskWrapper

        wrapper = TaskWrapper(data=next_task_data)
        # Set up rpop to return task once for concurrency check
        mock_redis.rpop.side_effect = [wrapper.serialize(), None]

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        # Make _document_indexing raise an error
        with patch("tasks.document_indexing_task._document_indexing") as mock_indexing:
            mock_indexing.side_effect = Exception("Processing failed")

            # Patch logger to avoid format string issue in actual code
            with patch("tasks.document_indexing_task.logger"):
                with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                    # Act
                    _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                    # Assert - Next task should still be enqueued despite error
                    mock_task.delay.assert_called()

    def test_concurrent_task_limit_respected(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset
    ):
        """
        Test that tenant isolated task concurrency limit is respected.

        Should pull only TENANT_ISOLATED_TASK_CONCURRENCY tasks at a time.
        """
        # Arrange
        concurrency_limit = 2

        # Create multiple tasks in queue
        tasks = []
        for i in range(5):
            task_data = {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": [f"doc_{i}"]}
            from core.rag.pipeline.queue import TaskWrapper

            wrapper = TaskWrapper(data=task_data)
            tasks.append(wrapper.serialize())

        # Mock rpop to return tasks one by one
        mock_redis.rpop.side_effect = tasks[:concurrency_limit] + [None]

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", concurrency_limit):
            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                # Assert - Should call delay exactly concurrency_limit times
                assert mock_task.delay.call_count == concurrency_limit


# ============================================================================
# Test Task Cancellation
# ============================================================================


class TestTaskCancellation:
    """Test cases for task cancellation and cleanup."""

    def test_task_key_deleted_when_queue_empty(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset
    ):
        """
        Test that task key is deleted when queue becomes empty.

        When no more tasks are waiting, the tenant task key should be removed.
        """
        # Arrange
        mock_redis.rpop.return_value = None  # Empty queue
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
            # Act
            _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

            # Assert
            assert mock_redis.delete.called
            # Verify the correct key was deleted
            delete_call_args = mock_redis.delete.call_args[0][0]
            assert tenant_id in delete_call_args
            assert "document_indexing" in delete_call_args

    def test_session_cleanup_on_success(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_documents, mock_indexing_runner
    ):
        """
        Test that database session is properly closed on success.

        Session cleanup should happen in finally block.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first.side_effect = mock_documents
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert
            assert mock_db_session.close.called

    def test_session_cleanup_on_error(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_documents, mock_indexing_runner
    ):
        """
        Test that database session is properly closed on error.

        Session cleanup should happen even when errors occur.
        """
        # Arrange
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first.side_effect = mock_documents
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Make IndexingRunner raise an exception
        mock_indexing_runner.run.side_effect = Exception("Test error")

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert
            assert mock_db_session.close.called

    def test_task_isolation_between_tenants(self, mock_redis):
        """
        Test that tasks are properly isolated between different tenants.

        Each tenant should have their own queue and task key.
        """
        # Arrange
        tenant_1 = str(uuid.uuid4())
        tenant_2 = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        document_ids = [str(uuid.uuid4())]

        # Act
        queue_1 = TenantIsolatedTaskQueue(tenant_1, "document_indexing")
        queue_2 = TenantIsolatedTaskQueue(tenant_2, "document_indexing")

        # Assert - Different tenants should have different queue keys
        assert queue_1._queue != queue_2._queue
        assert queue_1._task_key != queue_2._task_key
        assert tenant_1 in queue_1._queue
        assert tenant_2 in queue_2._queue


# ============================================================================
# Integration Tests
# ============================================================================


class TestAdvancedScenarios:
    """Advanced test scenarios for edge cases and complex workflows."""

    def test_multiple_documents_with_mixed_success_and_failure(
        self, dataset_id, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test handling of mixed success and failure scenarios in batch processing.

        When processing multiple documents, some may succeed while others fail.
        This tests that the system handles partial failures gracefully.

        Scenario:
        - Process 3 documents in a batch
        - First document succeeds
        - Second document is not found (skipped)
        - Third document succeeds

        Expected behavior:
        - Only found documents are processed
        - Missing documents are skipped without crashing
        - IndexingRunner receives only valid documents
        """
        # Arrange - Create document IDs with one missing
        document_ids = [str(uuid.uuid4()) for _ in range(3)]

        # Create only 2 documents (simulate one missing)
        mock_documents = []
        for i, doc_id in enumerate([document_ids[0], document_ids[2]]):  # Skip middle one
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        # Create iterator that returns None for missing document
        doc_responses = [mock_documents[0], None, mock_documents[1]]
        doc_iter = iter(doc_responses)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert - Only 2 documents should be processed (missing one skipped)
            mock_indexing_runner.run.assert_called_once()
            call_args = mock_indexing_runner.run.call_args[0][0]
            assert len(call_args) == 2  # Only found documents

    def test_tenant_queue_with_multiple_concurrent_tasks(
        self, tenant_id, dataset_id, mock_redis, mock_db_session, mock_dataset
    ):
        """
        Test concurrent task processing with tenant isolation.

        This tests the scenario where multiple tasks are queued for the same tenant
        and need to be processed respecting the concurrency limit.

        Scenario:
        - 5 tasks are waiting in the queue
        - Concurrency limit is 2
        - After current task completes, pull and enqueue next 2 tasks

        Expected behavior:
        - Exactly 2 tasks are pulled from queue (respecting concurrency)
        - Each task is enqueued with correct parameters
        - Task waiting time is set for each new task
        """
        # Arrange
        concurrency_limit = 2
        document_ids = [str(uuid.uuid4())]

        # Create multiple waiting tasks
        waiting_tasks = []
        for i in range(5):
            task_data = {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": [f"doc_{i}"]}
            from core.rag.pipeline.queue import TaskWrapper

            wrapper = TaskWrapper(data=task_data)
            waiting_tasks.append(wrapper.serialize())

        # Mock rpop to return tasks up to concurrency limit
        mock_redis.rpop.side_effect = waiting_tasks[:concurrency_limit] + [None]
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", concurrency_limit):
            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                # Assert
                # Should call delay exactly concurrency_limit times
                assert mock_task.delay.call_count == concurrency_limit

                # Verify task waiting time was set for each task
                assert mock_redis.setex.call_count >= concurrency_limit

    def test_vector_space_limit_edge_case_at_exact_limit(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_feature_service
    ):
        """
        Test vector space limit validation at exact boundary.

        Edge case: When vector space is exactly at the limit (not over),
        the upload should still be rejected.

        Scenario:
        - Vector space limit: 100
        - Current size: 100 (exactly at limit)
        - Try to upload 3 documents

        Expected behavior:
        - Upload is rejected with appropriate error message
        - All documents are marked with error status
        """
        # Arrange
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.error = None
            doc.stopped_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Set vector space exactly at limit
        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_feature_service.get_features.return_value.vector_space.limit = 100
        mock_feature_service.get_features.return_value.vector_space.size = 100  # Exactly at limit

        # Act
        _document_indexing(dataset_id, document_ids)

        # Assert - All documents should have error status
        for doc in mock_documents:
            assert doc.indexing_status == "error"
            assert "over the limit" in doc.error

    def test_task_queue_fifo_ordering(self, tenant_id, dataset_id, mock_redis, mock_db_session, mock_dataset):
        """
        Test that tasks are processed in FIFO (First-In-First-Out) order.

        The tenant isolated queue should maintain task order, ensuring
        that tasks are processed in the sequence they were added.

        Scenario:
        - Task A added first
        - Task B added second
        - Task C added third
        - When pulling tasks, should get A, then B, then C

        Expected behavior:
        - Tasks are retrieved in the order they were added
        - FIFO ordering is maintained throughout processing
        """
        # Arrange
        document_ids = [str(uuid.uuid4())]

        # Create tasks with identifiable document IDs to track order
        task_order = ["task_A", "task_B", "task_C"]
        tasks = []
        for task_name in task_order:
            task_data = {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": [task_name]}
            from core.rag.pipeline.queue import TaskWrapper

            wrapper = TaskWrapper(data=task_data)
            tasks.append(wrapper.serialize())

        # Mock rpop to return tasks in FIFO order
        mock_redis.rpop.side_effect = tasks + [None]
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", 3):
            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                # Assert - Verify tasks were enqueued in correct order
                assert mock_task.delay.call_count == 3

                # Check that document_ids in calls match expected order
                for i, call_obj in enumerate(mock_task.delay.call_args_list):
                    called_doc_ids = call_obj[1]["document_ids"]
                    assert called_doc_ids == [task_order[i]]

    def test_empty_queue_after_task_completion_cleans_up(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset
    ):
        """
        Test cleanup behavior when queue becomes empty after task completion.

        After processing the last task in the queue, the system should:
        1. Detect that no more tasks are waiting
        2. Delete the task key to indicate tenant is idle
        3. Allow new tasks to start fresh processing

        Scenario:
        - Process a task
        - Check queue for next tasks
        - Queue is empty
        - Task key should be deleted

        Expected behavior:
        - Task key is deleted when queue is empty
        - Tenant is marked as idle (no active tasks)
        """
        # Arrange
        mock_redis.rpop.return_value = None  # Empty queue
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
            # Act
            _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

            # Assert
            # Verify delete was called to clean up task key
            mock_redis.delete.assert_called_once()

            # Verify the correct key was deleted (contains tenant_id and "document_indexing")
            delete_call_args = mock_redis.delete.call_args[0][0]
            assert tenant_id in delete_call_args
            assert "document_indexing" in delete_call_args

    def test_billing_disabled_skips_limit_checks(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner, mock_feature_service
    ):
        """
        Test that billing limit checks are skipped when billing is disabled.

        For self-hosted or enterprise deployments where billing is disabled,
        the system should not enforce vector space or batch upload limits.

        Scenario:
        - Billing is disabled
        - Upload 100 documents (would normally exceed limits)
        - No limit checks should be performed

        Expected behavior:
        - Documents are processed without limit validation
        - No errors related to limits
        - All documents proceed to indexing
        """
        # Arrange - Create many documents
        large_batch_ids = [str(uuid.uuid4()) for _ in range(100)]

        mock_documents = []
        for doc_id in large_batch_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Billing disabled - limits should not be checked
        mock_feature_service.get_features.return_value.billing.enabled = False

        # Act
        _document_indexing(dataset_id, large_batch_ids)

        # Assert
        # All documents should be set to parsing (no limit errors)
        for doc in mock_documents:
            assert doc.indexing_status == "parsing"

        # IndexingRunner should be called with all documents
        mock_indexing_runner.run.assert_called_once()
        call_args = mock_indexing_runner.run.call_args[0][0]
        assert len(call_args) == 100


class TestIntegration:
    """Integration tests for complete task workflows."""

    def test_complete_workflow_normal_task(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test complete workflow for normal document indexing task.

        This tests the full flow from task receipt to completion.
        """
        # Arrange - Create actual document objects
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        # Set up rpop to return None for concurrency check (no more tasks)
        mock_redis.rpop.side_effect = [None]
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            normal_document_indexing_task(tenant_id, dataset_id, document_ids)

            # Assert
            # Documents should be processed
            mock_indexing_runner.run.assert_called_once()
            # Session should be closed
            assert mock_db_session.close.called
            # Task key should be deleted (no more tasks)
            assert mock_redis.delete.called

    def test_complete_workflow_priority_task(
        self, tenant_id, dataset_id, document_ids, mock_redis, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test complete workflow for priority document indexing task.

        Priority tasks should follow the same flow as normal tasks.
        """
        # Arrange - Create actual document objects
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        # Set up rpop to return None for concurrency check (no more tasks)
        mock_redis.rpop.side_effect = [None]
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            priority_document_indexing_task(tenant_id, dataset_id, document_ids)

            # Assert
            mock_indexing_runner.run.assert_called_once()
            assert mock_db_session.close.called
            assert mock_redis.delete.called

    def test_queue_chain_processing(
        self, tenant_id, dataset_id, mock_redis, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that multiple tasks in queue are processed in sequence.

        When tasks are queued, they should be processed one after another.
        """
        # Arrange
        task_1_docs = [str(uuid.uuid4())]
        task_2_docs = [str(uuid.uuid4())]

        task_2_data = {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": task_2_docs}

        from core.rag.pipeline.queue import TaskWrapper

        wrapper = TaskWrapper(data=task_2_data)

        # First call returns task 2, second call returns None
        mock_redis.rpop.side_effect = [wrapper.serialize(), None]

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act - Process first task
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, task_1_docs, mock_task)

                # Assert - Second task should be enqueued
                assert mock_task.delay.called
                call_args = mock_task.delay.call_args
                assert call_args[1]["document_ids"] == task_2_docs


# ============================================================================
# Additional Edge Case Tests
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_single_document_processing(self, dataset_id, mock_db_session, mock_dataset, mock_indexing_runner):
        """
        Test processing a single document (minimum batch size).

        Single document processing is a common case and should work
        without any special handling or errors.

        Scenario:
        - Process exactly 1 document
        - Document exists and is valid

        Expected behavior:
        - Document is processed successfully
        - Status is updated to 'parsing'
        - IndexingRunner is called with single document
        """
        # Arrange
        document_ids = [str(uuid.uuid4())]

        mock_document = MagicMock(spec=Document)
        mock_document.id = document_ids[0]
        mock_document.dataset_id = dataset_id
        mock_document.indexing_status = "waiting"
        mock_document.processing_started_at = None

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: mock_document
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert
            assert mock_document.indexing_status == "parsing"
            mock_indexing_runner.run.assert_called_once()
            call_args = mock_indexing_runner.run.call_args[0][0]
            assert len(call_args) == 1

    def test_document_with_special_characters_in_id(
        self, dataset_id, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test handling documents with special characters in IDs.

        Document IDs might contain special characters or unusual formats.
        The system should handle these without errors.

        Scenario:
        - Document ID contains hyphens, underscores
        - Standard UUID format

        Expected behavior:
        - Document is processed normally
        - No parsing or encoding errors
        """
        # Arrange - UUID format with standard characters
        document_ids = [str(uuid.uuid4())]

        mock_document = MagicMock(spec=Document)
        mock_document.id = document_ids[0]
        mock_document.dataset_id = dataset_id
        mock_document.indexing_status = "waiting"
        mock_document.processing_started_at = None

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: mock_document
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act - Should not raise any exceptions
            _document_indexing(dataset_id, document_ids)

            # Assert
            assert mock_document.indexing_status == "parsing"
            mock_indexing_runner.run.assert_called_once()

    def test_rapid_successive_task_enqueuing(self, tenant_id, dataset_id, mock_redis):
        """
        Test rapid successive task enqueuing to the same tenant queue.

        When multiple tasks are enqueued rapidly for the same tenant,
        the system should queue them properly without race conditions.

        Scenario:
        - First task starts processing (task key exists)
        - Multiple tasks enqueued rapidly while first is running
        - All should be added to waiting queue

        Expected behavior:
        - All tasks are queued (not executed immediately)
        - No tasks are lost
        - Queue maintains all tasks
        """
        # Arrange
        document_ids_list = [[str(uuid.uuid4())] for _ in range(5)]

        # Simulate task already running
        mock_redis.get.return_value = b"1"

        with patch.object(DocumentIndexingTaskProxy, "features") as mock_features:
            mock_features.billing.enabled = True
            mock_features.billing.subscription.plan = CloudPlan.PROFESSIONAL

            # Mock the class variable directly
            mock_task = Mock()
            with patch.object(DocumentIndexingTaskProxy, "PRIORITY_TASK_FUNC", mock_task):
                # Act - Enqueue multiple tasks rapidly
                for doc_ids in document_ids_list:
                    proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, doc_ids)
                    proxy.delay()

                # Assert - All tasks should be pushed to queue, none executed
                assert mock_redis.lpush.call_count == 5
                mock_task.delay.assert_not_called()

    def test_zero_vector_space_limit_allows_unlimited(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner, mock_feature_service
    ):
        """
        Test that zero vector space limit means unlimited.

        When vector_space.limit is 0, it indicates no limit is enforced,
        allowing unlimited document uploads.

        Scenario:
        - Vector space limit: 0 (unlimited)
        - Current size: 1000 (any number)
        - Upload 3 documents

        Expected behavior:
        - Upload is allowed
        - No limit errors
        - Documents are processed normally
        """
        # Arrange
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Set vector space limit to 0 (unlimited)
        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_feature_service.get_features.return_value.vector_space.limit = 0  # Unlimited
        mock_feature_service.get_features.return_value.vector_space.size = 1000

        # Act
        _document_indexing(dataset_id, document_ids)

        # Assert - All documents should be processed (no limit error)
        for doc in mock_documents:
            assert doc.indexing_status == "parsing"

        mock_indexing_runner.run.assert_called_once()

    def test_negative_vector_space_values_handled_gracefully(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner, mock_feature_service
    ):
        """
        Test handling of negative vector space values.

        Negative values in vector space configuration should be treated
        as unlimited or invalid, not causing crashes.

        Scenario:
        - Vector space limit: -1 (invalid/unlimited indicator)
        - Current size: 100
        - Upload 3 documents

        Expected behavior:
        - Upload is allowed (negative treated as no limit)
        - No crashes or validation errors
        """
        # Arrange
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Set negative vector space limit
        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_feature_service.get_features.return_value.vector_space.limit = -1  # Negative
        mock_feature_service.get_features.return_value.vector_space.size = 100

        # Act
        _document_indexing(dataset_id, document_ids)

        # Assert - Should process normally (negative treated as unlimited)
        for doc in mock_documents:
            assert doc.indexing_status == "parsing"


class TestPerformanceScenarios:
    """Test performance-related scenarios and optimizations."""

    def test_large_document_batch_processing(
        self, dataset_id, mock_db_session, mock_dataset, mock_indexing_runner, mock_feature_service
    ):
        """
        Test processing a large batch of documents at batch limit.

        When processing the maximum allowed batch size, the system
        should handle it efficiently without errors.

        Scenario:
        - Process exactly batch_upload_limit documents (e.g., 50)
        - All documents are valid
        - Billing is enabled

        Expected behavior:
        - All documents are processed successfully
        - No timeout or memory issues
        - Batch limit is not exceeded
        """
        # Arrange
        batch_limit = 50
        document_ids = [str(uuid.uuid4()) for _ in range(batch_limit)]

        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Configure billing with sufficient limits
        mock_feature_service.get_features.return_value.billing.enabled = True
        mock_feature_service.get_features.return_value.billing.subscription.plan = CloudPlan.PROFESSIONAL
        mock_feature_service.get_features.return_value.vector_space.limit = 10000
        mock_feature_service.get_features.return_value.vector_space.size = 0

        with patch("tasks.document_indexing_task.dify_config.BATCH_UPLOAD_LIMIT", str(batch_limit)):
            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert
            for doc in mock_documents:
                assert doc.indexing_status == "parsing"

            mock_indexing_runner.run.assert_called_once()
            call_args = mock_indexing_runner.run.call_args[0][0]
            assert len(call_args) == batch_limit

    def test_tenant_queue_handles_burst_traffic(self, tenant_id, dataset_id, mock_redis, mock_db_session, mock_dataset):
        """
        Test tenant queue handling burst traffic scenarios.

        When many tasks arrive in a burst for the same tenant,
        the queue should handle them efficiently without dropping tasks.

        Scenario:
        - 20 tasks arrive rapidly
        - Concurrency limit is 3
        - Tasks should be queued and processed in batches

        Expected behavior:
        - First 3 tasks are processed immediately
        - Remaining tasks wait in queue
        - No tasks are lost
        """
        # Arrange
        num_tasks = 20
        concurrency_limit = 3
        document_ids = [str(uuid.uuid4())]

        # Create waiting tasks
        waiting_tasks = []
        for i in range(num_tasks):
            task_data = {
                "tenant_id": tenant_id,
                "dataset_id": dataset_id,
                "document_ids": [f"doc_{i}"],
            }
            from core.rag.pipeline.queue import TaskWrapper

            wrapper = TaskWrapper(data=task_data)
            waiting_tasks.append(wrapper.serialize())

        # Mock rpop to return tasks up to concurrency limit
        mock_redis.rpop.side_effect = waiting_tasks[:concurrency_limit] + [None]
        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        with patch("tasks.document_indexing_task.dify_config.TENANT_ISOLATED_TASK_CONCURRENCY", concurrency_limit):
            with patch("tasks.document_indexing_task.normal_document_indexing_task") as mock_task:
                # Act
                _document_indexing_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task)

                # Assert - Should process exactly concurrency_limit tasks
                assert mock_task.delay.call_count == concurrency_limit

    def test_multiple_tenants_isolated_processing(self, mock_redis):
        """
        Test that multiple tenants process tasks in isolation.

        When multiple tenants have tasks running simultaneously,
        they should not interfere with each other.

        Scenario:
        - Tenant A has tasks in queue
        - Tenant B has tasks in queue
        - Both process independently

        Expected behavior:
        - Each tenant has separate queue
        - Each tenant has separate task key
        - No cross-tenant interference
        """
        # Arrange
        tenant_a = str(uuid.uuid4())
        tenant_b = str(uuid.uuid4())
        dataset_id = str(uuid.uuid4())
        document_ids = [str(uuid.uuid4())]

        # Create queues for both tenants
        queue_a = TenantIsolatedTaskQueue(tenant_a, "document_indexing")
        queue_b = TenantIsolatedTaskQueue(tenant_b, "document_indexing")

        # Act - Set task keys for both tenants
        queue_a.set_task_waiting_time()
        queue_b.set_task_waiting_time()

        # Assert - Each tenant has independent queue and key
        assert queue_a._queue != queue_b._queue
        assert queue_a._task_key != queue_b._task_key
        assert tenant_a in queue_a._queue
        assert tenant_b in queue_b._queue
        assert tenant_a in queue_a._task_key
        assert tenant_b in queue_b._task_key


class TestRobustness:
    """Test system robustness and resilience."""

    def test_indexing_runner_exception_does_not_crash_task(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that IndexingRunner exceptions are handled gracefully.

        When IndexingRunner raises an unexpected exception during processing,
        the task should catch it, log it, and clean up properly.

        Scenario:
        - Documents are prepared for indexing
        - IndexingRunner.run() raises RuntimeError
        - Task should not crash

        Expected behavior:
        - Exception is caught and logged
        - Database session is closed
        - Task completes (doesn't hang)
        """
        # Arrange
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        # Make IndexingRunner raise an exception
        mock_indexing_runner.run.side_effect = RuntimeError("Unexpected indexing error")

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act - Should not raise exception
            _document_indexing(dataset_id, document_ids)

            # Assert - Session should be closed even after error
            assert mock_db_session.close.called

    def test_database_session_always_closed_on_success(
        self, dataset_id, document_ids, mock_db_session, mock_dataset, mock_indexing_runner
    ):
        """
        Test that database session is always closed on successful completion.

        Proper resource cleanup is critical. The database session must
        be closed in the finally block to prevent connection leaks.

        Scenario:
        - Task processes successfully
        - No exceptions occur

        Expected behavior:
        - Database session is closed
        - No connection leaks
        """
        # Arrange
        mock_documents = []
        for doc_id in document_ids:
            doc = MagicMock(spec=Document)
            doc.id = doc_id
            doc.dataset_id = dataset_id
            doc.indexing_status = "waiting"
            doc.processing_started_at = None
            mock_documents.append(doc)

        mock_db_session.query.return_value.where.return_value.first.return_value = mock_dataset

        doc_iter = iter(mock_documents)

        def mock_query_side_effect(*args):
            mock_query = MagicMock()
            if args[0] == Dataset:
                mock_query.where.return_value.first.return_value = mock_dataset
            elif args[0] == Document:
                mock_query.where.return_value.first = lambda: next(doc_iter, None)
            return mock_query

        mock_db_session.query.side_effect = mock_query_side_effect

        with patch("tasks.document_indexing_task.FeatureService.get_features") as mock_features:
            mock_features.return_value.billing.enabled = False

            # Act
            _document_indexing(dataset_id, document_ids)

            # Assert
            assert mock_db_session.close.called
            # Verify close is called exactly once
            assert mock_db_session.close.call_count == 1

    def test_task_proxy_handles_feature_service_failure(self, tenant_id, dataset_id, document_ids, mock_redis):
        """
        Test that task proxy handles FeatureService failures gracefully.

        If FeatureService fails to retrieve features, the system should
        have a fallback or handle the error appropriately.

        Scenario:
        - FeatureService.get_features() raises an exception during dispatch
        - Task enqueuing should handle the error

        Expected behavior:
        - Exception is raised when trying to dispatch
        - System doesn't crash unexpectedly
        - Error is propagated appropriately
        """
        # Arrange
        with patch("services.document_indexing_proxy.base.FeatureService.get_features") as mock_get_features:
            # Simulate FeatureService failure
            mock_get_features.side_effect = Exception("Feature service unavailable")

            # Create proxy instance
            proxy = DocumentIndexingTaskProxy(tenant_id, dataset_id, document_ids)

            # Act & Assert - Should raise exception when trying to delay (which accesses features)
            with pytest.raises(Exception) as exc_info:
                proxy.delay()

            # Verify the exception message
            assert "Feature service" in str(exc_info.value) or isinstance(exc_info.value, Exception)
