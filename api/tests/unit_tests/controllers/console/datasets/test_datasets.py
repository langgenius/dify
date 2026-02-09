import datetime
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.app.error import ProviderNotInitializeError
from controllers.console.datasets.datasets import (
    DatasetApi,
    DatasetApiBaseUrlApi,
    DatasetApiDeleteApi,
    DatasetApiKeyApi,
    DatasetAutoDisableLogApi,
    DatasetEnableApiApi,
    DatasetErrorDocs,
    DatasetIndexingEstimateApi,
    DatasetIndexingStatusApi,
    DatasetListApi,
    DatasetPermissionUserListApi,
    DatasetQueryApi,
    DatasetRelatedAppListApi,
    DatasetRetrievalSettingApi,
    DatasetRetrievalSettingMockApi,
    DatasetUseCheckApi,
)
from controllers.console.datasets.error import DatasetInUseError, DatasetNameDuplicateError, IndexingEstimateError
from core.errors.error import LLMBadRequestError, ProviderTokenNotInitError
from core.provider_manager import ProviderManager
from models.enums import CreatorUserRole
from models.model import ApiToken, UploadFile
from services.dataset_service import DatasetPermissionService, DatasetService


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


class TestDatasetList:
    def _mock_dataset_dict(self, **overrides):
        base = {
            "id": "ds-1",
            "indexing_technique": "economy",
            "embedding_model": None,
            "embedding_model_provider": None,
            "permission": "only_me",
        }
        base.update(overrides)
        return base

    def _mock_user(self):
        user = MagicMock()
        user.is_dataset_editor = True
        return user

    def test_get_success_basic(self, app):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [MagicMock()]
        marshaled = [self._mock_dataset_dict()]

        with app.test_request_context("/datasets"):
            with (
                patch(
                    "controllers.console.datasets.datasets.current_account_with_tenant",
                    return_value=(current_user, "tenant-1"),
                ),
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch(
                    "controllers.console.datasets.datasets.marshal",
                    return_value=marshaled,
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api)

        assert status == 200
        assert resp["total"] == 1
        assert resp["data"][0]["embedding_available"] is True

    def test_get_with_ids_filter(self, app):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [MagicMock()]
        marshaled = [self._mock_dataset_dict()]

        with app.test_request_context("/datasets?ids=1&ids=2"):
            with (
                patch(
                    "controllers.console.datasets.datasets.current_account_with_tenant",
                    return_value=(current_user, "tenant-1"),
                ),
                patch.object(
                    DatasetService,
                    "get_datasets_by_ids",
                    return_value=(datasets, 2),
                ) as by_ids_mock,
                patch(
                    "controllers.console.datasets.datasets.marshal",
                    return_value=marshaled,
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api)

        by_ids_mock.assert_called_once()
        assert status == 200
        assert resp["total"] == 2

    def test_get_with_tag_ids(self, app):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [MagicMock()]
        marshaled = [self._mock_dataset_dict()]

        with app.test_request_context("/datasets?tag_ids=tag1"):
            with (
                patch(
                    "controllers.console.datasets.datasets.current_account_with_tenant",
                    return_value=(current_user, "tenant-1"),
                ),
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch(
                    "controllers.console.datasets.datasets.marshal",
                    return_value=marshaled,
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api)

        assert status == 200

    def test_embedding_available_false(self, app):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [MagicMock()]
        marshaled = [
            self._mock_dataset_dict(
                indexing_technique="high_quality",
                embedding_model="text-embed",
                embedding_model_provider="openai",
            )
        ]

        config = MagicMock()
        config.get_models.return_value = []  # model not available

        with app.test_request_context("/datasets"):
            with (
                patch(
                    "controllers.console.datasets.datasets.current_account_with_tenant",
                    return_value=(current_user, "tenant-1"),
                ),
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch(
                    "controllers.console.datasets.datasets.marshal",
                    return_value=marshaled,
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=config,
                ),
            ):
                resp, status = method(api)

        assert resp["data"][0]["embedding_available"] is False

    def test_partial_members_permission(self, app):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [MagicMock()]
        marshaled = [self._mock_dataset_dict(permission="partial_members")]

        with app.test_request_context("/datasets"):
            with (
                patch(
                    "controllers.console.datasets.datasets.current_account_with_tenant",
                    return_value=(current_user, "tenant-1"),
                ),
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch.object(
                    DatasetPermissionService,
                    "get_dataset_partial_member_list",
                    return_value=[{"id": "u1"}],
                ),
                patch(
                    "controllers.console.datasets.datasets.marshal",
                    return_value=marshaled,
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api)

        assert resp["data"][0]["partial_member_list"] == [{"id": "u1"}]


class TestDatasetListApiPost:
    def test_post_success(self, app):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {
            "name": "My Dataset",
            "description": "desc",
            "indexing_technique": "economy",
            "provider": "vendor",
        }

        user = MagicMock()
        user.is_dataset_editor = True

        dataset = MagicMock()
        # ---- minimal required fields for marshal ----
        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False

        with (
            app.test_request_context("/datasets", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "create_empty_dataset",
                return_value=dataset,
            ),
        ):
            _, status = method(api)

        assert status == 201

    def test_post_forbidden(self, app):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {"name": "test"}

        user = MagicMock()
        user.is_dataset_editor = False

        with (
            app.test_request_context("/datasets", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api)

    def test_post_duplicate_name(self, app):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {"name": "duplicate"}

        user = MagicMock()
        user.is_dataset_editor = True

        with (
            app.test_request_context("/datasets", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "create_empty_dataset",
                side_effect=services.errors.dataset.DatasetNameDuplicateError(),
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api)

    def test_post_invalid_payload_missing_name(self, app):
        api = DatasetListApi()
        method = unwrap(api.post)

        with app.test_request_context("/datasets", json={}), patch.object(type(console_ns), "payload", {}):
            with pytest.raises(ValueError):
                method(api)

    def test_post_invalid_indexing_technique(self, app):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {
            "name": "bad",
            "indexing_technique": "invalid-tech",
        }

        with app.test_request_context("/datasets", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError, match="Invalid indexing technique"):
                method(api)

    def test_post_invalid_provider(self, app):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {
            "name": "bad",
            "provider": "unknown",
        }

        with app.test_request_context("/datasets", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError, match="Invalid provider"):
                method(api)


class TestDatasetApiGet:
    def test_get_success_basic(self, app):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "123e4567-e89b-12d3-a456-426614174000"

        user = MagicMock()
        tenant_id = "tenant-1"

        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.indexing_technique = "economy"
        dataset.embedding_model_provider = None

        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False
        dataset.permission = "only_me"

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets.ProviderManager") as provider_manager_mock,
        ):
            # embedding models exist → embedding_available stays True
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, status = method(api, dataset_id)

        assert status == 200
        assert data["embedding_available"] is True

    def test_get_dataset_not_found(self, app):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "missing-id"

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, dataset_id)

    def test_get_permission_denied(self, app):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        dataset = MagicMock()

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden, match="no access"):
                method(api, dataset_id)

    def test_get_high_quality_embedding_unavailable(self, app):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        user = MagicMock()
        tenant_id = "tenant-1"

        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.indexing_technique = "high_quality"
        dataset.embedding_model = "text-embedding"
        dataset.embedding_model_provider = "openai"

        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False
        dataset.permission = "only_me"

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                return_value=None,
            ),
            patch("controllers.console.datasets.datasets.ProviderManager") as provider_manager_mock,
        ):
            # embedding model NOT configured
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, _ = method(api, dataset_id)

        assert data["embedding_available"] is False

    def test_get_partial_members_permission(self, app):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"

        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.indexing_technique = "economy"
        dataset.embedding_model_provider = None
        dataset.permission = "partial_members"

        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False

        partial_members = [{"id": "u1"}, {"id": "u2"}]

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                return_value=None,
            ),
            patch.object(
                DatasetPermissionService,
                "get_dataset_partial_member_list",
                return_value=partial_members,
            ),
            patch("controllers.console.datasets.datasets.ProviderManager") as provider_manager_mock,
        ):
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, _ = method(api, dataset_id)

        assert data["partial_member_list"] == partial_members


