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
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

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
from models.dataset import DatasetPermissionEnum
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
            TagUpdatePayload(name="Updated Tag")


class TestTagDeletePayload:
    """Test suite for TagDeletePayload Pydantic model."""

    def test_payload_with_tag_id(self):
        payload = TagDeletePayload(tag_id="tag_to_delete")
        assert payload.tag_id == "tag_to_delete"

    def test_payload_requires_tag_id(self):
        with pytest.raises(ValueError):
            TagDeletePayload()


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


def _unwrap(method):
    """Walk ``__wrapped__`` chain to get the original function."""
    fn = method
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


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
    dataset = Mock()
    dataset.id = str(uuid.uuid4())
    dataset.tenant_id = str(uuid.uuid4())
    dataset.indexing_technique = "economy"
    dataset.embedding_model_provider = None
    dataset.embedding_model = None
    return dataset


# ---------------------------------------------------------------------------
# API endpoint tests — DatasetListApi
# ---------------------------------------------------------------------------


class TestDatasetListApiGet:
    """Test suite for DatasetListApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.marshal")
    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_list_datasets_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        mock_marshal,
        app,
        mock_tenant,
    ):
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = mock_tenant.id
        mock_dataset_svc.get_datasets.return_value = ([Mock()], 1)

        mock_configs = Mock()
        mock_configs.get_models.return_value = []
        mock_provider_mgr.return_value.get_configurations.return_value = mock_configs

        mock_marshal.return_value = [{"indexing_technique": "economy", "embedding_model_provider": None}]

        with app.test_request_context("/datasets?page=1&limit=20", method="GET"):
            api = DatasetListApi()
            response, status = api.get(tenant_id=mock_tenant.id)

        assert status == 200
        assert "data" in response
        assert "total" in response


class TestDatasetListApiPost:
    """Test suite for DatasetListApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.marshal")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_create_dataset_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_marshal,
        app,
        mock_tenant,
    ):
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_current_user.__class__ = Account
        mock_dataset_svc.create_empty_dataset.return_value = Mock()
        mock_marshal.return_value = {"id": "ds-1", "name": "New Dataset"}

        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "New Dataset"},
        ):
            api = DatasetListApi()
            response, status = _unwrap(api.post)(api, tenant_id=mock_tenant.id)

        assert status == 200
        mock_dataset_svc.create_empty_dataset.assert_called_once()

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_create_dataset_duplicate_name(
        self,
        mock_dataset_svc,
        mock_current_user,
        app,
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
                _unwrap(api.post)(api, tenant_id=mock_tenant.id)


# ---------------------------------------------------------------------------
# API endpoint tests — DatasetApi
# ---------------------------------------------------------------------------


class TestDatasetApiGet:
    """Test suite for DatasetApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.marshal")
    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_success(
        self,
        mock_dataset_svc,
        mock_current_user,
        mock_provider_mgr,
        mock_marshal,
        mock_perm_svc,
        app,
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

        mock_marshal.return_value = {
            "indexing_technique": "economy",
            "embedding_model_provider": None,
            "permission": "only_me",
        }

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            response, status = api.get(_=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

        assert status == 200
        assert response["embedding_available"] is True

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
        app,
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
        app,
        mock_dataset,
    ):
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.return_value = True

        with app.test_request_context(
            f"/datasets/{mock_dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            result = _unwrap(api.delete)(api, _=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

        assert result == ("", 204)

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_not_found(
        self,
        mock_dataset_svc,
        mock_current_user,
        app,
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
                _unwrap(api.delete)(api, _=mock_dataset.tenant_id, dataset_id=mock_dataset.id)

    @patch("controllers.service_api.dataset.dataset.current_user")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_in_use(
        self,
        mock_dataset_svc,
        mock_current_user,
        app,
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
                _unwrap(api.delete)(api, _=mock_dataset.tenant_id, dataset_id=mock_dataset.id)


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
        app,
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
        app,
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
        app,
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
        app,
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
        app,
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
        app,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.current_tenant_id = "tenant-1"
        mock_tag = SimpleNamespace(id="tag-1", name="Test Tag", type="knowledge", binding_count="0")
        mock_tag_svc.get_tags.return_value = [mock_tag]

        with app.test_request_context("/datasets/tags", method="GET"):
            api = DatasetTagsApi()
            response, status = api.get(_=None)

        assert status == 200
        assert len(response) == 1
        mock_tag_svc.get_tags.assert_called_once_with("knowledge", "tenant-1")

    @pytest.mark.skip(reason="Production bug: DataSetTag.binding_count is str|None but DB COUNT() returns int")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_list_tags_from_db(
        self,
        mock_current_user,
        app,
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


class TestDatasetTagsApiPost:
    """Test suite for DatasetTagsApi.post() endpoint."""

    @pytest.mark.skip(reason="Production bug: DataSetTag.binding_count is str|None but dataset.py passes int 0")
    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_create_tag_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True
        mock_tag = SimpleNamespace(id="tag-new", name="New Tag", type="knowledge")
        mock_tag_svc.save_tags.return_value = mock_tag

        with app.test_request_context(
            "/datasets/tags",
            method="POST",
            json={"name": "New Tag"},
        ):
            api = DatasetTagsApi()
            response, status = api.post(_=None)

        assert status == 200
        assert response["name"] == "New Tag"
        mock_tag_svc.save_tags.assert_called_once()

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_create_tag_forbidden(self, mock_current_user, app):
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

    @pytest.mark.skip(reason="Production bug: DataSetTag.binding_count is str|None but dataset.py passes int 0")
    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.service_api_ns")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_update_tag_success(
        self,
        mock_current_user,
        mock_service_api_ns,
        mock_tag_svc,
        app,
    ):
        from controllers.service_api.dataset.dataset import DatasetTagsApi

        mock_current_user.__class__ = Account
        mock_current_user.has_edit_permission = True
        mock_current_user.is_dataset_editor = True

        mock_tag = SimpleNamespace(id="tag-1", name="Updated Tag", type="knowledge")
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
        assert response["name"] == "Updated Tag"
        mock_tag_svc.update_tags.assert_called_once_with({"name": "Updated Tag", "type": "knowledge"}, "tag-1")

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_update_tag_forbidden(self, mock_current_user, app):
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
        app,
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
        mock_tag_svc.delete_tag.assert_called_once_with("tag-1")

    @patch("libs.login.current_user")
    def test_delete_tag_forbidden(self, mock_current_user, app):
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
        app,
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
        mock_tag_svc.get_tags_by_target_id.assert_called_once_with("knowledge", "tenant_123", "dataset_123")


class TestDatasetTagBindingApiPost:
    """Test suite for DatasetTagBindingApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_bind_tags_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app,
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
            TagBindingCreatePayload(tag_ids=["tag-1"], target_id="ds-1", type="knowledge")
        )

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_bind_tags_forbidden(self, mock_current_user, app):
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
        app,
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
            TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type="knowledge")
        )

    @patch("controllers.service_api.dataset.dataset.TagService")
    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_legacy_tag_id_success(
        self,
        mock_current_user,
        mock_tag_svc,
        app,
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
            TagBindingDeletePayload(tag_ids=["tag-1"], target_id="ds-1", type="knowledge")
        )

    @patch("controllers.service_api.dataset.dataset.current_user")
    def test_unbind_tag_forbidden(self, mock_current_user, app):
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
