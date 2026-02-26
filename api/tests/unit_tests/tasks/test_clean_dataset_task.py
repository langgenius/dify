"""
Unit tests for clean_dataset_task.

This module tests the dataset cleanup task functionality including:
- Basic cleanup of documents and segments
- Vector database cleanup with IndexProcessorFactory
- Storage file deletion
- Invalid doc_form handling with default fallback
- Error handling and database session rollback
- Pipeline and workflow deletion
- Segment attachment cleanup
"""

import uuid
from unittest.mock import MagicMock, patch

import pytest

from tasks.clean_dataset_task import clean_dataset_task

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def tenant_id():
    """Generate a unique tenant ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id():
    """Generate a unique dataset ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def collection_binding_id():
    """Generate a unique collection binding ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def pipeline_id():
    """Generate a unique pipeline ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def mock_db_session():
    """Mock database session via session_factory.create_session()."""
    with patch("tasks.clean_dataset_task.session_factory") as mock_sf:
        mock_session = MagicMock()
        # context manager for create_session()
        cm = MagicMock()
        cm.__enter__.return_value = mock_session
        cm.__exit__.return_value = None
        mock_sf.create_session.return_value = cm

        # Setup query chain
        mock_query = MagicMock()
        mock_session.query.return_value = mock_query
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = 0

        # Setup scalars for select queries
        mock_session.scalars.return_value.all.return_value = []

        # Setup execute for JOIN queries
        mock_session.execute.return_value.all.return_value = []

        # Yield an object with a `.session` attribute to keep tests unchanged
        wrapper = MagicMock()
        wrapper.session = mock_session
        yield wrapper


@pytest.fixture
def mock_storage():
    """Mock storage client."""
    with patch("tasks.clean_dataset_task.storage") as mock_storage:
        mock_storage.delete.return_value = None
        yield mock_storage


@pytest.fixture
def mock_index_processor_factory():
    """Mock IndexProcessorFactory."""
    with patch("tasks.clean_dataset_task.IndexProcessorFactory") as mock_factory:
        mock_processor = MagicMock()
        mock_processor.clean.return_value = None
        mock_factory_instance = MagicMock()
        mock_factory_instance.init_index_processor.return_value = mock_processor
        mock_factory.return_value = mock_factory_instance

        yield {
            "factory": mock_factory,
            "factory_instance": mock_factory_instance,
            "processor": mock_processor,
        }


@pytest.fixture
def mock_get_image_upload_file_ids():
    """Mock get_image_upload_file_ids function."""
    with patch("tasks.clean_dataset_task.get_image_upload_file_ids") as mock_func:
        mock_func.return_value = []
        yield mock_func


@pytest.fixture
def mock_document():
    """Create a mock Document object."""
    doc = MagicMock()
    doc.id = str(uuid.uuid4())
    doc.tenant_id = str(uuid.uuid4())
    doc.dataset_id = str(uuid.uuid4())
    doc.data_source_type = "upload_file"
    doc.data_source_info = '{"upload_file_id": "test-file-id"}'
    doc.data_source_info_dict = {"upload_file_id": "test-file-id"}
    return doc


@pytest.fixture
def mock_segment():
    """Create a mock DocumentSegment object."""
    segment = MagicMock()
    segment.id = str(uuid.uuid4())
    segment.content = "Test segment content"
    return segment


@pytest.fixture
def mock_upload_file():
    """Create a mock UploadFile object."""
    upload_file = MagicMock()
    upload_file.id = str(uuid.uuid4())
    upload_file.key = f"test_files/{uuid.uuid4()}.txt"
    return upload_file


# ============================================================================
# Test Basic Cleanup
# ============================================================================
# Note: Basic cleanup behavior is now covered by testcontainers-based
# integration tests; no unit tests remain in this section.
# ============================================================================
# Test Error Handling
# ============================================================================


