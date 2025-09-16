"""Integration tests for document_indexing_update_task using testcontainers."""

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
    """Integration tests for document_indexing_update_task using testcontainers."""

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
        """Test successful document indexing update with paragraph index type."""
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
        """Test handling of non-existent document."""
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
        """Test handling when document's dataset doesn't exist."""
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
        """Test document indexing update with different index types."""
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
        """Test exception handling during cleanup process."""
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
        """Test document indexing update with parent-child index type."""
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
        """Test document indexing update when no segments exist to clean."""
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
        """Test exception handling during indexing runner execution."""
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
        """Test general exception handling during indexing runner execution."""
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
        """Test document indexing update with segments in different states."""
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
        """Test handling of database connection errors during task execution."""
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

