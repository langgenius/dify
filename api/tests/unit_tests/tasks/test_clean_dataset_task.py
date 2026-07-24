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

import json
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import Engine, event
from sqlalchemy.orm import Session, sessionmaker

from core.rag.index_processor.constant.index_type import IndexStructureType, IndexTechniqueType
from extensions.storage.storage_type import StorageType
from models.base import TypeBase
from models.dataset import (
    AppDatasetJoin,
    DatasetMetadata,
    DatasetMetadataBinding,
    DatasetProcessRule,
    DatasetQuery,
    Document,
    DocumentSegment,
    Pipeline,
    SegmentAttachmentBinding,
)
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import UploadFile
from models.workflow import Workflow, WorkflowType
from tasks.clean_dataset_task import clean_dataset_task

# ============================================================================
# Fixtures
# ============================================================================


@pytest.fixture
def tenant_id() -> str:
    """Generate a unique tenant ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def dataset_id() -> str:
    """Generate a unique dataset ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def collection_binding_id() -> str:
    """Generate a unique collection binding ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def pipeline_id() -> str:
    """Generate a unique pipeline ID for testing."""
    return str(uuid.uuid4())


@pytest.fixture
def orm_session_maker(sqlite_engine: Engine) -> sessionmaker[Session]:
    """Create the cleanup tables and return an explicit real SQLite session factory."""
    models = (
        Document,
        DocumentSegment,
        SegmentAttachmentBinding,
        UploadFile,
        DatasetProcessRule,
        DatasetQuery,
        AppDatasetJoin,
        DatasetMetadata,
        DatasetMetadataBinding,
        Pipeline,
        Workflow,
    )
    TypeBase.metadata.create_all(sqlite_engine, tables=[model.__table__ for model in models])
    return sessionmaker(bind=sqlite_engine, expire_on_commit=False)


@pytest.fixture
def mock_storage() -> Iterator[MagicMock]:
    """Mock storage client."""
    with patch("tasks.clean_dataset_task.storage", autospec=True) as mock_storage:
        mock_storage.delete.return_value = None
        yield mock_storage


@pytest.fixture
def mock_index_processor_factory() -> Iterator[dict[str, MagicMock]]:
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
def mock_get_image_upload_file_ids() -> Iterator[MagicMock]:
    """Mock get_image_upload_file_ids function."""
    with patch("tasks.clean_dataset_task.get_image_upload_file_ids", autospec=True) as mock_func:
        mock_func.return_value = []
        yield mock_func


def _run_clean_dataset(
    *,
    session_maker: sessionmaker[Session],
    dataset_id: str,
    tenant_id: str,
    collection_binding_id: str,
    pipeline_id: str | None = None,
) -> None:
    clean_dataset_task(
        dataset_id=dataset_id,
        tenant_id=tenant_id,
        indexing_technique=IndexTechniqueType.HIGH_QUALITY,
        index_struct='{"type": "paragraph"}',
        collection_binding_id=collection_binding_id,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
        pipeline_id=pipeline_id,
        session_maker=session_maker,
    )


def _persist_document(session_maker: sessionmaker[Session], *, dataset_id: str, tenant_id: str) -> Document:
    document = Document(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        position=1,
        data_source_type=DataSourceType.LOCAL_FILE,
        batch="batch",
        name="Document",
        created_from=DocumentCreatedFrom.API,
        created_by=str(uuid.uuid4()),
        indexing_status=IndexingStatus.COMPLETED,
        doc_form=IndexStructureType.PARAGRAPH_INDEX,
    )
    with session_maker.begin() as session:
        session.add(document)
    return document


def _persist_pipeline_and_workflow(
    session_maker: sessionmaker[Session],
    *,
    pipeline_id: str,
    tenant_id: str,
) -> Workflow:
    pipeline = Pipeline(tenant_id=tenant_id, name="Pipeline", description="Pipeline")
    pipeline.id = pipeline_id
    workflow = Workflow.new(
        tenant_id=tenant_id,
        app_id=pipeline_id,
        type=WorkflowType.RAG_PIPELINE.value,
        version="v1",
        graph=json.dumps({"nodes": [], "edges": []}),
        features="{}",
        created_by=str(uuid.uuid4()),
        environment_variables=[],
        conversation_variables=[],
        rag_pipeline_variables=[],
    )
    with session_maker.begin() as session:
        session.add_all([pipeline, workflow])
    return workflow


def _persist_attachment(
    session_maker: sessionmaker[Session],
    *,
    dataset_id: str,
    tenant_id: str,
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
        created_by=str(uuid.uuid4()),
        created_at=datetime.now(UTC),
        used=False,
    )
    binding = SegmentAttachmentBinding(
        tenant_id=tenant_id,
        dataset_id=dataset_id,
        document_id=str(uuid.uuid4()),
        segment_id=str(uuid.uuid4()),
        attachment_id=attachment_file.id,
    )
    with session_maker.begin() as session:
        session.add_all([attachment_file, binding])
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
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
    ):
        """
        Test that session is closed even if rollback fails.

        Scenario:
        - Database commit fails
        - Rollback completes, then its event hook raises
        - Session cleanup should still make the factory reusable

        Expected behavior:
        - The database rollback preserves the pending row
        - The task session closes and a new session remains usable
        """
        # Arrange: persist a row whose attempted deletion must be rolled back.
        document = _persist_document(orm_session_maker, dataset_id=dataset_id, tenant_id=tenant_id)

        def fail_commit(_session: Session) -> None:
            raise RuntimeError("Commit failed")

        def fail_rollback(_session: Session) -> None:
            raise RuntimeError("Rollback failed")

        event.listen(orm_session_maker.class_, "before_commit", fail_commit)
        event.listen(orm_session_maker.class_, "after_rollback", fail_rollback)

        # Act
        try:
            _run_clean_dataset(
                session_maker=orm_session_maker,
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                collection_binding_id=collection_binding_id,
            )
        finally:
            event.remove(orm_session_maker.class_, "before_commit", fail_commit)
            event.remove(orm_session_maker.class_, "after_rollback", fail_rollback)

        # Assert: rollback happened before its hook failed, and the closed task
        # session did not prevent a new real session from reading the row.
        with orm_session_maker() as session:
            assert session.get(Document, document.id) is not None


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
        pipeline_id: str,
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
    ):
        """
        Test that pipeline and workflow are deleted when pipeline_id is provided.

        Expected behavior:
        - Pipeline record is deleted
        - Related workflow record is deleted
        """
        workflow = _persist_pipeline_and_workflow(
            orm_session_maker,
            pipeline_id=pipeline_id,
            tenant_id=tenant_id,
        )

        # Act
        _run_clean_dataset(
            session_maker=orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            collection_binding_id=collection_binding_id,
            pipeline_id=pipeline_id,
        )

        # Assert
        with orm_session_maker() as session:
            assert session.get(Pipeline, pipeline_id) is None
            assert session.get(Workflow, workflow.id) is None

    def test_clean_dataset_task_without_pipeline_id(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
        pipeline_id: str,
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
    ):
        """
        Test that pipeline/workflow deletion is skipped when pipeline_id is None.

        Expected behavior:
        - Pipeline and workflow deletion queries are not executed
        """
        workflow = _persist_pipeline_and_workflow(
            orm_session_maker,
            pipeline_id=pipeline_id,
            tenant_id=tenant_id,
        )

        # Act
        _run_clean_dataset(
            session_maker=orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            collection_binding_id=collection_binding_id,
            pipeline_id=None,
        )

        # Assert
        with orm_session_maker() as session:
            assert session.get(Pipeline, pipeline_id) is not None
            assert session.get(Workflow, workflow.id) is not None


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
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
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
        binding, attachment_file = _persist_attachment(
            orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
        )

        # Act
        _run_clean_dataset(
            session_maker=orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            collection_binding_id=collection_binding_id,
        )

        # Assert
        mock_storage.delete.assert_called_once_with(attachment_file.key)
        with orm_session_maker() as session:
            assert session.get(UploadFile, attachment_file.id) is None
            assert session.get(SegmentAttachmentBinding, binding.id) is None

    def test_clean_dataset_task_attachment_storage_failure(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
    ):
        """
        Test that cleanup continues even if attachment storage deletion fails.

        Expected behavior:
        - Exception is caught and logged
        - Attachment file and binding are still deleted from database
        """
        # Arrange
        binding, attachment_file = _persist_attachment(
            orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
        )
        mock_storage.delete.side_effect = Exception("Storage error")

        # Act
        _run_clean_dataset(
            session_maker=orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            collection_binding_id=collection_binding_id,
        )

        # Assert - storage delete was attempted
        mock_storage.delete.assert_called_once_with(attachment_file.key)
        with orm_session_maker() as session:
            assert session.get(UploadFile, attachment_file.id) is None
            assert session.get(SegmentAttachmentBinding, binding.id) is None


# ============================================================================
# Test Edge Cases
# ============================================================================


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_clean_dataset_task_commits_cleanup_and_factory_remains_usable(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
    ):
        """
        Test that cleanup commits and the task-owned session releases its resources.

        Expected behavior:
        - The document deletion is committed
        - A subsequent real session can use the same factory
        """
        document = _persist_document(orm_session_maker, dataset_id=dataset_id, tenant_id=tenant_id)

        # Act
        _run_clean_dataset(
            session_maker=orm_session_maker,
            dataset_id=dataset_id,
            tenant_id=tenant_id,
            collection_binding_id=collection_binding_id,
        )

        # Assert
        with orm_session_maker() as session:
            assert session.get(Document, document.id) is None


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
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
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
                session_maker=orm_session_maker,
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
        cleanup_session = call_args[1]["session"]
        assert isinstance(cleanup_session, Session)
        assert cleanup_session.get_bind() is orm_session_maker.kw["bind"]
        assert call_args[1]["with_keywords"] is True
        assert call_args[1]["delete_child_chunks"] is True
        schedule_refresh.assert_called_once_with(tenant_id)

    def test_vector_cleanup_failure_does_not_schedule_billing_refresh(
        self,
        dataset_id: str,
        tenant_id: str,
        collection_binding_id: str,
        orm_session_maker: sessionmaker[Session],
        mock_storage: MagicMock,
        mock_index_processor_factory: dict[str, MagicMock],
        mock_get_image_upload_file_ids: MagicMock,
    ) -> None:
        mock_index_processor_factory["processor"].clean.side_effect = RuntimeError("vector cleanup failed")

        with patch("tasks.clean_dataset_task.schedule_billing_vector_space_refresh") as schedule_refresh:
            clean_dataset_task(
                dataset_id=dataset_id,
                tenant_id=tenant_id,
                indexing_technique=IndexTechniqueType.HIGH_QUALITY,
                index_struct='{"type": "paragraph"}',
                collection_binding_id=collection_binding_id,
                doc_form=IndexStructureType.PARAGRAPH_INDEX,
                session_maker=orm_session_maker,
            )

        schedule_refresh.assert_not_called()
