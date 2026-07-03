"""
Integration tests for Service API Dataset controllers.

Migrated from unit_tests/controllers/service_api/dataset/test_dataset.py.

Tests coverage for:
- DatasetCreatePayload, DatasetUpdatePayload Pydantic models
- Tag-related payloads (create, update, delete, binding)
- DatasetListQuery model
- API endpoint error handling and controller behavior

Services (DatasetService, TagService, DocumentService) remain mocked
since these test controller-level behavior.
"""

import uuid
from contextlib import ExitStack
from datetime import UTC, datetime
from unittest.mock import ANY, Mock, PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Forbidden, NotFound


class SessionMatcher:
    def __eq__(self, other):
        return isinstance(other, (Session, scoped_session))


import services
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
from models.account import Account
from models.dataset import Dataset, DatasetPermissionEnum
from models.enums import TagType
from models.model import Tag

# ---------------------------------------------------------------------------
# Pydantic model validation tests
# ---------------------------------------------------------------------------


class TestDatasetCreatePayload:
    """Test suite for DatasetCreatePayload Pydantic model."""

    def test_payload_with_required_name(self):
        payload = DatasetCreatePayload(name="Test Dataset")
        assert payload.name == "Test Dataset"
        assert payload.description == ""
        assert payload.permission == DatasetPermissionEnum.ONLY_ME

    def test_payload_with_all_fields(self):
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
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="")

    def test_payload_name_length_validation_max(self):
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="A" * 41)

    def test_payload_description_max_length(self):
        with pytest.raises(ValueError):
            DatasetCreatePayload(name="Dataset", description="A" * 401)

    @pytest.mark.parametrize("technique", ["high_quality", "economy"])
    def test_payload_valid_indexing_techniques(self, technique):
        payload = DatasetCreatePayload(name="Dataset", indexing_technique=technique)
        assert payload.indexing_technique == technique

    def test_payload_with_external_knowledge_settings(self):
        payload = DatasetCreatePayload(
            name="External Dataset", external_knowledge_api_id="api_123", external_knowledge_id="knowledge_456"
        )
        assert payload.external_knowledge_api_id == "api_123"
        assert payload.external_knowledge_id == "knowledge_456"


class TestDatasetUpdatePayload:
    """Test suite for DatasetUpdatePayload Pydantic model."""

    def test_payload_all_optional(self):
        payload = DatasetUpdatePayload()
        assert payload.name is None
        assert payload.description is None
        assert payload.permission is None

    def test_payload_with_partial_update(self):
        payload = DatasetUpdatePayload(name="Updated Name", description="Updated description")
        assert payload.name == "Updated Name"
        assert payload.description == "Updated description"

    def test_payload_with_permission_change(self):
        payload = DatasetUpdatePayload(
            permission=DatasetPermissionEnum.PARTIAL_TEAM,
            partial_member_list=[{"user_id": "user_123", "role": "editor"}],
        )
        assert payload.permission == DatasetPermissionEnum.PARTIAL_TEAM
        assert payload.partial_member_list is not None
        assert len(payload.partial_member_list) == 1

    def test_payload_name_length_validation(self):
        with pytest.raises(ValueError):
            DatasetUpdatePayload(name="")
        with pytest.raises(ValueError):
            DatasetUpdatePayload(name="A" * 41)


class TestDatasetListQuery:
    """Test suite for DatasetListQuery Pydantic model."""

    def test_query_with_defaults(self):
        query = DatasetListQuery()
        assert query.page == 1
        assert query.limit == 20
        assert query.keyword is None
        assert query.include_all is False
        assert query.tag_ids == []

    def test_query_with_all_filters(self):
        query = DatasetListQuery(
            page=3, limit=50, keyword="machine learning", include_all=True, tag_ids=["tag1", "tag2", "tag3"]
        )
        assert query.page == 3
        assert query.limit == 50
        assert query.keyword == "machine learning"
        assert query.include_all is True
        assert len(query.tag_ids) == 3

    def test_query_with_tag_filter(self):
        query = DatasetListQuery(tag_ids=["tag_abc", "tag_def"])
        assert query.tag_ids == ["tag_abc", "tag_def"]


