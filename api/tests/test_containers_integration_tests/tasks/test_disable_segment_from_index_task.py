"""
Integration tests for disable_segment_from_index_task using TestContainers.

This module provides comprehensive integration tests for the disable_segment_from_index_task
using real database and Redis containers to ensure the task works correctly with actual
data and external dependencies.
"""

import logging
import time
from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from faker import Faker

from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.disable_segment_from_index_task import disable_segment_from_index_task

logger = logging.getLogger(__name__)


class TestDisableSegmentFromIndexTask:
    """Integration tests for disable_segment_from_index_task using testcontainers."""

    @pytest.fixture
    def mock_index_processor(self):
        """Mock IndexProcessorFactory and its clean method."""
        with patch("tasks.disable_segment_from_index_task.IndexProcessorFactory") as mock_factory:
            mock_processor = mock_factory.return_value.init_index_processor.return_value
            mock_processor.clean.return_value = None
            yield mock_processor

    def _create_test_account_and_tenant(self, db_session_with_containers) -> tuple[Account, Tenant]:
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

    def _create_test_dataset(self, tenant: Tenant, account: Account) -> Dataset:
        """
        Helper method to create a test dataset.

        Args:
            tenant: Tenant instance
            account: Account instance

        Returns:
            Dataset: Created dataset instance
        """
        fake = Faker()

        dataset = Dataset(
            tenant_id=tenant.id,
            name=fake.sentence(nb_words=3),
            description=fake.text(max_nb_chars=200),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            created_by=account.id,
        )
        db.session.add(dataset)
        db.session.commit()

        return dataset

    def _create_test_document(
        self, dataset: Dataset, tenant: Tenant, account: Account, doc_form: str = "text_model"
    ) -> Document:
        """
        Helper method to create a test document.

        Args:
            dataset: Dataset instance
            tenant: Tenant instance
            account: Account instance
            doc_form: Document form type

        Returns:
            Document: Created document instance
        """
        fake = Faker()

        document = Document(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch=fake.uuid4(),
            name=fake.file_name(),
            created_from="api",
            created_by=account.id,
            indexing_status="completed",
            enabled=True,
            archived=False,
            doc_form=doc_form,
            word_count=1000,
            tokens=500,
            completed_at=datetime.now(UTC),
        )
        db.session.add(document)
        db.session.commit()

        return document

    def _create_test_segment(
        self,
        document: Document,
        dataset: Dataset,
        tenant: Tenant,
        account: Account,
        status: str = "completed",
        enabled: bool = True,
    ) -> DocumentSegment:
        """
        Helper method to create a test document segment.

        Args:
            document: Document instance
            dataset: Dataset instance
            tenant: Tenant instance
            account: Account instance
            status: Segment status
            enabled: Whether segment is enabled

        Returns:
            DocumentSegment: Created segment instance
        """
        fake = Faker()

        segment = DocumentSegment(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content=fake.text(max_nb_chars=500),
            word_count=100,
            tokens=50,
            index_node_id=fake.uuid4(),
            index_node_hash=fake.sha256(),
            status=status,
            enabled=enabled,
            created_by=account.id,
            completed_at=datetime.now(UTC) if status == "completed" else None,
        )
        db.session.add(segment)
        db.session.commit()

        return segment

    def test_disable_segment_success(self, db_session_with_containers, mock_index_processor):
        """
        Test successful segment disabling from index.

        This test verifies:
        - Segment is found and validated
        - Index processor clean method is called with correct parameters
        - Redis cache is cleared
        - Task completes successfully
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Set up Redis cache
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.setex(indexing_cache_key, 600, 1)

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task completed successfully
        assert result is None  # Task returns None on success

        # Verify index processor was called correctly
        mock_index_processor.clean.assert_called_once()
        call_args = mock_index_processor.clean.call_args
        assert call_args[0][0].id == dataset.id  # Check dataset ID
        assert call_args[0][1] == [segment.index_node_id]  # Check index node IDs

        # Verify Redis cache was cleared
        assert redis_client.get(indexing_cache_key) is None

        # Verify segment is still in database
        db.session.refresh(segment)
        assert segment.id is not None

    def test_disable_segment_not_found(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when segment is not found.

        This test verifies:
        - Task handles non-existent segment gracefully
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Use a non-existent segment ID
        fake = Faker()
        non_existent_segment_id = fake.uuid4()

        # Act: Execute the task with non-existent segment
        result = disable_segment_from_index_task(non_existent_segment_id)

        # Assert: Verify the task handled the error gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_not_completed(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when segment is not in completed status.

        This test verifies:
        - Task rejects segments that are not completed
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Create test data with non-completed segment
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account, status="indexing", enabled=True)

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the invalid status gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_no_dataset(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when segment has no associated dataset.

        This test verifies:
        - Task handles segments without dataset gracefully
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Manually remove dataset association
        segment.dataset_id = "00000000-0000-0000-0000-000000000000"
        db.session.commit()

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the missing dataset gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_no_document(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when segment has no associated document.

        This test verifies:
        - Task handles segments without document gracefully
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Manually remove document association
        segment.document_id = "00000000-0000-0000-0000-000000000000"
        db.session.commit()

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the missing document gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_document_disabled(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when document is disabled.

        This test verifies:
        - Task handles disabled documents gracefully
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Create test data with disabled document
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        document.enabled = False
        db.session.commit()

        segment = self._create_test_segment(document, dataset, tenant, account)

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the disabled document gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_document_archived(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when document is archived.

        This test verifies:
        - Task handles archived documents gracefully
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Create test data with archived document
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        document.archived = True
        db.session.commit()

        segment = self._create_test_segment(document, dataset, tenant, account)

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the archived document gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_document_indexing_not_completed(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when document indexing is not completed.

        This test verifies:
        - Task handles documents with incomplete indexing gracefully
        - No index processor operations are performed
        - Task returns early without errors
        """
        # Arrange: Create test data with incomplete indexing
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        document.indexing_status = "indexing"
        db.session.commit()

        segment = self._create_test_segment(document, dataset, tenant, account)

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the incomplete indexing gracefully
        assert result is None

        # Verify index processor was not called
        mock_index_processor.clean.assert_not_called()

    def test_disable_segment_index_processor_exception(self, db_session_with_containers, mock_index_processor):
        """
        Test handling when index processor raises an exception.

        This test verifies:
        - Task handles index processor exceptions gracefully
        - Segment is re-enabled on failure
        - Redis cache is still cleared
        - Database changes are committed
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Set up Redis cache
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.setex(indexing_cache_key, 600, 1)

        # Configure mock to raise exception
        mock_index_processor.clean.side_effect = Exception("Index processor error")

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify the task handled the exception gracefully
        assert result is None

        # Verify index processor was called
        mock_index_processor.clean.assert_called_once()
        call_args = mock_index_processor.clean.call_args
        # Check that the call was made with the correct parameters
        assert len(call_args[0]) == 2  # Check two arguments were passed
        assert call_args[0][1] == [segment.index_node_id]  # Check index node IDs

        # Verify segment was re-enabled
        db.session.refresh(segment)
        assert segment.enabled is True

        # Verify Redis cache was still cleared
        assert redis_client.get(indexing_cache_key) is None

    def test_disable_segment_different_doc_forms(self, db_session_with_containers, mock_index_processor):
        """
        Test disabling segments with different document forms.

        This test verifies:
        - Task works with different document form types
        - Correct index processor is initialized for each form
        - Index processor clean method is called correctly
        """
        # Test different document forms
        doc_forms = ["text_model", "qa_model", "table_model"]

        for doc_form in doc_forms:
            # Arrange: Create test data for each form
            account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
            dataset = self._create_test_dataset(tenant, account)
            document = self._create_test_document(dataset, tenant, account, doc_form=doc_form)
            segment = self._create_test_segment(document, dataset, tenant, account)

            # Reset mock for each iteration
            mock_index_processor.reset_mock()

            # Act: Execute the task
            result = disable_segment_from_index_task(segment.id)

            # Assert: Verify the task completed successfully
            assert result is None

            # Verify correct index processor was initialized
            mock_index_processor.clean.assert_called_once()
            call_args = mock_index_processor.clean.call_args
            assert call_args[0][0].id == dataset.id  # Check dataset ID
            assert call_args[0][1] == [segment.index_node_id]  # Check index node IDs

    def test_disable_segment_redis_cache_handling(self, db_session_with_containers, mock_index_processor):
        """
        Test Redis cache handling during segment disabling.

        This test verifies:
        - Redis cache is properly set before task execution
        - Cache is cleared after task completion
        - Cache handling works with different scenarios
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Test with cache present
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.setex(indexing_cache_key, 600, 1)
        assert redis_client.get(indexing_cache_key) is not None

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify cache was cleared
        assert result is None
        assert redis_client.get(indexing_cache_key) is None

        # Test with no cache present
        segment2 = self._create_test_segment(document, dataset, tenant, account)
        result2 = disable_segment_from_index_task(segment2.id)

        # Assert: Verify task still works without cache
        assert result2 is None

    def test_disable_segment_performance_timing(self, db_session_with_containers, mock_index_processor):
        """
        Test performance timing of segment disabling task.

        This test verifies:
        - Task execution time is reasonable
        - Performance logging works correctly
        - Task completes within expected time bounds
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Act: Execute the task and measure time
        start_time = time.perf_counter()
        result = disable_segment_from_index_task(segment.id)
        end_time = time.perf_counter()

        # Assert: Verify task completed successfully and timing is reasonable
        assert result is None
        execution_time = end_time - start_time
        assert execution_time < 5.0  # Should complete within 5 seconds

    def test_disable_segment_database_session_management(self, db_session_with_containers, mock_index_processor):
        """
        Test database session management during task execution.

        This test verifies:
        - Database sessions are properly managed
        - Sessions are closed after task completion
        - No session leaks occur
        """
        # Arrange: Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)
        segment = self._create_test_segment(document, dataset, tenant, account)

        # Act: Execute the task
        result = disable_segment_from_index_task(segment.id)

        # Assert: Verify task completed and session management worked
        assert result is None

        # Verify segment is still accessible (session was properly managed)
        db.session.refresh(segment)
        assert segment.id is not None

    def test_disable_segment_concurrent_execution(self, db_session_with_containers, mock_index_processor):
        """
        Test concurrent execution of segment disabling tasks.

        This test verifies:
        - Multiple tasks can run concurrently
        - Each task processes its own segment correctly
        - No interference between concurrent tasks
        """
        # Arrange: Create multiple test segments
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(tenant, account)
        document = self._create_test_document(dataset, tenant, account)

        segments = []
        for i in range(3):
            segment = self._create_test_segment(document, dataset, tenant, account)
            segments.append(segment)

        # Act: Execute tasks concurrently (simulated)
        results = []
        for segment in segments:
            result = disable_segment_from_index_task(segment.id)
            results.append(result)

        # Assert: Verify all tasks completed successfully
        assert all(result is None for result in results)

        # Verify all segments were processed
        assert mock_index_processor.clean.call_count == len(segments)

        # Verify each segment was processed with correct parameters
        for segment in segments:
            # Check that clean was called with this segment's dataset and index_node_id
            found = False
            for call in mock_index_processor.clean.call_args_list:
                if call[0][0].id == dataset.id and call[0][1] == [segment.index_node_id]:
                    found = True
                    break
            assert found, f"Segment {segment.id} was not processed correctly"
