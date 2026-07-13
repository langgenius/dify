import inspect
from types import SimpleNamespace
from typing import Any
from unittest.mock import ANY, MagicMock, PropertyMock, patch

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


def _external_api_dict(api_id: str = "api-1") -> dict:
    return {
        "id": api_id,
        "tenant_id": "tenant-1",
        "name": f"External API {api_id}",
        "description": f"Description for {api_id}",
        "settings": {
            "endpoint": f"https://external.example.com/{api_id}",
            "api_key": "secret",
            "headers": {"X-Source": "unit-test"},
            "timeout": 30,
        },
        "dataset_bindings": [
            {"id": f"dataset-{api_id}", "name": f"Dataset {api_id}"},
        ],
        "created_by": "user-1",
        "created_at": "2024-01-01T00:00:00",
    }


def _external_api_object(api_id: str = "api-1") -> SimpleNamespace:
    payload = _external_api_dict(api_id)
    return SimpleNamespace(
        **{
            **payload,
            "dataset_bindings": [SimpleNamespace(**binding) for binding in payload["dataset_bindings"]],
        }
    )


def _expected_dataset_detail_payload() -> dict[str, Any]:
    return {
        "id": "dataset-1",
        "name": "Support knowledge",
        "description": "External support articles",
        "provider": "external",
        "permission": "only_me",
        "data_source_type": "external",
        "indexing_technique": "economy",
        "app_count": 2,
        "document_count": 7,
        "word_count": 2048,
        "created_by": "user-1",
        "author_name": "Test User",
        "created_at": 1710000000,
        "updated_by": "user-2",
        "updated_at": 1710003600,
        "embedding_model": None,
        "embedding_model_provider": None,
        "embedding_available": False,
        "retrieval_model_dict": {
            "search_method": "semantic_search",
            "reranking_enable": False,
            "reranking_mode": None,
            "reranking_model": {"reranking_provider_name": None, "reranking_model_name": None},
            "weights": None,
            "top_k": 4,
            "score_threshold_enabled": True,
            "score_threshold": 0.5,
        },
        "summary_index_setting": {
            "enable": True,
            "model_name": "summary-model",
            "model_provider_name": "provider-a",
            "summary_prompt": "Summarize this.",
        },
        "tags": [{"id": "tag-1", "name": "Support", "type": "knowledge"}],
        "doc_form": "text_model",
        "external_knowledge_info": {
            "external_knowledge_id": "knowledge-1",
            "external_knowledge_api_id": "api-1",
            "external_knowledge_api_name": "External API api-1",
            "external_knowledge_api_endpoint": "https://external.example.com/api-1",
        },
        "external_retrieval_model": {
            "top_k": 4,
            "score_threshold": 0.5,
            "score_threshold_enabled": True,
        },
        "doc_metadata": [{"id": "metadata-1", "name": "source", "type": "string"}],
        "built_in_field_enabled": True,
        "pipeline_id": None,
        "runtime_mode": "external",
        "chunk_structure": "general",
        "icon_info": {
            "icon_type": "emoji",
            "icon": "book",
            "icon_background": "#FFF4ED",
            "icon_url": None,
        },
        "is_published": True,
        "total_documents": 7,
        "total_available_documents": 6,
        "enable_api": True,
        "is_multimodal": False,
        "maintainer": None,
        "permission_keys": [],
    }


def _dataset_detail_object() -> SimpleNamespace:
    payload = _expected_dataset_detail_payload()
    return SimpleNamespace(
        **{
            **payload,
            "summary_index_setting": SimpleNamespace(**payload["summary_index_setting"]),
            "tags": [SimpleNamespace(**tag) for tag in payload["tags"]],
            "external_knowledge_info": SimpleNamespace(**payload["external_knowledge_info"]),
            "external_retrieval_model": SimpleNamespace(**payload["external_retrieval_model"]),
            "doc_metadata": [SimpleNamespace(**item) for item in payload["doc_metadata"]],
            "icon_info": SimpleNamespace(**payload["icon_info"]),
        }
    )