class TestDatasetApiPatch:
    def test_patch_success_basic(self, app):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"

        payload = {
            "name": "updated-name",
            "description": "updated description",
        }

        user = MagicMock()
        tenant_id = "tenant-1"

        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.tenant_id = tenant_id
        dataset.permission = "only_me"
        dataset.indexing_technique = "economy"
        dataset.embedding_model_provider = None

        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, tenant_id),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "check_permission",
                return_value=None,
            ),
            patch.object(
                DatasetService,
                "update_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "get_dataset_partial_member_list",
                return_value=[],
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 200
        assert result["partial_member_list"] == []

    def test_patch_dataset_not_found(self, app):
        api = DatasetApi()
        method = unwrap(api.patch)

        with (
            app.test_request_context("/datasets/missing"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, "missing")

    def test_patch_permission_denied(self, app):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"
        dataset = MagicMock()

        payload = {"name": "x"}

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant"),
            ),
            patch.object(
                DatasetPermissionService,
                "check_permission",
                side_effect=Forbidden("no permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, dataset_id)

    def test_patch_partial_members_update(self, app):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"

        payload = {
            "permission": "partial_members",
            "partial_member_list": [{"id": "u1"}, {"id": "u2"}],
        }

        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.permission = "partial_members"
        dataset.indexing_technique = "economy"
        dataset.embedding_model_provider = None

        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "check_permission",
                return_value=None,
            ),
            patch.object(
                DatasetService,
                "update_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "update_partial_member_list",
                return_value=None,
            ),
            patch.object(
                DatasetPermissionService,
                "get_dataset_partial_member_list",
                return_value=payload["partial_member_list"],
            ),
        ):
            result, _ = method(api, dataset_id)

        assert result["partial_member_list"] == payload["partial_member_list"]

    def test_patch_clear_partial_members(self, app):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"

        payload = {
            "permission": "only_me",
        }

        dataset = MagicMock()
        dataset.id = dataset_id
        dataset.permission = "only_me"
        dataset.indexing_technique = "economy"
        dataset.embedding_model_provider = None

        dataset.embedding_available = True
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.is_multimodal = False
        dataset.documents = []
        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None
        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "check_permission",
                return_value=None,
            ),
            patch.object(
                DatasetService,
                "update_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "clear_partial_member_list",
                return_value=None,
            ),
            patch.object(
                DatasetPermissionService,
                "get_dataset_partial_member_list",
                return_value=[],
            ),
        ):
            result, _ = method(api, dataset_id)

        assert result["partial_member_list"] == []


