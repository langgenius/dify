"""Unit tests for Service API dataset controller behavior.

Service boundaries stay mocked, while ORM collaborators are concrete model instances
persisted through the shared SQLite session fixture.
"""

import uuid
from datetime import UTC, datetime
from inspect import unwrap
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask
from sqlalchemy.orm import Session
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.service_api.dataset.error import DatasetInUseError, DatasetNameDuplicateError, InvalidActionError
from models.account import Account, Tenant, TenantAccountRole
from models.dataset import AppDatasetJoin, Dataset, DatasetMetadata, Document
from models.enums import PermissionEnum
from models.model import App, Tag, TagBinding

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
DATASET_MODEL_TABLES = (
    Account,
    Tenant,
    Dataset,
    Document,
    App,
    AppDatasetJoin,
    DatasetMetadata,
    Tag,
    TagBinding,
)
pytestmark = pytest.mark.parametrize("sqlite_session", [DATASET_MODEL_TABLES], indirect=True)


@pytest.fixture
def controller_session(sqlite_session: Session) -> Session:
    """Expose the shared SQLite session under the controller-focused fixture name."""
    return sqlite_session


@pytest.fixture
def tenant(controller_session: Session) -> Tenant:
    tenant = Tenant(name="Dataset API Tenant")
    controller_session.add(tenant)
    controller_session.flush()
    return tenant


@pytest.fixture
def account(controller_session: Session, tenant: Tenant, monkeypatch: pytest.MonkeyPatch) -> Account:
    account = Account(name="Dataset API User", email=f"dataset-api-{uuid.uuid4()}@example.com")
    account.role = TenantAccountRole.OWNER
    account._current_tenant = tenant
    controller_session.add(account)
    controller_session.flush()

    # Inject the concrete account at the controller boundary without relying on Flask-Login globals.
    from controllers.service_api.dataset import dataset as dataset_module

    monkeypatch.setattr(dataset_module, "current_user", account)
    return account