class TestErrorHandling:
    """Test cases for error handling and recovery."""

    def test_clean_dataset_task_rollback_failure_still_closes_session(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that session is closed even if rollback fails.

        Scenario:
        - Database commit fails
        - Rollback also fails
        - Session should still be closed

        Expected behavior:
        - Session.close() is called regardless of rollback failure
        """
        # Arrange
        mock_db_session.session.commit.side_effect = Exception("Commit failed")
        mock_db_session.session.rollback.side_effect = Exception("Rollback failed")

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_db_session.session.close.assert_called_once()


# ============================================================================
# Test Pipeline and Workflow Deletion
# ============================================================================


class TestPipelineAndWorkflowDeletion:
    """Test cases for pipeline and workflow deletion."""

    def test_clean_dataset_task_with_pipeline_id(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        pipeline_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that pipeline and workflow are deleted when pipeline_id is provided.

        Expected behavior:
        - Pipeline record is deleted
        - Related workflow record is deleted
        """
        # Arrange
        mock_query = mock_db_session.session.query.return_value
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = 1

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
            pipeline_id=pipeline_id,
        )

        # Assert - verify delete was called for pipeline-related queries
        # The actual count depends on total queries, but pipeline deletion should add 2 more
        assert mock_query.delete.call_count >= 7  # 5 base + 2 pipeline/workflow

    def test_clean_dataset_task_without_pipeline_id(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that pipeline/workflow deletion is skipped when pipeline_id is None.

        Expected behavior:
        - Pipeline and workflow deletion queries are not executed
        """
        # Arrange
        mock_query = mock_db_session.session.query.return_value
        mock_query.where.return_value = mock_query
        mock_query.delete.return_value = 1

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
            pipeline_id=None,
        )

        # Assert - verify delete was called only for base queries (5 times)
        assert mock_query.delete.call_count == 5


# ============================================================================
# Test Segment Attachment Cleanup
# ============================================================================


class TestSegmentAttachmentCleanup:
    """Test cases for segment attachment cleanup."""

    def test_clean_dataset_task_with_attachments(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that segment attachments are cleaned up properly.

        Scenario:
        - Dataset has segment attachments with associated files
        - Both binding and file records should be deleted

        Expected behavior:
        - Storage.delete() is called for each attachment file
        - Attachment file records are deleted from database
        - Binding records are deleted from database
        """
        # Arrange
        mock_binding = MagicMock()
        mock_binding.attachment_id = str(uuid.uuid4())

        mock_attachment_file = MagicMock()
        mock_attachment_file.id = mock_binding.attachment_id
        mock_attachment_file.key = f"attachments/{uuid.uuid4()}.pdf"

        # Setup execute to return attachment with binding
        mock_db_session.session.execute.return_value.all.return_value = [(mock_binding, mock_attachment_file)]

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_storage.delete.assert_called_with(mock_attachment_file.key)
        # Attachment file and binding are deleted in batch; verify DELETEs were issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM upload_files" in sql for sql in execute_sqls)
        assert any("DELETE FROM segment_attachment_bindings" in sql for sql in execute_sqls)

    def test_clean_dataset_task_attachment_storage_failure(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that cleanup continues even if attachment storage deletion fails.

        Expected behavior:
        - Exception is caught and logged
        - Attachment file and binding are still deleted from database
        """
        # Arrange
        mock_binding = MagicMock()
        mock_binding.attachment_id = str(uuid.uuid4())

        mock_attachment_file = MagicMock()
        mock_attachment_file.id = mock_binding.attachment_id
        mock_attachment_file.key = f"attachments/{uuid.uuid4()}.pdf"

        mock_db_session.session.execute.return_value.all.return_value = [(mock_binding, mock_attachment_file)]
        mock_storage.delete.side_effect = Exception("Storage error")

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert - storage delete was attempted
        mock_storage.delete.assert_called_once()
        # Records are deleted in batch; verify DELETEs were issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM upload_files" in sql for sql in execute_sqls)
        assert any("DELETE FROM segment_attachment_bindings" in sql for sql in execute_sqls)


# ============================================================================
# Test Edge Cases
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_clean_dataset_task_session_always_closed(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that database session is always closed regardless of success or failure.

        Expected behavior:
        - Session.close() is called in finally block
        """
        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_db_session.session.close.assert_called_once()


# ============================================================================
# Test IndexProcessor Parameters
# ============================================================================


class TestIndexProcessorParameters:
    """Test cases for IndexProcessor clean method parameters."""

    def test_clean_dataset_task_passes_correct_parameters_to_index_processor(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that correct parameters are passed to IndexProcessor.clean().

        Expected behavior:
        - with_keywords=True is passed
        - delete_child_chunks=True is passed
        - Dataset object with correct attributes is passed
        """
        # Arrange
        indexing_technique = "high_quality"
        index_struct = '{"type": "paragraph"}'

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=indexing_technique,
            index_struct=index_struct,
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_index_processor_factory["processor"].clean.assert_called_once()
        call_args = mock_index_processor_factory["processor"].clean.call_args

        # Verify positional arguments
        dataset_arg = call_args[0][0]
        assert dataset_arg.id == dataset_id
        assert dataset_arg.tenant_id == tenant_id
        assert dataset_arg.indexing_technique == indexing_technique
        assert dataset_arg.index_struct == index_struct
        assert dataset_arg.collection_binding_id == collection_binding_id

        # Verify None is passed as second argument
        assert call_args[0][1] is None

        # Verify keyword arguments
        assert call_args[1]["with_keywords"] is True
        assert call_args[1]["delete_child_chunks"] is True