class TestDatasetApiDelete:
    def test_delete_success(self, app):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "dataset-id"
        user = MagicMock()
        user.has_edit_permission = True
        user.is_dataset_operator = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch.object(
                DatasetService,
                "delete_dataset",
                return_value=True,
            ),
            patch.object(
                DatasetPermissionService,
                "clear_partial_member_list",
                return_value=None,
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 204
        assert result == {"result": "success"}

    def test_delete_forbidden_no_permission(self, app):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "dataset-id"
        user = MagicMock()
        user.has_edit_permission = False
        user.is_dataset_operator = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, dataset_id)

    def test_delete_dataset_not_found(self, app):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "missing-dataset"
        user = MagicMock()
        user.has_edit_permission = True
        user.is_dataset_operator = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch.object(
                DatasetService,
                "delete_dataset",
                return_value=False,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, dataset_id)

    def test_delete_dataset_in_use(self, app):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "dataset-id"
        user = MagicMock()
        user.has_edit_permission = True
        user.is_dataset_operator = False

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(user, "tenant"),
            ),
            patch.object(
                DatasetService,
                "delete_dataset",
                side_effect=services.errors.dataset.DatasetInUseError(),
            ),
        ):
            with pytest.raises(DatasetInUseError):
                method(api, dataset_id)


