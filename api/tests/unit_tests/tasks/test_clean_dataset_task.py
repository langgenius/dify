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


class TestBasicCleanup:
    """Test cases for basic dataset cleanup functionality."""

    def test_clean_dataset_task_empty_dataset(
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
        Test cleanup of an empty dataset with no documents or segments.

        Scenario:
        - Dataset has no documents or segments
        - Should still clean vector database and delete related records

        Expected behavior:
        - IndexProcessorFactory is called to clean vector database
        - No storage deletions occur
        - Related records (DatasetProcessRule, etc.) are deleted
        - Session is committed and closed
        """
        # Arrange
        mock_db_session.session.scalars.return_value.all.return_value = []

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
        mock_index_processor_factory["factory"].assert_called_once_with("paragraph_index")
        mock_index_processor_factory["processor"].clean.assert_called_once()
        mock_storage.delete.assert_not_called()
        mock_db_session.session.commit.assert_called_once()
        mock_db_session.session.close.assert_called_once()

    def test_clean_dataset_task_with_documents_and_segments(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
        mock_document,
        mock_segment,
    ):
        """
        Test cleanup of dataset with documents and segments.

        Scenario:
        - Dataset has one document and one segment
        - No image files in segment content

        Expected behavior:
        - Documents and segments are deleted
        - Vector database is cleaned
        - Session is committed
        """
        # Arrange
        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents
            [mock_segment],  # segments
        ]
        mock_get_image_upload_file_ids.return_value = []

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
        mock_db_session.session.delete.assert_any_call(mock_document)
        # Segments are deleted in batch; verify a DELETE on document_segments was issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM document_segments" in sql for sql in execute_sqls)
        mock_db_session.session.commit.assert_called_once()

    def test_clean_dataset_task_deletes_related_records(
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
        Test that all related records are deleted.

        Expected behavior:
        - DatasetProcessRule records are deleted
        - DatasetQuery records are deleted
        - AppDatasetJoin records are deleted
        - DatasetMetadata records are deleted
        - DatasetMetadataBinding records are deleted
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
        )

        # Assert - verify query.where.delete was called multiple times
        # for different models (DatasetProcessRule, DatasetQuery, etc.)
        assert mock_query.delete.call_count >= 5


# ============================================================================
# Test Doc Form Validation
# ============================================================================


class TestDocFormValidation:
    """Test cases for doc_form validation and default fallback."""

    @pytest.mark.parametrize(
        "invalid_doc_form",
        [
            None,
            "",
            "   ",
            "\t",
            "\n",
            "  \t\n  ",
        ],
    )
    def test_clean_dataset_task_invalid_doc_form_uses_default(
        self,
        invalid_doc_form,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        """
        Test that invalid doc_form values use default paragraph index type.

        Scenario:
        - doc_form is None, empty, or whitespace-only
        - Should use default IndexStructureType.PARAGRAPH_INDEX

        Expected behavior:
        - Default index type is used for cleanup
        - No errors are raised
        - Cleanup proceeds normally
        """
        # Arrange - import to verify the default value
        from core.rag.index_processor.constant.index_type import IndexStructureType

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=invalid_doc_form,
        )

        # Assert - IndexProcessorFactory should be called with default type
        mock_index_processor_factory["factory"].assert_called_once_with(IndexStructureType.PARAGRAPH_INDEX)
        mock_index_processor_factory["processor"].clean.assert_called_once()

    def test_clean_dataset_task_valid_doc_form_used_directly(
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
        Test that valid doc_form values are used directly.

        Expected behavior:
        - Provided doc_form is passed to IndexProcessorFactory
        """
        # Arrange
        valid_doc_form = "qa_index"

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=valid_doc_form,
        )

        # Assert
        mock_index_processor_factory["factory"].assert_called_once_with(valid_doc_form)


# ============================================================================
# Test Error Handling
# ============================================================================


