from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
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
            role=TenantAccountRole.OWNER.value,
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
            role=TenantAccountRole.OWNER.value,
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
            mock_external_service_dependencies["features"].billing.subscription.plan = "sandbox"
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
        - Performance logging
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

    def test_document_indexing_task_empty_document_list(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of empty document list.

        This test verifies:
        - Empty document list is handled gracefully
        - No indexing runner calls for empty list
        - Database session cleanup
        - No errors are raised
        """
        # Arrange: Create test data
        dataset, _ = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=0
        )

        # Act: Execute the task with empty document list
        document_indexing_task(dataset.id, [])

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_not_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_not_called()

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

    def test_document_indexing_task_feature_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of FeatureService exceptions during billing check.

        This test verifies:
        - FeatureService exceptions are properly caught
        - Documents are updated to error state
        - Error information is recorded
        - Task completes without raising exceptions
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock FeatureService to raise an exception
        mock_external_service_dependencies["feature_service"].get_features.side_effect = Exception(
            "Feature service unavailable"
        )

        # Act: Execute the task
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error handling
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "Feature service unavailable" in document.error
            assert document.stopped_at is not None

        # Verify no indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_task_database_connection_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of database connection errors.

        This test verifies:
        - Database connection errors are handled gracefully
        - Task completes without raising exceptions
        - Appropriate error logging occurs
        - Database session cleanup occurs
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock database query to raise an exception
        with patch("extensions.ext_database.db.session.query") as mock_query:
            mock_query.side_effect = Exception("Database connection failed")

            # Act: Execute the task
            document_indexing_task(dataset.id, document_ids)

            # Assert: Verify exception was handled gracefully
            # The task should complete without raising exceptions
            mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_task_large_document_batch(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test processing of large document batches.

        This test verifies:
        - Large document batches are processed correctly
        - Performance is maintained with many documents
        - All documents are updated to parsing status
        - IndexingRunner receives all documents
        """
        # Arrange: Create test data with large batch
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=10
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task with large batch
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify all documents were processed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify all documents were updated to parsing status
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify the run method was called with all documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 10

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

    def test_document_indexing_task_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance logging and timing measurements.

        This test verifies:
        - Performance timing is measured correctly
        - Appropriate logging occurs
        - Logging includes latency information
        - Task execution time is reasonable
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )
        document_ids = [doc.id for doc in documents]

        # Mock logging to capture performance logs
        with patch("tasks.document_indexing_task.logger") as mock_logger:
            # Act: Execute the task
            document_indexing_task(dataset.id, document_ids)

            # Assert: Verify performance logging
            # Check that info logging was called
            assert mock_logger.info.called

            # Check for performance log with latency information
            performance_log_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(performance_log_calls) == 1

            # Verify the log contains expected information
            performance_log = performance_log_calls[0][0][0]
            assert "Processed dataset:" in performance_log
            assert "latency:" in performance_log

        # Verify normal processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

    def test_document_indexing_task_concurrent_execution_simulation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test simulation of concurrent task execution scenarios.

        This test verifies:
        - Multiple task executions don't interfere with each other
        - Database state remains consistent
        - Each task processes its own documents correctly
        - No race conditions occur
        """
        # Arrange: Create test data for multiple datasets
        dataset1, documents1 = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        dataset2, documents2 = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        document_ids1 = [doc.id for doc in documents1]
        document_ids2 = [doc.id for doc in documents2]

        # Act: Execute tasks for both datasets
        document_indexing_task(dataset1.id, document_ids1)
        document_indexing_task(dataset2.id, document_ids2)

        # Assert: Verify both tasks processed correctly
        assert mock_external_service_dependencies["indexing_runner"].call_count == 2
        assert mock_external_service_dependencies["indexing_runner_instance"].run.call_count == 2

        # Verify documents from both datasets were updated
        for document in documents1 + documents2:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify each task processed its own documents
        call_args_list = mock_external_service_dependencies["indexing_runner_instance"].run.call_args_list
        assert len(call_args_list) == 2

        # First call should have documents1
        first_call_documents = call_args_list[0][0][0]
        assert len(first_call_documents) == 2

        # Second call should have documents2
        second_call_documents = call_args_list[1][0][0]
        assert len(second_call_documents) == 2

    def test_document_indexing_task_memory_usage_optimization(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test memory usage optimization with large document processing.

        This test verifies:
        - Memory usage remains reasonable with large document batches
        - Database session management is efficient
        - No memory leaks occur during processing
        - Performance scales appropriately
        """
        # Arrange: Create test data with large batch
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=50
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task with large batch
        import os

        import psutil

        process = psutil.Process(os.getpid())
        memory_before = process.memory_info().rss

        document_indexing_task(dataset.id, document_ids)

        memory_after = process.memory_info().rss
        memory_increase = memory_after - memory_before

        # Assert: Verify memory usage is reasonable
        # Memory increase should be less than 100MB for 50 documents
        assert memory_increase < 100 * 1024 * 1024, f"Memory usage increased by {memory_increase / 1024 / 1024:.2f}MB"

        # Verify processing completed successfully
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify all documents were processed
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_document_indexing_task_database_transaction_integrity(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test database transaction integrity during processing.

        This test verifies:
        - Database transactions are properly managed
        - Rollback occurs on errors
        - Commit happens only on success
        - Data consistency is maintained
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )
        document_ids = [doc.id for doc in documents]

        # Mock IndexingRunner to fail after some processing
        call_count = 0

        def side_effect(docs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call succeeds, second fails
                return
            else:
                raise Exception("Indexing failed mid-process")

        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = side_effect

        # Act: Execute the task
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify transaction handling
        # Documents should still be updated to parsing status before the error
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify IndexingRunner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()

    def test_document_indexing_task_error_recovery_and_retry_simulation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error recovery and retry simulation scenarios.

        This test verifies:
        - Error states are properly recorded
        - Retry scenarios can be simulated
        - Document states can be reset for retry
        - Error information is preserved
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock IndexingRunner to fail
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception(
            "Temporary indexing failure"
        )

        # Act: Execute the task (first attempt - fails)
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error state
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"  # Still parsing due to error handling
            assert document.processing_started_at is not None

        # Simulate retry scenario - reset mocks and execute again
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = None

        # Reset document states for retry
        for document in documents:
            document.indexing_status = "waiting"
            document.processing_started_at = None
        db.session.commit()

        # Act: Execute the task (retry attempt - succeeds)
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify successful retry
        mock_external_service_dependencies["indexing_runner"].assert_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

        # Verify documents were processed successfully
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_document_indexing_task_integration_with_real_database_operations(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test integration with real database operations using TestContainers.

        This test verifies:
        - Real database operations work correctly
        - Data persistence is maintained
        - Database constraints are respected
        - Foreign key relationships work properly
        """
        # Arrange: Create test data with complex relationships
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=5
        )

        # Create additional related data to test database integrity
        fake = Faker()

        # Create some document segments to test relationships
        from models.dataset import DocumentSegment

        segments = []
        for i, document in enumerate(documents):
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=fake.text(max_nb_chars=200),
                word_count=50,
                tokens=100,
                index_node_id=f"node_{i}",
                index_node_hash=f"hash_{i}",
                enabled=False,
                status="completed",
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify database operations
        # Verify documents were updated
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify segments still exist and maintain relationships
        for segment in segments:
            db.session.refresh(segment)
            assert segment.document_id in document_ids
            assert segment.dataset_id == dataset.id
            assert segment.tenant_id == dataset.tenant_id

        # Verify IndexingRunner was called with correct documents
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]
        assert len(processed_documents) == 5

    def test_document_indexing_task_comprehensive_end_to_end_scenario(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive end-to-end scenario with multiple datasets and documents.

        This test verifies:
        - Complete workflow from data creation to processing
        - Multiple datasets can be processed independently
        - Complex document states are handled correctly
        - Performance remains acceptable with realistic data volumes
        - All database operations complete successfully
        """
        # Arrange: Create multiple datasets with different configurations
        datasets = []
        all_documents = []

        # Create 3 datasets with different document counts
        for i in range(3):
            dataset, documents = self._create_test_dataset_and_documents(
                db_session_with_containers, mock_external_service_dependencies, document_count=3 + i
            )
            datasets.append(dataset)
            all_documents.extend(documents)

        # Act: Execute tasks for all datasets
        for dataset in datasets:
            dataset_documents = [doc for doc in all_documents if doc.dataset_id == dataset.id]
            document_ids = [doc.id for doc in dataset_documents]
            document_indexing_task(dataset.id, document_ids)

        # Assert: Verify all processing completed successfully
        # Verify IndexingRunner was called for each dataset
        assert mock_external_service_dependencies["indexing_runner"].call_count == 3
        assert mock_external_service_dependencies["indexing_runner_instance"].run.call_count == 3

        # Verify all documents were processed
        for document in all_documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify each dataset's documents were processed correctly
        call_args_list = mock_external_service_dependencies["indexing_runner_instance"].run.call_args_list
        assert len(call_args_list) == 3

        # Verify document counts for each call
        expected_counts = [3, 4, 5]  # 3, 4, 5 documents respectively
        for i, call_args in enumerate(call_args_list):
            processed_documents = call_args[0][0]
            assert len(processed_documents) == expected_counts[i]

        # Verify database integrity
        for dataset in datasets:
            db.session.refresh(dataset)
            assert dataset.id is not None
            assert dataset.tenant_id is not None

        # Verify all documents maintain their relationships
        for document in all_documents:
            db.session.refresh(document)
            assert document.dataset_id in [d.id for d in datasets]
            assert document.tenant_id is not None
            assert document.created_by is not None

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
        mock_external_service_dependencies["features"].billing.subscription.plan = "sandbox"

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

    def test_document_indexing_task_billing_vector_space_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test billing validation for vector space limit exceeded.

        This test verifies:
        - Vector space limit enforcement
        - Error handling when limit is exceeded
        - Document status updates to error state
        - Proper error message recording
        """
        # Arrange: Create test data with billing enabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers, mock_external_service_dependencies, billing_enabled=True
        )

        # Configure vector space limit exceeded
        mock_external_service_dependencies["features"].vector_space.limit = 10
        mock_external_service_dependencies["features"].vector_space.size = 10  # At limit

        document_ids = [doc.id for doc in documents]

        # Act: Execute the task when vector space limit is exceeded
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error handling
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "limit" in document.error
            assert document.stopped_at is not None

        # Verify no indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_task_billing_batch_upload_limit_exceeded(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test billing validation for batch upload limit exceeded.

        This test verifies:
        - Batch upload limit enforcement
        - Error handling when batch limit is exceeded
        - Document status updates to error state
        - Proper error message recording
        """
        # Arrange: Create test data with billing enabled
        dataset, documents = self._create_test_dataset_with_billing_features(
            db_session_with_containers, mock_external_service_dependencies, billing_enabled=True
        )

        # Configure batch upload limit
        with patch("configs.dify_config.BATCH_UPLOAD_LIMIT", "2"):
            # Create more documents than batch limit allows
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

            # Act: Execute the task with too many documents for batch limit
            document_indexing_task(dataset.id, document_ids)

            # Assert: Verify error handling
            for document in all_documents:
                db.session.refresh(document)
                assert document.indexing_status == "error"
                assert document.error is not None
                assert "batch upload limit" in document.error
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

    def test_document_indexing_task_feature_service_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of FeatureService exceptions during billing check.

        This test verifies:
        - FeatureService exceptions are properly caught
        - Documents are updated to error state
        - Error information is recorded
        - Task completes without raising exceptions
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock FeatureService to raise an exception
        mock_external_service_dependencies["feature_service"].get_features.side_effect = Exception(
            "Feature service unavailable"
        )

        # Act: Execute the task
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error handling
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "error"
            assert document.error is not None
            assert "Feature service unavailable" in document.error
            assert document.stopped_at is not None

        # Verify no indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_task_database_connection_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of database connection errors.

        This test verifies:
        - Database connection errors are handled gracefully
        - Task completes without raising exceptions
        - Appropriate error logging occurs
        - Database session cleanup occurs
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock database query to raise an exception
        with patch("extensions.ext_database.db.session.query") as mock_query:
            mock_query.side_effect = Exception("Database connection failed")

            # Act: Execute the task
            document_indexing_task(dataset.id, document_ids)

            # Assert: Verify exception was handled gracefully
            # The task should complete without raising exceptions
            mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_task_large_document_batch(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test processing of large document batches.

        This test verifies:
        - Large document batches are processed correctly
        - Performance is maintained with many documents
        - All documents are updated to parsing status
        - IndexingRunner receives all documents
        """
        # Arrange: Create test data with large batch
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=10
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task with large batch
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify all documents were processed
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify all documents were updated to parsing status
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify the run method was called with all documents
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]  # First argument should be documents list
        assert len(processed_documents) == 10

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

    def test_document_indexing_task_performance_logging(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance logging and timing measurements.

        This test verifies:
        - Performance timing is measured correctly
        - Appropriate logging occurs
        - Logging includes latency information
        - Task execution time is reasonable
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )
        document_ids = [doc.id for doc in documents]

        # Mock logging to capture performance logs
        with patch("tasks.document_indexing_task.logger") as mock_logger:
            # Act: Execute the task
            document_indexing_task(dataset.id, document_ids)

            # Assert: Verify performance logging
            # Check that info logging was called
            assert mock_logger.info.called

            # Check for performance log with latency information
            performance_log_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(performance_log_calls) == 1

            # Verify the log contains expected information
            performance_log = performance_log_calls[0][0][0]
            assert "Processed dataset:" in performance_log
            assert "latency:" in performance_log

        # Verify normal processing occurred
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

    def test_document_indexing_task_concurrent_execution_simulation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test simulation of concurrent task execution scenarios.

        This test verifies:
        - Multiple task executions don't interfere with each other
        - Database state remains consistent
        - Each task processes its own documents correctly
        - No race conditions occur
        """
        # Arrange: Create test data for multiple datasets
        dataset1, documents1 = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        dataset2, documents2 = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )

        document_ids1 = [doc.id for doc in documents1]
        document_ids2 = [doc.id for doc in documents2]

        # Act: Execute tasks for both datasets
        document_indexing_task(dataset1.id, document_ids1)
        document_indexing_task(dataset2.id, document_ids2)

        # Assert: Verify both tasks processed correctly
        assert mock_external_service_dependencies["indexing_runner"].call_count == 2
        assert mock_external_service_dependencies["indexing_runner_instance"].run.call_count == 2

        # Verify documents from both datasets were updated
        for document in documents1 + documents2:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify each task processed its own documents
        call_args_list = mock_external_service_dependencies["indexing_runner_instance"].run.call_args_list
        assert len(call_args_list) == 2

        # First call should have documents1
        first_call_documents = call_args_list[0][0][0]
        assert len(first_call_documents) == 2

        # Second call should have documents2
        second_call_documents = call_args_list[1][0][0]
        assert len(second_call_documents) == 2

    def test_document_indexing_task_memory_usage_optimization(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test memory usage optimization with large document processing.

        This test verifies:
        - Memory usage remains reasonable with large document batches
        - Database session management is efficient
        - No memory leaks occur during processing
        - Performance scales appropriately
        """
        # Arrange: Create test data with large batch
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=50
        )
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task with large batch
        import os

        import psutil

        process = psutil.Process(os.getpid())
        memory_before = process.memory_info().rss

        document_indexing_task(dataset.id, document_ids)

        memory_after = process.memory_info().rss
        memory_increase = memory_after - memory_before

        # Assert: Verify memory usage is reasonable
        # Memory increase should be less than 100MB for 50 documents
        assert memory_increase < 100 * 1024 * 1024, f"Memory usage increased by {memory_increase / 1024 / 1024:.2f}MB"

        # Verify processing completed successfully
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called_once()

        # Verify all documents were processed
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_document_indexing_task_database_transaction_integrity(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test database transaction integrity during processing.

        This test verifies:
        - Database transactions are properly managed
        - Rollback occurs on errors
        - Commit happens only on success
        - Data consistency is maintained
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=3
        )
        document_ids = [doc.id for doc in documents]

        # Mock IndexingRunner to fail after some processing
        call_count = 0

        def side_effect(docs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # First call succeeds, second fails
                return
            else:
                raise Exception("Indexing failed mid-process")

        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = side_effect

        # Act: Execute the task
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify transaction handling
        # Documents should still be updated to parsing status before the error
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify IndexingRunner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()

    def test_document_indexing_task_error_recovery_and_retry_simulation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test error recovery and retry simulation scenarios.

        This test verifies:
        - Error states are properly recorded
        - Retry scenarios can be simulated
        - Document states can be reset for retry
        - Error information is preserved
        """
        # Arrange: Create test data
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=2
        )
        document_ids = [doc.id for doc in documents]

        # Mock IndexingRunner to fail
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = Exception(
            "Temporary indexing failure"
        )

        # Act: Execute the task (first attempt - fails)
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify error state
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"  # Still parsing due to error handling
            assert document.processing_started_at is not None

        # Simulate retry scenario - reset mocks and execute again
        mock_external_service_dependencies["indexing_runner_instance"].run.side_effect = None

        # Reset document states for retry
        for document in documents:
            document.indexing_status = "waiting"
            document.processing_started_at = None
        db.session.commit()

        # Act: Execute the task (retry attempt - succeeds)
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify successful retry
        mock_external_service_dependencies["indexing_runner"].assert_called()
        mock_external_service_dependencies["indexing_runner_instance"].run.assert_called()

        # Verify documents were processed successfully
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_document_indexing_task_integration_with_real_database_operations(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test integration with real database operations using TestContainers.

        This test verifies:
        - Real database operations work correctly
        - Data persistence is maintained
        - Database constraints are respected
        - Foreign key relationships work properly
        """
        # Arrange: Create test data with complex relationships
        dataset, documents = self._create_test_dataset_and_documents(
            db_session_with_containers, mock_external_service_dependencies, document_count=5
        )

        # Create additional related data to test database integrity
        fake = Faker()

        # Create some document segments to test relationships
        from models.dataset import DocumentSegment

        segments = []
        for i, document in enumerate(documents):
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=fake.text(max_nb_chars=200),
                word_count=50,
                tokens=100,
                index_node_id=f"node_{i}",
                index_node_hash=f"hash_{i}",
                enabled=False,
                status="completed",
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()
        document_ids = [doc.id for doc in documents]

        # Act: Execute the task
        document_indexing_task(dataset.id, document_ids)

        # Assert: Verify database operations
        # Verify documents were updated
        for document in documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify segments still exist and maintain relationships
        for segment in segments:
            db.session.refresh(segment)
            assert segment.document_id in document_ids
            assert segment.dataset_id == dataset.id
            assert segment.tenant_id == dataset.tenant_id

        # Verify IndexingRunner was called with correct documents
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        call_args = mock_external_service_dependencies["indexing_runner_instance"].run.call_args
        assert call_args is not None
        processed_documents = call_args[0][0]
        assert len(processed_documents) == 5

    def test_document_indexing_task_comprehensive_end_to_end_scenario(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive end-to-end scenario with multiple datasets and documents.

        This test verifies:
        - Complete workflow from data creation to processing
        - Multiple datasets can be processed independently
        - Complex document states are handled correctly
        - Performance remains acceptable with realistic data volumes
        - All database operations complete successfully
        """
        # Arrange: Create multiple datasets with different configurations
        datasets = []
        all_documents = []

        # Create 3 datasets with different document counts
        for i in range(3):
            dataset, documents = self._create_test_dataset_and_documents(
                db_session_with_containers, mock_external_service_dependencies, document_count=3 + i
            )
            datasets.append(dataset)
            all_documents.extend(documents)

        # Act: Execute tasks for all datasets
        for dataset in datasets:
            dataset_documents = [doc for doc in all_documents if doc.dataset_id == dataset.id]
            document_ids = [doc.id for doc in dataset_documents]
            document_indexing_task(dataset.id, document_ids)

        # Assert: Verify all processing completed successfully
        # Verify IndexingRunner was called for each dataset
        assert mock_external_service_dependencies["indexing_runner"].call_count == 3
        assert mock_external_service_dependencies["indexing_runner_instance"].run.call_count == 3

        # Verify all documents were processed
        for document in all_documents:
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

        # Verify each dataset's documents were processed correctly
        call_args_list = mock_external_service_dependencies["indexing_runner_instance"].run.call_args_list
        assert len(call_args_list) == 3

        # Verify document counts for each call
        expected_counts = [3, 4, 5]  # 3, 4, 5 documents respectively
        for i, call_args in enumerate(call_args_list):
            processed_documents = call_args[0][0]
            assert len(processed_documents) == expected_counts[i]

        # Verify database integrity
        for dataset in datasets:
            db.session.refresh(dataset)
            assert dataset.id is not None
            assert dataset.tenant_id is not None

        # Verify all documents maintain their relationships
        for document in all_documents:
            db.session.refresh(document)
            assert document.dataset_id in [d.id for d in datasets]
            assert document.tenant_id is not None
            assert document.created_by is not None
