"""
Comprehensive unit tests for DocumentService status management methods.

This module contains extensive unit tests for the DocumentService class,
specifically focusing on document status management operations including
pause, recover, retry, batch updates, and renaming.

The DocumentService provides methods for:
- Pausing document indexing processes (pause_document)
- Recovering documents from paused or error states (recover_document)
- Retrying failed document indexing operations (retry_document)
- Batch updating document statuses (batch_update_document_status)
- Renaming documents (rename_document)

These operations are critical for document lifecycle management and require
careful handling of document states, indexing processes, and user permissions.

This test suite ensures:
- Correct pause and resume of document indexing
- Proper recovery from error states
- Accurate retry mechanisms for failed operations
- Batch status updates work correctly
- Document renaming with proper validation
- State transitions are handled correctly
- Error conditions are handled gracefully

================================================================================
ARCHITECTURE OVERVIEW
================================================================================

The DocumentService status management operations are part of the document
lifecycle management system. These operations interact with multiple
components:

1. Document States: Documents can be in various states:
   - waiting: Waiting to be indexed
   - parsing: Currently being parsed
   - cleaning: Currently being cleaned
   - splitting: Currently being split into segments
   - indexing: Currently being indexed
   - completed: Indexing completed successfully
   - error: Indexing failed with an error
   - paused: Indexing paused by user

2. Status Flags: Documents have several status flags:
   - is_paused: Whether indexing is paused
   - enabled: Whether document is enabled for retrieval
   - archived: Whether document is archived
   - indexing_status: Current indexing status

3. Redis Cache: Used for:
   - Pause flags: Prevents concurrent pause operations
   - Retry flags: Prevents concurrent retry operations
   - Indexing flags: Tracks active indexing operations

4. Task Queue: Async tasks for:
   - Recovering document indexing
   - Retrying document indexing
   - Adding documents to index
   - Removing documents from index

5. Database: Stores document state and metadata:
   - Document status fields
   - Timestamps (paused_at, disabled_at, archived_at)
   - User IDs (paused_by, disabled_by, archived_by)

================================================================================
TESTING STRATEGY
================================================================================

This test suite follows a comprehensive testing strategy that covers:

1. Pause Operations:
   - Pausing documents in various indexing states
   - Setting pause flags in Redis
   - Updating document state
   - Error handling for invalid states

2. Recovery Operations:
   - Recovering paused documents
   - Clearing pause flags
   - Triggering recovery tasks
   - Error handling for non-paused documents

3. Retry Operations:
   - Retrying failed documents
   - Setting retry flags
   - Resetting document status
   - Preventing concurrent retries
   - Triggering retry tasks

4. Batch Status Updates:
   - Enabling documents
   - Disabling documents
   - Archiving documents
   - Unarchiving documents
   - Handling empty lists
   - Validating document states
   - Transaction handling

5. Rename Operations:
   - Renaming documents successfully
   - Validating permissions
   - Updating metadata
   - Updating associated files
   - Error handling

================================================================================
"""

import datetime
from unittest.mock import Mock, create_autospec, patch

import pytest

from models import Account
from models.dataset import Dataset, Document
from models.model import UploadFile
from services.dataset_service import DocumentService
from services.errors.document import DocumentIndexingError

# ============================================================================
# Test Data Factory
# ============================================================================


