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
        """Test successful segment enabling for text model documents."""
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

        # Verify index processor was called and Redis cache was cleared
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("text_model")
        mock_external_service_dependencies["index_processor"].load.assert_called_once()
        assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_success_qa_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test successful segment enabling for QA model documents."""
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

        # Verify index processor was called and Redis cache was cleared
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("qa_model")
        mock_external_service_dependencies["index_processor"].load.assert_called_once()
        assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_success_parent_child_model(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test successful segment enabling for parent-child model documents."""
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

            # Verify index processor was called and Redis cache was cleared
            mock_external_service_dependencies["index_processor_factory"].assert_called_once_with("hierarchical_model")
            mock_external_service_dependencies["index_processor"].load.assert_called_once()
            assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segment_to_index_task_segment_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """Test task handling when segment does not exist."""
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
        """Test task handling when segment is not completed."""
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
        """Test task handling when segment's dataset doesn't exist."""
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
        """Test task handling when segment's document doesn't exist."""
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
        """Test task handling when document is not available for indexing."""
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
        """Test general exception handling during segment enabling process."""
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