def make_dataset(
    session: Session,
    tenant: Tenant,
    account: Account,
    **overrides: object,
) -> Dataset:
    """Create and flush a real dataset so its database-backed properties can be serialized."""

    base: dict[str, object] = {
        "id": str(uuid.uuid4()),
        "tenant_id": tenant.id,
        "name": "Dataset",
        "description": "desc",
        "provider": "vendor",
        "permission": PermissionEnum.ONLY_ME,
        "data_source_type": None,
        "indexing_technique": "economy",
        "created_by": account.id,
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
    dataset = Dataset(**base)
    session.add(dataset)
    session.flush()
    return dataset


@pytest.fixture
def dataset(controller_session: Session, tenant: Tenant, account: Account) -> Dataset:
    return make_dataset(controller_session, tenant, account)


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


def assert_dataset_detail_shape(response: dict[str, object], *, with_partial_members: bool = False) -> None:
    expected_keys = set(DATASET_DETAIL_KEYS)
    if with_partial_members:
        expected_keys.add("partial_member_list")
    assert set(response) == expected_keys
    assert isinstance(response["created_at"], int)
    assert isinstance(response["updated_at"], int)
    retrieval_model = response["retrieval_model_dict"]
    assert isinstance(retrieval_model, dict)
    assert set(retrieval_model) == {
        "search_method",
        "reranking_enable",
        "reranking_mode",
        "reranking_model",
        "weights",
        "top_k",
        "score_threshold_enabled",
        "score_threshold",
    }
    external_retrieval_model = response["external_retrieval_model"]
    if external_retrieval_model is not None:
        assert isinstance(external_retrieval_model, dict)
        assert set(external_retrieval_model) == {
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
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_list_datasets_success(
        self,
        mock_dataset_svc: MagicMock,
        mock_provider_mgr: MagicMock,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_dataset_svc.get_datasets.return_value = ([make_dataset(controller_session, tenant, account)], 1)
        mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

        with app.test_request_context("/datasets?page=1&limit=20", method="GET"):
            api = DatasetListApi()
            response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)

        assert status == 200
        assert set(response) == {"data", "has_more", "limit", "total", "page"}
        assert response["has_more"] is False
        assert response["limit"] == 20
        assert response["total"] == 1
        assert response["page"] == 1
        assert len(response["data"]) == 1
        assert_dataset_detail_shape(response["data"][0])

    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_list_datasets_preserves_repeated_tag_ids(
        self,
        mock_dataset_svc: MagicMock,
        mock_provider_mgr: MagicMock,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_dataset_svc.get_datasets.return_value = ([make_dataset(controller_session, tenant, account)], 1)
        mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

        with app.test_request_context("/datasets?tag_ids=tag-a&tag_ids=tag-b", method="GET"):
            api = DatasetListApi()
            response, status = unwrap(api.get)(api, controller_session, tenant_id=tenant.id)
            page, limit, session, tenant_id, user, keyword, tag_ids, include_all = (
                mock_dataset_svc.get_datasets.call_args.args
            )
            assert user is account

        assert status == 200
        assert response["total"] == 1
        assert (page, limit, session, tenant_id, keyword, tag_ids, include_all) == (
            1,
            20,
            controller_session,
            tenant.id,
            None,
            ["tag-a", "tag-b"],
            False,
        )


class TestDatasetListApiPost:
    """Test suite for DatasetListApi.post() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_create_dataset_success(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        account: Account,
        tenant: Tenant,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_dataset_svc.create_empty_dataset.return_value = make_dataset(
            controller_session, tenant, account, name="New Dataset"
        )

        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "New Dataset"},
        ):
            api = DatasetListApi()
            response, status = unwrap(api.post)(api, controller_session, tenant_id=tenant.id)

        assert status == 200
        assert_dataset_detail_shape(response)
        assert response["name"] == "New Dataset"
        mock_dataset_svc.create_empty_dataset.assert_called_once()

    @pytest.mark.usefixtures("account")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_create_dataset_duplicate_name(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        tenant: Tenant,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetListApi

        mock_dataset_svc.create_empty_dataset.side_effect = services.errors.dataset.DatasetNameDuplicateError()

        with app.test_request_context(
            "/datasets",
            method="POST",
            json={"name": "Existing Dataset"},
        ):
            api = DatasetListApi()
            with pytest.raises(DatasetNameDuplicateError):
                unwrap(api.post)(api, controller_session, tenant_id=tenant.id)


# ---------------------------------------------------------------------------
# API endpoint tests — DatasetApi
# ---------------------------------------------------------------------------


class TestDatasetApiGet:
    """Test suite for DatasetApi.get() endpoint."""

    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_success(
        self,
        mock_dataset_svc: MagicMock,
        mock_provider_mgr: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            response, status = unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

        assert status == 200
        assert_dataset_detail_shape(response)
        assert response["embedding_available"] is True
        assert response["retrieval_model_dict"]["search_method"] == "keyword_search"

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_partial_members_shape(
        self,
        mock_dataset_svc: MagicMock,
        mock_provider_mgr: MagicMock,
        mock_perm_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        dataset.permission = PermissionEnum.PARTIAL_TEAM
        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_perm_svc.get_dataset_partial_member_list.return_value = ["user-1", "user-2"]
        mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            response, status = unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

        assert status == 200
        assert_dataset_detail_shape(response, with_partial_members=True)
        assert response["partial_member_list"] == ["user-1", "user-2"]

    @patch("controllers.service_api.dataset.dataset.create_plugin_provider_manager")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_uses_default_external_retrieval_model(
        self,
        mock_dataset_svc: MagicMock,
        mock_provider_mgr: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        dataset.retrieval_model = None
        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_provider_mgr.return_value.get_configurations.return_value.get_models.return_value = list[object]()

        with app.test_request_context(f"/datasets/{dataset.id}", method="GET"):
            api = DatasetApi()
            response, status = unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

        assert status == 200
        assert_dataset_detail_shape(response)
        assert response["external_retrieval_model"] == {
            "top_k": 2,
            "score_threshold": 0.0,
            "score_threshold_enabled": None,
        }

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_not_found(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            with pytest.raises(NotFound):
                unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_get_dataset_no_permission(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.side_effect = services.errors.account.NoPermissionError()

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="GET",
        ):
            api = DatasetApi()
            with pytest.raises(Forbidden):
                unwrap(api.get)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)


class TestDatasetApiPatch:
    """Test suite for DatasetApi.patch() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_patch_dataset_success_shape(
        self,
        mock_dataset_svc: MagicMock,
        mock_perm_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        dataset.name = "Updated Dataset"
        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.update_dataset.return_value = dataset
        mock_perm_svc.check_permission.return_value = None
        mock_perm_svc.get_dataset_partial_member_list.return_value = ["user-1"]

        payload = {
            "name": "Updated Dataset",
            "permission": "partial_members",
            "partial_member_list": [{"user_id": "user-1", "role": "editor"}],
        }
        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="PATCH",
            json=payload,
        ):
            api = DatasetApi()
            response, status = unwrap(api.patch)(
                api,
                controller_session,
                _=dataset.tenant_id,
                dataset_id=dataset.id,
            )

        assert status == 200
        assert_dataset_detail_shape(response, with_partial_members=True)
        assert response["name"] == "Updated Dataset"
        assert response["partial_member_list"] == ["user-1"]
        mock_dataset_svc.update_dataset.assert_called_once()
        _, update_data, _ = mock_dataset_svc.update_dataset.call_args.args
        session = mock_dataset_svc.update_dataset.call_args.kwargs["session"]
        assert session is controller_session
        assert update_data["name"] == "Updated Dataset"
        assert update_data["permission"] == "partial_members"
        mock_perm_svc.update_partial_member_list.assert_called_once_with(
            dataset.tenant_id,
            dataset.id,
            [{"user_id": "user-1", "role": "editor"}],
            controller_session,
        )


class TestDatasetApiDelete:
    """Test suite for DatasetApi.delete() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DatasetPermissionService")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_success(
        self,
        mock_dataset_svc: MagicMock,
        mock_perm_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.return_value = True

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            result = unwrap(api.delete)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

        assert result == ("", 204)
        mock_perm_svc.clear_partial_member_list.assert_called_once_with(dataset.id, controller_session)

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_not_found(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.return_value = False

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            with pytest.raises(NotFound):
                unwrap(api.delete)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_delete_dataset_in_use(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        dataset: Dataset,
        controller_session: Session,
    ) -> None:
        from controllers.service_api.dataset.dataset import DatasetApi

        mock_dataset_svc.delete_dataset.side_effect = services.errors.dataset.DatasetInUseError()

        with app.test_request_context(
            f"/datasets/{dataset.id}",
            method="DELETE",
        ):
            api = DatasetApi()
            with pytest.raises(DatasetInUseError):
                unwrap(api.delete)(api, controller_session, _=dataset.tenant_id, dataset_id=dataset.id)


# ---------------------------------------------------------------------------
# API endpoint tests — DocumentStatusApi
# ---------------------------------------------------------------------------


class TestDocumentStatusApiPatch:
    """Test suite for DocumentStatusApi.patch() endpoint."""

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_success(
        self,
        mock_dataset_svc: MagicMock,
        mock_doc_svc: MagicMock,
        app: Flask,
        tenant: Tenant,
        dataset: Dataset,
    ) -> None:
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.batch_update_document_status.return_value = None

        with app.test_request_context(
            f"/datasets/{dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1", "doc-2"]},
        ):
            api = DocumentStatusApi()
            response, status = api.patch(
                tenant_id=tenant.id,
                dataset_id=dataset.id,
                action="enable",
            )

        assert status == 200
        assert response["result"] == "success"

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_dataset_not_found(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        tenant: Tenant,
        dataset: Dataset,
    ) -> None:
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_dataset_svc.get_dataset.return_value = None

        with app.test_request_context(
            f"/datasets/{dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(NotFound):
                api.patch(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    action="enable",
                )

    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_permission_error(
        self,
        mock_dataset_svc: MagicMock,
        app: Flask,
        tenant: Tenant,
        dataset: Dataset,
    ) -> None:
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.side_effect = services.errors.account.NoPermissionError(
            "No permission"
        )

        with app.test_request_context(
            f"/datasets/{dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(Forbidden):
                api.patch(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    action="enable",
                )

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_indexing_error(
        self,
        mock_dataset_svc: MagicMock,
        mock_doc_svc: MagicMock,
        app: Flask,
        tenant: Tenant,
        dataset: Dataset,
    ) -> None:
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.batch_update_document_status.side_effect = services.errors.document.DocumentIndexingError()

        with app.test_request_context(
            f"/datasets/{dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(InvalidActionError):
                api.patch(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    action="enable",
                )

    @patch("controllers.service_api.dataset.dataset.DocumentService")
    @patch("controllers.service_api.dataset.dataset.DatasetService")
    def test_batch_update_status_value_error(
        self,
        mock_dataset_svc: MagicMock,
        mock_doc_svc: MagicMock,
        app: Flask,
        tenant: Tenant,
        dataset: Dataset,
    ) -> None:
        from controllers.service_api.dataset.dataset import DocumentStatusApi

        mock_dataset_svc.get_dataset.return_value = dataset
        mock_dataset_svc.check_dataset_permission.return_value = None
        mock_dataset_svc.check_dataset_model_setting.return_value = None
        mock_doc_svc.batch_update_document_status.side_effect = ValueError("Invalid action")

        with app.test_request_context(
            f"/datasets/{dataset.id}/documents/status/enable",
            method="PATCH",
            json={"document_ids": ["doc-1"]},
        ):
            api = DocumentStatusApi()
            with pytest.raises(InvalidActionError):
                api.patch(
                    tenant_id=tenant.id,
                    dataset_id=dataset.id,
                    action="enable",
                )
