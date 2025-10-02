import datetime

# Mock redis_client before importing dataset_service
from unittest.mock import Mock, call, patch

import pytest

from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from services.errors.document import DocumentIndexingError
from tests.unit_tests.conftest import redis_mock


class DocumentBatchUpdateTestDataFactory:
    """Factory class for creating test data and mock objects for document batch update tests."""

    @staticmethod
    def create_dataset_mock(dataset_id: str = "dataset-123", tenant_id: str = "tenant-456") -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        return dataset

    @staticmethod
    def create_user_mock(user_id: str = "user-789") -> Mock:
        """Create a mock user."""
        user = Mock()
        user.id = user_id
        return user

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-1",
        name: str = "test_document.pdf",
        enabled: bool = True,
        archived: bool = False,
        indexing_status: str = "completed",
        completed_at: datetime.datetime | None = None,
        **kwargs,
    ) -> Mock:
        """Create a mock document with specified attributes."""
        document = Mock(spec=Document)
        document.id = document_id
        document.name = name
        document.enabled = enabled
        document.archived = archived
        document.indexing_status = indexing_status
        document.completed_at = completed_at or datetime.datetime.now()

        # Set default values for optional fields
        document.disabled_at = None
        document.disabled_by = None
        document.archived_at = None
        document.archived_by = None
        document.updated_at = None

        for key, value in kwargs.items():
            setattr(document, key, value)
        return document

    @staticmethod
    def create_multiple_documents(
        document_ids: list[str], enabled: bool = True, archived: bool = False, indexing_status: str = "completed"
    ) -> list[Mock]:
        """Create multiple mock documents with specified attributes."""
        documents = []
        for doc_id in document_ids:
            doc = DocumentBatchUpdateTestDataFactory.create_document_mock(
                document_id=doc_id,
                name=f"document_{doc_id}.pdf",
                enabled=enabled,
                archived=archived,
                indexing_status=indexing_status,
            )
            documents.append(doc)
        return documents