class TestTagCreatePayload:
    """Test suite for TagCreatePayload Pydantic model."""

    def test_payload_with_name(self):
        payload = TagCreatePayload(name="New Tag")
        assert payload.name == "New Tag"

    def test_payload_name_length_min(self):
        with pytest.raises(ValueError):
            TagCreatePayload(name="")

    def test_payload_name_length_max(self):
        with pytest.raises(ValueError):
            TagCreatePayload(name="A" * 51)

    def test_payload_with_unicode_name(self):
        payload = TagCreatePayload(name="标签 🏷️ Тег")
        assert payload.name == "标签 🏷️ Тег"


class TestTagUpdatePayload:
    """Test suite for TagUpdatePayload Pydantic model."""

    def test_payload_with_name_and_id(self):
        payload = TagUpdatePayload(name="Updated Tag", tag_id="tag_123")
        assert payload.name == "Updated Tag"
        assert payload.tag_id == "tag_123"

    def test_payload_requires_tag_id(self):
        with pytest.raises(ValueError):
            TagUpdatePayload.model_validate({"name": "Updated Tag"})


class TestTagDeletePayload:
    """Test suite for TagDeletePayload Pydantic model."""

    def test_payload_with_tag_id(self):
        payload = TagDeletePayload(tag_id="tag_to_delete")
        assert payload.tag_id == "tag_to_delete"

    def test_payload_requires_tag_id(self):
        with pytest.raises(ValueError):
            TagDeletePayload.model_validate({})


class TestTagBindingPayload:
    """Test suite for TagBindingPayload Pydantic model."""

    def test_payload_with_valid_data(self):
        payload = TagBindingPayload(tag_ids=["tag1", "tag2"], target_id="dataset_123")
        assert len(payload.tag_ids) == 2
        assert payload.target_id == "dataset_123"

    def test_payload_rejects_empty_tag_ids(self):
        with pytest.raises(ValueError) as exc_info:
            TagBindingPayload(tag_ids=[], target_id="dataset_123")
        assert "Tag IDs is required" in str(exc_info.value)

    def test_payload_single_tag_id(self):
        payload = TagBindingPayload(tag_ids=["single_tag"], target_id="dataset_456")
        assert payload.tag_ids == ["single_tag"]


class TestTagUnbindingPayload:
    """Test suite for TagUnbindingPayload Pydantic model."""

    def test_payload_with_valid_data(self):
        payload = TagUnbindingPayload(tag_ids=["tag_123"], target_id="dataset_456")
        assert payload.tag_ids == ["tag_123"]
        assert payload.target_id == "dataset_456"

    def test_payload_normalizes_legacy_tag_id(self):
        payload = TagUnbindingPayload(tag_id="tag_123", target_id="dataset_456")
        assert payload.tag_ids == ["tag_123"]
        assert payload.target_id == "dataset_456"

    def test_payload_rejects_empty_tag_ids(self):
        with pytest.raises(ValueError) as exc_info:
            TagUnbindingPayload(tag_ids=[], target_id="dataset_456")
        assert "Tag IDs is required" in str(exc_info.value)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

from inspect import unwrap


@pytest.fixture
def app(flask_app_with_containers: Flask):
    # Uses the full containerised app so that Flask config, extensions, and
    # blueprint registrations match production.  Most tests mock the service
    # layer to isolate controller logic; a few (e.g. test_list_tags_from_db)
    # exercise the real DB-backed path to validate end-to-end behaviour.
    return flask_app_with_containers


@pytest.fixture
def mock_tenant():
    tenant = Mock()
    tenant.id = str(uuid.uuid4())
    return tenant


@pytest.fixture
def mock_dataset():
    return make_dataset(id=str(uuid.uuid4()), tenant_id=str(uuid.uuid4()))