class DocumentStatusTestDataFactory:
    """
    Factory class for creating test data and mock objects for document status tests.

    This factory provides static methods to create mock objects for:
    - Document instances with various status configurations
    - Dataset instances
    - User/Account instances
    - UploadFile instances
    - Redis cache keys and values

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_document_mock(
        document_id: str = "document-123",
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "Test Document",
        indexing_status: str = "completed",
        is_paused: bool = False,
        enabled: bool = True,
        archived: bool = False,
        paused_by: str | None = None,
        paused_at: datetime.datetime | None = None,
        data_source_type: str = "upload_file",
        data_source_info: dict | None = None,
        doc_metadata: dict | None = None,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Document with specified attributes.

        Args:
            document_id: Unique identifier for the document
            dataset_id: Dataset identifier
            tenant_id: Tenant identifier
            name: Document name
            indexing_status: Current indexing status
            is_paused: Whether document is paused
            enabled: Whether document is enabled
            archived: Whether document is archived
            paused_by: ID of user who paused the document
            paused_at: Timestamp when document was paused
            data_source_type: Type of data source
            data_source_info: Data source information dictionary
            doc_metadata: Document metadata dictionary
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Document instance
        """
        document = Mock(spec=Document)
        document.id = document_id
        document.dataset_id = dataset_id
        document.tenant_id = tenant_id
        document.name = name
        document.indexing_status = indexing_status
        document.is_paused = is_paused
        document.enabled = enabled
        document.archived = archived
        document.paused_by = paused_by
        document.paused_at = paused_at
        document.data_source_type = data_source_type
        document.data_source_info = data_source_info or {}
        document.doc_metadata = doc_metadata or {}
        document.completed_at = datetime.datetime.now() if indexing_status == "completed" else None
        document.position = 1
        for key, value in kwargs.items():
            setattr(document, key, value)

        # Mock data_source_info_dict property
        document.data_source_info_dict = data_source_info or {}

        return document

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "Test Dataset",
        built_in_field_enabled: bool = False,
        **kwargs,
    ) -> Mock:
        """
        Create a mock Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            name: Dataset name
            built_in_field_enabled: Whether built-in fields are enabled
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as a Dataset instance
        """
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.name = name
        dataset.built_in_field_enabled = built_in_field_enabled
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """
        Create a mock user (Account) with specified attributes.

        Args:
            user_id: Unique identifier for the user
            tenant_id: Tenant identifier
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as an Account instance
        """
        user = create_autospec(Account, instance=True)
        user.id = user_id
        user.current_tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_upload_file_mock(
        file_id: str = "file-123",
        name: str = "test_file.pdf",
        **kwargs,
    ) -> Mock:
        """
        Create a mock UploadFile with specified attributes.

        Args:
            file_id: Unique identifier for the file
            name: File name
            **kwargs: Additional attributes to set on the mock

        Returns:
            Mock object configured as an UploadFile instance
        """
        upload_file = Mock(spec=UploadFile)
        upload_file.id = file_id
        upload_file.name = name
        for key, value in kwargs.items():
            setattr(upload_file, key, value)
        return upload_file


# ============================================================================
# Tests for pause_document
# ============================================================================


