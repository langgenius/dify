"""Unit tests for Service API dataset request payloads."""

from typing import Literal

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
from models.dataset import DatasetPermissionEnum


class TestDatasetCreatePayload:
    """Test suite for DatasetCreatePayload Pydantic model."""

    def test_payload_with_required_name(self) -> None:
        payload = DatasetCreatePayload(name="Test Dataset")
        assert payload.name == "Test Dataset"
        assert payload.description == ""
        assert payload.permission == DatasetPermissionEnum.ONLY_ME

    def test_payload_with_all_fields(self) -> None:
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

    def test_payload_name_length_validation_min(self) -> None:
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="")

    def test_payload_name_length_validation_max(self) -> None:
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="A" * 41)

    def test_payload_description_max_length(self) -> None:
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="Dataset", description="A" * 401)

    @pytest.mark.parametrize("technique", ["high_quality", "economy"])
    def test_payload_valid_indexing_techniques(self, technique: Literal["high_quality", "economy"]) -> None:
        payload = DatasetCreatePayload(name="Dataset", indexing_technique=technique)
        assert payload.indexing_technique == technique

    def test_payload_with_external_knowledge_settings(self) -> None:
        payload = DatasetCreatePayload(
            name="External Dataset", external_knowledge_api_id="api_123", external_knowledge_id="knowledge_456"
        )
        assert payload.external_knowledge_api_id == "api_123"
        assert payload.external_knowledge_id == "knowledge_456"


class TestDatasetUpdatePayload:
    """Test suite for DatasetUpdatePayload Pydantic model."""

    def test_payload_all_optional(self) -> None:
        payload = DatasetUpdatePayload()
        assert payload.name is None
        assert payload.description is None
        assert payload.permission is None

    def test_payload_with_partial_update(self) -> None:
        payload = DatasetUpdatePayload(name="Updated Name", description="Updated description")
        assert payload.name == "Updated Name"
        assert payload.description == "Updated description"

    def test_payload_with_permission_change(self) -> None:
        payload = DatasetUpdatePayload(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            partial_member_list=[{"user_id": "user_123", "role": "editor"}],
        )
        assert payload.permission == DatasetPermissionEnum.PARTIAL_TEAM
        assert payload.partial_member_list is not None
        assert len(payload.partial_member_list) == 1

    def test_payload_name_length_validation(self) -> None:
        with pytest.raises(ValueError):
            DatasetUpdatePayload(name="")
        with pytest.raises(ValueError):
            DatasetUpdatePayload(name="A" * 41)


class TestDatasetListQuery:
    """Test suite for DatasetListQuery Pydantic model."""

    def test_query_with_defaults(self) -> None:
        query = DatasetListQuery()
        assert query.page == 1
        assert query.limit == 20
        assert query.keyword is None
        assert query.include_all is False
        assert query.tag_ids == []

    def test_query_with_all_filters(self) -> None:
        query = DatasetListQuery(
            page=3, limit=50, keyword="machine learning", include_all=True, tag_ids=["tag1", "tag2", "tag3"]
        )
        assert query.page == 3
        assert query.limit == 50
        assert query.keyword == "machine learning"
        assert query.include_all is True
        assert len(query.tag_ids) == 3

    def test_query_with_tag_filter(self) -> None:
        query = DatasetListQuery(tag_ids=["tag_abc", "tag_def"])
        assert query.tag_ids == ["tag_abc", "tag_def"]


class TestTagCreatePayload:
    """Test suite for TagCreatePayload Pydantic model."""

    def test_payload_with_name(self) -> None:
        payload = TagCreatePayload(name="New Tag")
        assert payload.name == "New Tag"

    def test_payload_name_length_min(self) -> None:
        with pytest.raises(ValueError):
            TagCreatePayload(name="")

    def test_payload_name_length_max(self) -> None:
        with pytest.raises(ValueError):
            TagCreatePayload(name="A" * 51)

    def test_payload_with_unicode_name(self) -> None:
        payload = TagCreatePayload(name="标签 🏷️ Тег")
        assert payload.name == "标签 🏷️ Тег"


class TestTagUpdatePayload:
    """Test suite for TagUpdatePayload Pydantic model."""

    def test_payload_with_name_and_id(self) -> None:
        payload = TagUpdatePayload(name="Updated Tag", tag_id="tag_123")
        assert payload.name == "Updated Tag"
        assert payload.tag_id == "tag_123"

    def test_payload_requires_tag_id(self) -> None:
        with pytest.raises(ValueError):
            TagUpdatePayload.model_validate({"name": "Updated Tag"})


class TestTagDeletePayload:
    """Test suite for TagDeletePayload Pydantic model."""

    def test_payload_with_tag_id(self) -> None:
        payload = TagDeletePayload(tag_id="tag_to_delete")
        assert payload.tag_id == "tag_to_delete"

    def test_payload_requires_tag_id(self) -> None:
        with pytest.raises(ValueError):
            TagDeletePayload.model_validate({})


class TestTagBindingPayload:
    """Test suite for TagBindingPayload Pydantic model."""

    def test_payload_with_valid_data(self) -> None:
        payload = TagBindingPayload(tag_ids=["tag1", "tag2"], target_id="dataset_123")
        assert len(payload.tag_ids) == 2
        assert payload.target_id == "dataset_123"

    def test_payload_rejects_empty_tag_ids(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            TagBindingPayload(tag_ids=[], target_id="dataset_123")
        assert "Tag IDs is required" in str(exc_info.value)

    def test_payload_single_tag_id(self) -> None:
        payload = TagBindingPayload(tag_ids=["single_tag"], target_id="dataset_456")
        assert payload.tag_ids == ["single_tag"]


class TestTagUnbindingPayload:
    """Test suite for TagUnbindingPayload Pydantic model."""

    def test_payload_with_valid_data(self) -> None:
        payload = TagUnbindingPayload(tag_ids=["tag_123"], target_id="dataset_456")
        assert payload.tag_ids == ["tag_123"]
        assert payload.target_id == "dataset_456"

    def test_payload_normalizes_legacy_tag_id(self) -> None:
        payload = TagUnbindingPayload(tag_id="tag_123", target_id="dataset_456")
        assert payload.tag_ids == ["tag_123"]
        assert payload.target_id == "dataset_456"

    def test_payload_rejects_empty_tag_ids(self) -> None:
        with pytest.raises(ValueError) as exc_info:
            TagUnbindingPayload(tag_ids=[], target_id="dataset_456")
        assert "Tag IDs is required" in str(exc_info.value)
