import datetime
import json
from contextlib import ExitStack
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

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
from core.rag.index_processor.constant.index_type import IndexStructureType
from extensions.storage.storage_type import StorageType
from models.account import Account, TenantAccountRole
from models.dataset import Dataset, DatasetQuery, Document
from models.enums import CreatorUserRole, DataSourceType, DocumentCreatedFrom, IndexingStatus
from models.model import ApiToken, App, AppMode, IconType, UploadFile
from services.dataset_service import DatasetPermissionService, DatasetService
from services.enterprise import rbac_service as enterprise_rbac_service


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
        "created_at": datetime.datetime(2024, 1, 1, 12, 0, 0, tzinfo=datetime.UTC),
        "updated_by": None,
        "updated_at": datetime.datetime(2024, 1, 1, 12, 0, 0, tzinfo=datetime.UTC),
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


def make_account(role: TenantAccountRole = TenantAccountRole.EDITOR) -> Account:
    account = Account(name="Test User", email="user@example.com")
    account.id = "account-1"
    account.role = role
    return account


def make_related_app(**overrides) -> App:
    base = {
        "id": "app-1",
        "tenant_id": "tenant-1",
        "name": "App",
        "description": "desc",
        "mode": AppMode.CHAT,
        "icon_type": IconType.EMOJI,
        "icon": "🤖",
        "icon_background": "#fff",
        "app_model_config_id": None,
        "workflow_id": None,
        "enable_site": False,
        "enable_api": False,
        "created_by": "account-1",
    }
    base.update(overrides)
    return App(**base)


def make_document_status(**overrides) -> Document:
    base = {
        "id": "doc-1",
        "tenant_id": "tenant-1",
        "dataset_id": "dataset-1",
        "position": 1,
        "data_source_type": DataSourceType.UPLOAD_FILE,
        "batch": "batch-1",
        "name": "doc.txt",
        "created_from": DocumentCreatedFrom.WEB,
        "created_by": "account-1",
        "indexing_status": IndexingStatus.COMPLETED,
        "enabled": True,
        "archived": False,
        "processing_started_at": None,
        "parsing_completed_at": None,
        "cleaning_completed_at": None,
        "splitting_completed_at": None,
        "completed_at": None,
        "paused_at": None,
        "error": None,
        "stopped_at": None,
    }
    base.update(overrides)
    return Document(**base)


