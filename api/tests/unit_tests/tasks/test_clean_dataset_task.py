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
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.dataset import DocumentSegment, SegmentAttachmentBinding
from models.enums import CreatorUserRole, SegmentStatus
from models.model import UploadFile
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
    with patch("tasks.clean_dataset_task.session_factory", autospec=True) as mock_sf:
        mock_session = MagicMock()
        # context manager for create_session()
        cm = MagicMock()
        cm.__enter__.return_value = mock_session
        cm.__exit__.return_value = None
        mock_sf.create_session.return_value = cm

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
    with patch("tasks.clean_dataset_task.storage", autospec=True) as mock_storage:
        mock_storage.delete.return_value = None
        yield mock_storage


@pytest.fixture
def mock_index_processor_factory():
    """Mock IndexProcessorFactory."""
    with patch("tasks.clean_dataset_task.IndexProcessorFactory", autospec=True) as mock_factory:
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
    with patch("tasks.clean_dataset_task.get_image_upload_file_ids", autospec=True) as mock_func:
        mock_func.return_value = []
        yield mock_func


def _attachment(
    *,
    tenant_id: str,
    dataset_id: str,
) -> tuple[SegmentAttachmentBinding, UploadFile]:
    attachment_file = UploadFile(
        tenant_id=tenant_id,
        storage_type=StorageType.LOCAL,
        key=f"attachments/{uuid.uuid4()}.pdf",
        name="attachment.pdf",
        size=10,
        extension="pdf",
        mime_type="application/pdf",
        created_by_role=CreatorUserRole.ACCOUNT,
        created_by="00000000-0000-0000-0000-000000000001",
        created_at=datetime.now(UTC).replace(tzinfo=None),
        used=True,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=str(uuid.uuid4()),
        segment_id=str(uuid.uuid4()),
        attachment_id=attachment_file.id,
    )
    return binding, attachment_file


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
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
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
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            pipeline_id=pipeline_id,
        )

        executed_sql = [str(call.args[0]) for call in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM pipelines" in sql for sql in executed_sql)
        assert any("DELETE FROM workflows" in sql for sql in executed_sql)

    def test_clean_dataset_task_without_pipeline_id(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
            pipeline_id=None,
        )

        executed_sql = [str(call.args[0]) for call in mock_db_session.session.execute.call_args_list]
        assert not any("DELETE FROM pipelines" in sql for sql in executed_sql)
        assert not any("DELETE FROM workflows" in sql for sql in executed_sql)
        assert any("DELETE FROM document_segment_summaries" in sql for sql in executed_sql)
        assert any("DELETE FROM child_chunks" in sql for sql in executed_sql)


# ============================================================================
# Test Segment Attachment Cleanup
# ============================================================================


class TestSegmentAttachmentCleanup:
    """Test cases for segment attachment cleanup."""

    def test_clean_dataset_task_with_attachments(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
        binding, attachment_file = _attachment(tenant_id=tenant_id, dataset_id=dataset_id)

        # Setup execute to return attachment with binding
        mock_db_session.session.execute.return_value.all.return_value = [(binding, attachment_file)]

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        # Assert
        mock_storage.delete.assert_called_with(attachment_file.key)
        # Attachment file and binding are deleted in batch; verify DELETEs were issued
        execute_sqls = [" ".join(str(c[0][0]).split()) for c in mock_db_session.session.execute.call_args_list]
        assert any("DELETE FROM upload_files" in sql for sql in execute_sqls)
        assert any("DELETE FROM segment_attachment_bindings" in sql for sql in execute_sqls)

    def test_clean_dataset_task_attachment_storage_failure(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
        binding, attachment_file = _attachment(tenant_id=tenant_id, dataset_id=dataset_id)

        mock_db_session.session.execute.return_value.all.return_value = [(binding, attachment_file)]
        mock_storage.delete.side_effect = Exception("Storage error")

        # Act
        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
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
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
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
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
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
        indexing_technique = IndexTechniqueType.HIGH_QUALITY
        index_struct = '{"type": "paragraph"}'

        # Act
        with patch("tasks.clean_dataset_task.schedule_billing_vector_space_refresh") as schedule_refresh:
            clean_dataset_task(
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                indexing_technique=indexing_technique,
                index_struct=index_struct,
                collection_binding_id=collection_binding_id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
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
        assert call_args[1]["session"] is mock_db_session.session
        assert call_args[1]["with_keywords"] is True
        assert call_args[1]["delete_child_chunks"] is True
        schedule_refresh.assert_called_once_with(tenant_id)

    def test_vector_cleanup_failure_does_not_schedule_billing_refresh(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        mock_index_processor_factory["processor"].clean.side_effect = RuntimeError("vector cleanup failed")

        with patch("tasks.clean_dataset_task.schedule_billing_vector_space_refresh") as schedule_refresh:
            clean_dataset_task(
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                index_struct='{"type": "paragraph"}',
                collection_binding_id=collection_binding_id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
            )

        assert any(
            "DELETE FROM child_chunks" in str(call.args[0]) for call in mock_db_session.session.execute.call_args_list
        )
        schedule_refresh.assert_not_called()

    def test_cleanup_removes_segments_when_documents_were_already_deleted(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
        mock_db_session,
        mock_storage,
        mock_index_processor_factory,
        mock_get_image_upload_file_ids,
    ):
        segment = DocumentSegment(
            tenant_id=tenant_id,
            dataset_id=dataset_id,
            document_id=str(uuid.uuid4()),
            position=1,
            content="Test segment content",
            word_count=2,
            tokens=2,
            created_by="00000000-0000-0000-0000-000000000001",
            status=SegmentStatus.COMPLETED,
        )
        segment.id = str(uuid.uuid4())
        document_result = MagicMock()
        document_result.all.return_value = []
        segment_result = MagicMock()
        segment_result.all.return_value = [segment]
        empty_result = MagicMock()
        empty_result.all.return_value = []
        mock_db_session.session.scalars.side_effect = [
            document_result,
            segment_result,
            empty_result,
        ]

        clean_dataset_task(
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            indexing_technique=IndexTechniqueType.HIGH_QUALITY,
            index_struct='{"type": "paragraph"}',
            collection_binding_id=collection_binding_id,
            doc_form=IndexStructureType.PARAGRAPH_INDEX,
        )

        assert any(
            "DELETE FROM document_segments" in str(call.args[0])
            for call in mock_db_session.session.execute.call_args_list
        )
