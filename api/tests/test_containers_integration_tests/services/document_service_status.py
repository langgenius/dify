"""
Comprehensive integration tests for DocumentService status management methods.

This module contains extensive integration tests for the DocumentService class,
specifically focusing on document status management operations including
pause, recover, retry, batch updates, and renaming.
"""

import datetime
import json
from unittest.mock import create_autospec, patch
from uuid import uuid4

import pytest

from models import Account
from models.dataset import Dataset, Document
from models.enums import CreatorUserRole
from models.model import UploadFile
from services.dataset_service import DocumentService
from services.errors.document import DocumentIndexingError

FIXED_TIME = datetime.datetime(2023, 1, 1, 12, 0, 0)


class DocumentStatusTestDataFactory:
    """
    Factory class for creating real test data and helper doubles for document status tests.

    This factory provides static methods to create persisted entities for SQL
    assertions and lightweight doubles for collaborator patches.

    The factory methods help maintain consistency across tests and reduce
    code duplication when setting up test scenarios.
    """

    @staticmethod
    def create_document(
        db_session_with_containers,
        document_id: str | None = None,
        dataset_id: str | None = None,
        tenant_id: str | None = None,
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
    ) -> Document:
        """
        Create a persisted Document with specified attributes.

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
            **kwargs: Additional attributes to set on the entity

        Returns:
            Persisted Document instance
        """
        tenant_id = tenant_id or str(uuid4())
        dataset_id = dataset_id or str(uuid4())
        document_id = document_id or str(uuid4())
        created_by = kwargs.pop("created_by", str(uuid4()))
        position = kwargs.pop("position", 1)

        document = Document(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            position=position,
            data_source_type=data_source_type,
            data_source_info=json.dumps(data_source_info or {}),
            batch=f"batch-{uuid4()}",
            name=name,
            created_from="web",
            created_by=created_by,
            doc_form="text_model",
        )
        document.id = document_id
        document.indexing_status = indexing_status
        document.is_paused = is_paused
        document.enabled = enabled
        document.archived = archived
        document.paused_by = paused_by
        document.paused_at = paused_at
        document.doc_metadata = doc_metadata or {}
        if indexing_status == "completed" and "completed_at" not in kwargs:
            document.completed_at = FIXED_TIME

        for key, value in kwargs.items():
            setattr(document, key, value)

        db_session_with_containers.add(document)
        db_session_with_containers.commit()
        return document

    @staticmethod
    def create_dataset(
        db_session_with_containers,
        dataset_id: str | None = None,
        tenant_id: str | None = None,
        name: str = "Test Dataset",
        built_in_field_enabled: bool = False,
        **kwargs,
    ) -> Dataset:
        """
        Create a persisted Dataset with specified attributes.

        Args:
            dataset_id: Unique identifier for the dataset
            tenant_id: Tenant identifier
            name: Dataset name
            built_in_field_enabled: Whether built-in fields are enabled
            **kwargs: Additional attributes to set on the entity

        Returns:
            Persisted Dataset instance
        """
        tenant_id = tenant_id or str(uuid4())
        dataset_id = dataset_id or str(uuid4())
        created_by = kwargs.pop("created_by", str(uuid4()))

        dataset = Dataset(
            tenant_id=tenant_id,
            name=name,
            data_source_type="upload_file",
            created_by=created_by,
        )
        dataset.id = dataset_id
        dataset.built_in_field_enabled = built_in_field_enabled

        for key, value in kwargs.items():
            setattr(dataset, key, value)

        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str | None = None,
        tenant_id: str | None = None,
        **kwargs,
    ) -> Account:
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
        user.id = user_id or str(uuid4())
        user.current_tenant_id = tenant_id or str(uuid4())
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user

    @staticmethod
    def create_upload_file(
        db_session_with_containers,
        tenant_id: str,
        created_by: str,
        file_id: str | None = None,
        name: str = "test_file.pdf",
        **kwargs,
    ) -> UploadFile:
        """
        Create a persisted UploadFile with specified attributes.

        Args:
            file_id: Unique identifier for the file
            name: File name
            **kwargs: Additional attributes to set on the entity

        Returns:
            Persisted UploadFile instance
        """
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type="local",
            key=f"uploads/{uuid4()}",
            name=name,
            size=128,
            extension="pdf",
            mime_type="application/pdf",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=created_by,
            created_at=FIXED_TIME,
            used=False,
        )
        upload_file.id = file_id or str(uuid4())
        for key, value in kwargs.items():
            setattr(upload_file, key, value)

        db_session_with_containers.add(upload_file)
        db_session_with_containers.commit()
        return upload_file