@pytest.fixture(autouse=True)
def dataset_model_property_defaults():
    properties: dict[str, object] = {
        "app_count": 0,
        "document_count": 0,
        "word_count": 0,
        "author_name": None,
        "tags": [],
        "doc_form": None,
        "external_knowledge_info": None,
        "doc_metadata": [],
        "is_published": False,
        "total_documents": 0,
        "total_available_documents": 0,
    }

    with ExitStack() as stack:
        for name, value in properties.items():
            property_mock = stack.enter_context(patch.object(Dataset, name, new_callable=PropertyMock))
            property_mock.return_value = value
        yield


def make_dataset(**overrides) -> Dataset:
    base = {
        "id": "ds-1",
        "tenant_id": "tenant-1",
        "name": "Dataset",
        "description": "desc",
        "provider": "vendor",
        "permission": "only_me",
        "data_source_type": None,
        "indexing_technique": "economy",
        "created_by": "account-1",
        "created_at": datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
        "updated_by": None,
        "updated_at": datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC),
        "embedding_model": None,
        "embedding_model_provider": None,
        "retrieval_model": None,
        "summary_index_setting": None,
        "built_in_field_enabled": False,
        "pipeline_id": None,
        "runtime_mode": "general",
        "chunk_structure": None,
        "icon_info": None,
        "enable_api": False,
        "is_multimodal": False,
    }
    base.update(overrides)
    return Dataset(**base)


def make_tag(*, id: str, name: str, binding_count: int | None = None) -> Tag:
    tag = Tag(tenant_id="tenant-1", type=TagType.KNOWLEDGE, name=name, created_by="account-1")
    tag.id = id
    if binding_count is not None:
        tag.__dict__["binding_count"] = binding_count
    return tag


DATASET_DETAIL_KEYS = {
    "id",
    "name",
    "description",
    "provider",
    "permission",
    "data_source_type",
    "indexing_technique",
    "app_count",
    "document_count",
    "word_count",
    "created_by",
    "author_name",
    "created_at",
    "updated_by",
    "updated_at",
    "embedding_model",
    "embedding_model_provider",
    "embedding_available",
    "retrieval_model_dict",
    "summary_index_setting",
    "tags",
    "doc_form",
    "external_knowledge_info",
    "external_retrieval_model",
    "doc_metadata",
    "built_in_field_enabled",
    "pipeline_id",
    "runtime_mode",
    "chunk_structure",
    "icon_info",
    "is_published",
    "total_documents",
    "total_available_documents",
    "enable_api",
    "is_multimodal",
    "maintainer",
}


def assert_dataset_detail_shape(response: dict, *, with_partial_members: bool = False) -> None:
    expected_keys = set(DATASET_DETAIL_KEYS)
    if with_partial_members:
        expected_keys.add("partial_member_list")
    assert set(response) == expected_keys
    assert isinstance(response["created_at"], int)
    assert isinstance(response["updated_at"], int)
    assert set(response["retrieval_model_dict"]) == {
        "search_method",
        "reranking_enable",
        "reranking_mode",
        "reranking_model",
        "weights",
        "top_k",
        "score_threshold_enabled",
        "score_threshold",
    }
    if response["external_retrieval_model"] is not None:
        assert set(response["external_retrieval_model"]) == {
            "top_k",
            "score_threshold",
            "score_threshold_enabled",
        }
    if not with_partial_members:
        assert "partial_member_list" not in response


# ---------------------------------------------------------------------------
# API endpoint tests — DatasetListApi
# ---------------------------------------------------------------------------


