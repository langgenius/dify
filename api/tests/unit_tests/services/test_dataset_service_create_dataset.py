"""Unit tests for non-SQL validation paths in DatasetService dataset creation."""

from unittest.mock import Mock, patch
from uuid import uuid4

import pytest

from services.dataset_service import DatasetService
from services.entities.knowledge_entities.rag_pipeline_entities import IconInfo, RagPipelineDatasetCreateEntity


class TestDatasetServiceCreateRagPipelineDatasetNonSQL:
    """Unit coverage for non-SQL validation in create_empty_rag_pipeline_dataset."""

    @pytest.fixture
    def mock_rag_pipeline_dependencies(self):
        """Patch database session and current_user for validation-only unit coverage."""
        with (
            patch("services.dataset_service.db.session") as mock_db,
            patch("services.dataset_service.current_user") as mock_current_user,
        ):
            yield {
                "db_session": mock_db,
                "current_user_mock": mock_current_user,
            }

    def test_create_rag_pipeline_dataset_missing_current_user_error(self, mock_rag_pipeline_dependencies):
        """Raise ValueError when current_user.id is unavailable before SQL persistence."""
        # Arrange
        tenant_id = str(uuid4())
        mock_rag_pipeline_dependencies["current_user_mock"].id = None

        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = None
        mock_rag_pipeline_dependencies["db_session"].query.return_value = mock_query

        icon_info = IconInfo(icon="📙", icon_background="#FFF4ED", icon_type="emoji")
        entity = RagPipelineDatasetCreateEntity(
            name="Test Dataset",
            description="",
            icon_info=icon_info,
            permission="only_me",
        )

        # Act / Assert
        with pytest.raises(ValueError, match="Current user or current user id not found"):
            DatasetService.create_empty_rag_pipeline_dataset(
                tenant_id=tenant_id,
                rag_pipeline_dataset_create_entity=entity,
            )
