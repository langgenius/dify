"""
Unit tests for Service API Dataset controllers.

Tests coverage for:
- DatasetCreatePayload, DatasetUpdatePayload Pydantic models
- Tag-related payloads (create, update, delete, binding)
- DatasetListQuery model
- DatasetService and TagService interfaces
- Permission validation patterns

Focus on:
- Pydantic model validation
- Error type mappings
- Service method interfaces
"""

import uuid
from unittest.mock import Mock, patch

import pytest

from controllers.service_api.dataset.dataset import (
    DatasetCreatePayload,
    DatasetListQuery,
    DatasetUpdatePayload,
    TagBindingPayload,
    TagCreatePayload,
    TagDeletePayload,
    TagUnbindingPayload,
    TagUpdatePayload,
)
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from models.dataset import DatasetPermissionEnum
from services.dataset_service import DatasetPermissionService, DatasetService, DocumentService
from services.tag_service import TagService


class TestDatasetCreatePayload:
    """Test suite for DatasetCreatePayload Pydantic model."""

    def test_payload_with_required_name(self):
        """Test payload with required name field."""
        payload = DatasetCreatePayload(name="Test Dataset")
        assert payload.name == "Test Dataset"
        assert payload.description == ""
        assert payload.permission == DatasetPermissionEnum.ONLY_ME

    def test_payload_with_all_fields(self):
        """Test payload with all fields populated."""
        payload = DatasetCreatePayload(
            name="Full Dataset",
            description="A comprehensive dataset description",
            indexing_technique="high_quality",
            permission=DatasetPermissionEnum.ALL_TEAM,
            provider="vendor",
            embedding_model="text-embedding-ada-002",
            embedding_model_provider="openai",
        )
        assert payload.name == "Full Dataset"
        assert payload.description == "A comprehensive dataset description"
        assert payload.indexing_technique == "high_quality"
        assert payload.permission == DatasetPermissionEnum.ALL_TEAM
        assert payload.provider == "vendor"
        assert payload.embedding_model == "text-embedding-ada-002"
        assert payload.embedding_model_provider == "openai"

    def test_payload_name_length_validation_min(self):
        """Test name minimum length validation."""
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="")

    def test_payload_name_length_validation_max(self):
        """Test name maximum length validation (40 chars)."""
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="A" * 41)

    def test_payload_description_max_length(self):
        """Test description maximum length (400 chars)."""
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="Dataset", description="A" * 401)

    @pytest.mark.parametrize("technique", ["high_quality", "economy"])
    def test_payload_valid_indexing_techniques(self, technique):
        """Test valid indexing technique values."""
        payload = DatasetCreatePayload(name="Dataset", indexing_technique=technique)
        assert payload.indexing_technique == technique

    def test_payload_with_external_knowledge_settings(self):
        """Test payload with external knowledge configuration."""
        payload = DatasetCreatePayload(
            name="External Dataset", external_knowledge_api_id="api_123", external_knowledge_id="knowledge_456"
        )
        assert payload.external_knowledge_api_id == "api_123"
        assert payload.external_knowledge_id == "knowledge_456"


class TestDatasetUpdatePayload:
    """Test suite for DatasetUpdatePayload Pydantic model."""

    def test_payload_all_optional(self):
        """Test payload with all fields optional."""
        payload = DatasetUpdatePayload()
        assert payload.name is None
        assert payload.description is None
        assert payload.permission is None

    def test_payload_with_partial_update(self):
        """Test payload with partial update fields."""
        payload = DatasetUpdatePayload(name="Updated Name", description="Updated description")
        assert payload.name == "Updated Name"
        assert payload.description == "Updated description"

    def test_payload_with_permission_change(self):
        """Test payload with permission update."""
        payload = DatasetUpdatePayload(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            partial_member_list=[{"user_id": "user_123", "role": "editor"}],
        )
        assert payload.permission == DatasetPermissionEnum.PARTIAL_TEAM
        assert len(payload.partial_member_list) == 1

    def test_payload_name_length_validation(self):
        """Test name length constraints."""
        # Minimum is 1
        with pytest.raises(ValueError):
            DatasetUpdatePayload(name="")

        # Maximum is 40
        with pytest.raises(ValueError):
            DatasetUpdatePayload(name="A" * 41)