class TestDatasetUseCheckApi:
    def test_get_use_check_true(self, app):
        api = DatasetUseCheckApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"

        with (
            app.test_request_context(f"/datasets/{dataset_id}/use-check"),
            patch.object(
                DatasetService,
                "dataset_use_check",
                return_value=True,
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 200
        assert result == {"is_using": True}

    def test_get_use_check_false(self, app):
        api = DatasetUseCheckApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"

        with (
            app.test_request_context(f"/datasets/{dataset_id}/use-check"),
            patch.object(
                DatasetService,
                "dataset_use_check",
                return_value=False,
            ),
        ):
            result, status = method(api, dataset_id)

        assert status == 200
        assert result == {"is_using": False}


class TestDatasetQueryApi:
    def test_get_queries_success(self, app):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"

        current_user = MagicMock()

        dataset = MagicMock()
        dataset.id = dataset_id

        queries = [MagicMock(), MagicMock()]

        with (
            app.test_request_context("/datasets/queries?page=1&limit=20"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                return_value=None,
            ),
            patch.object(
                DatasetService,
                "get_dataset_queries",
                return_value=(queries, 2),
            ),
        ):
            response, status = method(api, dataset_id)

        assert status == 200
        assert response["total"] == 2
        assert response["page"] == 1
        assert response["limit"] == 20
        assert response["has_more"] is False
        assert len(response["data"]) == 2

    def test_get_queries_dataset_not_found(self, app):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        current_user = MagicMock()

        with (
            app.test_request_context("/datasets/queries"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, dataset_id)

    def test_get_queries_permission_denied(self, app):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        current_user = MagicMock()

        dataset = MagicMock()

        with (
            app.test_request_context("/datasets/queries"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no access"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, dataset_id)

    def test_get_queries_pagination_has_more(self, app):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        current_user = MagicMock()

        dataset = MagicMock()
        dataset.id = dataset_id

        queries = [MagicMock() for _ in range(20)]

        with (
            app.test_request_context("/datasets/queries?page=1&limit=20"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(current_user, "tenant-1"),
            ),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetService,
                "check_dataset_permission",
                return_value=None,
            ),
            patch.object(
                DatasetService,
                "get_dataset_queries",
                return_value=(queries, 40),
            ),
        ):
            response, status = method(api, dataset_id)

        assert status == 200
        assert response["has_more"] is True
        assert len(response["data"]) == 20


class TestDatasetIndexingEstimateApi:
    def _upload_file(self, *, tenant_id: str = "tenant-1", file_id: str = "file-1") -> UploadFile:
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type="local",
            key="key",
            name="name.txt",
            size=1,
            extension="txt",
            mime_type="text/plain",
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by="user-1",
            created_at=datetime.datetime.now(tz=datetime.UTC),
            used=False,
        )
        upload_file.id = file_id
        return upload_file

    def _base_payload(self):
        return {
            "info_list": {
                "data_source_type": "upload_file",
                "file_info_list": {
                    "file_ids": ["file-1"],
                },
            },
            "process_rule": {"chunk_size": 100},
            "indexing_technique": "high_quality",
            "doc_form": "text_model",
            "doc_language": "English",
            "dataset_id": None,
        }

    def test_post_success_upload_file(self, app):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)

        payload = self._base_payload()

        mock_file = self._upload_file()

        mock_response = MagicMock()
        mock_response.model_dump.return_value = {"tokens": 100}

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.datasets.DocumentService.estimate_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [mock_file]),
            ),
            patch(
                "controllers.console.datasets.datasets.IndexingRunner.indexing_estimate",
                return_value=mock_response,
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert response == {"tokens": 100}

    def test_post_file_not_found(self, app):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.datasets.DocumentService.estimate_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: None),
            ),
        ):
            with pytest.raises(NotFound):
                method(api)

    def test_post_llm_bad_request_error(self, app):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)
        mock_file = self._upload_file()

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.datasets.DocumentService.estimate_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [mock_file]),
            ),
            patch(
                "controllers.console.datasets.datasets.IndexingRunner.indexing_estimate",
                side_effect=LLMBadRequestError(),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api)

    def test_post_provider_token_not_init(self, app):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)
        mock_file = self._upload_file()

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.datasets.DocumentService.estimate_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [mock_file]),
            ),
            patch(
                "controllers.console.datasets.datasets.IndexingRunner.indexing_estimate",
                side_effect=ProviderTokenNotInitError("token missing"),
            ),
        ):
            with pytest.raises(ProviderNotInitializeError):
                method(api)

    def test_post_generic_exception(self, app):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)
        mock_file = self._upload_file()

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch.object(
                type(console_ns),
                "payload",
                new_callable=PropertyMock,
                return_value=payload,
            ),
            patch(
                "controllers.console.datasets.datasets.DocumentService.estimate_args_validate",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [mock_file]),
            ),
            patch(
                "controllers.console.datasets.datasets.IndexingRunner.indexing_estimate",
                side_effect=Exception("boom"),
            ),
        ):
            with pytest.raises(IndexingEstimateError):
                method(api)


