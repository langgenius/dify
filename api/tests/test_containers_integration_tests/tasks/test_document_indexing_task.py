from dataclasses import asdict
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.entities.document_task import DocumentTask
from enums.cloud_plan import CloudPlan
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document
from tasks.document_indexing_task import (
    _document_indexing,  # Core function
    _document_indexing_with_tenant_queue,  # Tenant queue wrapper function
    document_indexing_task,  # Deprecated old interface
    normal_document_indexing_task,  # New normal task
    priority_document_indexing_task,  # New priority task
)


class TestDocumentIndexingTasks:
    """Integration tests for document indexing tasks using testcontainers.

    This test class covers:
    - Core _document_indexing function
    - Deprecated document_indexing_task function
    - New normal_document_indexing_task function
    - New priority_document_indexing_task function
    - Tenant queue wrapper _document_indexing_with_tenant_queue function
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.document_indexing_task.IndexingRunner") as mock_indexing_runner,
            patch("tasks.document_indexing_task.FeatureService") as mock_feature_service,
        ):
            # Setup mock indexing runner
            mock_runner_instance = MagicMock()
            mock_indexing_runner.return_value = mock_runner_instance

            # Setup mock feature service
            mock_features = MagicMock()
            mock_features.billing.enabled = False
            mock_feature_service.get_features.return_value = mock_features

            yield {
                "indexing_runner": mock_indexing_runner,
                "indexing_runner_instance": mock_runner_instance,
                "feature_service": mock_feature_service,
                "features": mock_features,
            }

    def _create_test_dataset_and_documents(
        self, db_session_with_containers, mock_external_service_dependencies, document_count=3
    ):
        """
        Helper method to create a test dataset and documents for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            document_count: Number of documents to create

        Returns:
            tuple: (dataset, documents) - Created dataset and document instances
        """
        fake = Faker()

        # Create account and tenant
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        # Create dataset
        dataset = Dataset(
            id=fake.uuid4(),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Create documents
        documents = []
        for i in range(document_count):
            document = Document(
                id=fake.uuid4(),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="upload_file",
                batch="test_batch",
                name=fake.file_name(),
                created_from="upload_file",
                created_by=account.id,
                indexing_status="waiting",
                enabled=True,
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()

        # Refresh dataset to ensure it's properly loaded
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def _create_test_dataset_with_billing_features(
        self, db_session_with_containers, mock_external_service_dependencies, billing_enabled=True
    ):
        """
        Helper method to create a test dataset with billing features configured.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            billing_enabled: Whether billing is enabled

        Returns:
            tuple: (dataset, documents) - Created dataset and document instances
        """
        fake = Faker()

        # Create account and tenant
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )
        db_session_with_containers.add(account)
        db_session_with_containers.commit()

        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db_session_with_containers.add(tenant)
        db_session_with_containers.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db_session_with_containers.add(join)
        db_session_with_containers.commit()

        # Create dataset
        dataset = Dataset(
            id=fake.uuid4(),
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=account.id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Create documents
        documents = []
        for i in range(3):
            document = Document(
                id=fake.uuid4(),
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=i,
                data_source_type="upload_file",
                batch="test_batch",
                name=fake.file_name(),
                created_from="upload_file",
                created_by=account.id,
                indexing_status="waiting",
                enabled=True,
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()

        # Configure billing features
        mock_external_service_dependencies["features"].billing.enabled = billing_enabled
        if billing_enabled:
            mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.SANDBOX
            mock_external_service_dependencies["features"].vector_space.limit = 100
            mock_external_service_dependencies["features"].vector_space.size = 50

        # Refresh dataset to ensure it's properly loaded
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def test_document_indexing_task_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful document indexing with multiple documents.

        This test verifies:
        - Proper dataset retrieval from database
        - Correct document processing and status updates
        - IndexingRunner integration
        - Database state updates
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        _document_indexing(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify the expected outcomes
        # Verify indexing runner was called correctly
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were updated to parsing status
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with correct documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 3

    def test_document_indexing_task_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of non-existent dataset.

        This test verifies:
        - Proper error handling for missing datasets
        - Early return without processing
        - Database session cleanup
        - No unnecessary indexing runner calls
        """
        # Arrange: Use non-existent dataset ID
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        document_ids = [fake.uuid4() for _ in range(3)]

        # Act: Execute the task with non-existent dataset
        _document_indexing(non_existent_dataset_id, document_ids)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_not_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_document_indexing_task_document_not_found_in_dataset(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when some documents don't exist in the dataset.

        This test verifies:
        - Only existing documents are processed
        - Non-existent documents are ignored
        - Indexing runner receives only valid documents
        - Database state updates correctly
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Mix existing and non-existent document IDs
        fake = Faker()
        existing_document_ids = [doc.id for doc in documents]
        non_existent_document_ids = [fake.uuid4() for _ in range(2)]
        all_document_ids = existing_document_ids + non_existent_document_ids

        # Act: Execute the task with mixed document IDs
        _document_indexing(dataset.id, all_document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify only existing documents were processed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify only existing documents were updated
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in existing_document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with only existing documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 2  # Only existing documents

    def test_document_indexing_task_indexing_runner_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of IndexingRunner exceptions.

        This test verifies:
        - Exceptions from IndexingRunner are properly caught
        - Task completes without raising exceptions
        - Database session is properly closed
        - Error logging occurs
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock IndexingRunner to raise an exception
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception(
            "Indexing runner failed"
        )

        # Act: Execute the task
        _document_indexing(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify exception was handled gracefully
        # The task should complete without raising exceptions
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were still updated to parsing status before the exception
        # Re-query documents from database since _document_indexing close the session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

    def test_document_indexing_task_mixed_document_states(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test processing documents with mixed initial states.

        This test verifies:
        - Documents with different initial states are handled correctly
        - Only valid documents are processed
        - Database state updates are consistent
        - IndexingRunner receives correct documents
        """
        # Arrange: Create test data
        dataset, base_documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        # Create additional documents with different states
        fake = Faker()
        extra_documents = []

        # Document with different indexing status
        doc1 = Document(
            id=fake.uuid4(),
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=2,
            data_source_type="upload_file",
            batch="test_batch",
            name=fake.file_name(),
            created_from="upload_file",
            created_by=dataset.created_by,
            indexing_status="completed",  # Already completed
            enabled=True,
        )
        db_session_with_containers.add(doc1)
        extra_documents.append(doc1)

        # Document with disabled status
        doc2 = Document(
            id=fake.uuid4(),
            tenant_id=dataset.tenant_id,
            dataset_id=dataset.id,
            position=3,
            data_source_type="upload_file",
            batch="test_batch",
            name=fake.file_name(),
            created_from="upload_file",
            created_by=dataset.created_by,
            indexing_status="waiting",
            enabled=False,  # Disabled
        )
        db_session_with_containers.add(doc2)
        extra_documents.append(doc2)

        db_session_with_containers.commit()

        all_documents = base_documents + extra_documents
        document_ids = [doc.id for doc in all_documents]

        # Act: Execute the task with mixed document states
        _document_indexing(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify processing
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify all documents were updated to parsing status
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with all documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 4

    def test_document_indexing_task_billing_sandbox_plan_batch_limit(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test billing validation for sandbox plan batch upload limit.

        This test verifies:
        - Sandbox plan batch upload limit enforcement
        - Error handling for batch upload limit exceeded
        - Document status updates to error state
        - Proper error message recording
        """
        # Arrange: Create test data with billing enabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers, mock_external_service_dependencies, billing_enabled=True
        )

        # Configure sandbox plan with batch limit
        mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.SANDBOX

        # Create more documents than sandbox plan allows (limit is 1)
        fake = Faker()
        extra_documents = []
        for i in range(2):  # Total will be 5 documents (3 existing + 2 new)
            document = Document(
                id=fake.uuid4(),
                tenant_id=dataset.tenant_id,
                dataset_id=dataset.id,
                position=i + 3,
                data_source_type="upload_file",
                batch="test_batch",
                name=fake.file_name(),
                created_from="upload_file",
                created_by=dataset.created_by,
                indexing_status="waiting",
                enabled=True,
            )
            db_session_with_containers.add(document)
            extra_documents.append(document)

        db_session_with_containers.commit()
        all_documents = documents + extra_documents
        document_ids = [doc.id for doc in all_documents]

        # Act: Execute the task with too many documents for sandbox plan
        _document_indexing(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify error handling
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "error"
            assert updated_document.error is not None
            assert "batch upload" in updated_document.error
            assert updated_document.stopped_at is not None

        # Verify no indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_task_billing_disabled_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful processing when billing is disabled.

        This test verifies:
        - Processing continues normally when billing is disabled
        - No billing validation occurs
        - Documents are processed successfully
        - IndexingRunner is called correctly
        """
        # Arrange: Create test data with billing disabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers, mock_external_service_dependencies, billing_enabled=False
        )

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task with billing disabled
        _document_indexing(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify successful processing
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were updated to parsing status
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

    def test_document_indexing_task_document_is_paused_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of DocumentIsPausedError from IndexingRunner.

        This test verifies:
        - DocumentIsPausedError is properly caught and handled
        - Task completes without raising exceptions
        - Appropriate logging occurs
        - Database session is properly closed
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock IndexingRunner to raise DocumentIsPausedError
        from core.indexing_runner import DocumentIsPausedError

        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = DocumentIsPausedError(
            "Document indexing is paused"
        )

        # Act: Execute the task
        _document_indexing(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify exception was handled gracefully
        # The task should complete without raising exceptions
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were still updated to parsing status before the exception
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

    # ==================== NEW TESTS FOR REFACTORED FUNCTIONS ====================
    def test_old_document_indexing_task_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test document_indexing_task basic functionality.

        This test verifies:
        - Task function calls the wrapper correctly
        - Basic parameter passing works
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the deprecated task (it only takes 2 parameters)
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify processing occurred (core logic is tested in _document_indexing tests)
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

    def test_normal_document_indexing_task_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test normal_document_indexing_task basic functionality.

        This test verifies:
        - Task function calls the wrapper correctly
        - Basic parameter passing works
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )
        document_ids = [doc.id for doc in documents]
        tenant_id = dataset.tenant_id

        # Act: Execute the new normal task
        normal_document_indexing_task(tenant_id, dataset.id, document_ids)

        # Assert: Verify processing occurred (core logic is tested in _document_indexing tests)
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

    def test_priority_document_indexing_task_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test priority_document_indexing_task basic functionality.

        This test verifies:
        - Task function calls the wrapper correctly
        - Basic parameter passing works
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )
        document_ids = [doc.id for doc in documents]
        tenant_id = dataset.tenant_id

        # Act: Execute the new priority task
        priority_document_indexing_task(tenant_id, dataset.id, document_ids)

        # Assert: Verify processing occurred (core logic is tested in _document_indexing tests)
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

    def test_document_indexing_with_tenant_queue_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test _document_indexing_with_tenant_queue function with no waiting tasks.

        This test verifies:
        - Core indexing logic execution (same as _document_indexing)
        - Tenant queue cleanup when no waiting tasks
        - Task function parameter passing
        - Queue management after processing
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]
        tenant_id = dataset.tenant_id

        # Mock the task function
        from unittest.mock import MagicMock

        mock_task_func = MagicMock()

        # Act: Execute the wrapper function
        _document_indexing_with_tenant_queue(tenant_id, dataset.id, document_ids, mock_task_func)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify core processing occurred (same as _document_indexing)
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were updated (same as _document_indexing)
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with correct documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]
        assert len(processed_documents) == 2

        # Verify task function was not called (no waiting tasks)
        mock_task_func.delay.assert_not_called()

    def test_document_indexing_with_tenant_queue_with_waiting_tasks(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test _document_indexing_with_tenant_queue function with waiting tasks in queue using real Redis.

        This test verifies:
        - Core indexing logic execution
        - Real Redis-based tenant queue processing of waiting tasks
        - Task function calls for waiting tasks
        - Queue management with multiple tasks using actual Redis operations
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )
        document_ids = [doc.id for doc in documents]
        tenant_id = dataset.tenant_id
        dataset_id = dataset.id

        # Mock the task function
        from unittest.mock import MagicMock

        mock_task_func = MagicMock()

        # Use real Redis for TenantIsolatedTaskQueue
        from core.rag.pipeline.queue import TenantIsolatedTaskQueue

        # Create real queue instance
        queue = TenantIsolatedTaskQueue(tenant_id, "document_indexing")

        # Add waiting tasks to the real Redis queue
        waiting_tasks = [
            DocumentTask(tenant_id=tenant_id, dataset_id=dataset.id, document_ids=["waiting-doc-1"]),
            DocumentTask(tenant_id=tenant_id, dataset_id=dataset.id, document_ids=["waiting-doc-2"]),
        ]
        # Convert DocumentTask objects to dictionaries for serialization
        waiting_task_dicts = [asdict(task) for task in waiting_tasks]
        queue.push_tasks(waiting_task_dicts)

        # Act: Execute the wrapper function
        _document_indexing_with_tenant_queue(tenant_id, dataset.id, document_ids, mock_task_func)

        # Assert: Verify core processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify task function was called for each waiting task
        assert mock_task_func.delay.call_count == 1

        # Verify correct parameters for each call
        calls = mock_task_func.delay.call_args_list
        assert calls[0][1] == {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": ["waiting-doc-1"]}

        # Verify queue is empty after processing (tasks were pulled)
        remaining_tasks = queue.pull_tasks(count=10)  # Pull more than we added
        assert len(remaining_tasks) == 1

    def test_document_indexing_with_tenant_queue_error_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error handling in _document_indexing_with_tenant_queue using real Redis.

        This test verifies:
        - Exception handling during core processing
        - Tenant queue cleanup even on errors using real Redis
        - Proper error logging
        - Function completes without raising exceptions
        - Queue management continues despite core processing errors
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )
        document_ids = [doc.id for doc in documents]
        tenant_id = dataset.tenant_id
        dataset_id = dataset.id

        # Mock IndexingRunner to raise an exception
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception("Test error")

        # Mock the task function
        from unittest.mock import MagicMock

        mock_task_func = MagicMock()

        # Use real Redis for TenantIsolatedTaskQueue
        from core.rag.pipeline.queue import TenantIsolatedTaskQueue

        # Create real queue instance
        queue = TenantIsolatedTaskQueue(tenant_id, "document_indexing")

        # Add waiting task to the real Redis queue
        waiting_task = DocumentTask(tenant_id=tenant_id, dataset_id=dataset.id, document_ids=["waiting-doc-1"])
        queue.push_tasks([asdict(waiting_task)])

        # Act: Execute the wrapper function
        _document_indexing_with_tenant_queue(tenant_id, dataset.id, document_ids, mock_task_func)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify error was handled gracefully
        # The function should not raise exceptions
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were still updated to parsing status before the exception
        # Re-query documents from database since _document_indexing uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify waiting task was still processed despite core processing error
        mock_task_func.delay.assert_called_once()

        # Verify correct parameters for the call
        call = mock_task_func.delay.call_args
        assert call[1] == {"tenant_id": tenant_id, "dataset_id": dataset_id, "document_ids": ["waiting-doc-1"]}

        # Verify queue is empty after processing (task was pulled)
        remaining_tasks = queue.pull_tasks(count=10)
        assert len(remaining_tasks) == 0

    def test_document_indexing_with_tenant_queue_tenant_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant isolation in _document_indexing_with_tenant_queue using real Redis.

        This test verifies:
        - Different tenants have isolated queues
        - Tasks from one tenant don't affect another tenant's queue
        - Queue operations are properly scoped to tenant
        """
        # Arrange: Create test data for two different tenants
        dataset1, documents1 = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )
        dataset2, documents2 = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=1
        )

        tenant1_id = dataset1.tenant_id
        tenant2_id = dataset2.tenant_id
        dataset1_id = dataset1.id
        dataset2_id = dataset2.id
        document_ids1 = [doc.id for doc in documents1]
        document_ids2 = [doc.id for doc in documents2]

        # Mock the task function
        from unittest.mock import MagicMock

        mock_task_func = MagicMock()

        # Use real Redis for TenantIsolatedTaskQueue
        from core.rag.pipeline.queue import TenantIsolatedTaskQueue

        # Create queue instances for both tenants
        queue1 = TenantIsolatedTaskQueue(tenant1_id, "document_indexing")
        queue2 = TenantIsolatedTaskQueue(tenant2_id, "document_indexing")

        # Add waiting tasks to both queues
        waiting_task1 = DocumentTask(tenant_id=tenant1_id, dataset_id=dataset1.id, document_ids=["tenant1-doc-1"])
        waiting_task2 = DocumentTask(tenant_id=tenant2_id, dataset_id=dataset2.id, document_ids=["tenant2-doc-1"])

        queue1.push_tasks([asdict(waiting_task1)])
        queue2.push_tasks([asdict(waiting_task2)])

        # Act: Execute the wrapper function for tenant1 only
        _document_indexing_with_tenant_queue(tenant1_id, dataset1.id, document_ids1, mock_task_func)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify core processing occurred for tenant1
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify only tenant1's waiting task was processed
        mock_task_func.delay.assert_called_once()
        call = mock_task_func.delay.call_args
        assert call[1] == {"tenant_id": tenant1_id, "dataset_id": dataset1_id, "document_ids": ["tenant1-doc-1"]}

        # Verify tenant1's queue is empty
        remaining_tasks1 = queue1.pull_tasks(count=10)
        assert len(remaining_tasks1) == 0

        # Verify tenant2's queue still has its task (isolation)
        remaining_tasks2 = queue2.pull_tasks(count=10)
        assert len(remaining_tasks2) == 1

        # Verify queue keys are different
        assert queue1._queue != queue2._queue
        assert queue1._task_key != queue2._task_key