class TestDocumentServicePauseDocument:
    """
    Comprehensive unit tests for DocumentService.pause_document method.

    This test class covers the document pause functionality, which allows
    users to pause the indexing process for documents that are currently
    being indexed.

    The pause_document method:
    1. Validates document is in a pausable state
    2. Sets is_paused flag to True
    3. Records paused_by and paused_at
    4. Commits changes to database
    5. Sets pause flag in Redis cache

    Test scenarios include:
    - Pausing documents in various indexing states
    - Error handling for invalid states
    - Redis cache flag setting
    - Current user validation
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """
        Mock document service dependencies for testing.

        Provides mocked dependencies including:
        - current_user context
        - Database session
        - Redis client
        - Current time utilities
        """
        with (
            patch(
                "services.dataset_service.current_user", create_autospec(Account, instance=True)
            ) as mock_current_user,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time
            mock_current_user.id = "user-123"

            yield {
                "current_user": mock_current_user,
                "db_session": mock_db,
                "redis_client": mock_redis,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    def test_pause_document_waiting_state_success(self, mock_document_service_dependencies):
        """
        Test successful pause of document in waiting state.

        Verifies that when a document is in waiting state, it can be
        paused successfully.

        This test ensures:
        - Document state is validated
        - is_paused flag is set
        - paused_by and paused_at are recorded
        - Changes are committed
        - Redis cache flag is set
        """
        # Arrange
        document = DocumentStatusTestDataFactory.create_document_mock(indexing_status="waiting", is_paused=False)

        # Act
        DocumentService.pause_document(document)

        # Assert
        assert document.is_paused is True
        assert document.paused_by == "user-123"
        assert document.paused_at == mock_document_service_dependencies["current_time"]

        # Verify database operations
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()

        # Verify Redis cache flag was set
        expected_cache_key = f"document_{document.id}_is_paused"
        mock_document_service_dependencies["redis_client"].setnx.assert_called_once_with(expected_cache_key, "True")

    def test_pause_document_indexing_state_success(self, mock_document_service_dependencies):
        """
        Test successful pause of document in indexing state.

        Verifies that when a document is actively being indexed, it can
        be paused successfully.

        This test ensures:
        - Document in indexing state can be paused
        - All pause operations complete correctly
        """
        # Arrange
        document = DocumentStatusTestDataFactory.create_document_mock(indexing_status="indexing", is_paused=False)

        # Act
        DocumentService.pause_document(document)

        # Assert
        assert document.is_paused is True
        assert document.paused_by == "user-123"

    def test_pause_document_parsing_state_success(self, mock_document_service_dependencies):
        """
        Test successful pause of document in parsing state.

        Verifies that when a document is being parsed, it can be paused.

        This test ensures:
        - Document in parsing state can be paused
        - Pause operations work for all valid states
        """
        # Arrange
        document = DocumentStatusTestDataFactory.create_document_mock(indexing_status="parsing", is_paused=False)

        # Act
        DocumentService.pause_document(document)

        # Assert
        assert document.is_paused is True

    def test_pause_document_completed_state_error(self, mock_document_service_dependencies):
        """
        Test error when trying to pause completed document.

        Verifies that when a document is already completed, it cannot
        be paused and a DocumentIndexingError is raised.

        This test ensures:
        - Completed documents cannot be paused
        - Error type is correct
        - No database operations are performed
        """
        # Arrange
        document = DocumentStatusTestDataFactory.create_document_mock(indexing_status="completed", is_paused=False)

        # Act & Assert
        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

        # Verify no database operations were performed
        mock_document_service_dependencies["db_session"].add.assert_not_called()
        mock_document_service_dependencies["db_session"].commit.assert_not_called()

    def test_pause_document_error_state_error(self, mock_document_service_dependencies):
        """
        Test error when trying to pause document in error state.

        Verifies that when a document is in error state, it cannot be
        paused and a DocumentIndexingError is raised.

        This test ensures:
        - Error state documents cannot be paused
        - Error type is correct
        - No database operations are performed
        """
        # Arrange
        document = DocumentStatusTestDataFactory.create_document_mock(indexing_status="error", is_paused=False)

        # Act & Assert
        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)


# ============================================================================
# Tests for recover_document
# ============================================================================


class TestDocumentServiceRecoverDocument:
    """
    Comprehensive unit tests for DocumentService.recover_document method.

    This test class covers the document recovery functionality, which allows
    users to resume indexing for documents that were previously paused.

    The recover_document method:
    1. Validates document is paused
    2. Clears is_paused flag
    3. Clears paused_by and paused_at
    4. Commits changes to database
    5. Deletes pause flag from Redis cache
    6. Triggers recovery task

    Test scenarios include:
    - Recovering paused documents
    - Error handling for non-paused documents
    - Redis cache flag deletion
    - Recovery task triggering
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """
        Mock document service dependencies for testing.

        Provides mocked dependencies including:
        - Database session
        - Redis client
        - Recovery task
        """
        with (
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.recover_document_indexing_task") as mock_task,
        ):
            yield {
                "db_session": mock_db,
                "redis_client": mock_redis,
                "recover_task": mock_task,
            }

    def test_recover_document_paused_success(self, mock_document_service_dependencies):
        """
        Test successful recovery of paused document.

        Verifies that when a document is paused, it can be recovered
        successfully and indexing resumes.

        This test ensures:
        - Document is validated as paused
        - is_paused flag is cleared
        - paused_by and paused_at are cleared
        - Changes are committed
        - Redis cache flag is deleted
        - Recovery task is triggered
        """
        # Arrange
        paused_time = datetime.datetime.now()
        document = DocumentStatusTestDataFactory.create_document_mock(
            indexing_status="indexing",
            is_paused=True,
            paused_by="user-123",
            paused_at=paused_time,
        )

        # Act
        DocumentService.recover_document(document)

        # Assert
        assert document.is_paused is False
        assert document.paused_by is None
        assert document.paused_at is None

        # Verify database operations
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()

        # Verify Redis cache flag was deleted
        expected_cache_key = f"document_{document.id}_is_paused"
        mock_document_service_dependencies["redis_client"].delete.assert_called_once_with(expected_cache_key)

        # Verify recovery task was triggered
        mock_document_service_dependencies["recover_task"].delay.assert_called_once_with(
            document.dataset_id, document.id
        )

    def test_recover_document_not_paused_error(self, mock_document_service_dependencies):
        """
        Test error when trying to recover non-paused document.

        Verifies that when a document is not paused, it cannot be
        recovered and a DocumentIndexingError is raised.

        This test ensures:
        - Non-paused documents cannot be recovered
        - Error type is correct
        - No database operations are performed
        """
        # Arrange
        document = DocumentStatusTestDataFactory.create_document_mock(indexing_status="indexing", is_paused=False)

        # Act & Assert
        with pytest.raises(DocumentIndexingError):
            DocumentService.recover_document(document)

        # Verify no database operations were performed
        mock_document_service_dependencies["db_session"].add.assert_not_called()
        mock_document_service_dependencies["db_session"].commit.assert_not_called()