class TestExternalApiTemplateListApi:
    def test_get_success(self, app: Flask):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.get)

        api_item = _external_api_object("api-1")

        with (
            app.test_request_context("/?page=2&limit=1&keyword=vector"),
            patch.object(
                ExternalDatasetService,
                "get_external_knowledge_apis",
                return_value=([api_item], 3),
            ) as get_external_knowledge_apis,
        ):
            resp, status = method(api, "tenant-1")

        assert status == 200
        assert resp == {
            "data": [_external_api_dict("api-1")],
            "has_more": True,
            "limit": 1,
            "total": 3,
            "page": 2,
        }
        get_external_knowledge_apis.assert_called_once_with(2, 1, "tenant-1", "vector")

    def test_post_success_uses_validated_payload_and_returns_template(self, app: Flask, current_user: Account):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.post)

        payload = {
            "name": "Vendor Search",
            "settings": {
                "endpoint": "https://external.example.com/search",
                "api_key": "secret",
                "headers": {"X-Source": "unit-test"},
                "timeout": 30,
            },
        }
        created = _external_api_object("api-created")
        session = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(ExternalDatasetService, "validate_api_list") as validate_api_list,
            patch.object(
                ExternalDatasetService,
                "create_external_knowledge_api",
                return_value=created,
            ) as create_external_knowledge_api,
        ):
            resp, status = method(api, session, "tenant-1", current_user)

        assert status == 201
        assert resp == _external_api_dict("api-created")
        validate_api_list.assert_called_once_with(payload["settings"])
        create_external_knowledge_api.assert_called_once_with(
            tenant_id="tenant-1",
            user_id="user-1",
            args=payload,
            session=session,
        )

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
                method(api, MagicMock(), "tenant-1", current_user)

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
                method(api, MagicMock(), "tenant-1", current_user)


class TestExternalApiTemplateApi:
    def test_get_success_returns_template_contract(self, app: Flask):
        api = ExternalApiTemplateApi()
        method = inspect.unwrap(api.get)
        template = _external_api_object("api-detail")
        session = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(
                ExternalDatasetService,
                "get_external_knowledge_api",
                return_value=template,
            ) as get_external_knowledge_api,
        ):
            resp, status = method(api, session, "tenant-1", "api-detail")

        assert status == 200
        assert resp == _external_api_dict("api-detail")
        get_external_knowledge_api.assert_called_once_with(
            external_knowledge_api_id="api-detail", tenant_id="tenant-1", session=session
        )

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
                method(api, MagicMock(), "tenant-1", "api-id")

    def test_patch_success_uses_validated_payload_and_returns_template(self, app: Flask, current_user: Account):
        api = ExternalApiTemplateApi()
        method = inspect.unwrap(api.patch)

        payload = {
            "name": "Updated API",
            "settings": {
                "endpoint": "https://external.example.com/updated",
                "api_key": "new-secret",
                "headers": {"X-Version": "2"},
            },
        }
        updated = _external_api_object("api-updated")
        session = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(ExternalDatasetService, "validate_api_list") as validate_api_list,
            patch.object(
                ExternalDatasetService,
                "update_external_knowledge_api",
                return_value=updated,
            ) as update_external_knowledge_api,
        ):
            resp, status = method(api, session, "tenant-1", current_user, "api-updated")

        assert status == 200
        assert resp == _external_api_dict("api-updated")
        validate_api_list.assert_called_once_with(payload["settings"])
        update_external_knowledge_api.assert_called_once_with(
            tenant_id="tenant-1",
            user_id="user-1",
            external_knowledge_api_id="api-updated",
            args=payload,
            session=session,
        )

    def test_delete_forbidden(self, app: Flask, current_user: Account):
        current_user.role = TenantAccountRole.NORMAL

        api = ExternalApiTemplateApi()
        method = inspect.unwrap(api.delete)

        with app.test_request_context("/"):
            with pytest.raises(Forbidden):
                method(api, MagicMock(), "tenant-1", current_user, "api-id")


