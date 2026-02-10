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
    ExternalDatasetCreateApi,
    ExternalKnowledgeHitTestingApi,
)
from services.dataset_service import DatasetService
from services.external_knowledge_service import ExternalDatasetService
from services.hit_testing_service import HitTestingService
from services.knowledge_service import ExternalDatasetTestService


def unwrap(func):
    while hasattr(func, "__wrapped__"):
        func = func.__wrapped__
    return func


@pytest.fixture
def app():
    app = Flask("test_external_dataset")
    app.config["TESTING"] = True
    return app


@pytest.fixture
def current_user():
    user = MagicMock()
    user.id = "user-1"
    user.is_dataset_editor = True
    user.has_edit_permission = True
    user.is_dataset_operator = True
    return user


@pytest.fixture(autouse=True)
def mock_auth(mocker, current_user):
    mocker.patch(
        "controllers.console.datasets.external.current_account_with_tenant",
        return_value=(current_user, "tenant-1"),
    )


class TestExternalApiTemplateListApi:
    def test_get_success(self, app):
        api = ExternalApiTemplateListApi()
        method = unwrap(api.get)

        api_item = MagicMock()
        api_item.to_dict.return_value = {"id": "1"}

        with (
            app.test_request_context("/?page=1&limit=20"),
            patch.object(
                ExternalDatasetService,
                "get_external_knowledge_apis",
                return_value=([api_item], 1),
            ),
        ):
            resp, status = method(api)

        assert status == 200
        assert resp["total"] == 1
        assert resp["data"][0]["id"] == "1"

    def test_post_forbidden(self, app, current_user):
        current_user.is_dataset_editor = False
        api = ExternalApiTemplateListApi()
        method = unwrap(api.post)

        payload = {"name": "x", "settings": {"k": "v"}}

        with (
            app.test_request_context("/"),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(ExternalDatasetService, "validate_api_list"),
        ):
            with pytest.raises(Forbidden):
                method(api)

    def test_post_duplicate_name(self, app):
        api = ExternalApiTemplateListApi()
        method = unwrap(api.post)

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
                method(api)


class TestExternalApiTemplateApi:
    def test_get_not_found(self, app):
        api = ExternalApiTemplateApi()
        method = unwrap(api.get)

        with (
            app.test_request_context("/"),
            patch.object(
                ExternalDatasetService,
                "get_external_knowledge_api",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "api-id")

    def test_delete_forbidden(self, app, current_user):
        current_user.has_edit_permission = False
        current_user.is_dataset_operator = False

        api = ExternalApiTemplateApi()
        method = unwrap(api.delete)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, "api-id")


class TestExternalDatasetCreateApi:
    def test_create_success(self, app):
        api = ExternalDatasetCreateApi()
        method = unwrap(api.post)

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
            _, status = method(api)

        assert status == 201

    def test_create_forbidden(self, app, current_user):
        current_user.is_dataset_editor = False
        api = ExternalDatasetCreateApi()
        method = unwrap(api.post)

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
                method(api)


class TestExternalKnowledgeHitTestingApi:
    def test_hit_testing_dataset_not_found(self, app):
        api = ExternalKnowledgeHitTestingApi()
        method = unwrap(api.post)

        with (
            app.test_request_context("/"),
            patch.object(
                DatasetService,
                "get_dataset",
                return_value=None,
            ),
        ):
            with pytest.raises(NotFound):
                method(api, "dataset-id")

    def test_hit_testing_success(self, app):
        api = ExternalKnowledgeHitTestingApi()
        method = unwrap(api.post)

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
            resp = method(api, "dataset-id")

        assert resp["ok"] is True


class TestBedrockRetrievalApi:
    def test_bedrock_retrieval(self, app):
        api = BedrockRetrievalApi()
        method = unwrap(api.post)

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
    def test_post_duplicate_name_error(self, app, mock_auth, current_user):
        api = ExternalApiTemplateListApi()
        method = unwrap(api.post)

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
                method(api)

    def test_get_with_pagination(self, app, mock_auth, current_user):
        api = ExternalApiTemplateListApi()
        method = unwrap(api.get)

        templates = [MagicMock(id=f"api-{i}") for i in range(3)]

        with (
            app.test_request_context("/?page=1&limit=20"),
            patch(
                "controllers.console.datasets.external.ExternalDatasetService.get_external_knowledge_apis",
                return_value=(templates, 25),
            ),
        ):
            resp, status = method(api)

        assert status == 200
        assert resp["total"] == 25
        assert len(resp["data"]) == 3


class TestExternalDatasetCreateApiAdvanced:
    def test_create_forbidden(self, app, mock_auth, current_user):
        """Test creating external dataset without permission"""
        api = ExternalDatasetCreateApi()
        method = unwrap(api.post)

        current_user.is_dataset_editor = False

        payload = {
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "ek-1",
            "name": "new_dataset",
            "description": "A dataset",
        }

        with app.test_request_context("/", json=payload), patch.object(type(console_ns), "payload", payload):
            with pytest.raises(Forbidden):
                method(api)


class TestExternalKnowledgeHitTestingApiAdvanced:
    def test_hit_testing_dataset_not_found(self, app, mock_auth, current_user):
        """Test hit testing on non-existent dataset"""
        api = ExternalKnowledgeHitTestingApi()
        method = unwrap(api.post)

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
                method(api, "ds-1")

    def test_hit_testing_with_custom_retrieval_model(self, app, mock_auth, current_user):
        api = ExternalKnowledgeHitTestingApi()
        method = unwrap(api.post)

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
            resp = method(api, "ds-1")

        assert resp["results"] == []


class TestBedrockRetrievalApiAdvanced:
    def test_bedrock_retrieval_with_invalid_setting(self, app, mock_auth, current_user):
        api = BedrockRetrievalApi()
        method = unwrap(api.post)

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