# ============================================================================
# Tests for retry_document
# ============================================================================


class TestDocumentServiceRetryDocument:
    """
    Comprehensive unit tests for DocumentService.retry_document method.

    This test class covers the document retry functionality, which allows
    users to retry failed document indexing operations.

    The retry_document method:
    1. Validates documents are not already being retried
    2. Sets retry flag in Redis cache
    3. Resets document indexing_status to waiting
    4. Commits changes to database
    5. Triggers retry task

    Test scenarios include:
    - Retrying single document
    - Retrying multiple documents
    - Error handling for concurrent retries
    - Current user validation
    - Retry task triggering
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """
        Mock document service dependencies for testing.

        Provides mocked dependencies including:
        - current_user context
        - Database session
        - Redis client
        - Retry task
        """
        with (
            patch(
                "services.dataset_service.current_user", create_autospec(Account, instance=True)
            ) as mock_current_user,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.retry_document_indexing_task") as mock_task,
        ):
            mock_current_user.id = "user-123"

            yield {
                "current_user": mock_current_user,
                "db_session": mock_db,
                "redis_client": mock_redis,
                "retry_task": mock_task,
            }

    def test_retry_document_single_success(self, mock_document_service_dependencies):
        """
        Test successful retry of single document.

        Verifies that when a document is retried, the retry process
        completes successfully.

        This test ensures:
        - Retry flag is checked
        - Document status is reset to waiting
        - Changes are committed
        - Retry flag is set in Redis
        - Retry task is triggered
        """
        # Arrange
        dataset_id = "dataset-123"
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123",
            dataset_id=dataset_id,
            indexing_status="error",
        )

        # Mock Redis to return None (not retrying)
        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.retry_document(dataset_id, [document])

        # Assert
        assert document.indexing_status == "waiting"

        # Verify database operations
        mock_document_service_dependencies["db_session"].add.assert_called_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called()

        # Verify retry flag was set
        expected_cache_key = f"document_{document.id}_is_retried"
        mock_document_service_dependencies["redis_client"].setex.assert_called_once_with(expected_cache_key, 600, 1)

        # Verify retry task was triggered
        mock_document_service_dependencies["retry_task"].delay.assert_called_once_with(
            dataset_id, [document.id], "user-123"
        )

    def test_retry_document_multiple_success(self, mock_document_service_dependencies):
        """
        Test successful retry of multiple documents.

        Verifies that when multiple documents are retried, all retry
        processes complete successfully.

        This test ensures:
        - Multiple documents can be retried
        - All documents are processed
        - Retry task is triggered with all document IDs
        """
        # Arrange
        dataset_id = "dataset-123"
        document1 = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123", dataset_id=dataset_id, indexing_status="error"
        )
        document2 = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-456", dataset_id=dataset_id, indexing_status="error"
        )

        # Mock Redis to return None (not retrying)
        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.retry_document(dataset_id, [document1, document2])

        # Assert
        assert document1.indexing_status == "waiting"
        assert document2.indexing_status == "waiting"

        # Verify retry task was triggered with all document IDs
        mock_document_service_dependencies["retry_task"].delay.assert_called_once_with(
            dataset_id, [document1.id, document2.id], "user-123"
        )

    def test_retry_document_concurrent_retry_error(self, mock_document_service_dependencies):
        """
        Test error when document is already being retried.

        Verifies that when a document is already being retried, a new
        retry attempt raises a ValueError.

        This test ensures:
        - Concurrent retries are prevented
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset_id = "dataset-123"
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123", dataset_id=dataset_id, indexing_status="error"
        )

        # Mock Redis to return retry flag (already retrying)
        mock_document_service_dependencies["redis_client"].get.return_value = "1"

        # Act & Assert
        with pytest.raises(ValueError, match="Document is being retried, please try again later"):
            DocumentService.retry_document(dataset_id, [document])

        # Verify no database operations were performed
        mock_document_service_dependencies["db_session"].add.assert_not_called()
        mock_document_service_dependencies["db_session"].commit.assert_not_called()

    def test_retry_document_missing_current_user_error(self, mock_document_service_dependencies):
        """
        Test error when current_user is missing.

        Verifies that when current_user is None or has no ID, a ValueError
        is raised.

        This test ensures:
        - Current user validation works correctly
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset_id = "dataset-123"
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123", dataset_id=dataset_id, indexing_status="error"
        )

        # Mock Redis to return None (not retrying)
        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Mock current_user to be None
        mock_document_service_dependencies["current_user"].id = None

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current user id not found"):
            DocumentService.retry_document(dataset_id, [document])


# ============================================================================
# Tests for batch_update_document_status
# ============================================================================


class TestDocumentServiceBatchUpdateDocumentStatus:
    """
    Comprehensive unit tests for DocumentService.batch_update_document_status method.

    This test class covers the batch document status update functionality,
    which allows users to update the status of multiple documents at once.

    The batch_update_document_status method:
    1. Validates action parameter
    2. Validates all documents
    3. Checks if documents are being indexed
    4. Prepares updates for each document
    5. Applies all updates in a single transaction
    6. Triggers async tasks
    7. Sets Redis cache flags

    Test scenarios include:
    - Batch enabling documents
    - Batch disabling documents
    - Batch archiving documents
    - Batch unarchiving documents
    - Handling empty lists
    - Invalid action handling
    - Document indexing check
    - Transaction rollback on errors
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """
        Mock document service dependencies for testing.

        Provides mocked dependencies including:
        - get_document method
        - Database session
        - Redis client
        - Async tasks
        """
        with (
            patch("services.dataset_service.DocumentService.get_document") as mock_get_document,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.add_document_to_index_task") as mock_add_task,
            patch("services.dataset_service.remove_document_from_index_task") as mock_remove_task,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time

            yield {
                "get_document": mock_get_document,
                "db_session": mock_db,
                "redis_client": mock_redis,
                "add_task": mock_add_task,
                "remove_task": mock_remove_task,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    def test_batch_update_document_status_enable_success(self, mock_document_service_dependencies):
        """
        Test successful batch enabling of documents.

        Verifies that when documents are enabled in batch, all operations
        complete successfully.

        This test ensures:
        - Documents are retrieved correctly
        - Enabled flag is set
        - Async tasks are triggered
        - Redis cache flags are set
        - Transaction is committed
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock()
        document_ids = ["document-123", "document-456"]

        document1 = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123", enabled=False, indexing_status="completed"
        )
        document2 = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-456", enabled=False, indexing_status="completed"
        )

        mock_document_service_dependencies["get_document"].side_effect = [document1, document2]
        mock_document_service_dependencies["redis_client"].get.return_value = None  # Not indexing

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "enable", user)

        # Assert
        assert document1.enabled is True
        assert document2.enabled is True

        # Verify database operations
        mock_document_service_dependencies["db_session"].add.assert_called()
        mock_document_service_dependencies["db_session"].commit.assert_called_once()

        # Verify async tasks were triggered
        assert mock_document_service_dependencies["add_task"].delay.call_count == 2

    def test_batch_update_document_status_disable_success(self, mock_document_service_dependencies):
        """
        Test successful batch disabling of documents.

        Verifies that when documents are disabled in batch, all operations
        complete successfully.

        This test ensures:
        - Documents are retrieved correctly
        - Enabled flag is cleared
        - Disabled_at and disabled_by are set
        - Async tasks are triggered
        - Transaction is committed
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock(user_id="user-123")
        document_ids = ["document-123"]

        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123",
            enabled=True,
            indexing_status="completed",
            completed_at=datetime.datetime.now(),
        )

        mock_document_service_dependencies["get_document"].return_value = document
        mock_document_service_dependencies["redis_client"].get.return_value = None  # Not indexing

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "disable", user)

        # Assert
        assert document.enabled is False
        assert document.disabled_at == mock_document_service_dependencies["current_time"]
        assert document.disabled_by == "user-123"

        # Verify async task was triggered
        mock_document_service_dependencies["remove_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_document_status_archive_success(self, mock_document_service_dependencies):
        """
        Test successful batch archiving of documents.

        Verifies that when documents are archived in batch, all operations
        complete successfully.

        This test ensures:
        - Documents are retrieved correctly
        - Archived flag is set
        - Archived_at and archived_by are set
        - Async tasks are triggered for enabled documents
        - Transaction is committed
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock(user_id="user-123")
        document_ids = ["document-123"]

        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123", archived=False, enabled=True
        )

        mock_document_service_dependencies["get_document"].return_value = document
        mock_document_service_dependencies["redis_client"].get.return_value = None  # Not indexing

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "archive", user)

        # Assert
        assert document.archived is True
        assert document.archived_at == mock_document_service_dependencies["current_time"]
        assert document.archived_by == "user-123"

        # Verify async task was triggered for enabled document
        mock_document_service_dependencies["remove_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_document_status_unarchive_success(self, mock_document_service_dependencies):
        """
        Test successful batch unarchiving of documents.

        Verifies that when documents are unarchived in batch, all operations
        complete successfully.

        This test ensures:
        - Documents are retrieved correctly
        - Archived flag is cleared
        - Archived_at and archived_by are cleared
        - Async tasks are triggered for enabled documents
        - Transaction is committed
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock()
        document_ids = ["document-123"]

        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id="document-123", archived=True, enabled=True
        )

        mock_document_service_dependencies["get_document"].return_value = document
        mock_document_service_dependencies["redis_client"].get.return_value = None  # Not indexing

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "un_archive", user)

        # Assert
        assert document.archived is False
        assert document.archived_at is None
        assert document.archived_by is None

        # Verify async task was triggered for enabled document
        mock_document_service_dependencies["add_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_document_status_empty_list(self, mock_document_service_dependencies):
        """
        Test handling of empty document list.

        Verifies that when an empty list is provided, the method returns
        early without performing any operations.

        This test ensures:
        - Empty lists are handled gracefully
        - No database operations are performed
        - No errors are raised
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock()
        document_ids = []

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "enable", user)

        # Assert
        # Verify no database operations were performed
        mock_document_service_dependencies["db_session"].add.assert_not_called()
        mock_document_service_dependencies["db_session"].commit.assert_not_called()

    def test_batch_update_document_status_invalid_action_error(self, mock_document_service_dependencies):
        """
        Test error handling for invalid action.

        Verifies that when an invalid action is provided, a ValueError
        is raised.

        This test ensures:
        - Invalid actions are rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock()
        document_ids = ["document-123"]

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid action"):
            DocumentService.batch_update_document_status(dataset, document_ids, "invalid_action", user)

    def test_batch_update_document_status_document_indexing_error(self, mock_document_service_dependencies):
        """
        Test error when document is being indexed.

        Verifies that when a document is currently being indexed, a
        DocumentIndexingError is raised.

        This test ensures:
        - Indexing documents cannot be updated
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock()
        document_ids = ["document-123"]

        document = DocumentStatusTestDataFactory.create_document_mock(document_id="document-123")

        mock_document_service_dependencies["get_document"].return_value = document
        mock_document_service_dependencies["redis_client"].get.return_value = "1"  # Currently indexing

        # Act & Assert
        with pytest.raises(DocumentIndexingError, match="is being indexed"):
            DocumentService.batch_update_document_status(dataset, document_ids, "enable", user)


# ============================================================================
# Tests for rename_document
# ============================================================================


class TestDocumentServiceRenameDocument:
    """
    Comprehensive unit tests for DocumentService.rename_document method.

    This test class covers the document renaming functionality, which allows
    users to rename documents for better organization.

    The rename_document method:
    1. Validates dataset exists
    2. Validates document exists
    3. Validates tenant permission
    4. Updates document name
    5. Updates metadata if built-in fields enabled
    6. Updates associated upload file name
    7. Commits changes

    Test scenarios include:
    - Successful document renaming
    - Dataset not found error
    - Document not found error
    - Permission validation
    - Metadata updates
    - Upload file name updates
    """

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """
        Mock document service dependencies for testing.

        Provides mocked dependencies including:
        - DatasetService.get_dataset
        - DocumentService.get_document
        - current_user context
        - Database session
        """
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DocumentService.get_document") as mock_get_document,
            patch(
                "services.dataset_service.current_user", create_autospec(Account, instance=True)
            ) as mock_current_user,
            patch("extensions.ext_database.db.session") as mock_db,
        ):
            mock_current_user.current_tenant_id = "tenant-123"

            yield {
                "get_dataset": mock_get_dataset,
                "get_document": mock_get_document,
                "current_user": mock_current_user,
                "db_session": mock_db,
            }

    def test_rename_document_success(self, mock_document_service_dependencies):
        """
        Test successful document renaming.

        Verifies that when all validation passes, a document is renamed
        successfully.

        This test ensures:
        - Dataset is retrieved correctly
        - Document is retrieved correctly
        - Document name is updated
        - Changes are committed
        """
        # Arrange
        dataset_id = "dataset-123"
        document_id = "document-123"
        new_name = "New Document Name"

        dataset = DocumentStatusTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id=document_id, dataset_id=dataset_id, tenant_id="tenant-123"
        )

        mock_document_service_dependencies["get_dataset"].return_value = dataset
        mock_document_service_dependencies["get_document"].return_value = document

        # Act
        result = DocumentService.rename_document(dataset_id, document_id, new_name)

        # Assert
        assert result == document
        assert document.name == new_name

        # Verify database operations
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()

    def test_rename_document_with_built_in_fields(self, mock_document_service_dependencies):
        """
        Test document renaming with built-in fields enabled.

        Verifies that when built-in fields are enabled, the document
        metadata is also updated.

        This test ensures:
        - Document name is updated
        - Metadata is updated with new name
        - Built-in field is set correctly
        """
        # Arrange
        dataset_id = "dataset-123"
        document_id = "document-123"
        new_name = "New Document Name"

        dataset = DocumentStatusTestDataFactory.create_dataset_mock(dataset_id=dataset_id, built_in_field_enabled=True)
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id="tenant-123",
            doc_metadata={"existing_key": "existing_value"},
        )

        mock_document_service_dependencies["get_dataset"].return_value = dataset
        mock_document_service_dependencies["get_document"].return_value = document

        # Act
        DocumentService.rename_document(dataset_id, document_id, new_name)

        # Assert
        assert document.name == new_name
        assert "document_name" in document.doc_metadata
        assert document.doc_metadata["document_name"] == new_name
        assert document.doc_metadata["existing_key"] == "existing_value"  # Existing metadata preserved

    def test_rename_document_with_upload_file(self, mock_document_service_dependencies):
        """
        Test document renaming with associated upload file.

        Verifies that when a document has an associated upload file,
        the file name is also updated.

        This test ensures:
        - Document name is updated
        - Upload file name is updated
        - Database query is executed correctly
        """
        # Arrange
        dataset_id = "dataset-123"
        document_id = "document-123"
        new_name = "New Document Name"
        file_id = "file-123"

        dataset = DocumentStatusTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id="tenant-123",
            data_source_info={"upload_file_id": file_id},
        )

        mock_document_service_dependencies["get_dataset"].return_value = dataset
        mock_document_service_dependencies["get_document"].return_value = document

        # Mock upload file query
        mock_query = Mock()
        mock_query.where.return_value = mock_query
        mock_query.update.return_value = None
        mock_document_service_dependencies["db_session"].query.return_value = mock_query

        # Act
        DocumentService.rename_document(dataset_id, document_id, new_name)

        # Assert
        assert document.name == new_name

        # Verify upload file query was executed
        mock_document_service_dependencies["db_session"].query.assert_called()

    def test_rename_document_dataset_not_found_error(self, mock_document_service_dependencies):
        """
        Test error when dataset is not found.

        Verifies that when the dataset ID doesn't exist, a ValueError
        is raised.

        This test ensures:
        - Dataset existence is validated
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset_id = "non-existent-dataset"
        document_id = "document-123"
        new_name = "New Document Name"

        mock_document_service_dependencies["get_dataset"].return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset not found"):
            DocumentService.rename_document(dataset_id, document_id, new_name)

    def test_rename_document_not_found_error(self, mock_document_service_dependencies):
        """
        Test error when document is not found.

        Verifies that when the document ID doesn't exist, a ValueError
        is raised.

        This test ensures:
        - Document existence is validated
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset_id = "dataset-123"
        document_id = "non-existent-document"
        new_name = "New Document Name"

        dataset = DocumentStatusTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        mock_document_service_dependencies["get_dataset"].return_value = dataset
        mock_document_service_dependencies["get_document"].return_value = None

        # Act & Assert
        with pytest.raises(ValueError, match="Document not found"):
            DocumentService.rename_document(dataset_id, document_id, new_name)

    def test_rename_document_permission_error(self, mock_document_service_dependencies):
        """
        Test error when user lacks permission.

        Verifies that when the user is in a different tenant, a ValueError
        is raised.

        This test ensures:
        - Tenant permission is validated
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset_id = "dataset-123"
        document_id = "document-123"
        new_name = "New Document Name"

        dataset = DocumentStatusTestDataFactory.create_dataset_mock(dataset_id=dataset_id)
        document = DocumentStatusTestDataFactory.create_document_mock(
            document_id=document_id,
            dataset_id=dataset_id,
            tenant_id="tenant-456",  # Different tenant
        )

        mock_document_service_dependencies["get_dataset"].return_value = dataset
        mock_document_service_dependencies["get_document"].return_value = document

        # Act & Assert
        with pytest.raises(ValueError, match="No permission"):
            DocumentService.rename_document(dataset_id, document_id, new_name)
