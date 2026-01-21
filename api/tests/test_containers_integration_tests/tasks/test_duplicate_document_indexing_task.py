from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from enums.cloud_plan import CloudPlan
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.duplicate_document_indexing_task import (
    _duplicate_document_indexing_task,  # Core function
    _duplicate_document_indexing_task_with_tenant_queue,  # Tenant queue wrapper function
    duplicate_document_indexing_task,  # Deprecated old interface
    normal_duplicate_document_indexing_task,  # New normal task
    priority_duplicate_document_indexing_task,  # New priority task
)


class TestDuplicateDocumentIndexingTasks:
    """Integration tests for duplicate document indexing tasks using testcontainers.

    This test class covers:
    - Core _duplicate_document_indexing_task function
    - Deprecated duplicate_document_indexing_task function
    - New normal_duplicate_document_indexing_task function
    - New priority_duplicate_document_indexing_task function
    - Tenant queue wrapper _duplicate_document_indexing_task_with_tenant_queue function
    - Document segment cleanup logic
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.duplicate_document_indexing_task.IndexingRunner") as mock_indexing_runner,
            patch("tasks.duplicate_document_indexing_task.FeatureService") as mock_feature_service,
            patch("tasks.duplicate_document_indexing_task.IndexProcessorFactory") as mock_index_processor_factory,
        ):
            # Setup mock indexing runner
            mock_runner_instance = MagicMock()
            mock_indexing_runner.return_value = mock_runner_instance

            # Setup mock feature service
            mock_features = MagicMock()
            mock_features.billing.enabled = False
            mock_feature_service.get_features.return_value = mock_features

            # Setup mock index processor factory
            mock_processor = MagicMock()
            mock_processor.clean = MagicMock()
            mock_index_processor_factory.return_value.init_index_processor.return_value = mock_processor

            yield {
                "indexing_runner": mock_indexing_runner,
                "indexing_runner_instance": mock_runner_instance,
                "feature_service": mock_feature_service,
                "features": mock_features,
                "index_processor_factory": mock_index_processor_factory,
                "index_processor": mock_processor,
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
                doc_form="text_model",
            )
            db_session_with_containers.add(document)
            documents.append(document)

        db_session_with_containers.commit()

        # Refresh dataset to ensure it's properly loaded
        db_session_with_containers.refresh(dataset)

        return dataset, documents

    def _create_test_dataset_with_segments(
        self, db_session_with_containers, mock_external_service_dependencies, document_count=3, segments_per_doc=2
    ):
        """
        Helper method to create a test dataset with documents and segments.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies
            document_count: Number of documents to create
            segments_per_doc: Number of segments per document

        Returns:
            tuple: (dataset, documents, segments) - Created dataset, documents and segments
        """
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count
        )

        fake = Faker()
        segments = []

        # Create segments for each document
        for document in documents:
            for i in range(segments_per_doc):
                segment = DocumentSegment(
                    id=fake.uuid4(),
                    tenant_id=dataset.tenant_id,
                    dataset_id=dataset.id,
                    document_id=document.id,
                    position=i,
                    index_node_id=f"{document.id}-node-{i}",
                    index_node_hash=fake.sha256(),
                    content=fake.text(max_nb_chars=200),
                    word_count=50,
                    tokens=100,
                    status="completed",
                    enabled=True,
                    indexing_at=fake.date_time_this_year(),
                    created_by=dataset.created_by,  # Add required field
                )
                db_session_with_containers.add(segment)
                segments.append(segment)

        db_session_with_containers.commit()

        # Refresh to ensure all relationships are loaded
        for document in documents:
            db_session_with_containers.refresh(document)

        return dataset, documents, segments

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
                doc_form="text_model",
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

    def test_duplicate_document_indexing_task_success(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful duplicate document indexing with multiple documents.

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
        _duplicate_document_indexing_task(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify the expected outcomes
        # Verify indexing runner was called correctly
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were updated to parsing status
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with correct documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 3

    def test_duplicate_document_indexing_task_with_segment_cleanup(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test duplicate document indexing with existing segments that need cleanup.

        This test verifies:
        - Old segments are identified and cleaned
        - Index processor clean method is called
        - Segments are deleted from database
        - New indexing proceeds after cleanup
        """
        # Arrange: Create test data with existing segments
        dataset, documents, segments = self._create_test_dataset_with_segments(
            db_session_with_containers, mock_external_service_dependencies, document_count=2, segments_per_doc=3
        )
        document_ids = [doc.id for doc in documents]
        segment_ids = [seg.id for seg in segments]

        # Act: Execute the task
        _duplicate_document_indexing_task(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify segment cleanup
        db_session_with_containers.expire_all()

        # Assert: Verify segment cleanup
        # Verify index processor clean was called for each document with segments
        assert mock_external_service_dependencies["index_processor"].clean.call_count == len(documents)

        # Verify segments were deleted from database
        # Re-query segments from database using captured IDs to avoid stale ORM instances
        for seg_id in segment_ids:
            deleted_segment = (
                db_session_with_containers.query(DocumentSegment).where(DocumentSegment.id == seg_id).first()
            )
            assert deleted_segment is None

        # Verify documents were updated to parsing status
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

    def test_duplicate_document_indexing_task_dataset_not_found(
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
        _duplicate_document_indexing_task(non_existent_dataset_id, document_ids)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_not_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()
        mock_external_service_dependencies["index_processor"].clean.assert_not_called()

    def test_duplicate_document_indexing_task_document_not_found_in_dataset(
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
        _duplicate_document_indexing_task(dataset.id, all_document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify only existing documents were processed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify only existing documents were updated
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in existing_document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

        # Verify the run method was called with only existing documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 2  # Only existing documents

    def test_duplicate_document_indexing_task_indexing_runner_exception(
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
        _duplicate_document_indexing_task(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify exception was handled gracefully
        # The task should complete without raising exceptions
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were still updated to parsing status before the exception
        # Re-query documents from database since _duplicate_document_indexing_task close the session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"
            assert updated_document.processing_started_at is not None

    def test_duplicate_document_indexing_task_billing_sandbox_plan_batch_limit(
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
                doc_form="text_model",
            )
            db_session_with_containers.add(document)
            extra_documents.append(document)

        db_session_with_containers.commit()
        all_documents = documents + extra_documents
        document_ids = [doc.id for doc in all_documents]

        # Act: Execute the task with too many documents for sandbox plan
        _duplicate_document_indexing_task(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify error handling
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "error"
            assert updated_document.error is not None
            assert "batch upload" in updated_document.error.lower()
            assert updated_document.stopped_at is not None

        # Verify indexing runner was not called due to early validation error
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_duplicate_document_indexing_task_billing_vector_space_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test billing validation for vector space limit.

        This test verifies:
        - Vector space limit enforcement
        - Error handling for vector space limit exceeded
        - Document status updates to error state
        - Proper error message recording
        """
        # Arrange: Create test data with billing enabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers, mock_external_service_dependencies, billing_enabled=True
        )

        # Configure TEAM plan with vector space limit exceeded
        mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.TEAM
        mock_external_service_dependencies["features"].vector_space.limit = 100
        mock_external_service_dependencies["features"].vector_space.size = 98  # Almost at limit

        document_ids = [doc.id for doc in documents]  # 3 documents will exceed limit

        # Act: Execute the task with documents that will exceed vector space limit
        _duplicate_document_indexing_task(dataset.id, document_ids)

        # Ensure we see committed changes from a different session
        db_session_with_containers.expire_all()

        # Assert: Verify error handling
        # Re-query documents from database since _duplicate_document_indexing_task uses a different session
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "error"
            assert updated_document.error is not None
            assert "limit" in updated_document.error.lower()
            assert updated_document.stopped_at is not None

        # Verify indexing runner was not called due to early validation error
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

    def test_duplicate_document_indexing_task_with_empty_document_list(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of empty document list.

        This test verifies:
        - Empty document list is handled gracefully
        - No processing occurs
        - No errors are raised
        - Database session is properly closed
        """
        # Arrange: Create test dataset
        dataset, _ = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=0
        )
        document_ids = []

        # Act: Execute the task with empty document list
        _duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify IndexingRunner was called with empty list
        # Note: The actual implementation does call run([]) with empty list
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once_with([])

    def test_deprecated_duplicate_document_indexing_task_delegates_to_core(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that deprecated duplicate_document_indexing_task delegates to core function.

        This test verifies:
        - Deprecated function calls core _duplicate_document_indexing_task
        - Proper parameter passing
        - Backward compatibility
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the deprecated task
        duplicate_document_indexing_task(dataset.id, document_ids)

        # Assert: Verify core function was executed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Clear session cache to see database updates from task's session
        db_session_with_containers.expire_all()

        # Verify documents were processed
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"

    @patch("tasks.duplicate_document_indexing_task.TenantIsolatedTaskQueue")
    def test_normal_duplicate_document_indexing_task_with_tenant_queue(
        self, mock_queue_class, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test normal_duplicate_document_indexing_task with tenant isolation queue.

        This test verifies:
        - Task uses tenant isolation queue correctly
        - Core processing function is called
        - Queue management (pull tasks, delete key) works properly
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock tenant isolated queue to return no next tasks
        mock_queue = MagicMock()
        mock_queue.pull_tasks.return_value = []
        mock_queue_class.return_value = mock_queue

        # Act: Execute the normal task
        normal_duplicate_document_indexing_task(dataset.tenant_id, dataset.id, document_ids)

        # Assert: Verify processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify tenant queue was used
        mock_queue_class.assert_called_with(dataset.tenant_id, "duplicate_document_indexing")
        mock_queue.pull_tasks.assert_called_once()
        mock_queue.delete_task_key.assert_called_once()

        # Clear session cache to see database updates from task's session
        db_session_with_containers.expire_all()

        # Verify documents were processed
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"

    @patch("tasks.duplicate_document_indexing_task.TenantIsolatedTaskQueue")
    def test_priority_duplicate_document_indexing_task_with_tenant_queue(
        self, mock_queue_class, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test priority_duplicate_document_indexing_task with tenant isolation queue.

        This test verifies:
        - Task uses tenant isolation queue correctly
        - Core processing function is called
        - Queue management works properly
        - Same behavior as normal task with different queue assignment
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock tenant isolated queue to return no next tasks
        mock_queue = MagicMock()
        mock_queue.pull_tasks.return_value = []
        mock_queue_class.return_value = mock_queue

        # Act: Execute the priority task
        priority_duplicate_document_indexing_task(dataset.tenant_id, dataset.id, document_ids)

        # Assert: Verify processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify tenant queue was used
        mock_queue_class.assert_called_with(dataset.tenant_id, "duplicate_document_indexing")
        mock_queue.pull_tasks.assert_called_once()
        mock_queue.delete_task_key.assert_called_once()

        # Clear session cache to see database updates from task's session
        db_session_with_containers.expire_all()

        # Verify documents were processed
        for doc_id in document_ids:
            updated_document = db_session_with_containers.query(Document).where(Document.id == doc_id).first()
            assert updated_document.indexing_status == "parsing"

    @patch("tasks.duplicate_document_indexing_task.TenantIsolatedTaskQueue")
    def test_tenant_queue_wrapper_processes_next_tasks(
        self, mock_queue_class, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test tenant queue wrapper processes next queued tasks.

        This test verifies:
        - After completing current task, next tasks are pulled from queue
        - Next tasks are executed correctly
        - Task waiting time is set for next tasks
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Extract values before session detachment
        tenant_id = dataset.tenant_id
        dataset_id = dataset.id

        # Mock tenant isolated queue to return next task
        mock_queue = MagicMock()
        next_task = {
            "tenant_id": tenant_id,
            "dataset_id": dataset_id,
            "document_ids": document_ids,
        }
        mock_queue.pull_tasks.return_value = [next_task]
        mock_queue_class.return_value = mock_queue

        # Mock the task function to track calls
        mock_task_func = MagicMock()

        # Act: Execute the wrapper function
        _duplicate_document_indexing_task_with_tenant_queue(tenant_id, dataset_id, document_ids, mock_task_func)

        # Assert: Verify next task was scheduled
        mock_queue.pull_tasks.assert_called_once()
        mock_queue.set_task_waiting_time.assert_called_once()
        mock_task_func.delay.assert_called_once_with(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_ids=document_ids,
        )
        mock_queue.delete_task_key.assert_not_called()
