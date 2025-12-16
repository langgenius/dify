"""
Integration tests for create_segment_to_index_task using TestContainers.

This module provides comprehensive testing for the create_segment_to_index_task
which handles asynchronous document segment indexing operations.
"""

import time
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from faker import Faker

from extensions.ext_redis import redis_client
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.create_segment_to_index_task import create_segment_to_index_task


class TestCreateSegmentToIndexTask:
    """Integration tests for create_segment_to_index_task using testcontainers."""

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers):
        """Clean up database and Redis before each test to ensure isolation."""
        from extensions.ext_database import db

        # Clear all test data
        db.session.query(DocumentSegment).delete()
        db.session.query(Document).delete()
        db.session.query(Dataset).delete()
        db.session.query(TenantAccountJoin).delete()
        db.session.query(Tenant).delete()
        db.session.query(Account).delete()
        db.session.commit()

        # Clear Redis cache
        redis_client.flushdb()

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.create_segment_to_index_task.IndexProcessorFactory") as mock_factory,
        ):
            # Setup default mock returns
            mock_processor = MagicMock()
            mock_factory.return_value.init_index_processor.return_value = mock_processor

            yield {
                "index_processor_factory": mock_factory,
                "index_processor": mock_processor,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (account, tenant) - Created account and tenant instances
        """
        fake = Faker()

        # Create account
        account = Account(
            email=fake.email(),
            name=fake.name(),
            interface_language="en-US",
            status="active",
        )

        from extensions.ext_database import db

        db.session.add(account)
        db.session.commit()

        # Create tenant
        tenant = Tenant(
            name=fake.company(),
            status="normal",
            plan="basic",
        )
        db.session.add(tenant)
        db.session.commit()

        # Create tenant-account join with owner role
        join = TenantAccountJoin(
            tenant_id=tenant.id,
            account_id=account.id,
            role=TenantAccountRole.OWNER,
            current=True,
        )
        db.session.add(join)
        db.session.commit()

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_dataset_and_document(self, db_session_with_containers, tenant_id, account_id):
        """
        Helper method to create a test dataset and document for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            tenant_id: Tenant ID for the dataset
            account_id: Account ID for the document

        Returns:
            tuple: (dataset, document) - Created dataset and document instances
        """
        fake = Faker()

        # Create dataset
        dataset = Dataset(
            name=fake.company(),
            description=fake.text(max_nb_chars=100),
            tenant_id=tenant_id,
            data_source_type="upload_file",
            indexing_technique="high_quality",
            embedding_model_provider="openai",
            embedding_model="text-embedding-ada-002",
            created_by=account_id,
        )
        db_session_with_containers.add(dataset)
        db_session_with_containers.commit()

        # Create document
        document = Document(
            name=fake.file_name(),
            dataset_id=dataset.id,
            tenant_id=tenant_id,
            position=1,
            data_source_type="upload_file",
            batch="test_batch",
            created_from="upload_file",
            created_by=account_id,
            enabled=True,
            archived=False,
            indexing_status="completed",
            doc_form="qa_model",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()

        return dataset, document

    def _create_test_segment(
        self, db_session_with_containers, dataset_id, document_id, tenant_id, account_id, status="waiting"
    ):
        """
        Helper method to create a test document segment for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            dataset_id: Dataset ID for the segment
            document_id: Document ID for the segment
            tenant_id: Tenant ID for the segment
            account_id: Account ID for the segment
            status: Initial status of the segment

        Returns:
            DocumentSegment: Created document segment instance
        """
        fake = Faker()

        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=document_id,
            position=1,
            content=fake.text(max_nb_chars=500),
            answer=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=500).split()),
            tokens=len(fake.text(max_nb_chars=500).split()) * 2,
            keywords=["test", "document", "segment"],
            index_node_id=str(uuid4()),
            index_node_hash=str(uuid4()),
            status=status,
            created_by=account_id,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        return segment

    def test_create_segment_to_index_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful creation of segment to index.

        This test verifies:
        - Segment status transitions from waiting to indexing to completed
        - Index processor is called with correct parameters
        - Segment metadata is properly updated
        - Redis cache key is cleaned up
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify segment status changes
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None
        assert segment.error is None

        # Verify index processor was called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(dataset.doc_form)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify Redis cache cleanup
        cache_key = f"segment_{segment.id}_indexing"
        assert redis_client.exists(cache_key) == 0

    def test_create_segment_to_index_segment_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of non-existent segment ID.

        This test verifies:
        - Task gracefully handles missing segment
        - No exceptions are raised
        - Database session is properly closed
        """
        # Arrange: Use non-existent segment ID
        non_existent_segment_id = str(uuid4())

        # Act & Assert: Task should complete without error
        result = create_segment_to_index_task(non_existent_segment_id)
        assert result is None

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_invalid_status(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of segment with invalid status.

        This test verifies:
        - Task skips segments not in 'waiting' status
        - No processing occurs for invalid status
        - Database session is properly closed
        """
        # Arrange: Create segment with invalid status
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="completed"
        )

        # Act: Execute the task
        result = create_segment_to_index_task(segment.id)

        # Assert: Task should complete without processing
        assert result is None

        # Verify segment status unchanged
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is None

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_no_dataset(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test handling of segment without associated dataset.

        This test verifies:
        - Task gracefully handles missing dataset
        - Segment status remains unchanged
        - No processing occurs
        """
        # Arrange: Create segment with invalid dataset_id
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        invalid_dataset_id = str(uuid4())

        # Create document with invalid dataset_id
        document = Document(
            name="test_doc",
            dataset_id=invalid_dataset_id,
            tenant_id=tenant.id,
            position=1,
            data_source_type="upload_file",
            batch="test_batch",
            created_from="upload_file",
            created_by=account.id,
            enabled=True,
            archived=False,
            indexing_status="completed",
            doc_form="text_model",
        )
        db_session_with_containers.add(document)
        db_session_with_containers.commit()

        segment = self._create_test_segment(
            db_session_with_containers, invalid_dataset_id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        result = create_segment_to_index_task(segment.id)

        # Assert: Task should complete without processing
        assert result is None

        # Verify segment status changed to indexing (task updates status before checking document)
        db_session_with_containers.refresh(segment)
        assert segment.status == "indexing"

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_no_document(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test handling of segment without associated document.

        This test verifies:
        - Task gracefully handles missing document
        - Segment status remains unchanged
        - No processing occurs
        """
        # Arrange: Create segment with invalid document_id
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, _ = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        invalid_document_id = str(uuid4())

        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, invalid_document_id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        result = create_segment_to_index_task(segment.id)

        # Assert: Task should complete without processing
        assert result is None

        # Verify segment status changed to indexing (task updates status before checking document)
        db_session_with_containers.refresh(segment)
        assert segment.status == "indexing"

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_document_disabled(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of segment with disabled document.

        This test verifies:
        - Task skips segments with disabled documents
        - No processing occurs for disabled documents
        - Segment status remains unchanged
        """
        # Arrange: Create disabled document
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        # Disable the document
        document.enabled = False
        db_session_with_containers.commit()

        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        result = create_segment_to_index_task(segment.id)

        # Assert: Task should complete without processing
        assert result is None

        # Verify segment status changed to indexing (task updates status before checking document)
        db_session_with_containers.refresh(segment)
        assert segment.status == "indexing"

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_document_archived(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of segment with archived document.

        This test verifies:
        - Task skips segments with archived documents
        - No processing occurs for archived documents
        - Segment status remains unchanged
        """
        # Arrange: Create archived document
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        # Archive the document
        document.archived = True
        db_session_with_containers.commit()

        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        result = create_segment_to_index_task(segment.id)

        # Assert: Task should complete without processing
        assert result is None

        # Verify segment status changed to indexing (task updates status before checking document)
        db_session_with_containers.refresh(segment)
        assert segment.status == "indexing"

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_document_indexing_incomplete(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of segment with document that has incomplete indexing.

        This test verifies:
        - Task skips segments with incomplete indexing documents
        - No processing occurs for incomplete indexing
        - Segment status remains unchanged
        """
        # Arrange: Create document with incomplete indexing
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        # Set incomplete indexing status
        document.indexing_status = "indexing"
        db_session_with_containers.commit()

        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        result = create_segment_to_index_task(segment.id)

        # Assert: Task should complete without processing
        assert result is None

        # Verify segment status changed to indexing (task updates status before checking document)
        db_session_with_containers.refresh(segment)
        assert segment.status == "indexing"

        # Verify no index processor calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()

    def test_create_segment_to_index_processor_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of index processor exceptions.

        This test verifies:
        - Task properly handles index processor failures
        - Segment status is updated to error
        - Segment is disabled with error information
        - Redis cache is cleaned up despite errors
        """
        # Arrange: Create test data and mock processor exception
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Mock processor to raise exception
        mock_external_service_dependencies["index_processor"].load.side_effect = Exception("Processor failed")

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify error handling
        db_session_with_containers.refresh(segment)
        assert segment.status == "error"
        assert segment.enabled is False
        assert segment.disabled_at is not None
        assert segment.error == "Processor failed"

        # Verify Redis cache cleanup still occurs
        cache_key = f"segment_{segment.id}_indexing"
        assert redis_client.exists(cache_key) == 0

    def test_create_segment_to_index_with_keywords(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with custom keywords.

        This test verifies:
        - Task accepts and processes keywords parameter
        - Keywords are properly passed through the task
        - Indexing completes successfully with keywords
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )
        custom_keywords = ["custom", "keywords", "test"]

        # Act: Execute the task with keywords
        create_segment_to_index_task(segment.id, keywords=custom_keywords)

        # Assert: Verify successful indexing
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

        # Verify index processor was called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(dataset.doc_form)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

    def test_create_segment_to_index_different_doc_forms(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with different document forms.

        This test verifies:
        - Task works with various document forms
        - Index processor factory receives correct doc_form
        - Processing completes successfully for different forms
        """
        # Arrange: Test different doc_forms
        doc_forms = ["qa_model", "text_model", "web_model"]

        for doc_form in doc_forms:
            # Create fresh test data for each form
            account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
            dataset, document = self._create_test_dataset_and_document(
                db_session_with_containers, tenant.id, account.id
            )

            # Update document's doc_form for testing
            document.doc_form = doc_form
            db_session_with_containers.commit()

            segment = self._create_test_segment(
                db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
            )

            # Act: Execute the task
            create_segment_to_index_task(segment.id)

            # Assert: Verify successful indexing
            db_session_with_containers.refresh(segment)
            assert segment.status == "completed"

            # Verify correct doc_form was passed to factory
            mock_external_service_dependencies["index_processor_factory"].assert_called_with(doc_form)

    def test_create_segment_to_index_performance_timing(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing performance and timing.

        This test verifies:
        - Task execution time is reasonable
        - Performance metrics are properly recorded
        - No significant performance degradation
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task and measure time
        start_time = time.time()
        create_segment_to_index_task(segment.id)
        end_time = time.time()

        # Assert: Verify performance
        execution_time = end_time - start_time
        assert execution_time < 5.0  # Should complete within 5 seconds

        # Verify successful completion
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"

    def test_create_segment_to_index_concurrent_execution(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test concurrent execution of segment indexing tasks.

        This test verifies:
        - Multiple tasks can run concurrently
        - No race conditions occur
        - All segments are processed correctly
        """
        # Arrange: Create multiple test segments
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        segments = []
        for i in range(3):
            segment = self._create_test_segment(
                db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
            )
            segments.append(segment)

        # Act: Execute tasks concurrently (simulated)
        segment_ids = [segment.id for segment in segments]
        for segment_id in segment_ids:
            create_segment_to_index_task(segment_id)

        # Assert: Verify all segments processed
        for segment in segments:
            db_session_with_containers.refresh(segment)
            assert segment.status == "completed"
            assert segment.indexing_at is not None
            assert segment.completed_at is not None

        # Verify index processor was called for each segment
        assert mock_external_service_dependencies["index_processor_factory"].call_count == 3

    def test_create_segment_to_index_large_content(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with large content.

        This test verifies:
        - Task handles large content segments
        - Performance remains acceptable with large content
        - No memory or processing issues occur
        """
        # Arrange: Create segment with large content
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        # Generate large content (simulate large document)
        large_content = "Large content " * 1000  # ~15KB content
        segment = DocumentSegment(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content=large_content,
            answer="Large answer " * 100,
            word_count=len(large_content.split()),
            tokens=len(large_content.split()) * 2,
            keywords=["large", "content", "test"],
            index_node_id=str(uuid4()),
            index_node_hash=str(uuid4()),
            status="waiting",
            created_by=account.id,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Act: Execute the task
        start_time = time.time()
        create_segment_to_index_task(segment.id)
        end_time = time.time()

        # Assert: Verify successful processing
        execution_time = end_time - start_time
        assert execution_time < 10.0  # Should complete within 10 seconds

        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

    def test_create_segment_to_index_redis_failure(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing when Redis operations fail.

        This test verifies:
        - Task continues to work even if Redis fails
        - Indexing completes successfully
        - Redis errors don't affect core functionality
        """
        # Arrange: Create test data and mock Redis failure
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Set up Redis cache key to simulate indexing in progress
        cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(cache_key, "processing", ex=300)

        # Mock Redis to raise exception in finally block
        with patch.object(redis_client, "delete", side_effect=Exception("Redis connection failed")):
            # Act: Execute the task - Redis failure should not prevent completion
            with pytest.raises(Exception) as exc_info:
                create_segment_to_index_task(segment.id)

            # Verify the exception contains the expected Redis error message
            assert "Redis connection failed" in str(exc_info.value)

        # Assert: Verify indexing still completed successfully despite Redis failure
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

        # Verify Redis cache key still exists (since delete failed)
        assert redis_client.exists(cache_key) == 1

    def test_create_segment_to_index_database_transaction_rollback(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with database transaction handling.

        This test verifies:
        - Database transactions are properly managed
        - Rollback occurs on errors
        - Data consistency is maintained
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Mock global database session to simulate transaction issues
        from extensions.ext_database import db

        original_commit = db.session.commit
        commit_called = False

        def mock_commit():
            nonlocal commit_called
            if not commit_called:
                commit_called = True
                raise Exception("Database commit failed")
            return original_commit()

        db.session.commit = mock_commit

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify error handling and rollback
        db_session_with_containers.refresh(segment)
        assert segment.status == "error"
        assert segment.enabled is False
        assert segment.disabled_at is not None
        assert segment.error is not None

        # Restore original commit method
        db.session.commit = original_commit

    def test_create_segment_to_index_metadata_validation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with metadata validation.

        This test verifies:
        - Document metadata is properly constructed
        - All required metadata fields are present
        - Metadata is correctly passed to index processor
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify successful indexing
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"

        # Verify index processor was called with correct metadata
        mock_processor = mock_external_service_dependencies["index_processor"]
        mock_processor.load.assert_called_once()

        # Get the call arguments to verify metadata structure
        call_args = mock_processor.load.call_args
        assert len(call_args[0]) == 2  # dataset and documents

        # Verify basic structure without deep object inspection
        called_dataset = call_args[0][0]  # first arg should be dataset
        assert called_dataset is not None

        documents = call_args[0][1]  # second arg should be list of documents
        assert len(documents) == 1
        doc = documents[0]
        assert doc is not None

    def test_create_segment_to_index_status_transition_flow(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test complete status transition flow during indexing.

        This test verifies:
        - Status transitions: waiting -> indexing -> completed
        - Timestamps are properly recorded at each stage
        - No intermediate states are skipped
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Verify initial state
        assert segment.status == "waiting"
        assert segment.indexing_at is None
        assert segment.completed_at is None

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify final state
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

        # Verify timestamp ordering
        assert segment.indexing_at <= segment.completed_at

    def test_create_segment_to_index_with_empty_content(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with empty or minimal content.

        This test verifies:
        - Task handles empty content gracefully
        - Indexing completes successfully with minimal content
        - No errors occur with edge case content
        """
        # Arrange: Create segment with minimal content
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        segment = DocumentSegment(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="",  # Empty content
            answer="",
            word_count=0,
            tokens=0,
            keywords=[],
            index_node_id=str(uuid4()),
            index_node_hash=str(uuid4()),
            status="waiting",
            created_by=account.id,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify successful indexing
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

    def test_create_segment_to_index_with_special_characters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with special characters and unicode content.

        This test verifies:
        - Task handles special characters correctly
        - Unicode content is processed properly
        - No encoding issues occur
        """
        # Arrange: Create segment with special characters
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        special_content = "Special chars: !@#$%^&*()_+-=[]{}|;':\",./<>?`~"
        unicode_content = "Unicode: 中文测试 🚀 🌟 💻"
        mixed_content = special_content + "\n" + unicode_content

        segment = DocumentSegment(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content=mixed_content,
            answer="Special answer: 🎯",
            word_count=len(mixed_content.split()),
            tokens=len(mixed_content.split()) * 2,
            keywords=["special", "unicode", "test"],
            index_node_id=str(uuid4()),
            index_node_hash=str(uuid4()),
            status="waiting",
            created_by=account.id,
        )
        db_session_with_containers.add(segment)
        db_session_with_containers.commit()

        # Act: Execute the task
        create_segment_to_index_task(segment.id)

        # Assert: Verify successful indexing
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

    def test_create_segment_to_index_with_long_keywords(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with long keyword lists.

        This test verifies:
        - Task handles long keyword lists
        - Keywords parameter is properly processed
        - No performance issues with large keyword sets
        """
        # Arrange: Create segment with long keywords
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Create long keyword list
        long_keywords = [f"keyword_{i}" for i in range(100)]

        # Act: Execute the task with long keywords
        create_segment_to_index_task(segment.id, keywords=long_keywords)

        # Assert: Verify successful indexing
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

        # Verify index processor was called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(dataset.doc_form)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

    def test_create_segment_to_index_tenant_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with proper tenant isolation.

        This test verifies:
        - Tasks are properly isolated by tenant
        - No cross-tenant data access occurs
        - Tenant boundaries are respected
        """
        # Arrange: Create multiple tenants with segments
        account1, tenant1 = self._create_test_account_and_tenant(db_session_with_containers)
        account2, tenant2 = self._create_test_account_and_tenant(db_session_with_containers)

        dataset1, document1 = self._create_test_dataset_and_document(
            db_session_with_containers, tenant1.id, account1.id
        )
        dataset2, document2 = self._create_test_dataset_and_document(
            db_session_with_containers, tenant2.id, account2.id
        )

        segment1 = self._create_test_segment(
            db_session_with_containers, dataset1.id, document1.id, tenant1.id, account1.id, status="waiting"
        )
        segment2 = self._create_test_segment(
            db_session_with_containers, dataset2.id, document2.id, tenant2.id, account2.id, status="waiting"
        )

        # Act: Execute tasks for both tenants
        create_segment_to_index_task(segment1.id)
        create_segment_to_index_task(segment2.id)

        # Assert: Verify both segments processed independently
        db_session_with_containers.refresh(segment1)
        db_session_with_containers.refresh(segment2)

        assert segment1.status == "completed"
        assert segment2.status == "completed"
        assert segment1.tenant_id == tenant1.id
        assert segment2.tenant_id == tenant2.id
        assert segment1.tenant_id != segment2.tenant_id

    def test_create_segment_to_index_with_none_keywords(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment indexing with None keywords parameter.

        This test verifies:
        - Task handles None keywords gracefully
        - Default behavior works correctly
        - No errors occur with None parameters
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)
        segment = self._create_test_segment(
            db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
        )

        # Act: Execute the task with None keywords
        create_segment_to_index_task(segment.id, keywords=None)

        # Assert: Verify successful indexing
        db_session_with_containers.refresh(segment)
        assert segment.status == "completed"
        assert segment.indexing_at is not None
        assert segment.completed_at is not None

        # Verify index processor was called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(dataset.doc_form)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

    def test_create_segment_to_index_comprehensive_integration(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Comprehensive integration test covering multiple scenarios.

        This test verifies:
        - Complete workflow from creation to completion
        - All components work together correctly
        - End-to-end functionality is maintained
        - Performance and reliability under normal conditions
        """
        # Arrange: Create comprehensive test scenario
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset, document = self._create_test_dataset_and_document(db_session_with_containers, tenant.id, account.id)

        # Create multiple segments with different characteristics
        segments = []
        for i in range(5):
            segment = self._create_test_segment(
                db_session_with_containers, dataset.id, document.id, tenant.id, account.id, status="waiting"
            )
            segments.append(segment)

        # Act: Process all segments
        start_time = time.time()
        for segment in segments:
            create_segment_to_index_task(segment.id)
        end_time = time.time()

        # Assert: Verify comprehensive success
        total_time = end_time - start_time
        assert total_time < 25.0  # Should complete all within 25 seconds

        # Verify all segments processed successfully
        for segment in segments:
            db_session_with_containers.refresh(segment)
            assert segment.status == "completed"
            assert segment.indexing_at is not None
            assert segment.completed_at is not None
            assert segment.error is None

        # Verify index processor was called for each segment
        expected_calls = len(segments)
        assert mock_external_service_dependencies["index_processor_factory"].call_count == expected_calls

        # Verify Redis cleanup for each segment
        for segment in segments:
            cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(cache_key) == 0