class TestDatasetRelatedAppListApi:
    def test_get_success(self, app):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        dataset = MagicMock()
        dataset.id = "dataset-1"

        app1 = MagicMock()
        app2 = MagicMock()

        join1 = MagicMock(app=app1)
        join2 = MagicMock(app=app2)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_related_apps",
                return_value=[join1, join2],
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert response["total"] == 2
        assert response["data"] == [app1, app2]

    def test_get_dataset_not_found(self, app):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "dataset-1")

    def test_get_permission_denied(self, app):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        dataset = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "dataset-1")

    def test_get_filters_none_apps(self, app):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        dataset = MagicMock()
        dataset.id = "dataset-1"

        app1 = MagicMock()

        join1 = MagicMock(app=app1)
        join2 = MagicMock(app=None)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_related_apps",
                return_value=[join1, join2],
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert response["total"] == 1
        assert response["data"] == [app1]


class TestDatasetIndexingStatusApi:
    def test_get_success_with_documents(self, app):
        api = DatasetIndexingStatusApi()
        method = unwrap(api.get)

        document = MagicMock()
        document.id = "doc-1"
        document.indexing_status = "completed"
        document.processing_started_at = None
        document.parsing_completed_at = None
        document.cleaning_completed_at = None
        document.splitting_completed_at = None
        document.completed_at = None
        document.paused_at = None
        document.error = None
        document.stopped_at = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [document]),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.query",
                return_value=MagicMock(where=lambda *args, **kwargs: MagicMock(count=lambda: 3)),
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert "data" in response
        assert len(response["data"]) == 1

        item = response["data"][0]
        assert item["completed_segments"] == 3
        assert item["total_segments"] == 3

    def test_get_success_no_documents(self, app):
        api = DatasetIndexingStatusApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: []),
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert response == {"data": []}

    def test_segment_counts_different_values(self, app):
        api = DatasetIndexingStatusApi()
        method = unwrap(api.get)

        document = MagicMock()
        document.id = "doc-1"
        document.indexing_status = "indexing"
        document.processing_started_at = None
        document.parsing_completed_at = None
        document.cleaning_completed_at = None
        document.splitting_completed_at = None
        document.completed_at = None
        document.paused_at = None
        document.error = None
        document.stopped_at = None

        # First count = completed segments, second = total segments
        query_mock = MagicMock()
        query_mock.where.side_effect = [
            MagicMock(count=lambda: 2),
            MagicMock(count=lambda: 5),
        ]

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [document]),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.query",
                return_value=query_mock,
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        item = response["data"][0]
        assert item["completed_segments"] == 2
        assert item["total_segments"] == 5


class TestDatasetApiKeyApi:
    def test_get_api_keys_success(self, app):
        api = DatasetApiKeyApi()
        method = unwrap(api.get)

        mock_key_1 = MagicMock(spec=ApiToken)
        mock_key_2 = MagicMock(spec=ApiToken)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [mock_key_1, mock_key_2]),
            ),
        ):
            response = method(api)

        assert "items" in response
        assert response["items"] == [mock_key_1, mock_key_2]

    def test_post_create_api_key_success(self, app):
        api = DatasetApiKeyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.query",
                return_value=MagicMock(where=lambda *args, **kwargs: MagicMock(count=lambda: 3)),
            ),
            patch(
                "controllers.console.datasets.datasets.ApiToken.generate_api_key",
                return_value="dataset-abc123",
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.add",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.commit",
                return_value=None,
            ),
        ):
            response, status = method(api)

        assert status == 200
        assert isinstance(response, ApiToken)
        assert response.token == "dataset-abc123"
        assert response.type == "dataset"

    def test_post_exceed_max_keys(self, app):
        api = DatasetApiKeyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.query",
                return_value=MagicMock(where=lambda *args, **kwargs: MagicMock(count=lambda: 10)),
            ),
        ):
            with pytest.raises(TypeError):
                method(api)


