"""Unit tests for Service API dataset controller behavior.

Service boundaries stay mocked, while decorated endpoints that receive a database
session are exercised with a real in-memory SQLite Session.
"""

import uuid
from collections.abc import Iterator
from contextlib import ExitStack
from datetime import UTC, datetime
from unittest.mock import Mock, PropertyMock, patch

import pytest
from flask import Flask
from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, scoped_session
from werkzeug.exceptions import Forbidden, NotFound


class SessionMatcher:
    def __eq__(self, other):
        return isinstance(other, (Session, scoped_session))


# ---------------------------------------------------------------------------
# Pydantic model validation tests
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
from inspect import unwrap

import services
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from models.account import Account
from models.dataset import Dataset
from models.enums import TagType
from models.model import Tag


@pytest.fixture
def sqlite_engine() -> Iterator[Engine]:
    engine = create_engine("sqlite:///:memory:")
    try:
        yield engine
    finally:
        engine.dispose()


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
        sqlite_engine: Engine,
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
            with Session(sqlite_engine) as session:
                response, status = unwrap(api.post)(api, session, tenant_id=mock_tenant.id)

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
        sqlite_engine: Engine,
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
            with Session(sqlite_engine) as session, pytest.raises(DatasetNameDuplicateError):
                unwrap(api.post)(api, session, tenant_id=mock_tenant.id)


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
        sqlite_engine: Engine,
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
            with Session(sqlite_engine) as session:
                response, status = unwrap(api.patch)(
                    api,
                    session,
                    _=mock_dataset.tenant_id,
                    dataset_id=mock_dataset.id,
                )

        assert status == 200
        assert_dataset_detail_shape(response, with_partial_members=True)
        assert response["name"] == "Updated Dataset"
        assert response["partial_member_list"] == ["user-1"]
        mock_dataset_svc.update_dataset.assert_called_once()
        _, update_data, _ = mock_dataset_svc.update_dataset.call_args.args
        session = mock_dataset_svc.update_dataset.call_args.kwargs["session"]
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
