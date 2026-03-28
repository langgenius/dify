"""Unit tests for non-SQL validation in DocumentService status management methods."""

from unittest.mock import Mock, create_autospec

import pytest

from models import Account
from models.dataset import Dataset
from services.dataset_service import DocumentService


class DocumentStatusTestDataFactory:
    """Factory class for creating test data and mock objects for document status tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "tenant-123",
        name: str = "Test Dataset",
        built_in_field_enabled: bool = False,
        **kwargs,
    ) -> Mock:
        """Create a mock Dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.name = name
        dataset.built_in_field_enabled = built_in_field_enabled
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-123",
        tenant_id: str = "tenant-123",
        **kwargs,
    ) -> Mock:
        """Create a mock user (Account) with specified attributes."""
        user = create_autospec(Account, instance=True)
        user.id = user_id
        user.current_tenant_id = tenant_id
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user


class TestDocumentServiceBatchUpdateDocumentStatus:
    """Unit tests for non-SQL path in DocumentService.batch_update_document_status."""

    def test_batch_update_document_status_invalid_action_error(self):
        """
        Test error handling for invalid action.

        Verifies that when an invalid action is provided, a ValueError
        is raised.

        This test ensures:
        - Invalid actions are rejected
        - Error message is clear
        - Error type is correct
        """
        # Arrange
        dataset = DocumentStatusTestDataFactory.create_dataset_mock()
        user = DocumentStatusTestDataFactory.create_user_mock()
        document_ids = ["document-123"]

        # Act & Assert
        with pytest.raises(ValueError, match="Invalid action"):
            DocumentService.batch_update_document_status(dataset, document_ids, "invalid_action", user)
