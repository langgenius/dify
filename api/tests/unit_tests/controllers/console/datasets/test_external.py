import inspect
from unittest.mock import MagicMock, PropertyMock, patch

import pytest
from flask import Flask
from werkzeug.exceptions import Forbidden, NotFound

import services
from controllers.console import console_ns
from controllers.console.datasets.error import DatasetNameDuplicateError
from controllers.console.datasets.external import (
    BedrockRetrievalApi,
    ExternalApiTemplateApi,
    ExternalApiTemplateListApi,
    ExternalApiUseCheckApi,
    ExternalDatasetCreateApi,
    ExternalKnowledgeHitTestingApi,
)
from models.account import Account, TenantAccountRole
from services.dataset_service import DatasetService
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService
from services.knowledge_service import ExternalDatasetTestService


@pytest.fixture
def app() -> Flask:
    app = Flask("test_external_dataset")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def current_user() -> Account:
    user = Account(name="Test User", email="user-1@example.com")
    user.id = "user-1"
    user.role = TenantAccountRole.EDITOR
    return user


class TestExternalApiTemplateListApi:
    def test_get_success(self, app: Flask):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.get)

        api_item = MagicMock()
        api_item.to_dict.return_value = {"id": "1"}

        with (
            app.test_request_context("/?page=1&limit=20"),
            patch.object(
                ExternalDatasetService,
                "get_external_knowledge_apis",
                return_value=([api_item], 1),
            ) as get_external_knowledge_apis,
        ):
            resp, status = method(api, "tenant-1")

        assert status == 200
        assert resp["total"] == 1
        assert resp["data"][0]["id"] == "1"
        get_external_knowledge_apis.assert_called_once_with(1, 20, "tenant-1", None)

    def test_post_forbidden(self, app: Flask, current_user: Account):
        current_user.role = TenantAccountRole.NORMAL
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.post)

        payload = {"name": "x", "settings": {"k": "v"}}

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(ExternalDatasetService, "validate_api_list"),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", current_user)

    def test_post_duplicate_name(self, app: Flask, current_user: Account):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.post)

        payload = {"name": "x", "settings": {"k": "v"}}

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(ExternalDatasetService, "validate_api_list"),
            patch.object(
                ExternalDatasetService,
                "create_external_knowledge_api",
                side_effect=services.errors.dataset.DatasetNameDuplicateError(),
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api, "tenant-1", current_user)


class TestExternalApiTemplateApi:
    def test_get_not_found(self, app: Flask):
        api = ExternalApiTemplateApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                ExternalDatasetService,
                "get_external_knowledge_api",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "tenant-1", "api-id")

    def test_delete_forbidden(self, app: Flask, current_user: Account):
        current_user.role = TenantAccountRole.NORMAL

        api = ExternalApiTemplateApi()
        method = inspect.unwrap(api.delete)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", current_user, "api-id")


class TestExternalApiUseCheckApi:
    def test_get_scopes_usage_check_to_current_tenant(self, app: Flask):
        api = ExternalApiUseCheckApi()
        method = inspect.unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                ExternalDatasetService,
                "external_knowledge_api_use_check",
                return_value=(True, 2),
            ) as mock_use_check,
        ):
            response, status = method(api, "tenant-1", "api-id")

        assert status == 200
        assert response == {"is_using": True, "count": 2}
        mock_use_check.assert_called_once_with("api-id", "tenant-1")


class TestExternalDatasetCreateApi:
    def test_create_success(self, app: Flask, current_user: Account):
        api = ExternalDatasetCreateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "external_knowledge_api_id": "api",
            "external_knowledge_id": "kid",
            "name": "dataset",
        }

        dataset = MagicMock()

        dataset.embedding_available = False
        dataset.built_in_field_enabled = False
        dataset.is_published = False
        dataset.enable_api = False
        dataset.enable_qa = False
        dataset.enable_vector_store = False
        dataset.vector_store_setting = None
        dataset.is_multimodal = False

        dataset.retrieval_model_dict = {}
        dataset.tags = []
        dataset.external_knowledge_info = None
        dataset.external_retrieval_model = None
        dataset.doc_metadata = []
        dataset.icon_info = None

        dataset.summary_index_setting = MagicMock()
        dataset.summary_index_setting.enable = False

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(
                ExternalDatasetService,
                "create_external_dataset",
                return_value=dataset,
            ),
        ):
            _, status = method(api, "tenant-1", current_user)

        assert status == 201

    def test_create_forbidden(self, app: Flask, current_user: Account):
        current_user.role = TenantAccountRole.NORMAL
        api = ExternalDatasetCreateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "external_knowledge_api_id": "api",
            "external_knowledge_id": "kid",
            "name": "dataset",
        }

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
        ):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", current_user)