class TestErrorHandling:
    """Test cases for error handling and recovery."""

    def test_clean_dataset_task_vector_cleanup_failure_continues(
        self,
        dataset_id,
        tenant_id,
        collection_binding_id,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
        mock_document,
        mock_segment,
    ):
        """
        Test that document cleanup continues even if vector cleanup fails.

        Scenario:
        - IndexProcessor.clean() raises an exception
        - Document and segment deletion should still proceed

        Expected behavior:
        - Exception is caught and logged
        - Documents and segments are still deleted
        - Session is committed
        """
        # Arrange
        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents
            [mock_segment],  # segments
        ]
        mock_index_processor_factory["processor"].clean.side_effect = Exception("Vector database error")

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert - documents and segments should still be deleted
        mock_db_session.session.delete.assert_any_call(mock_document)
        # Segments are deleted in batch; verify a DELETE on document_segments was issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM document_segments" in sql for sql in execute_sqls)
        mock_db_session.session.commit.assert_called_once()

    def test_clean_dataset_task_storage_delete_failure_continues(
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
        Test that cleanup continues even if storage deletion fails.

        Scenario:
        - Segment contains image file references
        - Storage.delete() raises an exception
        - Cleanup should continue

        Expected behavior:
        - Exception is caught and logged
        - Image file record is still deleted from database
        - Other cleanup operations proceed
        """
        # Arrange
        # Need at least one document for segment processing to occur (code is in else block)
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "website"  # Non-upload type to avoid file deletion

        mock_segment = MagicMock()
        mock_segment.id = str(uuid.uuid4())
        mock_segment.content = "Test content with image"

        mock_upload_file = MagicMock()
        mock_upload_file.id = str(uuid.uuid4())
        mock_upload_file.key = "images/test-image.jpg"

        image_file_id = mock_upload_file.id

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents - need at least one for segment processing
            [mock_segment],  # segments
        ]
        mock_get_image_upload_file_ids.return_value = [image_file_id]
        mock_db_session.session.query.return_value.where.return_value.all.return_value = [mock_upload_file]
        mock_storage.delete.side_effect = Exception("Storage service unavailable")

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert - storage delete was attempted for image file
        mock_storage.delete.assert_called_with(mock_upload_file.key)
        # Upload files are deleted in batch; verify a DELETE on upload_files was issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM upload_files" in sql for sql in execute_sqls)

    def test_clean_dataset_task_database_error_rollback(
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
        Test that database session is rolled back on error.

        Scenario:
        - Database operation raises an exception
        - Session should be rolled back to prevent dirty state

        Expected behavior:
        - Session.rollback() is called
        - Session.close() is called in finally block
        """
        # Arrange
        mock_db_session.session.commit.side_effect = Exception("Database commit failed")

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
        mock_db_session.session.rollback.assert_called_once()
        mock_db_session.session.close.assert_called_once()

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
# Test Upload File Cleanup
# ============================================================================


class TestUploadFileCleanup:
    """Test cases for upload file cleanup."""

    def test_clean_dataset_task_deletes_document_upload_files(
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
        Test that document upload files are deleted.

        Scenario:
        - Document has data_source_type = "upload_file"
        - data_source_info contains upload_file_id

        Expected behavior:
        - Upload file is deleted from storage
        - Upload file record is deleted from database
        """
        # Arrange
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "upload_file"
        mock_document.data_source_info = '{"upload_file_id": "test-file-id"}'
        mock_document.data_source_info_dict = {"upload_file_id": "test-file-id"}

        mock_upload_file = MagicMock()
        mock_upload_file.id = "test-file-id"
        mock_upload_file.key = "uploads/test-file.txt"

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents
            [],  # segments
        ]
        mock_db_session.session.query.return_value.where.return_value.all.return_value = [mock_upload_file]

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
        mock_storage.delete.assert_called_with(mock_upload_file.key)
        # Upload files are deleted in batch; verify a DELETE on upload_files was issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM upload_files" in sql for sql in execute_sqls)

    def test_clean_dataset_task_handles_missing_upload_file(
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
        Test that missing upload files are handled gracefully.

        Scenario:
        - Document references an upload_file_id that doesn't exist

        Expected behavior:
        - No error is raised
        - Cleanup continues normally
        """
        # Arrange
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "upload_file"
        mock_document.data_source_info = '{"upload_file_id": "nonexistent-file"}'
        mock_document.data_source_info_dict = {"upload_file_id": "nonexistent-file"}

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents
            [],  # segments
        ]
        mock_db_session.session.query.return_value.where.return_value.all.return_value = []

        # Act - should not raise exception
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_storage.delete.assert_not_called()
        mock_db_session.session.commit.assert_called_once()

    def test_clean_dataset_task_handles_non_upload_file_data_source(
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
        Test that non-upload_file data sources are skipped.

        Scenario:
        - Document has data_source_type = "website"

        Expected behavior:
        - No file deletion is attempted
        """
        # Arrange
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "website"
        mock_document.data_source_info = None

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents
            [],  # segments
        ]

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert - storage delete should not be called for document files
        # (only for image files in segments, which are empty here)
        mock_storage.delete.assert_not_called()


# ============================================================================
# Test Image File Cleanup
# ============================================================================


class TestImageFileCleanup:
    """Test cases for image file cleanup in segments."""

    def test_clean_dataset_task_deletes_image_files_in_segments(
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
        Test that image files referenced in segment content are deleted.

        Scenario:
        - Segment content contains image file references
        - get_image_upload_file_ids returns file IDs

        Expected behavior:
        - Each image file is deleted from storage
        - Each image file record is deleted from database
        """
        # Arrange
        # Need at least one document for segment processing to occur (code is in else block)
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "website"  # Non-upload type

        mock_segment = MagicMock()
        mock_segment.id = str(uuid.uuid4())
        mock_segment.content = '<img src="file://image-1"> <img src="file://image-2">'

        image_file_ids = ["image-1", "image-2"]
        mock_get_image_upload_file_ids.return_value = image_file_ids

        mock_image_files = []
        for file_id in image_file_ids:
            mock_file = MagicMock()
            mock_file.id = file_id
            mock_file.key = f"images/{file_id}.jpg"
            mock_image_files.append(mock_file)

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents - need at least one for segment processing
            [mock_segment],  # segments
        ]

        # Setup a mock query chain that returns files in batch (align with .in_().all())
        mock_query = MagicMock()
        mock_where = MagicMock()
        mock_query.where.return_value = mock_where
        mock_where.all.return_value = mock_image_files
        mock_db_session.session.query.return_value = mock_query

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert - each expected image key was deleted at least once
        calls = [c.args[0] for c in mock_storage.delete.call_args_list]
        assert "images/image-1.jpg" in calls
        assert "images/image-2.jpg" in calls

    def test_clean_dataset_task_handles_missing_image_file(
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
        Test that missing image files are handled gracefully.

        Scenario:
        - Segment references image file ID that doesn't exist in database

        Expected behavior:
        - No error is raised
        - Cleanup continues
        """
        # Arrange
        # Need at least one document for segment processing to occur (code is in else block)
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "website"  # Non-upload type

        mock_segment = MagicMock()
        mock_segment.id = str(uuid.uuid4())
        mock_segment.content = '<img src="file://nonexistent-image">'

        mock_get_image_upload_file_ids.return_value = ["nonexistent-image"]

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents - need at least one for segment processing
            [mock_segment],  # segments
        ]

        # Image file not found
        mock_db_session.session.query.return_value.where.return_value.all.return_value = []

        # Act - should not raise exception
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_storage.delete.assert_not_called()
        mock_db_session.session.commit.assert_called_once()


# ============================================================================
# Test Edge Cases
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_clean_dataset_task_multiple_documents_and_segments(
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
        Test cleanup of multiple documents and segments.

        Scenario:
        - Dataset has 5 documents and 10 segments

        Expected behavior:
        - All documents and segments are deleted
        """
        # Arrange
        mock_documents = []
        for i in range(5):
            doc = MagicMock()
            doc.id = str(uuid.uuid4())
            doc.tenant_id = tenant_id
            doc.data_source_type = "website"  # Non-upload type
            mock_documents.append(doc)

        mock_segments = []
        for i in range(10):
            seg = MagicMock()
            seg.id = str(uuid.uuid4())
            seg.content = f"Segment content {i}"
            mock_segments.append(seg)

        mock_db_session.session.scalars.return_value.all.side_effect = [
            mock_documents,
            mock_segments,
        ]
        mock_get_image_upload_file_ids.return_value = []

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert - all documents and segments should be deleted (documents per-entity, segments in batch)
        delete_calls = mock_db_session.session.delete.call_args_list
        deleted_items = [call[0][0] for call in delete_calls]

        for doc in mock_documents:
            assert doc in deleted_items
        # Verify a batch DELETE on document_segments occurred
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM document_segments" in sql for sql in execute_sqls)

    def test_clean_dataset_task_document_with_empty_data_source_info(
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
        Test handling of document with empty data_source_info.

        Scenario:
        - Document has data_source_type = "upload_file"
        - data_source_info is None or empty

        Expected behavior:
        - No error is raised
        - File deletion is skipped
        """
        # Arrange
        mock_document = MagicMock()
        mock_document.id = str(uuid.uuid4())
        mock_document.tenant_id = tenant_id
        mock_document.data_source_type = "upload_file"
        mock_document.data_source_info = None

        mock_db_session.session.scalars.return_value.all.side_effect = [
            [mock_document],  # documents
            [],  # segments
        ]

        # Act - should not raise exception
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique="high_quality",
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form="paragraph_index",
        )

        # Assert
        mock_storage.delete.assert_not_called()
        mock_db_session.session.commit.assert_called_once()

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
