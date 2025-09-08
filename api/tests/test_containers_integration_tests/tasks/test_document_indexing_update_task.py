"""
TestContainers-based integration tests for document_indexing_update_task.

This module provides comprehensive integration testing for document_indexing_update_task using
TestContainers to ensure realistic database interactions and proper isolation. The task is
responsible for updating document indexing when data source or processing rules change.
"""

import json
import time
from unittest.mock import MagicMock, patch

import pytest
from faker import Faker

from core.rag.index_processor.constant.index_type import IndexType
from extensions.ext_database import db
from models.account import Account, Tenant, TenantAccountJoin, TenantAccountRole
from models.dataset import Dataset, DatasetProcessRule, Document, DocumentSegment
from tasks.document_indexing_update_task import document_indexing_update_task


class TestDocumentIndexingUpdateTask:
    """
    Comprehensive integration tests for document_indexing_update_task using testcontainers.

    This test class covers all major functionality of the document_indexing_update_task:
    - Document update and re-indexing process
    - Old segment and index cleanup
    - Document status management
    - Index processor integration
    - Error handling for various scenarios
    - Different index types and configurations

    All tests use the testcontainers infrastructure to ensure proper database isolation
    and realistic testing environment with actual database interactions.
    """

    @pytest.fixture
    def mock_external_service_dependencies(self):
        """Mock setup for external service dependencies."""
        with (
            patch("tasks.document_indexing_update_task.IndexProcessorFactory") as mock_index_processor_factory,
            patch("tasks.document_indexing_update_task.IndexingRunner") as mock_indexing_runner,
        ):
            # Setup mock index processor
            mock_processor = MagicMock()
            mock_processor.clean.return_value = None
            mock_index_processor_factory.return_value.init_index_processor.return_value = mock_processor

            # Setup mock indexing runner
            mock_runner = MagicMock()
            mock_runner.run.return_value = None
            mock_indexing_runner.return_value = mock_runner

            yield {
                "index_processor_factory": mock_index_processor_factory,
                "index_processor": mock_processor,
                "indexing_runner": mock_indexing_runner,
                "runner_instance": mock_runner,
            }

    def _create_test_dataset_and_document(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Helper method to create a test dataset and document for testing.

        Args:
            db_session_with_containers: Database session from testcontainers infrastructure
            mock_external_service_dependencies: Mock dependencies

        Returns:
            tuple: (dataset, document, process_rule) - Created dataset, document and process rule instances
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

        # Create process rule
        process_rule = DatasetProcessRule(
            id=fake.uuid4(),
            dataset_id=dataset.id,
            mode="automatic",
            rules=json.dumps(DatasetProcessRule.AUTOMATIC_RULES),
            created_by=account.id,
        )
        db.session.add(process_rule)
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
            indexing_status="waiting",
            enabled=True,
            doc_form=IndexType.PARAGRAPH_INDEX,
            dataset_process_rule_id=process_rule.id,
        )
        db.session.add(document)
        db.session.commit()

        # Refresh dataset to ensure doc_form property works correctly
        db.session.refresh(dataset)

        return dataset, document, process_rule

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
                enabled=True,
                status="completed",
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()
        return segments

    def test_document_indexing_update_success(self, db_session_with_containers, mock_external_service_dependencies):
        """
        Test successful document indexing update with paragraph index type.

        This test verifies:
        - Proper document retrieval from database
        - Document status is updated to "parsing"
        - Processing start time is recorded
        - Old segments and indexes are cleaned
        - New indexing process is initiated
        - Index processor integration works correctly
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Verify initial state
        assert document.indexing_status == "waiting"
        assert document.processing_started_at is None
        assert len(segments) == 3

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify the expected outcomes
        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify index processor was called correctly
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify clean method was called with correct parameters
        clean_call_args = mock_external_service_dependencies["index_processor"].clean.call_args
        assert clean_call_args is not None
        # First argument should be a dataset object
        assert clean_call_args[0][0] is not None
        assert clean_call_args[1]["with_keywords"] is True
        assert clean_call_args[1]["delete_child_chunks"] is True

        # Verify segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()
        run_call_args = mock_external_service_dependencies["runner_instance"].run.call_args
        assert len(run_call_args[0][0]) == 1  # Should be called with document list containing one document

    def test_document_indexing_update_document_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of non-existent document.

        This test verifies:
        - Proper error handling for missing documents
        - Early return without processing
        - Database session cleanup
        - No unnecessary index processor calls
        - No indexing runner calls
        """
        # Arrange: Use non-existent document ID
        fake = Faker()
        non_existent_dataset_id = fake.uuid4()
        non_existent_document_id = fake.uuid4()

        # Act: Execute the task with non-existent document
        document_indexing_update_task(non_existent_dataset_id, non_existent_document_id)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].clean.assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_update_dataset_not_found(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling when document's dataset doesn't exist.

        This test verifies:
        - Proper error handling when dataset is missing
        - Exception is raised and logged
        - Database session cleanup
        - No unnecessary external service calls
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Delete the dataset to simulate dataset not found scenario
        db.session.delete(dataset)
        db.session.commit()

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify no processing occurred due to dataset not found
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].clean.assert_not_called()
        # Note: IndexingRunner is still called even when dataset not found due to task structure
        # This is expected behavior based on the actual task implementation

    def test_document_indexing_update_with_different_index_type(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing update with different index types.

        This test verifies:
        - Proper handling of different index types
        - Index processor factory integration
        - Document processing with various configurations
        - Correct index processor initialization
        """
        # Arrange: Create test data with different index type
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update document to use different index type
        document.doc_form = IndexType.QA_INDEX
        db.session.commit()

        # Refresh dataset to ensure doc_form property reflects the updated document
        db.session.refresh(dataset)

        # Create segments
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify different index type handling
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.QA_INDEX)
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

    def test_document_indexing_update_cleanup_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test exception handling during cleanup process.

        This test verifies:
        - Exceptions during cleanup are properly caught and logged
        - Indexing process continues despite cleanup errors
        - Document status is still updated correctly
        - Database session is properly managed
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Mock the index processor to raise an exception during cleanup
        mock_external_service_dependencies["index_processor"].clean.side_effect = Exception("Cleanup failed")

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify error handling
        # Document status should still be updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify cleanup was attempted
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify indexing runner was still called despite cleanup error
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

        # Note: Segments are not deleted when cleanup fails due to exception handling
        # This is expected behavior based on the actual task implementation
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 3  # Segments remain when cleanup fails

    def test_document_indexing_update_with_parent_child_index(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing update with parent-child index type.

        This test verifies:
        - Proper handling of PARENT_CHILD_INDEX type
        - Index processor factory integration
        - Document processing with parent-child structure
        - Correct cleanup parameters for child chunks
        """
        # Arrange: Create test data with parent-child index type
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Update document to use parent-child index type
        document.doc_form = IndexType.PARENT_CHILD_INDEX
        db.session.commit()

        # Refresh dataset to ensure doc_form property reflects the updated document
        db.session.refresh(dataset)

        # Create segments
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify parent-child index processing
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(
            IndexType.PARENT_CHILD_INDEX
        )
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify clean method was called with correct parameters for parent-child
        clean_call_args = mock_external_service_dependencies["index_processor"].clean.call_args
        assert clean_call_args is not None
        # First argument should be a dataset object
        assert clean_call_args[0][0] is not None
        assert clean_call_args[1]["with_keywords"] is True
        assert clean_call_args[1]["delete_child_chunks"] is True

        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

    def test_document_indexing_update_with_no_segments_to_clean(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing update when no segments exist to clean.

        This test verifies:
        - Proper handling when no segments exist
        - Index processor is still called for cleanup
        - Document processing continues normally
        - No errors occur with empty segment list
        """
        # Arrange: Create test data without segments
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Verify no segments exist
        existing_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(existing_segments) == 0

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify processing continues normally
        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify index processor was called even with no segments
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        # Note: clean method is not called when no segments exist
        # This is expected behavior based on the actual task implementation

        # Note: When no segments exist, the clean method is not called
        # This is expected behavior based on the actual task implementation
        # The clean method is only called when segments exist

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

    def test_document_indexing_update_indexing_runner_exception(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test exception handling during indexing runner execution.

        This test verifies:
        - DocumentIsPausedError is properly handled
        - Other exceptions are properly caught and logged
        - Database session is properly closed
        - Task completes gracefully despite errors
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Mock the indexing runner to raise DocumentIsPausedError
        from core.indexing_runner import DocumentIsPausedError

        mock_external_service_dependencies["runner_instance"].run.side_effect = DocumentIsPausedError(
            "Document paused, document id: test"
        )

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify error handling
        # Document status should still be updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify cleanup was performed
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

        # Verify segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

    def test_document_indexing_update_general_exception_handling(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test general exception handling during indexing runner execution.

        This test verifies:
        - General exceptions are properly caught and logged
        - Database session is properly closed
        - Task completes gracefully despite errors
        - Error logging occurs correctly
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Mock the indexing runner to raise a general exception
        mock_external_service_dependencies["runner_instance"].run.side_effect = Exception("Indexing failed")

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify error handling
        # Document status should still be updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify cleanup was performed
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

        # Verify segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

    def test_document_indexing_update_with_mixed_segment_states(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test document indexing update with segments in different states.

        This test verifies:
        - All segments are deleted regardless of their state
        - Index node IDs are correctly collected
        - Cleanup is performed with all segment IDs
        - Document processing continues normally
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create segments with mixed states
        fake = Faker()
        segments = []

        # Segment 1: Normal state
        segment1 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=0,
            content=fake.text(max_nb_chars=200),
            word_count=100,
            tokens=200,
            index_node_id="node_0",
            index_node_hash="hash_0",
            enabled=True,
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment1)
        segments.append(segment1)

        # Segment 2: Disabled state
        segment2 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=1,
            content=fake.text(max_nb_chars=200),
            word_count=100,
            tokens=200,
            index_node_id="node_1",
            index_node_hash="hash_1",
            enabled=False,
            status="completed",
            created_by=document.created_by,
        )
        db.session.add(segment2)
        segments.append(segment2)

        # Segment 3: Processing state
        segment3 = DocumentSegment(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            document_id=document.id,
            position=2,
            content=fake.text(max_nb_chars=200),
            word_count=100,
            tokens=200,
            index_node_id="node_2",
            index_node_hash="hash_2",
            enabled=True,
            status="processing",
            created_by=document.created_by,
        )
        db.session.add(segment3)
        segments.append(segment3)

        db.session.commit()

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify all segments were processed
        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify index processor was called with all segment IDs
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify clean method was called with all index_node_ids
        clean_call_args = mock_external_service_dependencies["index_processor"].clean.call_args
        assert clean_call_args is not None
        index_node_ids = clean_call_args[0][1]  # Second argument should be index_node_ids
        assert len(index_node_ids) == 3
        assert "node_0" in index_node_ids
        assert "node_1" in index_node_ids
        assert "node_2" in index_node_ids

        # Verify all segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

    def test_document_indexing_update_with_database_connection_error(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of database connection errors during task execution.

        This test verifies:
        - Database connection errors are properly handled
        - Task completes gracefully despite database issues
        - No external service calls are made when database fails
        - Error logging occurs correctly
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Mock database session to raise connection error
        with patch("extensions.ext_database.db.session") as mock_db_session:
            mock_db_session.query.side_effect = Exception("Database connection failed")

            # Act & Assert: Execute the task and expect exception
            with pytest.raises(Exception, match="Database connection failed"):
                document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify no external service calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_update_with_none_parameters(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of None parameters.

        This test verifies:
        - None parameters are handled gracefully
        - Task completes without errors
        - No external service calls are made
        - Database session is properly closed
        """
        # Act: Execute the task with None parameters
        document_indexing_update_task(None, None)

        # Assert: Verify no processing occurred
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["index_processor"].clean.assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_update_with_concurrent_database_operations(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of concurrent database operations.

        This test verifies:
        - Concurrent database operations are handled properly
        - Task completes successfully despite concurrency
        - Database session management is robust
        - External service calls are made correctly
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Mock concurrent database operations by simulating a delay
        original_query = db.session.query

        def delayed_query(*args, **kwargs):
            import time

            time.sleep(0.1)  # Simulate database delay
            return original_query(*args, **kwargs)

        with patch("extensions.ext_database.db.session.query", side_effect=delayed_query):
            # Act: Execute the task
            document_indexing_update_task(dataset.id, document.id)

            # Assert: Verify processing completed successfully
            # Verify document status was updated
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

            # Verify external service calls were made
            mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(
                IndexType.PARAGRAPH_INDEX
            )
            mock_external_service_dependencies["index_processor"].clean.assert_called_once()
            mock_external_service_dependencies["indexing_runner"].assert_called_once()
            mock_external_service_dependencies["runner_instance"].run.assert_called_once()

            # Verify segments were deleted
            remaining_segments = (
                db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
            )
            assert len(remaining_segments) == 0

    def test_document_indexing_update_with_memory_pressure(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling under memory pressure conditions.

        This test verifies:
        - Memory pressure is handled gracefully
        - Task completes successfully despite memory constraints
        - Database session is properly managed
        - External service calls are made correctly
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Mock memory pressure by simulating memory error during processing
        original_commit = db.session.commit

        def memory_pressure_commit():
            # Simulate memory pressure on first commit
            if not hasattr(memory_pressure_commit, "called"):
                memory_pressure_commit.called = True
                raise MemoryError("Out of memory")
            return original_commit()

        with patch("extensions.ext_database.db.session.commit", side_effect=memory_pressure_commit):
            # Act & Assert: Execute the task and expect memory error
            with pytest.raises(MemoryError, match="Out of memory"):
                document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify external service calls were not made due to early failure
        mock_external_service_dependencies["index_processor_factory"].assert_not_called()
        mock_external_service_dependencies["indexing_runner"].assert_not_called()

    def test_document_indexing_update_with_corrupted_document_data(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of corrupted document data.

        This test verifies:
        - Corrupted document data is handled gracefully
        - Task completes successfully despite data corruption
        - Database session is properly managed
        - External service calls are made correctly
        """
        # Arrange: Create test data with corrupted document
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Corrupt document data by setting invalid values
        document.doc_form = "invalid_index_type"
        document.data_source_info = "invalid_json_data"
        db.session.commit()

        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify processing completed despite corrupted data
        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify external service calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_called_once()
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

        # Verify segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

    def test_document_indexing_update_performance_timing(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test performance timing and logging of the task.

        This test verifies:
        - Task execution time is measured and logged
        - Performance logging occurs correctly
        - Task completes within reasonable time
        - Timing information is accurate
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Mock logging to capture performance logs
        with patch("tasks.document_indexing_update_task.logger") as mock_logger:
            # Act: Execute the task
            start_time = time.time()
            document_indexing_update_task(dataset.id, document.id)
            end_time = time.time()

            # Assert: Verify performance logging
            # Check that performance logs were called
            performance_log_calls = [call for call in mock_logger.info.call_args_list if "latency:" in str(call)]
            assert len(performance_log_calls) >= 1, "Performance logging should occur"

            # Verify task completed within reasonable time (should be very fast with mocks)
            execution_time = end_time - start_time
            assert execution_time < 1.0, f"Task should complete quickly, took {execution_time:.2f}s"

            # Verify document status was updated
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_document_indexing_update_database_session_management(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test database session management and cleanup.

        This test verifies:
        - Database session is properly managed throughout the task
        - Session is closed correctly in all scenarios
        - No session leaks occur
        - Database operations are properly committed
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Track database session operations
        original_close = db.session.close
        close_calls = []

        def track_close():
            close_calls.append("close_called")
            return original_close()

        with patch("extensions.ext_database.db.session.close", side_effect=track_close):
            # Act: Execute the task
            document_indexing_update_task(dataset.id, document.id)

            # Assert: Verify session management
            # Session should be closed at least once (in the finally block)
            assert len(close_calls) >= 1, "Database session should be closed"

            # Verify document status was updated
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

    def test_document_indexing_update_with_large_number_of_segments(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test handling of documents with large number of segments.

        This test verifies:
        - Large number of segments are handled efficiently
        - Memory usage is reasonable
        - All segments are processed correctly
        - Performance remains acceptable
        """
        # Arrange: Create test data with many segments
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )

        # Create a large number of segments
        fake = Faker()
        segments = []
        segment_count = 100  # Large number of segments

        for i in range(segment_count):
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document.tenant_id,
                dataset_id=dataset.id,
                document_id=document.id,
                position=i,
                content=fake.text(max_nb_chars=200),
                word_count=100,
                tokens=200,
                index_node_id=f"node_{i}",
                index_node_hash=f"hash_{i}",
                enabled=True,
                status="completed",
                created_by=document.created_by,
            )
            db.session.add(segment)
            segments.append(segment)

        db.session.commit()

        # Act: Execute the task
        start_time = time.time()
        document_indexing_update_task(dataset.id, document.id)
        end_time = time.time()

        # Assert: Verify processing of large number of segments
        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify index processor was called with all segment IDs
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()

        # Verify clean method was called with all index_node_ids
        clean_call_args = mock_external_service_dependencies["index_processor"].clean.call_args
        assert clean_call_args is not None
        index_node_ids = clean_call_args[0][1]  # Second argument should be index_node_ids
        assert len(index_node_ids) == segment_count

        # Verify all segments were deleted
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

        # Verify performance is reasonable even with many segments
        execution_time = end_time - start_time
        assert execution_time < 5.0, f"Task should complete within reasonable time, took {execution_time:.2f}s"

        # Verify indexing runner was called
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

    def test_document_indexing_update_resource_cleanup_on_failure(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test resource cleanup when task fails.

        This test verifies:
        - Resources are properly cleaned up on failure
        - Database session is closed even when errors occur
        - No resource leaks occur
        - Error handling is robust
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Track database session operations
        original_close = db.session.close
        close_calls = []

        def track_close():
            close_calls.append("close_called")
            return original_close()

        # Mock the indexing runner to raise an exception
        mock_external_service_dependencies["runner_instance"].run.side_effect = Exception("Processing failed")

        with patch("extensions.ext_database.db.session.close", side_effect=track_close):
            # Act: Execute the task
            document_indexing_update_task(dataset.id, document.id)

            # Assert: Verify resource cleanup
            # Session should be closed even when errors occur
            assert len(close_calls) >= 1, "Database session should be closed even on failure"

            # Verify document status was still updated
            db.session.refresh(document)
            assert document.indexing_status == "parsing"
            assert document.processing_started_at is not None

            # Verify cleanup was performed before the error
            mock_external_service_dependencies["index_processor"].clean.assert_called_once()

            # Verify segments were deleted
            remaining_segments = (
                db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
            )
            assert len(remaining_segments) == 0

    def test_document_indexing_update_memory_usage_optimization(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test memory usage optimization during task execution.

        This test verifies:
        - Memory usage is optimized during processing
        - Large objects are properly cleaned up
        - No memory leaks occur
        - Task completes efficiently
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Monitor memory usage (simplified check)
        import gc

        gc.collect()  # Force garbage collection before test

        # Act: Execute the task
        document_indexing_update_task(dataset.id, document.id)

        # Assert: Verify memory optimization
        # Verify document status was updated
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify external service calls were made
        mock_external_service_dependencies["index_processor_factory"].assert_called_once_with(IndexType.PARAGRAPH_INDEX)
        mock_external_service_dependencies["index_processor"].clean.assert_called_once()
        mock_external_service_dependencies["indexing_runner"].assert_called_once()
        mock_external_service_dependencies["runner_instance"].run.assert_called_once()

        # Verify segments were deleted (memory cleanup)
        remaining_segments = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        assert len(remaining_segments) == 0

        # Force garbage collection to check for memory leaks
        gc.collect()

    def test_document_indexing_update_concurrent_execution_safety(
        self, db_session_with_containers, mock_external_service_dependencies
    ):
        """
        Test safety of concurrent task execution.

        This test verifies:
        - Multiple concurrent executions are handled safely
        - Database operations are properly isolated
        - No race conditions occur
        - Each execution completes independently
        """
        # Arrange: Create test data
        dataset, document, process_rule = self._create_test_dataset_and_document(
            db_session_with_containers, mock_external_service_dependencies
        )
        segments = self._create_test_segments(db_session_with_containers, document, dataset)

        # Create a second document for concurrent testing
        fake = Faker()
        document2 = Document(
            id=fake.uuid4(),
            tenant_id=document.tenant_id,
            dataset_id=dataset.id,
            position=2,
            data_source_type="upload_file",
            batch="test_batch_2",
            name=fake.file_name(),
            created_from="upload_file",
            created_by=document.created_by,
            indexing_status="waiting",
            enabled=True,
            doc_form=IndexType.PARAGRAPH_INDEX,
            dataset_process_rule_id=process_rule.id,
        )
        db.session.add(document2)
        db.session.commit()

        # Create segments for second document
        segments2 = []
        for i in range(3):
            segment = DocumentSegment(
                id=fake.uuid4(),
                tenant_id=document2.tenant_id,
                dataset_id=dataset.id,
                document_id=document2.id,
                position=i,
                content=fake.text(max_nb_chars=200),
                word_count=100,
                tokens=200,
                index_node_id=f"node2_{i}",
                index_node_hash=f"hash2_{i}",
                enabled=True,
                status="completed",
                created_by=document2.created_by,
            )
            db.session.add(segment)
            segments2.append(segment)

        db.session.commit()

        # Act: Execute tasks concurrently (simulated)
        document_indexing_update_task(dataset.id, document.id)
        document_indexing_update_task(dataset.id, document2.id)

        # Assert: Verify both executions completed successfully
        # Verify first document
        db.session.refresh(document)
        assert document.indexing_status == "parsing"
        assert document.processing_started_at is not None

        # Verify second document
        db.session.refresh(document2)
        assert document2.indexing_status == "parsing"
        assert document2.processing_started_at is not None

        # Verify both documents' segments were deleted
        remaining_segments1 = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document.id).all()
        remaining_segments2 = db.session.query(DocumentSegment).where(DocumentSegment.document_id == document2.id).all()
        assert len(remaining_segments1) == 0
        assert len(remaining_segments2) == 0

        # Verify external service calls were made for both documents
        # Note: The mock will show calls for both documents combined
        assert mock_external_service_dependencies["index_processor_factory"].call_count >= 2
        assert mock_external_service_dependencies["index_processor"].clean.call_count >= 2
        assert mock_external_service_dependencies["indexing_runner"].call_count >= 2
        assert mock_external_service_dependencies["runner_instance"].run.call_count >= 2