class TestDocumentServicePauseDocument:
    """
    Comprehensive integration tests for DocumentService.pause_document method.

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
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            user_id = str(uuid4())
            mock_naive_utc_now.return_value = current_time
            mock_current_user.id = user_id

            yield {
                "current_user": mock_current_user,
                "redis_client": mock_redis,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
                "user_id": user_id,
            }

    def test_pause_document_waiting_state_success(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="waiting",
            is_paused=False,
        )

        # Act
        DocumentService.pause_document(document)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.is_paused is True
        assert document.paused_by == mock_document_service_dependencies["user_id"]
        assert document.paused_at == mock_document_service_dependencies["current_time"]

        expected_cache_key = f"document_{document.id}_is_paused"
        mock_document_service_dependencies["redis_client"].setnx.assert_called_once_with(expected_cache_key, "True")

    def test_pause_document_indexing_state_success(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
        """
        Test successful pause of document in indexing state.

        Verifies that when a document is actively being indexed, it can
        be paused successfully.

        This test ensures:
        - Document in indexing state can be paused
        - All pause operations complete correctly
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="indexing",
            is_paused=False,
        )

        # Act
        DocumentService.pause_document(document)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.is_paused is True
        assert document.paused_by == mock_document_service_dependencies["user_id"]

    def test_pause_document_parsing_state_success(self, db_session_with_containers, mock_document_service_dependencies):
        """
        Test successful pause of document in parsing state.

        Verifies that when a document is being parsed, it can be paused.

        This test ensures:
        - Document in parsing state can be paused
        - Pause operations work for all valid states
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="parsing",
            is_paused=False,
        )

        # Act
        DocumentService.pause_document(document)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.is_paused is True

    def test_pause_document_completed_state_error(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="completed",
            is_paused=False,
        )

        # Act & Assert
        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

        db_session_with_containers.refresh(document)
        assert document.is_paused is False

    def test_pause_document_error_state_error(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="error",
            is_paused=False,
        )

        # Act & Assert
        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

        db_session_with_containers.refresh(document)
        assert document.is_paused is False


class TestDocumentServiceRecoverDocument:
    """
    Comprehensive integration tests for DocumentService.recover_document method.

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
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.recover_document_indexing_task") as mock_task,
        ):
            yield {
                "redis_client": mock_redis,
                "recover_task": mock_task,
            }

    def test_recover_document_paused_success(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        paused_time = FIXED_TIME
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="indexing",
            is_paused=True,
            paused_by=str(uuid4()),
            paused_at=paused_time,
        )

        # Act
        DocumentService.recover_document(document)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.is_paused is False
        assert document.paused_by is None
        assert document.paused_at is None

        expected_cache_key = f"document_{document.id}_is_paused"
        mock_document_service_dependencies["redis_client"].delete.assert_called_once_with(expected_cache_key)
        mock_document_service_dependencies["recover_task"].delay.assert_called_once_with(
            document.dataset_id, document.id
        )

    def test_recover_document_not_paused_error(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            indexing_status="indexing",
            is_paused=False,
        )

        # Act & Assert
        with pytest.raises(DocumentIndexingError):
            DocumentService.recover_document(document)

        db_session_with_containers.refresh(document)
        assert document.is_paused is False


