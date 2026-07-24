import datetime
from unittest.mock import Mock, patch

import pytest

from models.dataset import Dataset, Document
from services.dataset_service import DocumentService
from tests.unit_tests.conftest import redis_mock


class DocumentBatchUpdateTestDataFactory:
    """Factory class for creating test data and mock objects for document batch update tests."""

    @staticmethod
    def create_dataset_mock(dataset_id: str = "dataset-123", tenant_id: str = "tenant-456") -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        return dataset

    @staticmethod
    def create_user_mock(user_id: str = "user-789") -> Mock:
        """Create a mock user."""
        user = Mock()
        user.id = user_id
        return user

    @staticmethod
    def create_document_mock(
        document_id: str = "doc-1",
        name: str = "test_document.pdf",
        enabled: bool = True,
        archived: bool = False,
        indexing_status: str = "completed",
        completed_at: datetime.datetime | None = None,
        **kwargs,
    ) -> Mock:
        """Create a mock document with specified attributes."""
        document = Mock(spec=Document)
        document.id = document_id
        document.name = name
        document.enabled = enabled
        document.archived = archived
        document.indexing_status = indexing_status
        document.completed_at = completed_at or datetime.datetime.now()

        document.disabled_at = None
        document.disabled_by = None
        document.archived_at = None
        document.archived_by = None
        document.updated_at = None

        for key, value in kwargs.items():
            setattr(document, key, value)
        return document


class TestDatasetServiceBatchUpdateDocumentStatus:
    """Unit tests for non-SQL path in DocumentService.batch_update_document_status."""

    @pytest.fixture
    def mock_document_service_dependencies(self):
        """Common mock setup for document service dependencies."""
        with (
            patch("services.dataset_service.DocumentService.get_document") as mock_get_doc,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.naive_utc_now") as mock_naive_utc_now,
        ):
            current_time = datetime.datetime(2023, 1, 1, 12, 0, 0)
            mock_naive_utc_now.return_value = current_time

            yield {
                "get_document": mock_get_doc,
                "db_session": mock_db,
                "naive_utc_now": mock_naive_utc_now,
                "current_time": current_time,
            }

    def test_batch_update_invalid_action_error(self, mock_document_service_dependencies):
        """Test that ValueError is raised when an invalid action is provided."""
        dataset = DocumentBatchUpdateTestDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateTestDataFactory.create_user_mock()

        doc = DocumentBatchUpdateTestDataFactory.create_document_mock(enabled=True)
        mock_document_service_dependencies["get_document"].return_value = doc

        redis_mock.reset_mock()
        redis_mock.get.return_value = None

        invalid_action = "invalid_action"
        with pytest.raises(ValueError) as exc_info:
            DocumentService.batch_update_document_status(
                dataset=dataset, document_ids=["doc-1"], action=invalid_action, user=user
            )

        assert invalid_action in str(exc_info.value)
        assert "Invalid action" in str(exc_info.value)

        redis_mock.setex.assert_not_called()