class TestExternalApiUseCheckApi:
    def test_get_scopes_usage_check_to_current_tenant(self, app: Flask):
        api = ExternalApiUseCheckApi()
        method = inspect.unwrap(api.get)

        session = MagicMock()

        with (
            app.test_request_context("/"),
            patch.object(
                ExternalDatasetService,
                "external_knowledge_api_use_check",
                return_value=(True, 2),
            ) as mock_use_check,
        ):
            response, status = method(api, session, "tenant-1", "api-id")

        assert status == 200
        assert response == {"is_using": True, "count": 2}
        mock_use_check.assert_called_once_with("api-id", "tenant-1", session=ANY)


class TestExternalDatasetCreateApi:
    def test_create_success(self, app: Flask, current_user: Account):
        api = ExternalDatasetCreateApi()
        method = inspect.unwrap(api.post)

        payload = {
            "external_knowledge_api_id": "api-1",
            "external_knowledge_id": "knowledge-1",
            "name": "Support knowledge",
            "description": "External support articles",
            "external_retrieval_model": {
                "top_k": 4,
                "score_threshold": 0.5,
                "score_threshold_enabled": True,
            },
        }

        dataset = _dataset_detail_object()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(
                ExternalDatasetService,
                "create_external_dataset",
                return_value=dataset,
            ) as create_external_dataset,
        ):
            session = MagicMock()
            resp, status = method(api, session, "tenant-1", current_user)

        assert status == 201
        assert resp == _expected_dataset_detail_payload()
        create_external_dataset.assert_called_once_with(
            tenant_id="tenant-1",
            user_id="user-1",
            args=payload,
            session=session,
        )

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
                method(api, MagicMock(), "tenant-1", current_user)


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
                method(api, MagicMock(), current_user, "dataset-id")

    def test_hit_testing_success(self, app: Flask, current_user: Account):
        api = ExternalKnowledgeHitTestingApi()
        method = inspect.unwrap(api.post)

        payload = {
            "query": "hello",
            "external_retrieval_model": {
                "top_k": 3,
                "score_threshold": 0.25,
                "score_threshold_enabled": True,
            },
            "metadata_filtering_conditions": {
                "logical_operator": "and",
                "conditions": [{"name": "source", "comparison_operator": "contains", "value": "external"}],
            },
        }

        dataset = MagicMock()
        retrieve_response = {
            "query": {"content": "hello"},
            "records": [
                {
                    "content": "answer",
                    "title": "doc",
                    "score": 0.9,
                    "metadata": {"source": "external", "page": 2},
                }
            ],
        }
        session = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(DatasetService, "get_dataset", return_value=dataset),
            patch.object(DatasetService, "check_dataset_permission") as check_dataset_permission,
            patch.object(HitTestingService, "hit_testing_args_check") as hit_testing_args_check,
            patch.object(
                HitTestingService,
                "external_retrieve",
                return_value=retrieve_response,
            ) as external_retrieve,
            patch("controllers.console.datasets.external.dump_response", side_effect=lambda _model, value: value),
        ):
            resp = method(api, session, current_user, "dataset-id")

        assert resp == retrieve_response
        check_dataset_permission.assert_called_once_with(dataset, current_user, session)
        hit_testing_args_check.assert_called_once_with(payload)
        external_retrieve.assert_called_once_with(
            session=session,
            dataset=dataset,
            query="hello",
            account=current_user,
            external_retrieval_model=payload["external_retrieval_model"],
            metadata_filtering_conditions=payload["metadata_filtering_conditions"],
        )