class TestDatasetListApiGet:
    """Test suite for DatasetListApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_list_datasets_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        app: Flask,
        mock_tenant,
    ):
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_tenant.id
        mock_dataset_svc.get_datasets.return_value = ([make_dataset()], 1)

        mock_configs = Mock()
        mock_configs.get_models.return_value = []
        mock_provider_mgr.return_value.get_configurations.return_value = mock_configs

        with app.test_request_context("/datasets?page=1&limit=20", method="GET"):
            api = DatasetListApi()
            response, status = api.get(tenant_id=mock_tenant.id)

        assert status == 200
        assert set(response) == {"data", "has_more", "limit", "total", "page"}
        assert response["has_more"] is False
        assert response["limit"] == 20
        assert response["total"] == 1
        assert response["page"] == 1
        assert len(response["data"]) == 1
        assert_dataset_detail_shape(response["data"][0])

    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_list_datasets_preserves_repeated_tag_ids(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        app: Flask,
        mock_tenant,
    ):
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_tenant.id
        mock_dataset_svc.get_datasets.return_value = ([make_dataset()], 1)

        mock_configs = Mock()
        mock_configs.get_models.return_value = []
        mock_provider_mgr.return_value.get_configurations.return_value = mock_configs

        with app.test_request_context("/datasets?tag_ids=tag-a&tag_ids=tag-b", method="GET"):
            api = DatasetListApi()
            response, status = api.get(tenant_id=mock_tenant.id)

        assert status == 200
        assert response["total"] == 1
        mock_dataset_svc.get_datasets.assert_called_once_with(
            1,
            20,
            SessionMatcher(),
            mock_tenant.id,
            mock_current_user,
            None,
            ["tag-a", "tag-b"],
            False,
        )


class TestDatasetListApiPost:
    """Test suite for DatasetListApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_create_dataset_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        app: Flask,
        mock_tenant,
    ):
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.create_empty_dataset.return_value = make_dataset(name="New Dataset")

        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "New Dataset"},
        ):
            api = DatasetListApi()
            response, status = unwrap(api.post)(api, Mock(spec=Session), tenant_id=mock_tenant.id)

        assert status == 200
        assert_dataset_detail_shape(response)
        assert response["name"] == "New Dataset"
        mock_dataset_svc.create_empty_dataset.assert_called_once()

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_create_dataset_duplicate_name(
        self,
        mock_dataset_svc,
        mock_current_user,
        app: Flask,
        mock_tenant,
    ):
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.create_empty_dataset.side_effect = services.errors.dataset.DatasetNameDuplicateError()

        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "Existing Dataset"},
        ):
            api = DatasetListApi()
            with pytest.raises(DatasetNameDuplicateError):
                unwrap(api.post)(api, Mock(spec=Session), tenant_id=mock_tenant.id)


# ---------------------------------------------------------------------------
# API endpoint tests — DatasetApi
# ---------------------------------------------------------------------------


class TestDatasetApiGet:
    """Test suite for DatasetApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        mock_perm_svc,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_dataset.tenant_id

        mock_configs = Mock()
        mock_configs.get_models.return_value = []
        mock_provider_mgr.return_value.get_configurations.return_value = mock_configs

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            response, status = api.get(_=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

        assert status == 200
        assert_dataset_detail_shape(response)
        assert response["embedding_available"] is True
        assert response["retrieval_model_dict"]["search_method"] == "keyword_search"

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_partial_members_shape(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        mock_perm_svc,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset.permission = "partial_members"
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_dataset.tenant_id
        mock_perm_svc.get_dataset_partial_member_list.return_value = ["user-1", "user-2"]

        mock_configs = Mock()
        mock_configs.get_models.return_value = []
        mock_provider_mgr.return_value.get_configurations.return_value = mock_configs

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            response, status = api.get(_=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

        assert status == 200
        assert_dataset_detail_shape(response, with_partial_members=True)
        assert response["partial_member_list"] == ["user-1", "user-2"]

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_uses_default_external_retrieval_model(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        mock_perm_svc,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset.retrieval_model = None
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_dataset.tenant_id

        mock_configs = Mock()
        mock_configs.get_models.return_value = []
        mock_provider_mgr.return_value.get_configurations.return_value = mock_configs

        with app.test_request_context(f"/datasets/{mock_dataset.id}", method="GET"):
            api = DatasetApi()
            response, status = api.get(_=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

        assert status == 200
        assert_dataset_detail_shape(response)
        assert response["external_retrieval_model"] == {
            "top_k": 2,
            "score_threshold": 0.0,
            "score_threshold_enabled": None,
        }

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_not_found(self, mock_dataset_svc, app, mock_dataset):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            with pytest.raises(NotFound):
                api.get(_=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_no_permission(
        self,
        mock_dataset_svc,
        mock_current_user,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.side_effect = services.errors.account.NoPermissionError()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            with pytest.raises(Forbidden):
                api.get(_=mock_dataset.tenant_id, dataset_id=mock_dataset.id)


class TestDatasetApiPatch:
    """Test suite for DatasetApi.patch() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_patch_dataset_success_shape(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_perm_svc,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        updated_dataset = make_dataset(id=mock_dataset.id, tenant_id=mock_dataset.tenant_id, name="Updated Dataset")
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.update_dataset.return_value = updated_dataset
        mock_perm_svc.check_permission.return_value = None
        mock_perm_svc.get_dataset_partial_member_list.return_value = ["user-1"]
        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_dataset.tenant_id

        payload = {
            "name": "Updated Dataset",
            "permission": "partial_members",
            "partial_member_list": [{"user_id": "user-1", "role": "editor"}],
        }
        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="PATCH",
            json=payload,
        ):
            api = DatasetApi()
            response, status = unwrap(api.patch)(
                api,
                Mock(spec=Session),
                _=mock_dataset.tenant_id,
                dataset_id=mock_dataset.id,
            )

        assert status == 200
        assert_dataset_detail_shape(response, with_partial_members=True)
        assert response["name"] == "Updated Dataset"
        assert response["partial_member_list"] == ["user-1"]
        mock_dataset_svc.update_dataset.assert_called_once()
        session, _, update_data, _ = mock_dataset_svc.update_dataset.call_args.args
        assert isinstance(session, (Session, scoped_session))
        assert update_data["name"] == "Updated Dataset"
        assert update_data["permission"] == "partial_members"
        mock_perm_svc.update_partial_member_list.assert_called_once_with(
            mock_dataset.tenant_id,
            mock_dataset.id,
            [{"user_id": "user-1", "role": "editor"}],
            SessionMatcher(),
        )


