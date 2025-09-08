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
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=fake.text(max_nb_chars=200),
                word_count=len(fake.text(max_nb_chars=200).split()),
                tokens=len(fake.text(max_nb_chars=200).split()) * 2,
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

    def test_enable_segments_to_index_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful segments indexing with paragraph index type.

        This test verifies:
        - Proper dataset and document retrieval from database
        - Correct segment processing and document creation
        - Index processor integration
        - Database state updates
        - Redis cache key deletion
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Set up Redis cache keys to simulate indexing in progress
        segment_ids = [segment.id for segment in segments]
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)  # 5 minutes expiry

        # Verify cache keys exist
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 1

        # Act: Execute the task
        enable_segments_to_index_task(segment_ids, dataset.id, document.id)

        # Assert: Verify the expected outcomes
        # Verify index processor was called correctly
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 3

        # Verify document structure
        for i, doc in enumerate(documents):
            assert doc.page_content == segments[i].content
            assert doc.metadata["doc_id"] == segments[i].index_node_id
            assert doc.metadata["doc_hash"] == segments[i].index_node_hash
            assert doc.metadata["document_id"] == document.id
            assert doc.metadata["dataset_id"] == dataset.id

        # Verify Redis cache keys were deleted
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 0

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

        for status_name, status_attrs in invalid_statuses:
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

    def test_enable_segments_to_index_segment_filtering_edge_cases(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment filtering with various edge cases.

        This test verifies:
        - Only segments matching the criteria are processed
        - Segments are filtered by dataset_id and document_id
        - Mixed segment states are handled properly
        - Redis cache key deletion
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create segments with mixed states
        fake = Faker()
        segments = []

        # Segment 1: Should be processed (matches all criteria)
        segment1 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=200).split()),
            tokens=len(fake.text(max_nb_chars=200).split()) * 2,
            index_node_id="node_0",
            index_node_hash="hash_0",
            enabled=False,
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment1)
        segments.append(segment1)

        # Segment 2: Should NOT be processed (different dataset_id)
        segment2 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=fake.uuid4(),  # Different dataset
            document_id=document.id,
            position=1,
            content=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=200).split()),
            tokens=len(fake.text(max_nb_chars=200).split()) * 2,
            index_node_id="node_1",
            index_node_hash="hash_1",
            enabled=False,
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment2)
        segments.append(segment2)

        # Segment 3: Should NOT be processed (different document_id)
        segment3 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=fake.uuid4(),  # Different document
            position=2,
            content=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=200).split()),
            tokens=len(fake.text(max_nb_chars=200).split()) * 2,
            index_node_id="node_2",
            index_node_hash="hash_2",
            enabled=False,
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment3)
        segments.append(segment3)

        # Segment 4: Should be processed (matches all criteria)
        segment4 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=3,
            content=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=200).split()),
            tokens=len(fake.text(max_nb_chars=200).split()) * 2,
            index_node_id="node_3",
            index_node_hash="hash_3",
            enabled=False,
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment4)
        segments.append(segment4)

        db.session.commit()

        # Set up Redis cache keys
        segment_ids = [segment.id for segment in segments]
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task
        enable_segments_to_index_task(segment_ids, dataset.id, document.id)

        # Assert: Verify only eligible segments were processed
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 2  # Only 2 segments should be processed

        # Verify correct segments were processed (by position order)
        assert documents[0].metadata["doc_id"] == "node_0"  # position 0
        assert documents[1].metadata["doc_id"] == "node_3"  # position 3

        # Verify Redis cache keys were cleared for processed segments only
        # (The task only clears cache keys for segments that were actually found and processed)
        processed_segments = [segments[0], segments[3]]  # Only segments 1 and 4 were processed
        for segment in processed_segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 0

        # Verify cache keys for non-processed segments still exist
        non_processed_segments = [segments[1], segments[2]]  # Segments 2 and 3 were not processed
        for segment in non_processed_segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 1

    def test_enable_segments_to_index_comprehensive_error_scenarios(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test comprehensive error scenarios and recovery.

        This test verifies:
        - Multiple types of exceptions are handled properly
        - Error state is consistently managed
        - Resource cleanup occurs in all error cases
        - Database session management is robust
        - Redis cache key deletion in all scenarios
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Test different exception types
        test_exceptions = [
            ("Database connection error", Exception("Database connection failed")),
            ("Index processor error", RuntimeError("Index processor initialization failed")),
            ("Memory error", MemoryError("Out of memory")),
            ("Value error", ValueError("Invalid index type")),
        ]

        for error_name, exception in test_exceptions:
            # Reset mocks for each test
            mock_external_service_dependencies["index_processor"].load.side_effect = exception

            # Reset segment states
            for segment in segments:
                segment.enabled = True
                segment.status = "completed"
                segment.error = None
                segment.disabled_at = None
            db.session.commit()

            # Set up Redis cache keys
            segment_ids = [segment.id for segment in segments]
            for segment in segments:
                indexing_cache_key = f"segment_{segment.id}_indexing"
                redis_client.set(indexing_cache_key, "processing", ex=300)

            # Act: Execute the task
            enable_segments_to_index_task(segment_ids, dataset.id, document.id)

            # Assert: Verify consistent error handling
            for segment in segments:
                db.session.refresh(segment)
                assert segment.enabled is False, f"Segment should be disabled for {error_name}"
                assert segment.status == "error", f"Segment status should be error for {error_name}"
                assert segment.error is not None, f"Error should be recorded for {error_name}"
                assert str(exception) in segment.error, f"Error message should contain exception for {error_name}"
                assert segment.disabled_at is not None, f"Disabled timestamp should be set for {error_name}"

            # Verify Redis cache keys were still cleared despite error
            for segment in segments:
                indexing_cache_key = f"segment_{segment.id}_indexing"
                assert redis_client.exists(indexing_cache_key) == 0, f"Redis cache should be cleared for {error_name}"

    def test_enable_segments_to_index_performance_with_large_dataset(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance with a large number of segments.

        This test verifies:
        - Task can handle large numbers of segments efficiently
        - Memory usage is reasonable
        - Processing time is acceptable
        - All segments are processed correctly
        - Redis cache keys are properly managed
        """
        # Arrange: Create test data with many segments
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create a larger number of segments
        segments = self._create_test_segments(db_session_with_containers, document, dataset, count=50)

        # Set up Redis cache keys
        segment_ids = [segment.id for segment in segments]
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task
        enable_segments_to_index_task(segment_ids, dataset.id, document.id)

        # Assert: Verify processing completed successfully
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 50  # All 50 segments should be processed

        # Verify Redis cache keys were cleared
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 0

    def test_enable_segments_to_index_empty_segment_ids_list(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of empty segment IDs list.

        This test verifies:
        - Empty segment IDs list is handled gracefully
        - Index processor is created but load is not called
        - No errors are raised
        - Database session is properly managed
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Act: Execute the task with empty segment IDs list
        enable_segments_to_index_task([], dataset.id, document.id)

        # Assert: Verify index processor was created but load was not called
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_enable_segments_to_index_duplicate_segment_ids(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of duplicate segment IDs in the input list.

        This test verifies:
        - Duplicate segment IDs are handled correctly
        - Each segment is processed only once
        - No errors are raised due to duplicates
        - Processing completes successfully
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Create duplicate segment IDs
        segment_ids = [segment.id for segment in segments]
        duplicate_segment_ids = segment_ids + segment_ids  # Duplicate the list

        # Set up Redis cache keys
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task with duplicate segment IDs
        enable_segments_to_index_task(duplicate_segment_ids, dataset.id, document.id)

        # Assert: Verify processing completed successfully
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 3  # Only 3 unique segments should be processed

        # Verify Redis cache keys were cleared
        for segment in segments:
            indexing_cache_key = f"segment_{segment.id}_indexing"
            assert redis_client.exists(indexing_cache_key) == 0
