from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.rag.index_processor.constant.index_type import IndexType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, Document, DocumentSegment
from tasks.enable_segments_to_index_task import enable_segments_to_index_task


class TestEnableSegmentsToIndexTask:
    """Integration tests for enable_segments_to_index_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.enable_segments_to_index_task.IndexProcessorFactory") as mock_index_processor_factory,
        ):
            # Setup mock index processor
            mock_processor = MagicMock()
            mock_index_processor_factory.return_value.init_index_processor.return_value = mock_processor

            yield {
                "index_processor_factory": mock_index_processor_factory,
                "index_processor": mock_processor,
            }

    def _create_test_dataset_and_document(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test dataset and document for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (dataset, document) - Created dataset and document instances
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

        # Create document
        document = Document(
            id=fake.uuid4(),
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
            doc_form=IndexType.PARAGRAPH_INDEX,
        )
        db.session.add(document)
        db.session.commit()

        # Refresh dataset to ensure doc_form property works correctly
        db.session.refresh(dataset)

        return dataset, document

    def _create_test_segments(
        self, db_session_with_containers, document, dataset, count=3, enabled=False, status="completed"
    ):
        """
        Helper method to create test document segments.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            document: Document instance
            dataset: Dataset instance
            count: Number of segments to create
            enabled: Whether segments should be enabled
            status: Status of the segments

        Returns:
            list: List of created DocumentSegment instances
        """
        fake = Faker()
        segments = []

        for i in range(count):
            text = fake.text(max_nb_chars=200)
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=text,
                word_count=len(text.split()),
                tokens=len(text.split()) * 2,
                index_node_id=f"node_{i}",
                index_node_hash=f"hash_{i}",
                enabled=enabled,
                status=status,
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()
        return segments

    def test_enable_segments_to_index_with_different_index_type(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segments indexing with different index types.

        This test verifies:
        - Proper handling of different index types
        - Index processor factory integration
        - Document processing with various configurations
        - Redis cache key deletion
        """
        # Arrange: Create test data with different index type
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update document to use different index type
        document.doc_form = IndexType.QA_INDEX
        db.session.commit()

        # Refresh dataset to ensure doc_form property reflects the updated document
        db.session.refresh(dataset)

        # Create segments
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Set up Redis cache keys
        segment_ids = [segment.id for segment in segments]
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task
        enable_segments_to_index_task(segment_ids, dataset.id, document.id)

        # Assert: Verify different index type handling
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.QA_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 3

        # Verify Redis cache keys were deleted
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segments_to_index_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of non-existent dataset.

        This test verifies:
        - Proper error handling for missing datasets
        - Early return without processing
        - Database session cleanup
        - No unnecessary index processor calls
        """
        # Arrange: Use non-existent dataset ID
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        non_existent_document_id = fake.uuid4()
        segment_ids = [fake.uuid4()]

        # Act: Execute the task with non-existent dataset
        enable_segments_to_index_task(segment_ids, non_existent_dataset_id, non_existent_document_id)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segments_to_index_document_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of non-existent document.

        This test verifies:
        - Proper error handling for missing documents
        - Early return without processing
        - Database session cleanup
        - No unnecessary index processor calls
        """
        # Arrange: Create dataset but use non-existent document ID
        dataset, _ = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        fake = Faker()
        non_existent_document_id = fake.uuid4()
        segment_ids = [fake.uuid4()]

        # Act: Execute the task with non-existent document
        enable_segments_to_index_task(segment_ids, dataset.id, non_existent_document_id)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segments_to_index_invalid_document_status(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of document with invalid status.

        This test verifies:
        - Early return when document is disabled, archived, or not completed
        - No index processing for documents not ready for indexing
        - Proper database session cleanup
        - No unnecessary external service calls
        """
        # Arrange: Create test data with invalid document status
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Test different invalid statuses
        invalid_statuses = [
            ("disabled", {"enabled": False}),
            ("archived", {"archived": True}),
            ("not_completed", {"indexing_status": "processing"}),
        ]

        for _, status_attrs in invalid_statuses:
            # Reset document status
            document.enabled = True
            document.archived = False
            document.indexing_status = "completed"
            db.session.commit()

            # Set invalid status
            for attr, value in status_attrs.items():
                setattr(document, attr, value)
            db.session.commit()

            # Create segments
            segments = self._create_test_segments(db_session_with_containers, document, dataset)
            segment_ids = [segment.id for segment in segments]

            # Act: Execute the task
            enable_segments_to_index_task(segment_ids, dataset.id, document.id)

            # Assert: Verify no processing occurred
            mock_external_service_dependencies["index_processor_factory"].assert_not_called()
            mock_external_service_dependencies["index_processor"].load.assert_not_called()

            # Clean up segments for next iteration
            for segment in segments:
                db.session.delete(segment)
            db.session.commit()

    def test_enable_segments_to_index_segments_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when no segments are found.

        This test verifies:
        - Proper handling when segments don't exist
        - Early return without processing
        - Database session cleanup
        - Index processor is created but load is not called
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Use non-existent segment IDs
        fake = Faker()
        non_existent_segment_ids = [fake.uuid4() for _ in range(3)]

        # Act: Execute the task with non-existent segments
        enable_segments_to_index_task(non_existent_segment_ids, dataset.id, document.id)

        # Assert: Verify index processor was created but load was not called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segments_to_index_with_parent_child_structure(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segments indexing with parent-child structure.

        This test verifies:
        - Proper handling of PARENT_CHILD_INDEX type
        - Child document creation from segments
        - Correct document structure for parent-child indexing
        - Index processor receives properly structured documents
        - Redis cache key deletion
        """
        # Arrange: Create test data with parent-child index type
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update document to use parent-child index type
        document.doc_form = IndexType.PARENT_CHILD_INDEX
        db.session.commit()

        # Refresh dataset to ensure doc_form property reflects the updated document
        db.session.refresh(dataset)

        # Create segments with mock child chunks
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Set up Redis cache keys
        segment_ids = [segment.id for segment in segments]
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

        # Mock the get_child_chunks method for each segment
        with patch.object(DocumentSegment, "get_child_chunks") as mock_get_child_chunks:
            # Setup mock to return child chunks for each segment
            mock_child_chunks = []
            for i in range(2):  # Each segment has 2 child chunks
                mock_child = MagicMock()
                mock_child.content = f"child_content_{i}"
                mock_child.index_node_id = f"child_node_{i}"
                mock_child.index_node_hash = f"child_hash_{i}"
                mock_child_chunks.append(mock_child)

            mock_get_child_chunks.return_value = mock_child_chunks

            # Act: Execute the task
            enable_segments_to_index_task(segment_ids, dataset.id, document.id)

            # Assert: Verify parent-child index processing
            mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(
                IndexType.PARENT_CHILD_INDEX
            )
            mock_external_service_dependencies["index_processor"].load.assert_called_once()

            # Verify the load method was called with correct parameters
            call_args = mock_external_service_dependencies["index_processor"].load.call_args
            assert call_args is not None
            documents = call_args[0][1]  # Second argument should be documents list
            assert len(documents) == 3  # 3 segments

            # Verify each document has children
            for doc in documents:
                assert hasattr(doc, "children")
                assert len(doc.children) == 2  # Each document has 2 children

            # Verify Redis cache keys were deleted
            for segment in segments:
                indexing_cache_key = f"segment_{segment.id}_indexing"
                assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segments_to_index_general_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test general exception handling during indexing process.

        This test verifies:
        - Exceptions are properly caught and handled
        - Segment status is set to error
        - Segments are disabled
        - Error information is recorded
        - Redis cache is still cleared
        - Database session is properly closed
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Set up Redis cache keys
        segment_ids = [segment.id for segment in segments]
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

        # Mock the index processor to raise an exception
        mock_external_service_dependencies["index_processor"].load.side_effect = Exception("Index processing failed")

        # Act: Execute the task
        enable_segments_to_index_task(segment_ids, dataset.id, document.id)

        # Assert: Verify error handling
        for segment in segments:
            db.session.refresh(segment)
            assert segment.enabled is False
            assert segment.status == "error"
            assert segment.error is not None
            assert "Index processing failed" in segment.error
            assert segment.disabled_at is not None

        # Verify Redis cache keys were still cleared despite error
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 0
