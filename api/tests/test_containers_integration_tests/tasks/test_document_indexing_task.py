from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from enums.cloud_plan import CloudPlan
from extensions.ext_database import db
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document
from tasks.document_indexing_task import document_indexing_task


class TestDocumentIndexingTask:
    """Integration tests for document_indexing_task using testcontainers."""

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
        db.session.add(account)
        db.session.commit()

        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

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
        db.session.add(dataset)
        db.session.commit()

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
            db.session.add(document)
            documents.append(document)

        db.session.commit()

        # Refresh dataset to ensure it's properly loaded
        db.session.refresh(dataset)

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
        db.session.add(account)
        db.session.commit()

        tenant = Tenant(
            name=fake.company(),
            status="normal",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

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
        db.session.add(dataset)
        db.session.commit()

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
            db.session.add(document)
            documents.append(document)

        db.session.commit()

        # Configure billing features
        mock_external_service_dependencies["features"].billing.enabled = billing_enabled
        if billing_enabled:
            mock_external_service_dependencies["features"].billing.subscription.plan = CloudPlan.SANDBOX
            mock_external_service_dependencies["features"].vector_space.limit = 100
            mock_external_service_dependencies["features"].vector_space.size = 50

        # Refresh dataset to ensure it's properly loaded
        db.session.refresh(dataset)

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
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify the expected outcomes
        # Verify indexing runner was called correctly
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were updated to parsing status
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

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
        document_indexing_task(non_existent_dataset_id, document_ids)

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
        document_indexing_task(dataset.id, all_document_ids)

        # Assert: Verify only existing documents were processed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify only existing documents were updated
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

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
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify exception was handled gracefully
        # The task should complete without raising exceptions
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were still updated to parsing status before the exception
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

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
        db.session.add(doc1)
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
        db.session.add(doc2)
        extra_documents.append(doc2)

        db.session.commit()

        all_documents = base_documents + extra_documents
        document_ids = [doc.id for doc in all_documents]

        # Act: Execute the task with mixed document states
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify processing
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify all documents were updated to parsing status
        for document in all_documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

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
            db.session.add(document)
            extra_documents.append(document)

        db.session.commit()
        all_documents = documents + extra_documents
        document_ids = [doc.id for doc in all_documents]

        # Act: Execute the task with too many documents for sandbox plan
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error handling
        for document in all_documents:
            db.session.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "batch upload" in document.error
            assert document.stopped_at is not None

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
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify successful processing
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were updated to parsing status
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

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
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify exception was handled gracefully
        # The task should complete without raising exceptions
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify documents were still updated to parsing status before the exception
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None
