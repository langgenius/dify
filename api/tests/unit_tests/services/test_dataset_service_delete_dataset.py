from unittest.mock import Mock, patch

import pytest

from models.account import Account, TenantAccountRole
from models.dataset import Dataset
from services.dataset_service import DatasetService


class DatasetDeleteTestDataFactory:
    """Factory class for creating test data and mock objects for dataset delete tests."""

    @staticmethod
    def create_dataset_mock(
        dataset_id: str = "dataset-123",
        tenant_id: str = "test-tenant-123",
        created_by: str = "creator-456",
        doc_form: str | None = None,
        indexing_technique: str | None = "high_quality",
        **kwargs,
    ) -> Mock:
        """Create a mock dataset with specified attributes."""
        dataset = Mock(spec=Dataset)
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.created_by = created_by
        dataset.doc_form = doc_form
        dataset.indexing_technique = indexing_technique
        for key, value in kwargs.items():
            setattr(dataset, key, value)
        return dataset

    @staticmethod
    def create_user_mock(
        user_id: str = "user-789",
        tenant_id: str = "test-tenant-123",
        role: TenantAccountRole = TenantAccountRole.ADMIN,
        **kwargs,
    ) -> Mock:
        """Create a mock user with specified attributes."""
        user = Mock(spec=Account)
        user.id = user_id
        user.current_tenant_id = tenant_id
        user.current_role = role
        for key, value in kwargs.items():
            setattr(user, key, value)
        return user


class TestDatasetServiceDeleteDataset:
    """
    Comprehensive unit tests for DatasetService.delete_dataset method.

    This test suite covers all deletion scenarios including:
    - Normal dataset deletion with documents
    - Empty dataset deletion (no documents, doc_form is None)
    - Dataset deletion with missing indexing_technique
    - Permission checks
    - Event handling

    This test suite provides regression protection for issue #27073.
    """

    @pytest.fixture
    def mock_dataset_service_dependencies(self):
        """Common mock setup for dataset service dependencies."""
        with (
            patch("services.dataset_service.DatasetService.get_dataset") as mock_get_dataset,
            patch("services.dataset_service.DatasetService.check_dataset_permission") as mock_check_perm,
            patch("extensions.ext_database.db.session") as mock_db,
            patch("services.dataset_service.dataset_was_deleted") as mock_dataset_was_deleted,
        ):
            yield {
                "get_dataset": mock_get_dataset,
                "check_permission": mock_check_perm,
                "db_session": mock_db,
                "dataset_was_deleted": mock_dataset_was_deleted,
            }

    def test_delete_dataset_with_documents_success(self, mock_dataset_service_dependencies):
        """
        Test successful deletion of a dataset with documents.

        This test verifies:
        - Dataset is retrieved correctly
        - Permission check is performed
        - dataset_was_deleted event is sent
        - Dataset is deleted from database
        - Method returns True
        """
        # Arrange
        dataset = DatasetDeleteTestDataFactory.create_dataset_mock(
            doc_form="text_model", indexing_technique="high_quality"
        )
        user = DatasetDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert
        assert result is True
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset.id)
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_empty_dataset_success(self, mock_dataset_service_dependencies):
        """
        Test successful deletion of an empty dataset (no documents, doc_form is None).

        This test verifies that:
        - Empty datasets can be deleted without errors
        - dataset_was_deleted event is sent (event handler will skip cleanup if doc_form is None)
        - Dataset is deleted from database
        - Method returns True

        This is the primary test for issue #27073 where deleting an empty dataset
        caused internal server error due to assertion failure in event handlers.
        """
        # Arrange
        dataset = DatasetDeleteTestDataFactory.create_dataset_mock(doc_form=None, indexing_technique=None)
        user = DatasetDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert - Verify complete deletion flow
        assert result is True
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset.id)
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_dataset_with_partial_none_values(self, mock_dataset_service_dependencies):
        """
        Test deletion of dataset with partial None values.

        This test verifies that datasets with partial None values (e.g., doc_form exists
        but indexing_technique is None) can be deleted successfully. The event handler
        will skip cleanup if any required field is None.

        Improvement based on Gemini Code Assist suggestion: Added comprehensive assertions
        to verify all core deletion operations are performed, not just event sending.
        """
        # Arrange
        dataset = DatasetDeleteTestDataFactory.create_dataset_mock(doc_form="text_model", indexing_technique=None)
        user = DatasetDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert - Verify complete deletion flow (Gemini suggestion implemented)
        assert result is True
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset.id)
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_dataset_with_doc_form_none_indexing_technique_exists(self, mock_dataset_service_dependencies):
        """
        Test deletion of dataset where doc_form is None but indexing_technique exists.

        This edge case can occur in certain dataset configurations and should be handled
        gracefully by the event handler's conditional check.
        """
        # Arrange
        dataset = DatasetDeleteTestDataFactory.create_dataset_mock(doc_form=None, indexing_technique="high_quality")
        user = DatasetDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = dataset

        # Act
        result = DatasetService.delete_dataset(dataset.id, user)

        # Assert - Verify complete deletion flow
        assert result is True
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset.id)
        mock_dataset_service_dependencies["check_permission"].assert_called_once_with(dataset, user)
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].delete.assert_called_once_with(dataset)
        mock_dataset_service_dependencies["db_session"].commit.assert_called_once()

    def test_delete_dataset_not_found(self, mock_dataset_service_dependencies):
        """
        Test deletion attempt when dataset doesn't exist.

        This test verifies that:
        - Method returns False when dataset is not found
        - No deletion operations are performed
        - No events are sent
        """
        # Arrange
        dataset_id = "non-existent-dataset"
        user = DatasetDeleteTestDataFactory.create_user_mock()

        mock_dataset_service_dependencies["get_dataset"].return_value = None

        # Act
        result = DatasetService.delete_dataset(dataset_id, user)

        # Assert
        assert result is False
        mock_dataset_service_dependencies["get_dataset"].assert_called_once_with(dataset_id)
        mock_dataset_service_dependencies["check_permission"].assert_not_called()
        mock_dataset_service_dependencies["dataset_was_deleted"].send.assert_not_called()
        mock_dataset_service_dependencies["db_session"].delete.assert_not_called()
        mock_dataset_service_dependencies["db_session"].commit.assert_not_called()
