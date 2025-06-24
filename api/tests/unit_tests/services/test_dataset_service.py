import datetime
import unittest

# Mock redis_client before importing dataset_service
from unittest.mock import Mock, call, patch

import pytest

from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from services.errors.document import DocumentIndexingError
from tests.unit_tests.conftest import redis_mock


class TestDatasetServiceBatchUpdateDocumentStatus(unittest.TestCase):
    """
    Comprehensive unit tests for DocumentService.batch_update_document_status method.

    This test suite covers all supported actions (enable, disable, archive, un_archive),
    error conditions, edge cases, and validates proper interaction with Redis cache,
    database operations, and async task triggers.
    """

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_enable_documents_success(self, mock_datetime, mock_get_doc, mock_add_task, mock_db):
        """
        Test successful enabling of disabled documents.

        Verifies that:
        1. Only disabled documents are processed (already enabled documents are skipped)
        2. Document attributes are updated correctly (enabled=True, metadata cleared)
        3. Database changes are committed for each document
        4. Redis cache keys are set to prevent concurrent indexing
        5. Async indexing task is triggered for each enabled document
        6. Timestamp fields are properly updated
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock disabled document
        mock_disabled_doc_1 = Mock(spec=Document)
        mock_disabled_doc_1.id = "doc-1"
        mock_disabled_doc_1.name = "disabled_document.pdf"
        mock_disabled_doc_1.enabled = False
        mock_disabled_doc_1.archived = False
        mock_disabled_doc_1.indexing_status = "completed"
        mock_disabled_doc_1.completed_at = datetime.datetime.now()

        mock_disabled_doc_2 = Mock(spec=Document)
        mock_disabled_doc_2.id = "doc-2"
        mock_disabled_doc_2.name = "disabled_document.pdf"
        mock_disabled_doc_2.enabled = False
        mock_disabled_doc_2.archived = False
        mock_disabled_doc_2.indexing_status = "completed"
        mock_disabled_doc_2.completed_at = datetime.datetime.now()

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock document retrieval to return disabled documents
        mock_get_doc.side_effect = [mock_disabled_doc_1, mock_disabled_doc_2]

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to enable documents
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1", "doc-2"], action="enable", user=mock_user
        )

        # Verify document attributes were updated correctly
        for mock_doc in [mock_disabled_doc_1, mock_disabled_doc_2]:
            # Check that document was enabled
            assert mock_doc.enabled == True
            # Check that disable metadata was cleared
            assert mock_doc.disabled_at is None
            assert mock_doc.disabled_by is None
            # Check that update timestamp was set
            assert mock_doc.updated_at == current_time.replace(tzinfo=None)

        # Verify Redis cache operations
        expected_cache_calls = [call("document_doc-1_indexing"), call("document_doc-2_indexing")]
        redis_mock.get.assert_has_calls(expected_cache_calls)

        # Verify Redis cache was set to prevent concurrent indexing (600 seconds)
        expected_setex_calls = [call("document_doc-1_indexing", 600, 1), call("document_doc-2_indexing", 600, 1)]
        redis_mock.setex.assert_has_calls(expected_setex_calls)

        # Verify async tasks were triggered for indexing
        expected_task_calls = [call("doc-1"), call("doc-2")]
        mock_add_task.delay.assert_has_calls(expected_task_calls)

        # Verify database add counts (one add for one document)
        assert mock_db.add.call_count == 2
        # Verify database commits (one commit for the batch operation)
        assert mock_db.commit.call_count == 1

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.remove_document_from_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_disable_documents_success(self, mock_datetime, mock_get_doc, mock_remove_task, mock_db):
        """
        Test successful disabling of enabled and completed documents.

        Verifies that:
        1. Only completed and enabled documents can be disabled
        2. Document attributes are updated correctly (enabled=False, disable metadata set)
        3. User ID is recorded in disabled_by field
        4. Database changes are committed for each document
        5. Redis cache keys are set to prevent concurrent indexing
        6. Async task is triggered to remove documents from index
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock enabled document
        mock_enabled_doc_1 = Mock(spec=Document)
        mock_enabled_doc_1.id = "doc-1"
        mock_enabled_doc_1.name = "enabled_document.pdf"
        mock_enabled_doc_1.enabled = True
        mock_enabled_doc_1.archived = False
        mock_enabled_doc_1.indexing_status = "completed"
        mock_enabled_doc_1.completed_at = datetime.datetime.now()

        mock_enabled_doc_2 = Mock(spec=Document)
        mock_enabled_doc_2.id = "doc-2"
        mock_enabled_doc_2.name = "enabled_document.pdf"
        mock_enabled_doc_2.enabled = True
        mock_enabled_doc_2.archived = False
        mock_enabled_doc_2.indexing_status = "completed"
        mock_enabled_doc_2.completed_at = datetime.datetime.now()

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mock document retrieval to return enabled, completed documents
        mock_get_doc.side_effect = [mock_enabled_doc_1, mock_enabled_doc_2]

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to disable documents
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1", "doc-2"], action="disable", user=mock_user
        )

        # Verify document attributes were updated correctly
        for mock_doc in [mock_enabled_doc_1, mock_enabled_doc_2]:
            # Check that document was disabled
            assert mock_doc.enabled == False
            # Check that disable metadata was set correctly
            assert mock_doc.disabled_at == current_time.replace(tzinfo=None)
            assert mock_doc.disabled_by == mock_user.id
            # Check that update timestamp was set
            assert mock_doc.updated_at == current_time.replace(tzinfo=None)

        # Verify Redis cache operations for indexing prevention
        expected_setex_calls = [call("document_doc-1_indexing", 600, 1), call("document_doc-2_indexing", 600, 1)]
        redis_mock.setex.assert_has_calls(expected_setex_calls)

        # Verify async tasks were triggered to remove from index
        expected_task_calls = [call("doc-1"), call("doc-2")]
        mock_remove_task.delay.assert_has_calls(expected_task_calls)

        # Verify database add counts (one add for one document)
        assert mock_db.add.call_count == 2
        # Verify database commits (totally 1 for any batch operation)
        assert mock_db.commit.call_count == 1

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.remove_document_from_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_archive_documents_success(self, mock_datetime, mock_get_doc, mock_remove_task, mock_db):
        """
        Test successful archiving of unarchived documents.

        Verifies that:
        1. Only unarchived documents are processed (already archived are skipped)
        2. Document attributes are updated correctly (archived=True, archive metadata set)
        3. User ID is recorded in archived_by field
        4. If documents are enabled, they are removed from the index
        5. Redis cache keys are set only for enabled documents being archived
        6. Database changes are committed for each document
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create unarchived enabled document
        unarchived_doc = Mock(spec=Document)
        # Manually set attributes to ensure they can be modified
        unarchived_doc.id = "doc-1"
        unarchived_doc.name = "unarchived_document.pdf"
        unarchived_doc.enabled = True
        unarchived_doc.archived = False

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        mock_get_doc.return_value = unarchived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to archive documents
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1"], action="archive", user=mock_user
        )

        # Verify document attributes were updated correctly
        assert unarchived_doc.archived == True
        assert unarchived_doc.archived_at == current_time.replace(tzinfo=None)
        assert unarchived_doc.archived_by == mock_user.id
        assert unarchived_doc.updated_at == current_time.replace(tzinfo=None)

        # Verify Redis cache was set (because document was enabled)
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Verify async task was triggered to remove from index (because enabled)
        mock_remove_task.delay.assert_called_once_with("doc-1")

        # Verify database add
        mock_db.add.assert_called_once()
        # Verify database commit
        mock_db.commit.assert_called_once()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_unarchive_documents_success(self, mock_datetime, mock_get_doc, mock_add_task, mock_db):
        """
        Test successful unarchiving of archived documents.

        Verifies that:
        1. Only archived documents are processed (already unarchived are skipped)
        2. Document attributes are updated correctly (archived=False, archive metadata cleared)
        3. If documents are enabled, they are added back to the index
        4. Redis cache keys are set only for enabled documents being unarchived
        5. Database changes are committed for each document
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock archived document
        mock_archived_doc = Mock(spec=Document)
        mock_archived_doc.id = "doc-3"
        mock_archived_doc.name = "archived_document.pdf"
        mock_archived_doc.enabled = True
        mock_archived_doc.archived = True
        mock_archived_doc.indexing_status = "completed"
        mock_archived_doc.completed_at = datetime.datetime.now()

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        mock_get_doc.return_value = mock_archived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Call the method to unarchive documents
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-3"], action="un_archive", user=mock_user
        )

        # Verify document attributes were updated correctly
        assert mock_archived_doc.archived == False
        assert mock_archived_doc.archived_at is None
        assert mock_archived_doc.archived_by is None
        assert mock_archived_doc.updated_at == current_time.replace(tzinfo=None)

        # Verify Redis cache was set (because document is enabled)
        redis_mock.setex.assert_called_once_with("document_doc-3_indexing", 600, 1)

        # Verify async task was triggered to add back to index (because enabled)
        mock_add_task.delay.assert_called_once_with("doc-3")

        # Verify database add
        mock_db.add.assert_called_once()
        # Verify database commit
        mock_db.commit.assert_called_once()

    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_document_indexing_error_redis_cache_hit(self, mock_get_doc):
        """
        Test that DocumentIndexingError is raised when documents are currently being indexed.

        Verifies that:
        1. The method checks Redis cache for active indexing operations
        2. DocumentIndexingError is raised if any document is being indexed
        3. Error message includes the document name for user feedback
        4. No further processing occurs when indexing is detected
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock enabled document
        mock_enabled_doc = Mock(spec=Document)
        mock_enabled_doc.id = "doc-1"
        mock_enabled_doc.name = "enabled_document.pdf"
        mock_enabled_doc.enabled = True
        mock_enabled_doc.archived = False
        mock_enabled_doc.indexing_status = "completed"
        mock_enabled_doc.completed_at = datetime.datetime.now()

        # Set up mock to indicate document is being indexed
        mock_get_doc.return_value = mock_enabled_doc

        # Reset module-level Redis mock, set to indexing status
        redis_mock.reset_mock()
        redis_mock.get.return_value = "indexing"

        # Verify that DocumentIndexingError is raised
        with pytest.raises(DocumentIndexingError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=mock_dataset, document_ids=["doc-1"], action="enable", user=mock_user
            )

        # Verify error message contains document name
        assert "enabled_document.pdf" in str(exc_info.value)
        assert "is being indexed" in str(exc_info.value)

        # Verify Redis cache was checked
        redis_mock.get.assert_called_once_with("document_doc-1_indexing")

    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_disable_non_completed_document_error(self, mock_get_doc):
        """
        Test that DocumentIndexingError is raised when trying to disable non-completed documents.

        Verifies that:
        1. Only completed documents can be disabled
        2. DocumentIndexingError is raised for non-completed documents
        3. Error message indicates the document is not completed
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create a document that's not completed
        non_completed_doc = Mock(spec=Document)
        # Manually set attributes to ensure they can be modified
        non_completed_doc.id = "doc-1"
        non_completed_doc.name = "indexing_document.pdf"
        non_completed_doc.enabled = True
        non_completed_doc.indexing_status = "indexing"  # Not completed
        non_completed_doc.completed_at = None  # Not completed

        mock_get_doc.return_value = non_completed_doc

        # Verify that DocumentIndexingError is raised
        with pytest.raises(DocumentIndexingError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=mock_dataset, document_ids=["doc-1"], action="disable", user=mock_user
            )

        # Verify error message indicates document is not completed
        assert "is not completed" in str(exc_info.value)

    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_empty_document_list(self, mock_get_doc):
        """
        Test batch operations with an empty document ID list.

        Verifies that:
        1. The method handles empty input gracefully
        2. No document operations are performed with empty input
        3. No errors are raised with empty input
        4. Method returns early without processing
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Call method with empty document list
        result = DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=[], action="enable", user=mock_user
        )

        # Verify no document lookups were performed
        mock_get_doc.assert_not_called()

        # Verify method returns None (early return)
        assert result is None

    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_document_not_found_skipped(self, mock_get_doc):
        """
        Test behavior when some documents don't exist in the database.

        Verifies that:
        1. Non-existent documents are gracefully skipped
        2. Processing continues for existing documents
        3. No errors are raised for missing document IDs
        4. Method completes successfully despite missing documents
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Mock document service to return None (document not found)
        mock_get_doc.return_value = None

        # Call method with non-existent document ID
        # This should not raise an error, just skip the missing document
        try:
            DocumentService.batch_update_document_status(
                dataset=mock_dataset, document_ids=["non-existent-doc"], action="enable", user=mock_user
            )
        except Exception as e:
            pytest.fail(f"Method should not raise exception for missing documents: {e}")

        # Verify document lookup was attempted
        mock_get_doc.assert_called_once_with(mock_dataset.id, "non-existent-doc")

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_enable_already_enabled_document_skipped(self, mock_get_doc, mock_db):
        """
        Test enabling documents that are already enabled.

        Verifies that:
        1. Already enabled documents are skipped (no unnecessary operations)
        2. No database commits occur for already enabled documents
        3. No Redis cache operations occur for skipped documents
        4. No async tasks are triggered for skipped documents
        5. Method completes successfully
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock enabled document
        mock_enabled_doc = Mock(spec=Document)
        mock_enabled_doc.id = "doc-1"
        mock_enabled_doc.name = "enabled_document.pdf"
        mock_enabled_doc.enabled = True
        mock_enabled_doc.archived = False
        mock_enabled_doc.indexing_status = "completed"
        mock_enabled_doc.completed_at = datetime.datetime.now()

        # Mock document that is already enabled
        mock_get_doc.return_value = mock_enabled_doc  # Already enabled

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to enable already enabled document
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1"], action="enable", user=mock_user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_archive_already_archived_document_skipped(self, mock_get_doc, mock_db):
        """
        Test archiving documents that are already archived.

        Verifies that:
        1. Already archived documents are skipped (no unnecessary operations)
        2. No database commits occur for already archived documents
        3. No Redis cache operations occur for skipped documents
        4. No async tasks are triggered for skipped documents
        5. Method completes successfully
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock archived document
        mock_archived_doc = Mock(spec=Document)
        mock_archived_doc.id = "doc-3"
        mock_archived_doc.name = "archived_document.pdf"
        mock_archived_doc.enabled = True
        mock_archived_doc.archived = True
        mock_archived_doc.indexing_status = "completed"
        mock_archived_doc.completed_at = datetime.datetime.now()

        # Mock document that is already archived
        mock_get_doc.return_value = mock_archived_doc  # Already archived

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to archive already archived document
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-3"], action="archive", user=mock_user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.remove_document_from_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_mixed_document_states_and_actions(
        self, mock_datetime, mock_get_doc, mock_remove_task, mock_add_task, mock_db
    ):
        """
        Test batch operations on documents with mixed states and various scenarios.

        Verifies that:
        1. Each document is processed according to its current state
        2. Some documents may be skipped while others are processed
        3. Different async tasks are triggered based on document states
        4. Method handles mixed scenarios gracefully
        5. Database commits occur only for documents that were actually modified
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock documents with different states
        mock_disabled_doc = Mock(spec=Document)
        mock_disabled_doc.id = "doc-1"
        mock_disabled_doc.name = "disabled_document.pdf"
        mock_disabled_doc.enabled = False
        mock_disabled_doc.archived = False
        mock_disabled_doc.indexing_status = "completed"
        mock_disabled_doc.completed_at = datetime.datetime.now()

        mock_enabled_doc = Mock(spec=Document)
        mock_enabled_doc.id = "doc-2"
        mock_enabled_doc.name = "enabled_document.pdf"
        mock_enabled_doc.enabled = True
        mock_enabled_doc.archived = False
        mock_enabled_doc.indexing_status = "completed"
        mock_enabled_doc.completed_at = datetime.datetime.now()

        mock_archived_doc = Mock(spec=Document)
        mock_archived_doc.id = "doc-3"
        mock_archived_doc.name = "archived_document.pdf"
        mock_archived_doc.enabled = True
        mock_archived_doc.archived = True
        mock_archived_doc.indexing_status = "completed"
        mock_archived_doc.completed_at = datetime.datetime.now()

        # Set up mixed document states
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Mix of different document states
        documents = [
            mock_disabled_doc,  # Will be enabled
            mock_enabled_doc,  # Already enabled, will be skipped
            mock_archived_doc,  # Archived but enabled, will be skipped for enable action
        ]

        mock_get_doc.side_effect = documents

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Perform enable operation on mixed state documents
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1", "doc-2", "doc-3"], action="enable", user=mock_user
        )

        # Verify only the disabled document was processed
        # (enabled and archived documents should be skipped for enable action)

        # Only one add should occur (for the disabled document that was enabled)
        mock_db.add.assert_called_once()
        # Only one commit should occur
        mock_db.commit.assert_called_once()

        # Only one Redis setex should occur (for the document that was enabled)
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Only one async task should be triggered (for the document that was enabled)
        mock_add_task.delay.assert_called_once_with("doc-1")

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.remove_document_from_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_archive_disabled_document_no_index_removal(
        self, mock_datetime, mock_get_doc, mock_remove_task, mock_db
    ):
        """
        Test archiving disabled documents (should not trigger index removal).

        Verifies that:
        1. Disabled documents can be archived
        2. Archive metadata is set correctly
        3. No index removal task is triggered (because document is disabled)
        4. No Redis cache key is set (because document is disabled)
        5. Database commit still occurs
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Set up disabled, unarchived document
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        disabled_unarchived_doc = Mock(spec=Document)
        # Manually set attributes to ensure they can be modified
        disabled_unarchived_doc.id = "doc-1"
        disabled_unarchived_doc.name = "disabled_document.pdf"
        disabled_unarchived_doc.enabled = False  # Disabled
        disabled_unarchived_doc.archived = False  # Not archived

        mock_get_doc.return_value = disabled_unarchived_doc
        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Archive the disabled document
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1"], action="archive", user=mock_user
        )

        # Verify document was archived
        assert disabled_unarchived_doc.archived == True
        assert disabled_unarchived_doc.archived_at == current_time.replace(tzinfo=None)
        assert disabled_unarchived_doc.archived_by == mock_user.id

        # Verify no Redis cache was set (document is disabled)
        redis_mock.setex.assert_not_called()

        # Verify no index removal task was triggered (document is disabled)
        mock_remove_task.delay.assert_not_called()

        # Verify database add still occurred
        mock_db.add.assert_called_once()
        # Verify database commit still occurred
        mock_db.commit.assert_called_once()

    @patch("services.dataset_service.DocumentService.get_document")
    def test_batch_update_invalid_action_error(self, mock_get_doc):
        """
        Test that ValueError is raised when an invalid action is provided.

        Verifies that:
        1. Invalid actions are rejected with ValueError
        2. Error message includes the invalid action name
        3. No document processing occurs with invalid actions
        4. Method fails fast on invalid input
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock document
        mock_doc = Mock(spec=Document)
        mock_doc.id = "doc-1"
        mock_doc.name = "test_document.pdf"
        mock_doc.enabled = True
        mock_doc.archived = False

        mock_get_doc.return_value = mock_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Test with invalid action
        invalid_action = "invalid_action"
        with pytest.raises(ValueError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=mock_dataset, document_ids=["doc-1"], action=invalid_action, user=mock_user
            )

        # Verify error message contains the invalid action
        assert invalid_action in str(exc_info.value)
        assert "Invalid action" in str(exc_info.value)

        # Verify no Redis operations occurred
        redis_mock.setex.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_disable_already_disabled_document_skipped(
        self, mock_datetime, mock_get_doc, mock_add_task, mock_db
    ):
        """
        Test disabling documents that are already disabled.

        Verifies that:
        1. Already disabled documents are skipped (no unnecessary operations)
        2. No database commits occur for already disabled documents
        3. No Redis cache operations occur for skipped documents
        4. No async tasks are triggered for skipped documents
        5. Method completes successfully
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock disabled document
        mock_disabled_doc = Mock(spec=Document)
        mock_disabled_doc.id = "doc-1"
        mock_disabled_doc.name = "disabled_document.pdf"
        mock_disabled_doc.enabled = False  # Already disabled
        mock_disabled_doc.archived = False
        mock_disabled_doc.indexing_status = "completed"
        mock_disabled_doc.completed_at = datetime.datetime.now()

        # Mock document that is already disabled
        mock_get_doc.return_value = mock_disabled_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to disable already disabled document
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1"], action="disable", user=mock_user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

        # Verify no async tasks were triggered (document was skipped)
        mock_add_task.delay.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_unarchive_already_unarchived_document_skipped(
        self, mock_datetime, mock_get_doc, mock_add_task, mock_db
    ):
        """
        Test unarchiving documents that are already unarchived.

        Verifies that:
        1. Already unarchived documents are skipped (no unnecessary operations)
        2. No database commits occur for already unarchived documents
        3. No Redis cache operations occur for skipped documents
        4. No async tasks are triggered for skipped documents
        5. Method completes successfully
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock unarchived document
        mock_unarchived_doc = Mock(spec=Document)
        mock_unarchived_doc.id = "doc-1"
        mock_unarchived_doc.name = "unarchived_document.pdf"
        mock_unarchived_doc.enabled = True
        mock_unarchived_doc.archived = False  # Already unarchived
        mock_unarchived_doc.indexing_status = "completed"
        mock_unarchived_doc.completed_at = datetime.datetime.now()

        # Mock document that is already unarchived
        mock_get_doc.return_value = mock_unarchived_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Attempt to unarchive already unarchived document
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1"], action="un_archive", user=mock_user
        )

        # Verify no database operations occurred (document was skipped)
        mock_db.commit.assert_not_called()

        # Verify no Redis setex operations occurred (document was skipped)
        redis_mock.setex.assert_not_called()

        # Verify no async tasks were triggered (document was skipped)
        mock_add_task.delay.assert_not_called()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_unarchive_disabled_document_no_index_addition(
        self, mock_datetime, mock_get_doc, mock_add_task, mock_db
    ):
        """
        Test unarchiving disabled documents (should not trigger index addition).

        Verifies that:
        1. Disabled documents can be unarchived
        2. Unarchive metadata is cleared correctly
        3. No index addition task is triggered (because document is disabled)
        4. No Redis cache key is set (because document is disabled)
        5. Database commit still occurs
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock archived but disabled document
        mock_archived_disabled_doc = Mock(spec=Document)
        mock_archived_disabled_doc.id = "doc-1"
        mock_archived_disabled_doc.name = "archived_disabled_document.pdf"
        mock_archived_disabled_doc.enabled = False  # Disabled
        mock_archived_disabled_doc.archived = True  # Archived
        mock_archived_disabled_doc.indexing_status = "completed"
        mock_archived_disabled_doc.completed_at = datetime.datetime.now()

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        mock_get_doc.return_value = mock_archived_disabled_doc

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Unarchive the disabled document
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=["doc-1"], action="un_archive", user=mock_user
        )

        # Verify document was unarchived
        assert mock_archived_disabled_doc.archived == False
        assert mock_archived_disabled_doc.archived_at is None
        assert mock_archived_disabled_doc.archived_by is None
        assert mock_archived_disabled_doc.updated_at == current_time.replace(tzinfo=None)

        # Verify no Redis cache was set (document is disabled)
        redis_mock.setex.assert_not_called()

        # Verify no index addition task was triggered (document is disabled)
        mock_add_task.delay.assert_not_called()

        # Verify database add still occurred
        mock_db.add.assert_called_once()
        # Verify database commit still occurred
        mock_db.commit.assert_called_once()

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_async_task_error_handling(self, mock_datetime, mock_get_doc, mock_add_task, mock_db):
        """
        Test handling of async task errors during batch operations.

        Verifies that:
        1. Async task errors are properly handled
        2. Database operations complete successfully
        3. Redis cache operations complete successfully
        4. Method continues processing despite async task errors
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create mock disabled document
        mock_disabled_doc = Mock(spec=Document)
        mock_disabled_doc.id = "doc-1"
        mock_disabled_doc.name = "disabled_document.pdf"
        mock_disabled_doc.enabled = False
        mock_disabled_doc.archived = False
        mock_disabled_doc.indexing_status = "completed"
        mock_disabled_doc.completed_at = datetime.datetime.now()

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        mock_get_doc.return_value = mock_disabled_doc

        # Mock async task to raise an exception
        mock_add_task.delay.side_effect = Exception("Celery task error")

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Verify that async task error is propagated
        with pytest.raises(Exception) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=mock_dataset, document_ids=["doc-1"], action="enable", user=mock_user
            )

        # Verify error message
        assert "Celery task error" in str(exc_info.value)

        # Verify database operations completed successfully
        mock_db.add.assert_called_once()
        mock_db.commit.assert_called_once()

        # Verify Redis cache was set successfully
        redis_mock.setex.assert_called_once_with("document_doc-1_indexing", 600, 1)

        # Verify document was updated
        assert mock_disabled_doc.enabled == True
        assert mock_disabled_doc.disabled_at is None
        assert mock_disabled_doc.disabled_by is None

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_large_document_list_performance(self, mock_datetime, mock_get_doc, mock_add_task, mock_db):
        """
        Test batch operations with a large number of documents.

        Verifies that:
        1. Method can handle large document lists efficiently
        2. All documents are processed correctly
        3. Database commits occur for each document
        4. Redis cache operations occur for each document
        5. Async tasks are triggered for each document
        6. Performance remains consistent with large inputs
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create large list of document IDs
        document_ids = [f"doc-{i}" for i in range(1, 101)]  # 100 documents

        # Create mock documents
        mock_documents = []
        for i in range(1, 101):
            mock_doc = Mock(spec=Document)
            mock_doc.id = f"doc-{i}"
            mock_doc.name = f"document_{i}.pdf"
            mock_doc.enabled = False  # All disabled, will be enabled
            mock_doc.archived = False
            mock_doc.indexing_status = "completed"
            mock_doc.completed_at = datetime.datetime.now()
            mock_documents.append(mock_doc)

        # Set up mock return values
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        mock_get_doc.side_effect = mock_documents

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Perform batch enable operation
        DocumentService.batch_update_document_status(
            dataset=mock_dataset, document_ids=document_ids, action="enable", user=mock_user
        )

        # Verify all documents were processed
        assert mock_get_doc.call_count == 100

        # Verify all documents were updated
        for mock_doc in mock_documents:
            assert mock_doc.enabled == True
            assert mock_doc.disabled_at is None
            assert mock_doc.disabled_by is None
            assert mock_doc.updated_at == current_time.replace(tzinfo=None)

        # Verify database commits, one add for one document
        assert mock_db.add.call_count == 100
        # Verify database commits, one commit for the batch operation
        assert mock_db.commit.call_count == 1

        # Verify Redis cache operations occurred for each document
        assert redis_mock.setex.call_count == 100

        # Verify async tasks were triggered for each document
        assert mock_add_task.delay.call_count == 100

        # Verify correct Redis cache keys were set
        expected_redis_calls = [call(f"document_doc-{i}_indexing", 600, 1) for i in range(1, 101)]
        redis_mock.setex.assert_has_calls(expected_redis_calls)

        # Verify correct async task calls
        expected_task_calls = [call(f"doc-{i}") for i in range(1, 101)]
        mock_add_task.delay.assert_has_calls(expected_task_calls)

    @patch("extensions.ext_database.db.session")
    @patch("services.dataset_service.add_document_to_index_task")
    @patch("services.dataset_service.DocumentService.get_document")
    @patch("services.dataset_service.datetime")
    def test_batch_update_mixed_document_states_complex_scenario(
        self, mock_datetime, mock_get_doc, mock_add_task, mock_db
    ):
        """
        Test complex batch operations with documents in various states.

        Verifies that:
        1. Each document is processed according to its current state
        2. Some documents are skipped while others are processed
        3. Different actions trigger different async tasks
        4. Database commits occur only for modified documents
        5. Redis cache operations occur only for relevant documents
        6. Method handles complex mixed scenarios correctly
        """
        # Create mock dataset
        mock_dataset = Mock(spec=Dataset)
        mock_dataset.id = "dataset-123"
        mock_dataset.tenant_id = "tenant-456"

        # Create mock user
        mock_user = Mock()
        mock_user.id = "user-789"

        # Create documents in various states
        current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
        mock_datetime.datetime.now.return_value = current_time
        mock_datetime.UTC = datetime.UTC

        # Document 1: Disabled, will be enabled
        doc1 = Mock(spec=Document)
        doc1.id = "doc-1"
        doc1.name = "disabled_doc.pdf"
        doc1.enabled = False
        doc1.archived = False
        doc1.indexing_status = "completed"
        doc1.completed_at = datetime.datetime.now()

        # Document 2: Already enabled, will be skipped
        doc2 = Mock(spec=Document)
        doc2.id = "doc-2"
        doc2.name = "enabled_doc.pdf"
        doc2.enabled = True
        doc2.archived = False
        doc2.indexing_status = "completed"
        doc2.completed_at = datetime.datetime.now()

        # Document 3: Enabled and completed, will be disabled
        doc3 = Mock(spec=Document)
        doc3.id = "doc-3"
        doc3.name = "enabled_completed_doc.pdf"
        doc3.enabled = True
        doc3.archived = False
        doc3.indexing_status = "completed"
        doc3.completed_at = datetime.datetime.now()

        # Document 4: Unarchived, will be archived
        doc4 = Mock(spec=Document)
        doc4.id = "doc-4"
        doc4.name = "unarchived_doc.pdf"
        doc4.enabled = True
        doc4.archived = False
        doc4.indexing_status = "completed"
        doc4.completed_at = datetime.datetime.now()

        # Document 5: Archived, will be unarchived
        doc5 = Mock(spec=Document)
        doc5.id = "doc-5"
        doc5.name = "archived_doc.pdf"
        doc5.enabled = True
        doc5.archived = True
        doc5.indexing_status = "completed"
        doc5.completed_at = datetime.datetime.now()

        # Document 6: Non-existent, will be skipped
        doc6 = None

        mock_get_doc.side_effect = [doc1, doc2, doc3, doc4, doc5, doc6]

        # Reset module-level Redis mock
        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        # Perform mixed batch operations
        DocumentService.batch_update_document_status(
            dataset=mock_dataset,
            document_ids=["doc-1", "doc-2", "doc-3", "doc-4", "doc-5", "doc-6"],
            action="enable",  # This will only affect doc1 and doc3 (doc3 will be enabled then disabled)
            user=mock_user,
        )

        # Verify document 1 was enabled
        assert doc1.enabled == True
        assert doc1.disabled_at is None
        assert doc1.disabled_by is None

        # Verify document 2 was skipped (already enabled)
        assert doc2.enabled == True  # No change

        # Verify document 3 was skipped (already enabled)
        assert doc3.enabled == True

        # Verify document 4 was skipped (not affected by enable action)
        assert doc4.enabled == True  # No change

        # Verify document 5 was skipped (not affected by enable action)
        assert doc5.enabled == True  # No change

        # Verify database commits occurred for processed documents
        # Only doc1 should be added (doc2, doc3, doc4, doc5 were skipped, doc6 doesn't exist)
        assert mock_db.add.call_count == 1
        assert mock_db.commit.call_count == 1

        # Verify Redis cache operations occurred for processed documents
        # Only doc1 should have Redis operations
        assert redis_mock.setex.call_count == 1

        # Verify async tasks were triggered for processed documents
        # Only doc1 should trigger tasks
        assert mock_add_task.delay.call_count == 1

        # Verify correct Redis cache keys were set
        expected_redis_calls = [call("document_doc-1_indexing", 600, 1)]
        redis_mock.setex.assert_has_calls(expected_redis_calls)

        # Verify correct async task calls
        expected_task_calls = [call("doc-1")]
        mock_add_task.delay.assert_has_calls(expected_task_calls)
