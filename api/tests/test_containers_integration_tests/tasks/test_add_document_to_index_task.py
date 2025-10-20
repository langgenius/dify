from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.rag.index_processor.constant.index_type import IndexType
from extensions.ext_database import db
from extensions.ext_redis import redis_client
from models import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetAutoDisableLog, Document, DocumentSegment
from tasks.add_document_to_index_task import add_document_to_index_task


class TestAddDocumentToIndexTask:
    """Integration tests for add_document_to_index_task using testcontainers."""

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.add_document_to_index_task.IndexProcessorFactory") as mock_index_processor_factory,
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

    def _create_test_segments(self, db_session_with_containers, document, dataset):
        """
        Helper method to create test document segments.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            document: Document instance
            dataset: Dataset instance

        Returns:
            list: List of created DocumentSegment instances
        """
        fake = Faker()
        segments = []

        for i in range(3):
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
                enabled=False,
                status="completed",
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()
        return segments

    def test_add_document_to_index_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful document indexing with paragraph index type.

        This test verifies:
        - Proper document retrieval from database
        - Correct segment processing and document creation
        - Index processor integration
        - Database state updates
        - Segment status changes
        - Redis cache key deletion
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Set up Redis cache key to simulate indexing in progress
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)  # 5 minutes expiry

        # Verify cache key exists
        assert redis_client.exists(indexing_cache_key) == 1

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify the expected outcomes
        # Verify index processor was called correctly
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify database state changes
        db.session.refresh(document)
        for segment in segments:
            db.session.refresh(segment)
            assert segment.enabled is True
            assert segment.disabled_at is None
            assert segment.disabled_by is None

        # Verify Redis cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_with_different_index_type(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing with different index types.

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

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify different index type handling
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.QA_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with correct parameters
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 3

        # Verify database state changes
        db.session.refresh(document)
        for segment in segments:
            db.session.refresh(segment)
            assert segment.enabled is True
            assert segment.disabled_at is None
            assert segment.disabled_by is None

        # Verify Redis cache key was deleted
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_document_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of non-existent document.

        This test verifies:
        - Proper error handling for missing documents
        - Early return without processing
        - Database session cleanup
        - No unnecessary index processor calls
        - Redis cache key not affected (since it was never created)
        """
        # Arrange: Use non-existent document ID
        fake = Faker()
        non_existent_id = fake.uuid4()

        # Act: Execute the task with non-existent document
        add_document_to_index_task(non_existent_id)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

        # Note: redis_client.delete is not called when document is not found
        # because indexing_cache_key is not defined in that case

    def test_add_document_to_index_invalid_indexing_status(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of document with invalid indexing status.

        This test verifies:
        - Early return when indexing_status is not "completed"
        - No index processing for documents not ready for indexing
        - Proper database session cleanup
        - No unnecessary external service calls
        - Redis cache key not affected
        """
        # Arrange: Create test data with invalid indexing status
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Set invalid indexing status
        document.indexing_status = "processing"
        db.session.commit()

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

    def test_add_document_to_index_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when document's dataset doesn't exist.

        This test verifies:
        - Proper error handling when dataset is missing
        - Document status is set to error
        - Document is disabled
        - Error information is recorded
        - Redis cache is cleared despite error
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Delete the dataset to simulate dataset not found scenario
        db.session.delete(dataset)
        db.session.commit()

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify error handling
        db.session.refresh(document)
        assert document.enabled is False
        assert document.indexing_status == "error"
        assert document.error is not None
        assert "doesn't exist" in document.error
        assert document.disabled_at is not None

        # Verify no index processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].load.assert_not_called()

        # Verify redis cache was cleared despite error
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_with_parent_child_structure(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing with parent-child structure.

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

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
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
            add_document_to_index_task(document.id)

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

            # Verify database state changes
            db.session.refresh(document)
            for segment in segments:
                db.session.refresh(segment)
                assert segment.enabled is True
                assert segment.disabled_at is None
                assert segment.disabled_by is None

            # Verify redis cache was cleared
            assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_with_no_segments_to_process(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing when no segments need processing.

        This test verifies:
        - Proper handling when all segments are already enabled
        - Index processing still occurs but with empty documents list
        - Auto disable log deletion still occurs
        - Redis cache is cleared
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create segments that are already enabled
        fake = Faker()
        segments = []
        for i in range(3):
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
                enabled=True,  # Already enabled
                status="completed",
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify index processing occurred but with empty documents list
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify the load method was called with empty documents list
        call_args = mock_external_service_dependencies["index_processor"].load.call_args
        assert call_args is not None
        documents = call_args[0][1]  # Second argument should be documents list
        assert len(documents) == 0  # No segments to process

        # Verify redis cache was cleared
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_auto_disable_log_deletion(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test that auto disable logs are properly deleted during indexing.

        This test verifies:
        - Auto disable log entries are deleted for the document
        - Database state is properly managed
        - Index processing continues normally
        - Redis cache key deletion
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Create some auto disable log entries
        fake = Faker()
        auto_disable_logs = []
        for i in range(2):
            log_entry = DatasetAutoDisableLog(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
            )
            db.session.add(log_entry)
            auto_disable_logs.append(log_entry)

        db.session.commit()

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Verify logs exist before processing
        existing_logs = (
            db.session.query(DatasetAutoDisableLog).where(DatasetAutoDisableLog.document_id == document.id).all()
        )
        assert len(existing_logs) == 2

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify auto disable logs were deleted
        remaining_logs = (
            db.session.query(DatasetAutoDisableLog).where(DatasetAutoDisableLog.document_id == document.id).all()
        )
        assert len(remaining_logs) == 0

        # Verify index processing occurred normally
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].load.assert_called_once()

        # Verify segments were enabled
        for segment in segments:
            db.session.refresh(segment)
            assert segment.enabled is True

        # Verify redis cache was cleared
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_general_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test general exception handling during indexing process.

        This test verifies:
        - Exceptions are properly caught and handled
        - Document status is set to error
        - Document is disabled
        - Error information is recorded
        - Redis cache is still cleared
        - Database session is properly closed
        """
        # Arrange: Create test data
        dataset, document = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Mock the index processor to raise an exception
        mock_external_service_dependencies["index_processor"].load.side_effect = Exception("Index processing failed")

        # Act: Execute the task
        add_document_to_index_task(document.id)

        # Assert: Verify error handling
        db.session.refresh(document)
        assert document.enabled is False
        assert document.indexing_status == "error"
        assert document.error is not None
        assert "Index processing failed" in document.error
        assert document.disabled_at is not None

        # Verify segments were not enabled due to error
        for segment in segments:
            db.session.refresh(segment)
            assert segment.enabled is False  # Should remain disabled due to error

        # Verify redis cache was still cleared despite error
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_segment_filtering_edge_cases(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test segment filtering with various edge cases.

        This test verifies:
        - Only segments with enabled=False and status="completed" are processed
        - Segments are ordered by position correctly
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

        # Segment 1: Should be processed (enabled=False, status="completed")
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

        # Segment 2: Should NOT be processed (enabled=True, status="completed")
        segment2 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=200).split()),
            tokens=len(fake.text(max_nb_chars=200).split()) * 2,
            index_node_id="node_1",
            index_node_hash="hash_1",
            enabled=True,  # Already enabled
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment2)
        segments.append(segment2)

        # Segment 3: Should NOT be processed (enabled=False, status="processing")
        segment3 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=2,
            content=fake.text(max_nb_chars=200),
            word_count=len(fake.text(max_nb_chars=200).split()),
            tokens=len(fake.text(max_nb_chars=200).split()) * 2,
            index_node_id="node_2",
            index_node_hash="hash_2",
            enabled=False,
            status="processing",  # Not completed
            created_by=document.created_by,
        )
        db.session.add(segment3)
        segments.append(segment3)

        # Segment 4: Should be processed (enabled=False, status="completed")
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

        # Set up Redis cache key
        indexing_cache_key = f"document_{document.id}_indexing"
        redis_client.set(indexing_cache_key, "processing", ex=300)

        # Act: Execute the task
        add_document_to_index_task(document.id)

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

        # Verify database state changes
        db.session.refresh(document)
        db.session.refresh(segment1)
        db.session.refresh(segment2)
        db.session.refresh(segment3)
        db.session.refresh(segment4)

        # All segments should be enabled because the task updates ALL segments for the document
        assert segment1.enabled is True
        assert segment2.enabled is True  # Was already enabled, now updated to True
        assert segment3.enabled is True  # Was not processed but still updated to True
        assert segment4.enabled is True

        # Verify redis cache was cleared
        assert redis_client.exists(indexing_cache_key) == 0

    def test_add_document_to_index_comprehensive_error_scenarios(
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

            # Reset document state
            document.enabled = True
            document.indexing_status = "completed"
            document.error = None
            document.disabled_at = None
            db.session.commit()

            # Set up Redis cache key
            indexing_cache_key = f"document_{document.id}_indexing"
            redis_client.set(indexing_cache_key, "processing", ex=300)

            # Act: Execute the task
            add_document_to_index_task(document.id)

            # Assert: Verify consistent error handling
            db.session.refresh(document)
            assert document.enabled is False, f"Document should be disabled for {error_name}"
            assert document.indexing_status == "error", f"Document status should be error for {error_name}"
            assert document.error is not None, f"Error should be recorded for {error_name}"
            assert str(exception) in document.error, f"Error message should contain exception for {error_name}"
            assert document.disabled_at is not None, f"Disabled timestamp should be set for {error_name}"

            # Verify segments remain disabled due to error
            for segment in segments:
                db.session.refresh(segment)
                assert segment.enabled is False, f"Segments should remain disabled for {error_name}"

            # Verify redis cache was still cleared despite error
            assert redis_client.exists(indexing_cache_key) == 0, f"Redis cache should be cleared for {error_name}"
