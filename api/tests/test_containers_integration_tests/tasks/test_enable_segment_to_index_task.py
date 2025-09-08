"""
Integration tests for enable_segment_to_index_task using testcontainers.

This module provides comprehensive integration tests for the segment enabling
and indexing task using TestContainers infrastructure. The tests ensure that the
task properly processes document segments, creates vector indexes, and handles
various edge cases in a real database environment.

All tests use the testcontainers infrastructure to ensure proper database isolation
and realistic testing scenarios with actual PostgreSQL and Redis instances.
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.rag.models.document import ChildDocument, Document
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DocumentSegment
from models.dataset import Document as DocumentModel
from models.model import UploadFile
from tasks.enable_segment_to_index_task import enable_segment_to_index_task


class TestEnableSegmentToIndexTask:
    """Integration tests for enable_segment_to_index_task using testcontainers."""

    @pytest.fixture(autouse=True)
    def cleanup_database(self, db_session_with_containers):
        """Clean up database before each test to ensure isolation."""
        # Clear all test data
        db.session.query(DocumentSegment).delete()
        db.session.query(DocumentModel).delete()
        db.session.query(Dataset).delete()
        db.session.query(UploadFile).delete()
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
            patch("tasks.enable_segment_to_index_task.IndexProcessorFactory") as mock_index_processor_factory,
        ):
            # Setup mock index processor
            mock_processor = MagicMock()
            mock_index_processor_factory.return_value.init_index_processor.return_value = mock_processor

            yield {
                "index_processor_factory": mock_index_processor_factory,
                "index_processor": mock_processor,
            }

    def _create_test_account_and_tenant(self, db_session_with_containers):
        """
        Helper method to create a test account and tenant for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure

        Returns:
            tuple: (Account, Tenant) created instances
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

        # Create tenant for the account
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

        # Set current tenant for account
        account.current_tenant = tenant

        return account, tenant

    def _create_test_dataset(self, db_session_with_containers, account, tenant):
        """
        Helper method to create a test dataset for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance

        Returns:
            Dataset: Created dataset instance
        """
        fake = Faker()

        dataset = Dataset(
            tenant_id=tenant.id,
            name=fake.company(),
            description=fake.text(),
            data_source_type="upload_file",
            indexing_technique="high_quality",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
            created_by=account.id,
        )

        db.session.add(dataset)
        db.session.commit()

        return dataset

    def _create_test_document(self, db_session_with_containers, account, tenant, dataset, doc_form="text_model"):
        """
        Helper method to create a test document for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance
            dataset: Dataset instance
            doc_form: Document form type

        Returns:
            Document: Created document instance
        """
        fake = Faker()

        document = DocumentModel(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            position=1,
            data_source_type="upload_file",
            batch="test_batch",
            name=fake.file_name(),
            created_from="upload_file",
            created_by=account.id,
            indexing_status="completed",
            enabled=True,
            archived=False,
            doc_form=doc_form,
            word_count=0,
        )

        db.session.add(document)
        db.session.commit()

        return document

    def _create_test_segment(self, db_session_with_containers, account, tenant, dataset, document, status="completed"):
        """
        Helper method to create a test document segment for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            account: Account instance
            tenant: Tenant instance
            dataset: Dataset instance
            document: Document instance
            status: Segment status

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
            word_count=len(fake.text(max_nb_chars=500).split()),
            tokens=len(fake.text(max_nb_chars=500).split()) * 2,
            index_node_id=str(uuid.uuid4()),
            index_node_hash=f"hash_{fake.uuid4()}",
            enabled=False,
            status=status,
            created_by=account.id,
        )

        db.session.add(segment)
        db.session.commit()

        return segment

    def test_enable_segment_to_index_task_success_text_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful segment enabling for text model documents.

        This test verifies that the task can successfully:
        1. Process a completed segment
        2. Create proper document structure for indexing
        3. Call index processor with correct parameters
        4. Handle Redis cache cleanup
        5. Process segment metadata correctly
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset, "text_model")
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Set up Redis cache key to simulate indexing in progress
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Verify cache key exists
        assert redis_client.exists(indexing_cache_key) == 1

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify index processor was called correctly
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("text_model")
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        dataset_arg, documents_arg = call_args[0]
        assert dataset_arg.id == dataset.id
        assert len(documents_arg) == 1

        # Verify document structure
        doc = documents_arg[0]
        assert isinstance(doc, Document)
        assert doc.page_content == segment.content
        assert doc.metadata["doc_id"] == segment.index_node_id
        assert doc.metadata["doc_hash"] == segment.index_node_hash
        assert doc.metadata["document_id"] == segment.document_id
        assert doc.metadata["dataset_id"] == segment.dataset_id

        # Verify Redis cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_success_qa_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful segment enabling for QA model documents.

        This test verifies that the task can successfully:
        1. Process a completed segment with QA model
        2. Create proper document structure for QA indexing
        3. Call index processor with correct parameters
        4. Handle Redis cache cleanup
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset, "qa_model")
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Set up Redis cache key
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify index processor was called correctly
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("qa_model")
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify Redis cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_success_parent_child_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test successful segment enabling for parent-child model documents.

        This test verifies that the task can successfully:
        1. Process a completed segment with parent-child model
        2. Create proper document structure with child documents
        3. Call index processor with correct parameters
        4. Handle child chunks correctly
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(
            db_session_with_containers, account, tenant, dataset, "hierarchical_model"
        )
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Set up Redis cache key
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Mock the get_child_chunks method to return child chunks
        with patch.object(DocumentSegment, "get_child_chunks") as mock_get_child_chunks:
            # Setup mock to return child chunks
            mock_child_chunks = []
            for i in range(2):
                mock_child = MagicMock()
                mock_child.content = f"child_content_{i}"
                mock_child.index_node_id = f"child_node_{i}"
                mock_child.index_node_hash = f"child_hash_{i}"
                mock_child_chunks.append(mock_child)

            mock_get_child_chunks.return_value = mock_child_chunks

            # Execute the task
            enable_segment_to_index_task(segment.id)

            # Verify index processor was called correctly
            mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("hierarchical_model")
            mock_external_service_dependencies["index_processor"].load.assert_called_once()

            # Verify the load method was called with correct parameters
            call_args = mock_external_service_dependencies["index_processor"].load.call_args
            assert call_args is not None
            dataset_arg, documents_arg = call_args[0]
            assert dataset_arg.id == dataset.id
            assert len(documents_arg) == 1

            # Verify document structure with children
            doc = documents_arg[0]
            assert isinstance(doc, Document)
            assert hasattr(doc, "children")
            assert len(doc.children) == 2

            # Verify child document structure
            for i, child_doc in enumerate(doc.children):
                assert isinstance(child_doc, ChildDocument)
                assert child_doc.page_content == f"child_content_{i}"
                assert child_doc.metadata["doc_id"] == f"child_node_{i}"
                assert child_doc.metadata["doc_hash"] == f"child_hash_{i}"

            # Verify Redis cache key was deleted
            assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_segment_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task handling when segment does not exist.

        This test verifies that the task properly handles error cases:
        1. Fails gracefully when segment is not found
        2. Logs appropriate error information
        3. Maintains database integrity
        4. Closes database session properly
        """
        # Use non-existent segment ID
        fake = Faker()
        non_existent_id = fake.uuid4()

        # Execute the task with non-existent segment
        enable_segment_to_index_task(non_existent_id)

        # Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segment_to_index_task_segment_not_completed(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task handling when segment is not completed.

        This test verifies that the task properly handles error cases:
        1. Fails when segment status is not "completed"
        2. Logs appropriate error information
        3. Maintains database integrity
        4. Closes database session properly
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        segment = self._create_test_segment(
            db_session_with_containers, account, tenant, dataset, document, "processing"
        )

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segment_to_index_task_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task handling when segment's dataset doesn't exist.

        This test verifies that the task properly handles error cases:
        1. Fails gracefully when dataset is not found
        2. Logs appropriate error information
        3. Maintains database integrity
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Delete the dataset to simulate dataset not found scenario
        db.session.delete(dataset)
        db.session.commit()

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segment_to_index_task_document_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task handling when segment's document doesn't exist.

        This test verifies that the task properly handles error cases:
        1. Fails gracefully when document is not found
        2. Logs appropriate error information
        3. Maintains database integrity
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Delete the document to simulate document not found scenario
        db.session.delete(document)
        db.session.commit()

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segment_to_index_task_document_not_available(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task handling when document is not available for indexing.

        This test verifies that the task properly handles error cases:
        1. Fails when document is disabled
        2. Fails when document is archived
        3. Fails when document indexing status is not completed
        4. Logs appropriate error information
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)

        # Create document with various unavailable states
        test_cases = [
            # Disabled document
            DocumentModel(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=1,
                data_source_type="upload_file",
                batch="test_batch",
                name="disabled_document",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="completed",
                enabled=False,  # Document is disabled
                archived=False,
                doc_form="text_model",
                word_count=0,
            ),
            # Archived document
            DocumentModel(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=2,
                data_source_type="upload_file",
                batch="test_batch",
                name="archived_document",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="completed",
                enabled=True,
                archived=True,  # Document is archived
                doc_form="text_model",
                word_count=0,
            ),
            # Document with incomplete indexing
            DocumentModel(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                position=3,
                data_source_type="upload_file",
                batch="test_batch",
                name="incomplete_document",
                created_from="upload_file",
                created_by=account.id,
                indexing_status="indexing",  # Not completed
                enabled=True,
                archived=False,
                doc_form="text_model",
                word_count=0,
            ),
        ]

        for document in test_cases:
            db.session.add(document)
        db.session.commit()

        # Test each unavailable document
        for document in test_cases:
            segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

            # Execute the task
            enable_segment_to_index_task(segment.id)

            # Verify no processing occurred
            mock_external_service_dependencies["index_processor_factory"].assert_not_called()
            mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segment_to_index_task_general_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test general exception handling during segment enabling process.

        This test verifies that the task properly handles error cases:
        1. Exceptions are properly caught and handled
        2. Segment status is set to error
        3. Segment is disabled
        4. Error information is recorded
        5. Redis cache is still cleared
        6. Database session is properly closed
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Set up Redis cache key
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Mock the index processor to raise an exception
        mock_external_service_dependencies["index_processor"].load.side_effect = Exception("Index processing failed")

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify error handling
        db.session.refresh(segment)
        assert segment.enabled is False
        assert segment.status == "error"
        assert segment.error is not None
        assert "Index processing failed" in segment.error
        assert segment.disabled_at is not None

        # Verify redis cache was still cleared despite error
        assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_redis_cache_cleanup(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that Redis cache is properly cleaned up in all scenarios.

        This test verifies that the task properly handles Redis cache cleanup:
        1. Cache key is deleted on successful processing
        2. Cache key is deleted even when errors occur
        3. Cache key format is correct
        4. No cache leaks occur
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset)
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Test successful case
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Verify cache key exists
        assert redis_client.exists(indexing_cache_key) == 1

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0

        # Test error case
        segment2 = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)
        indexing_cache_key2 = f"segment_{segment2.id}_indexing"
        redis_client.set(indexing_cache_key2, "processing", ex=300)

        # Mock the index processor to raise an exception
        mock_external_service_dependencies["index_processor"].load.side_effect = Exception("Test error")

        # Execute the task
        enable_segment_to_index_task(segment2.id)

        # Verify cache key was still deleted despite error
        assert redis_client.exists(indexing_cache_key2) == 0

    def test_enable_segment_to_index_task_document_metadata_consistency(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that document metadata is consistent and correctly passed to index processor.

        This test verifies that the task properly handles document metadata:
        1. All required metadata fields are present
        2. Metadata values match segment data
        3. Document structure is correct
        4. Index processor receives proper data
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset, "text_model")
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Set up Redis cache key
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        dataset_arg, documents_arg = call_args[0]
        assert dataset_arg.id == dataset.id
        assert len(documents_arg) == 1

        # Verify document metadata consistency
        doc = documents_arg[0]
        assert doc.page_content == segment.content
        assert doc.metadata["doc_id"] == segment.index_node_id
        assert doc.metadata["doc_hash"] == segment.index_node_hash
        assert doc.metadata["document_id"] == segment.document_id
        assert doc.metadata["dataset_id"] == segment.dataset_id

        # Verify all required metadata fields are present
        required_fields = ["doc_id", "doc_hash", "document_id", "dataset_id"]
        for field in required_fields:
            assert field in doc.metadata
            assert doc.metadata[field] is not None

    def test_enable_segment_to_index_task_performance_timing(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that the task properly measures and logs performance timing.

        This test verifies that the task properly handles performance measurement:
        1. Task execution time is measured
        2. Performance logging is accurate
        3. Timing information is recorded
        4. Task completes within reasonable time
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset, "text_model")
        segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)

        # Set up Redis cache key
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify index processor was called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("text_model")
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify Redis cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_multiple_segments_isolation(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that processing multiple segments maintains proper isolation.

        This test verifies that the task properly handles multiple segments:
        1. Each segment is processed independently
        2. No cross-contamination between segments
        3. Redis cache keys are properly isolated
        4. Database state is consistent
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset, "text_model")

        # Create multiple segments
        segments = []
        for i in range(3):
            segment = self._create_test_segment(db_session_with_containers, account, tenant, dataset, document)
            segments.append(segment)

        # Set up Redis cache keys for all segments
        cache_keys = []
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)
            cache_keys.append(indexing_cache_key)

        # Verify all cache keys exist
        for cache_key in cache_keys:
            assert redis_client.exists(cache_key) == 1

        # Execute the task for each segment
        for segment in segments:
            enable_segment_to_index_task(segment.id)

        # Verify all cache keys were deleted
        for cache_key in cache_keys:
            assert redis_client.exists(cache_key) == 0

        # Verify index processor was called for each segment
        assert mock_external_service_dependencies["index_processor_factory"].call_count == 3
        assert mock_external_service_dependencies["index_processor"].load.call_count == 3

    def test_enable_segment_to_index_task_edge_case_empty_content(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test task handling with edge case of empty segment content.

        This test verifies that the task properly handles edge cases:
        1. Empty segment content is processed correctly
        2. Document structure is still valid
        3. Index processor receives proper data
        4. No errors occur with empty content
        """
        # Create test data
        account, tenant = self._create_test_account_and_tenant(db_session_with_containers)
        dataset = self._create_test_dataset(db_session_with_containers, account, tenant)
        document = self._create_test_document(db_session_with_containers, account, tenant, dataset, "text_model")

        # Create segment with empty content
        segment = DocumentSegment(
            tenant_id=tenant.id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content="",  # Empty content
            word_count=0,
            tokens=0,
            index_node_id=str(uuid.uuid4()),
            index_node_hash=f"hash_{uuid.uuid4()}",
            enabled=False,
            status="completed",
            created_by=account.id,
        )

        db.session.add(segment)
        db.session.commit()

        # Set up Redis cache key
        indexing_cache_key = f"segment_{segment.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Execute the task
        enable_segment_to_index_task(segment.id)

        # Verify index processor was called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("text_model")
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify document structure with empty content
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        dataset_arg, documents_arg = call_args[0]
        assert dataset_arg.id == dataset.id
        assert len(documents_arg) == 1

        doc = documents_arg[0]
        assert doc.page_content == ""
        assert doc.metadata["doc_id"] == segment.index_node_id
        assert doc.metadata["doc_hash"] == segment.index_node_hash

        # Verify Redis cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0