class TestDatasetApiDeleteApi:
    def test_delete_success(self, app):
        api = DatasetApiDeleteApi()
        method = unwrap(api.delete)

        mock_key = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.query",
                return_value=MagicMock(where=lambda *args, **kwargs: MagicMock(first=lambda: mock_key)),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.commit",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.delete",
                return_value=None,
            ),
        ):
            response, status = method(api, "api-key-id")

        assert status == 204
        assert response["result"] == "success"

    def test_delete_key_not_found(self, app):
        api = DatasetApiDeleteApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.query",
                return_value=MagicMock(where=lambda *args, **kwargs: MagicMock(first=lambda: None)),
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "api-key-id")


class TestDatasetEnableApiApi:
    def test_enable_api(self, app):
        api = DatasetEnableApiApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.update_dataset_api_status",
                return_value=None,
            ),
        ):
            response, status = method(api, "dataset-1", "enable")

        assert status == 200
        assert response["result"] == "success"

    def test_disable_api(self, app):
        api = DatasetEnableApiApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.update_dataset_api_status",
                return_value=None,
            ),
        ):
            response, status = method(api, "dataset-1", "disable")

        assert status == 200
        assert response["result"] == "success"


class TestDatasetApiBaseUrlApi:
    def test_get_api_base_url_from_config(self, app):
        api = DatasetApiBaseUrlApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.dify_config.SERVICE_API_URL",
                "https://example.com",
            ),
        ):
            response = method(api)

        assert response["api_base_url"] == "https://example.com/v1"

    def test_get_api_base_url_from_request(self, app):
        api = DatasetApiBaseUrlApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("http://localhost:5000/"),
            patch(
                "controllers.console.datasets.datasets.dify_config.SERVICE_API_URL",
                None,
            ),
        ):
            response = method(api)

        assert response["api_base_url"] == "http://localhost:5000/v1"


class TestDatasetRetrievalSettingApi:
    def test_get_success(self, app):
        api = DatasetRetrievalSettingApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.dify_config.VECTOR_STORE",
                "qdrant",
            ),
            patch(
                "controllers.console.datasets.datasets._get_retrieval_methods_by_vector_type",
                return_value={"retrieval_method": ["semantic", "hybrid"]},
            ),
        ):
            response = method(api)

        assert "retrieval_method" in response


class TestDatasetRetrievalSettingMockApi:
    def test_get_success(self, app):
        api = DatasetRetrievalSettingMockApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets._get_retrieval_methods_by_vector_type",
                return_value={"retrieval_method": ["semantic"]},
            ),
        ):
            response = method(api, "milvus")

        assert response["retrieval_method"] == ["semantic"]


class TestDatasetErrorDocs:
    def test_get_success(self, app):
        api = DatasetErrorDocs()
        method = unwrap(api.get)

        dataset = MagicMock()
        error_doc = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DocumentService.get_error_documents_by_dataset_id",
                return_value=[error_doc],
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert response["total"] == 1

    def test_get_dataset_not_found(self, app):
        api = DatasetErrorDocs()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "dataset-1")


class TestDatasetPermissionUserListApi:
    def test_get_success(self, app):
        api = DatasetPermissionUserListApi()
        method = unwrap(api.get)

        dataset = MagicMock()
        users = [{"id": "u1"}, {"id": "u2"}]

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.check_dataset_permission",
                return_value=None,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetPermissionService.get_dataset_partial_member_list",
                return_value=users,
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert response["data"] == users

    def test_get_permission_denied(self, app):
        api = DatasetPermissionUserListApi()
        method = unwrap(api.get)

        dataset = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.current_account_with_tenant",
                return_value=(MagicMock(), "tenant-1"),
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.check_dataset_permission",
                side_effect=services.errors.account.NoPermissionError("no permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "dataset-1")


class TestDatasetAutoDisableLogApi:
    def test_get_success(self, app):
        api = DatasetAutoDisableLogApi()
        method = unwrap(api.get)

        dataset = MagicMock()
        logs = [{"reason": "quota"}]

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset_auto_disable_logs",
                return_value=logs,
            ),
        ):
            response, status = method(api, "dataset-1")

        assert status == 200
        assert response == logs

    def test_get_dataset_not_found(self, app):
        api = DatasetAutoDisableLogApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "dataset-1")