class TestDatasetApiDelete:
    """Test suite for DatasetApi.delete() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_perm_svc,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.return_value = True

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            result = unwrap(api.delete)(api, _=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

        assert result == ("", 204)

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_not_found(
        self,
        mock_dataset_svc,
        mock_current_user,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.return_value = False

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            with pytest.raises(NotFound):
                unwrap(api.delete)(api, _=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_in_use(
        self,
        mock_dataset_svc,
        mock_current_user,
        app: Flask,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.side_effect = services.errors.dataset.DatasetInUseError()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            with pytest.raises(DatasetInUseError):
                unwrap(api.delete)(api, _=mock_dataset.tenant_id, dataset_id=mock_dataset.id)


# ---------------------------------------------------------------------------
# API endpoint tests — DocumentStatusApi
# ---------------------------------------------------------------------------


class TestDocumentStatusApiPatch:
    """Test suite for DocumentStatusApi.patch() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_doc_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.batch_update_document_status.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1", "doc-2"]},
        ):
            api = DocumentStatusApi()
            response, status = api.patch(
                tenant_id=mock_tenant.id,
                dataset_id=mock_dataset.id,
                action="enable",
            )

        assert status == 200
        assert response["result"] == "success"

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_dataset_not_found(
        self,
        mock_dataset_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(NotFound):
                api.patch(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    action="enable",
                )

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_permission_error(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_doc_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.side_effect = services.errors.account.NoPermissionError(
            "No permission"
        )

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(Forbidden):
                api.patch(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    action="enable",
                )

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_indexing_error(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_doc_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.batch_update_document_status.side_effect = services.errors.document.DocumentIndexingError()

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(InvalidActionError):
                api.patch(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    action="enable",
                )

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_value_error(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_doc_svc,
        app: Flask,
        mock_tenant,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.get_dataset.return_value = mock_dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.batch_update_document_status.side_effect = ValueError("Invalid action")

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(InvalidActionError):
                api.patch(
                    tenant_id=mock_tenant.id,
                    dataset_id=mock_dataset.id,
                    action="enable",
                )


# ---------------------------------------------------------------------------
# API endpoint tests — Tags
# ---------------------------------------------------------------------------


class TestDatasetTagsApiGet:
    """Test suite for DatasetTagsApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_list_tags_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = "tenant-1"
        mock_tag = make_tag(id="tag-1", name="Test Tag", binding_count=0)
        mock_tag_svc.get_tags.return_value = [mock_tag]

        with app.test_request_context("/datasets/tags", method="GET"):
            api = DatasetTagsApi()
            response, status = api.get(_=None)

        assert status == 200
        assert response == [{"id": "tag-1", "name": "Test Tag", "type": "knowledge", "binding_count": "0"}]
        mock_tag_svc.get_tags.assert_called_once_with(SessionMatcher(), "knowledge", "tenant-1")

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_list_tags_from_db(
        self,
        mock_current_user,
        app: Flask,
        db_session_with_containers: Session,
    ):
        """Integration test: creates real Tag rows and retrieves them
        through the controller without mocking TagService."""
        from tests.test_containers_integration_tests.controllers.console.helpers import (
            create_console_account_and_tenant,
        )

        account, tenant = create_console_account_and_tenant(db_session_with_containers)

        tag = Tag(
            name="Integration Tag",
            type=TagType.KNOWLEDGE,
            created_by=account.id,
            tenant_id=tenant.id,
        )
        db_session_with_containers.add(tag)
        db_session_with_containers.commit()

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = tenant.id

        from controllers.service_api.dataset.dataset import DatasetTagsApi

        with app.test_request_context("/datasets/tags", method="GET"):
            api = DatasetTagsApi()
            response, status = api.get(_=None)

        assert status == 200
        assert any(t["name"] == "Integration Tag" for t in response)
        assert all(set(t) == {"id", "name", "type", "binding_count"} for t in response)
        assert all(isinstance(t["binding_count"], str) for t in response)


class TestDatasetTagsApiPost:
    """Test suite for DatasetTagsApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_create_tag_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
        mock_tag = make_tag(id="tag-new", name="New Tag")
        mock_tag_svc.save_tags.return_value = mock_tag

        with app.test_request_context(
            "/datasets/tags",
            method="POST",
            json={"name": "New Tag"},
        ):
            api = DatasetTagsApi()
            response, status = api.post(_=None)

        assert status == 200
        assert response == {"id": "tag-new", "name": "New Tag", "type": "knowledge", "binding_count": "0"}
        mock_tag_svc.save_tags.assert_called_once()

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_create_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

        with app.test_request_context(
            "/datasets/tags",
            method="POST",
            json={"name": "New Tag"},
        ):
            api = DatasetTagsApi()
            with pytest.raises(Forbidden):
                api.post(_=None)


class TestDatasetTagsApiPatch:
    """Test suite for DatasetTagsApi.patch() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.service_api_ns")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_update_tag_success(
        self,
        mock_current_user,
        mock_service_api_ns,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True

        mock_tag = make_tag(id="tag-1", name="Updated Tag")
        mock_tag_svc.update_tags.return_value = mock_tag
        mock_tag_svc.get_tag_binding_count.return_value = 5
        mock_service_api_ns.payload = {"name": "Updated Tag", "tag_id": "tag-1"}

        with app.test_request_context(
            "/datasets/tags",
            method="PATCH",
            json={"name": "Updated Tag", "tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            response, status = api.patch(_=None)

        assert status == 200
        assert response == {"id": "tag-1", "name": "Updated Tag", "type": "knowledge", "binding_count": "5"}
        mock_tag_svc.update_tags.assert_called_once()
        update_payload, tag_id, session = mock_tag_svc.update_tags.call_args.args
        assert update_payload.name == "Updated Tag"
        assert tag_id == "tag-1"

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_update_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

        with app.test_request_context(
            "/datasets/tags",
            method="PATCH",
            json={"name": "Updated Tag", "tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            with pytest.raises(Forbidden):
                api.patch(_=None)


class TestDatasetTagsApiDelete:
    """Test suite for DatasetTagsApi.delete() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.service_api_ns")
    @patch("libs.login.current_user")
    def test_delete_tag_success(
        self,
        mock_current_user,
        mock_service_api_ns,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        user_obj = Mock(spec=Account)
        user_obj.has_edit_permission = True
        mock_current_user.has_edit_permission = True
        # Assign as plain lambda to avoid AsyncMock returning a coroutine
        mock_current_user._get_current_object = lambda: user_obj

        mock_tag_svc.delete_tag.return_value = None
        mock_service_api_ns.payload = {"tag_id": "tag-1"}

        with app.test_request_context(
            "/datasets/tags",
            method="DELETE",
            json={"tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            result = api.delete(_=None)

        assert result == ("", 204)
        mock_tag_svc.delete_tag.assert_called_once_with("tag-1", ANY, tag_type=TagType.KNOWLEDGE)

    @patch("libs.login.current_user")
    def test_delete_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        user_obj = Mock(spec=Account)
        user_obj.has_edit_permission = False
        mock_current_user.has_edit_permission = False
        # Assign as plain lambda to avoid AsyncMock returning a coroutine
        mock_current_user._get_current_object = lambda: user_obj

        with app.test_request_context(
            "/datasets/tags",
            method="DELETE",
            json={"tag_id": "tag-1"},
        ):
            api = DatasetTagsApi()
            with pytest.raises(Forbidden):
                api.delete(_=None)


class TestDatasetTagsBindingStatusApi:
    """Test suite for DatasetTagsBindingStatusApi endpoints."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_get_dataset_tags_binding_status(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsBindingStatusApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = "tenant_123"
        mock_tag = Mock()
        mock_tag.id = "tag_1"
        mock_tag.name = "Test Tag"
        mock_tag_svc.get_tags_by_target_id.return_value = [mock_tag]

        with app.test_request_context("/", method="GET"):
            api = DatasetTagsBindingStatusApi()
            response, status_code = api.get("tenant_123", dataset_id="dataset_123")

        assert status_code == 200
        assert response["data"] == [{"id": "tag_1", "name": "Test Tag"}]
        assert response["total"] == 1
        mock_tag_svc.get_tags_by_target_id.assert_called_once_with("knowledge", "tenant_123", "dataset_123", ANY)


class TestDatasetTagBindingApiPost:
    """Test suite for DatasetTagBindingApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_bind_tags_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagBindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
        mock_tag_svc.save_tag_binding.return_value = None

        with app.test_request_context(
            "/datasets/tags/binding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagBindingApi()
            result = api.post(_=None)

        assert result == ("", 204)
        from services.tag_service import TagBindingCreatePayload

        mock_tag_svc.save_tag_binding.assert_called_once_with(
            TagBindingCreatePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
            ANY,
        )

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_bind_tags_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagBindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

        with app.test_request_context(
            "/datasets/tags/binding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagBindingApi()
            with pytest.raises(Forbidden):
                api.post(_=None)


class TestDatasetTagUnbindingApiPost:
    """Test suite for DatasetTagUnbindingApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_tag_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
        mock_tag_svc.delete_tag_binding.return_value = None

        with app.test_request_context(
            "/datasets/tags/unbinding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagUnbindingApi()
            result = api.post(_=None)

        assert result == ("", 204)
        from services.tag_service import TagBindingDeletePayload

        mock_tag_svc.delete_tag_binding.assert_called_once_with(
            TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
            ANY,
        )

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_legacy_tag_id_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app: Flask,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
        mock_tag_svc.delete_tag_binding.return_value = None

        with app.test_request_context(
            "/datasets/tags/unbinding",
            method="POST",
            json={"tag_id": "tag-1", "target_id": "ds-1"},
        ):
            api = DatasetTagUnbindingApi()
            result = api.post(_=None)

        assert result == ("", 204)
        from services.tag_service import TagBindingDeletePayload

        mock_tag_svc.delete_tag_binding.assert_called_once_with(
            TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type=TagType.KNOWLEDGE),
            ANY,
        )

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_tag_forbidden(self, mock_current_user, app: Flask):
        from controllers.service_api.dataset.dataset import DatasetTagUnbindingApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = False
        mock_current_user.is_dataset_editor = False

        with app.test_request_context(
            "/datasets/tags/unbinding",
            method="POST",
            json={"tag_ids": ["tag-1"], "target_id": "ds-1"},
        ):
            api = DatasetTagUnbindingApi()
            with pytest.raises(Forbidden):
                api.post(_=None)