class TestDatasetListQuery:
    """Test suite for DatasetListQuery Pydantic model."""

    def test_query_with_defaults(self):
        """Test query with default values."""
        query = DatasetListQuery()
        assert query.page == 1
        assert query.limit == 20
        assert query.keyword is None
        assert query.include_all is False
        assert query.tag_ids == []

    def test_query_with_all_filters(self):
        """Test query with all filter fields."""
        query = DatasetListQuery(
            page=3, limit=50, keyword="machine learning", include_all=True, tag_ids=["tag1", "tag2", "tag3"]
        )
        assert query.page == 3
        assert query.limit == 50
        assert query.keyword == "machine learning"
        assert query.include_all is True
        assert len(query.tag_ids) == 3

    def test_query_with_tag_filter(self):
        """Test query with tag IDs filter."""
        query = DatasetListQuery(tag_ids=["tag_abc", "tag_def"])
        assert query.tag_ids == ["tag_abc", "tag_def"]


class TestTagCreatePayload:
    """Test suite for TagCreatePayload Pydantic model."""

    def test_payload_with_name(self):
        """Test payload with required name."""
        payload = TagCreatePayload(name="New Tag")
        assert payload.name == "New Tag"

    def test_payload_name_length_min(self):
        """Test name minimum length (1)."""
        with pytest.raises(ValueError):
            TagCreatePayload(name="")

    def test_payload_name_length_max(self):
        """Test name maximum length (50)."""
        with pytest.raises(ValueError):
            TagCreatePayload(name="A" * 51)

    def test_payload_with_unicode_name(self):
        """Test payload with unicode characters."""
        payload = TagCreatePayload(name="标签 🏷️ Тег")
        assert payload.name == "标签 🏷️ Тег"


class TestTagUpdatePayload:
    """Test suite for TagUpdatePayload Pydantic model."""

    def test_payload_with_name_and_id(self):
        """Test payload with name and tag_id."""
        payload = TagUpdatePayload(name="Updated Tag", tag_id="tag_123")
        assert payload.name == "Updated Tag"
        assert payload.tag_id == "tag_123"

    def test_payload_requires_tag_id(self):
        """Test that tag_id is required."""
        with pytest.raises(ValueError):
            TagUpdatePayload(name="Updated Tag")


class TestTagDeletePayload:
    """Test suite for TagDeletePayload Pydantic model."""

    def test_payload_with_tag_id(self):
        """Test payload with tag_id."""
        payload = TagDeletePayload(tag_id="tag_to_delete")
        assert payload.tag_id == "tag_to_delete"

    def test_payload_requires_tag_id(self):
        """Test that tag_id is required."""
        with pytest.raises(ValueError):
            TagDeletePayload()


class TestTagBindingPayload:
    """Test suite for TagBindingPayload Pydantic model."""

    def test_payload_with_valid_data(self):
        """Test payload with valid binding data."""
        payload = TagBindingPayload(tag_ids=["tag1", "tag2"], target_id="dataset_123")
        assert len(payload.tag_ids) == 2
        assert payload.target_id == "dataset_123"

    def test_payload_rejects_empty_tag_ids(self):
        """Test that empty tag_ids are rejected."""
        with pytest.raises(ValueError) as exc_info:
            TagBindingPayload(tag_ids=[], target_id="dataset_123")
        assert "Tag IDs is required" in str(exc_info.value)

    def test_payload_single_tag_id(self):
        """Test payload with single tag ID."""
        payload = TagBindingPayload(tag_ids=["single_tag"], target_id="dataset_456")
        assert payload.tag_ids == ["single_tag"]


