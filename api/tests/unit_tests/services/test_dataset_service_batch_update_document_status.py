"""Unit tests for non-SQL validation in batch document status updates."""

from unittest.mock import Mock

import pytest

from models.dataset import Dataset
from services.dataset_service import DocumentService


class DocumentBatchUpdateUnitDataFactory:
    """Factory for lightweight doubles used by unit-only validation tests."""

    @staticmethod
    def create_dataset_mock(dataset_id: str = "dataset-123", tenant_id: str = "tenant-123") -> Mock:
        """Create a dataset-shaped mock used by DocumentService APIs."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        return dataset

    @staticmethod
    def create_user_mock(user_id: str = "user-123") -> Mock:
        """Create a minimal user-shaped mock with id."""
        user = Mock()
        user.id = user_id
        return user


class TestDatasetServiceBatchUpdateDocumentStatus:
    """Unit tests for non-SQL path in DocumentService.batch_update_document_status."""

    def test_batch_update_invalid_action_error(self):
        """Raise ValueError when action is outside allowed values."""
        # Arrange
        dataset = DocumentBatchUpdateUnitDataFactory.create_dataset_mock()
        user = DocumentBatchUpdateUnitDataFactory.create_user_mock()
        document_ids = ["document-123"]

        # Act / Assert
        with pytest.raises(ValueError, match="Invalid action"):
            DocumentService.batch_update_document_status(
                dataset=dataset,
                document_ids=document_ids,
                action="invalid_action",
                user=user,
            )
