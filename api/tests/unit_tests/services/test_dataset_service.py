"""Unit tests for non-SQL DocumentService orchestration behaviors.

This file intentionally keeps only collaborator-oriented document indexing
orchestration tests. SQL-backed dataset lifecycle cases are covered by
integration tests under testcontainers.
"""

from unittest.mock import Mock, patch

import pytest

from models.dataset import Document
from services.errors.document import DocumentIndexingError


class DatasetServiceUnitDataFactory:
    """Factory for creating lightweight document doubles used in unit tests."""

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-123",
        dataset_id: str = "dataset-123",
        indexing_status: str = "completed",
        is_paused: bool = False,
    ) -> Mock:
        """Create a document-shaped mock for DocumentService orchestration tests."""
        document = Mock(spec=Document)
        document.id = document_id
        document.dataset_id = dataset_id
        document.indexing_status = indexing_status
        document.is_paused = is_paused
        document.paused_by = None
        document.paused_at = None
        return document


class TestDatasetServiceDocumentIndexing:
    """Unit tests for pause/recover/retry orchestration without SQL assertions."""

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """Patch non-SQL collaborators used by DocumentService methods."""
        with (
            patch("services.dataset_service.redis_client") as mock_redis,
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            mock_current_user.id = "user-123"
            yield {
                "redis_client": mock_redis,
                "db_session": mock_db,
                "current_user": mock_current_user,
            }

    def test_pause_document_success(self, mock_document_service_dependencies):
        """Pause a document that is currently in an indexable status."""
        # Arrange
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="indexing")

        # Act
        from services.dataset_service import DocumentService

        DocumentService.pause_document(document)

        # Assert
        assert document.is_paused is True
        assert document.paused_by == "user-123"
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()
        mock_document_service_dependencies["redis_client"].setnx.assert_called_once_with(
            f"document_{document.id}_is_paused",
            "True",
        )

    def test_pause_document_invalid_status_error(self, mock_document_service_dependencies):
        """Raise DocumentIndexingError when pausing a completed document."""
        # Arrange
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="completed")

        # Act / Assert
        from services.dataset_service import DocumentService

        with pytest.raises(DocumentIndexingError):
            DocumentService.pause_document(document)

    def test_recover_document_success(self, mock_document_service_dependencies):
        """Recover a paused document and dispatch the recover indexing task."""
        # Arrange
        document = DatasetServiceUnitDataFactory.create_document_mock(indexing_status="indexing", is_paused=True)

        # Act
        with patch("services.dataset_service.recover_document_indexing_task") as recover_task:
            from services.dataset_service import DocumentService

            DocumentService.recover_document(document)

        # Assert
        assert document.is_paused is False
        assert document.paused_by is None
        assert document.paused_at is None
        mock_document_service_dependencies["db_session"].add.assert_called_once_with(document)
        mock_document_service_dependencies["db_session"].commit.assert_called_once()
        mock_document_service_dependencies["redis_client"].delete.assert_called_once_with(
            f"document_{document.id}_is_paused"
        )
        recover_task.delay.assert_called_once_with(document.dataset_id, document.id)

    def test_retry_document_indexing_success(self, mock_document_service_dependencies):
        """Reset documents to waiting state and dispatch retry indexing task."""
        # Arrange
        dataset_id = "dataset-123"
        documents = [
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-1", indexing_status="error"),
            DatasetServiceUnitDataFactory.create_document_mock(document_id="doc-2", indexing_status="error"),
        ]
        mock_document_service_dependencies["redis_client"].get.return_value = None

        # Act
        with patch("services.dataset_service.retry_document_indexing_task") as retry_task:
            from services.dataset_service import DocumentService

            DocumentService.retry_document(dataset_id, documents)

        # Assert
        assert all(document.indexing_status == "waiting" for document in documents)
        assert mock_document_service_dependencies["db_session"].add.call_count == 2
        assert mock_document_service_dependencies["db_session"].commit.call_count == 2
        assert mock_document_service_dependencies["redis_client"].setex.call_count == 2
        retry_task.delay.assert_called_once_with(dataset_id, ["doc-1", "doc-2"], "user-123")