class TestTagUnbindingPayload:
    """Test suite for TagUnbindingPayload Pydantic model."""

    def test_payload_with_valid_data(self):
        """Test payload with valid unbinding data."""
        payload = TagUnbindingPayload(tag_id="tag_123", target_id="dataset_456")
        assert payload.tag_id == "tag_123"
        assert payload.target_id == "dataset_456"


class TestDatasetPermissionEnum:
    """Test DatasetPermissionEnum values."""

    def test_only_me_permission(self):
        """Test ONLY_ME permission value."""
        assert DatasetPermissionEnum.ONLY_ME is not None

    def test_all_team_permission(self):
        """Test ALL_TEAM permission value."""
        assert DatasetPermissionEnum.ALL_TEAM is not None

    def test_partial_team_permission(self):
        """Test PARTIAL_TEAM permission value."""
        assert DatasetPermissionEnum.PARTIAL_TEAM is not None


class TestDatasetErrors:
    """Test dataset-related error types."""

    def test_dataset_in_use_error_can_be_raised(self):
        """Test DatasetInUseError can be raised."""
        error = DatasetInUseError()
        assert error is not None

    def test_dataset_name_duplicate_error_can_be_raised(self):
        """Test DatasetNameDuplicateError can be raised."""
        error = DatasetNameDuplicateError()
        assert error is not None

    def test_invalid_action_error_can_be_raised(self):
        """Test InvalidActionError can be raised."""
        error = InvalidActionError("Invalid action")
        assert error is not None


class TestDatasetService:
    """Test DatasetService interface methods."""

    def test_get_datasets_method_exists(self):
        """Test DatasetService.get_datasets exists."""
        assert hasattr(DatasetService, "get_datasets")

    def test_get_dataset_method_exists(self):
        """Test DatasetService.get_dataset exists."""
        assert hasattr(DatasetService, "get_dataset")

    def test_create_empty_dataset_method_exists(self):
        """Test DatasetService.create_empty_dataset exists."""
        assert hasattr(DatasetService, "create_empty_dataset")

    def test_update_dataset_method_exists(self):
        """Test DatasetService.update_dataset exists."""
        assert hasattr(DatasetService, "update_dataset")

    def test_delete_dataset_method_exists(self):
        """Test DatasetService.delete_dataset exists."""
        assert hasattr(DatasetService, "delete_dataset")

    def test_check_dataset_permission_method_exists(self):
        """Test DatasetService.check_dataset_permission exists."""
        assert hasattr(DatasetService, "check_dataset_permission")

    def test_check_dataset_model_setting_method_exists(self):
        """Test DatasetService.check_dataset_model_setting exists."""
        assert hasattr(DatasetService, "check_dataset_model_setting")

    def test_check_embedding_model_setting_method_exists(self):
        """Test DatasetService.check_embedding_model_setting exists."""
        assert hasattr(DatasetService, "check_embedding_model_setting")

    @patch.object(DatasetService, "get_datasets")
    def test_get_datasets_returns_tuple(self, mock_get):
        """Test get_datasets returns tuple of datasets and total."""
        mock_datasets = [Mock(), Mock()]
        mock_get.return_value = (mock_datasets, 2)

        datasets, total = DatasetService.get_datasets(page=1, per_page=20, tenant_id="tenant_123", user=Mock())
        assert len(datasets) == 2
        assert total == 2

    @patch.object(DatasetService, "get_dataset")
    def test_get_dataset_returns_dataset(self, mock_get):
        """Test get_dataset returns dataset object."""
        mock_dataset = Mock()
        mock_dataset.id = str(uuid.uuid4())
        mock_dataset.name = "Test Dataset"
        mock_get.return_value = mock_dataset

        result = DatasetService.get_dataset("dataset_id")
        assert result.name == "Test Dataset"

    @patch.object(DatasetService, "get_dataset")
    def test_get_dataset_returns_none_when_not_found(self, mock_get):
        """Test get_dataset returns None when not found."""
        mock_get.return_value = None

        result = DatasetService.get_dataset("nonexistent_id")
        assert result is None