class TestExternalKnowledgeHitTestingApi:
    def test_hit_testing_dataset_not_found(self, app: Flask, current_user: Account):
        api = ExternalKnowledgeHitTestingApi()
        method = inspect.unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, current_user, "dataset-id")

    def test_hit_testing_success(self, app: Flask, current_user: Account):
        api = ExternalKnowledgeHitTestingApi()
        method = inspect.unwrap(api.post)

        payload = {"query": "hello"}

        dataset = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission"),
            patch.object(
                HitTestingService,
                "external_retrieve",
                return_value={"ok": True},
            ),
        ):
            resp = method(api, current_user, "dataset-id")

        assert resp["ok"] is True


class TestBedrockRetrievalApi:
    def test_bedrock_retrieval(self, app: Flask):
        api = BedrockRetrievalApi()
        method = inspect.unwrap(api.post)

        payload = {
            "retrieval_setting": {},
            "query": "hello",
            "knowledge_id": "kid",
        }

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(
                ExternalDatasetTestService,
                "knowledge_retrieval",
                return_value={"ok": True},
            ),
        ):
            resp, status = method()

        assert status == 200
        assert resp["ok"] is True


class TestExternalApiTemplateListApiAdvanced:
    def test_post_duplicate_name_error(self, app: Flask, current_user: Account):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.post)

        payload = {"name": "duplicate_api", "settings": {"key": "value"}}

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch("controllers.console.datasets.external.ExternalDatasetService.validate_api_list"),
            patch(
                "controllers.console.datasets.external.ExternalDatasetService.create_external_knowledge_api",
                side_effect=services.errors.dataset.DatasetNameDuplicateError("Duplicate"),
            ),
        ):
            with pytest.raises(DatasetNameDuplicateError):
                method(api, "tenant-1", current_user)

    def test_get_with_pagination(self, app: Flask):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.get)

        templates = [MagicMock(id=f"api-{i}") for i in range(3)]

        with (
            app.test_request_context("/?page=1&limit=20"),
            patch(
                "controllers.console.datasets.external.ExternalDatasetService.get_external_knowledge_apis",
                return_value=(templates, 25),
            ) as get_external_knowledge_apis,
        ):
            resp, status = method(api, "tenant-1")

        assert status == 200
        assert resp["total"] == 25
        assert len(resp["data"]) == 3
        get_external_knowledge_apis.assert_called_once_with(1, 20, "tenant-1", None)


class TestExternalDatasetCreateApiAdvanced:
    def test_create_forbidden(self, app: Flask, current_user: Account):
        """Test creating external dataset without permission"""
        api = ExternalDatasetCreateApi()
        method = inspect.unwrap(api.post)

        current_user.role = TenantAccountRole.NORMAL

        payload = {
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "ek-1",
            "name": "new_dataset",
            "description": "A dataset",
        }

        with app.test_request_context("/", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(Forbidden):
                method(api, "tenant-1", current_user)


class TestExternalKnowledgeHitTestingApiAdvanced:
    def test_hit_testing_dataset_not_found(self, app: Flask, current_user: Account):
        """Test hit testing on non-existent dataset"""
        api = ExternalKnowledgeHitTestingApi()
        method = inspect.unwrap(api.post)

        payload = {
            "query": "test query",
            "external_retrieval_model": None,
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.external.DatasetService.get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, current_user, "ds-1")

    def test_hit_testing_with_custom_retrieval_model(self, app: Flask, current_user: Account):
        api = ExternalKnowledgeHitTestingApi()
        method = inspect.unwrap(api.post)

        dataset = MagicMock()
        payload = {
            "query": "test query",
            "external_retrieval_model": {"type": "bm25"},
            "metadata_filtering_conditions": {"status": "active"},
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.external.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch("controllers.console.datasets.external.DatasetService.check_dataset_permission"),
            patch(
                "controllers.console.datasets.external.HitTestingService.external_retrieve",
                return_value={"results": []},
            ),
        ):
            resp = method(api, current_user, "ds-1")

        assert resp["results"] == []


class TestBedrockRetrievalApiAdvanced:
    def test_bedrock_retrieval_with_invalid_setting(self, app: Flask):
        api = BedrockRetrievalApi()
        method = inspect.unwrap(api.post)

        payload = {
            "retrieval_setting": {},
            "query": "test",
            "knowledge_id": "k-1",
        }

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.external.ExternalDatasetTestService.knowledge_retrieval",
                side_effect=ValueError("Invalid settings"),
            ),
        ):
            with pytest.raises(ValueError):
                method()