class TestBedrockRetrievalApi:
    def test_bedrock_retrieval(self, app: Flask):
        api = BedrockRetrievalApi()
        method = inspect.unwrap(api.post)

        payload = {
            "retrieval_setting": {"top_k": 5, "score_threshold": 0.72},
            "query": "hello bedrock",
            "knowledge_id": "knowledge-base-1",
        }
        retrieval_response = {
            "records": [
                {
                    "metadata": {"source": "bedrock", "uri": "s3://bucket/doc.txt"},
                    "score": 0.8,
                    "title": "doc",
                    "content": "answer",
                },
                {
                    "metadata": {"source": "bedrock", "uri": "s3://bucket/other.txt"},
                    "score": 0.65,
                    "title": None,
                    "content": None,
                },
            ]
        }

        session = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", new_callable=PropertyMock, return_value=payload),
            patch.object(
                ExternalDatasetTestService,
                "knowledge_retrieval",
                return_value=retrieval_response,
            ) as knowledge_retrieval,
        ):
            resp, status = method()

        assert status == 200
        assert resp == retrieval_response
        retrieval_setting, query, knowledge_id = knowledge_retrieval.call_args.args
        assert retrieval_setting.model_dump() == payload["retrieval_setting"]
        assert query == "hello bedrock"
        assert knowledge_id == "knowledge-base-1"


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
                method(api, MagicMock(), "tenant-1", current_user)

    def test_get_with_pagination(self, app: Flask):
        api = ExternalApiTemplateListApi()
        method = inspect.unwrap(api.get)

        templates = [_external_api_object(f"api-{i}") for i in range(3)]

        with (
            app.test_request_context("/?page=2&limit=3"),
            patch(
                "controllers.console.datasets.external.ExternalDatasetService.get_external_knowledge_apis",
                return_value=(templates, 25),
            ) as get_external_knowledge_apis,
        ):
            resp, status = method(api, "tenant-1")

        assert status == 200
        assert resp == {
            "data": [_external_api_dict(f"api-{i}") for i in range(3)],
            "has_more": True,
            "limit": 3,
            "total": 25,
            "page": 2,
        }
        get_external_knowledge_apis.assert_called_once_with(2, 3, "tenant-1", None)


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
                method(api, MagicMock(), "tenant-1", current_user)


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
                method(api, MagicMock(), current_user, "ds-1")

    def test_hit_testing_with_custom_retrieval_model(self, app: Flask, current_user: Account):
        api = ExternalKnowledgeHitTestingApi()
        method = inspect.unwrap(api.post)

        dataset = MagicMock()
        payload = {
            "query": "test query",
            "external_retrieval_model": {"type": "bm25"},
            "metadata_filtering_conditions": {"status": "active"},
        }
        session = MagicMock()

        with (
            app.test_request_context("/", json=payload),
            patch.object(type(console_ns), "payload", payload),
            patch(
                "controllers.console.datasets.external.DatasetService.get_dataset",
                return_value=dataset,
            ),
            patch("controllers.console.datasets.external.DatasetService.check_dataset_permission") as check_permission,
            patch("controllers.console.datasets.external.HitTestingService.hit_testing_args_check") as args_check,
            patch(
                "controllers.console.datasets.external.HitTestingService.external_retrieve",
                return_value={
                    "query": {"content": "test query"},
                    "records": [
                        {
                            "content": None,
                            "title": "metadata-only",
                            "score": None,
                            "metadata": {"status": "active"},
                        }
                    ],
                },
            ) as external_retrieve,
        ):
            resp = method(api, session, current_user, "ds-1")

        assert resp == {
            "query": {"content": "test query"},
            "records": [
                {
                    "content": None,
                    "title": "metadata-only",
                    "score": None,
                    "metadata": {"status": "active"},
                }
            ],
        }
        check_permission.assert_called_once_with(dataset, current_user, session)
        args_check.assert_called_once_with(payload)
        external_retrieve.assert_called_once_with(
            session=session,
            dataset=dataset,
            query="test query",
            account=current_user,
            external_retrieval_model={"type": "bm25"},
            metadata_filtering_conditions={"status": "active"},
        )


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