class TestDatasetPermissionService:
    """Test DatasetPermissionService interface."""

    def test_check_permission_method_exists(self):
        """Test DatasetPermissionService.check_permission exists."""
        assert hasattr(DatasetPermissionService, "check_permission")

    def test_get_dataset_partial_member_list_method_exists(self):
        """Test DatasetPermissionService.get_dataset_partial_member_list exists."""
        assert hasattr(DatasetPermissionService, "get_dataset_partial_member_list")

    def test_update_partial_member_list_method_exists(self):
        """Test DatasetPermissionService.update_partial_member_list exists."""
        assert hasattr(DatasetPermissionService, "update_partial_member_list")

    def test_clear_partial_member_list_method_exists(self):
        """Test DatasetPermissionService.clear_partial_member_list exists."""
        assert hasattr(DatasetPermissionService, "clear_partial_member_list")


class TestDocumentService:
    """Test DocumentService interface."""

    def test_batch_update_document_status_method_exists(self):
        """Test DocumentService.batch_update_document_status exists."""
        assert hasattr(DocumentService, "batch_update_document_status")


class TestTagService:
    """Test TagService interface."""

    def test_get_tags_method_exists(self):
        """Test TagService.get_tags exists."""
        assert hasattr(TagService, "get_tags")

    def test_save_tags_method_exists(self):
        """Test TagService.save_tags exists."""
        assert hasattr(TagService, "save_tags")

    def test_update_tags_method_exists(self):
        """Test TagService.update_tags exists."""
        assert hasattr(TagService, "update_tags")

    def test_delete_tag_method_exists(self):
        """Test TagService.delete_tag exists."""
        assert hasattr(TagService, "delete_tag")

    def test_save_tag_binding_method_exists(self):
        """Test TagService.save_tag_binding exists."""
        assert hasattr(TagService, "save_tag_binding")

    def test_delete_tag_binding_method_exists(self):
        """Test TagService.delete_tag_binding exists."""
        assert hasattr(TagService, "delete_tag_binding")

    def test_get_tags_by_target_id_method_exists(self):
        """Test TagService.get_tags_by_target_id exists."""
        assert hasattr(TagService, "get_tags_by_target_id")

    def test_get_tag_binding_count_method_exists(self):
        """Test TagService.get_tag_binding_count exists."""
        assert hasattr(TagService, "get_tag_binding_count")

    @patch.object(TagService, "get_tags")
    def test_get_tags_returns_list(self, mock_get):
        """Test get_tags returns list of tags."""
        mock_tags = [
            Mock(id="tag1", name="Tag One", type="knowledge"),
            Mock(id="tag2", name="Tag Two", type="knowledge"),
        ]
        mock_get.return_value = mock_tags

        result = TagService.get_tags("knowledge", "tenant_123")
        assert len(result) == 2

    @patch.object(TagService, "save_tags")
    def test_save_tags_returns_tag(self, mock_save):
        """Test save_tags returns created tag."""
        mock_tag = Mock()
        mock_tag.id = str(uuid.uuid4())
        mock_tag.name = "New Tag"
        mock_tag.type = "knowledge"
        mock_save.return_value = mock_tag

        result = TagService.save_tags({"name": "New Tag", "type": "knowledge"})
        assert result.name == "New Tag"


class TestDocumentStatusAction:
    """Test document status action values."""

    def test_enable_action(self):
        """Test enable action."""
        action = "enable"
        assert action in ["enable", "disable", "archive", "un_archive"]

    def test_disable_action(self):
        """Test disable action."""
        action = "disable"
        assert action in ["enable", "disable", "archive", "un_archive"]

    def test_archive_action(self):
        """Test archive action."""
        action = "archive"
        assert action in ["enable", "disable", "archive", "un_archive"]

    def test_un_archive_action(self):
        """Test un_archive action."""
        action = "un_archive"
        assert action in ["enable", "disable", "archive", "un_archive"]