class TestDatasetList:
    def _mock_user(self):
        user = make_account()
        return user

    def test_get_success_basic(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [make_dataset(icon_info={"icon": "📙", "icon_type": "emoji"})]

        with app.test_request_context("/datasets"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        assert status == 200
        assert resp["total"] == 1
        assert resp["data"][0]["embedding_available"] is True
        assert resp["data"][0]["icon_info"] == {
            "icon": "📙",
            "icon_background": None,
            "icon_type": "emoji",
            "icon_url": None,
        }

    def test_get_with_ids_filter(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [make_dataset()]

        with app.test_request_context("/datasets?ids=1&ids=2"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets_by_ids",
                    return_value=(datasets, 2),
                ) as by_ids_mock,
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        by_ids_mock.assert_called_once()
        assert status == 200
        assert resp["total"] == 2

    def test_get_attaches_current_user_permission_keys(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)
        current_user = self._mock_user()
        dataset = make_dataset(id="dataset-1")
        permissions = enterprise_rbac_service.MyPermissionsResponse(
            dataset=enterprise_rbac_service.ResourcePermissionSnapshot(
                default_permission_keys=["dataset.acl.readonly"],
                overrides=[
                    enterprise_rbac_service.ResourcePermissionKeys(
                        resource_id="dataset-1",
                        permission_keys=["dataset.acl.readonly", "dataset.acl.edit"],
                    )
                ],
            )
        )

        with app.test_request_context("/datasets"):
            with (
                patch.object(DatasetService, "get_datasets", return_value=([dataset], 1)),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=permissions,
                ) as get_permissions,
            ):
                resp, status = method(api, "tenant-1", current_user)

        get_permissions.assert_called_once_with("tenant-1", current_user.id)
        assert status == 200
        assert resp["data"][0]["permission_keys"] == ["dataset.acl.readonly", "dataset.acl.edit"]

    def test_get_limits_to_own_datasets_without_default_read_permission(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)
        current_user = self._mock_user()
        permissions = enterprise_rbac_service.MyPermissionsResponse(
            workspace=enterprise_rbac_service.WorkspacePermissionSnapshot(
                permission_keys=["dataset.create_and_management"]
            )
        )

        with app.test_request_context("/datasets"):
            with (
                patch("controllers.console.datasets.datasets.dify_config.RBAC_ENABLED", True),
                patch.object(DatasetService, "get_datasets", return_value=([], 0)) as get_datasets,
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=permissions,
                ),
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.DatasetAccess.whitelist_resources",
                    return_value=SimpleNamespace(resource_ids=[]),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                method(api, "tenant-1", current_user)

        assert get_datasets.call_args.kwargs["accessible_dataset_ids"] == []
        assert get_datasets.call_args.kwargs["include_own_datasets"] is True

    def test_get_workspace_owner_bypasses_dataset_whitelist(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)
        current_user = self._mock_user()
        permissions = enterprise_rbac_service.MyPermissionsResponse(
            dataset=enterprise_rbac_service.ResourcePermissionSnapshot(default_permission_keys=["dataset.preview"])
        )

        with app.test_request_context("/datasets"):
            with (
                patch("controllers.console.datasets.datasets.dify_config.RBAC_ENABLED", True),
                patch.object(DatasetService, "get_datasets", return_value=([], 0)) as get_datasets,
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=permissions,
                ),
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.DatasetAccess.whitelist_resources",
                    return_value=SimpleNamespace(unrestricted=True, resource_ids=[]),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                method(api, "tenant-1", current_user)

        assert get_datasets.call_args.kwargs["accessible_dataset_ids"] is None

    def test_get_limits_to_dataset_read_overrides(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)
        current_user = self._mock_user()
        permissions = enterprise_rbac_service.MyPermissionsResponse(
            dataset=enterprise_rbac_service.ResourcePermissionSnapshot(
                overrides=[
                    enterprise_rbac_service.ResourcePermissionKeys(
                        resource_id="dataset-acl-shared",
                        permission_keys=["dataset.acl.preview"],
                    ),
                    enterprise_rbac_service.ResourcePermissionKeys(
                        resource_id="dataset-full",
                        permission_keys=["dataset.full_access"],
                    ),
                    enterprise_rbac_service.ResourcePermissionKeys(
                        resource_id="dataset-shared",
                        permission_keys=["dataset.preview"],
                    ),
                    enterprise_rbac_service.ResourcePermissionKeys(
                        resource_id="dataset-hidden",
                        permission_keys=[],
                    ),
                ]
            )
        )

        with app.test_request_context("/datasets"):
            with (
                patch("controllers.console.datasets.datasets.dify_config.RBAC_ENABLED", True),
                patch.object(DatasetService, "get_datasets", return_value=([], 0)) as get_datasets,
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=permissions,
                ),
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.DatasetAccess.whitelist_resources",
                    return_value=SimpleNamespace(
                        resource_ids=[
                            "dataset-shared",
                            "dataset-acl-shared",
                            "dataset-full",
                            "dataset-whitelist-only",
                        ]
                    ),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                method(api, "tenant-1", current_user)

        assert get_datasets.call_args.kwargs["accessible_dataset_ids"] == [
            "dataset-acl-shared",
            "dataset-full",
            "dataset-shared",
            "dataset-whitelist-only",
        ]
        assert get_datasets.call_args.kwargs["include_own_datasets"] is False

    def test_get_with_ids_applies_dataset_visibility(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)
        current_user = self._mock_user()
        permissions = enterprise_rbac_service.MyPermissionsResponse()

        with app.test_request_context("/datasets?ids=dataset-1"):
            with (
                patch("controllers.console.datasets.datasets.dify_config.RBAC_ENABLED", True),
                patch.object(DatasetService, "get_datasets_by_ids", return_value=([], 0)) as get_datasets_by_ids,
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.MyPermissions.get",
                    return_value=permissions,
                ),
                patch(
                    "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.DatasetAccess.whitelist_resources",
                    return_value=SimpleNamespace(resource_ids=[]),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                method(api, "tenant-1", current_user)

        get_datasets_by_ids.assert_called_once_with(
            ["dataset-1"],
            "tenant-1",
            user=current_user,
            accessible_dataset_ids=[],
            include_own_datasets=False,
        )

    def test_get_with_tag_ids(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [make_dataset()]

        with app.test_request_context("/datasets?tag_ids=tag1"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        assert status == 200

    def test_get_allows_legacy_weighted_score_without_weight_type(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [
            make_dataset(
                retrieval_model={
                    "search_method": "hybrid_search",
                    "reranking_enable": True,
                    "reranking_mode": "weighted_score",
                    "reranking_model": None,
                    "weights": {
                        "vector_setting": {
                            "vector_weight": 0.7,
                            "embedding_model_name": "text-embedding",
                            "embedding_provider_name": "openai",
                        },
                        "keyword_setting": {"keyword_weight": 0.3},
                    },
                    "top_k": 3,
                    "score_threshold_enabled": False,
                    "score_threshold": 0.0,
                }
            )
        ]

        with app.test_request_context("/datasets"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        assert status == 200
        assert resp["data"][0]["retrieval_model_dict"]["weights"]["weight_type"] is None

    def test_get_merges_partial_retrieval_model_defaults(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [make_dataset(retrieval_model={"top_k": 4, "score_threshold_enabled": False})]

        with app.test_request_context("/datasets"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        assert status == 200
        retrieval_model = resp["data"][0]["retrieval_model_dict"]
        assert retrieval_model["search_method"] == "semantic_search"
        assert retrieval_model["reranking_enable"] is False
        assert retrieval_model["top_k"] == 4
        assert retrieval_model["score_threshold_enabled"] is False

    def test_embedding_available_false(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [
            make_dataset(
                indexing_technique="high_quality",
                embedding_model="text-embed",
                embedding_model_provider="openai",
            )
        ]

        config = MagicMock()
        config.get_models.return_value = []  # model not available

        with app.test_request_context("/datasets"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=config,
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        assert resp["data"][0]["embedding_available"] is False

    def test_partial_members_permission(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.get)

        current_user = self._mock_user()
        datasets = [make_dataset(permission="partial_members")]

        with app.test_request_context("/datasets"):
            with (
                patch.object(
                    DatasetService,
                    "get_datasets",
                    return_value=(datasets, 1),
                ),
                patch(
                    "controllers.console.datasets.datasets.db.session.execute",
                    return_value=MagicMock(all=lambda: [("ds-1", "u1")]),
                ),
                patch.object(
                    ProviderManager,
                    "get_configurations",
                    return_value=MagicMock(get_models=lambda **_: []),
                ),
            ):
                resp, status = method(api, "tenant-1", current_user)

        assert resp["data"][0]["partial_member_list"] == ["u1"]


class TestDatasetListApiPost:
    def test_post_success(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {
            "name": "My Dataset",
            "description": "desc",
            "indexing_technique": "economy",
            "provider": "vendor",
        }

        user = make_account()

        dataset = make_dataset(name=payload["name"], description=payload["description"])

        with (
            app.test_request_context("/datasets", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasetService,
                "create_empty_dataset",
                return_value=dataset,
            ),
        ):
            _, status = method(api, "tenant-1", user)

        assert status == 201

    def test_post_forbidden(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {"name": "test"}

        user = make_account(TenantAccountRole.NORMAL)

        with (
            app.test_request_context("/datasets", json=payload),
            patch.object(type(console_ns), "payload", payload),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", user)

    def test_post_duplicate_name(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {"name": "duplicate"}

        user = make_account()

        with (
            app.test_request_context("/datasets", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasetService,
                "create_empty_dataset",
                side_effect=services.errors.dataset.DatasetNameDuplicateError(),
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api, "tenant-1", user)

    def test_post_invalid_payload_missing_name(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.post)

        with app.test_request_context("/datasets", json={}), patch.object(type(console_ns), "payload", {}):
            with pytest.raises(ValueError):
                method(api, "tenant-1", make_account())

    def test_post_invalid_indexing_technique(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {
            "name": "bad",
            "indexing_technique": "invalid-tech",
        }

        with app.test_request_context("/datasets", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError, match="Invalid indexing technique"):
                method(api, "tenant-1", make_account())

    def test_post_invalid_provider(self, app: Flask):
        api = DatasetListApi()
        method = unwrap(api.post)

        payload = {
            "name": "bad",
            "provider": "unknown",
        }

        with app.test_request_context("/datasets", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(ValueError, match="Invalid provider"):
                method(api, "tenant-1", make_account())


class TestDatasetApiGet:
    def test_get_success_basic(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "123e4567-e89b-12d3-a456-426614174000"

        user = make_account()
        tenant_id = "tenant-1"

        dataset = make_dataset(id=dataset_id)

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
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
            patch("controllers.console.datasets.datasets.create_plugin_provider_manager") as provider_manager_mock,
        ):
            # embedding models exist → embedding_available stays True
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, status = method(api, tenant_id, user, dataset_id)

        assert status == 200
        assert data["embedding_available"] is True

    def test_get_attaches_permission_keys_when_rbac_enabled(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "123e4567-e89b-12d3-a456-426614174000"
        user = MagicMock(id="account-1")
        tenant_id = "tenant-1"
        dataset = make_dataset(id=dataset_id)

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch("controllers.console.datasets.datasets.dify_config.RBAC_ENABLED", True),
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
            patch(
                "controllers.console.datasets.datasets.enterprise_rbac_service.RBACService.MyPermissions.get",
                return_value=enterprise_rbac_service.MyPermissionsResponse(
                    dataset=enterprise_rbac_service.ResourcePermissionSnapshot(
                        overrides=[
                            enterprise_rbac_service.ResourcePermissionKeys(
                                resource_id=dataset_id,
                                permission_keys=["dataset.acl.readonly", "dataset.acl.edit"],
                            )
                        ]
                    )
                ),
            ) as get_permissions,
            patch("controllers.console.datasets.datasets.create_plugin_provider_manager") as provider_manager_mock,
        ):
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, status = method(api, tenant_id, user, dataset_id)

        get_permissions.assert_called_once_with(tenant_id, user.id, dataset_id=dataset_id)
        assert status == 200
        assert data["permission_keys"] == ["dataset.acl.readonly", "dataset.acl.edit"]

    def test_get_uses_default_external_retrieval_model(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        dataset = make_dataset(id=dataset_id, retrieval_model=None)

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
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
            patch("controllers.console.datasets.datasets.create_plugin_provider_manager") as provider_manager_mock,
        ):
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, status = method(api, "tenant", make_account(), dataset_id)

        assert status == 200
        assert data["external_retrieval_model"] == {
            "top_k": 2,
            "score_threshold": 0.0,
            "score_threshold_enabled": None,
        }

    def test_get_dataset_not_found(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "missing-id"

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, "tenant", make_account(), dataset_id)

    def test_get_permission_denied(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        dataset = make_dataset(id=dataset_id)

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
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
                method(api, "tenant", make_account(), dataset_id)

    def test_get_high_quality_embedding_unavailable(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        user = make_account()
        tenant_id = "tenant-1"

        dataset = make_dataset(
            id=dataset_id,
            indexing_technique="high_quality",
            embedding_model="text-embedding",
            embedding_model_provider="openai",
        )

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
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
            patch("controllers.console.datasets.datasets.create_plugin_provider_manager") as provider_manager_mock,
        ):
            # embedding model NOT configured
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, _ = method(api, tenant_id, user, dataset_id)

        assert data["embedding_available"] is False

    def test_get_partial_members_permission(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"

        dataset = make_dataset(id=dataset_id, permission="partial_members")

        partial_members = ["u1", "u2"]

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
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
            patch("controllers.console.datasets.datasets.create_plugin_provider_manager") as provider_manager_mock,
        ):
            provider_manager_mock.return_value.get_configurations.return_value.get_models.return_value = []

            data, _ = method(api, "tenant", make_account(), dataset_id)

        assert data["partial_member_list"] == partial_members


class TestDatasetApiPatch:
    def test_patch_success_basic(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"

        payload = {
            "name": "updated-name",
            "description": "updated description",
        }

        user = make_account()
        tenant_id = "tenant-1"

        dataset = make_dataset(id=dataset_id, tenant_id=tenant_id)

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
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
            result, status = method(api, tenant_id, user, dataset_id)

        assert status == 200
        assert result["partial_member_list"] == []

    def test_patch_dataset_not_found(self, app: Flask):
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
                method(api, "tenant-1", make_account(), "missing")

    def test_patch_permission_denied(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"
        dataset = make_dataset(id=dataset_id)

        payload = {"name": "x"}

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=dataset,
            ),
            patch.object(
                DatasetPermissionService,
                "check_permission",
                side_effect=Forbidden("no permission"),
            ),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant", make_account(), dataset_id)

    def test_patch_partial_members_update(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"

        payload = {
            "permission": "partial_members",
            "partial_member_list": [{"user_id": "u1"}, {"user_id": "u2"}],
        }

        dataset = make_dataset(id=dataset_id, permission="partial_members")

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
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
                return_value=["u1", "u2"],
            ),
        ):
            result, _ = method(api, "tenant", make_account(), dataset_id)

        assert result["partial_member_list"] == ["u1", "u2"]

    def test_patch_clear_partial_members(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.patch)

        dataset_id = "dataset-id"

        payload = {
            "permission": "only_me",
        }

        dataset = make_dataset(id=dataset_id)

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(type(console_ns), "payload", payload),
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
            result, _ = method(api, "tenant", make_account(), dataset_id)

        assert result["partial_member_list"] == []


class TestDatasetApiDelete:
    def test_delete_success(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "dataset-id"
        user = make_account()

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
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
            result, status = method(api, user, dataset_id)

        assert status == 204
        assert result == ""

    def test_delete_forbidden_no_permission(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "dataset-id"
        user = make_account(TenantAccountRole.NORMAL)

        with app.test_request_context(f"/datasets/{dataset_id}"):
            with pytest.raises(Forbidden):
                method(api, user, dataset_id)

    def test_delete_dataset_not_found(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "missing-dataset"
        user = make_account()

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(
                DatasetService,
                "delete_dataset",
                return_value=False,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, user, dataset_id)

    def test_delete_dataset_in_use(self, app: Flask):
        api = DatasetApi()
        method = unwrap(api.delete)

        dataset_id = "dataset-id"
        user = make_account()

        with (
            app.test_request_context(f"/datasets/{dataset_id}"),
            patch.object(
                DatasetService,
                "delete_dataset",
                side_effect=services.errors.dataset.DatasetInUseError(),
            ),
        ):
            with pytest.raises(DatasetInUseError):
                method(api, user, dataset_id)


class TestDatasetUseCheckApi:
    def test_get_use_check_true(self, app: Flask):
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

    def test_get_use_check_false(self, app: Flask):
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
    def _query_record(self, index: int = 1) -> DatasetQuery:
        query = DatasetQuery(
            dataset_id="dataset-id",
            content=json.dumps(
                [
                    {
                        "content_type": "text_query",
                        "content": f"question {index}",
                        "file_info": None,
                    }
                ]
            ),
            source="hit_testing",
            source_app_id=None,
            created_by_role=CreatorUserRole.ACCOUNT,
            created_by=f"account-{index}",
        )
        query.id = f"query-{index}"
        query.created_at = datetime.datetime(2024, 1, index, 12, 0, 0, tzinfo=datetime.UTC)
        return query

    def test_get_queries_success(self, app: Flask):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"

        current_user = make_account()

        dataset = make_dataset(id=dataset_id)

        queries = [self._query_record(1), self._query_record(2)]

        with (
            app.test_request_context("/datasets/queries?page=1&limit=20"),
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
            response, status = method(api, current_user, dataset_id)

        assert status == 200
        assert response["total"] == 2
        assert response["page"] == 1
        assert response["limit"] == 20
        assert response["has_more"] is False
        assert len(response["data"]) == 2
        assert response["data"][0] == {
            "id": "query-1",
            "queries": [
                {
                    "content_type": "text_query",
                    "content": "question 1",
                    "file_info": None,
                }
            ],
            "source": "hit_testing",
            "source_app_id": None,
            "created_by_role": "account",
            "created_by": "account-1",
            "created_at": 1704110400,
        }

    def test_get_queries_dataset_not_found(self, app: Flask):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        current_user = make_account()

        with (
            app.test_request_context("/datasets/queries"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound, match="Dataset not found"):
                method(api, current_user, dataset_id)

    def test_get_queries_permission_denied(self, app: Flask):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        current_user = make_account()

        dataset = make_dataset(id=dataset_id)

        with (
            app.test_request_context("/datasets/queries"),
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
                method(api, current_user, dataset_id)

    def test_get_queries_pagination_has_more(self, app: Flask):
        api = DatasetQueryApi()
        method = unwrap(api.get)

        dataset_id = "dataset-id"
        current_user = make_account()

        dataset = make_dataset(id=dataset_id)

        queries = [self._query_record(index) for index in range(1, 21)]

        with (
            app.test_request_context("/datasets/queries?page=1&limit=20"),
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
            response, status = method(api, current_user, dataset_id)

        assert status == 200
        assert response["has_more"] is True
        assert len(response["data"]) == 20


class TestDatasetIndexingEstimateApi:
    def _upload_file(self, *, tenant_id: str = "tenant-1", file_id: str = "file-1") -> UploadFile:
        upload_file = UploadFile(
            tenant_id=tenant_id,
            storage_type=StorageType.LOCAL,
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
            "doc_form": IndexStructureType.PARAGRAPH_INDEX,
            "doc_language": "English",
            "dataset_id": None,
        }

    def test_post_success_upload_file(self, app: Flask):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)

        payload = self._base_payload()

        mock_file = self._upload_file()

        mock_response = MagicMock()
        mock_response.model_dump.return_value = {"tokens": 100}

        with (
            app.test_request_context("/"),
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
            response, status = method(api, "tenant-1")

        assert status == 200
        assert response == {"tokens": 100}

    def test_post_file_not_found(self, app: Flask):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
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
                method(api, "tenant-1")

    def test_post_llm_bad_request_error(self, app: Flask):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)
        mock_file = self._upload_file()

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
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
                method(api, "tenant-1")

    def test_post_provider_token_not_init(self, app: Flask):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)
        mock_file = self._upload_file()

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
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
                method(api, "tenant-1")

    def test_post_generic_exception(self, app: Flask):
        api = DatasetIndexingEstimateApi()
        method = unwrap(api.post)
        mock_file = self._upload_file()

        payload = self._base_payload()

        with (
            app.test_request_context("/"),
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
                method(api, "tenant-1")


class TestDatasetRelatedAppListApi:
    def test_get_success(self, app: Flask):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")

        app1 = make_related_app(id="app-1", name="App 1")
        app2 = make_related_app(id="app-2", name="App 2")

        join1 = MagicMock(app=app1)
        join2 = MagicMock(app=app2)

        with (
            app.test_request_context("/"),
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
            response, status = method(api, make_account(), "dataset-1")

        assert status == 200
        assert response["total"] == 2
        assert response["data"] == [
            {
                "id": "app-1",
                "name": "App 1",
                "description": "desc",
                "mode": "chat",
                "icon_type": "emoji",
                "icon": "🤖",
                "icon_background": "#fff",
                "icon_url": None,
            },
            {
                "id": "app-2",
                "name": "App 2",
                "description": "desc",
                "mode": "chat",
                "icon_type": "emoji",
                "icon": "🤖",
                "icon_background": "#fff",
                "icon_url": None,
            },
        ]

    def test_get_dataset_not_found(self, app: Flask):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, make_account(), "dataset-1")

    def test_get_permission_denied(self, app: Flask):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")

        with (
            app.test_request_context("/"),
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
                method(api, make_account(), "dataset-1")

    def test_get_filters_none_apps(self, app: Flask):
        api = DatasetRelatedAppListApi()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")

        app1 = make_related_app()

        join1 = MagicMock(app=app1)
        join2 = MagicMock(app=None)

        with (
            app.test_request_context("/"),
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
            response, status = method(api, make_account(), "dataset-1")

        assert status == 200
        assert response["total"] == 1
        assert response["data"] == [
            {
                "id": "app-1",
                "name": "App",
                "description": "desc",
                "mode": "chat",
                "icon_type": "emoji",
                "icon": "🤖",
                "icon_background": "#fff",
                "icon_url": None,
            }
        ]


class TestDatasetIndexingStatusApi:
    def test_get_success_with_documents(self, app: Flask):
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
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [document]),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalar",
                return_value=3,
            ),
        ):
            response, status = method(api, "tenant-1", "dataset-1")

        assert status == 200
        assert "data" in response
        assert len(response["data"]) == 1

        item = response["data"][0]
        assert item["completed_segments"] == 3
        assert item["total_segments"] == 3

    def test_get_success_no_documents(self, app: Flask):
        api = DatasetIndexingStatusApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: []),
            ),
        ):
            response, status = method(api, "tenant-1", "dataset-1")

        assert status == 200
        assert response == {"data": []}

    def test_segment_counts_different_values(self, app: Flask):
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

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [document]),
            ),
            patch(
                "controllers.console.datasets.datasets.db.session.scalar",
                side_effect=[2, 5],
            ),
        ):
            response, status = method(api, "tenant-1", "dataset-1")

        assert status == 200
        item = response["data"][0]
        assert item["completed_segments"] == 2
        assert item["total_segments"] == 5


class TestDatasetApiKeyApi:
    def test_get_api_keys_success(self, app: Flask):
        api = DatasetApiKeyApi()
        method = unwrap(api.get)

        mock_key_1 = MagicMock(spec=ApiToken)
        mock_key_1.id = "key-1"
        mock_key_1.type = "dataset"
        mock_key_1.token = "ds-abc"
        mock_key_1.last_used_at = None
        mock_key_1.created_at = None
        mock_key_2 = MagicMock(spec=ApiToken)
        mock_key_2.id = "key-2"
        mock_key_2.type = "dataset"
        mock_key_2.token = "ds-def"
        mock_key_2.last_used_at = None
        mock_key_2.created_at = None

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalars",
                return_value=MagicMock(all=lambda: [mock_key_1, mock_key_2]),
            ),
        ):
            response = method(api, "tenant-1")

        assert "data" in response
        assert len(response["data"]) == 2
        assert response["data"][0]["id"] == "key-1"
        assert response["data"][0]["token"] == "ds-abc"
        assert response["data"][1]["id"] == "key-2"
        assert response["data"][1]["token"] == "ds-def"

    def test_post_create_api_key_success(self, app: Flask):
        api = DatasetApiKeyApi()
        method = unwrap(api.post)

        mock_token = MagicMock()
        mock_token.id = "new-key-id"
        mock_token.last_used_at = None
        mock_token.created_at = datetime.datetime(2024, 1, 1, 0, 0, 0, tzinfo=datetime.UTC)

        mock_api_token_cls = MagicMock()
        mock_api_token_cls.return_value = mock_token
        mock_api_token_cls.generate_api_key.return_value = "dataset-abc123"

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalar",
                return_value=3,
            ),
            patch(
                "controllers.console.datasets.datasets.ApiToken",
                mock_api_token_cls,
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
            response, status = method(api, "tenant-1")

        assert status == 200
        assert isinstance(response, dict)
        assert response["id"] == "new-key-id"
        assert response["token"] == "dataset-abc123"
        assert response["type"] == "dataset"
        assert response["created_at"] is not None

    def test_post_exceed_max_keys(self, app: Flask):
        api = DatasetApiKeyApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalar",
                return_value=10,
            ),
        ):
            with pytest.raises(BadRequest) as exc_info:
                method(api, "tenant-1")

        assert exc_info.value.code == 400
        assert vars(exc_info.value)["data"] == {
            "message": "Cannot create more than 10 API keys for this resource type.",
            "custom": "max_keys_exceeded",
        }


class TestDatasetApiDeleteApi:
    def test_delete_success(self, app: Flask):
        api = DatasetApiDeleteApi()
        method = unwrap(api.delete)

        mock_key = MagicMock()

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalar",
                return_value=mock_key,
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
            response, status = method(api, "tenant-1", "api-key-id")

        assert status == 204
        assert response == ""

    def test_delete_key_not_found(self, app: Flask):
        api = DatasetApiDeleteApi()
        method = unwrap(api.delete)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.db.session.scalar",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", "api-key-id")


class TestDatasetEnableApiApi:
    def test_enable_api(self, app: Flask):
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

    def test_disable_api(self, app: Flask):
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
    def test_get_api_base_url_from_config(self, app: Flask):
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

    def test_get_api_base_url_from_request(self, app: Flask):
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

    def test_get_api_base_url_no_double_v1(self, app: Flask):
        api = DatasetApiBaseUrlApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch(
                "controllers.console.datasets.datasets.dify_config.SERVICE_API_URL",
                "https://example.com/v1",
            ),
        ):
            response = method(api)

        assert response["api_base_url"] == "https://example.com/v1"


class TestDatasetRetrievalSettingApi:
    def test_get_success(self, app: Flask):
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
    def test_get_success(self, app: Flask):
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
    def test_get_success(self, app: Flask):
        api = DatasetErrorDocs()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")
        error_doc = make_document_status(id="error-doc", indexing_status=IndexingStatus.ERROR, error="failed")

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

    def test_get_dataset_not_found(self, app: Flask):
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
    def test_get_success(self, app: Flask):
        api = DatasetPermissionUserListApi()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")
        users = ["u1", "u2"]

        with (
            app.test_request_context("/"),
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
            response, status = method(api, make_account(), "dataset-1")

        assert status == 200
        assert response["data"] == users

    def test_get_permission_denied(self, app: Flask):
        api = DatasetPermissionUserListApi()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")

        with (
            app.test_request_context("/"),
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
                method(api, make_account(), "dataset-1")


class TestDatasetAutoDisableLogApi:
    def test_get_success(self, app: Flask):
        api = DatasetAutoDisableLogApi()
        method = unwrap(api.get)

        dataset = make_dataset(id="dataset-1")
        logs = {"document_ids": ["doc-1"], "count": 1}

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

    def test_get_dataset_not_found(self, app: Flask):
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