class TestDocumentServiceRetryDocument:
    """
    Comprehensive integration tests for DocumentService.retry_document method.

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
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.retry_document_indexing_task") as mock_task,
        ):
            user_id = str(uuid4())
            mock_current_user.id = user_id

            yield {
                "current_user": mock_current_user,
                "redis_client": mock_redis,
                "retry_task": mock_task,
                "user_id": user_id,
            }

    def test_retry_document_single_success(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            indexing_status="error",
        )

        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.retry_document(dataset.id, [document])

        # Assert
        db_session_with_containers.refresh(document)
        assert document.indexing_status == "waiting"

        expected_cache_key = f"document_{document.id}_is_retried"
        mock_document_service_dependencies["redis_client"].setex.assert_called_once_with(expected_cache_key, 600, 1)
        mock_document_service_dependencies["retry_task"].delay.assert_called_once_with(
            dataset.id, [document.id], mock_document_service_dependencies["user_id"]
        )

    def test_retry_document_multiple_success(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document1 = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            indexing_status="error",
        )
        document2 = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            indexing_status="error",
            position=2,
        )

        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.retry_document(dataset.id, [document1, document2])

        # Assert
        db_session_with_containers.refresh(document1)
        db_session_with_containers.refresh(document2)
        assert document1.indexing_status == "waiting"
        assert document2.indexing_status == "waiting"

        mock_document_service_dependencies["retry_task"].delay.assert_called_once_with(
            dataset.id, [document1.id, document2.id], mock_document_service_dependencies["user_id"]
        )

    def test_retry_document_concurrent_retry_error(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            indexing_status="error",
        )

        mock_document_service_dependencies["redis_client"].get.return_value = "1"

        # Act & Assert
        with pytest.raises(ValueError, match="Document is being retried, please try again later"):
            DocumentService.retry_document(dataset.id, [document])

        db_session_with_containers.refresh(document)
        assert document.indexing_status == "error"

    def test_retry_document_missing_current_user_error(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            indexing_status="error",
        )

        mock_document_service_dependencies["redis_client"].get.return_value = None
        mock_document_service_dependencies["current_user"].id = None

        # Act & Assert
        with pytest.raises(ValueError, match="Current user or current user id not found"):
            DocumentService.retry_document(dataset.id, [document])


class TestDocumentServiceBatchUpdateDocumentStatus:
    """
    Comprehensive integration tests for DocumentService.batch_update_document_status method.

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
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.add_document_to_index_task") as mock_add_task,
            patch("services.dataset_service.remove_document_from_index_task") as mock_remove_task,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time

            yield {
                "redis_client": mock_redis,
                "add_task": mock_add_task,
                "remove_task": mock_remove_task,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    def test_batch_update_document_status_enable_success(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        user = DocumentStatusTestDataFactory.create_user_mock(tenant_id=dataset.tenant_id)
        document1 = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            enabled=False,
            indexing_status="completed",
        )
        document2 = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            enabled=False,
            indexing_status="completed",
            position=2,
        )
        document_ids = [document1.id, document2.id]

        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "enable", user)

        # Assert
        db_session_with_containers.refresh(document1)
        db_session_with_containers.refresh(document2)
        assert document1.enabled is True
        assert document2.enabled is True
        assert mock_document_service_dependencies["add_task"].delay.call_count == 2

    def test_batch_update_document_status_disable_success(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        user = DocumentStatusTestDataFactory.create_user_mock(tenant_id=dataset.tenant_id)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            enabled=True,
            indexing_status="completed",
            completed_at=FIXED_TIME,
        )
        document_ids = [document.id]

        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "disable", user)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.enabled is False
        assert document.disabled_at == mock_document_service_dependencies["current_time"]
        assert document.disabled_by == user.id
        mock_document_service_dependencies["remove_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_document_status_archive_success(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        user = DocumentStatusTestDataFactory.create_user_mock(tenant_id=dataset.tenant_id)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            archived=False,
            enabled=True,
            indexing_status="completed",
        )
        document_ids = [document.id]

        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "archive", user)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.archived is True
        assert document.archived_at == mock_document_service_dependencies["current_time"]
        assert document.archived_by == user.id
        mock_document_service_dependencies["remove_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_document_status_unarchive_success(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        user = DocumentStatusTestDataFactory.create_user_mock(tenant_id=dataset.tenant_id)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            archived=True,
            enabled=True,
            indexing_status="completed",
        )
        document_ids = [document.id]

        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "un_archive", user)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.archived is False
        assert document.archived_at is None
        assert document.archived_by is None
        mock_document_service_dependencies["add_task"].delay.assert_called_once_with(document.id)

    def test_batch_update_document_status_empty_list(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        user = DocumentStatusTestDataFactory.create_user_mock(tenant_id=dataset.tenant_id)
        document_ids = []

        # Act
        DocumentService.batch_update_document_status(dataset, document_ids, "enable", user)

        # Assert
        mock_document_service_dependencies["add_task"].delay.assert_not_called()
        mock_document_service_dependencies["remove_task"].delay.assert_not_called()

    def test_batch_update_document_status_document_indexing_error(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset = DocumentStatusTestDataFactory.create_dataset(db_session_with_containers)
        user = DocumentStatusTestDataFactory.create_user_mock(tenant_id=dataset.tenant_id)
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            dataset_id=dataset.id,
            tenant_id=dataset.tenant_id,
            document_id=str(uuid4()),
            indexing_status="completed",
        )
        document_ids = [document.id]

        mock_document_service_dependencies["redis_client"].get.return_value = "1"

        # Act & Assert
        with pytest.raises(DocumentIndexingError, match="is being indexed"):
            DocumentService.batch_update_document_status(dataset, document_ids, "enable", user)


class TestDocumentServiceRenameDocument:
    """
    Comprehensive integration tests for DocumentService.rename_document method.

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
        with patch(
            "services.dataset_service.current_user", create_autospec(Account, instance=True)
        ) as mock_current_user:
            mock_current_user.current_tenant_id = str(uuid4())

            yield {
                "current_user": mock_current_user,
            }

    def test_rename_document_success(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        new_name = "New Document Name"
        tenant_id = mock_document_service_dependencies["current_user"].current_tenant_id

        dataset = DocumentStatusTestDataFactory.create_dataset(
            db_session_with_containers, dataset_id=dataset_id, tenant_id=tenant_id
        )
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            document_id=document_id,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            indexing_status="completed",
        )

        # Act
        result = DocumentService.rename_document(dataset.id, document.id, new_name)

        # Assert
        db_session_with_containers.refresh(document)
        assert result == document
        assert document.name == new_name

    def test_rename_document_with_built_in_fields(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        new_name = "New Document Name"
        tenant_id = mock_document_service_dependencies["current_user"].current_tenant_id

        dataset = DocumentStatusTestDataFactory.create_dataset(
            db_session_with_containers,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            built_in_field_enabled=True,
        )
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            document_id=document_id,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            doc_metadata={"existing_key": "existing_value"},
            indexing_status="completed",
        )

        # Act
        DocumentService.rename_document(dataset.id, document.id, new_name)

        # Assert
        db_session_with_containers.refresh(document)
        assert document.name == new_name
        assert "document_name" in document.doc_metadata
        assert document.doc_metadata["document_name"] == new_name
        assert document.doc_metadata["existing_key"] == "existing_value"

    def test_rename_document_with_upload_file(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        new_name = "New Document Name"
        file_id = str(uuid4())
        tenant_id = mock_document_service_dependencies["current_user"].current_tenant_id

        dataset = DocumentStatusTestDataFactory.create_dataset(
            db_session_with_containers, dataset_id=dataset_id, tenant_id=tenant_id
        )
        upload_file = DocumentStatusTestDataFactory.create_upload_file(
            db_session_with_containers,
            tenant_id=tenant_id,
            created_by=str(uuid4()),
            file_id=file_id,
            name="old_name.pdf",
        )
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            document_id=document_id,
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            data_source_info={"upload_file_id": upload_file.id},
            indexing_status="completed",
        )

        # Act
        DocumentService.rename_document(dataset.id, document.id, new_name)

        # Assert
        db_session_with_containers.refresh(document)
        db_session_with_containers.refresh(upload_file)
        assert document.name == new_name
        assert upload_file.name == new_name

    def test_rename_document_dataset_not_found_error(
        self, db_session_with_containers, mock_document_service_dependencies
    ):
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
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        new_name = "New Document Name"

        # Act & Assert
        with pytest.raises(ValueError, match="Dataset not found"):
            DocumentService.rename_document(dataset_id, document_id, new_name)

    def test_rename_document_not_found_error(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        new_name = "New Document Name"

        dataset = DocumentStatusTestDataFactory.create_dataset(
            db_session_with_containers,
            dataset_id=dataset_id,
            tenant_id=mock_document_service_dependencies["current_user"].current_tenant_id,
        )

        # Act & Assert
        with pytest.raises(ValueError, match="Document not found"):
            DocumentService.rename_document(dataset.id, document_id, new_name)

    def test_rename_document_permission_error(self, db_session_with_containers, mock_document_service_dependencies):
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
        dataset_id = str(uuid4())
        document_id = str(uuid4())
        new_name = "New Document Name"
        current_tenant_id = mock_document_service_dependencies["current_user"].current_tenant_id

        dataset = DocumentStatusTestDataFactory.create_dataset(
            db_session_with_containers,
            dataset_id=dataset_id,
            tenant_id=current_tenant_id,
        )
        document = DocumentStatusTestDataFactory.create_document(
            db_session_with_containers,
            document_id=document_id,
            dataset_id=dataset.id,
            tenant_id=str(uuid4()),
            indexing_status="completed",
        )

        # Act & Assert
        with pytest.raises(ValueError, match="No permission"):
            DocumentService.rename_document(dataset.id, document.id, new_name)