class TestDatasetServiceBatchUpdateDocumentStatus:
    """
    Comprehensive unit tests for DocumentService.batch_update_document_status method.

    This test suite covers all supported actions (enable, disable, archive, un_archive),
    error conditions, edge cases, and validates proper interaction with Redis cache,
    database operations, and async task triggers.
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """Common mock setup for document service dependencies."""
        with (
            patch("services.dataset_service.DocumentService.get_document") as mock_get_doc,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time

            yield {
                "get_document": mock_get_doc,
                "db_session": mock_db,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    @pytest.fixture
    def mock_async_task_dependencies(self):
        """Mock setup for async task dependencies."""
        with (
            patch("services.dataset_service.add_document_to_index_task") as mock_add_task,
            patch("services.dataset_service.remove_document_from_index_task") as mock_remove_task,
        ):
            yield {"add_task": mock_add_task, "remove_task": mock_remove_task}

    def _assert_document_enabled(self, document: Mock, user_id: str, current_time: datetime.datetime):
        """Helper method to verify document was enabled correctly."""
        assert document.enabled == True
        assert document.disabled_at is None
        assert document.disabled_by is None
        assert document.updated_at == current_time

    def _assert_document_disabled(self, document: Mock, user_id: str, current_time: datetime.datetime):
        """Helper method to verify document was disabled correctly."""
        assert document.enabled == False
        assert document.disabled_at == current_time
        assert document.disabled_by == user_id
        assert document.updated_at == current_time

    def _assert_document_archived(self, document: Mock, user_id: str, current_time: datetime.datetime):
        """Helper method to verify document was archived correctly."""
        assert document.archived == True
        assert document.archived_at == current_time
        assert document.archived_by == user_id
        assert document.updated_at == current_time

    def _assert_document_unarchived(self, document: Mock):
        """Helper method to verify document was unarchived correctly."""
        assert document.archived == False
        assert document.archived_at is None
        assert document.archived_by is None

    def _assert_redis_cache_operations(self, document_ids: list[str], action: str = "setex"):
        """Helper method to verify Redis cache operations."""
        if action == "setex":
            expected_calls = [call(f"document_{doc_id}_indexing", 600, 1) for doc_id in document_ids]
            redis_mock.setex.assert_has_calls(expected_calls)
        elif action == "get":
            expected_calls = [call(f"document_{doc_id}_indexing") for doc_id in document_ids]
            redis_mock.get.assert_has_calls(expected_calls)

    def _assert_async_task_calls(self, mock_task, document_ids: list[str], task_type: str):
        """Helper method to verify async task calls."""
        expected_calls = [call(doc_id) for doc_id in document_ids]
        if task_type in {"add", "remove"}:
            mock_task.delay.assert_has_calls(expected_calls)

    # ==================== Enable Document Tests ====================

    def test_batch_update_enable_documents_success(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test successful enabling of disabled documents."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create disabled documents
        disabled_docs = DocumentBatchUpdateTestDataFactory.create_multiple_documents(["doc-1", "doc-2"], enabled=False)
        mock_document_service_dependencies["get_document"].side_effect = disabled_docs

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to enable documents
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1", "doc-2"], action="enable", user=user
        )

        # Verify document attributes were updated correctly
        for doc in disabled_docs:
            self._assert_document_enabled(doc, user.id, mock_document_service_dependencies["current_time"])

        # Verify Redis cache operations
        self._assert_redis_cache_operations(["doc-1", "doc-2"], "get")
        self._assert_redis_cache_operations(["doc-1", "doc-2"], "setex")

        # Verify async tasks were triggered for indexing
        self._assert_async_task_calls(mock_async_task_dependencies["add_task"], ["doc-1", "doc-2"], "add")

        # Verify database operations
        mock_db = mock_document_service_dependencies["db_session"]
        assert mock_db.add.call_count == 2
        assert mock_db.commit.call_count == 1

    def test_batch_update_enable_already_enabled_document_skipped(self, mock_document_service_dependencies):
        """Test enabling documents that are already enabled."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create already enabled document
        enabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True)
        mock_document_service_dependencies["get_document"].return_value = enabled_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to enable already enabled document
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="enable", user=user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

    # ==================== Disable Document Tests ====================

    def test_batch_update_disable_documents_success(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test successful disabling of enabled and completed documents."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create enabled documents
        enabled_docs = DocumentBatchUpdateTestDataFactory.create_multiple_documents(["doc-1", "doc-2"], enabled=True)
        mock_document_service_dependencies["get_document"].side_effect = enabled_docs

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to disable documents
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1", "doc-2"], action="disable", user=user
        )

        # Verify document attributes were updated correctly
        for doc in enabled_docs:
            self._assert_document_disabled(doc, user.id, mock_document_service_dependencies["current_time"])

        # Verify Redis cache operations for indexing prevention
        self._assert_redis_cache_operations(["doc-1", "doc-2"], "setex")

        # Verify async tasks were triggered to remove from index
        self._assert_async_task_calls(mock_async_task_dependencies["remove_task"], ["doc-1", "doc-2"], "remove")

        # Verify database operations
        mock_db = mock_document_service_dependencies["db_session"]
        assert mock_db.add.call_count == 2
        assert mock_db.commit.call_count == 1

    def test_batch_update_disable_already_disabled_document_skipped(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test disabling documents that are already disabled."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create already disabled document
        disabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=False)
        mock_document_service_dependencies["get_document"].return_value = disabled_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to disable already disabled document
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="disable", user=user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

        # Verify no async tasks were triggered (document was skipped)
        mock_async_task_dependencies["add_task"].delay.assert_not_called()

    def test_batch_update_disable_non_completed_document_error(self, mock_document_service_dependencies):
        """Test that DocumentIndexingError is raised when trying to disable non-completed documents."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create a document that's not completed
        non_completed_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(
            enabled=True,
            indexing_status="indexing",  # Not completed
            completed_at=None,  # Not completed
        )
        mock_document_service_dependencies["get_document"].return_value = non_completed_doc

        # Verify that DocumentIndexingError is raised
        with pytest.raises(DocumentIndexingError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=dataset, document_ids=["doc-1"], action="disable", user=user
            )

        # Verify error message indicates document is not completed
        assert "is not completed" in str(exc_info.value)

    # ==================== Archive Document Tests ====================

    def test_batch_update_archive_documents_success(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test successful archiving of unarchived documents."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create unarchived enabled document
        unarchived_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True, archived=False)
        mock_document_service_dependencies["get_document"].return_value = unarchived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to archive documents
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="archive", user=user
        )

        # Verify document attributes were updated correctly
        self._assert_document_archived(unarchived_doc, user.id, mock_document_service_dependencies["current_time"])

        # Verify Redis cache was set (because document was enabled)
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Verify async task was triggered to remove from index (because enabled)
        mock_async_task_dependencies["remove_task"].delay.assert_called_once_with("doc-1")

        # Verify database operations
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    def test_batch_update_archive_already_archived_document_skipped(self, mock_document_service_dependencies):
        """Test archiving documents that are already archived."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create already archived document
        archived_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True, archived=True)
        mock_document_service_dependencies["get_document"].return_value = archived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to archive already archived document
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-3"], action="archive", user=user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

    def test_batch_update_archive_disabled_document_no_index_removal(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test archiving disabled documents (should not trigger index removal)."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Set up disabled, unarchived document
        disabled_unarchived_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=False, archived=False)
        mock_document_service_dependencies["get_document"].return_value = disabled_unarchived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Archive the disabled document
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="archive", user=user
        )

        # Verify document was archived
        self._assert_document_archived(
            disabled_unarchived_doc, user.id, mock_document_service_dependencies["current_time"]
        )

        # Verify no Redis cache was set (document is disabled)
        redis_mock.setex.assert_not_called()

        # Verify no index removal task was triggered (document is disabled)
        mock_async_task_dependencies["remove_task"].delay.assert_not_called()

        # Verify database operations still occurred
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    # ==================== Unarchive Document Tests ====================

    def test_batch_update_unarchive_documents_success(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test successful unarchiving of archived documents."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create mock archived document
        archived_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True, archived=True)
        mock_document_service_dependencies["get_document"].return_value = archived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to unarchive documents
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="un_archive", user=user
        )

        # Verify document attributes were updated correctly
        self._assert_document_unarchived(archived_doc)
        assert archived_doc.updated_at == mock_document_service_dependencies["current_time"]

        # Verify Redis cache was set (because document is enabled)
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Verify async task was triggered to add back to index (because enabled)
        mock_async_task_dependencies["add_task"].delay.assert_called_once_with("doc-1")

        # Verify database operations
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    def test_batch_update_unarchive_already_unarchived_document_skipped(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test unarchiving documents that are already unarchived."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create already unarchived document
        unarchived_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True, archived=False)
        mock_document_service_dependencies["get_document"].return_value = unarchived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to unarchive already unarchived document
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="un_archive", user=user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

        # Verify no async tasks were triggered (document was skipped)
        mock_async_task_dependencies["add_task"].delay.assert_not_called()

    def test_batch_update_unarchive_disabled_document_no_index_addition(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test unarchiving disabled documents (should not trigger index addition)."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create mock archived but disabled document
        archived_disabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=False, archived=True)
        mock_document_service_dependencies["get_document"].return_value = archived_disabled_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Unarchive the disabled document
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1"], action="un_archive", user=user
        )

        # Verify document was unarchived
        self._assert_document_unarchived(archived_disabled_doc)
        assert archived_disabled_doc.updated_at == mock_document_service_dependencies["current_time"]

        # Verify no Redis cache was set (document is disabled)
        redis_mock.setex.assert_not_called()

        # Verify no index addition task was triggered (document is disabled)
        mock_async_task_dependencies["add_task"].delay.assert_not_called()

        # Verify database operations still occurred
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

    # ==================== Error Handling Tests ====================

    def test_batch_update_document_indexing_error_redis_cache_hit(self, mock_document_service_dependencies):
        """Test that DocumentIndexingError is raised when documents are currently being indexed."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create mock enabled document
        enabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True)
        mock_document_service_dependencies["get_document"].return_value = enabled_doc

        # Set up mock to indicate document is being indexed
        redis_mock.reset_mock()
        redis_mock.get.return_value = "indexing"

        # Verify that DocumentIndexingError is raised
        with pytest.raises(DocumentIndexingError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=dataset, document_ids=["doc-1"], action="enable", user=user
            )

        # Verify error message contains document name
        assert "test_document.pdf" in str(exc_info.value)
        assert "is being indexed" in str(exc_info.value)

        # Verify Redis cache was checked
        redis_mock.get.assert_called_once_with("document_doc-1_indexing")

    def test_batch_update_invalid_action_error(self, mock_document_service_dependencies):
        """Test that ValueError is raised when an invalid action is provided."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create mock document
        doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True)
        mock_document_service_dependencies["get_document"].return_value = doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Test with invalid action
        invalid_action = "invalid_action"
        with pytest.raises(ValueError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=dataset, document_ids=["doc-1"], action=invalid_action, user=user
            )

        # Verify error message contains the invalid action
        assert invalid_action in str(exc_info.value)
        assert "Invalid action" in str(exc_info.value)

        # Verify no Redis operations occurred
        redis_mock.setex.assert_not_called()

    def test_batch_update_async_task_error_handling(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test handling of async task errors during batch operations."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create mock disabled document
        disabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=False)
        mock_document_service_dependencies["get_document"].return_value = disabled_doc

        # Mock async task to raise an exception
        mock_async_task_dependencies["add_task"].delay.side_effect = Exception("Celery task error")

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Verify that async task error is propagated
        with pytest.raises(Exception) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=dataset, document_ids=["doc-1"], action="enable", user=user
            )

        # Verify error message
        assert "Celery task error" in str(exc_info.value)

        # Verify database operations completed successfully
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

        # Verify Redis cache was set successfully
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Verify document was updated
        self._assert_document_enabled(disabled_doc, user.id, mock_document_service_dependencies["current_time"])

    # ==================== Edge Case Tests ====================

    def test_batch_update_empty_document_list(self, mock_document_service_dependencies):
        """Test batch operations with an empty document ID list."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Call method with empty document list
        result = DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=[], action="enable", user=user
        )

        # Verify no document lookups were performed
        mock_document_service_dependencies["get_document"].assert_not_called()

        # Verify method returns None (early return)
        assert result is None

    def test_batch_update_document_not_found_skipped(self, mock_document_service_dependencies):
        """Test behavior when some documents don't exist in the database."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Mock document service to return None (document not found)
        mock_document_service_dependencies["get_document"].return_value = None

        # Call method with non-existent document ID
        # This should not raise an error, just skip the missing document
        try:
            DocumentService.batch_update_document_status(
                dataset=dataset, document_ids=["non-existent-doc"], action="enable", user=user
            )
        except Exception as e:
            pytest.fail(f"Method should not raise exception for missing documents: {e}")

        # Verify document lookup was attempted
        mock_document_service_dependencies["get_document"].assert_called_once_with(dataset.id, "non-existent-doc")

    def test_batch_update_mixed_document_states_and_actions(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test batch operations on documents with mixed states and various scenarios."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create documents in various states
        disabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock("doc-1", enabled=False)
        enabled_doc = DocumentBatchUpdateTestDataFactory.create_document_mock("doc-2", enabled=True)
        archived_doc = DocumentBatchUpdateTestDataFactory.create_document_mock("doc-3", enabled=True, archived=True)

        # Mix of different document states
        documents = [disabled_doc, enabled_doc, archived_doc]
        mock_document_service_dependencies["get_document"].side_effect = documents

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Perform enable operation on mixed state documents
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=["doc-1", "doc-2", "doc-3"], action="enable", user=user
        )

        # Verify only the disabled document was processed
        # (enabled and archived documents should be skipped for enable action)

        # Only one add should occur (for the disabled document that was enabled)
        mock_db = mock_document_service_dependencies["db_session"]
        mock_db.add.assert_called_once()
        # Only one commit should occur
        mock_db.commit.assert_called_once()

        # Only one Redis setex should occur (for the document that was enabled)
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Only one async task should be triggered (for the document that was enabled)
        mock_async_task_dependencies["add_task"].delay.assert_called_once_with("doc-1")

    # ==================== Performance Tests ====================

    def test_batch_update_large_document_list_performance(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test batch operations with a large number of documents."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create large list of document IDs
        document_ids = [f"doc-{i}" for i in range(1, 101)]  # 100 documents

        # Create mock documents
        mock_documents = DocumentBatchUpdateTestDataFactory.create_multiple_documents(
            document_ids,
            enabled=False,  # All disabled, will be enabled
        )
        mock_document_service_dependencies["get_document"].side_effect = mock_documents

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Perform batch enable operation
        DocumentService.batch_update_document_status(
            dataset=dataset, document_ids=document_ids, action="enable", user=user
        )

        # Verify all documents were processed
        assert mock_document_service_dependencies["get_document"].call_count == 100

        # Verify all documents were updated
        for mock_doc in mock_documents:
            self._assert_document_enabled(mock_doc, user.id, mock_document_service_dependencies["current_time"])

        # Verify database operations
        mock_db = mock_document_service_dependencies["db_session"]
        assert mock_db.add.call_count == 100
        assert mock_db.commit.call_count == 1

        # Verify Redis cache operations occurred for each document
        assert redis_mock.setex.call_count == 100

        # Verify async tasks were triggered for each document
        assert mock_async_task_dependencies["add_task"].delay.call_count == 100

        # Verify correct Redis cache keys were set
        expected_redis_calls = [call(f"document_doc-{i}_indexing", 600, 1) for i in range(1, 101)]
        redis_mock.setex.assert_has_calls(expected_redis_calls)

        # Verify correct async task calls
        expected_task_calls = [call(f"doc-{i}") for i in range(1, 101)]
        mock_async_task_dependencies["add_task"].delay.assert_has_calls(expected_task_calls)

    def test_batch_update_mixed_document_states_complex_scenario(
        self, mock_document_service_dependencies, mock_async_task_dependencies
    ):
        """Test complex batch operations with documents in various states."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        # Create documents in various states
        doc1 = DocumentBatchUpdateTestDataFactory.create_document_mock("doc-1", enabled=False)  # Will be enabled
        doc2 = DocumentBatchUpdateTestDataFactory.create_document_mock(
            "doc-2", enabled=True
        )  # Already enabled, will be skipped
        doc3 = DocumentBatchUpdateTestDataFactory.create_document_mock(
            "doc-3", enabled=True
        )  # Already enabled, will be skipped
        doc4 = DocumentBatchUpdateTestDataFactory.create_document_mock(
            "doc-4", enabled=True
        )  # Not affected by enable action
        doc5 = DocumentBatchUpdateTestDataFactory.create_document_mock(
            "doc-5", enabled=True, archived=True
        )  # Not affected by enable action
        doc6 = None  # Non-existent, will be skipped

        mock_document_service_dependencies["get_document"].side_effect = [doc1, doc2, doc3, doc4, doc5, doc6]

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Perform mixed batch operations
        DocumentService.batch_update_document_status(
            dataset=dataset,
            document_ids=["doc-1", "doc-2", "doc-3", "doc-4", "doc-5", "doc-6"],
            action="enable",  # This will only affect doc1
            user=user,
        )

        # Verify document 1 was enabled
        self._assert_document_enabled(doc1, user.id, mock_document_service_dependencies["current_time"])

        # Verify other documents were skipped appropriately
        assert doc2.enabled == True  # No change
        assert doc3.enabled == True  # No change
        assert doc4.enabled == True  # No change
        assert doc5.enabled == True  # No change

        # Verify database commits occurred for processed documents
        # Only doc1 should be added (others were skipped, doc6 doesn't exist)
        mock_db = mock_document_service_dependencies["db_session"]
        assert mock_db.add.call_count == 1
        assert mock_db.commit.call_count == 1

        # Verify Redis cache operations occurred for processed documents
        # Only doc1 should have Redis operations
        assert redis_mock.setex.call_count == 1

        # Verify async tasks were triggered for processed documents
        # Only doc1 should trigger tasks
        assert mock_async_task_dependencies["add_task"].delay.call_count == 1

        # Verify correct Redis cache keys were set
        expected_redis_calls = [call("document_doc-1_indexing", 600, 1)]
        redis_mock.setex.assert_has_calls(expected_redis_calls)

        # Verify correct async task calls
        expected_task_calls = [call("doc-1")]
        mock_async_task_dependencies["add_task"].delay.assert_has_calls(expected_task_calls)
